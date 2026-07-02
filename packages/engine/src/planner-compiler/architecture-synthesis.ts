import {
  ARCHITECTURE_MANIFEST_VERSION,
  renderArchitectureManifestFence,
  type PlanningArchitectureManifest,
  type PlanningArchitectureManifestConflict,
  type PlanningArchitectureManifestContract,
  type PlanningArchitectureManifestFileOwnership,
  type PlanningArchitectureManifestPlan,
} from './architecture-manifest-contracts.js';
import type { BoundedPlannerCompilerResult } from './compiler-runner.js';
import type { PlanningSynthesizedModulePlan } from './plan-artifact-synthesis.js';
import { derivePlanIds } from './plan-ids.js';

export interface SynthesizeArchitectureInput { compilerResult: BoundedPlannerCompilerResult; modulePlans: PlanningSynthesizedModulePlan[] }
export interface SynthesizeArchitectureResult { markdown: string; manifest: PlanningArchitectureManifest }

interface ArchitecturePlan extends PlanningArchitectureManifestPlan { validationExpectation: string }

export function synthesizeArchitecture(input: SynthesizeArchitectureInput): SynthesizeArchitectureResult {
  const result = input.compilerResult;
  const planIds = derivePlanIds(input.modulePlans);
  const plans = architecturePlans(input.modulePlans, planIds);
  const plansByAtom = plansByAtomId(result, input.modulePlans, planIds);
  const fileOwnership = fileOwnershipEntries(result, input.modulePlans, planIds, plansByAtom);
  const contracts = contractEntries(result, plans, plansByAtom, fileOwnership);
  const conflicts = conflictEntries(result, input.modulePlans, planIds);
  const manifest: PlanningArchitectureManifest = {
    version: ARCHITECTURE_MANIFEST_VERSION,
    plans: plans.map(({ validationExpectation: _validationExpectation, ...plan }) => plan).slice(0, 128),
    fileOwnership: fileOwnership.slice(0, 256),
    contracts: contracts.slice(0, 256),
    conflicts: conflicts.slice(0, 128),
  };
  return { markdown: architectureMarkdown(result, plans, fileOwnership, contracts, conflicts, manifest), manifest };
}

// Missing dependency ids map through unchanged: synthesis must never throw here,
// because it runs before validation errors are surfaced to the caller.
function planIdFor(planIds: Map<string, string>, moduleId: string): string {
  return planIds.get(moduleId) ?? moduleId;
}

function architecturePlans(modulePlans: PlanningSynthesizedModulePlan[], planIds: Map<string, string>): ArchitecturePlan[] {
  return modulePlans.map((module) => ({
    planId: planIdFor(planIds, module.moduleId),
    title: bounded(module.title, 240),
    residue: module.residue,
    criterionIds: [...module.criterionIds].sort(),
    aspectIds: [...module.aspectIds].sort(),
    dependsOnPlanIds: module.dependsOnModuleIds.map((moduleId) => planIdFor(planIds, moduleId)).sort(),
    validationExpectation: module.validationExpectation,
  }));
}

// Only implementation plans own evidence through atoms; residue plans intersect the
// same criteria but claim paths solely through their explicit localizedOwnerPaths.
function plansByAtomId(result: BoundedPlannerCompilerResult, modulePlans: PlanningSynthesizedModulePlan[], planIds: Map<string, string>): Map<string, string[]> {
  const byAtom = new Map<string, string[]>();
  for (const atom of result.atomGraph.atoms) {
    const matched = modulePlans
      .filter((module) => !module.residue && (intersects(module.aspectIds, atom.facetIds) || intersects(module.criterionIds, atom.criterionIds)))
      .map((module) => planIdFor(planIds, module.moduleId));
    byAtom.set(atom.atomId, uniq(matched));
  }
  return byAtom;
}

