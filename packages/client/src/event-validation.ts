import type { EforgeEvent } from './events/root.js';
import { PLANNING_DECOMPOSITION_EVENT_TYPES } from './events/shared/planning-decomposition.js';
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

export function validateDecompositionRawFieldsForEvent(value: unknown): SchemaError | undefined {
  try {
    if (!isPlainObject(value) || typeof value.type !== 'string' || !DECOMPOSITION_EVENT_TYPES.has(value.type)) return undefined;
    return findForbiddenDecompositionEventField(value, '', value.type);
  } catch {
    return validationError('/decomposition', 'planning decomposition raw-field traversal failed');
  }
}

const ACTION_EVENT_FORBIDDEN_FIELDS = new Set(['input', 'output', 'rawInput', 'rawOutput', 'payload']);
const DECOMPOSITION_EVENT_ALLOWED_METADATA_SUFFIX = /(bytes|hash|count|length)$/;
const DECOMPOSITION_EVENT_TOP_LEVEL_FIELDS_BY_TYPE = new Map<string, Set<string>>([
  ['planning:decomposition:start', new Set(['limits', 'riskEvidence'])],
  ['planning:decomposition:unit:queued', new Set(['unit'])],
  ['planning:decomposition:unit:running', new Set(['unitId'])],
  ['planning:decomposition:unit:progress', new Set(['unitId', 'message', 'observed'])],
  ['planning:decomposition:unit:completed', new Set(['unit'])],
  ['planning:decomposition:unit:skipped', new Set(['unitId', 'reason', 'unit'])],
  ['planning:decomposition:unit:failed', new Set(['unitId', 'reason', 'evidence'])],
  ['planning:decomposition:schedule', new Set(['decision'])],
  ['planning:decomposition:budget', new Set(['limits', 'unitId', 'unitBudgets', 'observed'])],
  ['planning:decomposition:compact-handoff', new Set(['unitId', 'artifactPath', 'byteLength', 'contentHash', 'omittedUnitIds'])],
  ['planning:decomposition:synthesis:complete', new Set(['unitCount', 'coverage', 'artifactPaths'])],
]);
const DECOMPOSITION_EVENT_ENVELOPE_FIELDS = new Set(['type', 'sessionId', 'runId', 'timestamp']);
const DECOMPOSITION_EVENT_FORBIDDEN_FIELD_KEYS = new Set([
  'content',
  'prompt',
  'rawcontent',
  'rawprompt',
  'prompttext',
  'source',
  'sourcecontent',
  'rawsource',
  'sourcetext',
  'transcript',
  'rawtranscript',
  'transcripttext',
]);
const DECOMPOSITION_EVENT_TYPES = new Set<string>(PLANNING_DECOMPOSITION_EVENT_TYPES);
const ACTION_EVENT_TYPES = new Set([
  'extension:action:start',
  'extension:action:complete',
  'extension:action:failed',
  'extension:action:timeout',
]);

// --- eforge:region extension-agent-task-contracts ---
const TASK_EVENT_FORBIDDEN_FIELDS = new Set(['prompt', 'context', 'result', 'transcript', 'rawTranscript', 'raw_transcript']);
const TASK_EVENT_TYPES = new Set([
  'extension:agent-task:start',
  'extension:agent-task:progress',
  'extension:agent-task:complete',
  'extension:agent-task:failed',
  'extension:agent-task:cancelled',
]);
// --- eforge:endregion extension-agent-task-contracts ---

