import * as React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/toast';
import type { EforgeBridge, PlanRevisionSessionProjection, PlanRevisionTurnProjection } from '@/types';
import { usePlanRevisionSession } from './use-plan-revision-session';

function setBridge(invokeAction: EforgeBridge['invokeAction']) { window.eforge = { invokeAction }; }
const turn: PlanRevisionTurnProjection = { turnId: 'turn-1', taskId: 'task-1', userMessage: 'msg', basePlanFingerprint: 'h', baseSectionHashes: [], createdAt: 'now', task: { taskId: 'task-1', kind: 'k', status: 'completed', createdAt: 'now', updatedAt: 'now' } };
const annotation = { annotationId: 'ann-1', targetSession: 's', target: { kind: 'selection' as const, dimension: 'scope', capturedText: 'text', quoteContext: { exact: 'text' } }, createdAt: 'now', updatedAt: 'now' };
const session: PlanRevisionSessionProjection = { threadId: 'thread', targetSession: 's', createdAt: 'now', updatedAt: 'now', annotations: [], turns: [turn] };
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

  it('applies a completed patch turn and refreshes parent callbacks without selection or confirmation flags', async () => {
    const onApply = vi.fn(); const onRefresh = vi.fn(async () => undefined);
    const invokeAction = vi.fn(async (actionId: string) => {
      if (actionId === 'start-plan-revision-session' || actionId === 'get-plan-revision-session') return session;
      if (actionId === 'apply-plan-revision-turn') return { kind: 'applied', session: 's', turnId: 'turn-1', taskId: 'task-1', appliedSections: ['scope'], plan: { session: 's', topic: 't', status: 'planning' }, readiness: { ready: false }, message: 'Applied plan revision sections.' };
      throw new Error(actionId);
    });
    setBridge(invokeAction as EforgeBridge['invokeAction']);
    const { result } = renderHook(() => usePlanRevisionSession({ session: 's', onApply, onRefresh }), { wrapper });
    await act(async () => { await result.current.ensureSession(); });
    await act(async () => { await result.current.apply(turn); });
    expect(invokeAction).toHaveBeenCalledWith('apply-plan-revision-turn', { session: 's', turnId: 'turn-1' });
    expect(invokeAction).toHaveBeenCalledWith('get-plan-revision-session', { session: 's', includePlan: true });
    expect(onApply).toHaveBeenCalledOnce();
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('does not call the parent apply callback for not-applicable results', async () => {
    const onApply = vi.fn();
    const invokeAction = vi.fn(async (actionId: string) => actionId === 'apply-plan-revision-turn' ? { kind: 'not-applicable', session: 's', turnId: 'turn-1', taskId: 'task-1', message: 'No patch to apply.' } : session);
    setBridge(invokeAction as EforgeBridge['invokeAction']);
    const { result } = renderHook(() => usePlanRevisionSession({ session: 's', onApply, onRefresh: vi.fn() }), { wrapper });
    await act(async () => { await result.current.ensureSession(); });
    let applied: unknown;
    await act(async () => { applied = await result.current.apply(turn); });
    expect((applied as { kind?: string })?.kind).toBe('not-applicable');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('retries auto-apply on a later reload when the prior attempt did not apply', async () => {
    const patchTurn: PlanRevisionTurnProjection = { turnId: 'turn-patch', taskId: 'task-patch', userMessage: 'patch', basePlanFingerprint: 'h', baseSectionHashes: [], createdAt: 'now', task: { taskId: 'task-patch', kind: 'k', status: 'completed', createdAt: 'now', updatedAt: 'now', result: { summary: '', assumptionsOpenQuestions: [], planRevisionTurn: { schemaVersion: 1, targetSession: 's', assistantMessage: 'patch', basePlanFingerprint: 'h', proposedPatch: { sections: [{ dimension: 'scope', content: 'new' }] } } } } };
    const patchSession: PlanRevisionSessionProjection = { ...session, turns: [patchTurn] };
    const invokeAction = vi.fn(async (actionId: string) => actionId === 'apply-plan-revision-turn'
      ? { kind: 'not-applicable', session: 's', turnId: 'turn-patch', taskId: 'task-patch', message: 'Plan changed.' }
      : { ...patchSession, turns: [...patchSession.turns] });
    setBridge(invokeAction as EforgeBridge['invokeAction']);
    const { result } = renderHook(() => usePlanRevisionSession({ session: 's', onApply: vi.fn(), onRefresh: vi.fn(async () => undefined) }), { wrapper });
    await act(async () => { await result.current.ensureSession(); });
    await waitFor(() => expect(invokeAction.mock.calls.filter(([id]) => id === 'apply-plan-revision-turn')).toHaveLength(1));
    await act(async () => { await result.current.reload(); });
    await waitFor(() => expect(invokeAction.mock.calls.filter(([id]) => id === 'apply-plan-revision-turn')).toHaveLength(2));
  });

  it('auto-applies a completed patch turn exactly once without selection or confirmation flags', async () => {
    const patchTurn: PlanRevisionTurnProjection = { turnId: 'turn-patch', taskId: 'task-patch', userMessage: 'patch', basePlanFingerprint: 'h', baseSectionHashes: [], createdAt: 'now', task: { taskId: 'task-patch', kind: 'k', status: 'completed', createdAt: 'now', updatedAt: 'now', result: { summary: '', assumptionsOpenQuestions: [], planRevisionTurn: { schemaVersion: 1, targetSession: 's', assistantMessage: 'patch', basePlanFingerprint: 'h', proposedPatch: { sections: [{ dimension: 'scope', content: 'new' }] } } } } };
    const patchSession: PlanRevisionSessionProjection = { ...session, turns: [patchTurn] };
    const onApply = vi.fn();
    const invokeAction = vi.fn(async (actionId: string) => actionId === 'apply-plan-revision-turn'
      ? { kind: 'applied', session: 's', turnId: 'turn-patch', taskId: 'task-patch', appliedSections: ['scope'], plan: { session: 's', topic: 't', status: 'planning' }, readiness: { ready: true }, message: 'Applied plan revision sections.' }
      : patchSession);
    setBridge(invokeAction as EforgeBridge['invokeAction']);
    const { result } = renderHook(() => usePlanRevisionSession({ session: 's', onApply, onRefresh: vi.fn(async () => undefined) }), { wrapper });
    await act(async () => { await result.current.ensureSession(); });
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('apply-plan-revision-turn', { session: 's', turnId: 'turn-patch' }));
    expect(invokeAction.mock.calls.filter(([id]) => id === 'apply-plan-revision-turn')).toHaveLength(1);
    expect(onApply).toHaveBeenCalledWith({ plan: { session: 's', topic: 't', status: 'planning' }, readiness: { ready: true } });
  });

  it('silently loads existing sessions with annotations and ignores missing-session errors', async () => {
    const annotated = { ...session, annotations: [annotation] };
    const invokeAction = vi.fn(async () => annotated);
    setBridge(invokeAction as EforgeBridge['invokeAction']);
    const { result } = renderHook(() => usePlanRevisionSession({ session: 's', onApply: vi.fn(), onRefresh: vi.fn(), autoLoadExisting: true }), { wrapper });
    await waitFor(() => expect(result.current.revisionSession?.annotations).toHaveLength(1));
    const missing = vi.fn(async () => { throw new Error('No revision session exists.'); });
    setBridge(missing as EforgeBridge['invokeAction']);
    const second = renderHook(() => usePlanRevisionSession({ session: 's2', onApply: vi.fn(), onRefresh: vi.fn(), autoLoadExisting: true }), { wrapper });
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(second.result.current.revisionSession).toBeNull();
  });

  it('invokes annotation mutation actions with session payloads', async () => {
    const annotated = { ...session, annotations: [annotation] };
    const invokeAction = vi.fn(async () => annotated);
    setBridge(invokeAction as EforgeBridge['invokeAction']);
    const { result } = renderHook(() => usePlanRevisionSession({ session: 's', onApply: vi.fn(), onRefresh: vi.fn() }), { wrapper });
    await act(async () => { await result.current.createAnnotation(annotation.target); });
    await act(async () => { await result.current.updateAnnotation({ annotationId: 'ann-1', body: 'note' }); });
    await act(async () => { await result.current.deleteAnnotation('ann-1'); });
    await act(async () => { await result.current.resolveAnnotation('ann-1'); });
    await act(async () => { await result.current.dismissAnnotation('ann-1'); });
    expect(invokeAction).toHaveBeenCalledWith('create-plan-revision-annotation', { session: 's', target: annotation.target });
    expect(invokeAction).toHaveBeenCalledWith('update-plan-revision-annotation', { session: 's', annotationId: 'ann-1', body: 'note' });
    expect(invokeAction).toHaveBeenCalledWith('delete-plan-revision-annotation', { session: 's', annotationId: 'ann-1' });
    expect(invokeAction).toHaveBeenCalledWith('resolve-plan-revision-annotation', { session: 's', annotationId: 'ann-1' });
    expect(invokeAction).toHaveBeenCalledWith('dismiss-plan-revision-annotation', { session: 's', annotationId: 'ann-1' });
  });

  it('trims annotation create notes and omits blank body fields', async () => {
    const annotated = { ...session, annotations: [annotation] };
    const invokeAction = vi.fn(async () => annotated);
    setBridge(invokeAction as EforgeBridge['invokeAction']);
    const { result } = renderHook(() => usePlanRevisionSession({ session: 's', onApply: vi.fn(), onRefresh: vi.fn() }), { wrapper });

    await act(async () => { await result.current.createAnnotation(annotation.target, '  note  '); });
    await act(async () => { await result.current.createAnnotation(annotation.target, '   '); });

    expect(invokeAction).toHaveBeenCalledWith('create-plan-revision-annotation', { session: 's', target: annotation.target, body: 'note' });
    expect(invokeAction).toHaveBeenCalledWith('create-plan-revision-annotation', { session: 's', target: annotation.target });
  });

  it('ignores stale annotation mutation projections for a different target session', async () => {
    const stale: PlanRevisionSessionProjection = { ...session, threadId: 'stale-thread', targetSession: 'other', annotations: [{ ...annotation, annotationId: 'stale-ann', targetSession: 'other' }], turns: [] };
    const invokeAction = vi.fn(async (actionId: string) => actionId === 'create-plan-revision-annotation' ? stale : session);
    setBridge(invokeAction as EforgeBridge['invokeAction']);
    const { result } = renderHook(() => usePlanRevisionSession({ session: 's', onApply: vi.fn(), onRefresh: vi.fn() }), { wrapper });
    await act(async () => { await result.current.ensureSession(); });
    expect(result.current.revisionSession?.targetSession).toBe('s');

    await act(async () => { await result.current.createAnnotation(annotation.target); });

    expect(invokeAction).toHaveBeenCalledWith('create-plan-revision-annotation', { session: 's', target: annotation.target });
    expect(result.current.revisionSession?.targetSession).toBe('s');
    expect(result.current.revisionSession?.threadId).toBe('thread');
    expect(result.current.revisionSession?.annotations).toEqual([]);
  });

  it('submits annotation-driven turn fields and keeps manual prompt payload exact', async () => {
    const invokeAction = vi.fn(async (actionId: string) => actionId === 'start-plan-revision-turn' ? { session } : session);
    setBridge(invokeAction as EforgeBridge['invokeAction']);
    const { result } = renderHook(() => usePlanRevisionSession({ session: 's', onApply: vi.fn(), onRefresh: vi.fn() }), { wrapper });
    await act(async () => { await result.current.submitAnnotationRevision({ annotationIds: ['ann-1'], includeOpenAnnotations: true, steering: ' steer ' }); });
    await act(async () => { await result.current.submit('  revise  '); });
    expect(invokeAction).toHaveBeenCalledWith('start-plan-revision-turn', { session: 's', annotationIds: ['ann-1'], includeOpenAnnotations: true, steering: 'steer' });
    expect(invokeAction).toHaveBeenCalledWith('start-plan-revision-turn', { session: 's', message: 'revise' });
  });
});
