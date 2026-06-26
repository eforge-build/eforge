import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dispatchExtensionAction } from '@eforge-build/engine/extensions/action-runtime.js';
import { createExtensionRecorder } from '@eforge-build/engine/extensions/recorder.js';
import eforgePlanExtension from '../index.js';
import { captureCanonicalBacklogItem, listCanonicalBacklogItems, readCanonicalBacklogItem, upsertCanonicalEpic } from '../canonical/backlog-records.js';

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-epic-reference-validation-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

function loadRegistry(cwd: string) {
  const { api, state } = createExtensionRecorder('eforge-plan', join(cwd, 'eforge/extensions/eforge-plan/index.ts'));
  eforgePlanExtension(api as never);
  return { ...state, extensions: [], candidates: [] };
}

async function dispatch(cwd: string, actionId: 'capture-item' | 'update-item', input: Record<string, unknown>) {
  return dispatchExtensionAction(loadRegistry(cwd), {
    actionId: `eforge-plan:${actionId}`,
    input,
    requestedBy: { host: 'pi' },
    cwd,
    timeoutMs: 1000,
  });
}

const captureInput = {
  title: 'Add direct epic reference validation',
  claim: 'Validate direct backlog epic references before writing canonical items.',
  acceptanceCriteria: 'Invalid direct epic references are rejected and valid or omitted references preserve the intended canonical item state.',
};

function expectInvalidEpicMessage(message: unknown, epicId: string): void {
  const text = String(message);
  expect(text).toContain(epicId);
  expect(text).toContain('get-epic');
  expect(text).toContain('search-items');
  expect(text).toContain('includeEpics');
  expect(text).toContain('upsert-epic');
}

async function writeLegacyItemWithEpic(cwd: string, id: string, epic: string): Promise<void> {
  const dir = join(cwd, '.backlog', 'items');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}.md`), `---\nid: ${id}\nstatus: candidate\npriority: low\nepic: ${epic}\nupdated: 2026-01-01T00:00:00.000Z\ntags:\n  - legacy\n---\n# Legacy unresolved epic item\n\n## Claim\n\nLegacy claim.\n`);
}

describe('direct backlog epic reference validation', () => {
  it('rejects capture-item with a nonexistent non-empty epic id and writes no canonical item', async () => {
    await withTempProject(async (cwd) => {
      const result = await dispatch(cwd, 'capture-item', { ...captureInput, epic: 'missing-epic' });

      expect(result.kind).toBe('invalid-input');
      expectInvalidEpicMessage(result.message, 'missing-epic');
      expect(result.validationErrors).toEqual([expect.objectContaining({ path: 'epic' })]);
      expect(listCanonicalBacklogItems(cwd)).toEqual([]);
    });
  });

  it('rejects update-item with a nonexistent non-empty epic id without mutating the target item', async () => {
    await withTempProject(async (cwd) => {
      upsertCanonicalEpic(cwd, { id: 'existing-epic', title: 'Existing Epic' });
      captureCanonicalBacklogItem(cwd, {
        id: 'target-item',
        title: 'Target Item',
        status: 'planned',
        priority: 'high',
        tags: ['stable'],
        epic: 'existing-epic',
        created: '2026-01-01T00:00:00.000Z',
        updated: '2026-01-02T00:00:00.000Z',
        body: '# Target Item\n',
      });
      const before = readCanonicalBacklogItem(cwd, 'target-item');

      const result = await dispatch(cwd, 'update-item', { id: 'target-item', priority: 'low', tags: ['changed'], epic: 'missing-epic' });

      expect(result.kind).toBe('invalid-input');
      expectInvalidEpicMessage(result.message, 'missing-epic');
      expect(result.validationErrors).toEqual([expect.objectContaining({ path: 'epic' })]);
      const after = readCanonicalBacklogItem(cwd, 'target-item');
      expect(after).toMatchObject({
        priority: before?.priority,
        userStatus: before?.userStatus,
        epicRef: before?.epicRef,
        updatedAt: before?.updatedAt,
      });
      expect(after?.frontmatter.tags).toEqual(before?.frontmatter.tags);
    });
  });

  it('allows capture-item with omitted or valid existing epic references', async () => {
    await withTempProject(async (cwd) => {
      const omitted = await dispatch(cwd, 'capture-item', { id: 'no-epic-item', ...captureInput });
      expect(omitted.kind).toBe('success');
      expect(readCanonicalBacklogItem(cwd, 'no-epic-item')?.epicRef).toBeUndefined();

      upsertCanonicalEpic(cwd, { id: 'existing-epic', title: 'Existing Epic' });
      const valid = await dispatch(cwd, 'capture-item', { id: 'valid-epic-item', ...captureInput, epic: 'existing-epic' });
      expect(valid.kind).toBe('success');
      expect(readCanonicalBacklogItem(cwd, 'valid-epic-item')?.epicRef).toBe('existing-epic');
    });
  });

  it('updates epic references only when explicitly supplied and supports explicit empty-string clearing', async () => {
    await withTempProject(async (cwd) => {
      upsertCanonicalEpic(cwd, { id: 'epic-one', title: 'Epic One' });
      upsertCanonicalEpic(cwd, { id: 'epic-two', title: 'Epic Two' });
      captureCanonicalBacklogItem(cwd, { id: 'target-item', title: 'Target Item', status: 'candidate', priority: 'low', epic: 'epic-one', body: '# Target Item\n' });

      const omitted = await dispatch(cwd, 'update-item', { id: 'target-item', priority: 'medium' });
      expect(omitted.kind).toBe('success');
      expect(readCanonicalBacklogItem(cwd, 'target-item')).toMatchObject({ priority: 'medium', epicRef: 'epic-one' });

      const valid = await dispatch(cwd, 'update-item', { id: 'target-item', epic: 'epic-two' });
      expect(valid.kind).toBe('success');
      expect(readCanonicalBacklogItem(cwd, 'target-item')?.epicRef).toBe('epic-two');

      const cleared = await dispatch(cwd, 'update-item', { id: 'target-item', epic: '' });
      expect(cleared.kind).toBe('success');
      expect(readCanonicalBacklogItem(cwd, 'target-item')?.epicRef).toBeUndefined();
    });
  });

  it('preserves unresolved legacy epic references when update-item omits epic during migration', async () => {
    await withTempProject(async (cwd) => {
      await writeLegacyItemWithEpic(cwd, 'legacy-item', 'legacy-missing-epic');

      const result = await dispatch(cwd, 'update-item', { id: 'legacy-item', priority: 'high' });

      expect(result.kind).toBe('success');
      expect(readCanonicalBacklogItem(cwd, 'legacy-item')).toMatchObject({ priority: 'high', epicRef: 'legacy-missing-epic' });
    });
  });
});
