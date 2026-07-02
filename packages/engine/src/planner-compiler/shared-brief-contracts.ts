import type { PlanningAtomGraph } from './atom-graph.js';
import { classifyEvidenceCandidate } from './evidence-hygiene.js';
import { utf8ByteLength } from './source-analysis.js';
import type { SourceLocalizationConfidence, SourceLocalizationStatus } from './source-localization-contracts.js';

export type SharedPlanningBriefSectionKind = 'evidence' | 'interface' | 'dependency' | 'avoidance';

export interface SharedPlanningBriefLimits { maxTotalBriefBytes: number; maxSectionBytes: number; maxSectionsPerAtom: number; maxSharedFindingsPerAtom: number; maxSharedFindingBytes: number }
export interface PlanningEvidenceLocalizationMetadata { localizationNeedIds?: string[]; localizationStatus?: SourceLocalizationStatus; localizationConfidence?: SourceLocalizationConfidence; candidateRank?: number; ownershipRationale?: string; criterionLinked?: boolean }
export interface PlanningEvidenceOwnership extends PlanningEvidenceLocalizationMetadata { path: string; referencedByAtomIds: string[]; primaryAtomId?: string; consumerAtomIds: string[]; shared: boolean; reason: string }
export interface PlanningAtomBriefEvidenceSummary extends PlanningEvidenceLocalizationMetadata { path: string; shared: boolean; primaryAtomId?: string; consumerAtomIds: string[] }
export interface PlanningSharedEvidenceRef extends PlanningEvidenceLocalizationMetadata { path: string; primaryAtomId: string; sectionId: string }
export interface PlanningSharedInterfaceRef { key: string; primaryAtomId: string; sectionId: string }
export interface PlanningAtomBriefSection { sectionId: string; kind: SharedPlanningBriefSectionKind; primaryAtomId?: string; content: string; byteLength: number }
export interface PlanningAtomBrief { atomId: string; ownedEvidencePaths: string[]; localEvidencePaths: string[]; ownedInterfaceKeys: string[]; sharedEvidenceRefs: PlanningSharedEvidenceRef[]; sharedInterfaceRefs: PlanningSharedInterfaceRef[]; prerequisiteAtomIds: string[]; sectionIds: string[]; sections: PlanningAtomBriefSection[]; evidenceSummaries?: PlanningAtomBriefEvidenceSummary[]; byteLength: number }
export interface SharedPlanningBriefSection { sectionId: string; kind: SharedPlanningBriefSectionKind; atomIds: string[]; primaryAtomId?: string; content: string; byteLength: number }
export interface SharedPlanningInterfaceSummary { key: string; atomIds: string[]; primaryAtomId: string; consumerAtomIds: string[]; summary: string }
export interface SharedPlanningBrief { graphId: string; sourceHash: string; evidenceOwnership: PlanningEvidenceOwnership[]; interfaceSummaries: SharedPlanningInterfaceSummary[]; atomBriefs: PlanningAtomBrief[]; sections: SharedPlanningBriefSection[]; byteLength: number; limits: SharedPlanningBriefLimits; budgetDiagnostics: SharedBriefBudgetDiagnostic[] }
export type SharedBriefBudgetDiagnosticCode = 'atom-section-demoted' | 'section-dropped-unreferenced' | 'section-dropped-total-budget';
export interface SharedBriefBudgetDiagnostic { code: SharedBriefBudgetDiagnosticCode; sectionId: string; atomId?: string; path?: string; message: string }
export interface PlanningSharedFinding { findingId: string; sourceAtomId: string; evidencePath?: string; interfaceKey?: string; aspectIds: string[]; summary: string; validationExpectation?: string; byteLength: number }
export type SharedPlanningBriefValidation = { ok: true; errors: [] } | { ok: false; errors: string[] };
export interface ValidatePlanningSharedFindingsInput { atomId: string; aspectIds: string[]; interfaceKeys: string[]; ownedEvidencePaths: string[]; ownedInterfaceKeys?: string[]; findings: PlanningSharedFinding[]; limits?: SharedPlanningBriefLimits }

export const DEFAULT_SHARED_PLANNING_BRIEF_LIMITS: SharedPlanningBriefLimits = { maxTotalBriefBytes: 12_000, maxSectionBytes: 1_500, maxSectionsPerAtom: 8, maxSharedFindingsPerAtom: 8, maxSharedFindingBytes: 1_500 };

