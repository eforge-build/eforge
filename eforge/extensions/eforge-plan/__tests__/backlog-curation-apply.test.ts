import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyBacklogCurationDraftFromTask, applySectionOperations } from '../backlog-curation-apply.js';
import { buildBacklogCurationSource } from '../backlog-curation-source.js';
import { recordPlanningTaskWorkflowEntry } from '../planning-task-workflow-store.js';
import { readDerivedRecommendationStatus } from '../recommendation-status.js';
import { createEmptyRecommendationModel, readRecommendations, resolveRecommendationsPathForCwd, writeRecommendations } from '../recommendations-store.js';
import { readBacklogItem, readBacklogItemSnapshot, resolveBacklogItemPath, resolveLegacyBacklogItemPath, writeBacklogEpic, writeBacklogItem } from '../markdown-store.js';

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-curation-apply-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

async function workflowEntry(cwd: string) {
  const source = await buildBacklogCurationSource(cwd);
  return {
    source,
    entry: await recordPlanningTaskWorkflowEntry(cwd, {
      taskId: 'task-1',
      originalRequest: '',
      derivedRequest: 'curate',
      selection: {},
      requestedOutputSections: ['backlogCurationDraft', 'recommendations'],
      includeRoadmap: true,
      purpose: 'backlog-curation',
      sourceFingerprint: source.sourceFingerprint,
      createdAt: 'now',
    }),
  };
}

function curationTask(sourceFingerprint: string, draft: Record<string, unknown>, recommendations?: unknown) {
  return {
    taskId: 'task-1',
    kind: 'eforge-plan.planning-draft',
    status: 'completed',
    result: {
      summary: 'done',
      assumptionsOpenQuestions: [],
      backlogCurationDraft: { schemaVersion: 1, sourceFingerprint, summary: [], skipped: [], needsInput: [], ...draft },
      ...(recommendations !== undefined && { recommendations }),
    },
  };
}

