import * as React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

const artifact: Artifact = { key: 'plan:ready-session', kind: 'plan', session: 'ready-session', title: 'Ready plan', status: 'ready', ready: true, createdAt: '2026-06-07T00:00:00.000Z', updatedAt: '2026-06-07T00:05:00.000Z' } as never;
const detail: PlanDetail = { plan: { session: 'ready-session', topic: 'Ready plan', status: 'ready', sections: { scope: 'Scope', 'acceptance criteria': '- Done' }, createdAt: '2026-06-07T00:00:00.000Z', updatedAt: '2026-06-07T00:05:00.000Z', readyAt: '2026-06-07T00:06:00.000Z' } as never, readiness: { ready: true, missingDimensions: [], coveredDimensions: ['scope', 'acceptance-criteria'], skippedDimensions: [], acDiagnostics: [] } };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function PlansHarness({ initialArtifacts = [artifact], refreshedArtifacts = initialArtifacts, onRefresh = vi.fn(async () => undefined) }: { initialArtifacts?: Artifact[]; refreshedArtifacts?: Artifact[]; onRefresh?: () => Promise<void> }) {
  const [currentArtifacts, setCurrentArtifacts] = React.useState(initialArtifacts);
  const refresh = async () => { await onRefresh(); setCurrentArtifacts(refreshedArtifacts); };
  return (
    <ToastProvider>
      <RouterProvider>
        <PlansView
          artifacts={currentArtifacts}
          draftUnits={[]}
          titles={new Map()}
          onRefresh={refresh}
          onUpdateDraftUnit={vi.fn()}
          onDeleteDraftUnit={vi.fn()}
          onPromoteDraftUnit={vi.fn()}
          onMergeDraftUnits={vi.fn()}
          onSplitDraftUnit={vi.fn()}
          onAdviseMergeDraftUnits={vi.fn()}
          onAdviseSplitDraftUnit={vi.fn()}
        />
      </RouterProvider>
    </ToastProvider>
  );
}

function renderPlans(invokeAction: EforgeBridge['invokeAction'], artifacts: Artifact[] = [artifact], onRefresh = vi.fn(async () => undefined), refreshedArtifacts = artifacts) {
  bridgeMock.invokeAction.mockImplementation(invokeAction);
  window.history.pushState(null, '', '/?plan=plan%3Aready-session');
  return { onRefresh, ...render(<PlansHarness initialArtifacts={artifacts} refreshedArtifacts={refreshedArtifacts} onRefresh={onRefresh} />) };
}

