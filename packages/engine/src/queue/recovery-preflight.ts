import type {
  QueueRecoveryDependencyClassification,
  QueueRecoveryDispatchPreflightSummary,
  QueueRecoveryNotice,
  QueueRecoveryRepairAction,
  QueueRecoveryRepairResult,
} from '@eforge-build/client';
import type { ArtifactRegistry } from '../artifacts/registry.js';
import { hasUsableArtifact } from '../artifacts/registry.js';
import type { CompletionRegistry } from '../artifacts/completions.js';
import { lookupCompletion } from '../artifacts/completions.js';
import type { QueuedPrd } from '../prd-queue.js';
import { validateStackedDispatch } from './dispatch-validation.js';

export interface RecoveryPreflightRecord {
  id: string;
  title: string;
  location: 'queue' | 'waiting' | 'failed' | 'skipped';
  dependsOn: string[];
  stackParent?: string;
  prd: QueuedPrd;
}

export interface RecoveryPreflightInput {
  records: RecoveryPreflightRecord[];
  targetIds: string[];
  artifactRegistry: ArtifactRegistry;
  completionRegistry: CompletionRegistry;
  stackingEnabled: boolean;
  repairActions?: unknown;
  confirmDependencyRemoval?: boolean;
}

export interface RecoveryPreflightResult {
  dependencyClassifications: QueueRecoveryDependencyClassification[];
  dispatchPreflight: QueueRecoveryDispatchPreflightSummary;
  availableRepairActions: QueueRecoveryRepairAction[];
  repairResults: QueueRecoveryRepairResult[];
  simulated: Map<string, { dependsOn: string[]; stackParent?: string }>;
}

export function buildRecoveryPreflight(input: RecoveryPreflightInput): RecoveryPreflightResult {
  const byId = new Map(input.records.map((record) => [record.id, record]));
  const targetSet = new Set(input.targetIds);
  const classifications = classifyDependencies(input.records, targetSet, byId, input.artifactRegistry, input.completionRegistry);
  const availableRepairActions = deriveAvailableRepairActions(classifications);
  const simulated = new Map<string, { dependsOn: string[]; stackParent?: string }>();
  for (const id of input.targetIds) {
    const record = byId.get(id);
    if (record) simulated.set(id, { dependsOn: [...record.dependsOn], ...(record.stackParent !== undefined && { stackParent: record.stackParent }) });
  }
  const repairValidation = validateRepairActions(input.repairActions);
  const repairResults = applyRepairsToSimulation({ actions: repairValidation.actions, classifications, simulated, confirmDependencyRemoval: input.confirmDependencyRemoval === true });
  const dispatchPreflight = buildDispatchPreflight({ targetIds: input.targetIds, byId, simulated, stackingEnabled: input.stackingEnabled, classifications });
  if (repairValidation.blockers.length > 0) {
    dispatchPreflight.blockers.push(...repairValidation.blockers);
    dispatchPreflight.canApply = false;
  }
  return { dependencyClassifications: classifications, dispatchPreflight, availableRepairActions, repairResults, simulated };
}

