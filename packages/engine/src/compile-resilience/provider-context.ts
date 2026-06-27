export const MAX_PROVIDER_CONTEXT_EXPLANATION_BYTES = 1500;

export const PROVIDER_CONTEXT_LENGTH_PATTERNS: readonly RegExp[] = [
  /context_length_exceeded/i,
  /maximum context length/i,
  /max(?:imum)? context length/i,
  /input is too long/i,
  /prompt is too long/i,
];

export const PROVIDER_CONTEXT_WINDOW_PATTERNS: readonly RegExp[] = [
  /context window/i,
  /context limit/i,
  /token limit/i,
  /too many tokens/i,
  /input length and max_tokens exceed/i,
  /exceeds? (?:the )?(?:model'?s? )?context/i,
  /claude(?:[^.]{0,120})?context/i,
];

const NON_CONTEXT_PATTERNS: readonly RegExp[] = [
  /\b529\b/i,
  /overloaded_error/i,
  /overload/i,
  /websocket.*clos/i,
  /socket.*clos/i,
  /sse.*timeout/i,
];

export type ProviderContextClassification = {
  failureKind: 'context-window' | 'context-length';
  explanation: string;
};

export function classifyProviderContextError(error: unknown): ProviderContextClassification | null {
  const parts = collectErrorParts(error);
  const text = parts.join(' | ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (NON_CONTEXT_PATTERNS.some((pattern) => pattern.test(text))) return null;

  const failureKind = PROVIDER_CONTEXT_LENGTH_PATTERNS.some((pattern) => pattern.test(text))
    ? 'context-length'
    : PROVIDER_CONTEXT_WINDOW_PATTERNS.some((pattern) => pattern.test(text))
      ? 'context-window'
      : null;
  if (failureKind === null) return null;
  return { failureKind, explanation: boundProviderContextExplanation(text) };
}

export function boundProviderContextExplanation(text: string): string {
  return capUtf8(text.trim() || 'Provider reported a context-window failure.', MAX_PROVIDER_CONTEXT_EXPLANATION_BYTES);
}

function collectErrorParts(value: unknown, seen = new Set<unknown>()): string[] {
  if (value === null || value === undefined || seen.has(value)) return [];
  seen.add(value);
  if (typeof value === 'string') return [value];
  if (typeof value !== 'object') return [String(value)];

  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  if (value instanceof Error) {
    parts.push(value.name, value.message);
    if (value.stack) parts.push(value.stack.split('\n').slice(0, 2).join(' '));
  }
  for (const key of ['name', 'type', 'code', 'status', 'message', 'detail', 'error']) {
    const item = record[key];
    if (typeof item === 'string' || typeof item === 'number') parts.push(`${key}=${item}`);
    else if (item && typeof item === 'object') parts.push(...collectErrorParts(item, seen));
  }
  parts.push(...collectErrorParts(record.cause, seen));
  return [...new Set(parts.filter((part) => part.trim().length > 0))];
}

function capUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  const ellipsis = '…';
  let end = Math.max(0, maxBytes - Buffer.byteLength(ellipsis, 'utf8'));
  while (Buffer.byteLength(text.slice(0, end), 'utf8') > maxBytes - Buffer.byteLength(ellipsis, 'utf8')) end--;
  return `${text.slice(0, end)}${ellipsis}`;
}
