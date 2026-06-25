export const HOST_OUTPUT_CHAR_BUDGET = 12_000;
export const HOST_OUTPUT_FINAL_CAP_HEADROOM = 160;
export const HOST_OUTPUT_GUIDANCE = 'Use a narrower query, limit/offset, cursor, or explicit raw CLI/HTTP JSON inspection when you intentionally need the complete output.';

const DEFAULT_ARRAY_ITEMS = 5;
const MAX_STRING_SUMMARY_CHARS = 600;
const MAX_ERROR_STACK_CHARS = 1_200;
const MAX_SUMMARY_DEPTH = 3;

export type HostOutputKind = 'json' | 'json-summary' | 'text' | 'error';

export interface HostOutputMetadata {
  budget: number;
  rawLength: number;
  truncated: boolean;
  summarized: boolean;
  guidance?: string;
}

export interface HostOutputRenderOptions {
  maxChars?: number;
  arrayItems?: number;
}

export interface HostOutputRenderResult {
  kind: HostOutputKind;
  text: string;
  rawLength: number;
  truncated: boolean;
  summarized: boolean;
  warnings: string[];
  metadata: HostOutputMetadata;
}

interface SummaryContext {
  arrayItems: number;
  depth: number;
}

export function renderHostOutput(value: unknown, options: HostOutputRenderOptions = {}): HostOutputRenderResult {
  const maxChars = normalizeBudget(options.maxChars);
  if (value instanceof Error) return renderErrorHostOutput(value, maxChars);
  if (typeof value === 'string') return renderStringHostOutput(value, maxChars);
  return renderJsonHostOutput(value, { arrayItems: options.arrayItems ?? DEFAULT_ARRAY_ITEMS, depth: 0 }, maxChars);
}

export function renderHostOutputText(value: unknown, options: HostOutputRenderOptions = {}): string {
  return renderHostOutput(value, options).text;
}

export interface HostOutputCapResult {
  text: string;
  truncated: boolean;
}

export function capHostOutputText(text: string, maxChars = HOST_OUTPUT_CHAR_BUDGET): HostOutputCapResult {
  const budget = normalizeBudget(maxChars);
  if (text.length <= budget) return { text, truncated: false };
  const suffix = `\n…\nWarning: preview reached the final host character budget; ${HOST_OUTPUT_GUIDANCE}`;
  return { text: `${text.slice(0, Math.max(0, budget - suffix.length))}${suffix}`, truncated: true };
}

export interface NormalizedHostError {
  name: string;
  message: string;
  stack?: string;
  cause?: unknown;
}

export function normalizeHostOutputError(error: unknown, options: { summarize?: boolean } = {}): NormalizedHostError {
  return normalizeHostOutputErrorWithSeen(error, options, new WeakSet<Error>());
}

export function hostOutputMetadataDetail(result: Pick<HostOutputRenderResult, 'metadata' | 'warnings' | 'kind'>): Record<string, unknown> {
  return {
    kind: result.kind,
    hostOutput: result.metadata,
    warnings: result.warnings,
  };
}

export function createHostOutputMetadata(result: Pick<HostOutputRenderResult, 'rawLength' | 'truncated' | 'summarized'>, maxChars = HOST_OUTPUT_CHAR_BUDGET): HostOutputMetadata {
  return {
    budget: normalizeBudget(maxChars),
    rawLength: result.rawLength,
    truncated: result.truncated,
    summarized: result.summarized,
    ...((result.truncated || result.summarized) && { guidance: HOST_OUTPUT_GUIDANCE }),
  };
}

function renderStringHostOutput(value: string, maxChars: number): HostOutputRenderResult {
  if (value.length <= maxChars) return buildResult('text', value, value.length, false, false, [], maxChars);
  const warning = `Warning: host output string was ${value.length.toLocaleString()} characters and was truncated for this host.`;
  const capped = capHostOutputText(`${warning}\n${HOST_OUTPUT_GUIDANCE}\n\n${summarizeString(value, Math.max(400, maxChars - 400))}`, maxChars);
  return buildResult('text', capped.text, value.length, capped.truncated || value.length > capped.text.length, false, [warning], maxChars);
}

