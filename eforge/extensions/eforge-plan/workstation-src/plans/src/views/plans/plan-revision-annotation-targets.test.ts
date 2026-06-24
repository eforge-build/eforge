import { describe, expect, it } from 'vitest';
import type { PlanRevisionAnnotation } from '@/types';
import { buildBlockAnnotationTarget, buildQuoteContext, buildSectionAnnotationTarget, buildSelectionAnnotationTarget, buildWholePlanAnnotationTarget, MAX_CAPTURED_TEXT, MAX_CONTEXT_TEXT, MAX_STEERING_TEXT } from './plan-revision-annotation-targets';
import { openAnnotations, revisionComposerDisabledReason, syncSelectedAnnotationIds, targetLabel } from './plan-revision-annotation-view-model';

const brittleTargetKeys = ['offset', 'startOffset', 'endOffset', 'range', 'nodePath', 'selector', 'xpath'];

function allKeys(value: unknown): string[] {
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => [key, ...allKeys(nested)]);
}

const target = buildSectionAnnotationTarget('scope', 'Scope', 'Captured text')!;
const base: PlanRevisionAnnotation = { annotationId: 'a', targetSession: 's', target, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };

describe('plan revision annotation targets', () => {
  it('builds bounded quote context around captured text', () => {
    const context = buildQuoteContext(`before ${'x'.repeat(MAX_CONTEXT_TEXT + 20)} exact text ${'y'.repeat(MAX_CONTEXT_TEXT + 20)} after`, ' exact text ');
    expect(context.exact).toBe('exact text');
    expect(context.prefix?.length).toBeLessThanOrEqual(MAX_CONTEXT_TEXT);
    expect(context.suffix?.length).toBeLessThanOrEqual(MAX_CONTEXT_TEXT);
    expect(buildQuoteContext('source', 'z'.repeat(MAX_CAPTURED_TEXT + 10)).exact).toHaveLength(MAX_CAPTURED_TEXT);
  });

  it('rejects collapsed and outside selections', () => {
    const root = document.createElement('div');
    root.textContent = 'inside text';
    document.body.append(root);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    const area = document.createRange();
    area.setStart(root.firstChild!, 0);
    area.collapse(true);
    selection.addRange(area);
    expect(buildSelectionAnnotationTarget(selection, root, 'scope')).toBeNull();
    const outside = document.createElement('p');
    outside.textContent = 'outside';
    document.body.append(outside);
    selection.removeAllRanges();
    const outsideArea = document.createRange();
    outsideArea.selectNodeContents(outside);
    selection.addRange(outsideArea);
    expect(buildSelectionAnnotationTarget(selection, root, 'scope')).toBeNull();
  });

  it('captures in-section selections and rendered blocks', () => {
    const root = document.createElement('div');
    root.textContent = 'alpha beta gamma';
    document.body.append(root);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    const area = document.createRange();
    area.setStart(root.firstChild!, 6);
    area.setEnd(root.firstChild!, 10);
    selection.addRange(area);
    expect(buildSelectionAnnotationTarget(selection, root, 'scope')).toMatchObject({ kind: 'selection', dimension: 'scope', capturedText: 'beta', quoteContext: { exact: 'beta' } });
    const block = document.createElement('p');
    block.textContent = 'block words';
    root.append(block);
    expect(buildBlockAnnotationTarget(block, root, 'scope')).toMatchObject({ kind: 'block', capturedText: 'block words' });
  });

  it('creates semantic section and whole-plan targets without brittle anchor data', () => {
    const section = buildSectionAnnotationTarget('scope', 'Scope', 'body')!;
    const whole = buildWholePlanAnnotationTarget({ session: 's', topic: 'Topic', status: 'planning', sections: { scope: 'body', 'acceptance criteria': 'done' } })!;
    expect(section).toMatchObject({ kind: 'section', dimension: 'scope' });
    expect(whole).toMatchObject({ kind: 'whole-plan' });
    for (const key of [...allKeys(section), ...allKeys(whole)]) expect(brittleTargetKeys).not.toContain(key);
  });

  it('omits durable DOM anchors from selection and block targets', () => {
    const root = document.createElement('section');
    root.innerHTML = '<p>alpha beta gamma</p><p>second block</p>';
    document.body.append(root);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    const area = document.createRange();
    area.setStart(root.querySelector('p')!.firstChild!, 6);
    area.setEnd(root.querySelector('p')!.firstChild!, 10);
    selection.addRange(area);

    const selected = buildSelectionAnnotationTarget(selection, root, 'scope', 'Scope selection')!;
    const block = buildBlockAnnotationTarget(root.querySelectorAll('p')[1] as HTMLElement, root, 'scope', 'Scope block')!;

    expect(selected).toMatchObject({ kind: 'selection', capturedText: 'beta', quoteContext: { exact: 'beta' } });
    expect(block).toMatchObject({ kind: 'block', capturedText: 'second block', quoteContext: { exact: 'second block' } });
    for (const key of [...allKeys(selected), ...allKeys(block)]) expect(brittleTargetKeys).not.toContain(key);
  });
});

describe('plan revision annotation view model', () => {
  it('filters, sorts, and synchronizes selected annotation ids', () => {
    const open = openAnnotations([{ ...base, annotationId: 'b' }, { ...base, annotationId: 'a' }, { ...base, annotationId: 'c', resolvedAt: 'now' }, { ...base, annotationId: 'd', dismissedAt: 'now' }]);
    expect(open.map((annotation) => annotation.annotationId)).toEqual(['a', 'b']);
    expect(syncSelectedAnnotationIds(['old', 'b'], open)).toEqual(['b', 'a']);
  });

  it('labels targets without repeating the dimension title', () => {
    const withTarget = (overrides: Partial<PlanRevisionAnnotation['target']>): PlanRevisionAnnotation => ({ ...base, target: { ...base.target, ...overrides } });
    // Distinct label keeps the "Dimension · Label" form.
    expect(targetLabel(withTarget({ dimension: 'scope', label: 'Edge cases' }))).toBe('Scope · Edge cases');
    // Label equal to the dimension title is shown once, not "Scope · Scope".
    expect(targetLabel(withTarget({ dimension: 'scope', label: 'Scope' }))).toBe('Scope');
    // No dimension falls back to the label (or the title-cased kind when label is absent).
    expect(targetLabel(withTarget({ dimension: undefined, label: 'Custom label' }))).toBe('Custom label');
    expect(targetLabel(withTarget({ kind: 'whole-plan', dimension: undefined, label: undefined }))).toBe('Whole Plan');
  });

  it('reports disabled reasons for the unified revision composer', () => {
    expect(revisionComposerDisabledReason({ disabled: false, loading: false, busy: false, hasRunningTurn: true, grounded: true, message: '' })).toMatch(/already running/);
    expect(revisionComposerDisabledReason({ disabled: false, loading: false, busy: false, hasRunningTurn: false, grounded: false, message: '' })).toMatch(/Add a message or include annotations/);
    expect(revisionComposerDisabledReason({ disabled: false, loading: false, busy: false, hasRunningTurn: false, grounded: true, message: 'x'.repeat(MAX_STEERING_TEXT + 1) })).toMatch(/too long/);
    // A bare message with no grounding is allowed - it becomes a plain message turn.
    expect(revisionComposerDisabledReason({ disabled: false, loading: false, busy: false, hasRunningTurn: false, grounded: false, message: 'ask a question' })).toBeNull();
    expect(revisionComposerDisabledReason({ disabled: false, loading: false, busy: false, hasRunningTurn: false, grounded: true, message: '' })).toBeNull();
  });
});
