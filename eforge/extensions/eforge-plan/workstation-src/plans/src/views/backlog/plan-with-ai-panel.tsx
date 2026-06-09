import * as React from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { PlanningTaskCard } from './planning-task-card';
import type { PlanningTaskWorkflowsApi } from './use-planning-task-workflows';

interface PlanWithAiPanelProps {
  workflows: PlanningTaskWorkflowsApi;
}

/**
 * Durable monitor/results panel for daemon-owned planning tasks. There is no
 * free-form prompt/goal input: tasks are started from backlog selections,
 * recommendations, and recommendation refresh controls elsewhere in the Backlog
 * tab. This panel lists the durable task index, polls running tasks, and
 * surfaces progress, retry, redraft, and apply controls.
 */
export function PlanWithAiPanel({ workflows }: PlanWithAiPanelProps) {
  const { items, loading, busy, reload, cancel, retry, redraft, remove, apply } = workflows;
  const activeCount = items.filter((item) => {
    const status = item.task?.status ?? item.status;
    return status === 'queued' || status === 'running';
  }).length;

  return (
    <section className="rounded-lg border border-primary/30 bg-primary/5 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-text-bright"><Sparkles className="h-4 w-4 text-primary" /> Plan with AI</h3>
          <p className="mt-1 text-xs text-muted-foreground">Daemon-owned planning tasks started from backlog selections and recommendations. Monitor progress, retry failures, answer clarifications, and apply ready drafts here. Generated output stays read-only until you confirm.</p>
        </div>
        <button type="button" className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50" disabled={busy || loading} onClick={() => void reload()}>Refresh tasks</button>
      </div>

      {loading && items.length === 0 && (
        <p className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading planning tasks…</p>
      )}
      {!loading && items.length === 0 && (
        <p className="mt-3 text-xs text-muted-foreground">No planning tasks yet. Select ready backlog items (click a recommendation to add it to your selection) and choose <span className="text-foreground">Promote to a build plan</span>.</p>
      )}

      {items.length > 0 && (
        <div className="mt-3 grid gap-2">
          {activeCount > 0 && <span className="text-xs text-muted-foreground">{activeCount} running</span>}
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
    </section>
  );
}