describe('PlansView optimistic handoff', () => {
  it('hides the selected ready plan immediately after confirmed handoff and reconciles success', async () => {
    const handoff = deferred<{ kind: string; message: string }>();
    const invokeAction = vi.fn(async (actionId: string, _payload?: unknown) => {
      if (actionId === 'show-session-plan') return detail;
      if (actionId === 'get-plan-revision-session') return { targetSession: 'ready-session', threadId: 't', createdAt: '', updatedAt: '', annotations: [], turns: [] };
      if (actionId === 'handoff-session-plan') return handoff.promise;
      return {};
    });
    const onRefresh = vi.fn(async () => undefined);
    renderPlans(invokeAction as EforgeBridge['invokeAction'], [artifact], onRefresh, []);

    expect(await screen.findByRole('button', { name: /Handoff/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Handoff/i }));
    expect(invokeAction.mock.calls.map(([id]) => id)).not.toContain('handoff-session-plan');
    expect(screen.getByRole('button', { name: /Ready plan/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Confirm handoff/i })).toBeTruthy();
    expect(screen.queryByLabelText('Planning activity handoff status')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Confirm handoff/i }));
    expect(invokeAction).toHaveBeenCalledWith('handoff-session-plan', { session: 'ready-session' });

    await waitFor(() => expect(screen.queryByRole('button', { name: /Ready plan/i })).toBeNull());
    expect(screen.queryByRole('button', { name: /Confirm handoff/i })).toBeNull();
    expect(screen.getByLabelText('Planning activity handoff status')).toBeTruthy();
    expect(screen.getByText(/handoff pending/i)).toBeTruthy();

    handoff.resolve({ kind: 'enqueued', message: 'Enqueued ready-session.' });
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByLabelText('Planning activity handoff status')).toBeNull());
    expect(screen.queryByRole('button', { name: /Ready plan/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Handoff/i })).toBeNull();
  });

  it('keeps successful handoff non-actionable when refreshed artifacts are stale', async () => {
    const invokeAction = vi.fn(async (actionId: string, _payload?: unknown) => {
      if (actionId === 'show-session-plan') return detail;
      if (actionId === 'get-plan-revision-session') return { targetSession: 'ready-session', threadId: 't', createdAt: '', updatedAt: '', annotations: [], turns: [] };
      if (actionId === 'handoff-session-plan') return { kind: 'enqueued', message: 'Enqueued ready-session.' };
      return {};
    });
    const onRefresh = vi.fn(async () => undefined);
    renderPlans(invokeAction as EforgeBridge['invokeAction'], [artifact], onRefresh, [artifact]);

    fireEvent.click(await screen.findByRole('button', { name: /Handoff/i }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm handoff/i }));

    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Ready plan/i })).toBeNull();
    expect(screen.getByText(/handoff pending/i)).toBeTruthy();
  });

  it('rolls back failed handoff with retry guidance and restores the row', async () => {
    const invokeAction = vi.fn(async (actionId: string, _payload?: unknown) => {
      if (actionId === 'show-session-plan') return detail;
      if (actionId === 'get-plan-revision-session') return { targetSession: 'ready-session', threadId: 't', createdAt: '', updatedAt: '', annotations: [], turns: [] };
      if (actionId === 'handoff-session-plan') throw new Error('enqueue failed loudly');
      return {};
    });
    renderPlans(invokeAction as EforgeBridge['invokeAction']);

    fireEvent.click(await screen.findByRole('button', { name: /Handoff/i }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm handoff/i }));

    const activity = await screen.findByLabelText('Planning activity handoff status');
    expect(within(activity).getByText(/enqueue failed loudly/i)).toBeTruthy();
    expect(within(activity).getByText(/Retry Handoff/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Ready plan/i }));
    const retryHandoff = await screen.findByRole('button', { name: /Handoff/i }) as HTMLButtonElement;
    await waitFor(() => expect(retryHandoff.disabled).toBe(false));
    fireEvent.click(retryHandoff);
    fireEvent.click(screen.getByRole('button', { name: /Confirm handoff/i }));
    expect(invokeAction.mock.calls.filter(([id, payload]) => id === 'handoff-session-plan' && JSON.stringify(payload) === JSON.stringify({ session: 'ready-session' }))).toHaveLength(2);
  });

  it('rolls back structured enqueue failures with manual guidance and restores the row', async () => {
    const invokeAction = vi.fn(async (actionId: string, _payload?: unknown) => {
      if (actionId === 'show-session-plan') return detail;
      if (actionId === 'get-plan-revision-session') return { targetSession: 'ready-session', threadId: 't', createdAt: '', updatedAt: '', annotations: [], turns: [] };
      if (actionId === 'handoff-session-plan') return { kind: 'enqueue-failed', message: 'Daemon unavailable. Run eforge build manually.', command: 'eforge build .eforge/session-plans/ready-session.md' };
      return {};
    });
    const onRefresh = vi.fn(async () => undefined);
    renderPlans(invokeAction as EforgeBridge['invokeAction'], [artifact], onRefresh);

    fireEvent.click(await screen.findByRole('button', { name: /Handoff/i }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm handoff/i }));
    expect(invokeAction).toHaveBeenCalledWith('handoff-session-plan', { session: 'ready-session' });

    const activity = await screen.findByLabelText('Planning activity handoff status');
    expect(onRefresh).toHaveBeenCalled();
    expect(within(activity).getByText(/Daemon unavailable/i)).toBeTruthy();
    expect(within(activity).getByText(/enqueue the session plan manually/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Ready plan/i }));
    const retryHandoff = await screen.findByRole('button', { name: /Handoff/i }) as HTMLButtonElement;
    await waitFor(() => expect(retryHandoff.disabled).toBe(false));
    fireEvent.click(retryHandoff);
    fireEvent.click(screen.getByRole('button', { name: /Confirm handoff/i }));
    expect(invokeAction.mock.calls.filter(([id, payload]) => id === 'handoff-session-plan' && JSON.stringify(payload) === JSON.stringify({ session: 'ready-session' }))).toHaveLength(2);
  });
});
