import type { PlanningAtom, PlanningAtomGraph } from './atom-graph.js';
import { classifyEvidenceCandidate, evidenceSlug } from './evidence-hygiene.js';
import { stableSlug, utf8ByteLength } from './source-analysis.js';
import { DEFAULT_SHARED_PLANNING_BRIEF_LIMITS, validateSharedPlanningBrief, type PlanningAtomBrief, type PlanningAtomBriefSection, type PlanningEvidenceOwnership, type SharedPlanningBrief, type SharedPlanningBriefLimits, type SharedPlanningBriefSection, type SharedPlanningInterfaceSummary } from './shared-brief-contracts.js';

export interface DeriveSharedPlanningBriefInput { graph: PlanningAtomGraph; limits?: Partial<SharedPlanningBriefLimits> }

export function deriveSharedPlanningBrief(input: DeriveSharedPlanningBriefInput): SharedPlanningBrief {
  const limits = { ...DEFAULT_SHARED_PLANNING_BRIEF_LIMITS, ...(input.limits ?? {}) };
  const evidenceOwnership = deriveEvidenceOwnership(input.graph);
  const interfaceSummaries = deriveInterfaceSummaries(input.graph);
  const sections = deriveSections(input.graph, evidenceOwnership, interfaceSummaries, limits);
  const atomBriefs = deriveAtomBriefs(input.graph, evidenceOwnership, interfaceSummaries, sections);
  const brief: SharedPlanningBrief = { graphId: input.graph.graphId, sourceHash: input.graph.sourceHash, evidenceOwnership, interfaceSummaries, atomBriefs, sections, byteLength: sections.reduce((sum, section) => sum + section.byteLength, 0), limits };
  const validation = validateSharedPlanningBrief(brief, input.graph, limits);
  if (!validation.ok) throw new Error(`Invalid shared planning brief: ${validation.errors.join('; ')}`);
  return brief;
}

function deriveEvidenceOwnership(graph: PlanningAtomGraph): PlanningEvidenceOwnership[] {
  const byPath = new Map<string, string[]>();
  for (const atom of graph.atoms) {
    for (const path of atom.evidencePaths.filter((candidate) => classifyEvidenceCandidate(candidate).actionable)) {
      byPath.set(path, [...(byPath.get(path) ?? []), atom.atomId].sort());
    }
  }
  return [...byPath.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, atomIds]) => ownershipForPath(path, [...new Set(atomIds)], graph));
}