function fileOwnershipEntries(result: BoundedPlannerCompilerResult, modulePlans: PlanningSynthesizedModulePlan[], planIds: Map<string, string>, plansByAtom: Map<string, string[]>): PlanningArchitectureManifestFileOwnership[] {
  const entries = new Map<string, PlanningArchitectureManifestFileOwnership>();
  for (const ownership of result.sharedBrief.evidenceOwnership) {
    const ownerAtomId = ownership.primaryAtomId ?? ownership.referencedByAtomIds[0];
    const ownerPlanIds = ownerAtomId ? plansByAtom.get(ownerAtomId) ?? [] : [];
    const consumerPlanIds = uniq(ownership.consumerAtomIds.flatMap((atomId) => plansByAtom.get(atomId) ?? [])).filter((planId) => !ownerPlanIds.includes(planId));
    entries.set(ownership.path, {
      path: bounded(ownership.path, 500),
      ownerPlanIds: ownerPlanIds.slice(0, 16),
      consumerPlanIds: consumerPlanIds.slice(0, 32),
      shared: ownership.shared,
      ...(ownership.reason ? { reason: bounded(ownership.reason, 500) } : {}),
    });
  }
  const residuePlanIds = new Map(result.residue.candidates.map((candidate) => [candidate.candidateId, candidate.localizedOwnerPaths ?? []]));
  for (const module of modulePlans.filter((module) => module.residue)) {
    const planId = planIdFor(planIds, module.moduleId);
    for (const path of residuePlanIds.get(module.moduleId) ?? []) {
      const existing = entries.get(path);
      if (!existing) {
        entries.set(path, { path: bounded(path, 500), ownerPlanIds: [planId], consumerPlanIds: [], shared: false, reason: 'residue localized owner' });
      } else if (existing.ownerPlanIds.length > 0 && !existing.ownerPlanIds.includes(planId)) {
        entries.set(path, { ...existing, consumerPlanIds: uniq([...existing.consumerPlanIds, planId]).slice(0, 32) });
      } else if (existing.ownerPlanIds.length === 0) {
        entries.set(path, { ...existing, ownerPlanIds: [planId] });
      }
    }
  }
  return [...entries.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function contractEntries(result: BoundedPlannerCompilerResult, plans: ArchitecturePlan[], plansByAtom: Map<string, string[]>, fileOwnership: PlanningArchitectureManifestFileOwnership[]): PlanningArchitectureManifestContract[] {
  const titleByPlanId = new Map(plans.map((plan) => [plan.planId, plan.title]));
  const contracts = new Map<string, PlanningArchitectureManifestContract>();
  const add = (contract: Omit<PlanningArchitectureManifestContract, 'contractId'>): void => {
    if (contract.fromPlanId === contract.toPlanId) return;
    const contractId = bounded(`${contract.kind}:${contract.fromPlanId}->${contract.toPlanId}:${contract.interfaceKey ?? contract.path ?? ''}`, 700);
    if (!contracts.has(contractId)) contracts.set(contractId, { contractId, ...contract });
  };
  for (const plan of plans) {
    for (const dependencyPlanId of plan.dependsOnPlanIds) {
      add({ kind: 'plan-dependency', fromPlanId: plan.planId, toPlanId: dependencyPlanId, summary: bounded(`${plan.planId} builds on ${titleByPlanId.get(dependencyPlanId) ?? dependencyPlanId}`, 700) });
    }
  }
  for (const summary of result.sharedBrief.interfaceSummaries) {
    const ownerPlanIds = plansByAtom.get(summary.primaryAtomId) ?? [];
    const consumerPlanIds = uniq(summary.consumerAtomIds.flatMap((atomId) => plansByAtom.get(atomId) ?? []));
    for (const fromPlanId of consumerPlanIds) {
      for (const toPlanId of ownerPlanIds) {
        add({ kind: 'interface', fromPlanId, toPlanId, interfaceKey: bounded(summary.key, 160), ...(summary.summary ? { summary: bounded(summary.summary, 700) } : {}) });
      }
    }
  }
  for (const ownership of fileOwnership) {
    for (const fromPlanId of ownership.consumerPlanIds) {
      for (const toPlanId of ownership.ownerPlanIds) {
        add({ kind: 'shared-file', fromPlanId, toPlanId, path: ownership.path, ...(ownership.reason ? { summary: bounded(ownership.reason, 700) } : {}) });
      }
    }
  }
  return [...contracts.values()].sort((a, b) => a.contractId.localeCompare(b.contractId));
}

function conflictEntries(result: BoundedPlannerCompilerResult, modulePlans: PlanningSynthesizedModulePlan[], planIds: Map<string, string>): PlanningArchitectureManifestConflict[] {
  const outputs = result.reduce.finalOutput ? [result.reduce.finalOutput] : result.reduce.outputs;
  const conflicts = new Map<string, PlanningArchitectureManifestConflict>();
  for (const output of outputs) {
    for (const conflict of output.conflicts ?? []) {
      if (conflicts.has(conflict.conflictId)) continue;
      const planIdsForConflict = modulePlans
        .filter((module) => intersects(module.criterionIds, conflict.criterionIds) || intersects(module.aspectIds, conflict.aspectIds))
        .map((module) => planIdFor(planIds, module.moduleId));
      conflicts.set(conflict.conflictId, {
        conflictId: bounded(conflict.conflictId, 160),
        title: bounded(conflict.title, 240),
        criterionIds: uniq(conflict.criterionIds),
        planIds: uniq(planIdsForConflict).slice(0, 32),
      });
    }
  }
  return [...conflicts.values()].sort((a, b) => a.conflictId.localeCompare(b.conflictId));
}

function architectureMarkdown(result: BoundedPlannerCompilerResult, plans: ArchitecturePlan[], fileOwnership: PlanningArchitectureManifestFileOwnership[], contracts: PlanningArchitectureManifestContract[], conflicts: PlanningArchitectureManifestConflict[], manifest: PlanningArchitectureManifest): string {
  const finalSummary = result.reduce.finalOutput?.compactSummary;
  const summaries = result.reduce.outputs.map((output) => output.compactSummary).filter((value) => value.trim().length > 0);
  const ownedPathsByPlan = new Map<string, string[]>();
  for (const ownership of fileOwnership) {
    for (const planId of ownership.ownerPlanIds) ownedPathsByPlan.set(planId, [...(ownedPathsByPlan.get(planId) ?? []), ownership.path]);
  }
  return [
    '# Planner Compiler Architecture',
    '',
    '## Summary',
    '',
    finalSummary || summaries.join('\n\n') || 'No reduce synthesis was produced.',
    '',
    '## Compiler status',
    '',
    `Compiler status: ${result.status}`,
    `Source hash: ${result.sourceInventory.sourceHash}`,
    '',
    '## Plan boundaries',
    '',
    ...plans.flatMap((plan) => planBoundarySection(plan, ownedPathsByPlan.get(plan.planId) ?? [])),
    '## Integration contracts',
    '',
    ...(contracts.length > 0 ? contracts.map(contractLine) : ['- (none)']),
    '',
    '## Shared file ownership',
    '',
    ...(fileOwnership.length > 0 ? fileOwnership.map(ownershipLine) : ['- (none)']),
    '',
    '## Reduce conflicts',
    '',
    ...(conflicts.length > 0 ? conflicts.map((conflict) => `- ${conflict.conflictId}: ${conflict.title} (criteria: ${conflict.criterionIds.join(', ') || 'none'}; plans: ${conflict.planIds.join(', ') || 'none'})`) : ['- (none)']),
    '',
    '## Machine-readable manifest',
    '',
    renderArchitectureManifestFence(manifest),
  ].join('\n');
}

function planBoundarySection(plan: ArchitecturePlan, ownedPaths: string[]): string[] {
  return [
    `### ${plan.planId} — ${plan.title}`,
    '',
    `Criteria: ${plan.criterionIds.join(', ') || '(none)'}`,
    `Aspects: ${plan.aspectIds.join(', ') || '(none)'}`,
    `Depends on: ${plan.dependsOnPlanIds.join(', ') || '(none)'}`,
    `Residue: ${plan.residue ? 'yes' : 'no'}`,
    `Owned files: ${ownedPaths.join(', ') || '(none)'}`,
    `Validation: ${plan.validationExpectation.split('\n')[0] || '(none)'}`,
    '',
  ];
}

function contractLine(contract: PlanningArchitectureManifestContract): string {
  const via = contract.kind === 'interface' ? `interface ${contract.interfaceKey}` : contract.kind === 'shared-file' ? `shared file ${contract.path}` : 'plan dependency';
  return `- ${contract.fromPlanId} -> ${contract.toPlanId} (${via})${contract.summary ? `: ${contract.summary}` : ''}`;
}

function ownershipLine(ownership: PlanningArchitectureManifestFileOwnership): string {
  const consumers = ownership.consumerPlanIds.length > 0 ? `; consumers ${ownership.consumerPlanIds.join(', ')}` : '';
  return `- ${ownership.path}: owner ${ownership.ownerPlanIds.join(', ') || '(none)'}${consumers}${ownership.reason ? ` (${ownership.reason})` : ''}`;
}

function intersects(a: string[], b: string[]): boolean { return a.some((value) => b.includes(value)); }
function uniq(values: string[]): string[] { return [...new Set(values.filter((value) => value.trim().length > 0))].sort(); }
function bounded(value: string, maxLength: number): string { return value.length > maxLength ? value.slice(0, maxLength) : value; }
