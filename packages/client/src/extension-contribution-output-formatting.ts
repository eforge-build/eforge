import type { ExtensionActionOutputProfile } from './extension-contributions.js';
import type {
  ExtensionHostContributionDetailResponse,
  ExtensionHostContributionEntry,
  ExtensionHostContributionFailedInvocationEnvelope,
  ExtensionHostContributionListResponse,
} from './api/extension-contribution-dispatch.js';

const DEFAULT_MAX_CHARS = 12_000;
const DEFAULT_ARRAY_ITEMS = 5;
const FINAL_CAP_HEADROOM = 160;

const IDENTITY_KEYS = new Set(['id', 'itemId', 'epicId', 'title', 'name', 'status', 'state', 'kind', 'lane']);
const CONTINUATION_KEYS = new Set([
  'count',
  'total',
  'totalCount',
  'openCount',
  'closedCount',
  'limit',
  'offset',
  'page',
  'pageSize',
  'nextOffset',
  'cursor',
  'nextCursor',
  'hasMore',
  'hasNextPage',
]);

export type ExtensionContributionFormattedOutputKind = 'markdown' | 'json' | 'json-summary' | 'text';

export interface FormatExtensionContributionOutputOptions {
  maxChars?: number;
  outputProfile?: ExtensionActionOutputProfile;
  arrayItems?: number;
}

export interface FormattedExtensionContributionOutput {
  kind: ExtensionContributionFormattedOutputKind;
  text: string;
  warnings: string[];
  truncated: boolean;
  rawLength: number;
}

interface SummaryContext {
  arrayItems: number;
  depth: number;
}

export function formatExtensionContributionOutput(
  output: unknown,
  options: FormatExtensionContributionOutputOptions = {},
): FormattedExtensionContributionOutput {
  const maxChars = Math.max(400, options.maxChars ?? DEFAULT_MAX_CHARS);
  const warnings = profileWarnings(options.outputProfile);
  const markdown = exactMarkdownOutput(output);
  if (markdown !== undefined) return formatMarkdownOutput(markdown, warnings, maxChars);

  const rawText = stringifyJson(output);
  if (rawText.length <= budgetAfterWarnings(maxChars, warnings)) {
    const capped = capText(withWarnings(rawText, warnings), maxChars);
    return {
      kind: 'json',
      text: capped.text,
      warnings,
      truncated: capped.truncated,
      rawLength: rawText.length,
    };
  }

  const oversizedWarning = `Warning: extension action output was ${rawText.length.toLocaleString()} characters; showing a semantic summary instead of the full payload.`;
  const summaryWarnings = [...warnings, oversizedWarning, continuationHint(output)];
  const summary = summarizeJsonValue(output, { arrayItems: options.arrayItems ?? DEFAULT_ARRAY_ITEMS, depth: 0 });
  const summaryText = stringifyJson(summary);
  const capped = capText(withWarnings(summaryText, summaryWarnings), maxChars);
  return {
    kind: 'json-summary',
    text: capped.text,
    warnings: summaryWarnings,
    truncated: capped.truncated,
    rawLength: rawText.length,
  };
}

export function formatExtensionContributionOutputText(
  output: unknown,
  options: FormatExtensionContributionOutputOptions = {},
): string {
  return formatExtensionContributionOutput(output, options).text;
}

export interface FormatExtensionContributionHostTextOptions {
  maxChars?: number;
}

export function formatExtensionContributionList(
  response: ExtensionHostContributionListResponse,
  options: FormatExtensionContributionHostTextOptions = {},
): FormattedExtensionContributionOutput {
  return formatHostText(renderContributionList(response), options.maxChars);
}

export function formatExtensionContributionListText(
  response: ExtensionHostContributionListResponse,
  options: FormatExtensionContributionHostTextOptions = {},
): string {
  return formatExtensionContributionList(response, options).text;
}

export function formatExtensionContributionDetail(
  response: ExtensionHostContributionDetailResponse,
  options: FormatExtensionContributionHostTextOptions = {},
): FormattedExtensionContributionOutput {
  return formatHostText(renderContributionDetail(response), options.maxChars);
}

export function formatExtensionContributionDetailText(
  response: ExtensionHostContributionDetailResponse,
  options: FormatExtensionContributionHostTextOptions = {},
): string {
  return formatExtensionContributionDetail(response, options).text;
}

