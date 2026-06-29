import type { PlanningDecompositionLimits, PlanningUnitBudget } from '@eforge-build/client';
import { deriveBudget } from './graph-builders.js';
import { evidenceSlug } from './evidence-hygiene.js';
import { deriveSourceInventory, type SourceInventory, type SourceInventoryCriterion, type SourceInventoryInput } from './source-inventory.js';
import { hashText, stableSlug } from './source-analysis.js';

export type PlanningAtomReason = 'foundation-contract' | 'subsystem' | 'oversized-criterion' | 'general';
export interface PlanningAtomBudgetEstimate { sourceBytes: number; criteriaCount: number; subsystemCount: number; evidencePathCount: number; estimatedPromptBytes: number }
export interface PlanningAtomSourceSlice { sourceHash: string; sourcePath?: string; headingPath: string[]; startLine: number; endLine: number; byteStart: number; byteEnd: number; criteriaIds: string[]; byteLength: number }
export interface PlanningAtom { atomId: string; title: string; reason: PlanningAtomReason; criterionIds: string[]; facetIds: string[]; subsystemHints: string[]; evidencePaths: string[]; interfaceKeys: string[]; dependencyHints: string[]; sourceSlices: PlanningAtomSourceSlice[]; budget: PlanningUnitBudget; estimate: PlanningAtomBudgetEstimate }
export interface PlanningAtomEdge { fromAtomId: string; toAtomId: string; reason: string }
export interface PlanningAtomGraph { graphId: string; sourceHash: string; inventory: SourceInventory['summary']; atoms: PlanningAtom[]; edges: PlanningAtomEdge[]; limits: PlanningDecompositionLimits }
export interface DerivePlanningAtomGraphInput extends SourceInventoryInput { limits: PlanningDecompositionLimits; inventory?: SourceInventory }
type AtomSourceInventoryCriterion = SourceInventoryCriterion & { atomReason?: PlanningAtomReason };

export function derivePlanningAtomGraph(input: DerivePlanningAtomGraphInput): PlanningAtomGraph {
  const inventory = input.inventory ?? deriveSourceInventory(input);
  const atoms = buildAtoms(inventory, input.limits).sort((a, b) => a.atomId.localeCompare(b.atomId));
  const edges = buildAtomEdges(atoms);
  return {
    graphId: `atom-graph-${hashText(`${inventory.sourceHash}:${atoms.map((atom) => `${atom.atomId}:${atom.criterionIds.join(',')}`).join('|')}`).slice(0, 16)}`,
    sourceHash: inventory.sourceHash,
    inventory: inventory.summary,
    atoms,
    edges,
    limits: input.limits,
  };
}

function buildAtoms(inventory: SourceInventory, limits: PlanningDecompositionLimits): PlanningAtom[] {
  if (inventory.criteria.length === 0) return [emptyAtom(inventory, limits)];
  const foundation = foundationCriteria(inventory.criteria);
  const atoms: PlanningAtom[] = [];
  for (const [index, group] of chunkCriteria(foundation, limits).entries()) atoms.push(atomForCriteria(`atom-foundation-contracts${index === 0 ? '' : `-${String(index + 1).padStart(3, '0')}`}`, 'Foundation contracts', 'foundation-contract', group, inventory, limits));
  const foundationIds = new Set(foundation.map((criterion) => criterion.id));
  for (const group of chunkCriteria(inventory.criteria.filter((criterion) => !foundationIds.has(criterion.id)), limits)) {
    const subsystem = group[0]?.subsystemHints[0] ?? 'general';
    atoms.push(atomForCriteria(`atom-${stableSlug(subsystem)}-${String(atoms.length + 1).padStart(3, '0')}`, `${subsystem} planning`, subsystem === 'general' ? 'general' : 'subsystem', group, inventory, limits));
  }
  return atoms;
}

function foundationCriteria(criteria: SourceInventoryCriterion[]): SourceInventoryCriterion[] {
  const contractCriteria = criteria.filter((criterion) => criterion.interfaceKeys.length > 0 || criterion.evidencePaths.length > 0);
  const uniqueEvidence = new Set(contractCriteria.flatMap((criterion) => [...criterion.interfaceKeys, ...criterion.evidencePaths]));
  const subsystems = new Set(contractCriteria.flatMap((criterion) => criterion.subsystemHints));
  return contractCriteria.length >= 2 && (uniqueEvidence.size > 1 || subsystems.size > 1) ? contractCriteria : [];
}

