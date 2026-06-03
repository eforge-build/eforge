import type { EforgeEvent } from './events.schemas.js';
import type { SchemaError } from './schema-utils.js';

export const MAX_REVIEW_ISSUE_METADATA_STRING_LENGTH = 4096;

const MAX_REVIEW_ISSUE_METADATA_DEPTH = 8;
const MAX_REVIEW_ISSUE_METADATA_NODES = 200;
const REVIEW_ISSUE_EVENT_TYPES = new Set([
  'planning:review:complete',
  'planning:architecture:review:complete',
  'planning:cohesion:complete',
  'plan:build:review:complete',
  'plan:build:review:parallel:perspective:complete',
]);

export function validateReviewIssueMetadataBoundsForEvent(value: unknown): SchemaError | undefined {
  try {
    if (!isPlainObject(value) || typeof value.type !== 'string') return undefined;

    if (REVIEW_ISSUE_EVENT_TYPES.has(value.type) && Array.isArray(value.issues)) {
      const topLevelResult = validateReviewIssuesMetadataBounds(value.issues, '/issues');
      if (topLevelResult) return topLevelResult;
    }

    if (value.type === 'recovery:summary') {
      const summary = isPlainObject(value.summary) ? value.summary : undefined;
      const reviewFailure = summary && isPlainObject(summary.reviewFailure) ? summary.reviewFailure : undefined;
      if (reviewFailure && Array.isArray(reviewFailure.issues)) {
        const nestedResult = validateReviewIssuesMetadataBounds(reviewFailure.issues, '/summary/reviewFailure/issues');
        if (nestedResult) return nestedResult;
      }
    }

    return undefined;
  } catch {
    return validationError('/metadata', 'review issue metadata traversal failed');
  }
}

export function validateEforgeEventSemanticFields(event: EforgeEvent): SchemaError | undefined {
  if (
    event.type === 'extension:policy:decision' &&
    (event.decision === 'block' || event.decision === 'require-approval') &&
    (typeof event.reason !== 'string' || event.reason.trim().length === 0)
  ) {
    return validationError('/reason', 'blocking policy decisions require a non-empty reason');
  }

  if (event.type === 'stack:landing:conflict:recovery:start' && event.attempt > event.maxAttempts) {
    return validationError('/attempt', 'recovery attempt cannot exceed maxAttempts');
  }

  if (event.type === 'stack:landing:conflict:recovery:failed' && event.abortSucceeded && !event.abortAttempted) {
    return validationError('/abortSucceeded', 'abortSucceeded=true requires abortAttempted=true');
  }

  if (event.type !== 'acceptance_validation:complete') return undefined;

  const nonPassingCount = event.verdicts.filter((v) => v.verdict !== 'pass').length;
  const waiverIssues = (event.waivers ?? [])
    .map((waiver, index) => ({ waiver, index }))
    .filter(({ waiver }) => waiver.trim().length === 0);

  if (waiverIssues.length > 0) {
    return {
      message: '/waivers: waiver entries must be non-empty reason strings',
      errors: waiverIssues.map(({ index }) => ({ path: `/waivers/${index}`, message: 'waiver entries must be non-empty reason strings' })),
    };
  }

  if (event.passed && nonPassingCount > 0 && (event.waivers ?? []).length === 0) {
    return validationError('/passed', 'passed=true requires all verdicts to pass or explicit waivers', '/passed: acceptance_validation passed=true requires all verdicts to pass or explicit waivers');
  }

  if (!event.passed && nonPassingCount === 0) {
    return validationError('/passed', 'passed=false requires at least one fail or unknown verdict', '/passed: acceptance_validation passed=false requires at least one fail or unknown verdict');
  }

  return undefined;
}

function validateReviewIssuesMetadataBounds(issues: unknown[], path: string): SchemaError | undefined {
  for (let issueIndex = 0; issueIndex < issues.length; issueIndex++) {
    const issue = issues[issueIndex];
    if (!isPlainObject(issue) || !Object.prototype.hasOwnProperty.call(issue, 'metadata')) continue;
    const metadataResult = validateReviewIssueMetadataBounds(issue.metadata, `${path}/${issueIndex}/metadata`);
    if (metadataResult) return metadataResult;
  }
  return undefined;
}

function validateReviewIssueMetadataBounds(metadata: unknown, path: string): SchemaError | undefined {
  const state = { nodes: 0 };
  const error = visitReviewIssueMetadata(metadata, path, 0, state);
  return error ? validationError(path, error) : undefined;
}

function visitReviewIssueMetadata(value: unknown, path: string, depth: number, state: { nodes: number }): string | undefined {
  state.nodes += 1;
  if (state.nodes > MAX_REVIEW_ISSUE_METADATA_NODES) return `metadata exceeds maximum node count of ${MAX_REVIEW_ISSUE_METADATA_NODES}`;
  if (depth > MAX_REVIEW_ISSUE_METADATA_DEPTH) return `metadata exceeds maximum depth of ${MAX_REVIEW_ISSUE_METADATA_DEPTH} at ${path}`;
  if (value === null || typeof value === 'boolean') return undefined;
  if (typeof value === 'string') {
    return value.length > MAX_REVIEW_ISSUE_METADATA_STRING_LENGTH
      ? `metadata string at ${path} exceeds ${MAX_REVIEW_ISSUE_METADATA_STRING_LENGTH} characters`
      : undefined;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? undefined : `metadata number at ${path} must be finite`;
  if (Array.isArray(value)) return visitMetadataArray(value, path, depth, state);
  if (isPlainObject(value)) return visitMetadataObject(value, path, depth, state);
  return `metadata value at ${path} is not JSON-safe (${typeof value})`;
}

function visitMetadataArray(value: unknown[], path: string, depth: number, state: { nodes: number }): string | undefined {
  for (let i = 0; i < value.length; i++) {
    const error = visitReviewIssueMetadata(value[i], `${path}/${i}`, depth + 1, state);
    if (error) return error;
  }
  return undefined;
}

function visitMetadataObject(value: Record<string, unknown>, path: string, depth: number, state: { nodes: number }): string | undefined {
  for (const [key, child] of Object.entries(value)) {
    const error = visitReviewIssueMetadata(child, `${path}/${key}`, depth + 1, state);
    if (error) return error;
  }
  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function validationError(path: string, message: string, formattedMessage = `${path}: ${message}`): SchemaError {
  return { message: formattedMessage, errors: [{ path, message }] };
}
