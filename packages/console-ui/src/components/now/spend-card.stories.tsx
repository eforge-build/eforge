import type { Meta, StoryObj } from '@storybook/react-vite';
import { SpendCard } from './spend-card';
import { selectNowSpendPanel } from '@/lib/selectors/spend';
import type { DailySpend, ModelSpend, SpendSummary } from '@eforge-build/client/browser';

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

/**
 * A per-model window rollup. cacheRead defaults to 90% of input tokens, harness
 * to claude-sdk. Override harness/provider to model Pi routes.
 */
function modelSpend(
  model: string,
  costUsd: number,
  inputTokens: number,
  overrides: Partial<ModelSpend> = {},
): ModelSpend {
  const outputTokens = Math.round(inputTokens * 0.15);
  return {
    model,
    harness: 'claude-sdk',
    provider: null,
    inputTokens,
    outputTokens,
    tokensTotal: inputTokens + outputTokens,
    cacheReadTokens: Math.round(inputTokens * 0.9),
    costUsd,
    ...overrides,
  };
}

const byCostDesc = (models: ModelSpend[]) => [...models].sort((a, b) => b.costUsd - a.costUsd);

function summary(
  days: DailySpend[],
  models: ModelSpend[] = [],
  modelsToday: ModelSpend[] = [],
  windowDays = 7,
): SpendSummary {
  // The wire contract orders days oldest -> newest and models by cost desc.
  const ordered = [...days].sort((a, b) => a.date.localeCompare(b.date));
  return {
    windowDays,
    days: ordered,
    models: byCostDesc(models),
    modelsToday: byCostDesc(modelsToday),
  };
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
      summary(
        [
          spendDay(6, 41.2, 28_000_000),
          spendDay(5, 12.8, 9_000_000),
          spendDay(4, 63.5, 44_000_000),
          spendDay(3, 8.1, 5_500_000),
          spendDay(2, 29.9, 21_000_000),
          spendDay(1, 51.4, 36_000_000),
          spendDay(0, 32.18, 24_000_000),
        ],
        [
          modelSpend('claude-opus-4-7', 168.4, 96_000_000),
          modelSpend('claude-sonnet-4-6', 58.2, 54_000_000),
          modelSpend('claude-haiku-4-5', 12.49, 17_500_000),
        ],
        // Today's slice — a subset of the window, used by the "Today" tab.
        [
          modelSpend('claude-opus-4-7', 22.0, 16_000_000),
          modelSpend('claude-sonnet-4-6', 8.18, 6_500_000),
          modelSpend('claude-haiku-4-5', 2.0, 1_500_000),
        ],
      ),
    ),
  },
};

/** Quiet today — prior days carry the spend, the "Today" tab is empty. */
export const QuietToday: Story = {
  args: {
    model: modelFromSummary(
      summary(
        [spendDay(4, 22.0, 16_000_000), spendDay(3, 18.5, 13_000_000), spendDay(2, 9.0, 6_000_000)],
        [
          modelSpend('claude-opus-4-7', 35.5, 22_000_000),
          modelSpend('claude-sonnet-4-6', 14.0, 13_000_000),
        ],
        // No spend today, so the "Today" tab shows the empty state.
        [],
      ),
    ),
  },
};

/** A single heavy day with a very high cache rate (today is that day). */
export const HeavyDayHighCache: Story = {
  args: {
    model: modelFromSummary(
      summary(
        [spendDay(0, 214.5, 150_000_000, { cacheRead: 147_000_000 })],
        [modelSpend('claude-opus-4-7', 214.5, 150_000_000, { cacheReadTokens: 147_000_000 })],
        [modelSpend('claude-opus-4-7', 214.5, 150_000_000, { cacheReadTokens: 147_000_000 })],
      ),
    ),
  },
};

/**
 * Same model id, different harnesses — opus run directly via claude-sdk and
 * routed through Pi + OpenRouter aggregate as distinct rows.
 */
export const MixedHarnesses: Story = {
  args: {
    model: modelFromSummary(
      summary(
        [spendDay(1, 70.0, 48_000_000), spendDay(0, 40.0, 28_000_000)],
        [
          modelSpend('claude-opus-4-8', 62.0, 40_000_000),
          modelSpend('claude-opus-4-8', 28.0, 22_000_000, { harness: 'pi', provider: 'openrouter' }),
          modelSpend('claude-sonnet-4-6', 20.0, 18_000_000, { harness: 'pi', provider: 'anthropic' }),
        ],
        [
          modelSpend('claude-opus-4-8', 22.0, 15_000_000),
          modelSpend('claude-opus-4-8', 12.0, 9_000_000, { harness: 'pi', provider: 'openrouter' }),
          modelSpend('claude-sonnet-4-6', 6.0, 4_000_000, { harness: 'pi', provider: 'anthropic' }),
        ],
      ),
    ),
  },
};

/** Many models in one window — exercises the "+N more" tail collapse. */
export const ManyModels: Story = {
  args: {
    model: modelFromSummary(
      summary(
        [spendDay(1, 88.0, 60_000_000), spendDay(0, 64.0, 42_000_000)],
        [
          modelSpend('claude-opus-4-7', 96.0, 60_000_000),
          modelSpend('claude-sonnet-4-6', 31.0, 28_000_000),
          modelSpend('claude-haiku-4-5', 14.0, 19_000_000),
          modelSpend('gpt-5.4', 7.0, 9_000_000, { harness: 'pi', provider: 'openrouter' }),
          modelSpend('claude-opus-4-6', 3.0, 2_400_000),
          modelSpend('gpt-5.4-mini', 1.0, 1_200_000, { harness: 'pi', provider: 'openrouter' }),
        ],
        [
          modelSpend('claude-opus-4-7', 40.0, 26_000_000),
          modelSpend('claude-sonnet-4-6', 14.0, 10_000_000),
          modelSpend('claude-haiku-4-5', 6.0, 4_000_000),
          modelSpend('gpt-5.4', 4.0, 2_000_000, { harness: 'pi', provider: 'openrouter' }),
        ],
      ),
    ),
  },
};

/** Sparse history older than the window — the axis extends to the oldest day. */
export const SparseExtendedHistory: Story = {
  args: {
    model: modelFromSummary(
      summary(
        [spendDay(11, 5.0, 4_000_000), spendDay(0, 7.25, 5_000_000)],
        [modelSpend('claude-sonnet-4-6', 12.25, 9_000_000)],
        [modelSpend('claude-sonnet-4-6', 7.25, 5_000_000)],
      ),
    ),
  },
};

/** No spend yet — the card hides itself (renders nothing). */
export const Empty: Story = {
  args: { model: modelFromSummary(summary([])) },
};
