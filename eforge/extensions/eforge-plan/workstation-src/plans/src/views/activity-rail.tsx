import { Activity, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatRelativeTime, shortTaskId } from '@/lib/format-time';
import type { AgentTaskStatus, PlanningAgentTaskListItem, PlanningTaskWorkflowEntry } from '@/types';
import type { PlanningTaskWorkflowsApi } from './backlog/use-planning-task-workflows';

// How many terminal (completed/failed/cancelled) tasks to surface alongside the
// always-shown running ones. The rail is a glanceable status digest, not the
// full task history - that lives in the Plan with AI focus.
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
}

function taskStatus(item: PlanningAgentTaskListItem): AgentTaskStatus | undefined {
  return item.task?.status ?? item.status;
}

function isRunning(item: PlanningAgentTaskListItem): boolean {
  const status = taskStatus(item);
  return status === 'queued' || status === 'running';
}

// Human label for a planning task derived from its durable workflow entry. The
// rail never shows raw selection ids when a friendlier descriptor exists.
function taskLabel(entry: PlanningTaskWorkflowEntry): string {
  if (entry.purpose === 'recommendation-refresh') return 'Recommendation refresh';
  if (entry.purpose === 'backlog-curation') return entry.scanMode === 'full-implementation-audit' ? 'Backlog audit' : 'Backlog curation';
  if (entry.session) return `Plan ${entry.session}`;
  const ref = entry.selection?.recommendationRef ?? entry.selection?.sourceRecommendationRef;
  if (ref) return `Plan lane ${ref}`;
  const count = entry.selection?.itemIds?.length ?? 0;
  if (count > 0) return `Plan ${count} item${count === 1 ? '' : 's'}`;
  if (entry.selection?.epicId) return `Plan epic ${entry.selection.epicId}`;
  return 'Planning task';
}

/**
 * Extension-scoped activity rail. Surfaces only the planning/curation agent
 * tasks the workstation itself drives - recommendation freshness lives with the
 * recommendations digest, and global build status lives in the top bar; neither
 * is mirrored here.
 */
export function ActivityRail({ workflows }: ActivityRailProps) {
  const running = workflows.items.filter(isRunning);
  const recent = workflows.items.filter((item) => !isRunning(item)).slice(0, RECENT_TERMINAL_LIMIT);
  const visible = [...running, ...recent];

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
                <TaskRow key={item.entry.taskId} item={item} busy={workflows.busy} onCancel={() => void workflows.cancel(item.entry.taskId)} />
              ))}
        </CardContent>
      </Card>

      <p className="px-1 text-2xs leading-relaxed text-muted-foreground">
        Builds run in the global queue (see the top bar). Open a plan to follow its build.
      </p>
    </div>
  );
}

function TaskRow({ item, busy, onCancel }: { item: PlanningAgentTaskListItem; busy: boolean; onCancel: () => void }) {
  const status = taskStatus(item);
  const label = taskLabel(item.entry);
  const message = item.task?.metadata?.progressMessage ?? item.staleReason;
  const time = formatRelativeTime(item.task?.startedAt ?? item.entry.createdAt);
  return (
    <div className="rounded-md border border-border bg-background/40 p-2">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-bright" title={label}>{label}</span>
        {status && <span className={`shrink-0 rounded border px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide ${STATUS_TONE[status]}`}>{status}</span>}
      </div>
      <div className="mt-1 flex items-center gap-2 text-2xs text-muted-foreground">
        <code title={item.entry.taskId}>{shortTaskId(item.entry.taskId)}</code>
        {time && <span>· {time}</span>}
        {isRunning(item) && (
          <Button variant="ghost" size="sm" className="ml-auto h-6 px-2 text-2xs" disabled={busy} onClick={onCancel}>
            <X className="h-3 w-3" /> Cancel
          </Button>
        )}
      </div>
      {message && <p className="mt-1 truncate text-2xs text-muted-foreground" title={message}>{message}</p>}
    </div>
  );
}