export function formatExtensionContributionFailedInvocationEnvelope(
  envelope: ExtensionHostContributionFailedInvocationEnvelope,
  options: FormatExtensionContributionHostTextOptions = {},
): FormattedExtensionContributionOutput {
  return formatHostText(renderFailureEnvelope(envelope), options.maxChars);
}

export function formatExtensionContributionFailedInvocationEnvelopeText(
  envelope: ExtensionHostContributionFailedInvocationEnvelope,
  options: FormatExtensionContributionHostTextOptions = {},
): string {
  return formatExtensionContributionFailedInvocationEnvelope(envelope, options).text;
}

function renderContributionList(response: ExtensionHostContributionListResponse): string {
  const header = [
    `Extension contributions: ${response.returned} returned of ${response.total} total`,
    `Generated: ${response.generatedAt}`,
    `Diagnostics: ${response.diagnosticCount}${response.diagnostics ? ' included' : ' hidden'}`,
    `Page: offset ${response.offset}${response.limit !== undefined ? `, limit ${response.limit}` : ''}${response.hasMore ? `, nextOffset ${response.nextOffset}` : ', complete'}`,
  ];
  const entries = response.entries.map((entry) => `- ${renderContributionEntrySummary(entry)}`);
  const diagnostics = response.diagnostics?.map((diagnostic) => `  - ${diagnostic.severity}: ${diagnostic.code}: ${diagnostic.message}`) ?? [];
  return [...header, ...entries, ...(diagnostics.length > 0 ? ['Diagnostics detail:', ...diagnostics] : [])].join('\n');
}

function renderContributionDetail(response: ExtensionHostContributionDetailResponse): string {
  const entry = response.entry;
  const lines = [
    `Extension contribution: ${entry.kind}:${entry.id}`,
    `Generated: ${response.generatedAt}`,
    renderContributionEntrySummary(entry),
    `Extension path: ${entry.extensionPath}`,
    `Input: ${renderInputMetadata(entry)}`,
    `Diagnostics: ${response.diagnosticCount}${response.diagnostics ? ' included' : ' hidden'}`,
  ];
  if (entry.description) lines.push(`Description: ${entry.description}`);
  if (entry.inputSchema) lines.push('Input schema:', fencedJson(entry.inputSchema));
  if (entry.inputDefaults) lines.push('Input defaults:', fencedJson(entry.inputDefaults));
  if (entry.availability?.available === false) lines.push(`Unavailable: ${entry.availability.message ?? 'no message'}`);
  if (response.diagnostics) lines.push('Diagnostics detail:', fencedJson(response.diagnostics));
  return lines.join('\n');
}

function renderFailureEnvelope(envelope: ExtensionHostContributionFailedInvocationEnvelope): string {
  return [
    'Extension contribution invocation failed',
    `Invocation: ${envelope.invocationId}`,
    `Target: ${envelope.target.kind}:${envelope.target.id} (action ${envelope.target.actionId})`,
    `Extension: ${envelope.target.extensionName}`,
    `Requested by: ${envelope.requestedBy.host}`,
    `Error: ${envelope.error.code}: ${envelope.error.message}`,
    `Input summary: ${renderFailureInputSummary(envelope.inputSummary)}`,
  ].join('\n');
}

// --- eforge:region plan-01-shared-contribution-projection ---
function renderFailureInputSummary(inputSummary: ExtensionHostContributionFailedInvocationEnvelope['inputSummary']): string {
  const details = [
    `${inputSummary.inputKeyCount} keys [${inputSummary.inputKeys.join(', ')}]`,
    `serialized size ${inputSummary.serializedInputSize} chars`,
    inputSummary.omittedInputKeyCount ? `${inputSummary.omittedInputKeyCount} omitted keys` : undefined,
    inputSummary.truncatedInputKeyCount ? `${inputSummary.truncatedInputKeyCount} truncated keys` : undefined,
  ];
  return details.filter((detail): detail is string => detail !== undefined).join(', ');
}
// --- eforge:endregion plan-01-shared-contribution-projection ---

