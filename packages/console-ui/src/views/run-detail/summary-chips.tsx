// --- eforge:region plan-06-build-detail-base ---
import { SummaryCards } from '@/components/common/summary-cards';
import { getSummaryStats } from '@/lib/run-state';
import type { RunState } from '@/lib/run-state';

interface SummaryChipsProps {
  runState: RunState;
}

/** Thin wrapper: computes summary stats and renders the SummaryCards row. */
export function SummaryChips({ runState }: SummaryChipsProps) {
  const stats = getSummaryStats(runState);
  return (
    <SummaryCards
      {...stats}
      isComplete={runState.isComplete}
      isFailed={runState.resultStatus === 'failed'}
      profile={runState.profile}
    />
  );
}
// --- eforge:endregion plan-06-build-detail-base ---
