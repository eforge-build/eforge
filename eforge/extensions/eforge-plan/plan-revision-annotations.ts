import { userActionError } from './action-errors.js';
import type { PlanRevisionAnnotation, PlanRevisionTurnAnnotationSnapshot } from './planning-agent-task-schemas.js';

export function isOpenPlanRevisionAnnotation(annotation: PlanRevisionAnnotation): boolean {
  return annotation.resolvedAt === undefined && annotation.dismissedAt === undefined;
}

export function derivePlanRevisionUserMessage(params: { message?: string; annotationIds?: string[]; includeOpenAnnotations?: boolean; steering?: string; openCount?: number; annotationCount?: number }): string {
  const message = params.message?.trim();
  if (message) return message;
  const selected = params.annotationIds?.length ?? 0;
  const open = params.includeOpenAnnotations === true ? params.openCount ?? 0 : 0;
  const count = params.annotationCount ?? selected + open;
  if (count > 0) return `Revise from ${count} plan ${count === 1 ? 'annotation' : 'annotations'}.`;
  const steering = params.steering?.trim();
  if (steering) return `Revise from steering: ${truncate(steering, 160)}`;
  return 'Revise from plan annotations.';
}

export function buildPlanRevisionAnnotationSnapshot(params: { annotations: PlanRevisionAnnotation[]; annotationIds?: string[]; includeOpenAnnotations?: boolean; steering?: string; now: string }): PlanRevisionTurnAnnotationSnapshot | undefined {
  const selectedIds = uniqueSorted(params.annotationIds ?? []);
  const openIds = params.includeOpenAnnotations === true ? uniqueSorted(params.annotations.filter(isOpenPlanRevisionAnnotation).map((annotation) => annotation.annotationId)) : [];
  const steering = params.steering?.trim();
  if (selectedIds.length === 0 && openIds.length === 0 && !steering) return undefined;
  const byId = new Map(params.annotations.map((annotation) => [annotation.annotationId, annotation]));
  const missing = selectedIds.filter((id) => !byId.has(id));
  if (missing.length > 0) throw userActionError(`Unknown plan revision annotation ids: ${missing.join(', ')}.`, { path: 'annotationIds', details: { annotationIds: missing } });
  const selected = new Set(selectedIds);
  const open = new Set(openIds);
  const ids = uniqueSorted([...selectedIds, ...openIds]);
  if (ids.length === 0 && !steering) return undefined;
  const annotations = ids.map((id) => {
    const annotation = byId.get(id);
    if (annotation === undefined) throw userActionError(`Unknown plan revision annotation id ${id}.`, { path: 'annotationIds', details: { annotationIds: [id] } });
    const reason: 'selected' | 'open' | 'selected-and-open' = selected.has(id) && open.has(id) ? 'selected-and-open' : selected.has(id) ? 'selected' : 'open';
    return deepCopy({ ...annotation, snapshotAt: params.now, snapshotReason: reason });
  });
  return {
    ...(steering && { steering }),
    selectedAnnotationIds: selectedIds,
    openAnnotationIds: openIds,
    includeOpenAnnotations: params.includeOpenAnnotations === true,
    annotations,
  };
}

export function assertSelectedPlanRevisionAnnotationsExist(annotations: PlanRevisionAnnotation[], annotationIds: string[] = []): void {
  const ids = new Set(annotations.map((annotation) => annotation.annotationId));
  const missing = annotationIds.filter((id) => !ids.has(id));
  if (missing.length > 0) throw userActionError(`Unknown plan revision annotation ids: ${missing.join(', ')}.`, { path: 'annotationIds', details: { annotationIds: missing } });
}

export function referencedAnnotationIds(snapshot: PlanRevisionTurnAnnotationSnapshot | undefined): string[] {
  return uniqueSorted(snapshot?.annotations.map((annotation) => annotation.annotationId) ?? []);
}

export function projectAnnotationSnapshotForSource(snapshot: PlanRevisionTurnAnnotationSnapshot | undefined): unknown | undefined {
  if (snapshot === undefined) return undefined;
  return deepCopy(snapshot);
}

export function summarizeAnnotationSnapshot(snapshot: PlanRevisionTurnAnnotationSnapshot | undefined): unknown | undefined {
  if (snapshot === undefined) return undefined;
  return {
    ...(snapshot.steering !== undefined && { steering: snapshot.steering }),
    includeOpenAnnotations: snapshot.includeOpenAnnotations,
    selectedAnnotationIds: snapshot.selectedAnnotationIds,
    openAnnotationIds: snapshot.openAnnotationIds,
    selectedCount: snapshot.selectedAnnotationIds.length,
    openCount: snapshot.openAnnotationIds.length,
    annotationCount: snapshot.annotations.length,
    annotations: snapshot.annotations.slice(0, 8).map((annotation) => ({
      annotationId: annotation.annotationId,
      snapshotReason: annotation.snapshotReason,
      kind: annotation.target.kind,
      ...(annotation.target.dimension !== undefined && { dimension: annotation.target.dimension }),
      ...(annotation.target.label !== undefined && { label: truncate(annotation.target.label, 120) }),
      capturedTextPreview: truncate(annotation.target.capturedText, 160),
      hasBody: annotation.body !== undefined && annotation.body.length > 0,
    })),
  };
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
