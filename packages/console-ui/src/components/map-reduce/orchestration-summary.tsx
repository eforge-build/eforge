/**
 * Compact map/reduce orchestration summary card (Phase 2).
 *
 * Renders the at-a-glance health of a large-plan bounded-compiler run: how many
 * map atoms are running / done / skipped / failed, which reduce level is in
 * flight, node totals, and the tokens/cost concentrated in the planner agents.
 * The full stage/level board is Phase 3; this card alone resolves the original
 * "wall of rows" complaint by giving structure without per-row noise.
 *
 * Pure presentational component: takes a precomputed `MapReduceSummary`
 * (`buildMapReduceSummary(state.mapReduce, state.agentThreads)`) so it is
 * trivially fixturable in Storybook.
 */
import { Layers, GitMerge, Zap, DollarSign } from 'lucide-react';
import type { MapReduceSummary } from '@/lib/run-state';
import { formatNumber } from '@/lib/run-state/format';
import { cn } from '@/lib/utils';

interface OrchestrationSummaryProps {
  summary: MapReduceSummary;
  className?: string;
}

interface StatusPillProps {
  label: string;
  count: number;
  /** Tailwind text color token for the count when non-zero. */
  accent: string;
}

function StatusPill({ label, count, accent }: StatusPillProps) {
  const dim = count === 0;
  return (
    <span className="inline-flex items-baseline gap-1 text-11px">
      <span className={cn('font-mono tabular-nums', dim ? 'text-text-dim/50' : accent)}>{count}</span>
      <span className={cn(dim ? 'text-text-dim/50' : 'text-text-dim')}>{label}</span>
    </span>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-11px uppercase tracking-wider text-text-dim">
        {icon}
        {title}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">{children}</div>
    </div>
  );
}

function formatCost(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

export function OrchestrationSummary({ summary, className }: OrchestrationSummaryProps) {
  const { atomCounts, reduceCounts, maxLevel, currentLevel } = summary;
  const levelLabel = reduceCounts.total === 0
    ? '-'
    : currentLevel === null
      ? 'done'
      : `${currentLevel} / ${maxLevel}`;

  return (
    <div className={cn('rounded-md border border-border bg-bg-secondary/40 px-3 py-2.5 flex flex-col gap-2.5', className)}>
      <div className="flex items-center justify-between">
        <span className="text-11px uppercase tracking-wider text-text-bright flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-purple" />
          Map / reduce orchestration
        </span>
        <span className="text-10px font-mono text-text-dim truncate max-w-[40%]" title={summary.graphId}>
          {summary.graphId}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
        <Section icon={<Layers className="w-3 h-3" />} title={`Map atoms (${atomCounts.total})`}>
          <StatusPill label="running" count={atomCounts.running} accent="text-blue" />
          <StatusPill label="done" count={atomCounts.completed} accent="text-green" />
          <StatusPill label="skipped" count={atomCounts.skipped} accent="text-text-dim" />
          <StatusPill label="failed" count={atomCounts.failed} accent="text-red" />
          <StatusPill label="queued" count={atomCounts.queued} accent="text-text-dim" />
        </Section>

        <Section icon={<GitMerge className="w-3 h-3" />} title={`Reduce nodes (${reduceCounts.total})`}>
          <StatusPill label="running" count={reduceCounts.running} accent="text-blue" />
          <StatusPill label="done" count={reduceCounts.completed} accent="text-green" />
          <StatusPill label="failed" count={reduceCounts.failed} accent="text-red" />
          <StatusPill label="incomplete" count={reduceCounts.incomplete} accent="text-yellow" />
          <StatusPill label="queued" count={reduceCounts.queued} accent="text-text-dim" />
        </Section>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-0.5 border-t border-border/50 text-11px">
        <span className="inline-flex items-center gap-1 text-text-dim">
          <GitMerge className="w-3 h-3" />
          level <span className="font-mono tabular-nums text-text-bright">{levelLabel}</span>
        </span>
        <span className="inline-flex items-center gap-1 text-text-dim">
          <Zap className="w-3 h-3" />
          <span className="font-mono tabular-nums text-text-bright">{formatNumber(summary.totalTokens)}</span> tok
        </span>
        <span className="inline-flex items-center gap-1 text-text-dim">
          <DollarSign className="w-3 h-3" />
          <span className="font-mono tabular-nums text-text-bright">{formatCost(summary.costUsd)}</span>
        </span>
      </div>
    </div>
  );
}
