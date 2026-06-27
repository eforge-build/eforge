import { createHash } from 'node:crypto';

import type { TSchema } from '@sinclair/typebox';
import {
  MAX_VALIDATION_DIAGNOSTIC_EXCERPT_LENGTH,
  MAX_VALIDATION_DIAGNOSTIC_MESSAGE_LENGTH,
  type BoundedDiagnosticOptions,
  type BoundedValidationDiagnostic,
  type ValueError,
} from '@eforge-build/client';

export const DEFAULT_BOUNDED_DIAGNOSTIC_OPTIONS: BoundedDiagnosticOptions = {
  maxMessageBytes: MAX_VALIDATION_DIAGNOSTIC_MESSAGE_LENGTH,
  maxExcerptBytes: Math.min(512, MAX_VALIDATION_DIAGNOSTIC_EXCERPT_LENGTH),
};

export interface PlannerToolValidationDiagnosticInput {
  toolName: 'submit_plan_set' | 'submit_architecture' | string;
  schemaPath: string;
  expectedType: string;
  receivedValue: unknown;
  fullPayload: unknown;
  validationReason?: string;
  additionalErrorCount?: number;
  options?: Partial<BoundedDiagnosticOptions>;
}

export function formatPlannerToolValidationDiagnostic(
  input: PlannerToolValidationDiagnosticInput,
): BoundedValidationDiagnostic {
  const options = resolveOptions(input.options);
  const payloadText = stableJson(input.fullPayload);
  const payloadBytes = byteLength(payloadText);
  const payloadSha256 = sha256(payloadText);
  const schemaPath = pointerToDotPath(input.schemaPath);
  const receivedType = summarizeType(input.receivedValue);
  const receivedSummary = summarizeValue(input.receivedValue, options.maxExcerptBytes);
  const excerpt = capUtf8(receivedSummary.text, options.maxExcerptBytes).text;
  const validationReason = input.validationReason === undefined ? undefined : capUtf8(input.validationReason, options.maxExcerptBytes).text;
  const baseLines = [
    `Submission rejected: ${input.toolName} payload did not validate.`,
    'Fix the issue and call the submission tool again with the corrected payload.',
    'Do NOT fall back to Write - this tool is the only way to complete the turn.',
    `schemaPath=${schemaPath}`,
    `expectedType=${input.expectedType}`,
    ...(validationReason === undefined ? [] : [`validationReason=${validationReason}`]),
    `receivedType=${receivedType}`,
    `excerpt=${excerpt}`,
    `payloadBytes=${payloadBytes}`,
    `payloadSha256=${payloadSha256}`,
    `additionalErrors=${input.additionalErrorCount ?? 0}`,
  ];
  const message = formatBoundedDiagnosticMessage(baseLines, receivedSummary.omittedBytes, options.maxMessageBytes);
  return {
    schemaPath,
    expectedType: input.expectedType,
    receivedType,
    excerpt,
    payloadBytes,
    payloadSha256,
    omittedBytes: message.omittedBytes,
    truncated: message.truncated,
    message: message.text,
  };
}

export function formatPlannerToolSchemaValidationError(input: {
  toolName: string;
  schema: TSchema;
  errors: readonly ValueError[];
  fullPayload: unknown;
  options?: Partial<BoundedDiagnosticOptions>;
}): string {
  const primary = input.errors[0] ?? { path: '', message: 'Unknown validation error' };
  const diagnostic = formatPlannerToolValidationDiagnostic({
    toolName: input.toolName,
    schemaPath: primary.path,
    expectedType: expectedTypeAtPath(input.schema, primary.path) ?? primary.message,
    receivedValue: valueAtJsonPointer(input.fullPayload, primary.path),
    fullPayload: input.fullPayload,
    validationReason: primary.message,
    additionalErrorCount: Math.max(0, input.errors.length - 1),
    options: input.options,
  });
  return diagnostic.message;
}

