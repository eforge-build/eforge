import { Badge } from '@/components/ui/badge';
import type { LifecycleLinkRow, PlanData, PlanDetail } from '@/types';

// A plan converges from backlog items and (later) fans out into a build. The
// "where it came from" story now lives in the Plans-focus context rail
// (`PlanContextRail`); this footer panel holds the destination story - the build
// trace that accrues once the plan is handed off.

function resolveSourceRefs(plan: PlanData, detail?: PlanDetail) {
  return detail?.sourceRefs ?? detail?.lifecycle?.sourceRefs ?? plan.sourceRefs;
}

// Lifecycle kinds that represent real build activity. The session-plan creation
// row is intentionally excluded - it only restated "this plan exists" (already
// clear from the header) and was the bulk of the old noise for unbuilt plans.
const BUILD_KINDS = new Set(['queue-prd', 'build-run', 'build-session', 'pr', 'landing', 'last-event']);

/**
 * Build trace: queue, run, PR, and landing activity once a plan is handed off.
 * Flattened to a single list (no per-kind nested boxes) and empty until the plan
 * actually enters a build.
 */
export function PlanBuildTracePanel({ plan, detail }: { plan: PlanData; detail?: PlanDetail }) {
  const rows = (detail?.lifecycle?.linkRows ?? plan.linkRows ?? plan.lifecycleLinks ?? []).filter((row) => BUILD_KINDS.has(row.kind));
  const lifecycleState = detail?.lifecycle?.lifecycleState ?? plan.lifecycleState;
  const knownItemIds = new Set(resolveSourceRefs(plan, detail)?.sourceItemIds ?? resolveSourceRefs(plan, detail)?.itemIds ?? []);

  return (
    <section>
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Build trace</h4>
        {lifecycleState && <Badge variant="outline" className="capitalize">{lifecycleState}</Badge>}
      </div>
      {rows.length === 0 ? (
        <p className="mt-2 rounded border border-dashed border-border p-2 text-xs text-muted-foreground">
          Not queued for a build yet. Queue, run, PR, and landing activity appears here after handoff.
        </p>
      ) : (
        <div className="mt-2 grid gap-1">
          {rows.map((row, index) => <EvidenceRow key={`${row.kind}-${row.stage ?? ''}-${index}`} row={row} knownItemIds={knownItemIds} />)}
        </div>
      )}
    </section>
  );
}

function EvidenceRow({ row, knownItemIds }: { row: LifecycleLinkRow; knownItemIds: Set<string> }) {
  const timestamp = row.timestamp ?? row.completedAt ?? row.landedAt ?? row.startedAt ?? row.queuedAt ?? row.promotedAt;
  // Drop affected ids already shown in the "Built from" strip so the same
  // backlog id is not repeated here.
  const extraAffectedItemIds = (row.affectedItemIds ?? []).filter((id) => !knownItemIds.has(id));
  return (
    <div className="rounded border border-border bg-card p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{row.stage ?? row.kind}</Badge>
        {row.status && <span className="text-muted-foreground">{row.status}</span>}
        {timestamp && <code className="ml-auto text-2xs text-muted-foreground">{timestamp}</code>}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
        {row.runId && <Value label="run" value={row.runId} />}
        {(row.sessionId ?? row.buildSessionId) && <Value label="build session" value={row.sessionId ?? row.buildSessionId ?? ''} />}
        {(row.featureBranch ?? row.branch) && <Value label="branch" value={row.featureBranch ?? row.branch ?? ''} />}
        {row.commitSha && <Value label="commit" value={row.commitSha} />}
      </div>
      {row.prUrl && <a className="mt-1 block break-all text-[color:var(--lane-ready)] underline" href={row.prUrl} target="_blank" rel="noreferrer">{row.prUrl}</a>}
      {extraAffectedItemIds.length > 0 && <p className="mt-1 text-muted-foreground">Affected: {extraAffectedItemIds.join(', ')}</p>}
    </div>
  );
}

function Value({ label, value }: { label: string; value: string }) {
  return <span><span className="uppercase tracking-wide">{label}:</span> <code>{value}</code></span>;
}
