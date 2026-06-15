import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import type { LifecycleItemProgressRow, LifecycleLinkRow, PlanData, PlanDetail } from '@/types';

export function PlanLifecycleEvidencePanel({ plan, detail }: { plan: PlanData; detail?: PlanDetail }) {
  const sourceRefs = detail?.sourceRefs ?? detail?.lifecycle?.sourceRefs ?? plan.sourceRefs;
  const sourceItemIds = sourceRefs?.sourceItemIds ?? sourceRefs?.itemIds ?? [];
  const sourceEpicIds = sourceRefs?.sourceEpicIds ?? sourceRefs?.epicIds ?? [];
  const rows = detail?.lifecycle?.linkRows ?? plan.linkRows ?? plan.lifecycleLinks ?? [];
  const itemRows = detail?.lifecycle?.itemRows ?? plan.itemRows ?? rows.flatMap((row) => row.itemRows ?? []);
  const epicRows = plan.epicProgress ?? [];
  const lifecycleState = detail?.lifecycle?.lifecycleState ?? plan.lifecycleState;

  return (
    <div className="grid gap-3">
      <section className="rounded-md border bg-background/50 p-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source refs</h4>
        {sourceItemIds.length === 0 && sourceEpicIds.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">No source backlog or epic refs were recorded for this session plan.</p>
        ) : (
          <div className="mt-2 grid gap-2">
            <RefChips label="Backlog items" values={sourceItemIds} />
            <RefChips label="Epics" values={sourceEpicIds} />
          </div>
        )}
      </section>

      <section className="rounded-md border bg-background/50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lifecycle evidence</h4>
          {lifecycleState && <Badge variant="outline">{lifecycleState}</Badge>}
        </div>
        {rows.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">No queue, run, PR, or landing evidence has been linked yet.</p>
        ) : (
          <div className="mt-2 grid gap-2">
            {groupRows(rows).map(([kind, groupedRows]) => (
              <div key={kind} className="grid gap-1 rounded border border-border p-2">
                <h5 className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{kind}</h5>
                {groupedRows.map((row, index) => <EvidenceRow key={`${row.kind}-${row.stage ?? ''}-${index}`} row={row} knownItemIds={sourceItemIds} />)}
              </div>
            ))}
          </div>
        )}
      </section>

      {(itemRows.length > 0 || epicRows.length > 0) && (
        <section className="rounded-md border bg-background/50 p-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Partial progress</h4>
          {itemRows.length > 0 && <div className="mt-2 grid gap-1">{itemRows.map((row) => <ItemProgressRow key={row.itemId} row={row} />)}</div>}
          {epicRows.length > 0 && (
            <div className="mt-2 grid gap-2">
              {epicRows.map((epic) => (
                <div key={epic.epicId} className="rounded border border-border p-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <code className="text-text-bright">{epic.epicId}</code>
                    <span>{epic.title}</span>
                    {epic.lifecycleState && <Badge variant="outline">{epic.lifecycleState}</Badge>}
                    <span className="text-muted-foreground">{epic.shippedItemCount ?? 0}/{epic.totalItemCount ?? epic.itemRows?.length ?? 0} shipped</span>
                  </div>
                  {epic.itemRows && epic.itemRows.length > 0 && <div className="mt-2 grid gap-1">{epic.itemRows.map((row) => <ItemProgressRow key={row.itemId} row={row} />)}</div>}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function RefChips({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {values.map((value) => <code key={value} className="rounded border border-border bg-card px-1.5 py-0.5 text-text-bright">{value}</code>)}
    </div>
  );
}

function groupRows(rows: LifecycleLinkRow[]): Array<[string, LifecycleLinkRow[]]> {
  const grouped = new Map<string, LifecycleLinkRow[]>();
  for (const row of rows) grouped.set(row.kind, [...(grouped.get(row.kind) ?? []), row]);
  return [...grouped.entries()];
}

function EvidenceRow({ row, knownItemIds = [] }: { row: LifecycleLinkRow; knownItemIds?: string[] }) {
  const timestamp = row.timestamp ?? row.completedAt ?? row.landedAt ?? row.startedAt ?? row.queuedAt ?? row.promotedAt;
  // Drop affected ids already shown under Source refs so the same backlog id is
  // not repeated across every panel.
  const knownItemIdSet = new Set(knownItemIds);
  const extraAffectedItemIds = (row.affectedItemIds ?? []).filter((id) => !knownItemIdSet.has(id));
  return (
    <div className="rounded bg-card p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {row.stage && <Badge variant="secondary">{row.stage}</Badge>}
        {row.status && <span className="text-muted-foreground">{row.status}</span>}
        {timestamp && <code className="text-muted-foreground">{timestamp}</code>}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
        {row.session && <Value label="session" value={row.session} />}
        {row.prdId && <Value label="prd" value={row.prdId} />}
        {row.runId && <Value label="run" value={row.runId} />}
        {(row.sessionId ?? row.buildSessionId) && <Value label="build session" value={row.sessionId ?? row.buildSessionId ?? ''} />}
        {(row.featureBranch ?? row.branch) && <Value label="branch" value={row.featureBranch ?? row.branch ?? ''} />}
        {row.commitSha && <Value label="commit" value={row.commitSha} />}
      </div>
      {row.prUrl && <a className="mt-1 block break-all text-[color:var(--lane-ready)] underline" href={row.prUrl} target="_blank" rel="noreferrer">{row.prUrl}</a>}
      {extraAffectedItemIds.length > 0 && <p className="mt-1 text-muted-foreground">Affected item ids: {extraAffectedItemIds.join(', ')}</p>}
    </div>
  );
}

function ItemProgressRow({ row }: { row: LifecycleItemProgressRow }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-border bg-card p-2 text-xs">
      <code className="text-text-bright">{row.itemId}</code>
      {row.title && <span>{row.title}</span>}
      <Badge variant={row.shipped ? 'default' : 'outline'}>{row.lifecycleState ?? row.status ?? (row.shipped ? 'shipped' : 'open')}</Badge>
      {row.evidence && <span className="text-muted-foreground">{row.evidence}</span>}
    </div>
  );
}

function Value({ label, value }: { label: string; value: string }) {
  return <span><span className="uppercase tracking-wide">{label}:</span> <code>{value}</code></span>;
}
