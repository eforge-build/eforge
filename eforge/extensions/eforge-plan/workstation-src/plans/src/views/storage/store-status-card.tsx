import * as React from 'react';
import { Database } from 'lucide-react';
import { getBridge } from '@/bridge';
import { Button } from '@/components/ui/button';
import { RailCard } from '@/components/ui/rail-card';
import { ErrorBox } from '@/components/ui/error-box';
import type { JsonObject } from '@/types';
import type { MaintenanceActionReport, PlanningStoreStatus } from '@/workstation-view-model-types';
import { formatBytes, formatCount, storeStatusSummary } from '@/lib/sqlite-lifecycle-labels';

export function StoreStatusBadge({ status, error }: { status?: PlanningStoreStatus | null; error?: string | null }) {
  const summary = storeStatusSummary(status, error);
  return <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">SQLite store · {summary.label}</span>;
}

export function StoreStatusCard({ status, error, onRefresh }: { status: PlanningStoreStatus | null; error: string | null; onRefresh: () => Promise<void> }) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [report, setReport] = React.useState<MaintenanceActionReport | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [vacuumConfirm, setVacuumConfirm] = React.useState(false);
  const invoke = async (actionId: string, input: JsonObject = {}) => {
    setBusy(actionId); setActionError(null);
    try {
      const output = await getBridge().invokeAction<MaintenanceActionReport>(actionId, input);
      setReport(output);
      await onRefresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    } finally { setBusy(null); }
  };

  return (
    <RailCard icon={Database} title="SQLite store" contentClassName="grid gap-2">
      {error && <ErrorBox>{error}</ErrorBox>}
      {actionError && <ErrorBox>{actionError}</ErrorBox>}
      {!status ? <p className="text-2xs text-muted-foreground">Store status has not loaded yet.</p> : status.initialized ? <InitializedStatus status={status} /> : <MissingStore status={status} />}
      {status?.initialized && (
        <div className="grid gap-1.5 border-t border-border pt-2">
          <Button size="xs" variant="outline" disabled={busy !== null} onClick={() => void invoke('compact-planning-store', { dryRun: true, sampleLimit: 5 })}>Dry-run compaction</Button>
          <Button size="xs" variant="outline" disabled={busy !== null} onClick={() => void invoke('rebuild-search-index', {})}>Rebuild search index</Button>
          <Button size="xs" variant="outline" disabled={busy !== null} onClick={() => void invoke('optimize-search-index', {})}>Optimize search index</Button>
          <Button size="xs" variant={vacuumConfirm ? 'destructive' : 'outline'} disabled={busy !== null} onClick={() => { if (!vacuumConfirm) { setVacuumConfirm(true); return; } void invoke('vacuum-planning-store', {}); setVacuumConfirm(false); }}>{vacuumConfirm ? 'Confirm VACUUM' : 'Vacuum store…'}</Button>
          {busy && <p className="text-2xs text-muted-foreground">Running {busy}…</p>}
        </div>
      )}
      {report && <MaintenanceReportSummary report={report} />}
    </RailCard>
  );
}

function MissingStore({ status }: { status: PlanningStoreStatus }) {
  return (
    <div className="grid gap-1 text-2xs text-muted-foreground">
      <p>Store not initialized at <code>{status.storePath}</code>.</p>
      <p>Use <code>import-planning-store</code> through extension contribution invocation. Dry-run is the default; apply with <code>{'{ "dryRun": false }'}</code> or replace with <code>{'{ "dryRun": false, "replaceExisting": true }'}</code>.</p>
    </div>
  );
}

function MaintenanceReportSummary({ report }: { report: MaintenanceActionReport }) {
  const parts = [
    report.summary,
    report.status ? `status: ${report.status}` : undefined,
    report.runId ? `run: ${report.runId}` : undefined,
    report.category ? `category: ${report.category}` : undefined,
    countSummary('pruned', report.prunedCounts),
    countSummary('archived', report.archivedCounts),
    report.searchRefresh ? `search: refreshed ${report.searchRefresh.refreshed ?? 0}, deleted ${report.searchRefresh.deleted ?? 0}, cleared ${report.searchRefresh.clearedDirty ?? 0}` : undefined,
    report.beforeBytes !== undefined && report.afterBytes !== undefined ? `db: ${formatBytes(report.beforeBytes)} → ${formatBytes(report.afterBytes)}` : undefined,
    report.walBytesBefore !== undefined && report.walBytesAfter !== undefined ? `wal: ${formatBytes(report.walBytesBefore)} → ${formatBytes(report.walBytesAfter)}` : undefined,
  ].filter(Boolean);
  return <p className="rounded border border-border bg-muted/20 p-1.5 text-2xs text-muted-foreground">{parts.length > 0 ? parts.join(' · ') : `${report.actionId ?? 'Maintenance'} complete.`}</p>;
}

function countSummary(label: string, counts?: Record<string, number>) {
  if (!counts) return undefined;
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return `${label}: ${total}`;
}

function InitializedStatus({ status }: { status: PlanningStoreStatus }) {
  const search = status.searchIndexStatus;
  const recent = status.recentMaintenanceRuns[0];
  const recentSummary = recent ? [recent.summary, recent.status, recent.runId ?? recent.actionId, recent.finishedAt ?? recent.completedAt ?? recent.startedAt].filter(Boolean).join(' · ') : undefined;
  const retentionEntries = Object.entries(status.retentionEligibilityCounts).filter(([, count]) => count > 0);
  const eligibleCount = retentionEntries.reduce((sum, [, count]) => sum + count, 0);
  const retentionDetail = retentionEntries.map(([category, count]) => `${category}: ${count}`).join(' · ');
  return (
    <div className="grid gap-1 text-2xs text-muted-foreground">
      <p><span className="text-foreground">Schema:</span> {status.sqliteSchemaVersion ?? 'unknown'} · <code>{status.storePath}</code></p>
      <p><span className="text-foreground">Files:</span> SQLite {formatBytes(status.fileSizes.dbBytes)} · WAL {formatBytes(status.fileSizes.walBytes)} · SHM {formatBytes(status.fileSizes.shmBytes)}</p>
      {search && <p><span className="text-foreground">Search:</span> {search.dirty ? `index dirty (${search.dirtyCount} docs)` : 'index current'}{search.lastRebuiltAt ? ` · rebuilt ${search.lastRebuiltAt}` : ''}</p>}
      <p><span className="text-foreground">Retention:</span> {formatCount(eligibleCount, 'eligible record')}{retentionDetail ? ` · ${retentionDetail}` : ''}</p>
      {recentSummary && <p><span className="text-foreground">Recent:</span> {recentSummary}</p>}
    </div>
  );
}
