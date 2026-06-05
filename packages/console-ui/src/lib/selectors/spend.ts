/**
 * Spend-panel selector — derives the at-a-glance token/dollar spend card from
 * the daemon's daily-spend rollup (GET /api/spend). The card leads with today's
 * spend, a per-day sparkline, and the window total. Days with no spend are
 * absent from the wire payload, so this fills gaps to keep the sparkline a
 * continuous run of bars. Pure; no I/O, no Date access (today is passed in).
 */
import type { ModelSpend, SpendSummary } from '@eforge-build/client/browser';

export interface SpendSparkBar {
  /** Local calendar day, `YYYY-MM-DD`. */
  date: string;
  costUsd: number;
  isToday: boolean;
}

export interface SpendModelRow {
  /** Provider model id, e.g. `claude-opus-4-7`. */
  model: string;
  /** Harness that ran the model, or null for historical (pre-attribution) spend. */
  harness: 'claude-sdk' | 'pi' | null;
  /** Provider routing the model (e.g. `anthropic`, `openrouter`), or null. */
  provider: string | null;
  /** Dollars this model spent across the whole window. */
  costUsd: number;
  /** Dollars this model spent today (0 when idle today). Drives the "today" accent. */
  todayCostUsd: number;
  tokensTotal: number;
  /** Share of the window's total cost, 0-100. */
  sharePct: number;
  /** Cache hit rate for this model as a percentage, or null when no input. */
  cachePct: number | null;
}

export interface NowSpendPanel {
  hasData: boolean;
  /** Dollars spent on `today` (0 when there is no row for today). */
  todayCostUsd: number;
  /** Total tokens (`usage.total`) spent today. */
  todayTokens: number;
  /** Cache hit rate today as a percentage, or null when there was no input. */
  todayCachePct: number | null;
  /** Dollars spent across the whole window. */
  windowCostUsd: number;
  /** Total tokens spent across the whole window. */
  windowTokens: number;
  /** Cache hit rate across the window as a percentage, or null when no input. */
  windowCachePct: number | null;
  windowDays: number;
  /** One bar per day, oldest -> newest, gaps filled with zero-spend days. */
  bars: SpendSparkBar[];
  /**
   * Per-model breakdown over the window, ordered by cost descending. Each row
   * also carries its `todayCostUsd` so the card can surface a today accent
   * without a separate list.
   */
  models: SpendModelRow[];
}

const EMPTY: NowSpendPanel = {
  hasData: false,
  todayCostUsd: 0,
  todayTokens: 0,
  todayCachePct: null,
  windowCostUsd: 0,
  windowTokens: 0,
  windowCachePct: null,
  windowDays: 0,
  bars: [],
  models: [],
};

/**
 * Stable key per model+harness+provider — the same model id run under different
 * harnesses/providers is reported (and joined) as separate rows.
 */
function modelKey(m: Pick<ModelSpend, 'model' | 'harness' | 'provider'>): string {
  return `${m.model}::${m.harness ?? ''}::${m.provider ?? ''}`;
}

/**
 * Map wire per-model window rollups into view rows. `windowCostUsd` is the
 * window total, so each row's share sums to ~100%. `todayByKey` supplies each
 * model's today spend (0 when idle today) for the today accent.
 */
function toModelRows(
  models: ModelSpend[],
  windowCostUsd: number,
  todayByKey: Map<string, number>,
): SpendModelRow[] {
  return models.map((m) => ({
    model: m.model,
    harness: m.harness ?? null,
    provider: m.provider ?? null,
    costUsd: m.costUsd,
    todayCostUsd: todayByKey.get(modelKey(m)) ?? 0,
    tokensTotal: m.tokensTotal,
    sharePct: windowCostUsd > 0 ? (m.costUsd / windowCostUsd) * 100 : 0,
    cachePct: m.inputTokens > 0 ? (m.cacheReadTokens / m.inputTokens) * 100 : null,
  }));
}

/** Step a `YYYY-MM-DD` day string back by one calendar day (UTC-safe). */
function prevDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

/**
 * @param summary  - Daily-spend rollup from the daemon, or null while loading.
 * @param todayStr - The viewer's local calendar day as `YYYY-MM-DD`.
 */
export function selectNowSpendPanel(
  summary: SpendSummary | null,
  todayStr: string,
): NowSpendPanel {
  if (!summary || summary.days.length === 0) return EMPTY;

  const byDate = new Map(summary.days.map((d) => [d.date, d]));
  const today = byDate.get(todayStr);

  const windowCostUsd = summary.days.reduce((sum, d) => sum + d.costUsd, 0);
  const windowTokens = summary.days.reduce((sum, d) => sum + d.tokensTotal, 0);
  const windowTokensIn = summary.days.reduce((sum, d) => sum + d.tokensIn, 0);
  const windowCacheRead = summary.days.reduce((sum, d) => sum + d.cacheRead, 0);
  const windowCachePct = windowTokensIn > 0 ? (windowCacheRead / windowTokensIn) * 100 : null;
  const todayCostUsd = today?.costUsd ?? 0;
  const todayTokens = today?.tokensTotal ?? 0;
  const todayCachePct =
    today && today.tokensIn > 0 ? (today.cacheRead / today.tokensIn) * 100 : null;

  // Build a contiguous day axis ending at today so the sparkline reads as a
  // calendar rather than skipping idle days. Anchor on the requested window
  // size, extending if the payload reaches further back than that.
  const oldest = summary.days[0].date;
  const span = Math.max(summary.windowDays, 1);
  const dates: string[] = [todayStr];
  let cursor = todayStr;
  while (dates.length < span || cursor > oldest) {
    cursor = prevDay(cursor);
    dates.push(cursor);
    // Guard against an unbounded loop if inputs are malformed.
    if (dates.length > 366) break;
  }
  dates.reverse();

  const bars: SpendSparkBar[] = dates.map((date) => ({
    date,
    costUsd: byDate.get(date)?.costUsd ?? 0,
    isToday: date === todayStr,
  }));

  // Per-model share is computed against the window total so the bars sum to
  // ~100%. The wire payload already orders models by cost descending. Today's
  // per-model spend is joined in as an accent rather than a separate list.
  const todayByKey = new Map(
    (summary.modelsToday ?? []).map((m) => [modelKey(m), m.costUsd] as const),
  );
  const models = toModelRows(summary.models ?? [], windowCostUsd, todayByKey);

  return {
    hasData: windowCostUsd > 0,
    todayCostUsd,
    todayTokens,
    todayCachePct,
    windowCostUsd,
    windowTokens,
    windowCachePct,
    windowDays: span,
    bars,
    models,
  };
}
