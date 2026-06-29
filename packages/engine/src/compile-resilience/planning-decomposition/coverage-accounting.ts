import type { PlanningAtomGraph } from './atom-graph.js';
import { evidenceSlug } from './evidence-hygiene.js';
import { stableSlug } from './source-analysis.js';
import type { SourceInventory, SourceInventoryCriterion } from './source-inventory.js';

export type PlanningAspectSourceKind = 'evidence' | 'interface' | 'subsystem' | 'general';
export type PlanningAspectCoverageStatus = 'pending' | 'resolved' | 'skipped' | 'represented';
export type PlanningAspectRepresentationKind = 'residue' | 'follow-up';

export interface PlanningAspectSource { kind: PlanningAspectSourceKind; value: string }
export interface PlanningAspectRepresentation { kind: PlanningAspectRepresentationKind; moduleId: string; reason: string; validationExpectation: string }
export interface PlanningCriterionAspect { aspectId: string; criterionId: string; label: string; source: PlanningAspectSource; required: boolean; atomIds: string[] }
export interface PlanningAspectCoverageUpdate { aspectId: string; status: PlanningAspectCoverageStatus; completedByAtomIds?: string[]; reason?: string; representation?: PlanningAspectRepresentation }
export interface PlanningAspectCoverageRecord extends PlanningCriterionAspect { status: PlanningAspectCoverageStatus; completedByAtomIds: string[]; reason?: string; representation?: PlanningAspectRepresentation; satisfied: boolean }
export interface PlanningRawCriterionCoverage { criterionId: string; coveredByAtomIds: string[] }
export interface PlanningCriterionAspectCoverage { criterionId: string; rawCoveredByAtomIds: string[]; requiredAspectIds: string[]; resolvedAspectIds: string[]; skippedAspectIds: string[]; representedAspectIds: string[]; pendingAspectIds: string[]; complete: boolean }
export interface PlanningAspectCoverageSummary { totalCriteria: number; completeCriteria: string[]; incompleteCriteria: string[]; rawCriterionCoverage: PlanningRawCriterionCoverage[]; aspects: PlanningAspectCoverageRecord[]; criteria: PlanningCriterionAspectCoverage[]; coverageByAtom: Record<string, string[]>; validationErrors: string[] }
export interface DerivePlanningAspectCoverageInput { graph: PlanningAtomGraph; inventory?: SourceInventory; aspects?: PlanningCriterionAspect[]; updates?: PlanningAspectCoverageUpdate[] }

export function derivePlanningAspectCoverage(input: DerivePlanningAspectCoverageInput): PlanningAspectCoverageSummary {
  const aspects = sortAspects(input.aspects ?? derivePlanningCriterionAspects(input.graph, input.inventory));
  const updates = new Map((input.updates ?? []).map((update) => [update.aspectId, update]));
  const validationErrors = validateUpdates(aspects, updates);
  const records = aspects.map((aspect) => applyCoverageUpdate(aspect, updates.get(aspect.aspectId), validationErrors));
  const rawCriterionCoverage = deriveRawCriterionCoverage(input.graph);
  const criteria = summarizeCriteria(records, rawCriterionCoverage);
  return {
    totalCriteria: criteria.length,
    completeCriteria: criteria.filter((criterion) => criterion.complete).map((criterion) => criterion.criterionId),
    incompleteCriteria: criteria.filter((criterion) => !criterion.complete).map((criterion) => criterion.criterionId),
    rawCriterionCoverage,
    aspects: records,
    criteria,
    coverageByAtom: deriveCoverageByAtom(records),
    validationErrors: validationErrors.sort(),
  };
}

export function derivePlanningCriterionAspects(graph: PlanningAtomGraph, inventory?: SourceInventory): PlanningCriterionAspect[] {
  const fromInventory = inventory ? aspectsFromInventory(graph, inventory) : [];
  return fromInventory.length > 0 ? fromInventory : aspectsFromGraphFacets(graph);
}