function renderErrorHostOutput(error: Error, maxChars: number): HostOutputRenderResult {
  const rawText = safeStringifyJson(normalizeHostOutputError(error, { summarize: false }));
  const normalized = normalizeHostOutputError(error);
  const normalizedText = safeStringifyJson(normalized);
  const normalizedShortened = normalizedText !== rawText;
  if (rawText.length <= maxChars && !normalizedShortened) return buildResult('error', rawText, rawText.length, false, false, [], maxChars);
  const warning = `Warning: Error output was ${rawText.length.toLocaleString()} characters; showing a bounded normalized error summary.`;
  const summary = {
    warning,
    rawLength: rawText.length,
    summarized: true,
    guidance: HOST_OUTPUT_GUIDANCE,
    error: { ...normalized, stack: normalized.stack ? summarizeString(normalized.stack, 600) : undefined },
  };
  const capped = capHostOutputText(safeStringifyJson(summary), maxChars);
  return buildResult('error', capped.text, rawText.length, capped.truncated || normalizedShortened, true, [warning], maxChars);
}

function renderJsonHostOutput(value: unknown, ctx: SummaryContext, maxChars: number): HostOutputRenderResult {
  const raw = tryStringifyJson(value);
  if (raw.error) return renderJsonSerializationErrorHostOutput(value, raw.error, maxChars);
  const rawText = raw.text;
  if (rawText.length <= maxChars) return buildResult('json', rawText, rawText.length, false, false, [], maxChars);
  const warning = `Warning: JSON output was ${rawText.length.toLocaleString()} characters; showing a summarized host projection instead of the full payload.`;
  const summary = {
    warning,
    rawLength: rawText.length,
    summarized: true,
    guidance: HOST_OUTPUT_GUIDANCE,
    summary: summarizeHostValue(value, ctx),
  };
  const capped = capHostOutputText(safeStringifyJson(summary), maxChars);
  return buildResult('json-summary', capped.text, rawText.length, capped.truncated, true, [warning], maxChars);
}

function buildResult(
  kind: HostOutputKind,
  text: string,
  rawLength: number,
  truncated: boolean,
  summarized: boolean,
  warnings: string[],
  maxChars: number,
): HostOutputRenderResult {
  const metadata = createHostOutputMetadata({ rawLength, truncated, summarized }, maxChars);
  return { kind, text, rawLength, truncated, summarized, warnings, metadata };
}

function summarizeHostValue(value: unknown, ctx: SummaryContext): unknown {
  if (value instanceof Error) return normalizeHostOutputError(value);
  if (typeof value === 'string') return summarizeString(value, MAX_STRING_SUMMARY_CHARS);
  if (Array.isArray(value)) return summarizeArray(value, ctx);
  if (isRecord(value)) return summarizeObject(value, ctx);
  return value;
}

function summarizeArray(values: unknown[], ctx: SummaryContext): unknown {
  if (ctx.depth >= MAX_SUMMARY_DEPTH) return { count: values.length, omitted: values.length };
  const items = values.slice(0, ctx.arrayItems).map((item) => summarizeHostValue(item, nextContext(ctx)));
  const omitted = Math.max(0, values.length - items.length);
  return omitted > 0 ? { count: values.length, items, omitted } : { count: values.length, items };
}

function summarizeObject(value: Record<string, unknown>, ctx: SummaryContext): unknown {
  try {
    if (ctx.depth >= MAX_SUMMARY_DEPTH) return summarizeDeepObject(value);
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) result[key] = summarizeHostValue(child, nextContext(ctx));
    return result;
  } catch (error) {
    return { valueType: describeHostValue(value), summaryError: error instanceof Error ? error.message : String(error) };
  }
}

