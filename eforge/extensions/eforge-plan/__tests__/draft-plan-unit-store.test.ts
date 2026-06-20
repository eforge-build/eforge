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
  readDraftPlanUnitIndex,
  resolveDraftPlanUnitIndexPath,
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
      expect((listed as { output: { units: { unitId: string }[] } }).output.units.map((unit) => unit.unitId)).toEqual([unitId]);

      const got = await dispatch(cwd, 'get-draft-unit', { unitId });
      expect((got as { output: { unit: { title: string } } }).output.unit.title).toBe('Hand-picked');
      expect((await dispatch(cwd, 'get-draft-unit', { unitId: 'ghost' })).kind).toBe('invalid-input');

      const deleted = await dispatch(cwd, 'delete-draft-unit', { unitId });
      expect((deleted as { output: { deleted: boolean } }).output.deleted).toBe(true);
      expect((await dispatch(cwd, 'delete-draft-unit', { unitId })).kind).toBe('success');
      expect((await dispatch(cwd, 'delete-draft-unit', { unitId }) as { output: { deleted: boolean } }).output.deleted).toBe(false);
      expect((await dispatch(cwd, 'list-draft-units', {}) as { output: { units: unknown[] } }).output.units).toEqual([]);
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
});
