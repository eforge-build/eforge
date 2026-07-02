import type { PlanningAtomGraph } from './atom-graph.js';
import { compareEvidenceOwnershipValue, type PlanningEvidenceOwnership, type SharedBriefBudgetDiagnostic, type SharedPlanningBriefLimits, type SharedPlanningBriefSection } from './shared-brief-contracts.js';

interface SectionBudgetSelectionInput {
  graph: PlanningAtomGraph;
  ownership: PlanningEvidenceOwnership[];
  sections: SharedPlanningBriefSection[];
  sectionIdByEvidencePath: Map<string, string>;
  limits: SharedPlanningBriefLimits;
}

export interface SectionBudgetSelection {
  sections: SharedPlanningBriefSection[];
  sectionIdsByAtom: Map<string, string[]>;
  diagnostics: SharedBriefBudgetDiagnostic[];
}

/**
 * Deterministically fit candidate sections inside the shared-brief budgets.
 * Budgets are enforced by selection (keep the highest-value sections, demote
 * or drop the rest with diagnostics), never by failing the compile. Demoted
 * evidence paths stay visible to atoms through evidence summaries and to
 * materialization through evidence ownership.
 */
export function selectSectionsWithinBudgets(input: SectionBudgetSelectionInput): SectionBudgetSelection {
  const diagnostics: SharedBriefBudgetDiagnostic[] = [];
  const pathBySectionId = new Map([...input.sectionIdByEvidencePath.entries()].map(([path, sectionId]) => [sectionId, path] as const));
  const keepOrder = sectionKeepOrder(input.sections, input.ownership, pathBySectionId);
  const priority = new Map(keepOrder.map((sectionId, index) => [sectionId, index] as const));
  const sectionIdsByAtom = selectPerAtom(input, priority, pathBySectionId, diagnostics);
  const retained = retainReferencedSections(input.sections, sectionIdsByAtom, pathBySectionId, diagnostics);
  const fitted = fitTotalBudget(retained, sectionIdsByAtom, priority, pathBySectionId, input.limits, diagnostics);
  return { sections: fitted, sectionIdsByAtom, diagnostics: diagnostics.sort((a, b) => `${a.code}:${a.sectionId}:${a.atomId ?? ''}`.localeCompare(`${b.code}:${b.sectionId}:${b.atomId ?? ''}`)) };
}

function selectPerAtom(input: SectionBudgetSelectionInput, priority: Map<string, number>, pathBySectionId: Map<string, string>, diagnostics: SharedBriefBudgetDiagnostic[]): Map<string, string[]> {
  const desiredByAtom = desiredSectionIdsByAtom(input);
  const selected = new Map<string, string[]>();
  for (const atom of input.graph.atoms) {
    const desired = [...(desiredByAtom.get(atom.atomId) ?? [])].sort((a, b) => (priority.get(a) ?? Number.MAX_SAFE_INTEGER) - (priority.get(b) ?? Number.MAX_SAFE_INTEGER));
    const kept = desired.slice(0, Math.max(0, input.limits.maxSectionsPerAtom));
    for (const sectionId of desired.slice(kept.length)) {
      diagnostics.push({ code: 'atom-section-demoted', sectionId, atomId: atom.atomId, ...pathField(pathBySectionId, sectionId), message: `Section ${sectionId} demoted for ${atom.atomId}: atom section budget (${input.limits.maxSectionsPerAtom}) reached; path stays available via evidence summaries.` });
    }
    selected.set(atom.atomId, kept.sort((a, b) => a.localeCompare(b)));
  }
  return selected;
}

function retainReferencedSections(sections: SharedPlanningBriefSection[], sectionIdsByAtom: Map<string, string[]>, pathBySectionId: Map<string, string>, diagnostics: SharedBriefBudgetDiagnostic[]): SharedPlanningBriefSection[] {
  const referenced = new Set([...sectionIdsByAtom.values()].flat());
  const retained: SharedPlanningBriefSection[] = [];
  for (const section of sections) {
    if (referenced.has(section.sectionId)) {
      retained.push(section);
      continue;
    }
    diagnostics.push({ code: 'section-dropped-unreferenced', sectionId: section.sectionId, ...pathField(pathBySectionId, section.sectionId), message: `Section ${section.sectionId} dropped: no atom selected it within section budgets.` });
  }
  return retained;
}