function ownershipForPath(path: string, referencedByAtomIds: string[], graph: PlanningAtomGraph): PlanningEvidenceOwnership {
  if (referencedByAtomIds.length <= 1) return { path, referencedByAtomIds, consumerAtomIds: [], shared: false, reason: 'single-atom-evidence' };
  const primaryAtomId = choosePrimaryAtom(referencedByAtomIds, graph).atomId;
  return { path, referencedByAtomIds, primaryAtomId, consumerAtomIds: referencedByAtomIds.filter((atomId) => atomId !== primaryAtomId).sort(), shared: true, reason: 'shared-evidence-primary-owner' };
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

function deriveInterfaceSummaries(graph: PlanningAtomGraph): SharedPlanningInterfaceSummary[] {
  const byKey = new Map<string, string[]>();
  for (const atom of graph.atoms) for (const key of atom.interfaceKeys) byKey.set(key, [...(byKey.get(key) ?? []), atom.atomId].sort());
  return [...byKey.entries()].filter(([, atomIds]) => new Set(atomIds).size > 1).sort(([a], [b]) => a.localeCompare(b)).map(([key, atomIds]) => interfaceSummaryForKey(key, [...new Set(atomIds)].sort(), graph));
}

function interfaceSummaryForKey(key: string, atomIds: string[], graph: PlanningAtomGraph): SharedPlanningInterfaceSummary {
  const primaryAtomId = choosePrimaryAtom(atomIds, graph).atomId;
  const consumerAtomIds = atomIds.filter((atomId) => atomId !== primaryAtomId).sort();
  return { key, atomIds, primaryAtomId, consumerAtomIds, summary: `Shared interface ${key} is referenced by atoms ${atomIds.join(', ')}. Primary atom ${primaryAtomId} owns reusable interface findings for consumers ${consumerAtomIds.join(', ') || '(none)'}.` };
}

function deriveSections(graph: PlanningAtomGraph, ownership: PlanningEvidenceOwnership[], interfaceSummaries: SharedPlanningInterfaceSummary[], limits: SharedPlanningBriefLimits): SharedPlanningBriefSection[] {
  const evidenceSections = ownership.filter((entry) => entry.shared && entry.primaryAtomId).map((entry) => section(`shared-evidence-${evidenceSlug(entry.path)}`, 'evidence', entry.referencedByAtomIds, bounded(`Shared evidence path: ${entry.path}\nPrimary atom: ${entry.primaryAtomId}\nConsumer atoms: ${entry.consumerAtomIds.join(', ') || '(none)'}\nUse the primary atom's accepted shared finding instead of repeating detailed exploration.`, limits.maxSectionBytes), entry.primaryAtomId));
  const interfaceSections = interfaceSummaries.map((item) => section(`shared-interface-${stableSlug(item.key)}`, 'interface', item.atomIds, bounded(item.summary, limits.maxSectionBytes), item.primaryAtomId));
  const dependencySection = graph.edges.length > 0 ? [section('atom-dependency-overview', 'dependency', graph.atoms.map((atom) => atom.atomId), bounded(`Atom dependency edges:\n${graph.edges.map((edge) => `- ${edge.fromAtomId} -> ${edge.toAtomId}: ${edge.reason}`).join('\n')}`, limits.maxSectionBytes))] : [];
  const avoidance = graph.atoms.length > 0 ? [section('evidence-avoidance-guidance', 'avoidance', graph.atoms.map((atom) => atom.atomId), 'Avoid generated planner artifacts, .decomposition outputs, orchestration files, broad package roots, and tool-noise paths as implementation evidence.')] : [];
  return [...evidenceSections, ...interfaceSections, ...dependencySection, ...avoidance].sort((a, b) => a.sectionId.localeCompare(b.sectionId));
}

function deriveAtomBriefs(graph: PlanningAtomGraph, ownership: PlanningEvidenceOwnership[], interfaceSummaries: SharedPlanningInterfaceSummary[], sections: SharedPlanningBriefSection[]): PlanningAtomBrief[] {
  const sectionByEvidencePath = new Map(ownership.filter((entry) => entry.shared).map((entry) => [entry.path, `shared-evidence-${evidenceSlug(entry.path)}`]));
  const sectionByInterfaceKey = new Map(interfaceSummaries.map((entry) => [entry.key, `shared-interface-${stableSlug(entry.key)}`]));
  return graph.atoms.map((atom) => {
    const ownedEvidencePaths = ownership.filter((entry) => entry.primaryAtomId === atom.atomId).map((entry) => entry.path).sort();
    const localEvidencePaths = ownership.filter((entry) => !entry.shared && entry.referencedByAtomIds.includes(atom.atomId)).map((entry) => entry.path).sort();
    const ownedInterfaceKeys = interfaceSummaries.filter((entry) => entry.primaryAtomId === atom.atomId).map((entry) => entry.key).sort();
    const sharedEvidenceRefs = ownership.filter((entry) => entry.shared && entry.primaryAtomId && entry.consumerAtomIds.includes(atom.atomId)).map((entry) => ({ path: entry.path, primaryAtomId: entry.primaryAtomId!, sectionId: sectionByEvidencePath.get(entry.path)! })).sort((a, b) => a.path.localeCompare(b.path));
    const sharedInterfaceRefs = interfaceSummaries.filter((entry) => entry.consumerAtomIds.includes(atom.atomId)).map((entry) => ({ key: entry.key, primaryAtomId: entry.primaryAtomId, sectionId: sectionByInterfaceKey.get(entry.key)! })).sort((a, b) => a.key.localeCompare(b.key));
    const sectionIds = sectionIdsForAtom(atom.atomId, sections, [...ownedEvidencePaths, ...sharedEvidenceRefs.map((ref) => ref.path)], sectionByEvidencePath);
    const atomSections = sections.filter((section) => sectionIds.includes(section.sectionId)).map(briefSection);
    const prerequisiteAtomIds = [...new Set([...sharedEvidenceRefs.map((ref) => ref.primaryAtomId), ...sharedInterfaceRefs.map((ref) => ref.primaryAtomId)])].sort();
    return { atomId: atom.atomId, ownedEvidencePaths, localEvidencePaths, ownedInterfaceKeys, sharedEvidenceRefs, sharedInterfaceRefs, prerequisiteAtomIds, sectionIds, sections: atomSections, byteLength: atomSections.reduce((sum, section) => sum + section.byteLength, 0) };
  }).sort((a, b) => a.atomId.localeCompare(b.atomId));
}

function sectionIdsForAtom(atomId: string, sections: SharedPlanningBriefSection[], paths: string[], sectionByEvidencePath: Map<string, string>): string[] {
  const evidenceSections = paths.flatMap((path) => sectionByEvidencePath.get(path) ? [sectionByEvidencePath.get(path)!] : []);
  const commonSections = sections.filter((section) => section.kind !== 'evidence' && section.atomIds.includes(atomId)).map((section) => section.sectionId);
  return [...new Set([...evidenceSections, ...commonSections])].sort();
}

function briefSection(section: SharedPlanningBriefSection): PlanningAtomBriefSection {
  return { sectionId: section.sectionId, kind: section.kind, ...(section.primaryAtomId ? { primaryAtomId: section.primaryAtomId } : {}), content: section.content, byteLength: section.byteLength };
}

function section(sectionId: string, kind: SharedPlanningBriefSection['kind'], atomIds: string[], content: string, primaryAtomId?: string): SharedPlanningBriefSection {
  return { sectionId, kind, atomIds: [...new Set(atomIds)].sort(), ...(primaryAtomId ? { primaryAtomId } : {}), content, byteLength: utf8ByteLength(content) };
}

function bounded(value: string, maxBytes: number): string {
  return utf8ByteLength(value) <= maxBytes ? value : `${value.slice(0, Math.max(0, maxBytes - 1))}…`;
}

function requireAtom(graph: PlanningAtomGraph, atomId: string): PlanningAtom {
  const atom = graph.atoms.find((candidate) => candidate.atomId === atomId);
  if (!atom) throw new Error(`unknown atom:${atomId}`);
  return atom;
}
