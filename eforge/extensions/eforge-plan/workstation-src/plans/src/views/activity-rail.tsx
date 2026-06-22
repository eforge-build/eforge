import * as React from 'react';
import { Activity, ChevronRight, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatRelativeTime, shortTaskId } from '@/lib/format-time';
import { selectionItemsLabel } from '@/lib/plan-title';
import type { AgentTaskStatus, PlanningAgentTaskListItem, PlanningTaskApplyError, PlanningTaskWorkflowEntry } from '@/types';
import type { PlanningTaskWorkflowsApi } from './backlog/use-planning-task-workflows';
import { PlanningTaskDrawer } from './backlog/planning-task-drawer';

// How many terminal (completed/failed/cancelled) tasks to surface alongside the
// always-shown running ones. The rail is a glanceable status digest; opening a
// task reveals its full result and controls in a drawer.
const RECENT_TERMINAL_LIMIT = 4;

const STATUS_TONE: Record<AgentTaskStatus, string> = {
  queued: 'border-[color:var(--prio-medium)]/40 text-[color:var(--prio-medium)] bg-[color:var(--prio-medium)]/10',
  running: 'border-[color:var(--lane-progress)]/40 text-[color:var(--lane-progress)] bg-[color:var(--lane-progress)]/10',
  completed: 'border-[color:var(--lane-done)]/40 text-[color:var(--lane-done)] bg-[color:var(--lane-done)]/10',
  failed: 'border-[color:var(--lane-blocked)]/40 text-[color:var(--lane-blocked)] bg-[color:var(--lane-blocked)]/10',
  cancelled: 'border-border text-muted-foreground',
};

interface ActivityRailProps {
  workflows: PlanningTaskWorkflowsApi;
  /** Board id->title map so task rows can name their backlog item(s). */
  titles?: Map<string, string>;
}

function taskStatus(item: PlanningAgentTaskListItem): AgentTaskStatus | undefined {
  return item.task?.status ?? item.status;
}

function isRunning(item: PlanningAgentTaskListItem): boolean {
  const status = taskStatus(item);
  return status === 'queued' || status === 'running';
}

// A completed task with a stored result invites review - that is where apply /
// redraft live in the drawer.
function isReviewable(item: PlanningAgentTaskListItem): boolean {
  return taskStatus(item) === 'completed' && Boolean(item.task?.result) && item.available;
}

// Human label for a planning task derived from its durable workflow entry. The
// rail names the backlog item(s) it plans when titles are available, so a
// running task reads as what it is for rather than a generic count.
function taskLabel(entry: PlanningTaskWorkflowEntry, titles?: Map<string, string>): string {
  if (entry.purpose === 'recommendation-refresh') return 'Recommendation refresh';
  if (entry.purpose === 'backlog-curation') return 'Backlog audit';
  if (entry.session) return `Plan ${entry.session}`;
  const ref = entry.selection?.recommendationRef ?? entry.selection?.sourceRecommendationRef;
  if (ref) return `Plan lane ${ref}`;
  const items = entry.selection ? selectionItemsLabel(entry.selection, titles) : null;
  if (items) return `Plan: ${items}`;
  if (entry.selection?.epicId) return `Plan epic ${entry.selection.epicId}`;
  return 'Planning task';
}

/**
 * Extension-scoped activity rail. Surfaces only the planning/curation agent
 * tasks the workstation itself drives - recommendation freshness lives with the
 * recommendations digest, and global build status lives in the top bar; neither
 * is mirrored here. Opening a task slides out a drawer with its full result and
 * the apply / retry / redraft controls.
 */