describe('backlog curation apply', () => {
  it('applies a valid item patch through private storage and records appliedAt', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogEpic(cwd, { id: 'epic-1', status: 'candidate', body: '# Epic\n' });
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', tags: ['old'], body: '# Item\n\n## Claim\n\nOld\n\n## Evidence\n\nPrior\n' });
      const legacyPath = resolveLegacyBacklogItemPath(cwd, 'item-1');
      await mkdir(join(cwd, '.backlog', 'items'), { recursive: true });
      await writeFile(legacyPath, 'legacy bytes');
      const source = await buildBacklogCurationSource(cwd);
      const snapshot = await readBacklogItemSnapshot(cwd, 'item-1');
      expect(snapshot).not.toBeNull();
      const entry = await recordPlanningTaskWorkflowEntry(cwd, { taskId: 'task-1', originalRequest: '', derivedRequest: 'curate', selection: {}, requestedOutputSections: ['backlogCurationDraft', 'recommendations'], includeRoadmap: true, purpose: 'backlog-curation', sourceFingerprint: source.sourceFingerprint, createdAt: 'now' });
      const task = {
        taskId: 'task-1',
        kind: 'eforge-plan.planning-draft',
        status: 'completed',
        result: { summary: 'done', assumptionsOpenQuestions: [], backlogCurationDraft: {
          schemaVersion: 1,
          sourceFingerprint: source.sourceFingerprint,
          summary: ['curated'],
          itemChanges: [{ kind: 'item', id: 'item-1', precondition: { kind: 'item', id: 'item-1', bodySha256: snapshot!.bodySha256, recordSha256: snapshot!.recordSha256 }, metadata: { status: 'planned', priority: 'high', tags: ['new'], depends_on: [], epic: 'epic-1', last_checked: '2026-01-01', stale_after: '2026-02-01' }, sectionOperations: [{ heading: 'Claim', action: 'replace', content: 'New claim.' }], rationale: 'Current evidence supports planning.', evidence: ['Validated during curation.'] }],
          epicChanges: [],
          noOpRechecks: [],
          skipped: [],
          needsInput: [],
        } },
      };
      const result = await applyBacklogCurationDraftFromTask(cwd, task, { taskId: 'task-1', applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } }, entry);
      expect(result.changedItemIds).toEqual(['item-1']);
      const privateRaw = await readFile(resolveBacklogItemPath(cwd, 'item-1'), 'utf-8');
      expect(privateRaw).toContain('status: planned');
      expect(privateRaw).toContain('priority: high');
      expect(privateRaw).toContain('epic: epic-1');
      expect(privateRaw).toContain('New claim.');
      expect(privateRaw).toContain('- Validated during curation.');
      expect(await readFile(legacyPath, 'utf-8')).toBe('legacy bytes');
    });
  });

  it('rejects invalid section headings before writing', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', body: '# Item\n\n## Claim\n\nOld\n' });
      const source = await buildBacklogCurationSource(cwd);
      const snapshot = await readBacklogItemSnapshot(cwd, 'item-1');
      const entry = { taskId: 'task-1', originalRequest: '', derivedRequest: 'curate', selection: {}, requestedOutputSections: ['backlogCurationDraft', 'recommendations'] as const, includeRoadmap: true, purpose: 'backlog-curation' as const, sourceFingerprint: source.sourceFingerprint, createdAt: 'now' };
      const before = await readFile(resolveBacklogItemPath(cwd, 'item-1'), 'utf-8');
      await expect(applyBacklogCurationDraftFromTask(cwd, { taskId: 'task-1', kind: 'eforge-plan.planning-draft', status: 'completed', result: { backlogCurationDraft: { schemaVersion: 1, sourceFingerprint: source.sourceFingerprint, summary: [], itemChanges: [{ kind: 'item', id: 'item-1', precondition: { kind: 'item', id: 'item-1', bodySha256: snapshot!.bodySha256 }, sectionOperations: [{ heading: 'Bad\nHeading', action: 'replace', content: 'x' }], rationale: 'rationale' }], epicChanges: [], noOpRechecks: [], skipped: [], needsInput: [] } } }, { taskId: 'task-1', applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } }, entry)).rejects.toThrow(/heading/i);
      expect(await readFile(resolveBacklogItemPath(cwd, 'item-1'), 'utf-8')).toBe(before);
    });
  });

  it('rejects Evidence section replacement before writing so prior durable evidence is preserved', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', body: '# Item\n\n## Claim\n\nOld\n\n## Evidence\n\n- Prior durable evidence\n' });
      const source = await buildBacklogCurationSource(cwd);
      const snapshot = await readBacklogItemSnapshot(cwd, 'item-1');
      const entry = { taskId: 'task-1', originalRequest: '', derivedRequest: 'curate', selection: {}, requestedOutputSections: ['backlogCurationDraft', 'recommendations'] as const, includeRoadmap: true, purpose: 'backlog-curation' as const, sourceFingerprint: source.sourceFingerprint, createdAt: 'now' };
      const before = await readFile(resolveBacklogItemPath(cwd, 'item-1'), 'utf-8');
      await expect(applyBacklogCurationDraftFromTask(cwd, { taskId: 'task-1', kind: 'eforge-plan.planning-draft', status: 'completed', result: { backlogCurationDraft: { schemaVersion: 1, sourceFingerprint: source.sourceFingerprint, summary: [], itemChanges: [{ kind: 'item', id: 'item-1', precondition: { kind: 'item', id: 'item-1', bodySha256: snapshot!.bodySha256 }, sectionOperations: [{ heading: 'Evidence', action: 'replace', content: '- Replacement evidence' }], rationale: 'rationale', evidence: ['New durable evidence'] }], epicChanges: [], noOpRechecks: [], skipped: [], needsInput: [] } } }, { taskId: 'task-1', applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } }, entry)).rejects.toThrow(/Evidence.*append-only/i);
      expect(await readFile(resolveBacklogItemPath(cwd, 'item-1'), 'utf-8')).toBe(before);
    });
  });

  it('rejects lower-case Evidence section replacement before writing', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', body: '# Item\n\n## Claim\n\nOld\n\n## evidence\n\n- Prior durable evidence\n' });
      const source = await buildBacklogCurationSource(cwd);
      const snapshot = await readBacklogItemSnapshot(cwd, 'item-1');
      const entry = { taskId: 'task-1', originalRequest: '', derivedRequest: 'curate', selection: {}, requestedOutputSections: ['backlogCurationDraft', 'recommendations'] as const, includeRoadmap: true, purpose: 'backlog-curation' as const, sourceFingerprint: source.sourceFingerprint, createdAt: 'now' };
      const before = await readFile(resolveBacklogItemPath(cwd, 'item-1'), 'utf-8');
      await expect(applyBacklogCurationDraftFromTask(cwd, { taskId: 'task-1', kind: 'eforge-plan.planning-draft', status: 'completed', result: { backlogCurationDraft: { schemaVersion: 1, sourceFingerprint: source.sourceFingerprint, summary: [], itemChanges: [{ kind: 'item', id: 'item-1', precondition: { kind: 'item', id: 'item-1', bodySha256: snapshot!.bodySha256 }, sectionOperations: [{ heading: 'evidence', action: 'replace', content: '- Replacement evidence' }], rationale: 'rationale', evidence: ['New durable evidence'] }], epicChanges: [], noOpRechecks: [], skipped: [], needsInput: [] } } }, { taskId: 'task-1', applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } }, entry)).rejects.toThrow(/Evidence.*append-only/i);
      expect(await readFile(resolveBacklogItemPath(cwd, 'item-1'), 'utf-8')).toBe(before);
    });
  });

  it('rejects stale preconditions, unknown dependencies, and unknown recommendation references before writing', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', body: '# Item\n\n## Claim\n\nOld\n' });
      const { source, entry } = await workflowEntry(cwd);
      const snapshot = await readBacklogItemSnapshot(cwd, 'item-1');
      const before = await readFile(resolveBacklogItemPath(cwd, 'item-1'), 'utf-8');
      const recommendationPath = resolveRecommendationsPathForCwd(cwd);

      const validPatch = { kind: 'item', id: 'item-1', precondition: { kind: 'item', id: 'item-1', bodySha256: snapshot!.bodySha256, recordSha256: snapshot!.recordSha256 }, metadata: { status: 'planned', depends_on: [] }, rationale: 'Plan item from current evidence.' };
      const cases: Array<{ name: string; task: ReturnType<typeof curationTask> }> = [
        { name: 'stale body hash', task: curationTask(source.sourceFingerprint, { itemChanges: [{ ...validPatch, precondition: { ...validPatch.precondition, bodySha256: '0'.repeat(64) } }], epicChanges: [], noOpRechecks: [] }) },
        { name: 'unknown dependency', task: curationTask(source.sourceFingerprint, { itemChanges: [{ ...validPatch, metadata: { depends_on: ['missing-item'] } }], epicChanges: [], noOpRechecks: [] }) },
        { name: 'unknown recommendation reference', task: curationTask(source.sourceFingerprint, { itemChanges: [validPatch], epicChanges: [], noOpRechecks: [] }, { ...createEmptyRecommendationModel(), readyCandidates: [{ itemId: 'missing-item', rationale: 'Missing.' }] }) },
      ];

      for (const { name, task } of cases) {
        await expect(applyBacklogCurationDraftFromTask(cwd, task, { taskId: 'task-1', applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } }, entry), name).rejects.toThrow();
        expect(await readFile(resolveBacklogItemPath(cwd, 'item-1'), 'utf-8')).toBe(before);
        expect(await readRecommendations(cwd)).toBeNull();
        expect(existsSync(recommendationPath)).toBe(false);
      }
    });
  });

  it('does not block safe patches on unrelated or visible closed references', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogEpic(cwd, { id: 'closed-epic', status: 'shipped', body: '# Closed Epic\n' });
      await writeBacklogItem(cwd, { id: 'closed-dep', status: 'shipped', body: '# Closed Dependency\n' });
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', depends_on: ['closed-dep'], epic: 'closed-epic', body: '# Item\n\n## Claim\n\nOld\n' });
      await writeBacklogItem(cwd, { id: 'item-2', status: 'candidate', depends_on: ['missing-preexisting'], body: '# Item Two\n\n## Claim\n\nUntouched\n' });
      const { source, entry } = await workflowEntry(cwd);
      const snapshot = await readBacklogItemSnapshot(cwd, 'item-1');
      const task = curationTask(source.sourceFingerprint, {
        itemChanges: [{ kind: 'item', id: 'item-1', precondition: { kind: 'item', id: 'item-1', bodySha256: snapshot!.bodySha256, recordSha256: snapshot!.recordSha256 }, sectionOperations: [{ heading: 'Claim', action: 'replace', content: 'New claim.' }], rationale: 'Update claim while preserving existing closed links.' }],
        epicChanges: [],
        noOpRechecks: [],
      });

      const result = await applyBacklogCurationDraftFromTask(cwd, task, { taskId: 'task-1', applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } }, entry);

      expect(result.changedItemIds).toEqual(['item-1']);
      expect(await readBacklogItem(cwd, 'item-1')).toMatchObject({ depends_on: ['closed-dep'], epic: 'closed-epic', body: expect.stringContaining('New claim.') });
    });
  });

  it('updates no-op rechecks without changing material fields', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-1', status: 'planned', priority: 'low', tags: ['keep'], body: '# Item\n\n## Claim\n\nKeep this body.\n' });
      const { source, entry } = await workflowEntry(cwd);
      const snapshot = await readBacklogItemSnapshot(cwd, 'item-1');
      const task = curationTask(source.sourceFingerprint, {
        itemChanges: [],
        epicChanges: [],
        noOpRechecks: [{ kind: 'item', id: 'item-1', precondition: { kind: 'item', id: 'item-1', bodySha256: snapshot!.bodySha256, recordSha256: snapshot!.recordSha256 }, last_checked: '2026-03-01', stale_after: '2026-04-01', rationale: 'Still valid.' }],
      });

      const result = await applyBacklogCurationDraftFromTask(cwd, task, { taskId: 'task-1', applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } }, entry);

      expect(result.recheckedItemIds).toEqual(['item-1']);
      expect(await readBacklogItem(cwd, 'item-1')).toMatchObject({ status: 'planned', priority: 'low', tags: ['keep'], last_checked: '2026-03-01', stale_after: '2026-04-01', body: expect.stringContaining('Keep this body.') });
    });
  });

  it('removes item epic links when metadata.epic is null', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogEpic(cwd, { id: 'epic-1', status: 'candidate', body: '# Epic\n' });
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', epic: 'epic-1', body: '# Item\n\n## Claim\n\nOld\n' });
      const { source, entry } = await workflowEntry(cwd);
      const snapshot = await readBacklogItemSnapshot(cwd, 'item-1');
      const task = curationTask(source.sourceFingerprint, {
        itemChanges: [{ kind: 'item', id: 'item-1', precondition: { kind: 'item', id: 'item-1', bodySha256: snapshot!.bodySha256, recordSha256: snapshot!.recordSha256 }, metadata: { epic: null }, rationale: 'No longer belongs to this epic.' }],
        epicChanges: [],
        noOpRechecks: [],
      });

      await applyBacklogCurationDraftFromTask(cwd, task, { taskId: 'task-1', applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } }, entry);

      const raw = await readFile(resolveBacklogItemPath(cwd, 'item-1'), 'utf-8');
      expect(raw).not.toMatch(/^epic:/m);
      expect((await readBacklogItem(cwd, 'item-1'))?.epic).toBeUndefined();
    });
  });

  it('writes generated recommendations and records freshness after successful curation writes', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', body: '# Item\n\n## Claim\n\nOld\n' });
      const { source, entry } = await workflowEntry(cwd);
      const snapshot = await readBacklogItemSnapshot(cwd, 'item-1');
      const recommendations = { ...createEmptyRecommendationModel(), readyCandidates: [{ itemId: 'item-1', rationale: 'Ready after curation.' }] };
      const task = curationTask(source.sourceFingerprint, {
        itemChanges: [{ kind: 'item', id: 'item-1', precondition: { kind: 'item', id: 'item-1', bodySha256: snapshot!.bodySha256, recordSha256: snapshot!.recordSha256 }, metadata: { status: 'planned' }, rationale: 'Ready to plan.' }],
        epicChanges: [],
        noOpRechecks: [],
      }, recommendations);

      const result = await applyBacklogCurationDraftFromTask(cwd, task, { taskId: 'task-1', applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } }, entry);

      expect(result.recommendations?.recommendations.readyCandidates).toEqual([{ itemId: 'item-1', rationale: 'Ready after curation.' }]);
      expect(await readRecommendations(cwd)).toMatchObject({ readyCandidates: [{ itemId: 'item-1' }] });
      const status = await readDerivedRecommendationStatus(cwd);
      expect(status.state).toBe('fresh');
      expect(status.lastRefreshedBy).toBe('apply-backlog-curation-draft');
      expect(status.lastAppliedSourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  it('marks existing recommendations stale after substantive curation without generated recommendations', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', body: '# Item\n\n## Claim\n\nOld\n' });
      await writeRecommendations(cwd, { ...createEmptyRecommendationModel(), readyCandidates: [{ itemId: 'item-1', rationale: 'Previously ready.' }] });
      const { source, entry } = await workflowEntry(cwd);
      const snapshot = await readBacklogItemSnapshot(cwd, 'item-1');
      const task = curationTask(source.sourceFingerprint, {
        itemChanges: [{ kind: 'item', id: 'item-1', precondition: { kind: 'item', id: 'item-1', bodySha256: snapshot!.bodySha256, recordSha256: snapshot!.recordSha256 }, metadata: { status: 'planned' }, rationale: 'Substantive status change.' }],
        epicChanges: [],
        noOpRechecks: [],
      });

      await applyBacklogCurationDraftFromTask(cwd, task, { taskId: 'task-1', applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } }, entry);

      const status = await readDerivedRecommendationStatus(cwd);
      expect(status.state).toBe('stale');
      expect(status.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'backlog-mutation:backlog-curation', message: expect.stringContaining('item-1') })]));
    });
  });

  it('supports section replace and append semantics', () => {
    const body = '# Title\n\n## Claim\n\nOld\n\n## Evidence\n\nPrior\n';
    const updated = applySectionOperations(body, [{ heading: 'Claim', action: 'replace', content: 'New' }, { heading: 'Evidence', action: 'append', content: 'Later' }]);
    expect(updated).toContain('# Title');
    expect(updated).toContain('## Claim\n\nNew');
    expect(updated).toContain('Prior\n\nLater');
  });
});
