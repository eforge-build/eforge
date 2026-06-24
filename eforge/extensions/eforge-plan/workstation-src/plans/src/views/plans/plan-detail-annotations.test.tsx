import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/toast';
import type { Artifact, EforgeBridge, PlanDetail, PlanRevisionAnnotation, PlanRevisionSessionProjection } from '@/types';
import { PlanDetailWorkspace } from './plan-detail-workspace';

const plan = { session: 's', topic: 'Topic', status: 'planning', sections: { 'executive summary': 'Summary first for review.', scope: 'Selected scope words for annotations.', 'acceptance criteria': 'Done means visible controls.' } };
const annotation: PlanRevisionAnnotation = { annotationId: 'ann-1', targetSession: 's', body: 'Needs detail', target: { kind: 'selection', dimension: 'scope', label: 'Scope selection', capturedText: 'Selected scope', quoteContext: { exact: 'Selected scope', suffix: 'words for annotations.' } }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:05:00.000Z' };
const session: PlanRevisionSessionProjection = { threadId: 'thread', targetSession: 's', createdAt: '', updatedAt: '', plan, annotations: [annotation], turns: [] };

// `_projected` is accepted positionally (call sites pass the bridge projection
// here for readability) but the projection actually wired into the component
// comes from `createBridge`; the prefix marks it as intentionally unused.
function renderDetail(invokeAction: EforgeBridge['invokeAction'], _projected: PlanRevisionSessionProjection = session, artifact: Artifact = { key: 'plan:s', kind: 'plan', session: 's', title: 'Topic' }, titles = new Map<string, string>()) {
  window.eforge = { invokeAction };
  const detail: PlanDetail & { plan: typeof plan } = { plan, readiness: { ready: false } };
  return render(<ToastProvider><PlanDetailWorkspace detail={detail} artifact={artifact} titles={titles} onApply={vi.fn()} onRefresh={vi.fn(async () => undefined)} onDeleted={vi.fn(async () => undefined)} onClose={vi.fn()} /></ToastProvider>);
}

function createBridge(projected: PlanRevisionSessionProjection = { ...session, annotations: [] }) {
  return vi.fn(async (actionId: string, input: Record<string, unknown>) => {
    if (actionId === 'start-plan-revision-turn') return { session: projected };
    if (actionId.endsWith('plan-revision-annotation')) return projected;
    if (actionId === 'get-plan-revision-session' || actionId === 'start-plan-revision-session') return projected;
    return projected;
  });
}

function expandPlanSection(title = 'Scope') {
  const toggle = screen.getByRole('button', { name: `Toggle ${title} section` });
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
}

function sectionFor(title = 'Scope') {
  const toggle = screen.getByRole('button', { name: `Toggle ${title} section` });
  const section = toggle.closest('section');
  expect(section).toBeTruthy();
  return section as HTMLElement;
}

function decoratedBlockFor(text: string, title = 'Scope') {
  const section = sectionFor(title);
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
  const block = decoratedBlockFor(fullText);
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
  beforeEach(() => { cleanup(); document.body.innerHTML = ''; window.localStorage.clear(); delete window.eforge; });

  it('captures selected text inside a rendered section', async () => {
    const invokeAction = createBridge();
    renderDetail(invokeAction as EforgeBridge['invokeAction'], { ...session, annotations: [] });
    expandPlanSection();
    await waitFor(() => decoratedBlockFor('Selected scope words for annotations.'));
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('get-plan-revision-session', { session: 's', includePlan: false }));
    await selectSubstringInside('Selected scope words for annotations.', 'Selected scope');
    const selectionButton = await screen.findByRole('button', { name: 'Annotate' }) as HTMLButtonElement;
    fireEvent.mouseDown(selectionButton);
    await selectSubstringInside('Selected scope words for annotations.', 'Selected scope');
    fireEvent.click(selectionButton);
    expect(invokeAction.mock.calls.map(([id]) => id)).not.toContain('create-plan-revision-annotation');
    const composer = await screen.findByLabelText('Pending annotation composer');
    expect(within(composer).getByText('selection')).toBeTruthy();
    expect(within(composer).getAllByText(/Selected scope/).length).toBeGreaterThan(0);
    expect(within(composer).getByText(/words for annotations/)).toBeTruthy();
    fireEvent.change(within(composer).getByLabelText('Annotation note'), { target: { value: ' trim me ' } });
    fireEvent.click(within(composer).getByRole('button', { name: /Save annotation/ }));
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('create-plan-revision-annotation', expect.objectContaining({ session: 's', body: 'trim me', target: expect.objectContaining({ kind: 'selection', dimension: 'scope', capturedText: 'Selected scope', quoteContext: expect.objectContaining({ exact: 'Selected scope' }) }) })));
  });

  it('cancels pending selected-text annotations without creating them', async () => {
    const invokeAction = createBridge();
    renderDetail(invokeAction as EforgeBridge['invokeAction'], { ...session, annotations: [] });
    expandPlanSection();
    await waitFor(() => decoratedBlockFor('Selected scope words for annotations.'));
    await selectSubstringInside('Selected scope words for annotations.', 'Selected scope');
    const annotateSelection = await screen.findByRole('button', { name: 'Annotate' }) as HTMLButtonElement;
    fireEvent.mouseDown(annotateSelection);
    await selectSubstringInside('Selected scope words for annotations.', 'Selected scope');
    fireEvent.click(annotateSelection);
    const composer = await screen.findByLabelText('Pending annotation composer');
    fireEvent.click(within(composer).getByRole('button', { name: /Cancel annotation/ }));
    expect(screen.getByLabelText('Pending annotation composer empty')).toBeTruthy();
    expect(invokeAction.mock.calls.map(([id]) => id)).not.toContain('create-plan-revision-annotation');
  });

  it('does not create a selected-text annotation for a selection outside the rendered section', async () => {
    const invokeAction = createBridge();
    renderDetail(invokeAction as EforgeBridge['invokeAction'], { ...session, annotations: [] });
    expandPlanSection();
    await waitFor(() => decoratedBlockFor('Selected scope words for annotations.'));
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('get-plan-revision-session', { session: 's', includePlan: false }));
    selectOutsideRenderedSections('outside selection');
    // A selection outside the rendered section never surfaces the floating Annotate affordance.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Annotate' })).toBeNull());
    expect(invokeAction.mock.calls.map(([id]) => id)).not.toContain('create-plan-revision-annotation');
  });

  it('captures block, section, and whole-plan targets in the rail composer and save payloads', async () => {
    const invokeAction = createBridge();
    renderDetail(invokeAction as EforgeBridge['invokeAction'], { ...session, annotations: [] });
    expandPlanSection();
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('get-plan-revision-session', { session: 's', includePlan: false }));
    const block = await waitFor(() => decoratedBlockFor('Selected scope words for annotations.'));
    fireEvent.focus(block);
    await screen.findByRole('button', { name: /Annotate this block in Scope/ });

    const cases = [
      { kind: 'block', button: /Annotate this block in Scope/, target: 'Scope block', dimension: 'Scope', excerpt: /Selected scope words for annotations/, exact: /Selected scope words for annotations\./, exactPayload: /Selected scope words for annotations\./, note: 'block note' },
      { kind: 'section', button: /Annotate the entire Scope section/, target: 'Scope', dimension: 'Scope', excerpt: /Selected scope words for annotations/, exact: /Selected scope words for annotations\./, exactPayload: /Selected scope words for annotations\./, note: 'section note' },
      { kind: 'whole-plan', button: /Annotate whole plan/, target: 'Topic whole plan', dimension: null, excerpt: /Done means visible controls/, exact: /# Topic/, exactPayload: /# Topic/, note: 'whole plan note' },
    ] as const;

    for (const entry of cases) {
      const button = screen.getByRole('button', { name: entry.button }) as HTMLButtonElement;
      await waitFor(() => expect(button.disabled).toBe(false));
      const createCount = invokeAction.mock.calls.filter(([id]) => id === 'create-plan-revision-annotation').length;
      fireEvent.click(button);
      const composer = screen.getByLabelText('Pending annotation composer');
      expect(invokeAction.mock.calls.filter(([id]) => id === 'create-plan-revision-annotation')).toHaveLength(createCount);
      const scoped = within(composer);
      expect(scoped.getByText(entry.kind)).toBeTruthy();
      expect(scoped.getByText('Target')).toBeTruthy();
      expect(scoped.getAllByText(entry.target).length).toBeGreaterThan(0);
      if (entry.dimension) {
        expect(scoped.getByText('Dimension')).toBeTruthy();
        expect(scoped.getAllByText(entry.dimension).length).toBeGreaterThan(0);
      }
      expect(scoped.getByText('Captured excerpt')).toBeTruthy();
      expect(scoped.getAllByText(entry.excerpt).length).toBeGreaterThan(0);
      expect(scoped.getByText('Quote context')).toBeTruthy();
      expect(scoped.getByText('Exact:')).toBeTruthy();
      expect(scoped.getAllByText(entry.exact).length).toBeGreaterThan(0);
      const note = scoped.getByLabelText('Annotation note');
      expect(note).toBeTruthy();
      fireEvent.change(note, { target: { value: ` ${entry.note} ` } });
      fireEvent.click(scoped.getByRole('button', { name: /Save annotation/ }));
      await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('create-plan-revision-annotation', expect.objectContaining({ session: 's', body: entry.note, target: expect.objectContaining({ kind: entry.kind, ...(entry.dimension && { dimension: 'scope' }), capturedText: expect.stringMatching(entry.excerpt), quoteContext: expect.objectContaining({ exact: expect.stringMatching(entry.exactPayload) }) }) })));
    }
  });

  it('renders plan context details inside the review rail', async () => {
    const invokeAction = createBridge();
    const artifact: Artifact = {
      key: 'plan:s',
      kind: 'plan',
      session: 's',
      title: 'Topic',
      status: 'planning',
      lifecycleState: 'building',
      sourceRefs: { sourceItemIds: ['item-1'], sourceEpicIds: ['epic-1'] },
      prRefs: [{ url: 'https://example.com/pull/1' }],
    };
    renderDetail(invokeAction as EforgeBridge['invokeAction'], { ...session, annotations: [] }, artifact, new Map([['item-1', 'Backlog source title']]));
    const rail = await screen.findByLabelText(/Plan review rail for s/);
    expect(within(rail).getByText('Plan context')).toBeTruthy();
    expect(within(rail).getByText('Backlog source title')).toBeTruthy();
    expect(within(rail).getByText('epic-1')).toBeTruthy();
    expect(within(rail).getByText('building')).toBeTruthy();
    expect(within(rail).getByRole('link', { name: /View pull request/ }).getAttribute('href')).toBe('https://example.com/pull/1');
  });

  it('renders unresolved annotation controls only in the review rail and invokes management actions', async () => {
    const invokeAction = createBridge(session);
    renderDetail(invokeAction as EforgeBridge['invokeAction'], session);
    const panel = await screen.findByLabelText(/Revision annotations for s/);
    const rail = screen.getByLabelText(/Plan review rail for s/);
    const main = screen.getAllByText('Topic')[0].closest('section') as HTMLElement;
    expect(within(rail).getByLabelText(/Revision annotations for s/)).toBeTruthy();
    expect(within(rail).getByRole('button', { name: /Revise with AI from annotations/ })).toBeTruthy();
    expect(within(rail).getByRole('button', { name: /Send to AI/ })).toBeTruthy();
    expect(within(rail).getByRole('button', { name: /Edit note for annotation ann-1/ })).toBeTruthy();
    expect(within(main).queryByLabelText(/Revision annotations for s/)).toBeNull();
    expect(within(main).queryByRole('button', { name: /Revise with AI from annotations/ })).toBeNull();
    expect(within(main).queryByRole('button', { name: /Send to AI/ })).toBeNull();
    expect(within(main).queryByRole('button', { name: /Edit note for annotation ann-1/ })).toBeNull();
    const card = within(panel).getByText(/Selected scope/);
    expect(card).toBeTruthy();
    expect(within(panel).getAllByText(/words for annotations/).length).toBeGreaterThan(0);
    expect(panel.querySelectorAll('time[dateTime]').length).toBeGreaterThanOrEqual(2);
    fireEvent.click(within(panel).getByRole('button', { name: /Edit note for annotation ann-1/ }));
    fireEvent.change(within(panel).getByLabelText(/Note for annotation ann-1/), { target: { value: ' revised note ' } });
    fireEvent.click(within(panel).getByRole('button', { name: /Save note for annotation ann-1/ }));
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('update-plan-revision-annotation', { session: 's', annotationId: 'ann-1', body: 'revised note' }));
    fireEvent.click(within(panel).getByRole('button', { name: /Resolve annotation ann-1/ }));
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('resolve-plan-revision-annotation', { session: 's', annotationId: 'ann-1' }));
    await waitFor(() => expect((within(panel).getByRole('button', { name: /Dismiss annotation ann-1/ }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(within(panel).getByRole('button', { name: /Dismiss annotation ann-1/ }));
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('dismiss-plan-revision-annotation', { session: 's', annotationId: 'ann-1' }));
    await waitFor(() => expect((within(panel).getByRole('button', { name: /Delete annotation ann-1/ }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(within(panel).getByRole('button', { name: /Delete annotation ann-1/ }));
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('delete-plan-revision-annotation', { session: 's', annotationId: 'ann-1' }));
  });

  it('submits sticky annotation revision payloads and preserves manual prompt payloads', async () => {
    const two = { ...session, annotations: [annotation, { ...annotation, annotationId: 'ann-2', createdAt: '2026-01-01T00:01:00.000Z' }] };
    const invokeAction = createBridge(two);
    renderDetail(invokeAction as EforgeBridge['invokeAction'], two);
    const panel = await screen.findByLabelText(/Revision annotations for s/);
    await waitFor(() => expect(within(panel).getAllByText(/2 open annotations/).length).toBeGreaterThan(0));
    fireEvent.click(within(panel).getByLabelText(/Select annotation ann-2 for revision/));
    fireEvent.click(within(panel).getByLabelText('Include all open annotations'));
    fireEvent.change(within(panel).getByPlaceholderText(/Tell the AI/), { target: { value: ' revise tightly ' } });
    fireEvent.click(within(panel).getByRole('button', { name: /Revise with AI from annotations/ }));
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('start-plan-revision-turn', { session: 's', annotationIds: ['ann-1'], includeOpenAnnotations: false, steering: 'revise tightly' }));
    fireEvent.click(within(panel).getByLabelText(/Select annotation ann-2 for revision/));
    fireEvent.click(within(panel).getByLabelText('Include all open annotations'));
    fireEvent.change(within(panel).getByPlaceholderText(/Tell the AI/), { target: { value: ' revise broadly ' } });
    fireEvent.click(within(panel).getByRole('button', { name: /Revise with AI from annotations/ }));
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('start-plan-revision-turn', { session: 's', annotationIds: ['ann-1', 'ann-2'], includeOpenAnnotations: true, steering: 'revise broadly' }));
    fireEvent.change(screen.getByLabelText('Ask the AI for plan revisions or answers'), { target: { value: ' revise ' } });
    fireEvent.click(screen.getByRole('button', { name: /Send to AI/ }));
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('start-plan-revision-turn', { session: 's', message: 'revise' }));
  });

  it.each(['queued', 'running'] as const)('disables annotation revision submission when a turn is %s', async (status) => {
    const active = { ...session, turns: [{ turnId: status, taskId: 'task', userMessage: 'm', basePlanFingerprint: 'h', baseSectionHashes: [], createdAt: '', task: { taskId: 'task', kind: 'k', status, createdAt: '', updatedAt: '' } }] };
    const invokeAction = createBridge(active);
    renderDetail(invokeAction as EforgeBridge['invokeAction'], active);
    const button = await screen.findByRole('button', { name: /Revise with AI from annotations/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(invokeAction.mock.calls.filter(([id]) => id === 'start-plan-revision-turn')).toHaveLength(0);
  });
});
