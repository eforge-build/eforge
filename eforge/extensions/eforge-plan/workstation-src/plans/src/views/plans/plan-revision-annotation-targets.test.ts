import { describe, expect, it } from 'vitest';
import type { PlanRevisionAnnotation } from '@/types';
import { buildBlockAnnotationTarget, buildQuoteContext, buildSectionAnnotationTarget, buildSelectionAnnotationTarget, buildWholePlanAnnotationTarget, MAX_CAPTURED_TEXT, MAX_CONTEXT_TEXT, MAX_STEERING_TEXT } from './plan-revision-annotation-targets';
import { annotationSubmitDisabledReason, openAnnotations, syncSelectedAnnotationIds } from './plan-revision-annotation-view-model';

function keys(value: unknown): string[] { return Object.keys(value as Record<string, unknown>); }

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
    for (const key of [...keys(section), ...keys(whole)]) expect(['offset', 'startOffset', 'endOffset', 'range', 'nodePath', 'selector', 'xpath']).not.toContain(key);
  });
});

describe('plan revision annotation view model', () => {
  it('filters, sorts, and synchronizes selected annotation ids', () => {
    const open = openAnnotations([{ ...base, annotationId: 'b' }, { ...base, annotationId: 'a' }, { ...base, annotationId: 'c', resolvedAt: 'now' }, { ...base, annotationId: 'd', dismissedAt: 'now' }]);
    expect(open.map((annotation) => annotation.annotationId)).toEqual(['a', 'b']);
    expect(syncSelectedAnnotationIds(['old', 'b'], open)).toEqual(['b', 'a']);
  });

  it('reports disabled reasons for sticky annotation revision submission', () => {
    expect(annotationSubmitDisabledReason({ disabled: false, loading: false, busy: false, hasRunningTurn: true, selectedCount: 1, includeOpenAnnotations: false, steering: '' })).toMatch(/already running/);
    expect(annotationSubmitDisabledReason({ disabled: false, loading: false, busy: false, hasRunningTurn: false, selectedCount: 0, includeOpenAnnotations: false, steering: '' })).toMatch(/Select annotations/);
    expect(annotationSubmitDisabledReason({ disabled: false, loading: false, busy: false, hasRunningTurn: false, selectedCount: 1, includeOpenAnnotations: false, steering: 'x'.repeat(MAX_STEERING_TEXT + 1) })).toMatch(/too long/);
    expect(annotationSubmitDisabledReason({ disabled: false, loading: false, busy: false, hasRunningTurn: false, selectedCount: 0, includeOpenAnnotations: true, steering: '' })).toBeNull();
  });
});
