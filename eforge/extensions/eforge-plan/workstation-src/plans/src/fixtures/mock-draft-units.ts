import type { DraftPlanUnit, DraftPlanUnitItem, DraftPlanUnitListItem, DraftUnitAdvisory, JsonObject, PlanningProfile } from '@/types';
import { PLANNING_PROFILES } from '@/types';
import { mockBoard, mockRecommendations } from './mock-data';

// Narrow an arbitrary JSON value to the PlanningProfile union (or undefined),
// mirroring how the real backend validates profile against PlanningProfileSchema.
function toProfile(value: unknown): PlanningProfile | undefined {
  return typeof value === 'string' && (PLANNING_PROFILES as readonly string[]).includes(value)
    ? (value as PlanningProfile)
    : undefined;
}

// In-memory stateful store so the dev (:5173) mock bridge behaves like the real
// single-index backend: fork/update/delete/promote mutate one shared list.
let units: DraftPlanUnit[] = [];
let sequence = 0;

const now = () => new Date().toISOString();

function nextId(): string {
  sequence += 1;
  return `mock-draft-unit-${sequence}`;
}

function ordered(): DraftPlanUnit[] {
  return [...units].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.unitId.localeCompare(b.unitId)));
}

function clone(unit: DraftPlanUnit): DraftPlanUnit {
  return { ...unit, items: unit.items.map((item) => ({ ...item })) };
}

function find(unitId: string): DraftPlanUnit {
  const unit = units.find((entry) => entry.unitId === unitId);
  if (!unit) throw new Error(`No draft plan unit found for ${unitId}.`);
  return unit;
}

export function resetMockDraftUnits(): void {
  units = [];
  sequence = 0;
}

export function listMockDraftUnits(input: JsonObject = {}): { units: DraftPlanUnitListItem[]; total: number; limit: number; offset: number } {
  const all = ordered().map((unit) => ({
    unitId: unit.unitId,
    title: unit.title,
    provenance: unit.provenance,
    ...(unit.sourceRecommendationRef !== undefined && { sourceRecommendationRef: unit.sourceRecommendationRef }),
    ...(unit.profile !== undefined && { profile: unit.profile }),
    itemIds: unit.items.map((item) => item.itemId),
    itemCount: unit.items.length,
    status: unit.status,
    ...(unit.promotedSession !== undefined && { promotedSession: unit.promotedSession }),
    ...(unit.promotedAt !== undefined && { promotedAt: unit.promotedAt }),
    createdAt: unit.createdAt,
    updatedAt: unit.updatedAt,
  }));
  const limit = typeof input.limit === 'number' && Number.isInteger(input.limit) && input.limit > 0 ? Math.min(input.limit, 100) : 50;
  const offset = typeof input.offset === 'number' && Number.isInteger(input.offset) && input.offset >= 0 ? input.offset : 0;
  return { units: all.slice(offset, offset + limit), total: all.length, limit, offset };
}

export function getMockDraftUnit(input: JsonObject): { unit: DraftPlanUnit } {
  return { unit: clone(find(String(input.unitId ?? ''))) };
}

export function forkMockDraftUnit(input: JsonObject): { unit: DraftPlanUnit } {
  const ref = String(input.recommendationRef ?? '');
  const group = mockRecommendations.safeParallelizableGroups.find((entry) => entry.ref === ref);
  if (!group) throw new Error(`No recommendation lane found for ref "${ref}".`);
  const stamp = now();
  const unit: DraftPlanUnit = {
    unitId: nextId(),
    title: (typeof input.title === 'string' && input.title.trim()) || group.title || ref,
    ...(group.rationale && { intent: group.rationale }),
    provenance: 'recommendation',
    sourceRecommendationRef: ref,
    ...(toProfile(group.recommendedProfile) && { profile: toProfile(group.recommendedProfile) }),
    items: group.itemIds.map((itemId) => ({ itemId, origin: 'recommendation' as const })),
    status: 'draft',
    createdAt: stamp,
    updatedAt: stamp,
  };
  units.push(unit);
  return { unit: clone(unit) };
}

