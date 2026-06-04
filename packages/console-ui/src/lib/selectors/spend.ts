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
  costUsd: number;
  tokensTotal: number;
  /** Share of the scope's total cost (window or today), 0-100. */
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
  windowDays: number;
  /** One bar per day, oldest -> newest, gaps filled with zero-spend days. */
  bars: SpendSparkBar[];
  /** Per-model breakdown over the window, ordered by cost descending. */
  models: SpendModelRow[];
  /** Per-model breakdown for today only, ordered by cost descending. */
  modelsToday: SpendModelRow[];
}

const EMPTY: NowSpendPanel = {
  hasData: false,
  todayCostUsd: 0,
  todayTokens: 0,
  todayCachePct: null,
  windowCostUsd: 0,
  windowDays: 0,
  bars: [],
  models: [],
  modelsToday: [],
};

/**
 * Map wire per-model rollups into view rows. `totalCostUsd` is the scope's total
 * (window or today), so each row's share sums to ~100% within its scope.
 */
function toModelRows(models: ModelSpend[], totalCostUsd: number): SpendModelRow[] {
  return models.map((m) => ({
    model: m.model,
    harness: m.harness ?? null,
    provider: m.provider ?? null,
    costUsd: m.costUsd,
    tokensTotal: m.tokensTotal,
    sharePct: totalCostUsd > 0 ? (m.costUsd / totalCostUsd) * 100 : 0,
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

  // Per-model share is computed against each scope's total so the bars sum to
  // ~100%. The wire payload already orders models by cost descending.
  const models = toModelRows(summary.models ?? [], windowCostUsd);
  const modelsToday = toModelRows(summary.modelsToday ?? [], todayCostUsd);

  return {
    hasData: windowCostUsd > 0,
    todayCostUsd,
    todayTokens,
    todayCachePct,
    windowCostUsd,
    windowDays: span,
    bars,
    models,
    modelsToday,
  };
}
