import type { BacklogItem, TraceSummary } from './backlog-domain.js';
import { DEFAULT_ITEM_AUDIT_CONCURRENCY, MAX_ITEM_AUDIT_CONCURRENCY } from './backlog-curation-schemas.js';

export type SourceFirstAuditIntent = 'source-shipped' | 'source-superseded' | 'partial' | 'not-found' | 'no-change' | 'skipped' | 'recheck-note';
export type SourceFirstAuditConfidence = 'strong' | 'ambiguous' | 'weak';

export interface SourceFirstCitation {
  kind: 'implementation' | 'product-surface' | 'supporting';
  source: string;
  confidence: SourceFirstAuditConfidence;
  path?: string;
  excerpt?: string;
  matchedBy?: string[];
}

export interface SourceFirstHistoricalHint {
  source: string;
  intent?: string;
  confidence?: string;
  citation?: string;
  evidence?: string;
  path?: string;
  closureAuthority: false;
}

export interface SourceFirstAuditDiagnostic {
  code: string;
  severity: 'info' | 'warning';
  message?: string;
  path?: string;
}

export interface SourceFirstAuditResult {
  itemId: string;
  intent: SourceFirstAuditIntent;
  confidence: SourceFirstAuditConfidence;
  citations: SourceFirstCitation[];
  historicalHints: SourceFirstHistoricalHint[];
  diagnostics: SourceFirstAuditDiagnostic[];
  rationale: string;
}

export interface SourceFirstCurrentEvidenceInput {
  source: string;
  confidence: SourceFirstAuditConfidence;
  matchedBy?: string[];
  path?: string;
  excerpt?: string;
}

export interface SourceFirstAuditItemInput {
  item: BacklogItem;
  currentEvidence: SourceFirstCurrentEvidenceInput[];
  historicalHints?: SourceFirstHistoricalHint[];
  traceSummary?: TraceSummary;
}

export interface SourceFirstAuditSettings {
  itemAuditConcurrency: number;
  maxItemAuditConcurrency: number;
  closureAuthority: 'current-source-only';
}

export function normalizeItemAuditConcurrency(value: unknown): number {
  return Number.isInteger(value) && typeof value === 'number' && value > 0 ? Math.min(value, MAX_ITEM_AUDIT_CONCURRENCY) : DEFAULT_ITEM_AUDIT_CONCURRENCY;
}