export function updateMockDraftUnit(input: JsonObject): { unit: DraftPlanUnit } {
  const unit = find(String(input.unitId ?? ''));
  if (typeof input.title === 'string') unit.title = input.title;
  if (typeof input.intent === 'string') unit.intent = input.intent;
  if (input.profile !== undefined) {
    const profile = toProfile(input.profile);
    if (profile === undefined) delete unit.profile;
    else unit.profile = profile;
  }
  if (Array.isArray(input.removeItemIds)) {
    const remove = new Set((input.removeItemIds as unknown[]).map(String));
    unit.items = unit.items.filter((item) => !remove.has(item.itemId));
  }
  if (Array.isArray(input.addItemIds)) {
    const present = new Set(unit.items.map((item) => item.itemId));
    for (const raw of input.addItemIds as unknown[]) {
      const itemId = String(raw);
      if (!present.has(itemId)) unit.items.push({ itemId, origin: 'user' });
    }
  }
  if (Array.isArray(input.itemOrder)) {
    const order = (input.itemOrder as unknown[]).map(String);
    const byId = new Map<string, DraftPlanUnitItem>(unit.items.map((item) => [item.itemId, item]));
    const reordered: DraftPlanUnitItem[] = [];
    for (const id of order) { const item = byId.get(id); if (item) { reordered.push(item); byId.delete(id); } }
    for (const item of unit.items) if (byId.has(item.itemId)) reordered.push(item);
    unit.items = reordered;
  }
  unit.updatedAt = now();
  return { unit: clone(unit) };
}

export function deleteMockDraftUnit(input: JsonObject): { unitId: string; deleted: boolean } {
  const unitId = String(input.unitId ?? '');
  const before = units.length;
  units = units.filter((entry) => entry.unitId !== unitId);
  return { unitId, deleted: units.length < before };
}

// Dependency edges from the mock board (itemId -> ids it depends on), restricted
// to a scope. Lets the mock advisory mirror the real dependency-graph advisor.
function mockDependencyContext(scopeIds: Set<string>): { deps: Map<string, string[]>; labels: Map<string, string> } {
  const deps = new Map<string, string[]>();
  const labels = new Map<string, string>();
  for (const item of mockBoard.items) {
    if (!scopeIds.has(item.id)) continue;
    labels.set(item.id, item.title);
    deps.set(item.id, item.dependencies.map((dependency) => dependency.id).filter((id) => scopeIds.has(id)));
  }
  return { deps, labels };
}

function label(labels: Map<string, string>, id: string): string {
  return labels.get(id) ?? id;
}

