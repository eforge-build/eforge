import * as React from 'react';
import { Loader2, Trash2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/toast';
import { formatRelativeTime, shortTaskId } from '@/lib/format-time';
import { isGeneratedPlannerPrompt } from '@/lib/plan-title';
import type { JsonObject, PlanningAgentTaskListItem, PlanningAgentTaskRecord, PlanningTaskWorkflowEntry } from '@/types';
import { PlanningTaskResultPreview } from './planning-task-result-preview';
import type { RedraftInput } from './use-planning-task-workflows';

interface PlanningTaskCardProps {
  item: PlanningAgentTaskListItem;
  busy: boolean;
  onCancel: (taskId: string) => Promise<void>;
  onRemove: (taskId: string) => Promise<void>;
  onRetry: (taskId: string) => Promise<void>;
  onRedraft: (taskId: string, input: RedraftInput) => Promise<void>;
  onApply: (taskId: string, input: JsonObject) => Promise<unknown>;
}

const STATUS_TONE: Record<string, string> = {
  queued: 'border-border text-muted-foreground',
  running: 'border-primary/40 text-text-bright',
  completed: 'border-primary/40 text-text-bright',
  failed: 'border-destructive/40 text-destructive-foreground',
  cancelled: 'border-border text-muted-foreground',
};

export function PlanningTaskCard({ item, busy, onCancel, onRemove, onRetry, onRedraft, onApply }: PlanningTaskCardProps) {
  const { entry, task } = item;
  const status = task?.status ?? item.status ?? 'queued';
  const running = status === 'queued' || status === 'running';
  const heading = planningHeading(item);
  const groupRef = entry.selection.recommendationRef ?? entry.selection.sourceRecommendationRef;
  const retryable = (status === 'failed' || status === 'cancelled') && item.available;
  const removable = !running;

  return (
    <article className="rounded-md border border-border bg-background/60 p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`shrink-0 rounded border px-1.5 py-0.5 text-xs ${STATUS_TONE[status] ?? STATUS_TONE.queued}`}>{status}</span>
            <p className="line-clamp-2 min-w-0 flex-1 break-words font-medium leading-snug text-foreground" title={heading.full}>{heading.title}</p>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-muted-foreground">
            {entry.purpose === 'recommendation-refresh' && <span className="rounded border border-primary/30 bg-primary/10 px-1.5 text-text-bright">Recommendation refresh</span>}
            {entry.purpose === 'backlog-curation' && <span className="rounded border border-primary/30 bg-primary/10 px-1.5 text-text-bright">Backlog curation</span>}
            <TaskIdBadge taskId={entry.taskId} />
            {groupRef && <span className="max-w-full truncate" title={groupRef}>{groupRef}</span>}
            {entry.parentTaskId && <span title={entry.parentTaskId}>↳ {shortTaskId(entry.parentTaskId)}</span>}
            {entry.createdAt && <span title={entry.createdAt}>started {formatRelativeTime(entry.createdAt)}</span>}
            {entry.appliedAt && <span title={entry.appliedAt}>applied {formatRelativeTime(entry.appliedAt)}</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {running && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void onCancel(entry.taskId)}><XCircle className="h-4 w-4" /> Cancel</Button>
          )}
          {removable && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onRemove(entry.taskId)}><Trash2 className="h-4 w-4" /> Dismiss</Button>
          )}
        </div>
      </div>

      {!item.available && <p className="mt-2 text-xs text-muted-foreground">{item.staleReason ?? 'Task record is no longer available from the daemon.'}</p>}

      {running && <RunningProgress task={task} />}

      {status === 'failed' && (
        <div className="mt-2 grid gap-2">
          <p className="text-xs text-destructive-foreground">{task?.errorMessage ?? task?.errorCode ?? 'Task failed.'}</p>
          {retryable && <div><Button size="sm" variant="secondary" disabled={busy} onClick={() => void onRetry(entry.taskId)}>Retry with preserved context</Button></div>}
        </div>
      )}

      {status === 'cancelled' && (
        <div className="mt-2 grid gap-2">
          <p className="text-xs text-muted-foreground">{task?.errorMessage ?? 'Task cancelled.'}</p>
          {retryable && <div><Button size="sm" variant="secondary" disabled={busy} onClick={() => void onRetry(entry.taskId)}>Retry with preserved context</Button></div>}
        </div>
      )}

      {status === 'completed' && task?.result && (
        <PlanningTaskResultPreview item={item} busy={busy} onRedraft={onRedraft} onApply={onApply} />
      )}
    </article>
  );
}

// The stored request is a machine-built prompt ("Draft a session plan for
// recommendation group-x covering ...") used to seed the planner - not a title.
// Prefer the real plan topic once a draft exists; otherwise show a readable
// request (explicit goals, curation/refresh) or a compact selection label so the
// card heading stays scannable instead of restating the whole prompt.
function planningHeading(item: PlanningAgentTaskListItem): { title: string; full: string } {
  const { entry, task } = item;
  const topic = task?.result?.sessionPlanCreationDraft?.topic?.trim();
  const derived = entry.derivedRequest?.trim() ?? '';
  if (topic && !isGeneratedPlannerPrompt(topic)) return { title: topic, full: topic };
  if (derived && !isGeneratedPlannerPrompt(derived)) return { title: derived, full: derived };
  const fallback = `Plan ${selectionLabel(entry)}`;
  return { title: fallback, full: derived || fallback };
}

function selectionLabel(entry: PlanningTaskWorkflowEntry): string {
  const group = entry.selection.recommendationRef ?? entry.selection.sourceRecommendationRef;
  if (group) return group;
  if (entry.selection.epicId) return `epic ${entry.selection.epicId}`;
  const count = entry.selection.itemIds?.length ?? 0;
  if (count > 0) return `${count} backlog item${count === 1 ? '' : 's'}`;
  return shortTaskId(entry.taskId);
}

// Task ids are UUID-sized; show the short form and copy the full id on click
// so it never has to be read or transcribed from the screen.
function TaskIdBadge({ taskId }: { taskId: string }) {
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(taskId);
      toast.push('Task id copied', 'success');
    } catch {
      toast.push('Could not copy task id', 'error');
    }
  };
  return (
    <button type="button" title={`${taskId}\n\nClick to copy the full task id.`} onClick={() => void copy()} className="font-mono text-xs text-muted-foreground hover:text-foreground">
      {shortTaskId(taskId)}
    </button>
  );
}

function RunningProgress({ task }: { task?: PlanningAgentTaskRecord }) {
  const progress = task?.metadata?.sectionProgress;
  const message = task?.metadata?.progressMessage;
  return (
    <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {message ?? 'Planning in progress…'}</span>
      {progress && (
        <div className="grid gap-0.5">
          {progress.currentSection && <span>Current section: <span className="text-foreground">{progress.currentSection}</span></span>}
          {progress.coveredSections && progress.coveredSections.length > 0 && <span>Covered: {progress.coveredSections.join(', ')}</span>}
          {progress.remainingSections && progress.remainingSections.length > 0 && <span>Remaining: {progress.remainingSections.join(', ')}</span>}
        </div>
      )}
    </div>
  );
}
