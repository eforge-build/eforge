import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dispatchExtensionAction } from '@eforge-build/engine/extensions/action-runtime.js';
import { createExtensionRecorder } from '@eforge-build/engine/extensions/recorder.js';
import type { NativeExtensionRecorderState, NativeExtensionRegistry } from '@eforge-build/engine/extensions/types.js';
import eforgePlanExtension from '../index.js';
import { readBacklogItem, writeBacklogEpic, writeBacklogItem } from '../markdown-store.js';
import { createEmptyRecommendationModel, writeRecommendations } from '../recommendations-store.js';
import {
  createDraftPlanUnit,
  deleteDraftPlanUnit,
  findDraftPlanUnit,
  listDraftPlanUnits,
  markDraftPlanUnitPromoted,
  mergeDraftPlanUnits,
  readDraftPlanUnitIndex,
  resolveDraftPlanUnitIndexPath,
  splitDraftPlanUnit,
  updateDraftPlanUnit,
} from '../draft-plan-unit-store.js';

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-draft-units-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

function loadState(): NativeExtensionRecorderState {
  const { api, state } = createExtensionRecorder('eforge-plan', '/project/eforge/extensions/eforge-plan/index.ts');
  eforgePlanExtension(api as never);
  expect(state.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  return state;
}

function load(): NativeExtensionRegistry {
  return { ...loadState(), extensions: [], candidates: [] };
}

async function dispatch(cwd: string, actionId: string, input: unknown) {
  return dispatchExtensionAction(load(), { actionId: `eforge-plan:${actionId}`, input, requestedBy: { host: 'pi' }, cwd, timeoutMs: 2000 });
}

async function seedBacklog(cwd: string): Promise<void> {
  await writeBacklogEpic(cwd, { id: 'epic-one', status: 'planned', tags: [], body: '# Epic One\n' });
  await writeBacklogItem(cwd, { id: 'item-one', status: 'candidate', tags: [], depends_on: [], epic: 'epic-one', body: '# Item One\n\n## Claim\n\nFirst.\n\n## Acceptance Criteria\n\n- One done.\n' });
  await writeBacklogItem(cwd, { id: 'item-two', status: 'candidate', tags: [], depends_on: [], epic: 'epic-one', body: '# Item Two\n\n## Claim\n\nSecond.\n\n## Acceptance Criteria\n\n- Two done.\n' });
}

// item-two depends on item-one, so merging/splitting them exercises the
// dependency advisor's coupled-vs-independent paths.
async function seedBacklogWithDependency(cwd: string): Promise<void> {
  await writeBacklogEpic(cwd, { id: 'epic-one', status: 'planned', tags: [], body: '# Epic One\n' });
  await writeBacklogItem(cwd, { id: 'item-one', status: 'candidate', tags: [], depends_on: [], epic: 'epic-one', body: '# Item One\n\n## Claim\n\nFirst.\n\n## Acceptance Criteria\n\n- One done.\n' });
  await writeBacklogItem(cwd, { id: 'item-two', status: 'candidate', tags: [], depends_on: ['item-one'], epic: 'epic-one', body: '# Item Two\n\n## Claim\n\nSecond.\n\n## Acceptance Criteria\n\n- Two done.\n' });
}

async function seedLane(cwd: string): Promise<void> {
  await writeRecommendations(cwd, {
    ...createEmptyRecommendationModel(),
    safeParallelizableGroups: [{ ref: 'lane-a', title: 'Lane A', itemIds: ['item-one', 'item-two'], epicIds: ['epic-one'], safeToPlanTogether: true, rationale: 'Independent and ready.', recommendedProfile: 'excursion' }],
    rationaleAndAssumptions: ['Baseline.'],
  });
}

describe('draft plan unit store', () => {
  it('resolves the project-local extension-private draft-units index path and reads empty by default', async () => {
    await withTempProject(async (cwd) => {
      expect(resolveDraftPlanUnitIndexPath(cwd).endsWith(`${sep}.eforge${sep}storage${sep}extensions${sep}eforge-plan${sep}draft-units${sep}index.json`)).toBe(true);
      expect(await readDraftPlanUnitIndex(cwd)).toEqual({ schemaVersion: 1, units: [] });
    });
  });

  it('creates, lists newest-first, reads, and deletes draft units', async () => {
    await withTempProject(async (cwd) => {
      const older = await createDraftPlanUnit(cwd, { title: 'Older', provenance: 'user', items: [{ itemId: 'item-one', origin: 'user' }] }, '2026-01-01T00:00:00.000Z');
      const newer = await createDraftPlanUnit(cwd, { title: 'Newer', provenance: 'recommendation', sourceRecommendationRef: 'lane-a', profile: 'excursion', items: [{ itemId: 'item-two', origin: 'recommendation' }] }, '2026-01-02T00:00:00.000Z');

      const index = await readDraftPlanUnitIndex(cwd);
      expect(listDraftPlanUnits(index).map((unit) => unit.unitId)).toEqual([newer.unitId, older.unitId]);
      expect(findDraftPlanUnit(index, older.unitId)?.title).toBe('Older');
      expect(newer.status).toBe('draft');

      expect(await deleteDraftPlanUnit(cwd, older.unitId)).toBe(true);
      expect(await deleteDraftPlanUnit(cwd, older.unitId)).toBe(false);
      expect(listDraftPlanUnits(await readDraftPlanUnitIndex(cwd)).map((unit) => unit.unitId)).toEqual([newer.unitId]);
    });
  });

  it('adds, removes, reorders, and dedupes items and tracks per-item origin', async () => {
    await withTempProject(async (cwd) => {
      const unit = await createDraftPlanUnit(cwd, { title: 'Unit', provenance: 'recommendation', items: [{ itemId: 'a', origin: 'recommendation' }, { itemId: 'b', origin: 'recommendation' }] });
      const updated = await updateDraftPlanUnit(cwd, unit.unitId, {
        addItems: [{ itemId: 'c', origin: 'user' }, { itemId: 'b', origin: 'user' }],
        removeItemIds: ['a'],
        itemOrder: ['c', 'b'],
      });
      expect(updated.items).toEqual([{ itemId: 'c', origin: 'user' }, { itemId: 'b', origin: 'recommendation' }]);
    });
  });

  it('clears profile when patched with empty string and marks promoted', async () => {
    await withTempProject(async (cwd) => {
      const unit = await createDraftPlanUnit(cwd, { title: 'Unit', provenance: 'recommendation', profile: 'expedition', items: [{ itemId: 'a', origin: 'recommendation' }] });
      expect((await updateDraftPlanUnit(cwd, unit.unitId, { profile: '' })).profile).toBeUndefined();
      const promoted = await markDraftPlanUnitPromoted(cwd, unit.unitId, 'session-x');
      expect(promoted).toMatchObject({ status: 'promoted', promotedSession: 'session-x' });
    });
  });

  it('merges several units into one user-authored unit and removes the sources', async () => {
    await withTempProject(async (cwd) => {
      const a = await createDraftPlanUnit(cwd, { title: 'A', provenance: 'recommendation', sourceRecommendationRef: 'lane-a', profile: 'excursion', items: [{ itemId: 'a', origin: 'recommendation' }, { itemId: 'shared', origin: 'recommendation' }] });
      const b = await createDraftPlanUnit(cwd, { title: 'B', provenance: 'user', items: [{ itemId: 'shared', origin: 'user' }, { itemId: 'b', origin: 'user' }] });

      const { unit, removedUnitIds } = await mergeDraftPlanUnits(cwd, [a.unitId, b.unitId]);
      // Union, deduped with first-occurrence origin; provenance/title default to the first unit.
      expect(unit.items).toEqual([{ itemId: 'a', origin: 'recommendation' }, { itemId: 'shared', origin: 'recommendation' }, { itemId: 'b', origin: 'user' }]);
      expect(unit).toMatchObject({ title: 'A', provenance: 'user', profile: 'excursion' });
      expect(unit.sourceRecommendationRef).toBeUndefined();
      expect(removedUnitIds).toEqual([a.unitId, b.unitId]);
      expect(listDraftPlanUnits(await readDraftPlanUnitIndex(cwd)).map((entry) => entry.unitId)).toEqual([unit.unitId]);
    });
  });

  it('refuses to merge a promoted unit', async () => {
    await withTempProject(async (cwd) => {
      const a = await createDraftPlanUnit(cwd, { title: 'A', provenance: 'user', items: [{ itemId: 'a', origin: 'user' }] });
      const b = await createDraftPlanUnit(cwd, { title: 'B', provenance: 'user', items: [{ itemId: 'b', origin: 'user' }] });
      await markDraftPlanUnitPromoted(cwd, b.unitId, 'session-x');
      await expect(mergeDraftPlanUnits(cwd, [a.unitId, b.unitId])).rejects.toThrow(/already promoted/);
    });
  });

  it('splits a strict subset into a new unit while the original keeps the remainder', async () => {
    await withTempProject(async (cwd) => {
      const unit = await createDraftPlanUnit(cwd, { title: 'Whole', provenance: 'recommendation', items: [{ itemId: 'a', origin: 'recommendation' }, { itemId: 'b', origin: 'user' }, { itemId: 'c', origin: 'recommendation' }] });
      const { original, created } = await splitDraftPlanUnit(cwd, unit.unitId, ['b'], { title: 'Peeled' });
      expect(original.items).toEqual([{ itemId: 'a', origin: 'recommendation' }, { itemId: 'c', origin: 'recommendation' }]);
      expect(created).toMatchObject({ title: 'Peeled', provenance: 'user', items: [{ itemId: 'b', origin: 'user' }] });
      expect(listDraftPlanUnits(await readDraftPlanUnitIndex(cwd)).map((entry) => entry.unitId).sort()).toEqual([original.unitId, created.unitId].sort());
    });
  });

  it('refuses to split off every item or unknown items', async () => {
    await withTempProject(async (cwd) => {
      const unit = await createDraftPlanUnit(cwd, { title: 'Whole', provenance: 'user', items: [{ itemId: 'a', origin: 'user' }, { itemId: 'b', origin: 'user' }] });
      await expect(splitDraftPlanUnit(cwd, unit.unitId, ['a', 'b'], { title: 'All' })).rejects.toThrow(/leave draft plan unit/);
      await expect(splitDraftPlanUnit(cwd, unit.unitId, ['ghost'], { title: 'Ghost' })).rejects.toThrow(/not in draft plan unit/);
    });
  });

  it('throws on a present-but-invalid index rather than silently dropping stored data', async () => {
    await withTempProject(async (cwd) => {
      const path = resolveDraftPlanUnitIndexPath(cwd);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, 'not json', 'utf-8');
      await expect(readDraftPlanUnitIndex(cwd)).rejects.toThrow(/not valid JSON/);

      await writeFile(path, JSON.stringify({ schemaVersion: 1, units: [{ unitId: 'x' }] }), 'utf-8');
      await expect(readDraftPlanUnitIndex(cwd)).rejects.toThrow(/schema validation/);
      // A corrupt index must not be clobbered by a subsequent mutation.
      await expect(createDraftPlanUnit(cwd, { title: 'New', provenance: 'user', items: [] })).rejects.toThrow(/schema validation/);
    });
  });
});

