import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/toast';
import type { EforgeBridge, PlanDetail, PlanRevisionSessionProjection } from '@/types';
import { PlanDetailCard } from './plan-detail';
import { PlanSetDetailCard } from './plan-set-detail';
import { PlanRevisionPatchPreview } from './plan-revision-patch-preview';

const plan = { session: 's', topic: 'Topic', status: 'planning', sections: { scope: 'Old scope', 'acceptance criteria': 'Old AC' } };
const patchResult = { schemaVersion: 1 as const, targetSession: 's', assistantMessage: 'Patch ready', basePlanFingerprint: 'old', proposedPatch: { sections: [{ dimension: 'scope', content: 'New scope' }, { dimension: 'acceptance-criteria', content: 'New AC' }] } };
function turn(kind: 'answer' | 'patch' | 'needs' | 'failed') {
  const base = { turnId: `turn-${kind}`, taskId: `task-${kind}`, userMessage: 'hello', basePlanFingerprint: 'old', baseSectionHashes: [], createdAt: '2026-01-01T00:00:00.000Z' };
  if (kind === 'failed') return { ...base, task: { taskId: base.taskId, kind: 'k', status: 'failed' as const, createdAt: '', updatedAt: '', errorMessage: 'failed' } };
  const result = kind === 'answer' ? { summary: '', assumptionsOpenQuestions: [], planRevisionTurn: { schemaVersion: 1 as const, targetSession: 's', assistantMessage: 'Answer only', basePlanFingerprint: 'old', noPatchReason: 'answer' } }
    : kind === 'needs' ? { summary: '', assumptionsOpenQuestions: [], decision: 'needs-input' as const, rationale: 'Need input', clarificationQuestions: [{ question: 'What section?' }, { question: 'How strict?' }] }
      : { summary: '', assumptionsOpenQuestions: [], planRevisionTurn: patchResult };
  return { ...base, task: { taskId: base.taskId, kind: 'k', status: 'completed' as const, createdAt: '', updatedAt: '', result } };
}
function detail(): PlanDetail & { plan: typeof plan } { return { plan, readiness: { ready: false } }; }
function renderDetail(invokeAction: EforgeBridge['invokeAction'], onApply = vi.fn(), onRefresh = vi.fn(async () => undefined)) {
  window.eforge = { invokeAction };
  return { ...render(<ToastProvider><PlanDetailCard detail={detail()} onApply={onApply} onRefresh={onRefresh} /></ToastProvider>), onApply, onRefresh };
}

function runningTurn(): PlanRevisionSessionProjection['turns'][number] {
  return {
    turnId: 'turn-running',
    taskId: 'task-running',
    userMessage: 'Revise scope',
    basePlanFingerprint: 'old',
    baseSectionHashes: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    task: {
      taskId: 'task-running',
      kind: 'k',
      status: 'running',
      createdAt: '',
      updatedAt: '',
      metadata: { progressMessage: 'Drafting revision', sectionProgress: { currentSection: 'scope' } },
    },
  };
}

