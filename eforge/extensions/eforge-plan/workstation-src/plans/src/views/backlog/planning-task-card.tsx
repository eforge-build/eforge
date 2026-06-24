import * as React from 'react';
import { Trash2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { ToneChip } from '@/components/ui/tone-chip';
import { useToast } from '@/components/toast';
import { agentTaskTone } from '@/lib/tone';
import { formatRelativeTime, shortTaskId } from '@/lib/format-time';
import { isGeneratedPlannerPrompt, selectionItemsLabel } from '@/lib/plan-title';
import type { BacklogCurationProgress, JsonObject, PlanningAgentTaskListItem, PlanningAgentTaskRecord, PlanningTaskApplyError, PlanningTaskWorkflowEntry } from '@/types';
import { PlanningTaskResultPreview } from './planning-task-result-preview';
import type { RedraftInput } from './use-planning-task-workflows';

interface PlanningTaskCardProps {
  item: PlanningAgentTaskListItem;
  busy: boolean;
  /** Board id->title map so a task heading can name its backlog item(s). */
  titles?: Map<string, string>;
  onCancel: (taskId: string) => Promise<void>;
  onRemove: (taskId: string) => Promise<void>;
  onRetry: (taskId: string) => Promise<void>;
  onRedraft: (taskId: string, input: RedraftInput) => Promise<void>;
  onApply: (taskId: string, input: JsonObject) => Promise<unknown>;
  applyError?: PlanningTaskApplyError;
  detailLoading?: boolean;
  detailError?: string;
}

export function PlanningTaskCard({ item, busy, titles, onCancel, onRemove, onRetry, onRedraft, onApply, applyError, detailLoading = false, detailError }: PlanningTaskCardProps) {
  const { entry, task } = item;
  const status = task?.status ?? item.status ?? 'queued';
  const running = status === 'queued' || status === 'running';
  const heading = planningHeading(item, titles);
  const groupRef = entry.selection.recommendationRef ?? entry.selection.sourceRecommendationRef;
  const retryable = (status === 'failed' || status === 'cancelled') && item.available;
  const removable = !running;

  return (
    <article className="rounded-md border border-border bg-background/60 p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <ToneChip tone={agentTaskTone(status)} className="shrink-0 text-xs">{status}</ToneChip>
            <p className="line-clamp-2 min-w-0 flex-1 break-words font-medium leading-snug text-foreground" title={heading.full}>{heading.title}</p>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-muted-foreground">
            {entry.purpose === 'recommendation-refresh' && <span className="rounded border border-primary/30 bg-primary/10 px-1.5 text-text-bright">Recommendation refresh</span>}
            {entry.purpose === 'backlog-curation' && <span className="rounded border border-primary/30 bg-primary/10 px-1.5 text-text-bright">Backlog analysis</span>}
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

      {detailLoading && (
        <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Spinner className="h-3.5 w-3.5" /> Loading full task result…</p>
      )}
      {detailError && (
        <p className="mt-2 text-xs text-destructive-foreground">Could not load full task result: {detailError}</p>
      )}

      {applyError && (
        <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs">
          <p className="font-semibold text-destructive-foreground">{applyError.automatic ? 'Automatic session-plan creation failed.' : 'Session-plan creation failed.'}</p>
          <p className="mt-1 break-words text-destructive-foreground">{applyError.message}</p>
          <p className="mt-1 text-muted-foreground">Review the draft below, resolve any collision or validation issue, then use Create session plan to retry manually.</p>
        </div>
      )}

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
        <PlanningTaskResultPreview item={item} busy={busy} onRedraft={onRedraft} onApply={onApply} applyError={applyError} />
      )}
      {status === 'completed' && !task?.result && item.resultOmitted && !detailLoading && !detailError && (
        <p className="mt-2 text-xs text-muted-foreground">Open the task details to load the full generated result.</p>
      )}
    </article>
  );
}

// The stored request is a machine-built prompt ("Draft a session plan for
// recommendation group-x covering ...") used to seed the planner - not a title.
// Prefer the real plan topic once a draft exists; otherwise show a readable
// request (explicit goals, curation/refresh) or a compact selection label so the
// card heading stays scannable instead of restating the whole prompt.
function planningHeading(item: PlanningAgentTaskListItem, titles?: Map<string, string>): { title: string; full: string } {
  const { entry, task } = item;
  const topic = task?.result?.sessionPlanCreationDraft?.topic?.trim();
  const derived = entry.derivedRequest?.trim() ?? '';
  if (topic && !isGeneratedPlannerPrompt(topic)) return { title: topic, full: topic };
  if (derived && !isGeneratedPlannerPrompt(derived)) return { title: derived, full: derived };
  const fallback = `Plan ${selectionLabel(entry, titles)}`;
  return { title: fallback, full: derived || fallback };
}

