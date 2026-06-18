import type { PlanningAgentTaskRecord, RecommendationFreshnessView, RecommendationStatus, RoadmapSourceKind, RoadmapSourceProjection, RoadmapStateResponse } from '@/types';

export interface LocalFocusDraftState {
  draft: string;
  saved: string;
  maxBytes: number;
}

export interface LocalFocusEditState {
  bytes: number;
  maxBytes: number;
  dirty: boolean;
  overLimit: boolean;
  canSave: boolean;
}

export interface SourceSummary {
  local: number;
  configuredShared: number;
  discovered: number;
  conflicts: number;
  assumptions: number;
}

export interface SourceGroup {
  key: RoadmapSourceKind;
  title: string;
  sources: RoadmapSourceProjection[];
}

const encoder = new TextEncoder();

export function utf8ByteCount(value: string): number {
  return encoder.encode(value).length;
}

export function localFocusEditState(input: LocalFocusDraftState, busy = false): LocalFocusEditState {
  const bytes = utf8ByteCount(input.draft);
  const dirty = input.draft !== input.saved;
  const overLimit = bytes > input.maxBytes;
  return { bytes, maxBytes: input.maxBytes, dirty, overLimit, canSave: dirty && !overLimit && !busy };
}

export function sourceSummary(state: RoadmapStateResponse | null): SourceSummary {
  if (!state) return { local: 0, configuredShared: 0, discovered: 0, conflicts: 0, assumptions: 0 };
  return {
    local: state.context.localSteering ? 1 : 0,
    configuredShared: state.context.sharedContextSources.filter((source) => source.configured).length,
    discovered: state.context.discoveredContextSources.length,
    conflicts: state.context.conflicts.length,
    assumptions: state.context.assumptions.length,
  };
}

export function sourceKindLabel(kind: RoadmapSourceKind): string {
  switch (kind) {
    case 'local-focus': return 'Local focus';
    case 'configured-shared': return 'Configured shared context';
    case 'discovered-conventional': return 'Discovered context';
  }
}

export function sourceStatusText(source: RoadmapSourceProjection): string {
  if (source.readError) return 'read error';
  if (!source.exists) return 'missing';
  return source.sha256 ? 'available' : 'empty';
}

export function groupSources(state: RoadmapStateResponse | null): SourceGroup[] {
  if (!state) return [];
  const groups: SourceGroup[] = [
    { key: 'local-focus', title: sourceKindLabel('local-focus'), sources: [state.context.localSteering] },
    { key: 'configured-shared', title: sourceKindLabel('configured-shared'), sources: state.context.sharedContextSources },
    { key: 'discovered-conventional', title: sourceKindLabel('discovered-conventional'), sources: state.context.discoveredContextSources },
  ];
  return groups.filter((group) => group.sources.length > 0);
}

export function activeRefreshRunning(task: PlanningAgentTaskRecord | null | undefined): boolean {
  return task?.status === 'queued' || task?.status === 'running';
}

export function refreshDisabledReason(input: { dirty: boolean; saving: boolean; refreshing: boolean; activeTask?: PlanningAgentTaskRecord | null; status?: RecommendationStatus | null; freshness?: RecommendationFreshnessView | null }): string | null {
  if (input.dirty) return 'Save the local focus roadmap before refreshing recommendations.';
  if (input.saving) return 'Wait for the local focus roadmap save to finish.';
  if (input.refreshing) return 'Recommendation refresh is starting.';
  if (activeRefreshRunning(input.activeTask)) return 'A recommendation refresh task is already queued or running.';
  if ((input.freshness?.state ?? input.status?.state) === 'fresh') return null;
  return null;
}

export function formatBytes(bytes: number): string {
  return `${bytes.toLocaleString()} bytes`;
}

export function displayLabel(source: RoadmapSourceProjection): string {
  return source.label?.trim() || source.id?.trim() || source.path || sourceKindLabel(source.kind);
}
