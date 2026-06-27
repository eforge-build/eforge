import * as React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/toast';
import { RouterProvider } from '@/router';
import type { Artifact, EforgeBridge, PlanDetail } from '@/types';

const bridgeMock = vi.hoisted(() => ({
  invokeAction: vi.fn(),
}));

vi.mock('@/bridge', () => ({
  getBridge: () => ({ invokeAction: bridgeMock.invokeAction }),
}));

const { PlansView } = await import('../plans-view');

function renderPlans(invokeAction: EforgeBridge['invokeAction'], artifacts: Artifact[]) {
  bridgeMock.invokeAction.mockImplementation(invokeAction);
  window.history.pushState(null, '', '/?plan=plan%3Atimestamped');
  return render(
    <ToastProvider>
      <RouterProvider>
        <PlansView
          artifacts={artifacts}
          draftUnits={[]}
          titles={new Map()}
          onRefresh={vi.fn(async () => undefined)}
          onUpdateDraftUnit={vi.fn()}
          onDeleteDraftUnit={vi.fn()}
          onPromoteDraftUnit={vi.fn()}
          onMergeDraftUnits={vi.fn()}
          onSplitDraftUnit={vi.fn()}
          onAdviseMergeDraftUnits={vi.fn()}
          onAdviseSplitDraftUnit={vi.fn()}
        />
      </RouterProvider>
    </ToastProvider>,
  );
}

describe('plan timestamp rendering', () => {
  it('renders list recency and detail lifecycle timestamps with exact ISO access', async () => {
    const artifact = { key: 'plan:timestamped', kind: 'plan', session: 'timestamped', title: 'Timestamped plan', status: 'ready', ready: true, createdAt: '2026-06-07T00:00:00.000Z', updatedAt: '2026-06-07T00:10:00.000Z', readyAt: '2026-06-07T00:11:00.000Z', submittedAt: '2026-06-07T00:12:00.000Z', lastBuildActivityAt: '2026-06-07T00:13:00.000Z' } as never;
    const detail: PlanDetail = { plan: { session: 'timestamped', topic: 'Timestamped plan', status: 'ready', sections: { scope: 'Scope' }, createdAt: '2026-06-07T00:00:00.000Z', updatedAt: '2026-06-07T00:10:00.000Z', readyAt: '2026-06-07T00:11:00.000Z', submittedAt: '2026-06-07T00:12:00.000Z', lastBuildActivityAt: '2026-06-07T00:13:00.000Z' } as never, readiness: { ready: true } };
    const invokeAction = vi.fn(async (actionId: string) => {
      if (actionId === 'show-session-plan') return detail;
      if (actionId === 'get-plan-revision-session') return { targetSession: 'timestamped', threadId: 't', createdAt: '', updatedAt: '', annotations: [], turns: [] };
      return {};
    });

    const { container } = renderPlans(invokeAction as EforgeBridge['invokeAction'], [artifact]);

    const listTime = await waitFor(() => container.querySelector('button time[dateTime="2026-06-07T00:13:00.000Z"]'));
    expect(listTime?.getAttribute('title')).toBe('2026-06-07T00:13:00.000Z');
    expect(listTime?.textContent).toMatch(/^Updated /);
    expect(listTime?.textContent).not.toContain('2026-06-07T00:13:00.000Z');
    await screen.findByText('Created');
    const expectedRows = [
      ['Created', '2026-06-07T00:00:00.000Z'],
      ['Updated', '2026-06-07T00:10:00.000Z'],
      ['Ready', '2026-06-07T00:11:00.000Z'],
      ['Submitted', '2026-06-07T00:12:00.000Z'],
      ['Last build activity', '2026-06-07T00:13:00.000Z'],
    ] as const;
    for (const [label, iso] of expectedRows) {
      const labelNode = screen.getByText(label);
      const row = labelNode.closest('div');
      const time = row?.querySelector(`time[dateTime="${iso}"]`);
      expect(time?.getAttribute('title')).toBe(iso);
    }
  });

  it('renders placeholders for missing or invalid timestamps without raw invalid values', async () => {
    const artifact = { key: 'plan:timestamped', kind: 'plan', session: 'timestamped', title: 'Timestamped plan', status: 'planning', ready: false, createdAt: 'not-a-date' } as never;
    const detail: PlanDetail = { plan: { session: 'timestamped', topic: 'Timestamped plan', status: 'planning', sections: { scope: 'Scope' }, createdAt: 'bad', updatedAt: null } as never, readiness: { ready: false } };
    const invokeAction = vi.fn(async (actionId: string) => {
      if (actionId === 'show-session-plan') return detail;
      if (actionId === 'get-plan-revision-session') return { targetSession: 'timestamped', threadId: 't', createdAt: '', updatedAt: '', annotations: [], turns: [] };
      return {};
    });

    const { container } = renderPlans(invokeAction as EforgeBridge['invokeAction'], [artifact]);

    await screen.findByText('Created');
    expect(container.textContent).not.toContain('not-a-date');
    expect(container.textContent).not.toContain('undefined');
    expect(container.textContent).not.toContain('null');
    expect(container.textContent).not.toContain('bad');
    expect(container.textContent).toContain('—');
  });
});