describe('draft plan unit actions', () => {
  it('forks a recommendation lane into a recommendation-descended draft unit', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);
      await seedLane(cwd);
      const result = await dispatch(cwd, 'fork-recommendation-to-draft-unit', { recommendationRef: 'lane-a' });
      expect(result.kind).toBe('success');
      expect((result as { output: { unit: unknown } }).output.unit).toMatchObject({
        title: 'Lane A',
        provenance: 'recommendation',
        sourceRecommendationRef: 'lane-a',
        profile: 'excursion',
        items: [{ itemId: 'item-one', origin: 'recommendation' }, { itemId: 'item-two', origin: 'recommendation' }],
        status: 'draft',
      });
    });
  });

  it('rejects forking an unknown lane', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);
      await seedLane(cwd);
      const result = await dispatch(cwd, 'fork-recommendation-to-draft-unit', { recommendationRef: 'missing' });
      expect(result.kind).toBe('invalid-input');
    });
  });

  it('creates a user unit, adds an item, and rejects unknown items', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);
      const created = await dispatch(cwd, 'create-draft-unit', { title: 'Hand-picked', itemIds: ['item-one'] });
      expect(created.kind).toBe('success');
      const unitId = (created as { output: { unit: { unitId: string } } }).output.unit.unitId;

      const added = await dispatch(cwd, 'update-draft-unit', { unitId, addItemIds: ['item-two'] });
      expect((added as { output: { unit: { items: unknown[] } } }).output.unit.items).toEqual([
        { itemId: 'item-one', origin: 'user' },
        { itemId: 'item-two', origin: 'user' },
      ]);

      const bad = await dispatch(cwd, 'update-draft-unit', { unitId, addItemIds: ['ghost'] });
      expect(bad.kind).toBe('invalid-input');
    });
  });

  it('lists, gets, and deletes draft units through the action surface', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);
      const created = await dispatch(cwd, 'create-draft-unit', { title: 'Hand-picked', itemIds: ['item-one'] });
      const unitId = (created as { output: { unit: { unitId: string } } }).output.unit.unitId;

      const listed = await dispatch(cwd, 'list-draft-units', {});
      expect(listed.kind).toBe('success');
      expect((listed as { output: { units: { unitId: string }[]; total: number; limit: number; offset: number } }).output).toMatchObject({ total: 1, limit: 50, offset: 0 });
      expect((listed as { output: { units: { unitId: string }[] } }).output.units.map((unit) => unit.unitId)).toEqual([unitId]);
      expect((listed as { output: { units: Array<Record<string, unknown>> } }).output.units[0]).toMatchObject({ unitId, title: 'Hand-picked', provenance: 'user', itemIds: ['item-one'], itemCount: 1, status: 'draft' });
      expect((listed as { output: { units: Array<Record<string, unknown>> } }).output.units[0]).not.toHaveProperty('intent');
      expect((listed as { output: { units: Array<Record<string, unknown>> } }).output.units[0]).not.toHaveProperty('items');

      const got = await dispatch(cwd, 'get-draft-unit', { unitId });
      expect((got as { output: { unit: { title: string; items: unknown[] } } }).output.unit.title).toBe('Hand-picked');
      expect((got as { output: { unit: { items: unknown[] } } }).output.unit.items).toEqual([{ itemId: 'item-one', origin: 'user' }]);
      expect((await dispatch(cwd, 'get-draft-unit', { unitId: 'ghost' })).kind).toBe('invalid-input');

      const deleted = await dispatch(cwd, 'delete-draft-unit', { unitId });
      expect((deleted as { output: { deleted: boolean } }).output.deleted).toBe(true);
      expect((await dispatch(cwd, 'delete-draft-unit', { unitId })).kind).toBe('success');
      expect((await dispatch(cwd, 'delete-draft-unit', { unitId }) as { output: { deleted: boolean } }).output.deleted).toBe(false);
      expect((await dispatch(cwd, 'list-draft-units', {}) as { output: { units: unknown[] } }).output.units).toEqual([]);
    });
  });

  it('preserves compact identity and promotion metadata for recommendation-derived draft units', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);
      await seedLane(cwd);
      const forked = await dispatch(cwd, 'fork-recommendation-to-draft-unit', { recommendationRef: 'lane-a' });
      const unitId = (forked as { output: { unit: { unitId: string } } }).output.unit.unitId;
      const promoted = await dispatch(cwd, 'promote-draft-unit', { unitId, session: 'lane-a-session' });
      expect(promoted.kind).toBe('success');

      const listed = await dispatch(cwd, 'list-draft-units', {});
      expect(listed.kind).toBe('success');
      const row = (listed as { output: { units: Array<Record<string, unknown>> } }).output.units[0];
      expect(row).toMatchObject({
        unitId,
        sourceRecommendationRef: 'lane-a',
        profile: 'excursion',
        status: 'promoted',
        promotedSession: 'lane-a-session',
        promotedAt: expect.any(String),
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        itemIds: ['item-one', 'item-two'],
        itemCount: 2,
      });
      expect(row).not.toHaveProperty('intent');
      expect(row).not.toHaveProperty('items');
    });
  });

  it('paginates draft unit list rows newest-first while preserving full detail reads', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);
      await createDraftPlanUnit(cwd, { title: 'Oldest', intent: 'full intent one', provenance: 'user', items: [{ itemId: 'item-one', origin: 'user' }] }, '2026-01-01T00:00:00.000Z');
      const second = await createDraftPlanUnit(cwd, { title: 'Second newest', intent: 'full intent two', provenance: 'user', items: [{ itemId: 'item-two', origin: 'user' }] }, '2026-01-02T00:00:00.000Z');
      await createDraftPlanUnit(cwd, { title: 'Newest', provenance: 'user', items: [{ itemId: 'item-one', origin: 'user' }, { itemId: 'item-two', origin: 'user' }] }, '2026-01-03T00:00:00.000Z');
      const secondUnitId = second.unitId;

      const listed = await dispatch(cwd, 'list-draft-units', { limit: 1, offset: 1 });
      expect(listed.kind).toBe('success');
      const output = (listed as { output: { units: Array<Record<string, unknown>>; total: number; limit: number; offset: number } }).output;
      expect(output).toMatchObject({ total: 3, limit: 1, offset: 1 });
      expect(output.units).toHaveLength(1);
      expect(output.units[0]).toMatchObject({ unitId: secondUnitId, title: 'Second newest', itemCount: 1, itemIds: ['item-two'] });
      expect(output.units[0]).not.toHaveProperty('intent');
      expect(output.units[0]).not.toHaveProperty('items');

      const got = await dispatch(cwd, 'get-draft-unit', { unitId: secondUnitId });
      expect((got as { output: { unit: { intent?: string } } }).output.unit.intent).toBe('full intent two');
    });
  });

  it('clears the profile through update-draft-unit with an empty string', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);
      const created = await dispatch(cwd, 'create-draft-unit', { title: 'Profiled', profile: 'expedition', itemIds: ['item-one'] });
      const unitId = (created as { output: { unit: { unitId: string } } }).output.unit.unitId;
      const cleared = await dispatch(cwd, 'update-draft-unit', { unitId, profile: '' });
      expect(cleared.kind).toBe('success');
      expect((cleared as { output: { unit: { profile?: string } } }).output.unit.profile).toBeUndefined();
    });
  });

  it('rejects promoting a draft unit that has no items', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);
      const created = await dispatch(cwd, 'create-draft-unit', { title: 'Empty', itemIds: [] });
      const unitId = (created as { output: { unit: { unitId: string } } }).output.unit.unitId;
      const promoted = await dispatch(cwd, 'promote-draft-unit', { unitId });
      expect(promoted.kind).toBe('invalid-input');
    });
  });

  it('promotes a draft unit plan-first into one session plan and marks it promoted', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);
      await seedLane(cwd);
      const forked = await dispatch(cwd, 'fork-recommendation-to-draft-unit', { recommendationRef: 'lane-a' });
      const unitId = (forked as { output: { unit: { unitId: string } } }).output.unit.unitId;

      const promoted = await dispatch(cwd, 'promote-draft-unit', { unitId, session: 'lane-a-session' });
      expect(promoted.kind).toBe('success');
      const output = (promoted as { output: { unit: { status: string; promotedSession?: string }; promotion: { session: string; itemIds: string[] } } }).output;
      expect(output.unit).toMatchObject({ status: 'promoted', promotedSession: 'lane-a-session' });
      expect(output.promotion.itemIds).toEqual(['item-one', 'item-two']);
      expect(existsSync(join(cwd, '.eforge', 'session-plans', 'lane-a-session.md'))).toBe(true);
      expect((await readBacklogItem(cwd, 'item-one'))?.status).toBe('active');

      const again = await dispatch(cwd, 'promote-draft-unit', { unitId, session: 'second-attempt' });
      expect(again.kind).toBe('invalid-input');
    });
  });

  it('merges two units through the action surface and returns a justified-by-dependency advisory', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklogWithDependency(cwd);
      const a = (await dispatch(cwd, 'create-draft-unit', { title: 'A', itemIds: ['item-one'] }) as { output: { unit: { unitId: string } } }).output.unit.unitId;
      const b = (await dispatch(cwd, 'create-draft-unit', { title: 'B', itemIds: ['item-two'] }) as { output: { unit: { unitId: string } } }).output.unit.unitId;

      const merged = await dispatch(cwd, 'merge-draft-units', { unitIds: [a, b] });
      expect(merged.kind).toBe('success');
      const output = (merged as { output: { unit: { items: { itemId: string }[] }; removedUnitIds: string[]; advisory: { severity: string; findings: { code: string }[] } } }).output;
      expect(output.unit.items.map((item) => item.itemId)).toEqual(['item-one', 'item-two']);
      expect(output.removedUnitIds).toEqual([a, b]);
      // item-two depends on item-one, so the merge is justified.
      expect(output.advisory.severity).toBe('ok');
      expect(output.advisory.findings[0].code).toBe('merge-justified-by-dependency');
    });
  });

  it('splits a unit through the action surface and cautions when a dependency is separated', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklogWithDependency(cwd);
      const unitId = (await dispatch(cwd, 'create-draft-unit', { title: 'Both', itemIds: ['item-one', 'item-two'] }) as { output: { unit: { unitId: string } } }).output.unit.unitId;

      const split = await dispatch(cwd, 'split-draft-unit', { unitId, itemIds: ['item-two'], title: 'Peeled' });
      expect(split.kind).toBe('success');
      const output = (split as { output: { original: { items: { itemId: string }[] }; created: { title: string }; advisory: { severity: string; findings: { code: string }[] } } }).output;
      expect(output.original.items.map((item) => item.itemId)).toEqual(['item-one']);
      expect(output.created.title).toBe('Peeled');
      // Separating item-two (depends on item-one) from item-one crosses the edge.
      expect(output.advisory.severity).toBe('caution');
      expect(output.advisory.findings[0].code).toBe('split-crosses-dependency');
    });
  });

  it('previews merge and split advisories without mutating, and rejects promoted/invalid inputs', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklogWithDependency(cwd);
      const a = (await dispatch(cwd, 'create-draft-unit', { title: 'A', itemIds: ['item-one'] }) as { output: { unit: { unitId: string } } }).output.unit.unitId;
      const b = (await dispatch(cwd, 'create-draft-unit', { title: 'B', itemIds: ['item-two'] }) as { output: { unit: { unitId: string } } }).output.unit.unitId;

      const advise = await dispatch(cwd, 'advise-merge-draft-units', { unitIds: [a, b] });
      expect(advise.kind).toBe('success');
      expect((advise as { output: { advisory: { severity: string } } }).output.advisory.severity).toBe('ok');
      // Preview did not consume the units.
      expect((await dispatch(cwd, 'list-draft-units', {}) as { output: { units: unknown[] } }).output.units).toHaveLength(2);

      const both = (await dispatch(cwd, 'create-draft-unit', { title: 'Both', itemIds: ['item-one', 'item-two'] }) as { output: { unit: { unitId: string } } }).output.unit.unitId;
      const adviseSplitResult = await dispatch(cwd, 'advise-split-draft-unit', { unitId: both, itemIds: ['item-two'] });
      expect((adviseSplitResult as { output: { advisory: { severity: string } } }).output.advisory.severity).toBe('caution');

      await markDraftPlanUnitPromoted(cwd, a, 'session-x');
      expect((await dispatch(cwd, 'advise-merge-draft-units', { unitIds: [a, b] })).kind).toBe('invalid-input');
      expect((await dispatch(cwd, 'merge-draft-units', { unitIds: [a, b] })).kind).toBe('invalid-input');
    });
  });
});
