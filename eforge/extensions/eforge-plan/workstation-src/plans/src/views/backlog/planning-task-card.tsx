import * as React from 'react';
import { Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { JsonObject, PlanningAgentTaskListItem, PlanningAgentTaskRecord } from '@/types';
import { PlanningTaskResultPreview } from './planning-task-result-preview';
import type { RedraftInput } from './use-planning-task-workflows';

interface PlanningTaskCardProps {
  item: PlanningAgentTaskListItem;
  busy: boolean;
  onCancel: (taskId: string) => Promise<void>;
  onRetry: (taskId: string) => Promise<void>;
  onRedraft: (taskId: string, input: RedraftInput) => Promise<void>;
  onApply: (taskId: string, input: JsonObject) => Promise<void>;
}

const STATUS_TONE: Record<string, string> = {
  queued: 'border-border text-muted-foreground',
  running: 'border-primary/40 text-text-bright',
  completed: 'border-primary/40 text-text-bright',
  failed: 'border-destructive/40 text-destructive-foreground',
  cancelled: 'border-border text-muted-foreground',
};

export function PlanningTaskCard({ item, busy, onCancel, onRetry, onRedraft, onApply }: PlanningTaskCardProps) {
  const { entry, task } = item;
  const status = task?.status ?? item.status ?? 'queued';
  const running = status === 'queued' || status === 'running';
  const label = entry.derivedRequest || entry.originalRequest || entry.taskId;
  const retryable = (status === 'failed' || status === 'cancelled') && item.available;

  return (
    <article className="rounded-md border border-border bg-background/60 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded border px-1.5 py-0.5 text-xs ${STATUS_TONE[status] ?? STATUS_TONE.queued}`}>{status}</span>
            <span className="font-mono text-xs text-muted-foreground">{entry.taskId}</span>
            {entry.parentTaskId && <span className="text-[0.65rem] text-muted-foreground">↳ from {entry.parentTaskId}</span>}
          </div>
          <p className="mt-1 truncate text-foreground" title={label}>{label}</p>
        </div>
        {running && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void onCancel(entry.taskId)}><XCircle className="h-4 w-4" /> Cancel</Button>
        )}
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
