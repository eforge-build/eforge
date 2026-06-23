import { Drawer } from '@/components/ui/drawer';
import type { JsonObject, PlanningAgentTaskListItem, PlanningTaskApplyError } from '@/types';
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
  applyError?: PlanningTaskApplyError;
  onClose: () => void;
}

/**
 * Non-modal detail drawer for a planning task. The activity rail stays a
 * glanceable digest; opening a task here gives it room for the full result
 * preview plus the apply / retry / redraft / dismiss controls without crowding
 * the narrow rail. It reuses PlanningTaskCard verbatim, so there is no separate
 * result-rendering path to keep in sync.
 */
export function PlanningTaskDrawer({ item, busy, titles, onCancel, onRemove, onRetry, onRedraft, onApply, applyError, onClose }: PlanningTaskDrawerProps) {
  return (
    <Drawer ariaLabel="Planning task details" title="Planning task" headerAlign="center" closeLabel="Close planning task" onClose={onClose}>
      <PlanningTaskCard
        item={item}
        busy={busy}
        titles={titles}
        onCancel={onCancel}
        onRemove={async (taskId) => { await onRemove(taskId); onClose(); }}
        onRetry={onRetry}
        onRedraft={onRedraft}
        onApply={onApply}
        applyError={applyError}
      />
    </Drawer>
  );
}
