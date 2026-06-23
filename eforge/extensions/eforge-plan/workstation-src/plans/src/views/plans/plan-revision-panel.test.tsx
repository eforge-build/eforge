import * as React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/toast';
import type { EforgeBridge, PlanDetail, PlanRevisionSessionProjection } from '@/types';
import { PlanDetailWorkspace } from './plan-detail-workspace';
import { PlanSetDetailCard } from './plan-set-detail';

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
function detail(planOverride: typeof plan = plan, readiness: PlanDetail['readiness'] = { ready: false }): PlanDetail & { plan: typeof plan } { return { plan: planOverride, readiness }; }
function reviewRail() {
  return screen.getByLabelText(/Plan review rail for s/);
}

function revisionDetails(rail = reviewRail()) {
  const details = within(rail).getByText('Revise with AI').closest('details');
  expect(details).toBeTruthy();
  return details as HTMLDetailsElement;
}

function renderDetail(invokeAction: EforgeBridge['invokeAction'], onApply = vi.fn(), onRefresh = vi.fn(async () => undefined), detailInput = detail()) {
  const onDeleted = vi.fn(async () => undefined);
  window.eforge = { invokeAction };
  return { ...render(<ToastProvider><PlanDetailWorkspace detail={detailInput} artifact={{ key: 'plan:s', kind: 'plan', session: 's', title: 'Topic' }} titles={new Map()} onApply={onApply} onRefresh={onRefresh} onDeleted={onDeleted} /></ToastProvider>), onApply, onRefresh, onDeleted };
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
  beforeEach(() => { vi.resetModules(); window.localStorage.clear(); delete window.eforge; });

  it('does not render the revision workstation for plan sets', () => {
    render(<PlanSetDetailCard detail={{ planSet: { id: 'set-1', title: 'Set', status: 'planning', children: [] }, manifestPath: 'plans/plan-set.yaml' }} />);
    expect(screen.queryByText('Revise with AI')).toBeNull();
  });

  it('shows running turn progress, disables submit and plan edits, and can cancel the turn', async () => {
    const session: PlanRevisionSessionProjection = { threadId: 'thread', targetSession: 's', createdAt: '', updatedAt: '', plan, annotations: [], turns: [runningTurn()] };
    const invokeAction = vi.fn(async () => session);
    renderDetail(invokeAction as EforgeBridge['invokeAction'], vi.fn(), vi.fn(async () => undefined), detail({ ...plan, status: 'planning' }, { ready: true }));
    const rail = reviewRail();
    await waitFor(() => expect(within(rail).getByText(/Drafting revision · Current section: scope/)).toBeTruthy());
    expect(within(rail).getByText(/The AI is revising this plan/)).toBeTruthy();
    expect(within(rail).getByText(/1 running/)).toBeTruthy();
    expect((within(rail).getByRole('button', { name: /Send to AI/ }) as HTMLButtonElement).disabled).toBe(true);
    // The page is locked while a turn runs: representative plan mutation and annotation affordances are disabled.
    [
      screen.getByRole('button', { name: /Delete/ }),
      screen.getByRole('button', { name: /Mark ready/ }),
      screen.getByRole('button', { name: /Handoff/ }),
      screen.getByRole('button', { name: /Annotate whole plan/ }),
      screen.getByRole('button', { name: /Annotate section Scope/ }),
      screen.getByRole('button', { name: /Annotate focused block in Scope/ }),
    ].forEach((button) => expect((button as HTMLButtonElement).disabled).toBe(true));
    screen.getAllByRole('button', { name: /Edit/ }).forEach((button) => expect((button as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(within(rail).getByRole('button', { name: /Cancel/ }));
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('cancel-plan-revision-turn', { session: 's', turnId: 'turn-running' }));
  });

  it('renders answer-only turns without apply actions', async () => {
    const session: PlanRevisionSessionProjection = { threadId: 'thread', targetSession: 's', createdAt: '', updatedAt: '', plan, annotations: [], turns: [turn('answer')] };
    const invokeAction = vi.fn(async (actionId: string) => actionId === 'start-plan-revision-turn' ? { session } : session);
    renderDetail(invokeAction as EforgeBridge['invokeAction']);
    expect(screen.getByText('Revise with AI')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Ask the AI for plan revisions or answers'), { target: { value: 'Why?' } });
    const send = screen.getByRole('button', { name: /Send to AI/ });
    await waitFor(() => expect((send as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(send);
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('start-plan-revision-turn', { session: 's', message: 'Why?' }));
    expect(screen.getByText('Answer only')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Apply selected/ })).toBeNull();
    const manualPayload = (invokeAction.mock.calls.find(([id]) => id === 'start-plan-revision-turn') as unknown as [string, Record<string, unknown>] | undefined)?.[1] ?? {};
    expect(manualPayload).not.toHaveProperty('annotationIds');
    expect(manualPayload).not.toHaveProperty('includeOpenAnnotations');
    expect(manualPayload).not.toHaveProperty('steering');
    expect(invokeAction.mock.calls.map(([id]) => id)).not.toContain('set-session-plan-section');
  });

  it('auto-applies a completed patch turn and refreshes parent callbacks without apply controls', async () => {
    const session: PlanRevisionSessionProjection = { threadId: 'thread', targetSession: 's', createdAt: '', updatedAt: '', plan, annotations: [], turns: [turn('patch')] };
    const invokeAction = vi.fn(async (actionId: string) => actionId === 'apply-plan-revision-turn' ? { kind: 'applied', session: 's', turnId: 'turn-patch', taskId: 'task-patch', appliedSections: ['scope', 'acceptance-criteria'], plan, readiness: { ready: true }, message: 'Applied plan revision sections.' } : session);
    const { onApply, onRefresh } = renderDetail(invokeAction as EforgeBridge['invokeAction']);
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('apply-plan-revision-turn', { session: 's', turnId: 'turn-patch' }));
    expect(invokeAction.mock.calls.filter(([id]) => id === 'apply-plan-revision-turn')).toHaveLength(1);
    expect(within(reviewRail()).queryByRole('button', { name: /Apply selected/ })).toBeNull();
    expect(onApply).toHaveBeenCalledWith({ plan, readiness: { ready: true } });
    expect(onRefresh).toHaveBeenCalled();
  });

  it('shows patch-ready and applied activity states in the rail', async () => {
    const patchTurn = { ...turn('patch'), appliedSections: ['scope'], appliedAt: '2026-01-01T00:05:00.000Z' };
    const session: PlanRevisionSessionProjection = { threadId: 'thread', targetSession: 's', createdAt: '', updatedAt: '', plan, annotations: [], turns: [patchTurn] };
    const invokeAction = vi.fn(async (actionId: string) => actionId === 'apply-plan-revision-turn' ? { kind: 'applied', session: 's', turnId: 'turn-patch', taskId: 'task-patch', appliedSections: ['scope'], plan, readiness: { ready: true } } : session);
    renderDetail(invokeAction as EforgeBridge['invokeAction']);
    const rail = reviewRail();
    await waitFor(() => expect(within(rail).getByText(/1 patch ready/)).toBeTruthy());
    await waitFor(() => expect(revisionDetails(rail).hasAttribute('open')).toBe(true));
    expect(within(rail).getByText(/1 applied sections/)).toBeTruthy();
    expect(within(rail).getByText('Patch ready')).toBeTruthy();
    expect(within(rail).getByText(/Applied/)).toBeTruthy();
    expect(within(rail).getAllByText('Scope').length).toBeGreaterThan(0);
  });

  it('keeps the rail revision panel closed when stored preferences say so', async () => {
    window.localStorage.setItem('eforge-plan.revision.rail.s', 'false');
    const session: PlanRevisionSessionProjection = { threadId: 'thread', targetSession: 's', createdAt: '', updatedAt: '', plan, annotations: [], turns: [turn('patch')] };
    const invokeAction = vi.fn(async () => session);
    renderDetail(invokeAction as EforgeBridge['invokeAction']);
    const rail = reviewRail();
    await waitFor(() => expect(within(rail).getByText(/1 patch ready/)).toBeTruthy());
    expect(revisionDetails(rail).hasAttribute('open')).toBe(false);
  });

  it('redrafts clarification answers and retries failed turns without build or handoff actions', async () => {
    const session: PlanRevisionSessionProjection = { threadId: 'thread', targetSession: 's', createdAt: '', updatedAt: '', plan, annotations: [], turns: [turn('failed'), turn('needs')] };
    const invokeAction = vi.fn(async (actionId: string) => actionId === 'retry-plan-revision-turn' ? { session } : session);
    renderDetail(invokeAction as EforgeBridge['invokeAction']);
    const rail = reviewRail();
    await waitFor(() => expect(within(rail).getByText('What section?')).toBeTruthy());
    expect(within(rail).getByText(/1 failed/)).toBeTruthy();
    expect(within(rail).getByText(/1 needs input/)).toBeTruthy();
    fireEvent.change(within(rail).getByLabelText('What section?'), { target: { value: 'Scope' } });
    fireEvent.click(within(rail).getByRole('button', { name: 'Answer and redraft' }));
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('retry-plan-revision-turn', expect.objectContaining({ turnId: 'turn-needs', answers: [expect.objectContaining({ answer: 'Scope', prompt: 'What section?' })] })));
    fireEvent.click(within(rail).getByRole('button', { name: /Retry with preserved context/ }));
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('retry-plan-revision-turn', expect.objectContaining({ turnId: 'turn-failed' })));
    const actions = (invokeAction.mock.calls as unknown as Array<[string, unknown?]>).map(([id]) => id);
    expect(actions).not.toContain('handoff-session-plan');
    expect(actions).not.toContain('set-session-plan-ready');
    expect(actions).not.toContain('enqueue');
  });
});
