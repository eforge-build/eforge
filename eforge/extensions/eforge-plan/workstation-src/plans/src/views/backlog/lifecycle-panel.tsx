import * as React from 'react';
import type { BoardItem, LifecycleLinkRow } from '@/types';
import { shortId } from './board-model';

const CHIP_TONE: Record<string, string> = {
  Plan: 'border-primary/30 text-text-bright bg-primary/10',
  Queue: 'border-[color:var(--lane-ready)]/30 text-[color:var(--lane-ready)] bg-[color:var(--lane-ready)]/10',
  Run: 'border-[color:var(--lane-progress)]/30 text-[color:var(--lane-progress)] bg-[color:var(--lane-progress)]/10',
  'PR open': 'border-[color:var(--prio-medium)]/40 text-[color:var(--prio-medium)] bg-[color:var(--prio-medium)]/10',
  Merged: 'border-[color:var(--lane-done)]/40 text-[color:var(--lane-done)] bg-[color:var(--lane-done)]/10',
  Failed: 'border-[color:var(--lane-blocked)]/40 text-[color:var(--lane-blocked)] bg-[color:var(--lane-blocked)]/10',
  Partial: 'border-[color:var(--prio-medium)]/40 text-[color:var(--prio-medium)] bg-[color:var(--prio-medium)]/10',
};

// Most significant chip first: failures and review-needing states outrank
// progress states. The compact card shows only the winner; the drawer shows all.
const CHIP_SEVERITY = ['Failed', 'Partial', 'PR open', 'Merged', 'Run', 'Queue', 'PR', 'Plan'] as const;

// On cards only attention states keep color (failures, open PRs, running
// builds); steady states render muted so the column does the talking.
const SUMMARY_TONE: Record<string, string> = {
  Failed: CHIP_TONE.Failed,
  Partial: CHIP_TONE.Partial,
  'PR open': CHIP_TONE['PR open'],
  Run: CHIP_TONE.Run,
};

/**
 * Single most significant lifecycle chip for the compact card, or null when
 * the item has no lifecycle evidence. 'Plan' is suppressed here: nearly every
 * item has a plan link, so on cards it is noise - the drawer still shows it.
 */
export function summaryLifecycleChip(item: BoardItem): { label: string; className: string } | null {
  if ((item.lifecycleLinks ?? []).length === 0 && !item.lifecycleState) return null;
  const chips = new Set(lifecycleChips(item));
  const label = CHIP_SEVERITY.find((candidate) => chips.has(candidate)) ?? [...chips][0];
  if (!label || label === 'Plan') return null;
  return { label, className: SUMMARY_TONE[label] ?? 'border-border text-muted-foreground' };
}

export function LifecyclePanel({ item }: { item: BoardItem }) {
  const rows = item.lifecycleLinks ?? [];
  if (rows.length === 0 && !item.lifecycleState) return null;
  const chips = lifecycleChips(item);
  return (
    <div className="mt-2" onClick={(event) => event.stopPropagation()}>
      <div className="flex flex-wrap gap-1" aria-label="Lifecycle chips">
        {chips.map((chip) => <LifecycleChip key={chip} label={chip} />)}
      </div>
      {rows.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted-foreground">Lifecycle evidence</summary>
          <div className="mt-2 grid gap-1.5">
            {rows.map((row, index) => <LifecycleRow key={`${row.kind}-${row.stage ?? ''}-${index}`} row={row} />)}
          </div>
        </details>
      )}
    </div>
  );
}

function lifecycleChips(item: BoardItem): string[] {
  const chips = new Set<string>();
  for (const row of item.lifecycleLinks ?? []) {
    const stage = (row.stage ?? row.status ?? '').toLowerCase();
    if (row.kind === 'session-plan') chips.add('Plan');
    if (row.kind === 'queue-prd') chips.add('Queue');
    if (row.kind === 'build-run' || row.kind === 'build-session') chips.add('Run');
    if (row.kind === 'pr') chips.add(stage.includes('open') ? 'PR open' : 'PR');
    if (row.kind === 'landing' && (stage.includes('landed') || stage.includes('merge'))) chips.add('Merged');
    if (stage.includes('fail')) chips.add('Failed');
  }
  const state = (item.lifecycleState ?? '').toLowerCase();
  if (state === 'partial') chips.add('Partial');
  if (state === 'failed') chips.add('Failed');
  if (state === 'merged' || state === 'shipped' || state === 'landed') chips.add('Merged');
  return chips.size > 0 ? [...chips] : ['Plan'];
}

function LifecycleChip({ label }: { label: string }) {
  return <span className={`rounded border px-1.5 py-0.5 text-2xs font-semibold ${CHIP_TONE[label] ?? 'border-border text-muted-foreground'}`}>{label}</span>;
}

function LifecycleRow({ row }: { row: LifecycleLinkRow }) {
  const timestamp = row.timestamp ?? row.completedAt ?? row.landedAt ?? row.startedAt ?? row.queuedAt ?? row.promotedAt;
  const branch = row.featureBranch ?? row.branch;
  return (
    <div className="rounded border border-border bg-background/50 p-2 text-2xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded bg-secondary px-1.5 py-0.5 font-semibold uppercase tracking-wide text-muted-foreground">{row.kind}</span>
        {row.stage && <span className="text-text-bright">{row.stage}</span>}
        {row.status && <span className="text-muted-foreground">{row.status}</span>}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
        {row.session && <Value label="session" value={row.session} />}
        {row.prdId && <Value label="prd" value={row.prdId} />}
        {row.runId && <Value label="run" value={row.runId} />}
        {row.sessionId && <Value label="build session" value={row.sessionId} />}
        {row.buildSessionId && <Value label="build session" value={row.buildSessionId} />}
        {branch && <Value label="branch" value={branch} />}
        {row.commitSha && <Value label="commit" value={row.commitSha} />}
        {timestamp && <Value label="time" value={timestamp} />}
      </div>
      {row.prUrl && <a className="mt-1 block break-all text-[color:var(--lane-ready)] underline" href={row.prUrl} target="_blank" rel="noreferrer">{row.prUrl}</a>}
      {row.affectedItemIds && row.affectedItemIds.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1 text-muted-foreground">
          <span>affected</span>
          {row.affectedItemIds.map((id) => <code key={id} className="rounded border px-1">{shortId(id)}</code>)}
        </div>
      )}
    </div>
  );
}

function Value({ label, value }: { label: string; value: string }) {
  return <span><span className="uppercase tracking-wide">{label}:</span> <code>{value}</code></span>;
}