function summarizeDeepObject(value: Record<string, unknown>): unknown {
  const primitiveEntries: Record<string, unknown> = {};
  const collectionEntries: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (Object.keys(primitiveEntries).length < 8 && isPrimitive(child)) primitiveEntries[key] = summarizeHostValue(child, { arrayItems: 2, depth: 0 });
    if (Array.isArray(child)) collectionEntries[key] = { count: child.length, omitted: child.length };
    if (isRecord(child)) collectionEntries[key] = { keys: Object.keys(child).length, omittedKeys: Object.keys(child).length };
  }
  return { ...primitiveEntries, ...collectionEntries };
}

function summarizeString(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const suffix = `… (${value.length.toLocaleString()} chars total; truncated)`;
  return `${value.slice(0, Math.max(0, maxChars - suffix.length))}${suffix}`;
}

function safeStringifyJson(value: unknown): string {
  return tryStringifyJson(value).text;
}

function tryStringifyJson(value: unknown): { text: string; error?: Error } {
  const ancestors: object[] = [];
  try {
    return {
      text: JSON.stringify(value, function (this: object, _key, child) {
        if (typeof child === 'bigint') return child.toString();
        if (child instanceof Error) return normalizeHostOutputError(child);
        if (child && typeof child === 'object') {
          while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) ancestors.pop();
          if (ancestors.includes(child)) return '[Circular]';
          ancestors.push(child);
        }
        return child;
      }, 2) ?? 'null',
    };
  } catch (error) {
    const serializationError = error instanceof Error ? error : new Error(String(error));
    return {
      text: JSON.stringify({
        warning: 'Warning: host output could not be serialized as JSON; showing a bounded fallback summary.',
        serializationError: serializationError.message,
        guidance: HOST_OUTPUT_GUIDANCE,
        valueType: describeHostValue(value),
      }, null, 2) ?? 'null',
      error: serializationError,
    };
  }
}

function renderJsonSerializationErrorHostOutput(value: unknown, error: Error, maxChars: number): HostOutputRenderResult {
  const warning = `Warning: host output could not be serialized as JSON: ${error.message}`;
  const text = safeStringifyJson({
    warning,
    summarized: true,
    guidance: HOST_OUTPUT_GUIDANCE,
    serializationError: error.message,
    valueType: describeHostValue(value),
  });
  const capped = capHostOutputText(text, maxChars);
  return buildResult('json-summary', capped.text, capped.truncated ? maxChars + 1 : text.length, capped.truncated, true, [warning], maxChars);
}

function normalizeHostOutputErrorWithSeen(error: unknown, options: { summarize?: boolean }, seen: WeakSet<Error>): NormalizedHostError {
  const summarize = options.summarize ?? true;
  if (error instanceof Error) {
    if (seen.has(error)) return { name: error.name || 'Error', message: '[Circular Error cause]' };
    seen.add(error);
    try {
      const normalized: NormalizedHostError = {
        name: error.name || 'Error',
        message: error.message,
      };
      if (error.stack) normalized.stack = summarize ? summarizeString(error.stack, MAX_ERROR_STACK_CHARS) : error.stack;
      if ('cause' in error) normalized.cause = normalizeErrorCause((error as Error & { cause?: unknown }).cause, summarize, seen);
      return normalized;
    } finally {
      seen.delete(error);
    }
  }
  return { name: 'Error', message: String(error) };
}

function normalizeErrorCause(value: unknown, summarize: boolean, seen: WeakSet<Error>): unknown {
  if (value instanceof Error) return normalizeHostOutputErrorWithSeen(value, { summarize }, seen);
  return summarize ? summarizeHostValue(value, { arrayItems: 2, depth: 0 }) : value;
}

function describeHostValue(value: unknown): string {
  try {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value === 'object' ? Object.prototype.toString.call(value) : typeof value;
  } catch {
    return typeof value;
  }
}

function normalizeBudget(value: number | undefined): number {
  return Math.max(400, value ?? HOST_OUTPUT_CHAR_BUDGET);
}

function nextContext(ctx: SummaryContext): SummaryContext {
  return { ...ctx, depth: ctx.depth + 1 };
}

function isPrimitive(value: unknown): boolean {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