function renderContributionEntrySummary(entry: ExtensionHostContributionEntry): string {
  return [
    `${entry.kind}:${entry.id}`,
    `— ${entry.label}`,
    `[${entry.extensionName}]`,
    entry.actionId ? `action=${entry.actionId}` : 'action=none',
    entry.urlTemplate ? `url=${entry.urlTemplate}` : undefined,
    `actionBacked=${entry.actionBacked}`,
    entry.outputProfile ? `output=${entry.outputProfile}` : undefined,
    entry.sideEffects?.length ? `sideEffects=${entry.sideEffects.join(',')}` : undefined,
    entry.availability?.available === false ? `unavailable=${entry.availability.message ?? 'true'}` : undefined,
    `input=${renderInputMetadata(entry)}`,
  ].filter((part): part is string => Boolean(part)).join(' ');
}

function renderInputMetadata(entry: ExtensionHostContributionEntry): string {
  const parts = [
    entry.hasInputSchema ? 'schema=yes' : 'schema=no',
    (entry.requiredInputKeys ?? []).length > 0 ? `required=${entry.requiredInputKeys?.join(',')}` : 'required=none',
    (entry.conditionalRequiredInputAlternatives ?? []).length > 0 ? `conditionalRequired=${entry.conditionalRequiredInputAlternatives?.map((fields) => fields.join(',')).join('|')}` : undefined,
    (entry.inputPropertyKeys ?? []).length > 0 ? `properties=${entry.inputPropertyKeys?.join(',')}` : 'properties=none',
    (entry.inputDefaultKeys ?? []).length > 0 ? `defaults=${entry.inputDefaultKeys?.join(',')}` : 'defaults=none',
  ];
  return parts.filter((part): part is string => Boolean(part)).join('; ');
}

function formatHostText(text: string, maxChars = DEFAULT_MAX_CHARS): FormattedExtensionContributionOutput {
  const capped = capText(text, Math.max(400, maxChars));
  return { kind: 'text', text: capped.text, warnings: [], truncated: capped.truncated, rawLength: text.length };
}

function fencedJson(value: unknown): string {
  return `\`\`\`json\n${stringifyJson(value)}\n\`\`\``;
}

function formatMarkdownOutput(markdown: string, warnings: string[], maxChars: number): FormattedExtensionContributionOutput {
  const rawLength = markdown.length;
  const text = withWarnings(markdown, warnings);
  if (text.length <= maxChars) {
    return { kind: 'markdown', text, warnings, truncated: false, rawLength };
  }
  const truncatedWarning = `Warning: markdown output was ${rawLength.toLocaleString()} characters and was truncated for this host. Re-run the action with narrower input or use a raw JSON/HTTP surface for the full value.`;
  const capped = capText(withWarnings(markdown, [...warnings, truncatedWarning]), maxChars);
  return { kind: 'markdown', text: capped.text, warnings: [...warnings, truncatedWarning], truncated: true, rawLength };
}

function profileWarnings(profile: ExtensionActionOutputProfile | undefined): string[] {
  if (profile === 'ui-rich') {
    return ['Warning: this action declares outputProfile "ui-rich"; host previews may summarize UI-oriented payloads. Prefer agent-compact or agent-paginated actions for coding-agent reads.'];
  }
  if (profile === 'debug-rich') {
    return ['Warning: this action declares outputProfile "debug-rich"; host previews may summarize large compatibility/debug payloads. Prefer compact or paginated reads for agents.'];
  }
  return [];
}

function budgetAfterWarnings(maxChars: number, warnings: string[]): number {
  return Math.max(400, maxChars - warnings.join('\n').length - FINAL_CAP_HEADROOM);
}

function withWarnings(text: string, warnings: string[]): string {
  return warnings.length === 0 ? text : `${warnings.join('\n')}\n\n${text}`;
}

function capText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  const suffix = '\n…\nWarning: preview reached the final host character budget; use a narrower query, limit/offset, cursor, or raw JSON mode for the complete output.';
  return { text: `${text.slice(0, Math.max(0, maxChars - suffix.length))}${suffix}`, truncated: true };
}

function exactMarkdownOutput(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.markdown !== 'string') return undefined;
  return Object.keys(value).length === 1 ? value.markdown : undefined;
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? 'null';
}

function summarizeJsonValue(value: unknown, ctx: SummaryContext): unknown {
  if (Array.isArray(value)) return summarizeArray(value, ctx);
  if (isRecord(value)) return summarizeObject(value, ctx);
  return summarizePrimitive(value);
}

