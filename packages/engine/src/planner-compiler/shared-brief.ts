import type { PlanningAtom, PlanningAtomGraph } from './atom-graph.js';
import { classifyEvidenceCandidate, evidenceSlug, normalizeEvidenceValue } from './evidence-hygiene.js';
import { stableSlug, utf8ByteLength } from './source-analysis.js';
import { selectSectionsWithinBudgets, type SectionBudgetSelection } from './shared-brief-budget.js';
import { DEFAULT_SHARED_PLANNING_BRIEF_LIMITS, validateSharedPlanningBrief, type PlanningAtomBrief, type PlanningAtomBriefEvidenceSummary, type PlanningAtomBriefSection, type PlanningEvidenceOwnership, type SharedPlanningBrief, type SharedPlanningBriefLimits, type SharedPlanningBriefSection, type SharedPlanningInterfaceSummary } from './shared-brief-contracts.js';
import type { SourceLocalizationBundle, SourceLocalizationCandidate, SourceLocalizationConfidence, SourceLocalizationRecord, SourceLocalizationStatus } from './source-localization-contracts.js';

export interface DeriveSharedPlanningBriefInput { graph: PlanningAtomGraph; limits?: Partial<SharedPlanningBriefLimits>; sourceLocalizationBundle?: SourceLocalizationBundle }

export function deriveSharedPlanningBrief(input: DeriveSharedPlanningBriefInput): SharedPlanningBrief {
  const limits = { ...DEFAULT_SHARED_PLANNING_BRIEF_LIMITS, ...(input.limits ?? {}) };
  const evidenceOwnership = deriveEvidenceOwnership(input.graph, input.sourceLocalizationBundle);
  const interfaceSummaries = deriveInterfaceSummaries(input.graph, input.sourceLocalizationBundle);
  const candidateSections = deriveSections(input.graph, evidenceOwnership, interfaceSummaries, limits);
  const sectionIdByEvidencePath = new Map(evidenceOwnership.filter((entry) => entry.shared).map((entry) => [entry.path, `shared-evidence-${evidenceSlug(entry.path)}`] as const));
  const selection = selectSectionsWithinBudgets({ graph: input.graph, ownership: evidenceOwnership, sections: candidateSections, sectionIdByEvidencePath, limits });
  const atomBriefs = deriveAtomBriefs(input.graph, evidenceOwnership, interfaceSummaries, selection);
  const brief: SharedPlanningBrief = { graphId: input.graph.graphId, sourceHash: input.graph.sourceHash, evidenceOwnership, interfaceSummaries, atomBriefs, sections: selection.sections, byteLength: selection.sections.reduce((sum, section) => sum + section.byteLength, 0), limits, budgetDiagnostics: selection.diagnostics };
  // Budgets are enforced by construction in selectSectionsWithinBudgets; a
  // validation failure here is a compiler defect, not an input condition.
  const validation = validateSharedPlanningBrief(brief, input.graph, limits);
  if (!validation.ok) throw new Error(`Invalid shared planning brief: ${validation.errors.join('; ')}`);
  return brief;
}

function deriveEvidenceOwnership(graph: PlanningAtomGraph, localization?: SourceLocalizationBundle): PlanningEvidenceOwnership[] {
  const byPath = new Map<string, OwnershipAccumulator>();
  for (const record of localization?.records ?? []) addLocalizedOwnership(record, graph, byPath);
  const localizedQueries = new Set((localization?.records ?? []).filter((record) => record.candidateFiles.length > 0).map((record) => normalizeEvidenceValue(record.query)));
  for (const atom of graph.atoms) {
    for (const path of atom.evidencePaths.filter((candidate) => classifyEvidenceCandidate(candidate).actionable)) {
      if (localizedQueries.has(normalizeEvidenceValue(path)) && classifyEvidenceCandidate(path).kind === 'directory') continue;
      addOwnershipPath(byPath, normalizeEvidenceValue(path), [atom.atomId], { reason: 'exact-evidence-path' });
    }
  }
  return [...byPath.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, item]) => ownershipForPath(path, [...item.atomIds], graph, item));
}

interface OwnershipAccumulator { atomIds: Set<string>; localizationNeedIds: Set<string>; reasons: Set<string>; candidateRank?: number; localizationConfidence?: SourceLocalizationConfidence; localizationStatus?: SourceLocalizationStatus; criterionLinked?: boolean }

