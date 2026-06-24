import * as React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/toast';
import type { EforgeBridge, PlanningAgentTaskListItem } from '@/types';

function compactItem(): PlanningAgentTaskListItem {
  return {
    entry: {
      taskId: 'task-omitted-result',
      originalRequest: '',
      derivedRequest: 'Draft a focused plan.',
      selection: {},
      requestedOutputSections: ['sessionPlanCreationDraft'],
      createdAt: '2026-06-07T00:30:00.000Z',
    },
    available: true,
    status: 'completed',
    resultOmitted: true,
    task: {
      taskId: 'task-omitted-result',
      kind: 'eforge-plan.planning-draft',
      status: 'completed',
      createdAt: '2026-06-07T00:30:00.000Z',
      updatedAt: '2026-06-07T00:30:06.000Z',
    },
  };
}

const bridge = { invokeAction: vi.fn<EforgeBridge['invokeAction']>() };
let originalEforge: EforgeBridge | undefined;

async function renderDrawer(item: PlanningAgentTaskListItem) {
  const { PlanningTaskDrawer } = await import('./planning-task-drawer');
  return render(
    <ToastProvider>
      <PlanningTaskDrawer
        item={item}
        busy={false}
        onCancel={vi.fn(async () => undefined)}
        onRemove={vi.fn(async () => undefined)}
        onRetry={vi.fn(async () => undefined)}
        onRedraft={vi.fn(async () => undefined)}
        onApply={vi.fn(async () => undefined)}
        onClose={vi.fn()}
      />
    </ToastProvider>,
  );
}

beforeAll(() => {
  originalEforge = window.eforge;
  window.eforge = bridge as unknown as EforgeBridge;
});

afterAll(() => {
  window.eforge = originalEforge;
});

afterEach(() => {
  cleanup();
  bridge.invokeAction.mockReset();
});

describe('PlanningTaskDrawer lazy task detail', () => {
  it('fetches full task detail when a compact list row omits the result', async () => {
    bridge.invokeAction.mockResolvedValue({
      task: {
        taskId: 'task-omitted-result',
        kind: 'eforge-plan.planning-draft',
        status: 'completed',
        createdAt: '2026-06-07T00:30:00.000Z',
        updatedAt: '2026-06-07T00:30:06.000Z',
        result: {
          summary: 'Full detail loaded.',
          assumptionsOpenQuestions: [],
          sessionPlanCreationDraft: {
            session: 'loaded-session',
            topic: 'Loaded detail plan',
            planningType: 'feature',
            planningDepth: 'focused',
            sections: [{ dimension: 'scope', content: 'Loaded scope.' }],
          },
        },
      },
    });

    await renderDrawer(compactItem());

    expect(screen.getByText('Loading full task result…')).toBeTruthy();
    await waitFor(() => expect(bridge.invokeAction).toHaveBeenCalledWith('get-planning-agent-task', { taskId: 'task-omitted-result' }));
    await waitFor(() => expect(screen.getByText('Full detail loaded.')).toBeTruthy());
  });

  it('surfaces lazy detail fetch failures', async () => {
    bridge.invokeAction.mockRejectedValue(new Error('daemon unavailable'));

    await renderDrawer(compactItem());

    await waitFor(() => expect(screen.getByText('Could not load full task result: daemon unavailable')).toBeTruthy());
  });
});