export function validateSharedPlanningBrief(brief: SharedPlanningBrief, graph: PlanningAtomGraph, limits: SharedPlanningBriefLimits = brief.limits ?? DEFAULT_SHARED_PLANNING_BRIEF_LIMITS): SharedPlanningBriefValidation {
  const errors: string[] = [];
  const atomIds = new Set(graph.atoms.map((atom) => atom.atomId));
  if (brief.graphId !== graph.graphId) errors.push(`brief graph mismatch:${brief.graphId}->${graph.graphId}`);
  if (brief.sourceHash !== graph.sourceHash) errors.push(`brief source mismatch:${brief.sourceHash}->${graph.sourceHash}`);
  if (brief.byteLength > limits.maxTotalBriefBytes) errors.push(`shared brief budget exceeded:${brief.byteLength}`);
  validateOwnership(brief, atomIds, errors);
  validateSections(brief, atomIds, limits, errors);
  validateAtomBriefs(brief, atomIds, limits, errors);
  for (const cycle of findPrerequisiteCycles(brief.atomBriefs)) errors.push(`shared brief prerequisite cycle:${cycle}`);
  for (const cycle of findCombinedPrerequisiteCycles(brief, graph)) errors.push(`shared brief combined prerequisite cycle:${cycle}`);
  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors: [...new Set(errors)].sort() };
}

export function validatePlanningSharedFindings(input: ValidatePlanningSharedFindingsInput): string[] {
  const limits = input.limits ?? DEFAULT_SHARED_PLANNING_BRIEF_LIMITS;
  const ownedInterfaceKeys = input.ownedInterfaceKeys ?? input.interfaceKeys;
  const errors: string[] = [];
  if (input.findings.length > limits.maxSharedFindingsPerAtom) errors.push(`shared finding count budget exceeded:${input.atomId}`);
  validateUnique('shared finding', input.findings.map((finding) => finding.findingId), errors);
  for (const finding of input.findings) {
    if (!nonEmpty(finding.findingId)) errors.push('shared finding requires id');
    if (finding.sourceAtomId !== input.atomId) errors.push(`shared finding source mismatch:${finding.findingId}:${finding.sourceAtomId}->${input.atomId}`);
    if (!nonEmpty(finding.summary)) errors.push(`shared finding requires summary:${finding.findingId}`);
    if (finding.byteLength > limits.maxSharedFindingBytes || utf8ByteLength(finding.summary) > limits.maxSharedFindingBytes) errors.push(`shared finding budget exceeded:${finding.findingId}`);
    if (!finding.evidencePath && !finding.interfaceKey) errors.push(`shared finding requires evidence or interface key:${finding.findingId}`);
    if (finding.evidencePath && !input.ownedEvidencePaths.includes(finding.evidencePath)) errors.push(`shared finding references unowned evidence:${finding.findingId}:${finding.evidencePath}`);
    if (finding.interfaceKey && !input.interfaceKeys.includes(finding.interfaceKey)) errors.push(`shared finding references unknown interface:${finding.findingId}:${finding.interfaceKey}`);
    if (finding.interfaceKey && !ownedInterfaceKeys.includes(finding.interfaceKey)) errors.push(`shared finding references unowned interface:${finding.findingId}:${finding.interfaceKey}`);
    if (finding.aspectIds.length === 0) errors.push(`shared finding requires aspects:${finding.findingId}`);
    for (const aspectId of finding.aspectIds) if (!input.aspectIds.includes(aspectId)) errors.push(`shared finding references unknown aspect:${finding.findingId}:${aspectId}`);
  }
  return [...new Set(errors)].sort();
}

function validateOwnership(brief: SharedPlanningBrief, atomIds: Set<string>, errors: string[]): void {
  validateUnique('evidence ownership', brief.evidenceOwnership.map((entry) => entry.path), errors);
  for (const entry of brief.evidenceOwnership) {
    if (!classifyEvidenceCandidate(entry.path).actionable) errors.push(`shared brief includes non-actionable evidence:${entry.path}`);
    for (const atomId of entry.referencedByAtomIds) if (!atomIds.has(atomId)) errors.push(`evidence references unknown atom:${entry.path}:${atomId}`);
    if (entry.shared && !entry.primaryAtomId) errors.push(`shared evidence requires primary atom:${entry.path}`);
    if (entry.primaryAtomId && !entry.referencedByAtomIds.includes(entry.primaryAtomId)) errors.push(`primary atom must reference evidence:${entry.path}:${entry.primaryAtomId}`);
    for (const atomId of entry.consumerAtomIds) if (!entry.referencedByAtomIds.includes(atomId) || atomId === entry.primaryAtomId) errors.push(`invalid evidence consumer:${entry.path}:${atomId}`);
  }
  validateUnique('interface summary', brief.interfaceSummaries.map((entry) => entry.key), errors);
  for (const entry of brief.interfaceSummaries) {
    if (!atomIds.has(entry.primaryAtomId)) errors.push(`shared interface unknown primary:${entry.key}:${entry.primaryAtomId}`);
    if (!entry.atomIds.includes(entry.primaryAtomId)) errors.push(`primary atom must reference interface:${entry.key}:${entry.primaryAtomId}`);
    for (const atomId of entry.atomIds) if (!atomIds.has(atomId)) errors.push(`interface references unknown atom:${entry.key}:${atomId}`);
    for (const atomId of entry.consumerAtomIds) if (!entry.atomIds.includes(atomId) || atomId === entry.primaryAtomId) errors.push(`invalid interface consumer:${entry.key}:${atomId}`);
  }
}

