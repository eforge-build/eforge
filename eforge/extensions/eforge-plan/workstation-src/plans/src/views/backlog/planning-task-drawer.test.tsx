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

function runningItemWithActivity(): PlanningAgentTaskListItem {
  return {
    entry: {
      taskId: 'task-running-activity',
      originalRequest: '',
      derivedRequest: 'Draft a focused plan.',
      selection: {},
      requestedOutputSections: ['sessionPlanCreationDraft'],
      createdAt: '2026-06-07T00:30:00.000Z',
    },
    available: true,
    status: 'running',
    task: {
      taskId: 'task-running-activity',
      kind: 'eforge-plan.planning-draft',
      status: 'running',
      createdAt: '2026-06-07T00:30:00.000Z',
      updatedAt: '2026-06-07T00:30:06.000Z',
      startedAt: '2026-06-07T00:30:01.000Z',
      metadata: {
        progressMessage: 'Drafting scope…',
        activityLog: [
          { timestamp: '2026-06-07T00:30:01.000Z', message: 'Planner task started.' },
          { timestamp: '2026-06-07T00:30:05.000Z', message: 'Drafted scope section.' },
        ],
      },
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
  it('renders running task activity with newest label and inspectable timestamps', async () => {
    await renderDrawer(runningItemWithActivity());

    expect(screen.getByText('Latest activity')).toBeTruthy();
    expect(screen.getAllByText('Drafted scope section.').length).toBeGreaterThan(0);
    expect(screen.getByText('Planner task started.')).toBeTruthy();
    expect(document.querySelector('time[title="2026-06-07T00:30:05.000Z"]')).toBeTruthy();
  });

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