function summarizeArray(values: unknown[], ctx: SummaryContext): unknown {
  const items = values.slice(0, ctx.arrayItems).map((item) => summarizeArrayItem(item, nextContext(ctx)));
  const omitted = Math.max(0, values.length - items.length);
  return omitted > 0 ? { count: values.length, items, omitted } : { count: values.length, items };
}

function summarizeArrayItem(value: unknown, ctx: SummaryContext): unknown {
  if (!isRecord(value)) return summarizeJsonValue(value, ctx);
  const identity = pickObjectFields(value, (key) => IDENTITY_KEYS.has(key) || CONTINUATION_KEYS.has(key));
  const primitives = pickFirstPrimitiveFields(value, identity, 3);
  const nestedCounts = summarizeNestedCollectionCounts(value, identity, primitives);
  return { ...identity, ...primitives, ...nestedCounts };
}

function summarizeObject(value: Record<string, unknown>, ctx: SummaryContext): unknown {
  if (ctx.depth >= 3) return summarizeDeepObject(value);
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = summarizeObjectProperty(key, child, nextContext(ctx));
  }
  return result;
}

function summarizeObjectProperty(key: string, value: unknown, ctx: SummaryContext): unknown {
  if (Array.isArray(value)) return summarizeArray(value, ctx);
  if (isRecord(value)) {
    if (IDENTITY_KEYS.has(key) || CONTINUATION_KEYS.has(key)) return summarizeJsonValue(value, ctx);
    return summarizeObject(value, ctx);
  }
  return summarizePrimitive(value);
}

function summarizeDeepObject(value: Record<string, unknown>): unknown {
  const identity = pickObjectFields(value, (key) => IDENTITY_KEYS.has(key) || CONTINUATION_KEYS.has(key));
  const primitives = pickFirstPrimitiveFields(value, identity, 5);
  const nestedCounts = summarizeNestedCollectionCounts(value, identity, primitives);
  return { ...identity, ...primitives, ...nestedCounts };
}

function summarizeNestedCollectionCounts(
  value: Record<string, unknown>,
  ...existing: Record<string, unknown>[]
): Record<string, unknown> {
  const used = new Set(existing.flatMap((entry) => Object.keys(entry)));
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (used.has(key)) continue;
    if (Array.isArray(child)) result[key] = { count: child.length, omitted: child.length };
    if (isRecord(child)) result[key] = { keys: Object.keys(child).length, omittedKeys: Object.keys(child).length };
  }
  return result;
}

function pickObjectFields(value: Record<string, unknown>, predicate: (key: string) => boolean): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (predicate(key)) result[key] = summarizePrimitive(child);
  }
  return result;
}

function pickFirstPrimitiveFields(
  value: Record<string, unknown>,
  existing: Record<string, unknown>,
  limit: number,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (Object.prototype.hasOwnProperty.call(existing, key) || !isPrimitive(child) || isLongString(child)) continue;
    result[key] = summarizePrimitive(child);
    if (Object.keys(result).length >= limit) break;
  }
  return result;
}

function summarizePrimitive(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (value.length <= 240) return value;
  return `${value.slice(0, 220)}… (${value.length.toLocaleString()} chars)`;
}

function continuationHint(output: unknown): string {
  const hints = findContinuationHints(output);
  if (hints.length === 0) return 'Hint: use narrower filters, limit/offset, or cursor inputs when the action supports them; use CLI --json or daemon HTTP only when you intentionally need the raw payload.';
  return `Hint: continuation fields preserved: ${hints.slice(0, 8).join(', ')}. Use those limit/offset/cursor values to continue with a smaller read.`;
}

function findContinuationHints(value: unknown, path = '', found = new Set<string>()): string[] {
  if (found.size >= 12 || value === null || typeof value !== 'object') return [...found];
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 3)) findContinuationHints(item, path, found);
    return [...found];
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = path ? `${path}.${key}` : key;
    if (CONTINUATION_KEYS.has(key)) found.add(childPath);
    if (child !== null && typeof child === 'object') findContinuationHints(child, childPath, found);
    if (found.size >= 12) break;
  }
  return [...found];
}

function nextContext(ctx: SummaryContext): SummaryContext {
  return { ...ctx, depth: ctx.depth + 1 };
}

function isPrimitive(value: unknown): boolean {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function isLongString(value: unknown): boolean {
  return typeof value === 'string' && value.length > 120;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
