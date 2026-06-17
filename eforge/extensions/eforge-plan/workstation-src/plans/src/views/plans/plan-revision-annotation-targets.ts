import type { PlanData, PlanRevisionAnnotationQuoteContext, PlanRevisionAnnotationTarget } from '@/types';
import { titleCase } from './dimensions';

export const MAX_CAPTURED_TEXT = 6000;
export const MAX_CONTEXT_TEXT = 1000;
export const MAX_LABEL_TEXT = 200;
export const MAX_STEERING_TEXT = 4000;

export function normalizeAnnotationWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function boundText(value: string, max: number): string {
  const clean = value.trim();
  return clean.length > max ? clean.slice(0, max).trimEnd() : clean;
}

function rootText(element: HTMLElement): string {
  return normalizeAnnotationWhitespace(element.innerText || element.textContent || '');
}

function boundedLabel(label: string | undefined, fallback: string): string {
  return boundText(label?.trim() || fallback, MAX_LABEL_TEXT);
}

export function buildQuoteContext(sourceText: string, capturedText: string): PlanRevisionAnnotationQuoteContext {
  const source = normalizeAnnotationWhitespace(sourceText);
  const exact = boundText(normalizeAnnotationWhitespace(capturedText), MAX_CAPTURED_TEXT);
  if (!exact) return { exact };
  const position = source.indexOf(exact);
  if (position < 0) return { exact };
  const prefix = boundText(source.slice(Math.max(0, position - MAX_CONTEXT_TEXT), position), MAX_CONTEXT_TEXT);
  const suffix = boundText(source.slice(position + exact.length, position + exact.length + MAX_CONTEXT_TEXT), MAX_CONTEXT_TEXT);
  return { exact, ...(prefix && { prefix }), ...(suffix && { suffix }) };
}

function target(kind: PlanRevisionAnnotationTarget['kind'], dimension: string | undefined, label: string, capturedText: string, sourceText: string): PlanRevisionAnnotationTarget | null {
  const captured = boundText(normalizeAnnotationWhitespace(capturedText), MAX_CAPTURED_TEXT);
  if (!captured) return null;
  return { kind, ...(dimension && { dimension }), label: boundedLabel(label, titleCase(dimension ?? kind)), capturedText: captured, quoteContext: buildQuoteContext(sourceText, captured) };
}

export function buildSelectionAnnotationTarget(selection: Selection | null, sectionRoot: HTMLElement, dimension: string, label?: string): PlanRevisionAnnotationTarget | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const selectedArea = selection.getRangeAt(0);
  const owner = selectedArea.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? selectedArea.commonAncestorContainer
    : selectedArea.commonAncestorContainer.parentElement ?? selectedArea.commonAncestorContainer.parentNode;
  const selectedText = selection.toString();
  const selectedInsideRoot = owner && sectionRoot.contains(owner);
  if (!selectedInsideRoot) return null;
  return target('selection', dimension, label ?? `${titleCase(dimension)} selection`, selectedText, rootText(sectionRoot));
}

export function buildBlockAnnotationTarget(blockElement: HTMLElement | null, sectionRoot: HTMLElement, dimension: string, label?: string): PlanRevisionAnnotationTarget | null {
  if (!blockElement || !sectionRoot.contains(blockElement)) return null;
  return target('block', dimension, label ?? `${titleCase(dimension)} block`, blockElement.innerText || blockElement.textContent || '', rootText(sectionRoot));
}

export function buildSectionAnnotationTarget(dimension: string, label: string | undefined, content: string): PlanRevisionAnnotationTarget | null {
  return target('section', dimension, label ?? titleCase(dimension), content, content);
}

export function buildWholePlanText(plan: PlanData): string {
  const parts = [`# ${plan.topic || plan.session}`, `Session: ${plan.session}`];
  for (const [dimension, content] of Object.entries(plan.sections ?? {})) {
    if (content.trim()) parts.push(`## ${titleCase(dimension)}`, content);
  }
  return boundText(parts.join('\n\n'), MAX_CAPTURED_TEXT);
}

export function buildWholePlanAnnotationTarget(plan: PlanData): PlanRevisionAnnotationTarget | null {
  const text = buildWholePlanText(plan);
  return target('whole-plan', undefined, `${plan.topic || plan.session} whole plan`, text, text);
}
