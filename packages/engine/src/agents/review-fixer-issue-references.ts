import { safeParseWithSchema, type ReviewFixIssueReference, type ValueError } from '@eforge-build/client';
import type { CustomTool } from '../harness.js';
import {
  reviewFixerIssueReferenceSubmissionSchema,
  type ReviewFixerIssueReferenceSubmission,
} from '../schemas.js';

export const REVIEW_FIXER_ISSUE_REFERENCES_TOOL_NAME = 'submit_review_fixer_issue_references';

export type ReviewFixerIssueReferenceSubmissionCallback = (
  submission: ReviewFixerIssueReferenceSubmission,
) => boolean | void | Promise<boolean | void>;

function formatToolValidationError(errors: readonly ValueError[]): string {
  const lines = errors.map(error => {
    const path = error.path
      ? (error.path.replace(/^\//, '').replace(/\//g, '.') || '(root)')
      : '(root)';
    return `  - ${path}: ${error.message}`;
  });
  return [
    'Review-fixer issue reference submission rejected: the payload did not validate against the schema.',
    'Fix each issue below and call the tool again with the corrected payload, or omit issue references.',
    '',
    ...lines,
  ].join('\n');
}

export function createReviewFixerIssueReferencesTool(
  onSubmit: ReviewFixerIssueReferenceSubmissionCallback,
): CustomTool {
  let submitted = false;
  return {
    name: REVIEW_FIXER_ISSUE_REFERENCES_TOOL_NAME,
    description: 'Submit best-effort statuses for reviewer issue IDs addressed by the review-fixer. Optional metadata only; submit at most once.',
    inputSchema: reviewFixerIssueReferenceSubmissionSchema,
    handler: async (input: unknown) => {
      const parseResult = safeParseWithSchema(reviewFixerIssueReferenceSubmissionSchema, input);
      if (!parseResult.success) {
        return formatToolValidationError(parseResult.error.errors);
      }
      if (submitted) {
        return 'Error: review-fixer issue references were already submitted. Only one submission per review-fixer turn is allowed.';
      }
      submitted = true;
      const accepted = await onSubmit(parseResult.data);
      if (accepted === false) {
        return 'Error: review-fixer issue references were already submitted. Only one submission per review-fixer turn is allowed.';
      }
      return `Review-fixer issue references submitted successfully (${parseResult.data.issueReferences.length}).`;
    },
  };
}

export function parseReviewFixerIssueReferencesBlock(text: string): ReviewFixIssueReference[] {
  const references: ReviewFixIssueReference[] = [];
  const blockRegex = /<issue-references>([\s\S]*?)<\/issue-references>/g;
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = blockRegex.exec(text)) !== null) {
    const block = blockMatch[1];
    references.push(...parseIssueReferenceEntries(block));
  }

  return references;
}

function parseIssueReferenceEntries(block: string): ReviewFixIssueReference[] {
  const references: ReviewFixIssueReference[] = [];
  const entryRegex = /<issue-reference\b([^>]*)>([\s\S]*?)<\/issue-reference>/g;
  let entryMatch: RegExpExecArray | null;

  while ((entryMatch = entryRegex.exec(block)) !== null) {
    const reference = parseIssueReferenceEntry(entryMatch[1], entryMatch[2]);
    if (reference) references.push(reference);
  }

  return references;
}

function parseIssueReferenceEntry(attrs: string, inner: string): ReviewFixIssueReference | undefined {
  const issueId = extractAttribute(attrs, 'issueId') ?? extractChildElement(inner, 'issueId');
  const status = extractAttribute(attrs, 'status') ?? extractChildElement(inner, 'status');
  const note = extractChildElement(inner, 'note') ?? extractAttribute(attrs, 'note');
  const candidate = {
    issueId,
    status,
    ...(note !== undefined && note.length > 0 ? { note } : {}),
  };
  const parseResult = safeParseWithSchema(reviewFixerIssueReferenceSubmissionSchema, {
    issueReferences: [candidate],
  });
  return parseResult.success ? parseResult.data.issueReferences[0] : undefined;
}

function extractAttribute(attrs: string, name: string): string | undefined {
  const regex = new RegExp(`${name}="([^"]*)"`);
  const match = attrs.match(regex);
  const value = match ? decodeXmlEntities(match[1].trim()) : undefined;
  return value ? value : undefined;
}

function extractChildElement(content: string, tagName: string): string | undefined {
  const regex = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`);
  const match = content.match(regex);
  const value = match ? decodeXmlEntities(match[1].trim()) : undefined;
  return value ? value : undefined;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
