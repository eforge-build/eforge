import * as React from 'react';
import { getBridge } from '@/bridge';
import { Drawer } from '@/components/ui/drawer';
import type { JsonObject, PlanningAgentTaskListItem, PlanningAgentTaskResponse, PlanningTaskApplyError } from '@/types';
import { PlanningTaskActivityTimeline } from './planning-task-activity';
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
const bridge = getBridge();

export function PlanningTaskDrawer({ item, busy, titles, onCancel, onRemove, onRetry, onRedraft, onApply, applyError, onClose }: PlanningTaskDrawerProps) {
  const [detailItem, setDetailItem] = React.useState<PlanningAgentTaskListItem>(item);
  const [detailState, setDetailState] = React.useState<'idle' | 'loading' | 'error'>('idle');
  const [detailError, setDetailError] = React.useState<string | undefined>();

  React.useEffect(() => {
    setDetailItem(item);
    setDetailError(undefined);
    if (item.resultOmitted !== true) { setDetailState('idle'); return undefined; }
    let active = true;
    setDetailState('loading');
    void bridge.invokeAction<PlanningAgentTaskResponse>('get-planning-agent-task', { taskId: item.entry.taskId })
      .then((response) => {
        if (!active) return;
        setDetailItem({ ...item, available: true, status: response.task.status, task: response.task, resultOmitted: false });
        setDetailState('idle');
      })
      .catch((caught) => {
        if (!active) return;
        setDetailError(caught instanceof Error ? caught.message : String(caught));
        setDetailState('error');
      });
    return () => { active = false; };
  }, [item]);

  return (
    <Drawer ariaLabel="Planning task details" title="Planning task" headerAlign="center" closeLabel="Close planning task" onClose={onClose}>
      <PlanningTaskCard
        item={detailItem}
        busy={busy}
        titles={titles}
        onCancel={onCancel}
        onRemove={async (taskId) => { await onRemove(taskId); onClose(); }}
        onRetry={onRetry}
        onRedraft={onRedraft}
        onApply={onApply}
        applyError={applyError}
        detailLoading={detailState === 'loading'}
        detailError={detailError}
      />
      <PlanningTaskActivityTimeline activityLog={detailItem.task?.metadata?.activityLog} />
    </Drawer>
  );
}
