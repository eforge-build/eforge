/**
 * Format helpers used by run-state handlers.
 *
 * Contains only the symbols the reducer subsystem needs. UI-only formatting
 * belongs in view/components code.
 */

export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function formatNumber(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return n.toString();
}

/**
 * Convert a ThinkingConfig-shaped object to a human-readable string.
 * Accepts `unknown` to avoid importing engine types.
 * Returns `undefined` for falsy input.
 */
export function formatThinking(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && 'type' in value) {
    const obj = value as { type: string; budgetTokens?: number };
    if (obj.type === 'disabled') return 'disabled';
    if (obj.type === 'adaptive') return 'adaptive';
    if (obj.type === 'enabled') {
      // Accept both camelCase (budgetTokens) and snake_case (budget_tokens) from wire protocol
      const v = value as Record<string, unknown>;
      const budget = typeof v['budgetTokens'] === 'number'
        ? v['budgetTokens'] as number
        : typeof v['budget_tokens'] === 'number'
        ? v['budget_tokens'] as number
        : undefined;
      if (budget !== undefined) {
        return `enabled (${formatNumber(budget)} tokens)`;
      }
      return 'enabled';
    }
  }
  return JSON.stringify(value);
}
