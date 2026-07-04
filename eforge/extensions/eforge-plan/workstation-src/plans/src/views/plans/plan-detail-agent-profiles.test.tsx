import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EforgeBridge, PlanData, PlanDetail } from '@/types';

function installBridge(bridge: EforgeBridge) {
  (window as Window & { eforge?: EforgeBridge }).eforge = bridge;
}

function detailFor(plan: Partial<PlanData> = {}): PlanDetail & { plan: PlanData } {
  return {
    plan: {
      session: 'session-one',
      topic: 'Session one',
      status: 'planning',
      profile: 'excursion',
      agent_profile: null,
      open_questions: ['Preserve this question.'],
      sections: {},
      ...plan,
    },
    readiness: { ready: true, coveredDimensions: [], missingDimensions: [], skippedDimensions: [] },
  };
}

describe('PlanDetailCard agent runtime profile loading', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    delete (window as Window & { eforge?: EforgeBridge }).eforge;
  });

  it('loads build-agent profile options through the workstation action bridge and saves via metadata mutation', async () => {
    const fetchSpy = vi.fn(async () => { throw new Error('direct fetch is not allowed from the workstation'); });
    vi.stubGlobal('fetch', fetchSpy);
    const calls: Array<{ actionId: string; input: unknown }> = [];
    installBridge({
      version: 1,
      async invokeAction<TOutput>(actionId: string, input: unknown = {}): Promise<TOutput> {
        calls.push({ actionId, input });
        if (actionId === 'list-agent-runtime-profiles') {
          return {
            active: 'team-runtime',
            source: 'project',
            profiles: [
              { name: 'team-runtime', harness: 'pi', path: 'eforge/profiles/team-runtime.yaml', scope: 'project' },
              { name: 'local-fast', harness: 'claude-sdk', path: '.eforge/profiles/local-fast.yaml', scope: 'local' },
            ],
          } as TOutput;
        }
        if (actionId === 'update-session-plan-metadata') {
          return {
            plan: { ...detailFor().plan, profile: (input as { profile?: string | null }).profile ?? null, agent_profile: (input as { agentProfile?: string | null }).agentProfile ?? null },
            readiness: {},
          } as TOutput;
        }
        throw new Error(`unexpected action ${actionId}`);
      },
    });
    const { ToastProvider } = await import('@/components/toast');
    const { PlanDetailCard } = await import('./plan-detail');
    const onApply = vi.fn();
    const onRefresh = vi.fn(async () => undefined);

    render(
      <ToastProvider>
        <PlanDetailCard
          detail={detailFor()}
          artifact={null}
          revision={{ busy: false, loading: false, hasRunningTurn: false } as any}
          locked={false}
          onSelectAnnotationTarget={vi.fn()}
          onApply={onApply}
          onRefresh={onRefresh}
          onHandoff={vi.fn(async () => undefined)}
          onDeleted={vi.fn(async () => undefined)}
          onClose={vi.fn()}
        />
      </ToastProvider>,
    );

    await waitFor(() => expect(calls).toContainEqual({ actionId: 'list-agent-runtime-profiles', input: { scope: 'all' } }));
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Edit/i }));
    await waitFor(() => expect(screen.getByRole('option', { name: 'local-fast · local' })).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Build agent profile'), { target: { value: 'local-fast' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/i }));

    await waitFor(() => expect(calls).toContainEqual({
      actionId: 'update-session-plan-metadata',
      input: { session: 'session-one', profile: 'excursion', agentProfile: 'local-fast', openQuestions: ['Preserve this question.'] },
    }));
    expect(onApply).toHaveBeenCalled();
    expect(onRefresh).toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['empty', async () => ({ active: null, source: 'project', profiles: [] }), /No named profiles were found; clearing remains available/],
    ['error', async () => { throw new Error('profile bridge failed'); }, /Could not load profile options \(profile bridge failed\); clearing remains available/],
  ] as const)('keeps metadata saving available when profile loading is %s', async (_label, listProfiles, helpText) => {
    const calls: Array<{ actionId: string; input: unknown }> = [];
    installBridge({
      version: 1,
      async invokeAction<TOutput>(actionId: string, input: unknown = {}): Promise<TOutput> {
        calls.push({ actionId, input });
        if (actionId === 'list-agent-runtime-profiles') return await listProfiles() as TOutput;
        if (actionId === 'update-session-plan-metadata') {
          return {
            plan: { ...detailFor().plan, profile: (input as { profile?: string | null }).profile ?? null, agent_profile: (input as { agentProfile?: string | null }).agentProfile ?? null },
            readiness: {},
          } as TOutput;
        }
        throw new Error(`unexpected action ${actionId}`);
      },
    });
    const { ToastProvider } = await import('@/components/toast');
    const { PlanDetailCard } = await import('./plan-detail');

    render(
      <ToastProvider>
        <PlanDetailCard
          detail={detailFor({ profile: 'errand', agent_profile: 'team-runtime' })}
          artifact={null}
          revision={{ busy: false, loading: false, hasRunningTurn: false } as any}
          locked={false}
          onSelectAnnotationTarget={vi.fn()}
          onApply={vi.fn()}
          onRefresh={vi.fn(async () => undefined)}
          onHandoff={vi.fn(async () => undefined)}
          onDeleted={vi.fn(async () => undefined)}
          onClose={vi.fn()}
        />
      </ToastProvider>,
    );

    await waitFor(() => expect(calls).toContainEqual({ actionId: 'list-agent-runtime-profiles', input: { scope: 'all' } }));
    fireEvent.click(screen.getByRole('button', { name: /Edit/i }));
    expect(screen.getByText(helpText)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Planning profile'), { target: { value: 'expedition' } });
    fireEvent.change(screen.getByLabelText('Build agent profile'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/i }));

    await waitFor(() => expect(calls).toContainEqual({
      actionId: 'update-session-plan-metadata',
      input: { session: 'session-one', profile: 'expedition', agentProfile: null, openQuestions: ['Preserve this question.'] },
    }));
  });
});
