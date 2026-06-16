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
  const dimension = target.dimension ? `${titleCase(target.dimension)} · ` : '';
  return `${dimension}${target.label || kind}`;
}

export function contextExcerpt(annotation: PlanRevisionAnnotation): string {
  const { capturedText, quoteContext } = annotation.target;
  const prefix = quoteContext.prefix ? `…${quoteContext.prefix} ` : '';
  const suffix = quoteContext.suffix ? ` ${quoteContext.suffix}…` : '';
  return `${prefix}${capturedText || quoteContext.exact}${suffix}`;
}

export function timestampLabelData(annotation: PlanRevisionAnnotation) {
  return [
    { label: 'Created', value: annotation.createdAt },
    { label: 'Updated', value: annotation.updatedAt },
  ];
}

export function annotationSubmitDisabledReason(input: { loading: boolean; busy: boolean; hasRunningTurn: boolean; disabled: boolean; selectedCount: number; includeOpenAnnotations: boolean; steering: string }): string | null {
  if (input.disabled) return 'Plan is locked.';
  if (input.loading || input.busy) return 'Revision actions are busy.';
  if (input.hasRunningTurn) return 'A revision turn is already running.';
  if (input.steering.length > MAX_STEERING_TEXT) return 'Steering text is too long.';
  if (input.selectedCount === 0 && !input.includeOpenAnnotations) return 'Select annotations or include all open annotations.';
  return null;
}