function selectionLabel(entry: PlanningTaskWorkflowEntry, titles?: Map<string, string>): string {
  const group = entry.selection.recommendationRef ?? entry.selection.sourceRecommendationRef;
  if (group) return `lane ${group}`;
  const items = selectionItemsLabel(entry.selection, titles);
  if (items) return items;
  if (entry.selection.epicId) return `epic ${entry.selection.epicId}`;
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
  const backlogCurationProgress = task?.metadata?.backlogCurationProgress;
  const message = task?.metadata?.progressMessage;
  return (
    <div className="mt-2 grid gap-2 text-xs text-muted-foreground">
      <span className="flex items-start gap-2"><Spinner className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span className="min-w-0 break-words">{message ?? 'Planning in progress…'}</span></span>
      {backlogCurationProgress && <BacklogCurationProgressView progress={backlogCurationProgress} />}
      {progress && (
        <div className="grid gap-0.5 break-words">
          {progress.currentSection && <span>Current section: <span className="text-foreground">{progress.currentSection}</span></span>}
          {progress.coveredSections && progress.coveredSections.length > 0 && <span>Covered: {progress.coveredSections.join(', ')}</span>}
          {progress.remainingSections && progress.remainingSections.length > 0 && <span>Remaining: {progress.remainingSections.join(', ')}</span>}
        </div>
      )}
    </div>
  );
}

function BacklogCurationProgressView({ progress }: { progress: BacklogCurationProgress }) {
  const total = Math.max(0, progress.total);
  const percent = total === 0 ? 0 : Math.min(100, Math.round((progress.completed / total) * 100));
  const runningItems = progress.items.filter((item) => item.status === 'running');
  const allCompletedItems = progress.items.filter((item) => item.status === 'completed' || item.status === 'cache-hit');
  const completedItems = allCompletedItems.slice(0, 8);
  const allRemainingItems = progress.items.filter((item) => item.status === 'pending');
  const remainingItems = allRemainingItems.slice(0, 8);
  const failedItems = progress.items.filter((item) => item.status === 'failed' || item.status === 'cancelled');
  return (
    <div className="rounded-md border border-border/70 bg-muted/20 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-foreground">Backlog item agents</span>
        <span>{progress.completed}/{total} analyzed · {progress.running} running · {progress.remaining} remaining</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-3">
        <ProgressLane title="Running" items={runningItems} empty="No active item agents" />
        <ProgressLane title="Completed" items={completedItems} empty="No completed items yet" suffix={allCompletedItems.length > completedItems.length ? `+${allCompletedItems.length - completedItems.length} more` : undefined} />
        <ProgressLane title="Remaining" items={remainingItems} empty="No remaining items" suffix={allRemainingItems.length > remainingItems.length ? `+${allRemainingItems.length - remainingItems.length} more` : undefined} />
      </div>
      {failedItems.length > 0 && <ProgressLane className="mt-2" title="Needs attention" items={failedItems.slice(0, 6)} empty="" suffix={failedItems.length > 6 ? `+${failedItems.length - 6} more` : undefined} />}
    </div>
  );
}

function ProgressLane({ title, items, empty, suffix, className }: { title: string; items: BacklogCurationProgress['items']; empty: string; suffix?: string; className?: string }) {
  return (
    <div className={className}>
      <div className="mb-1 flex items-center justify-between gap-2 text-2xs uppercase tracking-wide text-muted-foreground">
        <span>{title}</span>
        <span>{items.length}{suffix ? ` ${suffix}` : ''}</span>
      </div>
      <div className="grid gap-1">
        {items.length === 0 && empty && <span className="rounded border border-dashed border-border px-2 py-1 text-muted-foreground">{empty}</span>}
        {items.map((item) => (
          <div key={`${title}-${item.itemId}`} title={item.summary ?? item.itemId} className="min-w-0 rounded border border-border/70 bg-background/70 px-2 py-1">
            <div className="truncate text-foreground">{item.title ?? item.itemId}</div>
            <div className="mt-0.5 flex flex-wrap gap-1 text-2xs">
              <span className="rounded bg-muted px-1">{item.status}</span>
              {item.verdict && <span className="rounded bg-primary/10 px-1 text-text-bright">{item.verdict}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
