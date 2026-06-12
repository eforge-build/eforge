import * as React from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/toast';
import type { EforgeBridge, PlanRevisionSessionProjection, PlanRevisionTurnProjection } from '@/types';
import { usePlanRevisionSession } from './use-plan-revision-session';

function setBridge(invokeAction: EforgeBridge['invokeAction']) { window.eforge = { invokeAction }; }
const turn: PlanRevisionTurnProjection = { turnId: 'turn-1', taskId: 'task-1', userMessage: 'msg', basePlanFingerprint: 'h', baseSectionHashes: [], createdAt: 'now', task: { taskId: 'task-1', kind: 'k', status: 'completed', createdAt: 'now', updatedAt: 'now' } };
const session: PlanRevisionSessionProjection = { threadId: 'thread', targetSession: 's', createdAt: 'now', updatedAt: 'now', turns: [turn] };
const wrapper = ({ children }: { children: React.ReactNode }) => <ToastProvider>{children}</ToastProvider>;

describe('usePlanRevisionSession', () => {
  beforeEach(() => { vi.useRealTimers(); delete window.eforge; });

  it('ensures and submits revision turns through isolated actions', async () => {
    const invokeAction = vi.fn(async (actionId: string) => actionId === 'start-plan-revision-turn' ? { session } : session);
    setBridge(invokeAction as EforgeBridge['invokeAction']);
    const { result } = renderHook(() => usePlanRevisionSession({ session: 's', onApply: vi.fn(), onRefresh: vi.fn() }), { wrapper });
    await act(async () => { await result.current.ensureSession(); });
    await act(async () => { await result.current.submit('  Why this scope?  '); });
    expect(invokeAction).toHaveBeenCalledWith('start-plan-revision-session', { session: 's' });
    expect(invokeAction).toHaveBeenCalledWith('start-plan-revision-turn', { session: 's', message: 'Why this scope?' });
    expect(invokeAction.mock.calls.map(([id]) => id)).not.toContain('set-session-plan-section');
    expect(invokeAction.mock.calls.map(([id]) => id)).not.toContain('set-session-plan-ready');
    expect(invokeAction.mock.calls.map(([id]) => id)).not.toContain('handoff-session-plan');
  });

  it('polls while running and stops after terminal projection', async () => {
    vi.useFakeTimers();
    const running = { ...session, turns: [{ ...turn, task: { ...turn.task!, status: 'running' as const } }] };
    const invokeAction = vi.fn(async (actionId: string) => actionId === 'start-plan-revision-session' ? running : session);
    setBridge(invokeAction as EforgeBridge['invokeAction']);
    const { result } = renderHook(() => usePlanRevisionSession({ session: 's', onApply: vi.fn(), onRefresh: vi.fn() }), { wrapper });
    await act(async () => { await result.current.ensureSession(); });
    await act(async () => { vi.advanceTimersByTime(1700); await Promise.resolve(); });
    expect(invokeAction).toHaveBeenCalledWith('get-plan-revision-session', { session: 's', includePlan: false });
  });

  it('applies with confirmation flags and refresh callbacks only for applied results', async () => {
    const onApply = vi.fn(); const onRefresh = vi.fn(async () => undefined);
    const invokeAction = vi.fn(async (actionId: string) => {
      if (actionId === 'start-plan-revision-session' || actionId === 'get-plan-revision-session') return session;
      if (actionId === 'apply-plan-revision-turn') return { kind: 'applied', session: 's', turnId: 'turn-1', taskId: 'task-1', appliedSections: ['scope'], plan: { session: 's', topic: 't', status: 'planning' }, readiness: { ready: false }, message: 'Applied selected plan revision sections.' };
      throw new Error(actionId);
    });
    setBridge(invokeAction as EforgeBridge['invokeAction']);
    const { result } = renderHook(() => usePlanRevisionSession({ session: 's', onApply, onRefresh }), { wrapper });
    await act(async () => { await result.current.ensureSession(); });
    await act(async () => { await result.current.apply(turn, ['scope']); });
    expect(invokeAction).toHaveBeenCalledWith('apply-plan-revision-turn', { session: 's', turnId: 'turn-1', sections: ['scope'], previewAcknowledged: true, confirmApply: true });
    expect(invokeAction).toHaveBeenCalledWith('get-plan-revision-session', { session: 's', includePlan: true });
    expect(onApply).toHaveBeenCalledOnce();
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('stores stale apply result without parent apply callback', async () => {
    const onApply = vi.fn();
    const invokeAction = vi.fn(async (actionId: string) => actionId === 'apply-plan-revision-turn' ? { kind: 'stale', session: 's', turnId: 'turn-1', taskId: 'task-1', basePlanFingerprint: 'old', currentPlanFingerprint: 'new', message: 'Stale revision.' } : session);
    setBridge(invokeAction as EforgeBridge['invokeAction']);
    const { result } = renderHook(() => usePlanRevisionSession({ session: 's', onApply, onRefresh: vi.fn() }), { wrapper });
    await act(async () => { await result.current.ensureSession(); });
    await act(async () => { await result.current.apply(turn, ['scope']); });
    expect(result.current.lastApplyByTurn['turn-1']?.kind).toBe('stale');
    expect(onApply).not.toHaveBeenCalled();
  });
});
