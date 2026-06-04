import type { Meta, StoryObj } from '@storybook/react-vite';
import { SpendCard } from './spend-card';
import { selectNowSpendPanel } from '@/lib/selectors/spend';
import type { DailySpend, SpendSummary } from '@eforge-build/client/browser';

/**
 * Stories build wire-level SpendSummary payloads and route them through the
 * *real* selectNowSpendPanel selector to produce the NowSpendPanel view model,
 * exactly as the dashboard does. The view model is never hand-authored, so a
 * selector shape change flows through here automatically.
 *
 * Days are anchored to today so the "today" callout and the highlighted
 * sparkline bar render against the real current date.
 */

/** Local `YYYY-MM-DD` for `offset` days before today (matches the daemon's day key). */
function dayKey(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function today(): string {
  return dayKey(0);
}

/** A day of spend `offset` days back. cacheRead defaults to 90% of input. */
function spendDay(
  offset: number,
  costUsd: number,
  tokensIn: number,
  overrides: Partial<DailySpend> = {},
): DailySpend {
  return {
    date: dayKey(offset),
    tokensIn,
    tokensOut: Math.round(tokensIn * 0.15),
    tokensTotal: tokensIn + Math.round(tokensIn * 0.15),
    cacheRead: Math.round(tokensIn * 0.9),
    cacheCreation: Math.round(tokensIn * 0.05),
    costUsd,
    ...overrides,
  };
}

function summary(days: DailySpend[], windowDays = 7): SpendSummary {
  // The wire contract orders days oldest -> newest.
  const ordered = [...days].sort((a, b) => a.date.localeCompare(b.date));
  return { windowDays, days: ordered };
}

/** Derive the panel model from a wire payload exactly as the dashboard does. */
function modelFromSummary(s: SpendSummary | null) {
  return selectNowSpendPanel(s, today());
}

const meta = {
  title: 'Now/SpendCard',
  component: SpendCard,
  parameters: { layout: 'padded' },
  // Render at the dashboard rail width so spacing reads true to production.
  decorators: [
    (Story) => (
      <div className="w-[360px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SpendCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A typical week: spend most days, today mid-build. */
export const TypicalWeek: Story = {
  args: {
    model: modelFromSummary(
      summary([
        spendDay(6, 41.2, 28_000_000),
        spendDay(5, 12.8, 9_000_000),
        spendDay(4, 63.5, 44_000_000),
        spendDay(3, 8.1, 5_500_000),
        spendDay(2, 29.9, 21_000_000),
        spendDay(1, 51.4, 36_000_000),
        spendDay(0, 32.18, 24_000_000),
      ]),
    ),
  },
};

/** Quiet today — prior days carry the spend, today's bar is a zero stub. */
export const QuietToday: Story = {
  args: {
    model: modelFromSummary(
      summary([spendDay(4, 22.0, 16_000_000), spendDay(3, 18.5, 13_000_000), spendDay(2, 9.0, 6_000_000)]),
    ),
  },
};

/** A single heavy day with a very high cache rate. */
export const HeavyDayHighCache: Story = {
  args: {
    model: modelFromSummary(
      summary([spendDay(0, 214.5, 150_000_000, { cacheRead: 147_000_000 })]),
    ),
  },
};

/** Sparse history older than the window — the axis extends to the oldest day. */
export const SparseExtendedHistory: Story = {
  args: {
    model: modelFromSummary(
      summary([spendDay(11, 5.0, 4_000_000), spendDay(0, 7.25, 5_000_000)]),
    ),
  },
};

/** No spend yet — the card hides itself (renders nothing). */
export const Empty: Story = {
  args: { model: modelFromSummary(summary([])) },
};