describe('PlanDetailCard revision workstation', () => {
  beforeEach(() => { vi.resetModules(); delete window.eforge; });

  it('does not render the revision workstation for plan sets', () => {
    render(<PlanSetDetailCard detail={{ planSet: { id: 'set-1', title: 'Set', status: 'planning', children: [] }, manifestPath: 'plans/plan-set.yaml' }} />);
    expect(screen.queryByText('Revise with AI')).toBeNull();
  });

  it('shows running turn progress, disables submit, and can cancel the turn', async () => {
    const session: PlanRevisionSessionProjection = { threadId: 'thread', targetSession: 's', createdAt: '', updatedAt: '', plan, turns: [runningTurn()] };
    const invokeAction = vi.fn(async () => session);
    renderDetail(invokeAction as EforgeBridge['invokeAction']);
    fireEvent.click(screen.getByRole('button', { name: 'Start or resume revision session' }));
    await waitFor(() => expect(screen.getByText(/Drafting revision · Current section: scope/)).toBeTruthy());
    expect(screen.getByText(/One revision turn can run per plan in V1/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Send to AI/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('cancel-plan-revision-turn', { session: 's', turnId: 'turn-running' }));
  });

  it('renders answer-only turns without section apply actions', async () => {
    const session: PlanRevisionSessionProjection = { threadId: 'thread', targetSession: 's', createdAt: '', updatedAt: '', plan, turns: [turn('answer')] };
    const invokeAction = vi.fn(async (actionId: string) => actionId === 'start-plan-revision-turn' ? { session } : session);
    renderDetail(invokeAction as EforgeBridge['invokeAction']);
    expect(screen.getByText('Revise with AI')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Ask the AI for plan revisions or answers'), { target: { value: 'Why?' } });
    fireEvent.click(screen.getByRole('button', { name: /Send to AI/ }));
    await waitFor(() => expect(screen.getByText('Answer only')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Apply selected revisions/ })).toBeNull();
    expect(invokeAction.mock.calls.map(([id]) => id)).not.toContain('set-session-plan-section');
  });

  it('applies only selected patch sections and refreshes parent callbacks', async () => {
    const session: PlanRevisionSessionProjection = { threadId: 'thread', targetSession: 's', createdAt: '', updatedAt: '', plan, turns: [turn('patch')] };
    const invokeAction = vi.fn(async (actionId: string) => actionId === 'apply-plan-revision-turn' ? { kind: 'applied', session: 's', turnId: 'turn-patch', taskId: 'task-patch', appliedSections: ['scope'], plan, readiness: { ready: true }, message: 'Applied selected plan revision sections.' } : session);
    const { onApply, onRefresh } = renderDetail(invokeAction as EforgeBridge['invokeAction']);
    fireEvent.click(screen.getByRole('button', { name: 'Start or resume revision session' }));
    await waitFor(() => expect(screen.getByText('New scope')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Select Acceptance Criteria'));
    fireEvent.click(screen.getByRole('button', { name: 'Apply selected revisions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm apply selected revisions' }));
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('apply-plan-revision-turn', expect.objectContaining({ sections: ['scope'], previewAcknowledged: true, confirmApply: true })));
    expect(onApply).toHaveBeenCalledWith({ plan, readiness: { ready: true } });
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('renders stale apply warnings without parent callback', async () => {
    const session: PlanRevisionSessionProjection = { threadId: 'thread', targetSession: 's', createdAt: '', updatedAt: '', plan, turns: [turn('patch')] };
    const invokeAction = vi.fn(async (actionId: string) => actionId === 'apply-plan-revision-turn' ? { kind: 'stale', session: 's', turnId: 'turn-patch', taskId: 'task-patch', basePlanFingerprint: 'old', currentPlanFingerprint: 'new', message: 'Stale revision.' } : session);
    const { onApply } = renderDetail(invokeAction as EforgeBridge['invokeAction']);
    fireEvent.click(screen.getByRole('button', { name: 'Start or resume revision session' }));
    await waitFor(() => expect(screen.getByText('New scope')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Apply selected revisions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm apply selected revisions' }));
    await waitFor(() => expect(screen.getAllByText(/Stale revision\./).length).toBeGreaterThan(0));
    expect(screen.getByText('session:')).toBeTruthy();
    expect(screen.getByText('basePlanFingerprint:')).toBeTruthy();
    expect(screen.getByText('currentPlanFingerprint:')).toBeTruthy();
    expect(screen.getByText('new')).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('renders not-applicable apply details', () => {
    render(<PlanRevisionPatchPreview plan={plan} turn={turn('patch')} applyResult={{ kind: 'not-applicable', session: 's', taskId: 'task-patch', message: 'Nothing to apply.' }} busy={false} onApply={vi.fn()} />);
    expect(screen.getByText('Nothing to apply.')).toBeTruthy();
    expect(screen.getByText('session:')).toBeTruthy();
    expect(screen.getByText('taskId:')).toBeTruthy();
    expect(screen.getByText('task-patch')).toBeTruthy();
  });

  it('drops applied sections from selected apply dimensions after reload', async () => {
    const onApply = vi.fn(async () => undefined);
    const initialTurn = turn('patch');
    const { rerender } = render(<PlanRevisionPatchPreview plan={plan} turn={initialTurn} busy={false} onApply={onApply} />);
    rerender(<PlanRevisionPatchPreview plan={plan} turn={{ ...initialTurn, appliedSections: ['scope', 'acceptance-criteria'] }} busy={false} onApply={onApply} />);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Apply selected revisions' }) as HTMLButtonElement).disabled).toBe(true));
  });

  it('redrafts clarification answers and retries failed turns without build or handoff actions', async () => {
    const session: PlanRevisionSessionProjection = { threadId: 'thread', targetSession: 's', createdAt: '', updatedAt: '', plan, turns: [turn('failed'), turn('needs')] };
    const invokeAction = vi.fn(async (actionId: string) => actionId === 'retry-plan-revision-turn' ? { session } : session);
    renderDetail(invokeAction as EforgeBridge['invokeAction']);
    fireEvent.click(screen.getByRole('button', { name: 'Start or resume revision session' }));
    await waitFor(() => expect(screen.getByText('What section?')).toBeTruthy());
    fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: 'Scope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Answer and redraft' }));
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('retry-plan-revision-turn', expect.objectContaining({ turnId: 'turn-needs', answers: [expect.objectContaining({ answer: 'Scope', prompt: 'What section?' })] })));
    fireEvent.click(screen.getByRole('button', { name: /Retry with preserved context/ }));
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('retry-plan-revision-turn', expect.objectContaining({ turnId: 'turn-failed' })));
    const actions = (invokeAction.mock.calls as unknown as Array<[string, unknown?]>).map(([id]) => id);
    expect(actions).not.toContain('handoff-session-plan');
    expect(actions).not.toContain('set-session-plan-ready');
    expect(actions).not.toContain('enqueue');
  });
});
