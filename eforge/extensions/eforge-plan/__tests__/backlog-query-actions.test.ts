import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dispatchExtensionAction } from '@eforge-build/engine/extensions/action-runtime.js';
import { createExtensionRecorder } from '@eforge-build/engine/extensions/recorder.js';
import type { NativeExtensionRecorderState, NativeExtensionRegistry } from '@eforge-build/engine/extensions/types.js';
import eforgePlanExtension from '../index.js';
import { writeBacklogEpic, writeBacklogItem } from '../markdown-store.js';
import { createTraceSidecar, writeTraceSidecar } from '../trace-store.js';

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-query-actions-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

function registry(): NativeExtensionRegistry {
  const { api, state } = createExtensionRecorder('eforge-plan', '/project/eforge/extensions/eforge-plan/index.ts');
  eforgePlanExtension(api as never);
  expect(state.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  return { ...(state as NativeExtensionRecorderState), extensions: [], candidates: [] };
}

async function invoke(cwd: string, actionId: string, input: Record<string, unknown>) {
  const result = await dispatchExtensionAction(registry(), { actionId: `eforge-plan:${actionId}`, input, requestedBy: { host: 'pi' }, cwd, timeoutMs: 1000 });
  expect(result).toMatchObject({ kind: 'success' });
  if (result.kind !== 'success') throw new Error(result.message);
  return result.output as Record<string, unknown>;
}

describe('eforge-plan compact backlog query actions', () => {
  it('reads one item detail without board-wide payloads', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);
      const trace = createTraceSidecar('child', 'epic-one');
      trace.promotedSessionPlans.push({ session: 'child-session', status: 'failed', path: '.eforge/session-plans/child-session.md' });
      trace.queuePrds.push({ prdId: 'child-prd', status: 'failed', path: '.eforge/queue/child-prd.md' });
      await writeTraceSidecar(cwd, trace);

      const output = await invoke(cwd, 'get-item', { id: 'child' });

      expect(output.schemaVersion).toBe(1);
      expect(output.item).toMatchObject({ id: 'child', title: 'Child Item', lane: 'blocked', dependsOn: ['dep'], unresolvedDependsOn: ['dep'] });
      expect(output.epic).toMatchObject({ id: 'epic-one', itemCount: 5, openItemCount: 2 });
      expect(output.dependencies).toEqual([expect.objectContaining({ id: 'dep', title: 'Dependency Item' })]);
      expect(output.dependents).toEqual([]);
      expect(output.item).toMatchObject({
        linkRows: expect.arrayContaining([expect.objectContaining({ kind: 'session-plan', session: 'child-session', status: 'failed' })]),
        failureEvidence: expect.arrayContaining([expect.objectContaining({ kind: 'session-plan', session: 'child-session', status: 'failed' })]),
      });
      expect(JSON.stringify(output)).toContain('Child claim.');
      expect(JSON.stringify(output)).not.toContain('Dependency claim.');
    });
  });

  it('searches and pages compact item summaries', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);

      const output = await invoke(cwd, 'search-items', { query: 'child', limit: 1 });

      expect(output).toMatchObject({ total: 1, limit: 1, offset: 0 });
      expect(output.items).toEqual([expect.objectContaining({ id: 'child', title: 'Child Item' })]);
    });
  });

  it('lists a default compact board page open-first while reporting closed lane counts', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);

      const output = await invoke(cwd, 'list-board-compact', { epic: 'epic-one', includeArchive: false, limit: 2 });

      expect(output).toMatchObject({ total: 2, limit: 2, offset: 0, counts: { total: 4, open: 2, closed: 2 } });
      expect(output.items).toEqual([
        expect.objectContaining({ id: 'child' }),
        expect.objectContaining({ id: 'dep' }),
      ]);
      expect(output.items).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'done' })]));
      expect(output.lanes).toEqual(expect.arrayContaining([
        expect.objectContaining({ lane: 'blocked', count: 1, openCount: 1, closedCount: 0 }),
        expect.objectContaining({ lane: 'ready', count: 1, openCount: 1, closedCount: 0 }),
        expect.objectContaining({ lane: 'done', count: 2, openCount: 0, closedCount: 2 }),
      ]));
      expect(output.epics).toEqual([expect.objectContaining({ id: 'epic-one', itemCount: 5, openItemCount: 2 })]);
      expect(JSON.stringify(output)).not.toContain('Child claim.');
    });
  });

  it('flags epics with authored body content via hasBody so standalone horizon epics stay discoverable', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);
      // A heading-only epic is the writeBacklogEpic default - no authored content.
      await writeBacklogEpic(cwd, { id: 'empty-shell', status: 'candidate', body: '# Empty Shell\n' });
      // An item-less epic with a real section is a parked horizon idea.
      await writeBacklogEpic(cwd, { id: 'horizon-note', status: 'candidate', body: '# Horizon Note\n\n## Summary\n\nA future idea.\n' });

      const output = await invoke(cwd, 'list-board-compact', { includeClosed: true, limit: 100 });
      const byId = new Map((output.epics as Array<{ id: string; hasBody: boolean }>).map((epic) => [epic.id, epic]));

      expect(byId.get('epic-one')?.hasBody).toBe(true);
      expect(byId.get('horizon-note')).toMatchObject({ itemCount: 0, openItemCount: 0, hasBody: true });
      expect(byId.get('empty-shell')).toMatchObject({ itemCount: 0, openItemCount: 0, hasBody: false });
    });
  });

  it('omits archived cards by default', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);

      const output = await invoke(cwd, 'list-board-compact', { epic: 'epic-one', limit: 50 });

      expect(output).toMatchObject({ total: 2, counts: { total: 4, open: 2, closed: 2 } });
      expect(output.items).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'archived' })]));
      expect(output.lanes).not.toEqual(expect.arrayContaining([expect.objectContaining({ lane: 'archive' })]));
    });
  });

  it('lists workstation initial compact page without archived cards while preserving archive metadata', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);

      const output = await invoke(cwd, 'list-board-compact', { epic: 'epic-one', includeArchive: true, limit: 50 });

      expect(output).toMatchObject({ total: 2, limit: 50, offset: 0, counts: { total: 5, open: 2, closed: 3 } });
      expect(output.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'child' }),
        expect.objectContaining({ id: 'dep' }),
      ]));
      expect(output.items).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'done' }),
        expect.objectContaining({ id: 'done-two' }),
        expect.objectContaining({ id: 'archived' }),
      ]));
      expect(output.lanes).toEqual(expect.arrayContaining([
        expect.objectContaining({ lane: 'archive', count: 1, openCount: 0, closedCount: 1 }),
      ]));
    });
  });

  it('loads explicit closed lane pages through compact board inputs', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);

      const hiddenDone = await invoke(cwd, 'list-board-compact', { lane: 'done', limit: 1, offset: 0 });
      expect(hiddenDone).toMatchObject({ total: 0, limit: 1, offset: 0, pagination: expect.objectContaining({ returned: 0, hasMore: false }) });
      expect(hiddenDone.items).toEqual([]);
      expect(hiddenDone.lanes).toEqual(expect.arrayContaining([
        expect.objectContaining({ lane: 'done', pagination: expect.objectContaining({ returned: 0, hasMore: false }) }),
      ]));

      const output = await invoke(cwd, 'list-board-compact', { lane: 'done', includeClosed: true, limit: 1, offset: 0 });

      expect(output).toMatchObject({ total: 2, limit: 1, offset: 0, pagination: expect.objectContaining({ hasMore: true, nextOffset: 1 }) });
      expect(output.items).toEqual([expect.objectContaining({ id: 'done', closed: true, lane: 'done' })]);
      expect(output.lanes).toEqual(expect.arrayContaining([
        expect.objectContaining({ lane: 'done', pagination: expect.objectContaining({ returned: 1, hasMore: true, nextOffset: 1 }) }),
      ]));

      const second = await invoke(cwd, 'list-board-compact', { lane: 'done', includeClosed: true, limit: 1, offset: 1 });
      expect(second).toMatchObject({ total: 2, limit: 1, offset: 1, pagination: expect.objectContaining({ hasMore: false }) });
      expect(second.items).toEqual([expect.objectContaining({ id: 'done-two', closed: true, lane: 'done' })]);

      const archive = await invoke(cwd, 'list-board-compact', { lane: 'archive', includeClosed: true, includeArchive: true, limit: 1, offset: 0 });
      expect(archive).toMatchObject({ total: 1, limit: 1, offset: 0 });
      expect(archive.items).toEqual([expect.objectContaining({ id: 'archived', closed: true, lane: 'archive' })]);
    });
  });

  it('applies get-item projection controls without changing body opt-in behavior', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);

      const projected = await invoke(cwd, 'get-item', {
        id: 'child',
        includeEpic: false,
        includeSections: false,
        includeLifecycleRows: false,
        includeDependencies: false,
        includeDependents: false,
      });

      expect(projected.item).toMatchObject({ id: 'child' });
      expect(projected).not.toHaveProperty('epic');
      expect(projected).not.toHaveProperty('dependencies');
      expect(projected).not.toHaveProperty('dependents');
      expect(projected.item).not.toHaveProperty('dependsOn');
      expect(projected.item).not.toHaveProperty('unresolvedDependsOn');
      expect(projected.item).not.toHaveProperty('sections');
      expect(projected.item).not.toHaveProperty('linkRows');
      expect(projected.item).not.toHaveProperty('failureEvidence');
      expect(JSON.stringify(projected)).not.toContain('Child claim.');

      const withBody = await invoke(cwd, 'get-item', { id: 'child', includeBody: true });
      expect((withBody.item as { body?: string }).body).toContain('Child claim.');
      expect(JSON.stringify(withBody)).not.toContain('Dependency claim.');
    });
  });

  it('omits dependency id arrays from dependent summaries when requested', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);

      const projected = await invoke(cwd, 'get-item', { id: 'dep', includeDependencies: false });

      expect(projected).not.toHaveProperty('dependencies');
      expect(projected.dependents).toEqual([expect.objectContaining({ id: 'child' })]);
      expect(projected.dependents).toEqual([expect.not.objectContaining({ dependsOn: expect.any(Array) })]);
      expect(projected.dependents).toEqual([expect.not.objectContaining({ unresolvedDependsOn: expect.any(Array) })]);
    });
  });

  it('applies get-epic section and item projection controls', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);

      const noSections = await invoke(cwd, 'get-epic', { id: 'epic-one', includeSections: false });
      expect(noSections.epic).not.toHaveProperty('sections');
      expect(JSON.stringify(noSections)).not.toContain('Deliver compact reads.');

      const noItems = await invoke(cwd, 'get-epic', { id: 'epic-one', includeItems: false });
      expect(noItems).toMatchObject({ items: [], totalItems: 0 });
    });
  });

  it('applies search and compact board projection controls', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);

      const search = await invoke(cwd, 'search-items', { query: 'child', includeEpics: true, includeDependencies: false });
      expect(search.epics).toEqual([expect.objectContaining({ id: 'epic-one' })]);
      expect(search.items).toEqual([expect.not.objectContaining({ dependsOn: expect.any(Array) })]);

      const board = await invoke(cwd, 'list-board-compact', { epic: 'epic-one', includeEpics: false, includeLaneCounts: false, includeDependencies: false });
      expect(board).not.toHaveProperty('epics');
      expect(board).not.toHaveProperty('lanes');
      expect(board).not.toHaveProperty('counts');
      expect(board.items).toEqual(expect.arrayContaining([expect.not.objectContaining({ dependsOn: expect.any(Array) })]));
      expect(JSON.stringify(board)).not.toContain('Child claim.');
    });
  });

  it('reads an epic detail with paged compact item summaries', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);

      const output = await invoke(cwd, 'get-epic', { id: 'epic-one', limit: 1, offset: 2 });

      expect(output.epic).toMatchObject({ id: 'epic-one', title: 'Epic One', itemCount: 5, openItemCount: 2 });
      expect(output).toMatchObject({ totalItems: 5, limit: 1, offset: 2 });
      expect(output.items).toEqual([expect.objectContaining({ id: 'dep' })]);
    });
  });
});

async function seedBacklog(cwd: string): Promise<void> {
  await writeBacklogEpic(cwd, { id: 'epic-one', status: 'planned', body: '# Epic One\n\n## Goal\n\nDeliver compact reads.\n' });
  await writeBacklogItem(cwd, { id: 'child', status: 'planned', epic: 'epic-one', depends_on: ['dep'], body: '# Child Item\n\n## Claim\n\nChild claim.\n' });
  await writeBacklogItem(cwd, { id: 'dep', status: 'planned', epic: 'epic-one', body: '# Dependency Item\n\n## Claim\n\nDependency claim.\n' });
  await writeBacklogItem(cwd, { id: 'done', status: 'shipped', epic: 'epic-one', body: '# Done Item\n\n## Claim\n\nDone claim.\n' });
  await writeBacklogItem(cwd, { id: 'done-two', status: 'shipped', epic: 'epic-one', body: '# Done Two\n\n## Claim\n\nDone two claim.\n' });
  await writeBacklogItem(cwd, { id: 'archived', status: 'stale', epic: 'epic-one', body: '# Archived Item\n\n## Claim\n\nArchived claim.\n' });
}
