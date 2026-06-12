import type { AgentTaskStatus, PlanData, PlanRevisionApplyOutput, PlanRevisionTurnProjection, PlanningAgentTaskRecord } from '@/types';
import { normalizeDimension, sectionContent } from './dimensions';

export type RevisionResultKind = 'answer' | 'patch' | 'needs-input' | 'failed' | 'cancelled' | 'running' | 'queued' | 'unavailable';

export interface RevisionSummaryCounts {
  running: number;
  failed: number;
  patchReady: number;
  needsInput: number;
  appliedSections: number;
}

export function chronologicalTurns(turns: PlanRevisionTurnProjection[]): PlanRevisionTurnProjection[] {
  return [...turns].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

export function isActiveStatus(status: AgentTaskStatus | undefined): boolean {
  return status === 'queued' || status === 'running';
}

export function classifyRevisionTurn(turn: PlanRevisionTurnProjection): RevisionResultKind {
  if (turn.available === false || !turn.task) return 'unavailable';
  if (turn.task.status === 'queued') return 'queued';
  if (turn.task.status === 'running') return 'running';
  if (turn.task.status === 'failed') return 'failed';
  if (turn.task.status === 'cancelled') return 'cancelled';
  if (turn.task.result?.decision === 'needs-input') return 'needs-input';
  const sections = patchSections(turn);
  if (sections.length > 0) return 'patch';
  if (turn.task.result?.planRevisionTurn) return 'answer';
  return 'unavailable';
}

export function revisionSummaryCounts(turns: PlanRevisionTurnProjection[]): RevisionSummaryCounts {
  return turns.reduce<RevisionSummaryCounts>((counts, turn) => {
    const kind = classifyRevisionTurn(turn);
    if (kind === 'queued' || kind === 'running') counts.running += 1;
    if (kind === 'failed' || kind === 'cancelled' || kind === 'unavailable') counts.failed += 1;
    if (kind === 'patch') counts.patchReady += 1;
    if (kind === 'needs-input') counts.needsInput += 1;
    counts.appliedSections += turn.appliedSections?.length ?? 0;
    return counts;
  }, { running: 0, failed: 0, patchReady: 0, needsInput: 0, appliedSections: 0 });
}

export function patchSections(turn: PlanRevisionTurnProjection) {
  return turn.task?.result?.planRevisionTurn?.proposedPatch?.sections ?? [];
}

export function currentSectionContent(plan: PlanData, dimension: string): string {
  return sectionContent(plan.sections, dimension);
}

export function defaultSelectedSections(turn: PlanRevisionTurnProjection): string[] {
  const applied = new Set((turn.appliedSections ?? []).map(normalizeDimension));
  return patchSections(turn).map((section) => normalizeDimension(section.dimension)).filter((dimension) => !applied.has(dimension));
}

export function hasRunningRevisionTurn(turns: PlanRevisionTurnProjection[]): boolean {
  return turns.some((turn) => isActiveStatus(turn.task?.status ?? turn.status));
}

export function statusLabel(turn: PlanRevisionTurnProjection): string {
  if (turn.task?.status) return turn.task.status;
  if (turn.staleReason) return 'missing task';
  return 'unknown';
}

export function taskProgressText(task: PlanningAgentTaskRecord | undefined): string | null {
  if (!task) return null;
  const sectionProgress = task.metadata?.sectionProgress;
  const parts = [
    task.metadata?.progressMessage,
    sectionProgress?.currentSection ? `Current section: ${sectionProgress.currentSection}` : undefined,
    formatSectionProgressList('Covered', sectionProgress?.coveredSections),
    formatSectionProgressList('Remaining', sectionProgress?.remainingSections),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function formatSectionProgressList(label: string, sections: unknown): string | undefined {
  if (!Array.isArray(sections) || sections.length === 0) return undefined;
  const normalized = sections.map(String).filter(Boolean);
  if (normalized.length === 0) return undefined;
  const visible = normalized.slice(0, 3).join(', ');
  const suffix = normalized.length > 3 ? ` +${normalized.length - 3}` : '';
  return `${label} (${normalized.length}): ${visible}${suffix}`;
}

export function applyResultText(result: PlanRevisionApplyOutput | undefined): string | null {
  if (!result) return null;
  if (result.kind === 'applied') return `Applied sections: ${result.appliedSections.join(', ')}`;
  return result.message;
}

export function applyResultDetails(result: PlanRevisionApplyOutput | undefined): Array<[string, string]> {
  if (!result) return [];
  if (result.kind === 'stale') {
    return [['session', result.session], ['basePlanFingerprint', result.basePlanFingerprint], ['currentPlanFingerprint', result.currentPlanFingerprint]];
  }
  if (result.kind === 'not-applicable') {
    return [['session', result.session], ...(result.taskId ? [['taskId', result.taskId] as [string, string]] : []), ...(result.turnId ? [['turnId', result.turnId] as [string, string]] : [])];
  }
  return [];
}