function validateSections(brief: SharedPlanningBrief, atomIds: Set<string>, limits: SharedPlanningBriefLimits, errors: string[]): void {
  validateUnique('shared brief section', brief.sections.map((section) => section.sectionId), errors);
  for (const section of brief.sections) {
    if (section.byteLength > limits.maxSectionBytes || utf8ByteLength(section.content) > limits.maxSectionBytes) errors.push(`shared brief section budget exceeded:${section.sectionId}`);
    for (const atomId of section.atomIds) if (!atomIds.has(atomId)) errors.push(`shared brief section unknown atom:${section.sectionId}:${atomId}`);
    if (section.primaryAtomId && !atomIds.has(section.primaryAtomId)) errors.push(`shared brief section unknown primary atom:${section.sectionId}:${section.primaryAtomId}`);
  }
}

function validateAtomBriefs(brief: SharedPlanningBrief, atomIds: Set<string>, limits: SharedPlanningBriefLimits, errors: string[]): void {
  const sectionById = new Map(brief.sections.map((section) => [section.sectionId, section]));
  validateUnique('atom brief', brief.atomBriefs.map((atomBrief) => atomBrief.atomId), errors);
  for (const atomBrief of brief.atomBriefs) {
    if (!atomIds.has(atomBrief.atomId)) errors.push(`atom brief unknown atom:${atomBrief.atomId}`);
    if (atomBrief.sectionIds.length > limits.maxSectionsPerAtom) errors.push(`atom brief section count budget exceeded:${atomBrief.atomId}`);
    const embeddedSectionIds = new Set(atomBrief.sections.map((section) => section.sectionId));
    for (const sectionId of atomBrief.sectionIds) {
      if (!sectionById.has(sectionId)) errors.push(`atom brief unknown section:${atomBrief.atomId}:${sectionId}`);
      if (!embeddedSectionIds.has(sectionId)) errors.push(`atom brief missing section content:${atomBrief.atomId}:${sectionId}`);
    }
    for (const ref of atomBrief.sharedEvidenceRefs) validateSharedRef('evidence', atomBrief.atomId, ref.sectionId, ref.primaryAtomId, sectionById, atomIds, errors);
    for (const ref of atomBrief.sharedInterfaceRefs) validateSharedRef('interface', atomBrief.atomId, ref.sectionId, ref.primaryAtomId, sectionById, atomIds, errors);
  }
}

function validateSharedRef(kind: string, atomId: string, sectionId: string, primaryAtomId: string, sectionById: Map<string, SharedPlanningBriefSection>, atomIds: Set<string>, errors: string[]): void {
  if (!sectionById.has(sectionId)) errors.push(`shared ${kind} ref unknown section:${atomId}:${sectionId}`);
  if (!atomIds.has(primaryAtomId)) errors.push(`shared ${kind} ref unknown primary:${atomId}:${primaryAtomId}`);
}

function findCombinedPrerequisiteCycles(brief: SharedPlanningBrief, graph: PlanningAtomGraph): string[] {
  const byId = new Map(graph.atoms.map((atom) => [atom.atomId, [] as string[]]));
  for (const edge of graph.edges) byId.set(edge.toAtomId, [...(byId.get(edge.toAtomId) ?? []), edge.fromAtomId]);
  for (const atomBrief of brief.atomBriefs) byId.set(atomBrief.atomId, [...(byId.get(atomBrief.atomId) ?? []), ...atomBrief.prerequisiteAtomIds]);
  return findCycles(byId);
}

function findPrerequisiteCycles(atomBriefs: PlanningAtomBrief[]): string[] {
  return findCycles(new Map(atomBriefs.map((brief) => [brief.atomId, brief.prerequisiteAtomIds])));
}

function findCycles(byId: Map<string, string[]>): string[] {
  const visiting = new Set<string>(); const visited = new Set<string>(); const cycles: string[] = [];
  const visit = (id: string, path: string[]): void => {
    if (visiting.has(id)) { cycles.push([...path, id].join('->')); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of byId.get(id) ?? []) visit(dep, [...path, id]);
    visiting.delete(id); visited.add(id);
  };
  for (const atomId of byId.keys()) visit(atomId, []);
  return cycles;
}

function validateUnique(kind: string, ids: string[], errors: string[]): void {
  const seen = new Set<string>();
  for (const id of ids.filter(nonEmpty)) {
    if (seen.has(id)) errors.push(`${kind} id duplicated:${id}`);
    seen.add(id);
  }
}

function nonEmpty(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