function classifyDependencies(
  records: RecoveryPreflightRecord[],
  targetSet: Set<string>,
  byId: Map<string, RecoveryPreflightRecord>,
  artifactRegistry: ArtifactRegistry,
  completionRegistry: CompletionRegistry,
): QueueRecoveryDependencyClassification[] {
  const result: QueueRecoveryDependencyClassification[] = [];
  for (const record of records) {
    if (!targetSet.has(record.id)) continue;
    for (const dep of record.dependsOn) {
      const depRecord = byId.get(dep);
      const completion = lookupCompletion(completionRegistry, dep);
      const artifactUsable = hasUsableArtifact(artifactRegistry, dep);
      if (depRecord && (depRecord.location === 'queue' || depRecord.location === 'waiting')) {
        result.push({ targetPrdId: record.id, dependentPrdId: record.id, dependencyPrdId: dep, status: 'blocking', reason: `Dependency ${dep} is active in ${depRecord.location}.`, queueStatus: depRecord.location, artifactStatus: artifactUsable ? 'usable' : 'missing' });
      } else if (artifactUsable) {
        result.push({ targetPrdId: record.id, dependentPrdId: record.id, dependencyPrdId: dep, status: 'satisfied', reason: `Dependency ${dep} has a usable artifact.`, ...(depRecord ? { queueStatus: depRecord.location } : {}), artifactStatus: 'usable', ...(completion?.completedAt ? { completedAt: completion.completedAt } : {}) });
      } else if (depRecord && (depRecord.location === 'failed' || depRecord.location === 'skipped')) {
        result.push({ targetPrdId: record.id, dependentPrdId: record.id, dependencyPrdId: dep, status: 'terminal', reason: `Dependency ${dep} is terminal in ${depRecord.location}.`, terminalKind: depRecord.location, queueStatus: depRecord.location, artifactStatus: 'missing' });
      } else if (completion?.status === 'failed' || completion?.status === 'skipped') {
        result.push({ targetPrdId: record.id, dependentPrdId: record.id, dependencyPrdId: dep, status: 'terminal', reason: `Dependency ${dep} completed with terminal status ${completion.status}.`, terminalKind: completion.status, artifactStatus: 'missing', completedAt: completion.completedAt });
      } else {
        result.push({ targetPrdId: record.id, dependentPrdId: record.id, dependencyPrdId: dep, status: 'stale-historical', reason: `Dependency ${dep} is not active and has no usable artifact.`, ...(completion?.status ? { terminalKind: completion.status } : {}), artifactStatus: 'missing', ...(completion?.completedAt ? { completedAt: completion.completedAt } : {}) });
      }
    }
  }
  return result;
}

function deriveAvailableRepairActions(classifications: QueueRecoveryDependencyClassification[]): QueueRecoveryRepairAction[] {
  const satisfiedByTarget = new Map<string, string[]>();
  for (const classification of classifications) {
    if (classification.status !== 'satisfied') continue;
    const deps = satisfiedByTarget.get(classification.targetPrdId) ?? [];
    deps.push(classification.dependencyPrdId);
    satisfiedByTarget.set(classification.targetPrdId, deps);
  }
  return [...satisfiedByTarget.entries()].map(([targetPrdId, dependencyIds]) => ({ kind: 'remove-depends-on', targetPrdId, dependencyIds }));
}

function applyRepairsToSimulation(params: { actions: QueueRecoveryRepairAction[]; classifications: QueueRecoveryDependencyClassification[]; simulated: Map<string, { dependsOn: string[]; stackParent?: string }>; confirmDependencyRemoval: boolean }): QueueRecoveryRepairResult[] {
  const results: QueueRecoveryRepairResult[] = [];
  for (const rawAction of params.actions) {
    const validation = validateRepairAction(rawAction);
    if (!validation.valid) {
      results.push({ action: rawAction, status: 'blocked', message: validation.message });
      continue;
    }
    const action = validation.action;
    const metadata = params.simulated.get(action.targetPrdId);
    if (!metadata) {
      results.push({ action, status: 'blocked', message: `Unknown repair target ${action.targetPrdId}` });
      continue;
    }
    const before = summarize(metadata);
    if (action.kind === 'remove-depends-on') {
      if (!params.confirmDependencyRemoval) {
        results.push({ action, status: 'blocked', message: 'Dependency removal requires confirmation.', before });
        continue;
      }
      const invalid = action.dependencyIds.find((dep) => !params.classifications.some((c) => c.targetPrdId === action.targetPrdId && c.dependencyPrdId === dep && c.status === 'satisfied'));
      if (invalid) {
        results.push({ action, status: 'blocked', message: `Dependency ${invalid} is not classified as satisfied for ${action.targetPrdId}.`, before });
        continue;
      }
      metadata.dependsOn = metadata.dependsOn.filter((dep) => !action.dependencyIds.includes(dep));
      if (metadata.stackParent && !metadata.dependsOn.includes(metadata.stackParent)) delete metadata.stackParent;
      results.push({ action, status: 'applied', before, after: summarize(metadata) });
    } else {
      if (!metadata.dependsOn.includes(action.selectedParentId)) {
        results.push({ action, status: 'blocked', message: `Selected stack parent ${action.selectedParentId} is not in depends_on for ${action.targetPrdId}.`, before });
        continue;
      }
      metadata.stackParent = action.selectedParentId;
      results.push({ action, status: 'applied', before, after: summarize(metadata) });
    }
  }
  return results;
}

