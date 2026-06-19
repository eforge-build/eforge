import type {
  QueueRecoveryAnalyzeResponse,
  QueueRecoveryApplyResponse,
  QueueRecoveryDependencyClassification,
  QueueRecoveryDispatchPreflightItem,
  QueueRecoveryRepairAction,
  QueueRecoveryRepairResult,
} from '@eforge-build/client/browser';

export type RemovalSelection = Record<string, boolean>;
export type StackParentSelection = Record<string, string | undefined>;

export interface DependencyRowGroup {
  targetPrdId: string;
  rows: QueueRecoveryDependencyClassification[];
}

export interface StackParentChoice {
  targetPrdId: string;
  currentStackParent?: string;
  candidates: string[];
  required: boolean;
  blockers: string[];
}

export interface CascadeRepairState {
  dependencyGroups: DependencyRowGroup[];
  removableDependencies: Array<{ key: string; targetPrdId: string; dependencyId: string }>;
  stackParentChoices: StackParentChoice[];
  selectedRepairActions: QueueRecoveryRepairAction[];
  unresolvedPreflightBlockers: string[];
  requiresDependencyRemovalConfirmation: boolean;
  applyDisabledReasons: string[];
}

export function removalKey(targetPrdId: string, dependencyId: string): string {
  return `${targetPrdId}::${dependencyId}`;
}

export function deriveDependencyGroups(
  classifications: QueueRecoveryAnalyzeResponse['dependencyClassifications'] = [],
): DependencyRowGroup[] {
  const groups = new Map<string, QueueRecoveryDependencyClassification[]>();
  for (const row of classifications) {
    const rows = groups.get(row.targetPrdId) ?? [];
    rows.push(row);
    groups.set(row.targetPrdId, rows);
  }
  return [...groups.entries()].map(([targetPrdId, rows]) => ({ targetPrdId, rows }));
}

function removeActions(analysis: QueueRecoveryAnalyzeResponse): Extract<QueueRecoveryRepairAction, { kind: 'remove-depends-on' }>[] {
  return (analysis.availableRepairActions ?? []).filter((action): action is Extract<QueueRecoveryRepairAction, { kind: 'remove-depends-on' }> => action.kind === 'remove-depends-on');
}

function stackActions(analysis: QueueRecoveryAnalyzeResponse): Extract<QueueRecoveryRepairAction, { kind: 'set-stack-parent' }>[] {
  return (analysis.availableRepairActions ?? []).filter((action): action is Extract<QueueRecoveryRepairAction, { kind: 'set-stack-parent' }> => action.kind === 'set-stack-parent');
}

export function deriveRemovableDependencies(analysis: QueueRecoveryAnalyzeResponse): Array<{ key: string; targetPrdId: string; dependencyId: string }> {
  return removeActions(analysis).flatMap((action) => action.dependencyIds.map((dependencyId) => ({
    key: removalKey(action.targetPrdId, dependencyId),
    targetPrdId: action.targetPrdId,
    dependencyId,
  })));
}

function candidatesForItem(item: QueueRecoveryDispatchPreflightItem, analysis: QueueRecoveryAnalyzeResponse): string[] {
  const fromActions = stackActions(analysis)
    .filter((action) => action.targetPrdId === item.targetPrdId)
    .map((action) => action.selectedParentId);
  return [...new Set([...item.meaningfulDependencyIds, ...fromActions])];
}

export function deriveStackParentChoices(analysis: QueueRecoveryAnalyzeResponse): StackParentChoice[] {
  return (analysis.dispatchPreflight?.items ?? [])
    .filter((item) => item.requiresStackParentChoice || candidatesForItem(item, analysis).length > 1)
    .map((item) => ({
      targetPrdId: item.targetPrdId,
      currentStackParent: item.currentStackParent,
      candidates: candidatesForItem(item, analysis),
      required: item.requiresStackParentChoice,
      blockers: item.blockers,
    }));
}

function selectedRemoveActions(analysis: QueueRecoveryAnalyzeResponse, selectedRemovals: RemovalSelection): QueueRecoveryRepairAction[] {
  return removeActions(analysis)
    .map((action) => ({
      kind: 'remove-depends-on' as const,
      targetPrdId: action.targetPrdId,
      dependencyIds: action.dependencyIds.filter((dependencyId) => selectedRemovals[removalKey(action.targetPrdId, dependencyId)] === true),
    }))
    .filter((action) => action.dependencyIds.length > 0);
}

function selectedStackActions(analysis: QueueRecoveryAnalyzeResponse, selectedStackParents: StackParentSelection): QueueRecoveryRepairAction[] {
  const targets = new Set((analysis.dispatchPreflight?.items ?? []).map((item) => item.targetPrdId));
  for (const action of stackActions(analysis)) targets.add(action.targetPrdId);
  return [...targets].flatMap((targetPrdId) => {
    const selectedParentId = selectedStackParents[targetPrdId];
    return selectedParentId ? [{ kind: 'set-stack-parent' as const, targetPrdId, selectedParentId }] : [];
  });
}

export function deriveSelectedRepairActions(
  analysis: QueueRecoveryAnalyzeResponse,
  selectedRemovals: RemovalSelection,
  selectedStackParents: StackParentSelection,
): QueueRecoveryRepairAction[] {
  return [
    ...selectedRemoveActions(analysis, selectedRemovals),
    ...selectedStackActions(analysis, selectedStackParents),
  ];
}

export function deriveCascadeRepairState(
  analysis: QueueRecoveryAnalyzeResponse,
  selectedRemovals: RemovalSelection = {},
  selectedStackParents: StackParentSelection = {},
  applyResult?: QueueRecoveryApplyResponse | null,
): CascadeRepairState {
  const selectedRepairActions = deriveSelectedRepairActions(analysis, selectedRemovals, selectedStackParents);
  const stackParentChoices = deriveStackParentChoices(analysis);
  const unresolvedPreflightBlockers = stackParentChoices
    .filter((choice) => choice.required && !selectedStackParents[choice.targetPrdId])
    .map((choice) => `${choice.targetPrdId} requires an explicit stack_parent selection before queue-cascade apply.`);
  const requiresDependencyRemovalConfirmation = selectedRepairActions.some((action) => action.kind === 'remove-depends-on');
  const applyDisabledReasons = [
    ...unresolvedPreflightBlockers,
    ...(analysis.blockers ?? []).filter((notice) => notice.code !== 'dispatch-preflight-blocked').map((notice) => notice.message),
    ...(applyResult?.blockers ?? []).map((notice) => notice.message),
  ];
  return {
    dependencyGroups: deriveDependencyGroups(analysis.dependencyClassifications),
    removableDependencies: deriveRemovableDependencies(analysis),
    stackParentChoices,
    selectedRepairActions,
    unresolvedPreflightBlockers,
    requiresDependencyRemovalConfirmation,
    applyDisabledReasons,
  };
}

export function formatRepairResult(result: QueueRecoveryRepairResult): string {
  const before = result.before ? ` before=${JSON.stringify(result.before)}` : '';
  const after = result.after ? ` after=${JSON.stringify(result.after)}` : '';
  return `${result.action.kind} ${result.action.targetPrdId}: ${result.status}${result.message ? ` — ${result.message}` : ''}${before}${after}`;
}