function addLocalizedOwnership(record: SourceLocalizationRecord, graph: PlanningAtomGraph, byPath: Map<string, OwnershipAccumulator>): void {
  const atomIds = localizationAtomIds(record, graph);
  if (atomIds.length === 0) return;
  for (const [index, candidate] of record.candidateFiles.entries()) {
    if (!classifyEvidenceCandidate(candidate.path).actionable) continue;
    addOwnershipPath(byPath, candidate.path, atomIds, { record, candidate, candidateRank: index + 1 });
  }
}

function addOwnershipPath(byPath: Map<string, OwnershipAccumulator>, rawPath: string, atomIds: string[], metadata: { reason: string } | { record: SourceLocalizationRecord; candidate: SourceLocalizationCandidate; candidateRank: number }): void {
  const path = normalizeEvidenceValue(rawPath);
  const existing = byPath.get(path) ?? { atomIds: new Set<string>(), localizationNeedIds: new Set<string>(), reasons: new Set<string>() };
  for (const atomId of atomIds) existing.atomIds.add(atomId);
  if ('record' in metadata) {
    existing.localizationNeedIds.add(metadata.record.needId);
    existing.reasons.add(`${metadata.record.reason}; ${metadata.candidate.reason}`);
    existing.localizationConfidence = bestConfidence(existing.localizationConfidence, metadata.candidate.confidence);
    existing.localizationStatus = bestStatus(existing.localizationStatus, metadata.record.status);
    existing.candidateRank = Math.min(existing.candidateRank ?? metadata.candidateRank, metadata.candidateRank);
    if (metadata.record.linkedCriterionIds.length > 0) existing.criterionLinked = true;
  } else {
    existing.reasons.add(metadata.reason);
    // Exact evidence paths come straight from criterion text.
    existing.criterionLinked = true;
  }
  byPath.set(path, existing);
}

function localizationAtomIds(record: SourceLocalizationRecord, graph: PlanningAtomGraph): string[] {
  const assigned = record.assignedAtomIds.filter((atomId) => graph.atoms.some((atom) => atom.atomId === atomId));
  if (assigned.length > 0) return [...new Set(assigned)].sort();
  const byCriterion = graph.atoms.filter((atom) => record.linkedCriterionIds.some((criterionId) => atom.criterionIds.includes(criterionId))).map((atom) => atom.atomId);
  if (byCriterion.length > 0) return [...new Set(byCriterion)].sort();
  // Global records (no atom assignment, no linked criteria) get one
  // deterministic owner instead of broadcasting to every atom: broadcast made
  // every such path a shared section and blew per-atom section budgets. The
  // owner atom receives the materialized evidence and can propagate findings.
  if (record.linkedCriterionIds.length === 0 && graph.atoms.length > 0) return [choosePrimaryAtom(graph.atoms.map((atom) => atom.atomId), graph).atomId];
  return [];
}

function ownershipForPath(path: string, referencedByAtomIds: string[], graph: PlanningAtomGraph, metadata?: OwnershipAccumulator): PlanningEvidenceOwnership {
  const shared = referencedByAtomIds.length > 1;
  const primaryAtomId = shared ? choosePrimaryAtom(referencedByAtomIds, graph).atomId : undefined;
  const reason = shared ? 'shared-evidence-primary-owner' : 'single-atom-evidence';
  return {
    path,
    referencedByAtomIds,
    ...(primaryAtomId ? { primaryAtomId } : {}),
    consumerAtomIds: primaryAtomId ? referencedByAtomIds.filter((atomId) => atomId !== primaryAtomId).sort() : [],
    shared,
    reason,
    ...localizationOwnershipMetadata(metadata),
  };
}

function localizationOwnershipMetadata(metadata: OwnershipAccumulator | undefined): Pick<PlanningEvidenceOwnership, 'localizationNeedIds' | 'localizationStatus' | 'localizationConfidence' | 'candidateRank' | 'ownershipRationale' | 'criterionLinked'> {
  if (!metadata) return {};
  const criterionLinked = metadata.criterionLinked === true ? { criterionLinked: true } : {};
  if (metadata.localizationNeedIds.size === 0) return criterionLinked;
  return {
    localizationNeedIds: [...metadata.localizationNeedIds].sort(),
    ...(metadata.localizationStatus ? { localizationStatus: metadata.localizationStatus } : {}),
    ...(metadata.localizationConfidence ? { localizationConfidence: metadata.localizationConfidence } : {}),
    ...(metadata.candidateRank !== undefined ? { candidateRank: metadata.candidateRank } : {}),
    ownershipRationale: [...metadata.reasons].sort().join(' | '),
    ...criterionLinked,
  };
}