function fitTotalBudget(sections: SharedPlanningBriefSection[], sectionIdsByAtom: Map<string, string[]>, priority: Map<string, number>, pathBySectionId: Map<string, string>, limits: SharedPlanningBriefLimits, diagnostics: SharedBriefBudgetDiagnostic[]): SharedPlanningBriefSection[] {
  const retained = [...sections];
  let totalBytes = retained.reduce((sum, section) => sum + section.byteLength, 0);
  while (totalBytes > limits.maxTotalBriefBytes && retained.length > 0) {
    const dropIndex = lowestPriorityIndex(retained, priority);
    const [dropped] = retained.splice(dropIndex, 1);
    totalBytes -= dropped.byteLength;
    for (const [atomId, sectionIds] of sectionIdsByAtom) sectionIdsByAtom.set(atomId, sectionIds.filter((sectionId) => sectionId !== dropped.sectionId));
    diagnostics.push({ code: 'section-dropped-total-budget', sectionId: dropped.sectionId, ...pathField(pathBySectionId, dropped.sectionId), message: `Section ${dropped.sectionId} dropped: total brief budget (${limits.maxTotalBriefBytes} bytes) exceeded.` });
  }
  return retained;
}

function lowestPriorityIndex(sections: SharedPlanningBriefSection[], priority: Map<string, number>): number {
  let index = 0;
  for (let candidate = 1; candidate < sections.length; candidate += 1) {
    const candidatePriority = priority.get(sections[candidate].sectionId) ?? Number.MAX_SAFE_INTEGER;
    const currentPriority = priority.get(sections[index].sectionId) ?? Number.MAX_SAFE_INTEGER;
    if (candidatePriority > currentPriority) index = candidate;
  }
  return index;
}

function desiredSectionIdsByAtom(input: SectionBudgetSelectionInput): Map<string, string[]> {
  const desired = new Map<string, Set<string>>(input.graph.atoms.map((atom) => [atom.atomId, new Set<string>()]));
  for (const section of input.sections.filter((item) => item.kind !== 'evidence')) {
    for (const atomId of section.atomIds) desired.get(atomId)?.add(section.sectionId);
  }
  for (const entry of input.ownership.filter((item) => item.shared && item.primaryAtomId)) {
    const sectionId = input.sectionIdByEvidencePath.get(entry.path);
    if (!sectionId) continue;
    for (const atomId of [entry.primaryAtomId!, ...entry.consumerAtomIds]) desired.get(atomId)?.add(sectionId);
  }
  return new Map([...desired.entries()].map(([atomId, sectionIds]) => [atomId, [...sectionIds]] as const));
}

const SECTION_KIND_ORDER: Record<SharedPlanningBriefSection['kind'], number> = { avoidance: 0, dependency: 1, interface: 2, evidence: 3 };

function sectionKeepOrder(sections: SharedPlanningBriefSection[], ownership: PlanningEvidenceOwnership[], pathBySectionId: Map<string, string>): string[] {
  const ownershipByPath = new Map(ownership.map((entry) => [entry.path, entry] as const));
  return [...sections].sort((a, b) => {
    const kindDelta = SECTION_KIND_ORDER[a.kind] - SECTION_KIND_ORDER[b.kind];
    if (kindDelta !== 0) return kindDelta;
    if (a.kind === 'interface') return b.atomIds.length - a.atomIds.length || a.sectionId.localeCompare(b.sectionId);
    if (a.kind === 'evidence') return compareEvidenceValue(ownershipForSection(a.sectionId, ownershipByPath, pathBySectionId), ownershipForSection(b.sectionId, ownershipByPath, pathBySectionId)) || a.sectionId.localeCompare(b.sectionId);
    return a.sectionId.localeCompare(b.sectionId);
  }).map((section) => section.sectionId);
}

function ownershipForSection(sectionId: string, ownershipByPath: Map<string, PlanningEvidenceOwnership>, pathBySectionId: Map<string, string>): PlanningEvidenceOwnership | undefined {
  const path = pathBySectionId.get(sectionId);
  return path ? ownershipByPath.get(path) : undefined;
}

function compareEvidenceValue(a: PlanningEvidenceOwnership | undefined, b: PlanningEvidenceOwnership | undefined): number {
  if (!a || !b) return Number(!a) - Number(!b);
  return compareEvidenceOwnershipValue(a, b);
}

function pathField(pathBySectionId: Map<string, string>, sectionId: string): { path?: string } {
  const path = pathBySectionId.get(sectionId);
  return path ? { path } : {};
}
