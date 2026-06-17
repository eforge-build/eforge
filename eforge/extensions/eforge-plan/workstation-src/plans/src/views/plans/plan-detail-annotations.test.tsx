import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/toast';
import type { EforgeBridge, PlanDetail, PlanRevisionAnnotation, PlanRevisionSessionProjection } from '@/types';
import { PlanDetailCard } from './plan-detail';

const plan = { session: 's', topic: 'Topic', status: 'planning', sections: { scope: 'Selected scope words for annotations.', 'acceptance criteria': 'Done means visible controls.' } };
const annotation: PlanRevisionAnnotation = { annotationId: 'ann-1', targetSession: 's', body: 'Needs detail', target: { kind: 'selection', dimension: 'scope', label: 'Scope selection', capturedText: 'Selected scope', quoteContext: { exact: 'Selected scope', suffix: 'words for annotations.' } }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:05:00.000Z' };
const session: PlanRevisionSessionProjection = { threadId: 'thread', targetSession: 's', createdAt: '', updatedAt: '', plan, annotations: [annotation], turns: [] };

function renderDetail(invokeAction: EforgeBridge['invokeAction'], projected: PlanRevisionSessionProjection = session) {
  window.eforge = { invokeAction };
  const detail: PlanDetail & { plan: typeof plan } = { plan, readiness: { ready: false } };
  return render(<ToastProvider><PlanDetailCard detail={detail} onApply={vi.fn()} onRefresh={vi.fn(async () => undefined)} onDeleted={vi.fn(async () => undefined)} /></ToastProvider>);
}

function createBridge(projected: PlanRevisionSessionProjection = { ...session, annotations: [] }) {
  return vi.fn(async (actionId: string, input: Record<string, unknown>) => {
    if (actionId === 'start-plan-revision-turn') return { session: projected };
    if (actionId.endsWith('plan-revision-annotation')) return projected;
    if (actionId === 'get-plan-revision-session' || actionId === 'start-plan-revision-session') return projected;
    return projected;
  });
}

function renderedSectionFor(buttonName: RegExp) {
  const button = screen.getByRole('button', { name: buttonName });
  const section = button.closest('section');
  expect(section).toBeTruthy();
  return section as HTMLElement;
}

function decoratedBlockFor(buttonName: RegExp, text: string) {
  const section = renderedSectionFor(buttonName);
  const block = Array.from(section.querySelectorAll<HTMLElement>('[data-plan-annotation-block]')).find((element) => element.textContent?.includes(text));
  expect(block).toBeTruthy();
  return block as HTMLElement;
}

function firstTextNode(element: HTMLElement): Text {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const node = walker.nextNode();
  expect(node).toBeTruthy();
  return node as Text;
}

async function selectSubstringInside(fullText: string, selectedText: string) {
  const block = decoratedBlockFor(/Annotate selection in Scope/, fullText);
  const node = firstTextNode(block);
  const start = (node.textContent ?? '').indexOf(selectedText);
  expect(start).toBeGreaterThanOrEqual(0);
  const area = document.createRange();
  area.setStart(node, start);
  area.setEnd(node, start + selectedText.length);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(area);
  await act(async () => { document.dispatchEvent(new Event('selectionchange')); });
}

function selectOutsideRenderedSections(text: string) {
  const outside = document.createElement('p');
  outside.textContent = text;
  document.body.append(outside);
  const area = document.createRange();
  area.selectNodeContents(outside);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(area);
  document.dispatchEvent(new Event('selectionchange'));
}


describe('PlanDetailCard annotations', () => {
  beforeEach(() => { cleanup(); document.body.innerHTML = ''; delete window.eforge; });

  it('captures selected text inside a rendered section', async () => {
    const invokeAction = createBridge();
    renderDetail(invokeAction as EforgeBridge['invokeAction'], { ...session, annotations: [] });
    await screen.findByRole('button', { name: /Annotate selection in Scope/ });
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('get-plan-revision-session', { session: 's', includePlan: false }));
    await selectSubstringInside('Selected scope words for annotations.', 'Selected scope');
    await waitFor(() => {
      const button = screen.getByRole('button', { name: /Annotate selection in Scope/ }) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      fireEvent.mouseDown(button);
      fireEvent.click(button);
      expect(invokeAction).toHaveBeenCalledWith('create-plan-revision-annotation', expect.objectContaining({ session: 's', target: expect.objectContaining({ kind: 'selection', dimension: 'scope', capturedText: 'Selected scope', quoteContext: expect.objectContaining({ exact: 'Selected scope' }) }) }));
    });
  });

  it('does not create a selected-text annotation for a selection outside the rendered section', async () => {
    const invokeAction = createBridge();
    renderDetail(invokeAction as EforgeBridge['invokeAction'], { ...session, annotations: [] });
    const button = await screen.findByRole('button', { name: /Annotate selection in Scope/ });
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('get-plan-revision-session', { session: 's', includePlan: false }));
    selectOutsideRenderedSections('outside selection');
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(button);
    expect(invokeAction.mock.calls.map(([id]) => id)).not.toContain('create-plan-revision-annotation');
  });

  it('captures block, section, and whole-plan fallback annotations', async () => {
    const invokeAction = createBridge();
    renderDetail(invokeAction as EforgeBridge['invokeAction'], { ...session, annotations: [] });
    await screen.findByRole('button', { name: /Annotate focused block in Scope/ });
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('get-plan-revision-session', { session: 's', includePlan: false }));
    const block = await waitFor(() => decoratedBlockFor(/Annotate focused block in Scope/, 'Selected scope words for annotations.'));
    fireEvent.click(block);
    await waitFor(() => expect((screen.getByRole('button', { name: /Annotate focused block in Scope/ }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: /Annotate focused block in Scope/ }));
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('create-plan-revision-annotation', expect.objectContaining({ target: expect.objectContaining({ kind: 'block' }) })));
    await waitFor(() => expect((screen.getByRole('button', { name: /Annotate section Scope/ }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: /Annotate section Scope/ }));
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('create-plan-revision-annotation', expect.objectContaining({ target: expect.objectContaining({ kind: 'section', dimension: 'scope' }) })));
    await waitFor(() => expect((screen.getByRole('button', { name: /Annotate whole plan/ }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: /Annotate whole plan/ }));
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('create-plan-revision-annotation', expect.objectContaining({ target: expect.objectContaining({ kind: 'whole-plan', capturedText: expect.stringContaining('Done means visible controls') }) })));
  });

  it('renders unresolved annotation controls and invokes management actions', async () => {
    const invokeAction = createBridge(session);
    renderDetail(invokeAction as EforgeBridge['invokeAction'], session);
    const panel = await screen.findByLabelText(/Revision annotations for s/);
    const card = within(panel).getByText(/Selected scope/);
    expect(card).toBeTruthy();
    expect(within(panel).getAllByText(/words for annotations/).length).toBeGreaterThan(0);
    expect(panel.querySelectorAll('time[dateTime]').length).toBeGreaterThanOrEqual(2);
    fireEvent.click(within(panel).getByRole('button', { name: /Edit note/ }));
    fireEvent.change(within(panel).getByLabelText(/Note for annotation ann-1/), { target: { value: ' revised note ' } });
    fireEvent.click(within(panel).getByRole('button', { name: /Save note/ }));
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('update-plan-revision-annotation', { session: 's', annotationId: 'ann-1', body: 'revised note' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('resolve-plan-revision-annotation', { session: 's', annotationId: 'ann-1' }));
    await waitFor(() => expect((within(panel).getByRole('button', { name: /Dismiss/ }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(within(panel).getByRole('button', { name: /Dismiss/ }));
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('dismiss-plan-revision-annotation', { session: 's', annotationId: 'ann-1' }));
    await waitFor(() => expect((within(panel).getByRole('button', { name: /Delete/ }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(within(panel).getByRole('button', { name: /Delete/ }));
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('delete-plan-revision-annotation', { session: 's', annotationId: 'ann-1' }));
  });

  it('submits sticky annotation revision payloads and preserves manual prompt payloads', async () => {
    const two = { ...session, annotations: [annotation, { ...annotation, annotationId: 'ann-2', createdAt: '2026-01-01T00:01:00.000Z' }] };
    const invokeAction = createBridge(two);
    renderDetail(invokeAction as EforgeBridge['invokeAction'], two);
    const panel = await screen.findByLabelText(/Revision annotations for s/);
    await waitFor(() => expect(within(panel).getAllByText(/2 open annotations/).length).toBeGreaterThan(0));
    fireEvent.change(within(panel).getByPlaceholderText(/Tell the AI/), { target: { value: ' revise tightly ' } });
    fireEvent.click(within(panel).getByRole('button', { name: /Revise with AI from annotations/ }));
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('start-plan-revision-turn', { session: 's', annotationIds: ['ann-1', 'ann-2'], includeOpenAnnotations: true, steering: 'revise tightly' }));
    fireEvent.change(screen.getByLabelText('Ask the AI for plan revisions or answers'), { target: { value: ' revise ' } });
    fireEvent.click(screen.getByRole('button', { name: /Send to AI/ }));
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('start-plan-revision-turn', { session: 's', message: 'revise' }));
  });

  it('disables annotation revision submission when a turn is running', async () => {
    const running = { ...session, turns: [{ turnId: 'run', taskId: 'task', userMessage: 'm', basePlanFingerprint: 'h', baseSectionHashes: [], createdAt: '', task: { taskId: 'task', kind: 'k', status: 'running' as const, createdAt: '', updatedAt: '' } }] };
    const invokeAction = createBridge(running);
    renderDetail(invokeAction as EforgeBridge['invokeAction'], running);
    const button = await screen.findByRole('button', { name: /Revise with AI from annotations/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(invokeAction.mock.calls.filter(([id]) => id === 'start-plan-revision-turn')).toHaveLength(0);
  });
});
