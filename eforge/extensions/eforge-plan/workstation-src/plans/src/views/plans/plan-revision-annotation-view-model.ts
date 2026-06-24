import type { PlanRevisionAnnotation } from '@/types';
import { titleCase } from './dimensions';
import { MAX_STEERING_TEXT } from './plan-revision-annotation-targets';

export function isOpenAnnotation(annotation: PlanRevisionAnnotation): boolean {
  return !annotation.resolvedAt && !annotation.dismissedAt;
}

export function openAnnotations(annotations: PlanRevisionAnnotation[] | undefined): PlanRevisionAnnotation[] {
  return sortAnnotations((annotations ?? []).filter(isOpenAnnotation));
}

export function sortAnnotations(annotations: PlanRevisionAnnotation[]): PlanRevisionAnnotation[] {
  return [...annotations].sort((a, b) => (a.createdAt.localeCompare(b.createdAt) || a.annotationId.localeCompare(b.annotationId)));
}

export function syncSelectedAnnotationIds(previous: string[], open: PlanRevisionAnnotation[]): string[] {
  const openIds = open.map((annotation) => annotation.annotationId);
  const keep = previous.filter((id) => openIds.includes(id));
  for (const id of openIds) if (!keep.includes(id)) keep.push(id);
  return keep;
}

export function shortAnnotationId(id: string): string {
  return id.length > 10 ? id.slice(0, 10) : id;
}

export function targetLabel(annotation: PlanRevisionAnnotation): string {
  const target = annotation.target;
  const kind = titleCase(target.kind);
  const dimension = target.dimension ? titleCase(target.dimension) : '';
  const label = target.label || kind;
  // Avoid repeating the dimension when the label is just its title (e.g. "Scope · Scope").
  // `label` is always non-empty (falls back to `kind`), so it is the base result.
  if (dimension && label !== dimension) return `${dimension} · ${label}`;
  return label;
}

export function contextExcerpt(annotation: PlanRevisionAnnotation): string {
  const { capturedText, quoteContext } = annotation.target;
  const prefix = quoteContext.prefix ? `…${quoteContext.prefix} ` : '';
  const suffix = quoteContext.suffix ? ` ${quoteContext.suffix}…` : '';
  return `${prefix}${capturedText || quoteContext.exact}${suffix}`;
}

/**
 * Disabled reason for the unified revision composer. Annotations are the
 * primary grounding, but a bare message is allowed (it becomes a plain
 * question/global-change turn), so the only hard requirement is that there is
 * either grounding or a non-empty message.
 */
export function revisionComposerDisabledReason(input: { loading: boolean; busy: boolean; hasRunningTurn: boolean; disabled: boolean; grounded: boolean; message: string }): string | null {
  if (input.disabled) return 'Plan is locked.';
  if (input.loading || input.busy) return 'Revision actions are busy.';
  if (input.hasRunningTurn) return 'A revision turn is already running.';
  if (input.message.length > MAX_STEERING_TEXT) return 'Message is too long.';
  if (!input.grounded && input.message.trim().length === 0) return 'Add a message or include annotations.';
  return null;
}