export function validateEforgeEventSemanticFields(event: EforgeEvent): SchemaError | undefined {
  if (ACTION_EVENT_TYPES.has(event.type) && isPlainObject(event)) {
    for (const field of ACTION_EVENT_FORBIDDEN_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(event, field)) {
        return validationError(`/${field}`, 'extension action events must not include raw input, output, or payload fields');
      }
    }
  }

  // --- eforge:region plan-01-contracts-config ---
  if (DECOMPOSITION_EVENT_TYPES.has(event.type) && isPlainObject(event)) {
    const rawFieldError = findForbiddenDecompositionEventField(event, '', event.type);
    if (rawFieldError) return rawFieldError;
  }
  // --- eforge:endregion plan-01-contracts-config ---

  // --- eforge:region extension-agent-task-contracts ---
  if (TASK_EVENT_TYPES.has(event.type) && isPlainObject(event)) {
    const rawFieldError = findForbiddenTaskEventField(event, '');
    if (rawFieldError) return rawFieldError;
  }
  // --- eforge:endregion extension-agent-task-contracts ---

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

  if (event.type === 'planning:scope-context:failure' && event.failure.recovery.attempt > event.failure.recovery.maxAttempts) {
    return validationError('/failure/recovery/attempt', 'recovery attempt cannot exceed maxAttempts');
  }

  if (event.type === 'planning:decomposition:unit:failed' && event.unitId !== event.evidence.unitId) {
    return validationError('/evidence/unitId', 'failed unit evidence unitId must match the event unitId');
  }

  if (event.type === 'planning:decomposition:unit:skipped' && event.unit && event.unitId !== event.unit.unitId) {
    return validationError('/unit/unitId', 'skipped unit summary unitId must match the event unitId');
  }

  if (event.type === 'planning:decomposition:schedule') {
    const concurrentUnitCount = event.decision.runningUnitIds.length + event.decision.selectedBatchUnitIds.length;
    if (concurrentUnitCount > event.decision.parallelism) {
      return validationError('/decision/selectedBatchUnitIds', 'running plus selected unit count cannot exceed schedule parallelism');
    }
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

// --- eforge:region extension-agent-task-contracts ---
function findForbiddenTaskEventField(value: unknown, path: string): SchemaError | undefined {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const childError = findForbiddenTaskEventField(value[index], `${path}/${index}`);
      if (childError) return childError;
    }
    return undefined;
  }
  if (!isPlainObject(value)) return undefined;
  for (const [key, child] of Object.entries(value)) {
    if (TASK_EVENT_FORBIDDEN_FIELDS.has(key)) {
      const fieldPath = `${path}/${key}`;
      return validationError(fieldPath, 'extension agent task lifecycle events must not include raw prompt, context, result, or transcript fields');
    }
    const childError = findForbiddenTaskEventField(child, `${path}/${key}`);
    if (childError) return childError;
  }
  return undefined;
}
// --- eforge:endregion extension-agent-task-contracts ---

// --- eforge:region plan-01-contracts-config ---
function findForbiddenDecompositionEventField(value: unknown, path: string, eventType: string): SchemaError | undefined {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const childError = findForbiddenDecompositionEventField(value[index], `${path}/${index}`, eventType);
      if (childError) return childError;
    }
    return undefined;
  }
  if (!isPlainObject(value)) return undefined;
  for (const [key, child] of Object.entries(value)) {
    const fieldPath = `${path}/${key}`;
    if (path === '' && !isAllowedDecompositionEventTopLevelField(eventType, key)) {
      return isForbiddenDecompositionEventField(key) ? decompositionRawFieldError(fieldPath) : decompositionUnknownFieldError(fieldPath);
    }
    if (path !== '' && isForbiddenDecompositionEventField(key)) return decompositionRawFieldError(fieldPath);
    const childError = findForbiddenDecompositionEventField(child, fieldPath, eventType);
    if (childError) return childError;
  }
  return undefined;
}

function isAllowedDecompositionEventTopLevelField(eventType: string, key: string): boolean {
  return DECOMPOSITION_EVENT_ENVELOPE_FIELDS.has(key) || DECOMPOSITION_EVENT_TOP_LEVEL_FIELDS_BY_TYPE.get(eventType)?.has(key) === true;
}

function isForbiddenDecompositionEventField(key: string): boolean {
  const normalized = key.replace(/[_\-\s]/g, '').toLowerCase();
  if (DECOMPOSITION_EVENT_ALLOWED_METADATA_SUFFIX.test(normalized)) return false;
  if (DECOMPOSITION_EVENT_FORBIDDEN_FIELD_KEYS.has(normalized)) return true;
  return normalized.includes('prompt') || normalized.includes('transcript') || normalized.includes('rawcontent') || normalized.includes('rawsource') || normalized.includes('sourcecontent') || normalized.includes('sourcetext');
}

function decompositionRawFieldError(fieldPath: string): SchemaError {
  return validationError(fieldPath, 'planning decomposition events must not include raw source, prompt, transcript, or content fields');
}

function decompositionUnknownFieldError(fieldPath: string): SchemaError {
  return validationError(fieldPath, 'planning decomposition events must not include unknown top-level fields');
}
// --- eforge:endregion plan-01-contracts-config ---

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function validationError(path: string, message: string, formattedMessage = `${path}: ${message}`): SchemaError {
  return { message: formattedMessage, errors: [{ path, message }] };
}