function adviseSplit(splitIds: string[], remainderIds: string[]): DraftUnitAdvisory {
  const { deps, labels } = mockDependencyContext(new Set([...splitIds, ...remainderIds]));
  const side = new Map<string, 'split' | 'remainder'>();
  for (const id of splitIds) side.set(id, 'split');
  for (const id of remainderIds) side.set(id, 'remainder');
  const findings: DraftUnitAdvisory['findings'] = [];
  const seen = new Set<string>();
  for (const [from, targets] of deps) {
    for (const to of targets) {
      if (side.get(from) === side.get(to)) continue;
      const key = `${from} ${to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ code: 'split-crosses-dependency', message: `${label(labels, from)} depends on ${label(labels, to)}; splitting separates them into different units.`, itemIds: [from, to] });
    }
  }
  return findings.length === 0
    ? { severity: 'ok', findings: [{ code: 'split-respects-dependencies', message: 'The split keeps every dependency within a single unit.', itemIds: [] }] }
    : { severity: 'caution', findings };
}

function adviseMerge(groups: string[][]): DraftUnitAdvisory {
  const { deps, labels } = mockDependencyContext(new Set(groups.flat()));
  const unitOf = new Map<string, number>();
  groups.forEach((group, index) => { for (const id of group) unitOf.set(id, index); });
  const coupling = new Set<string>();
  for (const [from, targets] of deps) {
    for (const to of targets) {
      if (unitOf.get(from) === undefined || unitOf.get(to) === undefined || unitOf.get(from) === unitOf.get(to)) continue;
      coupling.add(from);
      coupling.add(to);
    }
  }
  if (coupling.size > 0) {
    const itemIds = [...coupling].sort();
    return { severity: 'ok', findings: [{ code: 'merge-justified-by-dependency', message: `These units are coupled by dependencies (${itemIds.map((id) => label(labels, id)).join(', ')}); merging keeps that work together.`, itemIds }] };
  }
  return { severity: 'caution', findings: [{ code: 'merge-independent-units', message: 'These units have no dependencies between them; merging serializes work that could otherwise proceed in parallel.', itemIds: [] }] };
}

function groupsFor(unitIds: string[]): string[][] {
  return unitIds.map((id) => find(id).items.map((item) => item.itemId));
}

export function adviseMergeMockDraftUnits(input: JsonObject): { advisory: DraftUnitAdvisory } {
  return { advisory: adviseMerge(groupsFor((input.unitIds as unknown[]).map(String))) };
}

export function adviseSplitMockDraftUnit(input: JsonObject): { advisory: DraftUnitAdvisory } {
  const unit = find(String(input.unitId ?? ''));
  const splitIds = (input.itemIds as unknown[]).map(String);
  const peel = new Set(splitIds);
  const remainderIds = unit.items.filter((item) => !peel.has(item.itemId)).map((item) => item.itemId);
  return { advisory: adviseSplit(splitIds, remainderIds) };
}

export function mergeMockDraftUnits(input: JsonObject): { unit: DraftPlanUnit; removedUnitIds: string[]; advisory: DraftUnitAdvisory } {
  const unitIds = (input.unitIds as unknown[]).map(String);
  const sources = unitIds.map(find);
  const advisory = adviseMerge(sources.map((unit) => unit.items.map((item) => item.itemId)));
  const seen = new Set<string>();
  const items: DraftPlanUnitItem[] = [];
  for (const source of sources) for (const item of source.items) { if (!seen.has(item.itemId)) { seen.add(item.itemId); items.push({ ...item }); } }
  const [first] = sources;
  const stamp = now();
  const unit: DraftPlanUnit = {
    unitId: nextId(),
    title: (typeof input.title === 'string' && input.title.trim()) || first.title,
    ...(typeof input.intent === 'string' ? { intent: input.intent } : first.intent !== undefined ? { intent: first.intent } : {}),
    provenance: 'user',
    ...(toProfile(input.profile) ? { profile: toProfile(input.profile) } : first.profile !== undefined ? { profile: first.profile } : {}),
    items,
    status: 'draft',
    createdAt: stamp,
    updatedAt: stamp,
  };
  const removed = new Set(unitIds);
  units = units.filter((entry) => !removed.has(entry.unitId));
  units.push(unit);
  return { unit: clone(unit), removedUnitIds: unitIds, advisory };
}

export function splitMockDraftUnit(input: JsonObject): { original: DraftPlanUnit; created: DraftPlanUnit; advisory: DraftUnitAdvisory } {
  const unit = find(String(input.unitId ?? ''));
  const splitIds = (input.itemIds as unknown[]).map(String);
  const peel = new Set(splitIds);
  const splitItems = unit.items.filter((item) => peel.has(item.itemId)).map((item) => ({ ...item }));
  const remainderItems = unit.items.filter((item) => !peel.has(item.itemId));
  const advisory = adviseSplit(splitIds, remainderItems.map((item) => item.itemId));
  unit.items = remainderItems;
  unit.updatedAt = now();
  const stamp = now();
  const created: DraftPlanUnit = {
    unitId: nextId(),
    title: String(input.title ?? 'Split'),
    ...(typeof input.intent === 'string' ? { intent: input.intent } : {}),
    provenance: 'user',
    ...(toProfile(input.profile) ? { profile: toProfile(input.profile) } : {}),
    items: splitItems,
    status: 'draft',
    createdAt: stamp,
    updatedAt: stamp,
  };
  units.push(created);
  return { original: clone(unit), created: clone(created), advisory };
}

export function promoteMockDraftUnit(input: JsonObject): { unit: DraftPlanUnit; promotion: { session: string; sessionPlanPath: string; itemIds: string[] } } {
  const unit = find(String(input.unitId ?? ''));
  const session = (typeof input.session === 'string' && input.session.trim()) || `2026-06-19-${unit.unitId}`;
  unit.status = 'promoted';
  unit.promotedSession = session;
  unit.promotedAt = now();
  unit.updatedAt = unit.promotedAt;
  return {
    unit: clone(unit),
    promotion: { session, sessionPlanPath: `.eforge/session-plans/${session}.md`, itemIds: unit.items.map((item) => item.itemId) },
  };
}