function bestConfidence(a: SourceLocalizationConfidence | undefined, b: SourceLocalizationConfidence): SourceLocalizationConfidence {
  const rank: Record<SourceLocalizationConfidence, number> = { high: 3, medium: 2, low: 1 };
  return !a || rank[b] > rank[a] ? b : a;
}

function bestStatus(a: SourceLocalizationStatus | undefined, b: SourceLocalizationStatus): SourceLocalizationStatus {
  const rank: Record<SourceLocalizationStatus, number> = { resolved: 5, partial: 4, 'budget-exceeded': 3, unresolved: 2, ignored: 1 };
  return !a || rank[b] > rank[a] ? b : a;
}

function choosePrimaryAtom(atomIds: string[], graph: PlanningAtomGraph): PlanningAtom {
  const atoms = atomIds.map((atomId) => requireAtom(graph, atomId));
  return atoms.sort((a, b) => primaryDependencyPenalty(a, atomIds, graph) - primaryDependencyPenalty(b, atomIds, graph) || primaryScore(a) - primaryScore(b) || a.estimate.estimatedPromptBytes - b.estimate.estimatedPromptBytes || a.atomId.localeCompare(b.atomId))[0];
}

function primaryDependencyPenalty(atom: PlanningAtom, atomIds: string[], graph: PlanningAtomGraph): number {
  const peerIds = atomIds.filter((atomId) => atomId !== atom.atomId);
  return peerIds.some((peerId) => atomDependsOn(graph, atom.atomId, peerId)) ? 1 : 0;
}

function atomDependsOn(graph: PlanningAtomGraph, atomId: string, dependencyId: string): boolean {
  const incoming = incomingDependencyMap(graph);
  const seen = new Set<string>();
  const stack = [...(incoming.get(atomId) ?? [])];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === dependencyId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(incoming.get(current) ?? []));
  }
  return false;
}

function incomingDependencyMap(graph: PlanningAtomGraph): Map<string, string[]> {
  const byAtom = new Map(graph.atoms.map((atom) => [atom.atomId, [] as string[]]));
  for (const edge of graph.edges) byAtom.set(edge.toAtomId, [...(byAtom.get(edge.toAtomId) ?? []), edge.fromAtomId]);
  return new Map([...byAtom.entries()].map(([atomId, dependencies]) => [atomId, [...new Set(dependencies)].sort()]));
}

function primaryScore(atom: PlanningAtom): number {
  if (atom.reason === 'foundation-contract') return 0;
  if (atom.interfaceKeys.length > 0) return 1;
  return 2;
}

function deriveInterfaceSummaries(graph: PlanningAtomGraph, localization?: SourceLocalizationBundle): SharedPlanningInterfaceSummary[] {
  const byKey = new Map<string, string[]>();
  for (const atom of graph.atoms) for (const key of atom.interfaceKeys) byKey.set(key, [...(byKey.get(key) ?? []), atom.atomId].sort());
  for (const record of localization?.records.filter((item) => item.kind === 'interface') ?? []) {
    const atomIds = localizationAtomIds(record, graph);
    if (atomIds.length > 0) byKey.set(record.query, [...(byKey.get(record.query) ?? []), ...atomIds].sort());
  }
  return [...byKey.entries()].filter(([, atomIds]) => new Set(atomIds).size > 1).sort(([a], [b]) => a.localeCompare(b)).map(([key, atomIds]) => interfaceSummaryForKey(key, [...new Set(atomIds)].sort(), graph));
}

function interfaceSummaryForKey(key: string, atomIds: string[], graph: PlanningAtomGraph): SharedPlanningInterfaceSummary {
  const primaryAtomId = choosePrimaryAtom(atomIds, graph).atomId;
  const consumerAtomIds = atomIds.filter((atomId) => atomId !== primaryAtomId).sort();
  return { key, atomIds, primaryAtomId, consumerAtomIds, summary: `Shared interface ${key} is referenced by atoms ${atomIds.join(', ')}. Primary atom ${primaryAtomId} owns reusable interface findings for consumers ${consumerAtomIds.join(', ') || '(none)'}.` };
}