function aspectsFromInventory(graph: PlanningAtomGraph, inventory: SourceInventory): PlanningCriterionAspect[] {
  const atomIdsByCriterion = atomIdsByCriterionId(graph);
  return inventory.criteria.flatMap((criterion) => sourcesForCriterion(criterion).map((source) => ({
    aspectId: aspectIdForSource(criterion.id, source),
    criterionId: criterion.id,
    label: `${source.kind}: ${source.value}`,
    source,
    required: true,
    atomIds: atomIdsByCriterion.get(criterion.id) ?? [],
  })));
}

function sourcesForCriterion(criterion: SourceInventoryCriterion): PlanningAspectSource[] {
  const evidenceSources = criterion.evidencePaths.map((value) => ({ kind: 'evidence' as const, value }));
  const interfaceSources = criterion.interfaceKeys.map((value) => ({ kind: 'interface' as const, value }));
  const subsystemSources = criterion.evidencePaths.length === 0 ? criterion.subsystemHints.filter((value) => value !== 'general').map((value) => ({ kind: 'subsystem' as const, value })) : [];
  const sources = [...evidenceSources, ...interfaceSources, ...subsystemSources];
  return dedupeSources(sources.length > 0 ? sources : [{ kind: 'general', value: 'general' }]);
}

function aspectsFromGraphFacets(graph: PlanningAtomGraph): PlanningCriterionAspect[] {
  const atomIdsByFacet = new Map<string, string[]>();
  for (const atom of graph.atoms) for (const facetId of atom.facetIds) atomIdsByFacet.set(facetId, [...(atomIdsByFacet.get(facetId) ?? []), atom.atomId].sort());
  return dedupeAspects([...atomIdsByFacet.entries()].map(([facetId, atomIds]) => {
    const [criterionId, ...labelParts] = facetId.split(':');
    const value = labelParts.join(':') || 'general';
    const source = { kind: 'general' as const, value };
    return { aspectId: aspectIdForSource(criterionId, source), criterionId, label: `general: ${value}`, source, required: true, atomIds };
  }));
}

function applyCoverageUpdate(aspect: PlanningCriterionAspect, update: PlanningAspectCoverageUpdate | undefined, validationErrors: string[]): PlanningAspectCoverageRecord {
  const status = update?.status ?? 'pending';
  const completedByAtomIds = [...new Set(update?.completedByAtomIds ?? (status === 'resolved' ? aspect.atomIds : []))].sort();
  const record = { ...aspect, status, completedByAtomIds, reason: update?.reason, representation: update?.representation, satisfied: false };
  record.satisfied = isSatisfied(record, validationErrors);
  return record;
}

function isSatisfied(record: PlanningAspectCoverageRecord, validationErrors: string[]): boolean {
  if (record.status === 'resolved') {
    if (record.completedByAtomIds.length > 0) return true;
    validationErrors.push(`resolved aspect requires completed atom ids:${record.aspectId}`);
  }
  if (record.status === 'skipped') {
    if (record.reason?.trim()) return true;
    validationErrors.push(`skipped aspect requires reason:${record.aspectId}`);
  }
  if (record.status === 'represented') {
    if (validRepresentation(record.representation)) return true;
    validationErrors.push(`represented aspect requires kind, module, reason, and validation expectation:${record.aspectId}`);
  }
  return false;
}