export function formatPlannerToolSemanticValidationError(input: {
  toolName: string;
  errors: readonly ValueError[];
  fullPayload: unknown;
  expectedType: string;
  options?: Partial<BoundedDiagnosticOptions>;
}): string {
  const primary = input.errors[0] ?? { path: '', message: 'Unknown validation error' };
  const diagnostic = formatPlannerToolValidationDiagnostic({
    toolName: input.toolName,
    schemaPath: primary.path,
    expectedType: input.expectedType,
    receivedValue: valueAtJsonPointer(input.fullPayload, primary.path),
    fullPayload: input.fullPayload,
    validationReason: primary.message,
    additionalErrorCount: Math.max(0, input.errors.length - 1),
    options: input.options,
  });
  return diagnostic.message;
}

export function pointerToDotPath(path: string): string {
  if (!path) return '(root)';
  const withoutSlash = path.replace(/^\//, '');
  if (!withoutSlash) return '(root)';
  return withoutSlash.split('/').map(unescapePointer).join('.');
}

export function valueAtJsonPointer(value: unknown, path: string): unknown {
  if (!path) return value;
  let current = value;
  for (const rawPart of path.replace(/^\//, '').split('/')) {
    const part = unescapePointer(rawPart);
    if (Array.isArray(current)) {
      current = current[Number(part)];
    } else if (current !== null && typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

function expectedTypeAtPath(schema: TSchema, path: string): string | undefined {
  const node = schemaAtPath(schema as JsonSchemaNode, path);
  return node ? describeSchemaNode(node) : undefined;
}

type JsonSchemaNode = Record<string, unknown>;

function schemaAtPath(schema: JsonSchemaNode, path: string): JsonSchemaNode | undefined {
  let current: JsonSchemaNode | undefined = schema;
  if (!path) return current;
  for (const rawPart of path.replace(/^\//, '').split('/')) {
    if (!current) return undefined;
    const part = unescapePointer(rawPart);
    if (current.properties && typeof current.properties === 'object' && !/^\d+$/.test(part)) {
      current = (current.properties as Record<string, JsonSchemaNode>)[part];
    } else if (Array.isArray(current.anyOf)) {
      current = current.anyOf.map((candidate) => schemaAtPath(candidate as JsonSchemaNode, `/${part}`)).find(Boolean);
    } else if (Array.isArray(current.allOf)) {
      current = current.allOf.map((candidate) => schemaAtPath(candidate as JsonSchemaNode, `/${part}`)).find(Boolean);
    } else if (current.items && typeof current.items === 'object') {
      current = current.items as JsonSchemaNode;
    } else {
      return undefined;
    }
  }
  return current;
}

function describeSchemaNode(node: JsonSchemaNode): string {
  if (typeof node.const === 'string') return `literal(${node.const})`;
  if (Array.isArray(node.enum)) return `enum(${node.enum.join('|')})`;
  if (typeof node.type === 'string') return node.type;
  if (Array.isArray(node.anyOf)) return `union(${node.anyOf.map((n) => describeSchemaNode(n as JsonSchemaNode)).join('|')})`;
  if (Array.isArray(node.allOf)) return `intersection(${node.allOf.map((n) => describeSchemaNode(n as JsonSchemaNode)).join('&')})`;
  return 'value matching schema';
}

function summarizeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function summarizeValue(value: unknown, maxExcerptBytes: number): { text: string; omittedBytes: number } {
  if (typeof value === 'string') {
    const bytes = byteLength(value);
    if (bytes <= maxExcerptBytes) return { text: `string(${bytes} bytes, excerpt=${value})`, omittedBytes: 0 };
    const capped = capUtf8(value, maxExcerptBytes);
    return { text: `string(${bytes} bytes, sha256=${sha256(value)}, omittedBytes=${capped.omittedBytes}, excerpt=${capped.text})`, omittedBytes: capped.omittedBytes };
  }
  if (Array.isArray(value)) {
    const firstTypes = value.slice(0, 5).map(summarizeType).join(',');
    return { text: `array(length=${value.length}, firstTypes=[${firstTypes}])`, omittedBytes: 0 };
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    return { text: `object(keys=${keys.length}, sampleKeys=[${keys.slice(0, 8).join(',')}])`, omittedBytes: 0 };
  }
  return { text: `${summarizeType(value)}(${String(value)})`, omittedBytes: 0 };
}

function resolveOptions(options?: Partial<BoundedDiagnosticOptions>): BoundedDiagnosticOptions {
  const resolved = { ...DEFAULT_BOUNDED_DIAGNOSTIC_OPTIONS, ...options };
  return {
    maxMessageBytes: clampBytes(resolved.maxMessageBytes, MAX_VALIDATION_DIAGNOSTIC_MESSAGE_LENGTH),
    maxExcerptBytes: clampBytes(resolved.maxExcerptBytes, MAX_VALIDATION_DIAGNOSTIC_EXCERPT_LENGTH),
  };
}

function clampBytes(value: number, max: number): number {
  if (!Number.isFinite(value)) return max;
  return Math.min(Math.max(1, Math.floor(value)), max);
}

function capUtf8(text: string, maxBytes: number): { text: string; omittedBytes: number; truncated: boolean } {
  const bytes = byteLength(text);
  if (bytes <= maxBytes) return { text, omittedBytes: 0, truncated: false };
  const ellipsisBytes = byteLength('…');
  if (maxBytes < ellipsisBytes) return { text: '', omittedBytes: bytes, truncated: true };
  let end = Math.max(0, maxBytes - ellipsisBytes);
  while (byteLength(text.slice(0, end)) > maxBytes - ellipsisBytes) end--;
  return { text: `${text.slice(0, end)}…`, omittedBytes: bytes - maxBytes, truncated: true };
}

function formatBoundedDiagnosticMessage(baseLines: string[], initialOmittedBytes: number, maxMessageBytes: number): { text: string; omittedBytes: number; truncated: boolean } {
  let omittedBytes = initialOmittedBytes;
  let truncated = initialOmittedBytes > 0;
  let capped = capUtf8('', maxMessageBytes);
  for (let attempt = 0; attempt < 3; attempt++) {
    capped = capUtf8([...baseLines.slice(0, 6), `omittedBytes=${omittedBytes}`, `truncated=${truncated}`, ...baseLines.slice(6)].join('\n'), maxMessageBytes);
    const nextOmitted = Math.max(initialOmittedBytes, capped.omittedBytes);
    const nextTruncated = initialOmittedBytes > 0 || capped.truncated;
    if (nextOmitted === omittedBytes && nextTruncated === truncated) break;
    omittedBytes = nextOmitted;
    truncated = nextTruncated;
  }
  return { text: capped.text, omittedBytes, truncated };
}

function stableJson(value: unknown): string {
  try {
    const text = JSON.stringify(sortForJson(value, new WeakSet<object>()));
    return text ?? `[${typeof value}]`;
  } catch (err) {
    return `[unserializable:${err instanceof Error ? err.message : String(err)}]`;
  }
}

function sortForJson(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (typeof value === 'function') return `[Function${value.name ? `:${value.name}` : ''}]`;
  if (typeof value === 'symbol') return value.description ? `[Symbol:${value.description}]` : '[Symbol]';
  if (value === undefined) return '[Undefined]';
  if (Array.isArray(value)) return visitJsonObject(value, seen, () => value.map((entry) => sortForJson(entry, seen)));
  if (value !== null && typeof value === 'object') {
    return visitJsonObject(value, seen, () => Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortForJson(v, seen)]),
    ));
  }
  return value;
}

function visitJsonObject<T>(value: object, seen: WeakSet<object>, visit: () => T): T | string {
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  try {
    return visit();
  } finally {
    seen.delete(value);
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

function unescapePointer(part: string): string {
  return part.replace(/~1/g, '/').replace(/~0/g, '~');
}