export function ActivityRail({ workflows, titles }: ActivityRailProps) {
  const running = workflows.items.filter(isRunning);
  const applyFailed = workflows.items.filter((item) => !isRunning(item) && Boolean(workflows.applyErrors[item.entry.taskId]));
  const pinnedIds = new Set([...running, ...applyFailed].map((item) => item.entry.taskId));
  const recent = workflows.items.filter((item) => !isRunning(item) && !pinnedIds.has(item.entry.taskId)).slice(0, RECENT_TERMINAL_LIMIT);
  const visible = [...running, ...applyFailed, ...recent];

  const [openTaskId, setOpenTaskId] = React.useState<string | null>(null);
  const openItem = openTaskId ? workflows.items.find((item) => item.entry.taskId === openTaskId) ?? null : null;
  // Drop the drawer if its task leaves the list (dismissed, or applied a plan
  // and was cleared from the index).
  React.useEffect(() => {
    if (openTaskId && !workflows.items.some((item) => item.entry.taskId === openTaskId)) setOpenTaskId(null);
  }, [openTaskId, workflows.items]);

  return (
    <div className="grid gap-3" aria-label="Workstation activity">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Activity className="h-4 w-4 text-primary" /> Planning activity
            {running.length > 0 && <Badge variant="outline" className="ml-auto">{running.length} running</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          {workflows.loading && visible.length === 0
            ? <p className="text-xs text-muted-foreground">Loading tasks…</p>
            : visible.length === 0
              ? <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">No planning tasks yet.</p>
              : visible.map((item) => (
                <TaskRow
                  key={item.entry.taskId}
                  item={item}
                  busy={workflows.busy}
                  titles={titles}
                  applyError={workflows.applyErrors[item.entry.taskId]}
                  onOpen={() => setOpenTaskId(item.entry.taskId)}
                  onCancel={() => void workflows.cancel(item.entry.taskId)}
                />
              ))}
        </CardContent>
      </Card>

      <p className="px-1 text-2xs leading-relaxed text-muted-foreground">
        Builds run in the global queue (see the top bar). Open a plan to follow its build.
      </p>

      {openItem && (
        <PlanningTaskDrawer
          item={openItem}
          busy={workflows.busy}
          titles={titles}
          onCancel={workflows.cancel}
          onRemove={workflows.remove}
          onRetry={workflows.retry}
          onRedraft={workflows.redraft}
          onApply={workflows.apply}
          applyError={workflows.applyErrors[openItem.entry.taskId]}
          onClose={() => setOpenTaskId(null)}
        />
      )}
    </div>
  );
}

function TaskRow({ item, busy, titles, applyError, onOpen, onCancel }: { item: PlanningAgentTaskListItem; busy: boolean; titles?: Map<string, string>; applyError?: PlanningTaskApplyError; onOpen: () => void; onCancel: () => void }) {
  const status = taskStatus(item);
  const label = taskLabel(item.entry, titles);
  const message = applyError?.message ?? item.task?.metadata?.progressMessage ?? item.staleReason;
  const time = formatRelativeTime(item.task?.startedAt ?? item.entry.createdAt);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(); } }}
      className="cursor-pointer rounded-md border border-border bg-background/40 p-2 text-left transition-colors hover:border-primary"
    >
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-bright" title={label}>{label}</span>
        {/* --- eforge:region plan-04-workstation-session-plan-auto-apply --- */}
        {applyError && <span className="shrink-0 rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-2xs text-destructive-foreground">Apply failed</span>}
        {/* --- eforge:endregion plan-04-workstation-session-plan-auto-apply --- */}
        {isReviewable(item) && <span className="shrink-0 rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-2xs text-text-bright">Review</span>}
        {status && <span className={`shrink-0 rounded border px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide ${STATUS_TONE[status]}`}>{status}</span>}
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </div>
      <div className="mt-1 flex items-center gap-2 text-2xs text-muted-foreground">
        <code title={item.entry.taskId}>{shortTaskId(item.entry.taskId)}</code>
        {time && <span>· {time}</span>}
        {isRunning(item) && (
          <Button variant="ghost" size="sm" className="ml-auto h-6 px-2 text-2xs" disabled={busy} onClick={(event) => { event.stopPropagation(); onCancel(); }}>
            <X className="h-3 w-3" /> Cancel
          </Button>
        )}
      </div>
      {message && <p className="mt-1 truncate text-2xs text-muted-foreground" title={message}>{message}</p>}
    </div>
  );
}
