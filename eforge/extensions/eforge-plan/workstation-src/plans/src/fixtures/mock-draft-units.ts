import type { DraftPlanUnit, DraftPlanUnitItem, JsonObject } from '@/types';
import { mockRecommendations } from './mock-data';

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

export function listMockDraftUnits(): { units: DraftPlanUnit[] } {
  return { units: ordered().map(clone) };
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
    ...(group.recommendedProfile && { profile: group.recommendedProfile }),
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
    const profile = String(input.profile);
    if (profile === '') delete unit.profile;
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
