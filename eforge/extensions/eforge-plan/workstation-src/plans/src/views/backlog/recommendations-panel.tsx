import * as React from 'react';
import { Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AgentTaskStatus, JsonObject, PlanningAgentTaskRecord, RecommendationModel, RecommendationStatus, RecommendationStatusState } from '@/types';
import { shortId } from './board-model';

interface RecommendationsPanelProps {
  recommendations: RecommendationModel | null;
  status: RecommendationStatus | null;
  activeRefreshTask?: PlanningAgentTaskRecord | null;
  titles: Map<string, string>;
  // Starts an AI session-plan generation task for the given backlog item ids or
  // recommendation ref. There is no deterministic promotion path here.
  onStartPlan: (input: JsonObject, label: string) => Promise<void>;
  onRefreshRecommendations: () => Promise<void>;
  busy?: boolean;
}

export function RecommendationsPanel({ recommendations, status, activeRefreshTask, titles, onStartPlan, onRefreshRecommendations, busy }: RecommendationsPanelProps) {
  if (!recommendations && !status) return null;
  const next = recommendations?.recommendedNextSequence ?? [];
  const groups = recommendations?.safeParallelizableGroups ?? [];
  const chains = recommendations?.blockedChains ?? [];
  const rationale = recommendations?.rationaleAndAssumptions ?? [];
  const hasGuidance = next.length > 0 || groups.length > 0 || chains.length > 0 || rationale.length > 0;
  const state = status?.state ?? (recommendations ? 'fresh' : 'missing');
  const label = (id: string) => titles.get(id) ?? shortId(id);
  const canRefresh = state === 'missing' || state === 'stale';
  const staleReasons = status?.reasons?.length ? status.reasons : status?.staleReasons ?? [];

  return (
    <section className="rounded-lg border border-[color:var(--lane-ready)]/30 bg-[color:var(--lane-ready)]/5 p-3">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-text-bright">
            <Sparkles className="h-4 w-4 text-primary" /> Recommendations <StatusBadge state={state} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{statusCopy(state)}</p>
          {status?.freshAt && <p className="mt-0.5 text-[0.68rem] text-muted-foreground">Fresh at {status.freshAt}{status.lastRefreshedBy ? ` via ${status.lastRefreshedBy}` : ''}</p>}
          {status?.staleSince && <p className="mt-0.5 text-[0.68rem] text-muted-foreground">Stale since {status.staleSince}</p>}
        </div>
        {canRefresh && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void onRefreshRecommendations()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh recommendations
          </Button>
        )}
      </div>

      {activeRefreshTask && <ActiveRefreshTask task={activeRefreshTask} />}

      {state === 'stale' && staleReasons.length > 0 && (
        <div className="mb-2 rounded-md border border-[color:var(--prio-medium)]/30 bg-[color:var(--prio-medium)]/10 p-2">
          <span className="block text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">Stale reasons</span>
          <ul className="mt-1 grid gap-1 text-xs text-muted-foreground">
            {staleReasons.map((reason, index) => (
              <li key={`${reason.code ?? reason.eventType ?? 'reason'}:${reason.timestamp ?? index}`}>
                <div>
                  {(reason.code ?? reason.eventType) && <code className="mr-1 rounded border border-border bg-card px-1 py-0.5 text-[0.68rem] text-foreground">{reason.code ?? reason.eventType}</code>}
                  {reason.summary ?? reason.message ?? 'Recommendation freshness changed.'}
                </div>
                {(reason.eventType || reason.correlationKind || reason.itemIds?.length || reason.timestamp) && (
                  <div className="mt-0.5 flex flex-wrap gap-1 text-[0.68rem]">
                    {reason.eventType && <Chip>event {reason.eventType}</Chip>}
                    {reason.correlationKind && <Chip>{reason.correlationKind}</Chip>}
                    {reason.timestamp && <Chip>{reason.timestamp}</Chip>}
                    {reason.itemIds?.map((id) => <Chip key={id}>{label(id)}</Chip>)}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!hasGuidance && (
        <p className="text-xs text-muted-foreground">
          {state === 'missing' ? 'No generated recommendation model is available yet.' : 'The current recommendation model does not include visible guidance.'}
        </p>
      )}

      {next.length > 0 && (
        <div className="mb-2">
          <span className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">Recommended next sequence</span>
          <div className="flex flex-wrap gap-2">
            {next.map((entry, index) => (
              <button
                key={entry.ref ?? entry.itemId}
                title={entry.rationale}
                disabled={busy}
                onClick={() => void onStartPlan(entry.ref ? { recommendationRef: entry.ref } : { itemIds: [entry.itemId] }, label(entry.itemId))}
                className="inline-flex max-w-80 items-center gap-2 rounded-md border border-border bg-card px-2 py-1 text-left transition-colors hover:border-primary disabled:opacity-50"
              >
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[color:var(--lane-ready)]/20 text-xs font-bold text-[color:var(--lane-ready)]">{index + 1}</span>
                <span className="truncate text-xs text-foreground">{label(entry.itemId)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {(groups.length > 0 || chains.length > 0 || rationale.length > 0) && (
        <details className="mt-1 border-t border-border pt-2">
          <summary className="cursor-pointer text-xs text-muted-foreground">Parallel lanes, blocked chains &amp; rationale</summary>

          {groups.length > 0 && (
            <div className="mt-2">
              <span className="block text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">Safe parallelizable groups</span>
              <ul className="mt-1 grid gap-2">
                {groups.map((group) => (
                  <li key={group.ref}>
                    <button disabled={busy} onClick={() => void onStartPlan({ recommendationRef: group.ref }, group.title ?? group.ref)} className="text-left text-xs font-semibold text-text-bright hover:underline disabled:opacity-50">{group.title ?? group.ref}</button>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {group.itemIds.map((id) => <Chip key={id}>{label(id)}</Chip>)}
                    </div>
                    {group.rationale && <span className="mt-0.5 block text-xs text-muted-foreground">{group.rationale}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {chains.length > 0 && (
            <div className="mt-2">
              <span className="block text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">Blocked chains</span>
              <ul className="mt-1 grid gap-2">
                {chains.map((chain, index) => (
                  <li key={chain.ref ?? index}>
                    <div className="flex flex-wrap items-center gap-1">
                      {chain.itemIds.map((id) => <Chip key={id} tone="bad">{label(id)}</Chip>)}
                      <span className="text-[0.7rem] text-muted-foreground">blocked by</span>
                      {chain.blockedBy.map((id) => <Chip key={id} tone="warn">{label(id)}</Chip>)}
                    </div>
                    {chain.rationale && <span className="mt-0.5 block text-xs text-muted-foreground">{chain.rationale}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {rationale.length > 0 && (
            <div className="mt-2">
              <span className="block text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">Rationale and assumptions</span>
              <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
                {rationale.map((entry) => <li key={entry}>{entry}</li>)}
              </ul>
            </div>
          )}
        </details>
      )}
    </section>
  );
}

const BADGE_TONE: Record<RecommendationStatusState, string> = {
  missing: 'border-[color:var(--prio-medium)]/40 text-[color:var(--prio-medium)] bg-[color:var(--prio-medium)]/10',
  fresh: 'border-[color:var(--lane-ready)]/40 text-[color:var(--lane-ready)] bg-[color:var(--lane-ready)]/10',
  stale: 'border-[color:var(--lane-blocked)]/40 text-[color:var(--lane-blocked)] bg-[color:var(--lane-blocked)]/10',
};

function StatusBadge({ state }: { state: RecommendationStatusState }) {
  return <span className={`rounded border px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wide ${BADGE_TONE[state]}`}>{state}</span>;
}

function statusCopy(state: RecommendationStatusState): string {
  if (state === 'missing') return 'No current recommendations are stored; start a refresh task to generate them.';
  if (state === 'stale') return 'Stored recommendations may no longer match the open backlog; refresh before planning from them.';
  return 'Stored recommendations are fresh for the current backlog fingerprint.';
}

const ACTIVE_TASK_TONE: Record<AgentTaskStatus, string> = {
  queued: 'border-border text-muted-foreground',
  running: 'border-primary/40 text-text-bright',
  completed: 'border-primary/40 text-text-bright',
  failed: 'border-destructive/40 text-destructive-foreground',
  cancelled: 'border-border text-muted-foreground',
};

function ActiveRefreshTask({ task }: { task: PlanningAgentTaskRecord }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-2 text-xs">
      <span className="text-muted-foreground">Active refresh task</span>
      <span className="font-mono text-foreground">{task.taskId}</span>
      <span className={`rounded border px-1.5 py-0.5 ${ACTIVE_TASK_TONE[task.status] ?? ACTIVE_TASK_TONE.queued}`}>{task.status}</span>
      {task.metadata?.progressMessage && <span className="text-muted-foreground">{task.metadata.progressMessage}</span>}
    </div>
  );
}

const CHIP_TONE: Record<string, string> = {
  default: 'border-border text-[color:var(--lane-ready)] bg-[color:var(--lane-ready)]/10',
  bad: 'border-[color:var(--lane-blocked)]/30 text-[color:var(--lane-blocked)] bg-[color:var(--lane-blocked)]/10',
  warn: 'border-[color:var(--prio-medium)]/30 text-[color:var(--prio-medium)] bg-[color:var(--prio-medium)]/10',
};

function Chip({ children, tone = 'default' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`rounded border px-1.5 py-0.5 text-[0.68rem] ${CHIP_TONE[tone] ?? CHIP_TONE.default}`}>{children}</span>;
}
