import * as React from 'react';
import { Bot, Loader2 } from 'lucide-react';
import { CollapsiblePanel } from '@/components/collapsible-panel';
import { PlanningTaskCard } from './planning-task-card';
import type { PlanningTaskWorkflowsApi } from './use-planning-task-workflows';

interface PlanWithAiPanelProps {
  workflows: PlanningTaskWorkflowsApi;
}

/**
 * Durable monitor/results panel for daemon-owned planning tasks. There is no
 * free-form prompt/goal input: tasks are started from backlog selections,
 * recommendations, recommendation refresh controls, and the analyze-all backlog
 * action. This panel lists the durable task index, polls running tasks, and
 * surfaces progress, retry, redraft, and apply controls. It collapses to a
 * one-line summary so the board stays the primary surface; counts in the
 * header flag anything that needs attention.
 */
export function PlanWithAiPanel({ workflows }: PlanWithAiPanelProps) {
  const { items, loading, busy, reload, analyzeAllBacklog, cancel, retry, redraft, remove, apply } = workflows;
  const statusOf = (item: (typeof items)[number]) => item.task?.status ?? item.status;
  const activeCount = items.filter((item) => statusOf(item) === 'queued' || statusOf(item) === 'running').length;
  const failedCount = items.filter((item) => statusOf(item) === 'failed').length;
  const readyCount = items.filter((item) => statusOf(item) === 'completed' && item.task?.result && item.available).length;
  const curationRunningCount = items.filter((item) => item.entry.purpose === 'backlog-curation' && (statusOf(item) === 'queued' || statusOf(item) === 'running')).length;
  const curationReadyCount = items.filter((item) => item.entry.purpose === 'backlog-curation' && statusOf(item) === 'completed' && item.task?.result?.backlogCurationDraft && item.available).length;

  const summary = (
    <>
      {activeCount > 0 && (
        <span className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[0.68rem] text-text-bright">
          <Loader2 className="h-3 w-3 animate-spin" /> {activeCount} running
        </span>
      )}
      {readyCount > 0 && <span className="rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[0.68rem] text-text-bright">{readyCount} ready to review</span>}
      {curationRunningCount > 0 && <span className="rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[0.68rem] text-text-bright">{curationRunningCount} backlog curation running</span>}
      {curationReadyCount > 0 && <span className="rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[0.68rem] text-text-bright">{curationReadyCount} curation ready</span>}
      {failedCount > 0 && <span className="rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[0.68rem] text-destructive-foreground">{failedCount} failed</span>}
      {items.length === 0 && !loading && <span className="text-[0.68rem] text-muted-foreground">no tasks</span>}
    </>
  );

  return (
    <CollapsiblePanel
      storageKey="eforge-plan:panel:plan-with-ai"
      className="border-primary/30 bg-primary/5"
      icon={<Bot className="h-4 w-4 text-primary" />}
      title="Plan with AI"
      summary={summary}
      actions={<div className="flex flex-wrap items-center gap-2"><button type="button" className="text-xs text-primary hover:text-foreground disabled:opacity-50" disabled={busy || loading} onClick={() => void analyzeAllBacklog()}>Analyze all backlog</button><button type="button" className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50" disabled={busy || loading} onClick={() => void reload()}>Refresh tasks</button></div>}
    >
      <p className="text-xs text-muted-foreground">Planning tasks start from backlog selections and recommendations. Generated drafts stay read-only until you apply them.</p>

      {loading && items.length === 0 && (
        <p className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading planning tasks…</p>
      )}
      {!loading && items.length === 0 && (
        <p className="mt-3 text-xs text-muted-foreground">No planning tasks yet. Select ready backlog items (click a recommendation to add it to your selection) and choose <span className="text-foreground">Promote to a build plan</span>.</p>
      )}

      {items.length > 0 && (
        <div className="mt-3 grid gap-2">
          {items.map((item) => (
            <PlanningTaskCard
              key={item.entry.taskId}
              item={item}
              busy={busy}
              onCancel={cancel}
              onRemove={remove}
              onRetry={retry}
              onRedraft={redraft}
              onApply={apply}
            />
          ))}
        </div>
      )}
    </CollapsiblePanel>
  );
}