function chunkCriteria(criteria: SourceInventoryCriterion[], limits: PlanningDecompositionLimits): AtomSourceInventoryCriterion[][] {
  const byKey = new Map<string, AtomSourceInventoryCriterion[]>();
  for (const criterion of splitOversizedCriteria(criteria, limits)) {
    const key = criterion.subsystemHints[0] ?? criterion.evidencePaths[0] ?? 'general';
    byKey.set(key, [...(byKey.get(key) ?? []), criterion]);
  }
  const groups: AtomSourceInventoryCriterion[][] = [];
  for (const [, group] of [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    let current: SourceInventoryCriterion[] = [];
    let bytes = 0;
    for (const criterion of group) {
      const subsystemCount = new Set([...current.flatMap((item) => item.subsystemHints), ...criterion.subsystemHints]).size;
      if (current.length > 0 && (current.length >= limits.maxCriteriaPerUnit || subsystemCount > limits.maxSubsystemsPerUnit || bytes + criterion.byteLength > limits.maxPromptSourceBytes)) {
        groups.push(current); current = []; bytes = 0;
      }
      current.push(criterion); bytes += criterion.byteLength;
    }
    if (current.length > 0) groups.push(current);
  }
  return groups;
}

function splitOversizedCriteria(criteria: SourceInventoryCriterion[], limits: PlanningDecompositionLimits): AtomSourceInventoryCriterion[] {
  return criteria.flatMap((criterion) => {
    if (criterion.byteLength <= limits.maxPromptSourceBytes) return [criterion];
    const partCount = Math.ceil(criterion.byteLength / limits.maxPromptSourceBytes);
    return Array.from({ length: partCount }, (_, index) => {
      const byteStart = criterion.byteStart + index * limits.maxPromptSourceBytes;
      const byteEnd = Math.min(criterion.byteEnd, byteStart + limits.maxPromptSourceBytes);
      return { ...criterion, atomReason: 'oversized-criterion', byteStart, byteEnd, byteLength: Math.max(1, byteEnd - byteStart) };
    });
  });
}

function atomForCriteria(atomId: string, title: string, reason: PlanningAtomReason, criteria: AtomSourceInventoryCriterion[], inventory: SourceInventory, limits: PlanningDecompositionLimits): PlanningAtom {
  const effectiveReason = criteria.some((criterion) => criterion.atomReason === 'oversized-criterion') ? 'oversized-criterion' : reason;
  const sourceBytes = criteria.reduce((sum, criterion) => sum + criterion.byteLength, 0);
  const subsystemHints = [...new Set(criteria.flatMap((criterion) => criterion.subsystemHints))].sort().slice(0, limits.maxSubsystemsPerUnit);
  const evidencePaths = [...new Set(criteria.flatMap((criterion) => criterion.evidencePaths))].sort();
  return {
    atomId,
    title,
    reason: effectiveReason,
    criterionIds: criteria.map((criterion) => criterion.id).sort(),
    facetIds: criteria.flatMap((criterion) => facetsForCriterion(criterion)),
    subsystemHints,
    evidencePaths,
    interfaceKeys: [...new Set(criteria.flatMap((criterion) => criterion.interfaceKeys))].sort(),
    dependencyHints: [...new Set(criteria.flatMap((criterion) => criterion.dependencyHints))].sort(),
    sourceSlices: criteria.map((criterion) => ({ sourceHash: inventory.sourceHash, ...(inventory.sourcePath ? { sourcePath: inventory.sourcePath } : {}), headingPath: criterion.headingPath, startLine: criterion.line, endLine: criterion.line, byteStart: criterion.byteStart, byteEnd: criterion.byteEnd, criteriaIds: [criterion.id], byteLength: criterion.byteLength })),
    budget: deriveBudget(limits, 0),
    estimate: { sourceBytes, criteriaCount: criteria.length, subsystemCount: subsystemHints.length, evidencePathCount: evidencePaths.length, estimatedPromptBytes: Math.ceil(sourceBytes * 1.8) + 4_000 },
  };
}

function facetsForCriterion(criterion: SourceInventoryCriterion): string[] {
  const hints = [...criterion.subsystemHints, ...criterion.evidencePaths.map(evidenceSlug), ...criterion.interfaceKeys].filter(Boolean);
  return (hints.length > 0 ? hints : ['general']).map((hint) => `${criterion.id}:${hint}`).sort();
}

function emptyAtom(inventory: SourceInventory, limits: PlanningDecompositionLimits): PlanningAtom {
  return { atomId: 'atom-root', title: 'Root planning', reason: 'general', criterionIds: [], facetIds: [], subsystemHints: ['general'], evidencePaths: [], interfaceKeys: [], dependencyHints: [], sourceSlices: [], budget: deriveBudget(limits, 0), estimate: { sourceBytes: inventory.byteLength, criteriaCount: 0, subsystemCount: 1, evidencePathCount: 0, estimatedPromptBytes: Math.ceil(inventory.byteLength * 1.8) + 4_000 } };
}

function buildAtomEdges(atoms: PlanningAtom[]): PlanningAtomEdge[] {
  const byCriterion = new Map(atoms.flatMap((atom) => atom.criterionIds.map((criterionId) => [criterionId, atom.atomId] as const)));
  const edges: PlanningAtomEdge[] = [];
  for (const atom of atoms) {
    for (const hint of atom.dependencyHints) {
      const target = byCriterion.get(hint);
      if (target && target !== atom.atomId) edges.push({ fromAtomId: target, toAtomId: atom.atomId, reason: 'criterion-dependency' });
    }
  }
  return dedupeEdges(edges).sort((a, b) => `${a.fromAtomId}:${a.toAtomId}`.localeCompare(`${b.fromAtomId}:${b.toAtomId}`));
}

function dedupeEdges(edges: PlanningAtomEdge[]): PlanningAtomEdge[] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    const key = `${edge.fromAtomId}->${edge.toAtomId}:${edge.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