function deriveSections(graph: PlanningAtomGraph, ownership: PlanningEvidenceOwnership[], interfaceSummaries: SharedPlanningInterfaceSummary[], limits: SharedPlanningBriefLimits): SharedPlanningBriefSection[] {
  const evidenceSections = ownership.filter((entry) => entry.shared && entry.primaryAtomId).map((entry) => section(`shared-evidence-${evidenceSlug(entry.path)}`, 'evidence', entry.referencedByAtomIds, bounded(`Shared evidence path: ${entry.path}\nPrimary atom: ${entry.primaryAtomId}\nConsumer atoms: ${entry.consumerAtomIds.join(', ') || '(none)'}${entry.localizationNeedIds?.length ? `\nLocalization needs: ${entry.localizationNeedIds.join(', ')}` : ''}${entry.localizationConfidence ? `\nLocalization confidence: ${entry.localizationConfidence}` : ''}${entry.candidateRank !== undefined ? `\nCandidate rank: ${entry.candidateRank}` : ''}${entry.ownershipRationale ? `\nWhy selected: ${entry.ownershipRationale}` : ''}\nUse the primary atom's accepted shared finding instead of repeating detailed exploration.`, limits.maxSectionBytes), entry.primaryAtomId));
  const interfaceSections = interfaceSummaries.map((item) => section(`shared-interface-${stableSlug(item.key)}`, 'interface', item.atomIds, bounded(item.summary, limits.maxSectionBytes), item.primaryAtomId));
  const dependencySection = graph.edges.length > 0 ? [section('atom-dependency-overview', 'dependency', graph.atoms.map((atom) => atom.atomId), bounded(`Atom dependency edges:\n${graph.edges.map((edge) => `- ${edge.fromAtomId} -> ${edge.toAtomId}: ${edge.reason}`).join('\n')}`, limits.maxSectionBytes))] : [];
  const avoidance = graph.atoms.length > 0 ? [section('evidence-avoidance-guidance', 'avoidance', graph.atoms.map((atom) => atom.atomId), bounded('Avoid generated planner artifacts, .decomposition outputs, orchestration files, broad package roots, and tool-noise paths as implementation evidence.', limits.maxSectionBytes))] : [];
  return [...evidenceSections, ...interfaceSections, ...dependencySection, ...avoidance].sort((a, b) => a.sectionId.localeCompare(b.sectionId));
}

function deriveAtomBriefs(graph: PlanningAtomGraph, ownership: PlanningEvidenceOwnership[], interfaceSummaries: SharedPlanningInterfaceSummary[], selection: SectionBudgetSelection): PlanningAtomBrief[] {
  const sectionByInterfaceKey = new Map(interfaceSummaries.map((entry) => [entry.key, `shared-interface-${stableSlug(entry.key)}`]));
  const retainedSectionIds = new Set(selection.sections.map((section) => section.sectionId));
  return graph.atoms.map((atom) => {
    const ownedEvidencePaths = ownership.filter((entry) => entry.primaryAtomId === atom.atomId).map((entry) => entry.path).sort();
    const localEvidencePaths = ownership.filter((entry) => !entry.shared && entry.referencedByAtomIds.includes(atom.atomId)).map((entry) => entry.path).sort();
    const ownedInterfaceKeys = interfaceSummaries.filter((entry) => entry.primaryAtomId === atom.atomId).map((entry) => entry.key).sort();
    // Refs may only point at retained sections; prerequisites are computed
    // from ownership/interface data so scheduling survives section drops.
    const sharedEvidenceRefs = ownership.filter((entry) => entry.shared && entry.primaryAtomId && entry.consumerAtomIds.includes(atom.atomId) && retainedSectionIds.has(`shared-evidence-${evidenceSlug(entry.path)}`)).map((entry) => ({ path: entry.path, primaryAtomId: entry.primaryAtomId!, sectionId: `shared-evidence-${evidenceSlug(entry.path)}`, ...evidenceRefMetadata(entry) })).sort((a, b) => a.path.localeCompare(b.path));
    const sharedInterfaceRefs = interfaceSummaries.filter((entry) => entry.consumerAtomIds.includes(atom.atomId) && retainedSectionIds.has(sectionByInterfaceKey.get(entry.key)!)).map((entry) => ({ key: entry.key, primaryAtomId: entry.primaryAtomId, sectionId: sectionByInterfaceKey.get(entry.key)! })).sort((a, b) => a.key.localeCompare(b.key));
    const sectionIds = selection.sectionIdsByAtom.get(atom.atomId) ?? [];
    const atomSections = selection.sections.filter((section) => sectionIds.includes(section.sectionId)).map(briefSection);
    const prerequisiteAtomIds = [...new Set([
      ...ownership.filter((entry) => entry.shared && entry.primaryAtomId && entry.consumerAtomIds.includes(atom.atomId)).map((entry) => entry.primaryAtomId!),
      ...interfaceSummaries.filter((entry) => entry.consumerAtomIds.includes(atom.atomId)).map((entry) => entry.primaryAtomId),
    ])].sort();
    const evidenceSummaries = ownership.filter((entry) => entry.referencedByAtomIds.includes(atom.atomId)).map(evidenceSummary).sort((a, b) => a.path.localeCompare(b.path));
    return { atomId: atom.atomId, ownedEvidencePaths, localEvidencePaths, ownedInterfaceKeys, sharedEvidenceRefs, sharedInterfaceRefs, prerequisiteAtomIds, sectionIds, sections: atomSections, evidenceSummaries, byteLength: atomSections.reduce((sum, section) => sum + section.byteLength, 0) };
  }).sort((a, b) => a.atomId.localeCompare(b.atomId));
}

