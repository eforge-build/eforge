import * as React from 'react';
import { X } from 'lucide-react';
import type { JsonObject, PlanningAgentTaskListItem } from '@/types';
import { PlanningTaskCard } from './planning-task-card';
import type { RedraftInput } from './use-planning-task-workflows';

interface PlanningTaskDrawerProps {
  item: PlanningAgentTaskListItem;
  busy: boolean;
  /** Board id->title map so the task heading can name its backlog item(s). */
  titles?: Map<string, string>;
  onCancel: (taskId: string) => Promise<void>;
  onRemove: (taskId: string) => Promise<void>;
  onRetry: (taskId: string) => Promise<void>;
  onRedraft: (taskId: string, input: RedraftInput) => Promise<void>;
  onApply: (taskId: string, input: JsonObject) => Promise<unknown>;
  onClose: () => void;
}

/**
 * Non-modal detail drawer for a planning task. The activity rail stays a
 * glanceable digest; opening a task here gives it room for the full result
 * preview plus the apply / retry / redraft / dismiss controls without crowding
 * the narrow rail. It reuses PlanningTaskCard verbatim, so there is no separate
 * result-rendering path to keep in sync.
 */
export function PlanningTaskDrawer({ item, busy, titles, onCancel, onRemove, onRetry, onRedraft, onApply, onClose }: PlanningTaskDrawerProps) {
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <aside className="fixed inset-y-0 right-0 z-30 flex w-[34rem] max-w-full flex-col border-l border-border bg-card shadow-2xl" aria-label="Planning task details">
      <header className="flex items-center gap-2 border-b border-border p-4">
        <h3 className="min-w-0 flex-1 text-sm font-semibold leading-snug text-text-bright">Planning task</h3>
        <button type="button" aria-label="Close planning task" className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        <PlanningTaskCard
          item={item}
          busy={busy}
          titles={titles}
          onCancel={onCancel}
          onRemove={async (taskId) => { await onRemove(taskId); onClose(); }}
          onRetry={onRetry}
          onRedraft={onRedraft}
          onApply={onApply}
        />
      </div>
    </aside>
  );
}
