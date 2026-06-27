import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { dispatchExtensionAction } from '@eforge-build/engine/extensions/action-runtime.js';
import { createExtensionRecorder } from '@eforge-build/engine/extensions/recorder.js';
import type { NativeExtensionRecorderState, NativeExtensionRegistry } from '@eforge-build/engine/extensions/types.js';
import eforgePlanExtension from '../index.js';
import { captureCanonicalBacklogItem, readCanonicalBacklogItem, upsertCanonicalEpic } from '../canonical/backlog-records.js';
import { writeCanonicalRecommendations } from '../canonical/recommendation-records.js';
import { resolveBacklogItemPath, resolveLegacyBacklogItemPath } from '../markdown-store.js';
import { openEforgePlanStore } from '../sqlite/index.js';
import type { BacklogRecommendationModel } from '../schema.js';

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-update-item-body-safe-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

function registry(cwd: string): NativeExtensionRegistry {
  const { api, state } = createExtensionRecorder('eforge-plan', join(cwd, 'eforge/extensions/eforge-plan/index.ts'));
  eforgePlanExtension(api as never);
  expect(state.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  return { ...(state as NativeExtensionRecorderState), extensions: [], candidates: [] };
}

async function dispatch(cwd: string, actionId: 'get-item' | 'update-item', input: Record<string, unknown>) {
  return dispatchExtensionAction(registry(cwd), {
    actionId: `eforge-plan:${actionId}`,
    input,
    requestedBy: { host: 'pi' },
    cwd,
    timeoutMs: 1000,
  });
}

async function invoke(cwd: string, actionId: 'get-item' | 'update-item', input: Record<string, unknown>) {
  const result = await dispatch(cwd, actionId, input);
  expect(result).toMatchObject({ kind: 'success' });
  if (result.kind !== 'success') throw new Error(result.message);
  return result.output as Record<string, unknown>;
}

function db(cwd: string): DatabaseSync {
  const store = openEforgePlanStore(cwd);
  const handle = new DatabaseSync(store.path);
  store.close();
  return handle;
}

function seedBodySafeItem(cwd: string): void {
  upsertCanonicalEpic(cwd, { id: 'epic-one', title: 'Epic One' });
  upsertCanonicalEpic(cwd, { id: 'epic-two', title: 'Epic Two' });
  captureCanonicalBacklogItem(cwd, { id: 'dep-one', title: 'Dependency One', status: 'candidate', body: '# Dependency One\n\n## Claim\n\nDependency claim.\n' });
  captureCanonicalBacklogItem(cwd, {
    id: 'target-item',
    title: 'Old Title',
    status: 'candidate',
    priority: 'p1',
    tags: ['old'],
    dependsOn: ['dep-one'],
    epic: 'epic-one',
    body: [
      '# Old Title',
      '',
      '## Claim',
      '',
      'Old claim.',
      '',
      '## Evidence',
      '',
      'Old evidence.',
      '',
      '## Acceptance Criteria',
      '',
      '- Old criterion.',
      '',
      '## Custom Links',
      '',
      'Keep this exact custom block.',
      '',
      '## Recheck',
      '',
      'Old recheck.',
      '',
      '## Notes',
      '',
      'Old notes.',
      '',
    ].join('\n'),
    sections: [
      { sectionName: 'Claim', content: 'Old claim.' },
      { sectionName: 'Evidence', content: 'Old evidence.' },
      { sectionName: 'Acceptance Criteria', content: '- Old criterion.' },
      { sectionName: 'Custom Links', content: 'Keep this exact custom block.' },
      { sectionName: 'Recheck', content: 'Old recheck.' },
      { sectionName: 'Notes', content: 'Old notes.' },
    ],
  });
}

function recommendationModel(): BacklogRecommendationModel {
  return {
    schemaVersion: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    activeWork: [],
    readyCandidates: [{ itemId: 'target-item', rationale: 'Ready.' }],
    recommendedNextSequence: [{ itemId: 'target-item', ref: 'rec-target' }],
    safeParallelizableGroups: [],
    blockedChains: [],
    rationaleAndAssumptions: ['Seeded for invalidation.'],
  };
}

describe('eforge-plan update-item body-safe action', () => {
  it('updates title and structured sections with an expected body hash and returns versioned storage data', async () => {
    await withTempProject(async (cwd) => {
      seedBodySafeItem(cwd);
      const before = await invoke(cwd, 'get-item', { id: 'target-item', includeBody: true, includeSections: true });
      const beforeItem = before.item as Record<string, unknown>;

      const output = await invoke(cwd, 'update-item', {
        id: 'target-item',
        title: 'New Title',
        expectedBodySha256: beforeItem.bodySha256,
        sections: {
          claim: 'New claim.',
          evidence: 'New evidence.',
          acceptanceCriteria: '- New criterion.',
          recheck: 'New recheck.',
          notes: 'New notes.',
        },
        sectionOperations: [{ heading: 'Investigation Log', action: 'append', content: 'First investigation entry.' }],
      });

      expect(output).toMatchObject({
        itemId: 'target-item',
        title: 'New Title',
        status: 'candidate',
        path: expect.stringContaining('target-item.md'),
        storage: { kind: 'canonical-sqlite', id: 'target-item' },
        updatedAt: expect.any(String),
        bodySha256: expect.any(String),
        recordSha256: expect.any(String),
        changedFields: expect.arrayContaining(['title']),
        changedSections: expect.arrayContaining(['Claim', 'Evidence', 'Acceptance Criteria', 'Recheck', 'Notes', 'Investigation Log']),
      });
      expect(output.bodySha256).not.toBe(beforeItem.bodySha256);

      const row = readCanonicalBacklogItem(cwd, 'target-item');
      expect(row).toMatchObject({ title: 'New Title', bodySha256: output.bodySha256, recordSha256: output.recordSha256 });
      expect(row?.body).toContain('# New Title\n');
      expect(row?.body).toContain('## Claim\n\nNew claim.\n');
      expect(row?.body).toContain('## Custom Links\n\nKeep this exact custom block.\n');
      expect(row?.body).toContain('## Investigation Log\n\nFirst investigation entry.\n');
      expect(await readFile(resolveBacklogItemPath(cwd, 'target-item'), 'utf-8')).toContain('## Investigation Log\n\nFirst investigation entry.');
    });
  });

  it('allows existing rows with missing hash columns to complete get-item then update-item', async () => {
    await withTempProject(async (cwd) => {
      seedBodySafeItem(cwd);
      const handle = db(cwd);
      handle.prepare('UPDATE backlog_items SET body_sha256 = NULL, record_sha256 = NULL WHERE id = ?').run('target-item');
      handle.close();

      const before = await invoke(cwd, 'get-item', { id: 'target-item', includeBody: true });
      const beforeItem = before.item as Record<string, unknown>;
      expect(beforeItem).toMatchObject({ bodySha256: expect.stringMatching(/^[a-f0-9]{64}$/), recordSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });

      const output = await invoke(cwd, 'update-item', { id: 'target-item', expectedBodySha256: beforeItem.bodySha256, sections: { claim: 'Updated after lazy hash repair.' } });
      expect(output).toMatchObject({ itemId: 'target-item', bodySha256: expect.stringMatching(/^[a-f0-9]{64}$/), recordSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    });
  });

  it('keeps metadata-only updates lock-free and preserves body bytes', async () => {
    await withTempProject(async (cwd) => {
      seedBodySafeItem(cwd);
      const before = readCanonicalBacklogItem(cwd, 'target-item');

      const output = await invoke(cwd, 'update-item', {
        id: 'target-item',
        status: 'active',
        priority: 'p2',
        tags: ['new', 'triaged'],
        dependsOn: [],
        epic: 'epic-two',
        evidenceNotes: 'Metadata evidence note.',
        recheckNotes: 'Metadata recheck note.',
      });

      expect(output).toMatchObject({ itemId: 'target-item', status: 'active', bodySha256: before?.bodySha256, changedSections: [] });
      const after = readCanonicalBacklogItem(cwd, 'target-item');
      expect(after?.body).toBe(before?.body);
      expect(after).toMatchObject({ userStatus: 'active', priority: 'p2', epicRef: 'epic-two', bodySha256: before?.bodySha256 });
      expect(after?.frontmatter.tags).toEqual(['new', 'triaged']);
    });
  });

  it('rejects body-affecting updates without a lock token and leaves storage unchanged', async () => {
    await withTempProject(async (cwd) => {
      seedBodySafeItem(cwd);
      const before = readCanonicalBacklogItem(cwd, 'target-item');

      const result = await dispatch(cwd, 'update-item', { id: 'target-item', sections: { claim: 'Unsafe unlocked claim.' } });

      expect(result.kind).toBe('invalid-input');
      expect(String(result.message)).toMatch(/expectedBodySha256|lock|get-item/i);
      const after = readCanonicalBacklogItem(cwd, 'target-item');
      expect(after).toMatchObject({ body: before?.body, bodySha256: before?.bodySha256, recordSha256: before?.recordSha256, updatedAt: before?.updatedAt });
    });
  });

  it('rejects stale lock tokens atomically without changing row, sections, dependencies, tags, or mirror content', async () => {
    await withTempProject(async (cwd) => {
      seedBodySafeItem(cwd);
      const before = readCanonicalBacklogItem(cwd, 'target-item');
      const beforeMirror = await readFile(resolveBacklogItemPath(cwd, 'target-item'), 'utf-8');
      const beforeDb = db(cwd);
      const beforeSections = beforeDb.prepare('SELECT section_name, content FROM backlog_item_sections WHERE item_id = ? ORDER BY section_name').all('target-item');
      beforeDb.close();

      const result = await dispatch(cwd, 'update-item', {
        id: 'target-item',
        title: 'Stale Title',
        status: 'active',
        tags: ['should-not-write'],
        dependsOn: [],
        expectedBodySha256: 'stale-body-token',
        sections: { claim: 'Stale claim.' },
      });

      expect(result.kind).toBe('invalid-input');
      expect(String(result.message)).toMatch(/expectedBodySha256|stale|re-read|get-item/i);
      const after = readCanonicalBacklogItem(cwd, 'target-item');
      expect(after).toMatchObject({ title: before?.title, userStatus: before?.userStatus, body: before?.body, bodySha256: before?.bodySha256, recordSha256: before?.recordSha256, updatedAt: before?.updatedAt });
      expect(await readFile(resolveBacklogItemPath(cwd, 'target-item'), 'utf-8')).toBe(beforeMirror);
      const afterDb = db(cwd);
      expect(afterDb.prepare('SELECT tag FROM backlog_item_tags WHERE item_id = ? ORDER BY tag').all('target-item')).toEqual([{ tag: 'old' }]);
      expect(afterDb.prepare('SELECT dependency_ref FROM item_dependencies WHERE item_id = ? ORDER BY dependency_ref').all('target-item')).toEqual([{ dependency_ref: 'dep-one' }]);
      expect(afterDb.prepare('SELECT section_name, content FROM backlog_item_sections WHERE item_id = ? ORDER BY section_name').all('target-item')).toEqual(beforeSections);
      afterDb.close();
    });
  });

  it('validates unsafe ids, status values, priority strings, dependency refs, epic refs, duplicate sections, and malformed operations before writing', async () => {
    await withTempProject(async (cwd) => {
      seedBodySafeItem(cwd);
      const before = readCanonicalBacklogItem(cwd, 'target-item');
      const token = before?.bodySha256;
      const invalidCases: Array<[string, Record<string, unknown>, RegExp]> = [
        ['unsafe id', { id: '../target-item', priority: 'p1' }, /id|unsafe/i],
        ['invalid status', { id: 'target-item', status: 'not-a-status' }, /status/i],
        ['empty priority', { id: 'target-item', priority: '' }, /priority/i],
        ['multiline priority', { id: 'target-item', priority: 'p1\np2' }, /priority/i],
        ['self dependency', { id: 'target-item', dependsOn: ['target-item'] }, /depend/i],
        ['duplicate dependencies', { id: 'target-item', dependsOn: ['dep-one', 'dep-one'] }, /duplicate|depend/i],
        ['missing dependency', { id: 'target-item', dependsOn: ['missing-dep'] }, /depend|missing-dep/i],
        ['missing epic', { id: 'target-item', epic: 'missing-epic' }, /epic|missing-epic/i],
        ['duplicate canonical section', { id: 'target-item', expectedBodySha256: token, sectionOperations: [{ heading: 'Claim', action: 'append', content: 'Creates ambiguity.' }, { heading: 'claim', action: 'append', content: 'Duplicate alias.' }] }, /duplicate|Claim/i],
        ['bad operation heading', { id: 'target-item', expectedBodySha256: token, sectionOperations: [{ heading: 'Bad\nHeading', action: 'replace', content: 'x' }] }, /heading/i],
        ['bad operation action', { id: 'target-item', expectedBodySha256: token, sectionOperations: [{ heading: 'Notes', action: 'delete', content: 'x' }] }, /action/i],
      ];

      for (const [name, input, message] of invalidCases) {
        const result = await dispatch(cwd, 'update-item', input);
        expect(result.kind, name).toBe('invalid-input');
        expect(String(result.message), name).toMatch(message);
      }
      expect(readCanonicalBacklogItem(cwd, 'target-item')).toMatchObject({ body: before?.body, bodySha256: before?.bodySha256, recordSha256: before?.recordSha256, updatedAt: before?.updatedAt });
    });
  });

  it('migrates legacy-only Markdown items before body-safe update while preserving legacy bytes', async () => {
    await withTempProject(async (cwd) => {
      await mkdir(join(cwd, '.backlog', 'items'), { recursive: true });
      const legacyRaw = '---\nid: legacy-body\nstatus: candidate\nupdated: 2026-01-01T00:00:00.000Z\n---\n# Legacy Body\n\n## Claim\n\nLegacy claim.\n';
      await writeFile(resolveLegacyBacklogItemPath(cwd, 'legacy-body'), legacyRaw);
      const detail = await invoke(cwd, 'get-item', { id: 'legacy-body' });
      const item = detail.item as Record<string, unknown>;

      const output = await invoke(cwd, 'update-item', { id: 'legacy-body', expectedBodySha256: item.bodySha256, title: 'Migrated Body', sections: { claim: 'Migrated claim.' } });

      expect(output).toMatchObject({ itemId: 'legacy-body', title: 'Migrated Body', storage: { kind: 'canonical-sqlite', id: 'legacy-body' }, bodySha256: expect.any(String), recordSha256: expect.any(String) });
      expect(await readFile(resolveLegacyBacklogItemPath(cwd, 'legacy-body'), 'utf-8')).toBe(legacyRaw);
      expect(readCanonicalBacklogItem(cwd, 'legacy-body')).toMatchObject({ title: 'Migrated Body', body: expect.stringContaining('Migrated claim.') });
      expect(await readFile(resolveBacklogItemPath(cwd, 'legacy-body'), 'utf-8')).toContain('# Migrated Body');
    });
  });

  it('recomputes section rows, marks search dirty, and marks current recommendations stale after a body-safe update', async () => {
    await withTempProject(async (cwd) => {
      seedBodySafeItem(cwd);
      writeCanonicalRecommendations(cwd, recommendationModel());
      const before = await invoke(cwd, 'get-item', { id: 'target-item' });
      const token = (before.item as Record<string, unknown>).bodySha256;

      await invoke(cwd, 'update-item', { id: 'target-item', expectedBodySha256: token, sections: { claim: 'Indexed new claim.' } });

      const handle = db(cwd);
      expect(handle.prepare('SELECT content FROM backlog_item_sections WHERE item_id = ? AND section_name = ?').get('target-item', 'Claim')).toMatchObject({ content: 'Indexed new claim.' });
      expect(handle.prepare('SELECT content FROM backlog_item_sections WHERE item_id = ? AND section_name = ?').get('target-item', 'Evidence')).toMatchObject({ content: 'Old evidence.' });
      expect((handle.prepare('SELECT count(*) AS count FROM search_index_dirty_records WHERE document_type = ? AND document_id = ?').get('backlog_item', 'target-item') as { count: number }).count).toBeGreaterThan(0);
      expect(handle.prepare('SELECT json_extract(freshness_json, ?) AS status, json_extract(freshness_json, ?) AS reason FROM recommendation_runs WHERE is_current = 1').get('$.status', '$.reason')).toMatchObject({ status: 'stale', reason: expect.stringContaining('update-item') });
      handle.close();
    });
  });
});
