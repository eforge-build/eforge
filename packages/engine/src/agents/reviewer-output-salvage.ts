import { classifyAgentTerminalSubtype } from '../harness.js';
import { isRetryableInfrastructureSubtype } from '../retry.js';
import type { ReviewIssue } from '../events.js';

// --- eforge:region reviewer-late-output-salvage ---
const DEFAULT_SALVAGE_CATEGORY = 'reviewer-finding';
const DEFAULT_SALVAGE_FILE = 'reviewer-output';

export function isSalvageableLateReviewerOutputError(err: unknown): boolean {
  const subtype = classifyAgentTerminalSubtype(err);
  return subtype === 'error_context_window' || (subtype !== undefined && isRetryableInfrastructureSubtype(subtype));
}

export function salvageReviewIssuesFromMalformedReviewOutput(text: string): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  for (const block of reviewIssueBlocks(text)) {
    for (const match of block.matchAll(/<issue\b([^>]*)>([\s\S]*?)<\/issue>/g)) {
      const issue = salvageIssue(match[1] ?? '', match[2] ?? '');
      if (issue) issues.push(issue);
    }
  }
  return issues;
}

function reviewIssueBlocks(text: string): string[] {
  return [...text.matchAll(/<review-issues>([\s\S]*?)<\/review-issues>/g)].map(match => match[1] ?? '');
}

function salvageIssue(attrs: string, inner: string): ReviewIssue | undefined {
  const severity = normalizeSeverity(attr(attrs, 'severity') ?? child(inner, 'severity'));
  if (!severity) return undefined;

  const evidence = firstEvidenceItem(inner);
  const file = attr(attrs, 'file') ?? child(inner, 'file') ?? child(inner, 'path') ?? evidence?.path ?? DEFAULT_SALVAGE_FILE;
  const line = parseLine(attr(attrs, 'line') ?? child(inner, 'line') ?? evidence?.line);
  const category = attr(attrs, 'category') ?? child(inner, 'category') ?? DEFAULT_SALVAGE_CATEGORY;
  const description = buildDescription(inner);
  if (!description) return undefined;

  const issue: ReviewIssue = { severity, category, file, description };
  if (line !== undefined) issue.line = line;
  const fix = child(inner, 'fix') ?? child(inner, 'recommendation');
  if (fix) issue.fix = normalizeText(fix);
  return issue;
}

function attr(attrs: string, name: string): string | undefined {
  const match = attrs.match(new RegExp(`${name}="([^"]*)"`));
  const value = match?.[1]?.trim();
  return value || undefined;
}

function child(inner: string, name: string): string | undefined {
  const match = inner.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`));
  const value = match?.[1] ? normalizeText(match[1]) : undefined;
  return value || undefined;
}

function normalizeSeverity(raw: string | undefined): ReviewIssue['severity'] | undefined {
  switch (raw?.trim().toLowerCase()) {
    case 'critical':
    case 'blocker':
    case 'high':
      return 'critical';
    case 'warning':
    case 'medium':
    case 'moderate':
      return 'warning';
    case 'suggestion':
    case 'low':
    case 'info':
      return 'suggestion';
    default:
      return undefined;
  }
}

function parseLine(raw: string | undefined): number | undefined {
  if (!raw || !/^[1-9]\d*$/.test(raw.trim())) return undefined;
  return Number(raw.trim());
}

function firstEvidenceItem(inner: string): { path?: string; line?: string } | undefined {
  const itemMatch = inner.match(/<item\b([^>]*)>/);
  if (!itemMatch) return undefined;
  return { path: attr(itemMatch[1] ?? '', 'path'), line: attr(itemMatch[1] ?? '', 'line') };
}

function buildDescription(inner: string): string {
  const parts = [
    child(inner, 'title'),
    child(inner, 'description'),
    child(inner, 'details'),
    child(inner, 'impact'),
  ].filter((part): part is string => Boolean(part));

  if (parts.length > 0) return parts.join('\n\n');
  return normalizeText(inner.replace(/<fix>[\s\S]*?<\/fix>/g, '').replace(/<recommendation>[\s\S]*?<\/recommendation>/g, ''));
}

function normalizeText(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
// --- eforge:endregion reviewer-late-output-salvage ---