export async function runBoundedWorkerPool<T, R>(items: readonly T[], concurrencyInput: unknown, worker: (item: T, index: number) => Promise<R>, signal?: AbortSignal): Promise<R[]> {
  const concurrency = normalizeItemAuditConcurrency(concurrencyInput);
  const results = new Array<R>(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      throwIfAborted(signal);
      const index = next++;
      results[index] = await worker(items[index]!, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

export async function collectSourceFirstAuditResults(input: { items: readonly SourceFirstAuditItemInput[]; itemAuditConcurrency?: number; signal?: AbortSignal }): Promise<SourceFirstAuditResult[]> {
  return await runBoundedWorkerPool(input.items, input.itemAuditConcurrency, async (entry) => {
    try {
      return classifySourceFirstAuditItem(entry);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { itemId: entry.item.id, intent: 'recheck-note', confidence: 'weak', citations: [], historicalHints: entry.historicalHints ?? [], diagnostics: [{ code: 'source-first-item-audit-failed', severity: 'warning', message }], rationale: 'Per-item source-first audit failed; keep the item open and record a recheck note instead of asking a top-level planning question.' };
    }
  }, input.signal);
}

export function classifySourceFirstAuditItem(input: SourceFirstAuditItemInput): SourceFirstAuditResult {
  const diagnostics: SourceFirstAuditDiagnostic[] = [];
  if (!hasAcceptanceCriteria(input.item)) diagnostics.push({ code: 'acceptance-criteria-missing', severity: 'info', message: 'Item lacks explicit acceptance criteria; audit is oriented from the item claim/title without widening source context.' });
  const current = input.currentEvidence.map(projectCitation).filter((citation) => citation.excerpt !== undefined || citation.path !== undefined);
  const productSurface = current.filter((citation) => citation.kind === 'product-surface');
  const implementation = [...current.filter((citation) => citation.kind === 'implementation'), ...productSurface.filter(hasImplementationSignal)];
  const testOrDocsOnly = current.length > 0 && implementation.length === 0 && productSurface.length === 0;
  if (implementation.some(isStrong) && productSurface.some(isStrong)) {
    const intent: SourceFirstAuditIntent = looksSuperseded(input.item, current) ? 'source-superseded' : 'source-shipped';
    return { itemId: input.item.id, intent, confidence: 'strong', citations: compactCitations([...implementation.filter(isStrong).slice(0, 1), ...productSurface.filter(isStrong).slice(0, 1), ...current.filter((citation) => citation.kind === 'supporting').slice(0, 2)]), historicalHints: input.historicalHints ?? [], diagnostics, rationale: `${intent === 'source-shipped' ? 'Current source contains implementation' : 'Current source contains replacement/supersession evidence'} and product-surface wiring citations; historical signals are navigation-only.` };
  }
  if (current.length > 0) {
    return { itemId: input.item.id, intent: testOrDocsOnly ? 'recheck-note' : 'partial', confidence: strongestConfidence(current), citations: compactCitations(current), historicalHints: input.historicalHints ?? [], diagnostics, rationale: testOrDocsOnly ? 'Only tests/docs/supporting current-source evidence was found; keep open and recheck.' : 'Current-source evidence exists but does not include both core implementation and product-surface wiring.' };
  }
  if ((input.historicalHints ?? []).length > 0) {
    return { itemId: input.item.id, intent: 'not-found', confidence: 'weak', citations: [], historicalHints: input.historicalHints ?? [], diagnostics, rationale: 'Historical or lifecycle signals exist, but no matching current-source closure citations were found.' };
  }
  return { itemId: input.item.id, intent: isReviewStale(input.item) ? 'recheck-note' : 'no-change', confidence: 'weak', citations: [], historicalHints: [], diagnostics, rationale: isReviewStale(input.item) ? 'No current-source evidence was found and freshness metadata suggests a recheck note may be appropriate.' : 'No bounded current-source evidence or historical navigation hint matched this item.' };
}

export function projectSourceFirstResultsForFingerprint(results: readonly SourceFirstAuditResult[]): Array<Record<string, unknown>> {
  return results.map((result) => ({ itemId: result.itemId, intent: result.intent, confidence: result.confidence, citations: result.citations.map((citation) => ({ kind: citation.kind, source: citation.source, path: citation.path, excerpt: citation.excerpt })), historicalHints: result.historicalHints.map((hint) => ({ source: hint.source, intent: hint.intent, confidence: hint.confidence, citation: hint.citation, path: hint.path })), diagnostics: result.diagnostics.map((diagnostic) => ({ code: diagnostic.code, severity: diagnostic.severity, path: diagnostic.path })) }));
}

export function projectSourceFirstClosureCandidates(results: readonly SourceFirstAuditResult[]): Array<Record<string, unknown>> {
  return results.filter((result) => result.intent === 'source-shipped' || result.intent === 'source-superseded').map((result) => ({ itemId: result.itemId, intent: result.intent === 'source-shipped' ? 'shipped' : 'superseded', confidence: result.confidence, source: 'current-source', evidenceSource: 'current-source', citations: result.citations, evidenceRoles: closureEvidenceRoles(result), evidence: `${result.intent === 'source-shipped' ? 'Shipped' : 'Superseded'} evidence: current source — ${citationLabel(result.citations)}` }));
}

function closureEvidenceRoles(result: SourceFirstAuditResult): string[] {
  const roles = new Set<string>();
  const implementationRole = result.intent === 'source-superseded' ? 'replacement' : 'implementation';
  if (result.citations.some((citation) => citation.kind === 'implementation' || (citation.kind === 'product-surface' && hasImplementationSignal(citation)))) roles.add(implementationRole);
  if (result.citations.some((citation) => citation.kind === 'product-surface')) roles.add('product-surface');
  return [...roles];
}

export function sourceFirstAuditSettings(itemAuditConcurrency?: number): SourceFirstAuditSettings {
  return { itemAuditConcurrency: normalizeItemAuditConcurrency(itemAuditConcurrency), maxItemAuditConcurrency: MAX_ITEM_AUDIT_CONCURRENCY, closureAuthority: 'current-source-only' };
}

function projectCitation(evidence: SourceFirstCurrentEvidenceInput): SourceFirstCitation {
  return { kind: citationKind(evidence), source: evidence.source, confidence: evidence.confidence, ...(evidence.path !== undefined && { path: evidence.path }), ...(evidence.excerpt !== undefined && { excerpt: evidence.excerpt }), ...(evidence.matchedBy !== undefined && { matchedBy: evidence.matchedBy }) };
}

function citationKind(evidence: SourceFirstCurrentEvidenceInput): SourceFirstCitation['kind'] {
  const text = `${evidence.path ?? ''}\n${evidence.excerpt ?? ''}`.toLowerCase();
  if (/(__tests__|\btests?\b|\.test\.|\.spec\.|\bdocs?\b|\.mdx?$)/.test(text)) return 'supporting';
  if (/(export\s+\{|export\s+(class|function|const|default)|defineextensionaction|register|registry|route|router|command|provider|entrypoint|main"|bin")/.test(text)) return 'product-surface';
  return 'implementation';
}

function hasImplementationSignal(citation: SourceFirstCitation): boolean {
  const text = `${citation.path ?? ''}\n${citation.excerpt ?? ''}`.toLowerCase();
  return /\b(class|function|implements?|implementation|handler|service|controller|provider)\b|=>|\bnew\s+[a-z_$]/i.test(text);
}

function looksSuperseded(item: BacklogItem, citations: readonly SourceFirstCitation[]): boolean {
  const text = `${item.title}\n${item.body}\n${item.tags.join(' ')}\n${citations.map((citation) => `${citation.path ?? ''}\n${citation.excerpt ?? ''}`).join('\n')}`.toLowerCase();
  return /superseded|obsolete|replaced by|replacement|deprecated/.test(text);
}

function compactCitations(citations: readonly SourceFirstCitation[]): SourceFirstCitation[] {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    const key = `${citation.kind}:${citation.path ?? ''}:${citation.excerpt ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 4);
}

function strongestConfidence(citations: readonly SourceFirstCitation[]): SourceFirstAuditConfidence {
  return citations.some((citation) => citation.confidence === 'strong') ? 'strong' : citations.some((citation) => citation.confidence === 'ambiguous') ? 'ambiguous' : 'weak';
}

function isStrong(citation: SourceFirstCitation): boolean {
  return citation.confidence === 'strong';
}

function hasAcceptanceCriteria(item: BacklogItem): boolean {
  return /(^|\n)#{2,6}\s+Acceptance Criteria\b/i.test(item.body) || /\bacceptance criteria\b/i.test(item.body);
}

function isReviewStale(item: BacklogItem): boolean {
  return typeof item.stale_after === 'string' && item.stale_after.length > 0 && item.stale_after < new Date().toISOString().slice(0, 10);
}

function citationLabel(citations: readonly SourceFirstCitation[]): string {
  const first = citations.find((citation) => citation.path !== undefined || citation.excerpt !== undefined);
  if (first === undefined) return 'bounded current-source citations.';
  return `${first.path ?? first.source}${first.excerpt !== undefined ? ` (${first.excerpt.slice(0, 120)})` : ''}`;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error('Backlog curation source-first item audit was aborted.');
}