function validRepresentation(representation: PlanningAspectRepresentation | undefined): boolean {
  return Boolean(
    representation
    && (representation.kind === 'residue' || representation.kind === 'follow-up')
    && nonEmptyString(representation.moduleId)
    && nonEmptyString(representation.reason)
    && nonEmptyString(representation.validationExpectation),
  );
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function summarizeCriteria(records: PlanningAspectCoverageRecord[], rawCoverage: PlanningRawCriterionCoverage[]): PlanningCriterionAspectCoverage[] {
  const byCriterion = new Map<string, PlanningAspectCoverageRecord[]>();
  for (const record of records) byCriterion.set(record.criterionId, [...(byCriterion.get(record.criterionId) ?? []), record]);
  const rawByCriterion = new Map(rawCoverage.map((coverage) => [coverage.criterionId, coverage.coveredByAtomIds]));
  return [...byCriterion.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([criterionId, criterionRecords]) => {
    const required = criterionRecords.filter((record) => record.required);
    return {
      criterionId,
      rawCoveredByAtomIds: rawByCriterion.get(criterionId) ?? [],
      requiredAspectIds: required.map((record) => record.aspectId).sort(),
      resolvedAspectIds: satisfiedIdsWithStatus(required, 'resolved'),
      skippedAspectIds: satisfiedIdsWithStatus(required, 'skipped'),
      representedAspectIds: satisfiedIdsWithStatus(required, 'represented'),
      pendingAspectIds: required.filter((record) => !record.satisfied).map((record) => record.aspectId).sort(),
      complete: required.length > 0 && required.every((record) => record.satisfied),
    };
  });
}

function satisfiedIdsWithStatus(records: PlanningAspectCoverageRecord[], status: PlanningAspectCoverageStatus): string[] {
  return records.filter((record) => record.status === status && record.satisfied).map((record) => record.aspectId).sort();
}

function deriveRawCriterionCoverage(graph: PlanningAtomGraph): PlanningRawCriterionCoverage[] {
  return [...atomIdsByCriterionId(graph).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([criterionId, coveredByAtomIds]) => ({ criterionId, coveredByAtomIds }));
}

function atomIdsByCriterionId(graph: PlanningAtomGraph): Map<string, string[]> {
  const byCriterion = new Map<string, string[]>();
  for (const atom of graph.atoms) for (const criterionId of atom.criterionIds) byCriterion.set(criterionId, [...(byCriterion.get(criterionId) ?? []), atom.atomId].sort());
  return byCriterion;
}

function deriveCoverageByAtom(records: PlanningAspectCoverageRecord[]): Record<string, string[]> {
  const byAtom: Record<string, string[]> = {};
  for (const record of records) for (const atomId of record.atomIds) byAtom[atomId] = [...(byAtom[atomId] ?? []), record.aspectId].sort();
  return byAtom;
}

function validateUpdates(aspects: PlanningCriterionAspect[], updates: Map<string, PlanningAspectCoverageUpdate>): string[] {
  const aspectIds = new Set(aspects.map((aspect) => aspect.aspectId));
  return [...updates.keys()].filter((aspectId) => !aspectIds.has(aspectId)).map((aspectId) => `unknown aspect update:${aspectId}`);
}

function aspectIdForSource(criterionId: string, source: PlanningAspectSource): string {
  const slug = source.kind === 'evidence' ? evidenceSlug(source.value) : stableSlug(source.value);
  return `${criterionId}:${source.kind}:${slug}`;
}

function dedupeSources(sources: PlanningAspectSource[]): PlanningAspectSource[] {
  const byKey = new Map<string, PlanningAspectSource>();
  for (const source of sources) byKey.set(`${source.kind}:${source.value}`, source);
  return [...byKey.values()].sort((a, b) => `${a.kind}:${a.value}`.localeCompare(`${b.kind}:${b.value}`));
}

function dedupeAspects(aspects: PlanningCriterionAspect[]): PlanningCriterionAspect[] {
  const byId = new Map<string, PlanningCriterionAspect>();
  for (const aspect of aspects) {
    const existing = byId.get(aspect.aspectId);
    byId.set(aspect.aspectId, existing ? { ...existing, atomIds: [...new Set([...existing.atomIds, ...aspect.atomIds])].sort() } : aspect);
  }
  return [...byId.values()];
}

function sortAspects(aspects: PlanningCriterionAspect[]): PlanningCriterionAspect[] {
  return dedupeAspects(aspects).sort((a, b) => a.aspectId.localeCompare(b.aspectId)).map((aspect) => ({ ...aspect, atomIds: [...new Set(aspect.atomIds)].sort() }));
}