function validateRepairActions(value: unknown): { actions: QueueRecoveryRepairAction[]; blockers: QueueRecoveryNotice[] } {
  if (value === undefined) return { actions: [], blockers: [] };
  if (!Array.isArray(value)) return { actions: [], blockers: [{ code: 'invalid-repair-action', message: 'repairActions must be an array.', severity: 'blocker' }] };
  const actions: QueueRecoveryRepairAction[] = [];
  const blockers: QueueRecoveryNotice[] = [];
  for (const [index, rawAction] of value.entries()) {
    const validation = validateRepairAction(rawAction);
    if (validation.valid) actions.push(validation.action);
    else blockers.push({ code: 'invalid-repair-action', message: `Invalid repairActions[${index}]: ${validation.message}`, severity: 'blocker' });
  }
  return { actions, blockers };
}

function validateRepairAction(action: unknown): { valid: true; action: QueueRecoveryRepairAction } | { valid: false; message: string } {
  const candidate = action;
  if (!candidate || typeof candidate !== 'object') return { valid: false, message: 'Repair action must be an object.' };
  const record = candidate as Record<string, unknown>;
  if (record.kind !== 'remove-depends-on' && record.kind !== 'set-stack-parent') {
    return { valid: false, message: `Unknown repair action kind: ${String(record.kind)}` };
  }
  if (!isSafePrdId(record.targetPrdId)) {
    return { valid: false, message: 'Repair action targetPrdId must be a safe PRD id.' };
  }
  if (record.kind === 'remove-depends-on') {
    if (!Array.isArray(record.dependencyIds) || record.dependencyIds.length === 0 || !record.dependencyIds.every(isSafePrdId)) {
      return { valid: false, message: 'remove-depends-on dependencyIds must be a non-empty array of safe PRD ids.' };
    }
    return { valid: true, action: { kind: 'remove-depends-on', targetPrdId: record.targetPrdId, dependencyIds: [...record.dependencyIds] } };
  }
  if (!isSafePrdId(record.selectedParentId)) {
    return { valid: false, message: 'set-stack-parent selectedParentId must be a safe PRD id.' };
  }
  return { valid: true, action: { kind: 'set-stack-parent', targetPrdId: record.targetPrdId, selectedParentId: record.selectedParentId } };
}

function isSafePrdId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes('/') && !value.includes('\\') && !value.includes('..') && !value.includes('\0');
}

function buildDispatchPreflight(params: { targetIds: string[]; byId: Map<string, RecoveryPreflightRecord>; simulated: Map<string, { dependsOn: string[]; stackParent?: string }>; stackingEnabled: boolean; classifications: QueueRecoveryDependencyClassification[] }): QueueRecoveryDispatchPreflightSummary {
  const blockers: QueueRecoveryNotice[] = [];
  const warnings: QueueRecoveryNotice[] = params.classifications
    .filter((classification) => classification.status === 'stale-historical')
    .map((classification) => ({ code: 'stale-historical-dependency', message: classification.reason, prdId: classification.targetPrdId, severity: 'warning' }));
  const items = params.targetIds.flatMap((id) => {
    const record = params.byId.get(id);
    const metadata = params.simulated.get(id);
    if (!record || !metadata) return [];
    const validation = validateStackedDispatch({ prdId: id, title: record.title, dependsOn: metadata.dependsOn, stackParent: metadata.stackParent, stackingEnabled: params.stackingEnabled });
    for (const message of validation.blockers) blockers.push({ code: 'dispatch-preflight-blocked', message, prdId: id, severity: 'blocker' });
    for (const message of validation.warnings) warnings.push({ code: 'dispatch-preflight-warning', message, prdId: id, severity: 'warning' });
    return [{ targetPrdId: id, canDispatch: validation.canDispatch, blockers: validation.blockers, warnings: validation.warnings, stackingEnabled: params.stackingEnabled, ...(metadata.stackParent !== undefined && { currentStackParent: metadata.stackParent }), meaningfulDependencyIds: validation.meaningfulDependencyIds, requiresStackParentChoice: validation.requiresStackParentChoice }];
  });
  return { canApply: blockers.length === 0, blockers, warnings, items };
}

function summarize(metadata: { dependsOn: string[]; stackParent?: string }): { dependsOn?: string[]; stackParent?: string } {
  return { dependsOn: [...metadata.dependsOn], ...(metadata.stackParent !== undefined && { stackParent: metadata.stackParent }) };
}