function evidenceRefMetadata(entry: PlanningEvidenceOwnership): Pick<PlanningEvidenceOwnership, 'localizationNeedIds' | 'localizationStatus' | 'localizationConfidence' | 'candidateRank' | 'ownershipRationale'> {
  return {
    ...(entry.localizationNeedIds ? { localizationNeedIds: [...entry.localizationNeedIds] } : {}),
    ...(entry.localizationStatus ? { localizationStatus: entry.localizationStatus } : {}),
    ...(entry.localizationConfidence ? { localizationConfidence: entry.localizationConfidence } : {}),
    ...(entry.candidateRank !== undefined ? { candidateRank: entry.candidateRank } : {}),
    ...(entry.ownershipRationale ? { ownershipRationale: entry.ownershipRationale } : {}),
  };
}

function evidenceSummary(entry: PlanningEvidenceOwnership): PlanningAtomBriefEvidenceSummary {
  return {
    path: entry.path,
    shared: entry.shared,
    ...(entry.primaryAtomId ? { primaryAtomId: entry.primaryAtomId } : {}),
    consumerAtomIds: [...entry.consumerAtomIds],
    ...evidenceRefMetadata(entry),
  };
}

function briefSection(section: SharedPlanningBriefSection): PlanningAtomBriefSection {
  return { sectionId: section.sectionId, kind: section.kind, ...(section.primaryAtomId ? { primaryAtomId: section.primaryAtomId } : {}), content: section.content, byteLength: section.byteLength };
}

function section(sectionId: string, kind: SharedPlanningBriefSection['kind'], atomIds: string[], content: string, primaryAtomId?: string): SharedPlanningBriefSection {
  return { sectionId, kind, atomIds: [...new Set(atomIds)].sort(), ...(primaryAtomId ? { primaryAtomId } : {}), content, byteLength: utf8ByteLength(content) };
}

const TRUNCATION_ELLIPSIS = '…';

function bounded(value: string, maxBytes: number): string {
  if (utf8ByteLength(value) <= maxBytes) return value;
  const contentBudget = maxBytes - utf8ByteLength(TRUNCATION_ELLIPSIS);
  if (contentBudget <= 0) return '';
  let result = '';
  let usedBytes = 0;
  for (const char of value) {
    const charBytes = utf8ByteLength(char);
    if (usedBytes + charBytes > contentBudget) break;
    result += char;
    usedBytes += charBytes;
  }
  return `${result}${TRUNCATION_ELLIPSIS}`;
}

function requireAtom(graph: PlanningAtomGraph, atomId: string): PlanningAtom {
  const atom = graph.atoms.find((candidate) => candidate.atomId === atomId);
  if (!atom) throw new Error(`unknown atom:${atomId}`);
  return atom;
}
