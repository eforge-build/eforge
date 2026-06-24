import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyBacklogCurationDraftFromTask, applySectionOperations, previewBacklogCurationDraftFromTask, validateBacklogCurationPlanningDraftResult } from '../backlog-curation-apply.js';
import { readAcceptedAnalysisBaseline } from '../backlog-curation-git-delta.js';
import { AMBIGUOUS_SHIPPED_EVIDENCE_PREFIX, AMBIGUOUS_SUPERSEDED_EVIDENCE_PREFIX, SHIPPED_CURRENT_SOURCE_EVIDENCE_PREFIX, SHIPPED_GIT_PR_EVIDENCE_PREFIX, SHIPPED_LIFECYCLE_EVIDENCE_PREFIX, SUPERSEDED_CURRENT_SOURCE_EVIDENCE_PREFIX, SUPERSEDED_GIT_PR_EVIDENCE_PREFIX, SUPERSEDED_LIFECYCLE_EVIDENCE_PREFIX } from '../backlog-curation-evidence-prefixes.js';
import { buildBacklogCurationSource, writeBacklogCurationSourcePreviewMetadata } from '../backlog-curation-source.js';
import { recordPlanningTaskWorkflowEntry } from '../planning-task-workflow-store.js';
import { readDerivedRecommendationStatus, recordPlannerRecommendationApplied } from '../recommendation-status.js';
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
      expect(result.skippedFreshRechecks).toBe(0);
      expect(await readBacklogItem(cwd, 'item-1')).toMatchObject({ status: 'planned', priority: 'low', tags: ['keep'], last_checked: '2026-03-01', stale_after: '2026-04-01', body: expect.stringContaining('Keep this body.') });
    });
  });

  it('skips no-op rechecks for records that are already fresh', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-1', status: 'planned', last_checked: '2999-01-01', stale_after: '2999-02-01', body: '# Item\n\n## Claim\n\nKeep this body.\n' });
      const { source, entry } = await workflowEntry(cwd);
      const snapshot = await readBacklogItemSnapshot(cwd, 'item-1');
      const task = curationTask(source.sourceFingerprint, {
        itemChanges: [],
        epicChanges: [],
        noOpRechecks: [{ kind: 'item', id: 'item-1', precondition: { kind: 'item', id: 'item-1', bodySha256: snapshot!.bodySha256, recordSha256: snapshot!.recordSha256 }, last_checked: '2999-01-02', stale_after: '2999-03-01', rationale: 'Still valid.' }],
      });

      const result = await applyBacklogCurationDraftFromTask(cwd, task, { taskId: 'task-1', applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } }, entry);

      expect(result.noOpRechecks).toBe(0);
      expect(result.skippedFreshRechecks).toBe(1);
      expect(result.recheckedItemIds).toEqual([]);
      expect(await readBacklogItem(cwd, 'item-1')).toMatchObject({ last_checked: '2999-01-01', stale_after: '2999-02-01' });
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

  it('filters generated recommendations that reference records closed by the curation patch before writing', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', body: '# Item\n\n## Claim\n\nOld\n' });
      await mkdir(join(cwd, 'src'), { recursive: true });
      await writeFile(join(cwd, 'src', 'item-1.ts'), 'export class ItemOne { run() { return \"item-1\"; } }\n');
      await writeFile(join(cwd, 'src', 'index.ts'), 'export { ItemOne } from \"./item-1\"; // item-1\n');
      const { source, entry } = await workflowEntry(cwd);
      await writeBacklogCurationSourcePreviewMetadata(cwd, source);
      const snapshot = await readBacklogItemSnapshot(cwd, 'item-1');
      const recommendations = { ...createEmptyRecommendationModel(), readyCandidates: [{ itemId: 'item-1', rationale: 'Ready after curation.' }], recommendedNextSequence: [{ itemId: 'item-1', rationale: 'Next.' }] };
      const task = curationTask(source.sourceFingerprint, {
        itemChanges: [{ kind: 'item', id: 'item-1', precondition: { kind: 'item', id: 'item-1', bodySha256: snapshot!.bodySha256, recordSha256: snapshot!.recordSha256 }, metadata: { status: 'shipped' }, rationale: 'Closed with current-source evidence.', evidence: [`${SHIPPED_CURRENT_SOURCE_EVIDENCE_PREFIX} src/item-1.ts and src/index.ts`] }],
        epicChanges: [],
        noOpRechecks: [],
      }, recommendations);

      const result = await applyBacklogCurationDraftFromTask(cwd, task, { taskId: 'task-1', applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } }, entry);

      expect(result.recommendations?.recommendations.readyCandidates).toEqual([]);
      expect(result.recommendations?.recommendations.recommendedNextSequence).toEqual([]);
      expect(result.recommendations?.recommendations.rationaleAndAssumptions).toEqual([expect.stringContaining('Adjusted generated recommendations for the prospective curation state')]);
      expect(await readBacklogItem(cwd, 'item-1')).toMatchObject({ status: 'shipped' });
      expect(await readRecommendations(cwd)).toMatchObject({ readyCandidates: [], recommendedNextSequence: [] });
    });
  });

  it('rejects generated recommendations that reference shipped blockedBy ids before writing by default', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'closed-dep', status: 'shipped', body: '# Closed Dependency\n' });
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', body: '# Item\n\n## Claim\n\nOld\n' });
      const { source, entry } = await workflowEntry(cwd);
      const snapshot = await readBacklogItemSnapshot(cwd, 'item-1');
      const before = await readFile(resolveBacklogItemPath(cwd, 'item-1'), 'utf-8');
      const recommendations = { ...createEmptyRecommendationModel(), blockedChains: [{ ref: 'closed-chain', itemIds: ['item-1'], blockedBy: ['closed-dep'], rationale: 'Closed dependency is historical.' }] };
      const task = curationTask(source.sourceFingerprint, {
        itemChanges: [{ kind: 'item', id: 'item-1', precondition: { kind: 'item', id: 'item-1', bodySha256: snapshot!.bodySha256, recordSha256: snapshot!.recordSha256 }, sectionOperations: [{ heading: 'Claim', action: 'replace', content: 'Curated claim.' }], rationale: 'Refresh claim.' }],
        epicChanges: [],
        noOpRechecks: [],
      }, recommendations);

      await expect(applyBacklogCurationDraftFromTask(cwd, task, { taskId: 'task-1', applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } }, entry)).rejects.toThrow(/closed-dep|blockedChains\.closed-chain\.blockedBy/);

      expect(await readFile(resolveBacklogItemPath(cwd, 'item-1'), 'utf-8')).toBe(before);
      expect(await readRecommendations(cwd)).toBeNull();
      expect(existsSync(resolveRecommendationsPathForCwd(cwd))).toBe(false);
    });
  });

  it('applies curation-only while skipping invalid generated recommendations that reference shipped blockedBy ids', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'closed-dep', status: 'shipped', body: '# Closed Dependency\n' });
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', body: '# Item\n\n## Claim\n\nOld\n' });
      const { source, entry } = await workflowEntry(cwd);
      const snapshot = await readBacklogItemSnapshot(cwd, 'item-1');
      const recommendations = { ...createEmptyRecommendationModel(), blockedChains: [{ ref: 'closed-chain', itemIds: ['item-1'], blockedBy: ['closed-dep'], rationale: 'Closed dependency is historical.' }] };
      const task = curationTask(source.sourceFingerprint, {
        itemChanges: [{ kind: 'item', id: 'item-1', precondition: { kind: 'item', id: 'item-1', bodySha256: snapshot!.bodySha256, recordSha256: snapshot!.recordSha256 }, sectionOperations: [{ heading: 'Claim', action: 'replace', content: 'Curated claim.' }], rationale: 'Refresh claim.' }],
        epicChanges: [],
        noOpRechecks: [],
      }, recommendations);

      const result = await applyBacklogCurationDraftFromTask(cwd, task, { taskId: 'task-1', applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true, applyCurationOnly: true } }, entry);

      expect(result.changedItemIds).toEqual(['item-1']);
      expect(result.recommendations).toBeUndefined();
      expect(result.recommendationsSkipped).toMatchObject({ generatedRecommendationValidation: { issues: [{ path: 'blockedChains.closed-chain.blockedBy', id: 'closed-dep', reason: 'closed', status: 'shipped' }] } });
      expect(await readBacklogItem(cwd, 'item-1')).toMatchObject({ body: expect.stringContaining('Curated claim.') });
      expect(await readRecommendations(cwd)).toBeNull();
      expect(existsSync(resolveRecommendationsPathForCwd(cwd))).toBe(false);
    });
  });

  it('reports malformed generated recommendations as preview validation instead of preview errors', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', body: '# Item\n\n## Claim\n\nOld\n' });
      const { source, entry } = await workflowEntry(cwd);
      const snapshot = await readBacklogItemSnapshot(cwd, 'item-1');
      const task = curationTask(source.sourceFingerprint, {
        itemChanges: [{ kind: 'item', id: 'item-1', precondition: { kind: 'item', id: 'item-1', bodySha256: snapshot!.bodySha256, recordSha256: snapshot!.recordSha256 }, sectionOperations: [{ heading: 'Claim', action: 'replace', content: 'Curated claim.' }], rationale: 'Refresh claim.' }],
        epicChanges: [],
        noOpRechecks: [],
      }, { schemaVersion: 1, activeWork: 'not-an-array' });

      const preview = await previewBacklogCurationDraftFromTask(cwd, task, entry);

      expect(preview.errors).toBeUndefined();
      expect(preview.valid).toBe(false);
      expect(preview.generatedRecommendationValidation?.valid).toBe(false);
      expect(preview.recommendationProjection?.validation.valid).toBe(false);
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

  it('returns preview projection matching the effective recommendations later written by apply', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'ship-me', status: 'candidate', body: '# Ship Me\n\n## Evidence\n\n- Prior\n' });
      await writeBacklogItem(cwd, { id: 'keep-me', status: 'candidate', body: '# Keep Me\n\n## Claim\n\nStill open.\n' });
      await mkdir(join(cwd, 'src'), { recursive: true });
      await writeFile(join(cwd, 'src', 'ship-me.ts'), 'export class ShipMe { run() { return "ship-me"; } }\n');
      await writeFile(join(cwd, 'src', 'index.ts'), 'export { ShipMe } from "./ship-me"; // ship-me\n');
      const { source, entry } = await workflowEntry(cwd);
      const snapshot = await readBacklogItemSnapshot(cwd, 'ship-me');
      const recommendations = {
        ...createEmptyRecommendationModel(),
        readyCandidates: [{ itemId: 'ship-me', rationale: 'Raw stale target.' }, { itemId: 'keep-me', rationale: 'Keep open.' }],
        recommendedNextSequence: [{ itemId: 'ship-me', rationale: 'Raw next stale target.' }],
      };
      const task = curationTask(source.sourceFingerprint, {
        itemChanges: [{ kind: 'item', id: 'ship-me', precondition: { kind: 'item', id: 'ship-me', bodySha256: snapshot!.bodySha256, recordSha256: snapshot!.recordSha256 }, metadata: { status: 'shipped' }, rationale: 'Closed by current-source evidence.', evidence: [`${SHIPPED_CURRENT_SOURCE_EVIDENCE_PREFIX} src/ship-me.ts and src/index.ts`] }],
        epicChanges: [],
        noOpRechecks: [],
      }, recommendations);

      await writeBacklogCurationSourcePreviewMetadata(cwd, source);
      const preview = await previewBacklogCurationDraftFromTask(cwd, task, entry);
      const apply = await applyBacklogCurationDraftFromTask(cwd, task, { taskId: 'task-1', applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } }, entry);

      expect(preview.valid).toBe(true);
      expect(preview.recommendationFreshness?.comparedSourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(preview.gitDelta).toMatchObject({ baseline: expect.any(Object) });
      expect(preview.recommendationProjection?.effectiveRecommendations).toEqual(apply.recommendations?.recommendations);
      expect(preview.recommendationProjection?.removed.itemIds).toEqual(['ship-me']);
      expect(apply.recommendations?.recommendations.readyCandidates).toEqual([{ itemId: 'keep-me', rationale: 'Keep open.' }]);
      expect(await readRecommendations(cwd)).toEqual(preview.recommendationProjection?.effectiveRecommendations);
    });
  });

  it('returns full-audit preview metadata in curation preview details', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'partial-widget', status: 'candidate', body: '# Partial Widget\n\n## Evidence\n\n- Prior\n' });
      await mkdir(join(cwd, 'src'), { recursive: true });
      await writeFile(join(cwd, 'src', 'partial-widget.ts'), 'Partial Widget partial-widget is partly implemented.\n');
      const source = await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false });
      const entry = await recordPlanningTaskWorkflowEntry(cwd, { taskId: 'task-1', originalRequest: '', derivedRequest: 'curate', selection: {}, requestedOutputSections: ['backlogCurationDraft', 'recommendations'], includeRoadmap: true, purpose: 'backlog-curation', sourceFingerprint: source.sourceFingerprint, createdAt: 'now' });
      const snapshot = await readBacklogItemSnapshot(cwd, 'partial-widget');
      const task = curationTask(source.sourceFingerprint, {
        itemChanges: [{ kind: 'item', id: 'partial-widget', precondition: { kind: 'item', id: 'partial-widget', bodySha256: snapshot!.bodySha256, recordSha256: snapshot!.recordSha256 }, sectionOperations: [{ heading: 'Evidence', action: 'append', content: '- Partial implementation evidence remains open from src/partial-widget.ts.' }], rationale: 'Append partial evidence without closure.', evidence: ['Partial implementation evidence remains open from src/partial-widget.ts.'] }],
        epicChanges: [],
        noOpRechecks: [],
      });

      await writeBacklogCurationSourcePreviewMetadata(cwd, source);
      const preview = await previewBacklogCurationDraftFromTask(cwd, task, entry);

      expect(preview.fullImplementationAudit).toMatchObject({ scope: { itemIds: ['partial-widget'], openItemCount: 1 }, coverage: { auditedItemCount: 1 }, itemSummaries: [expect.objectContaining({ itemId: 'partial-widget', candidateIntent: 'partial-implementation', evidenceCount: 1 })] });
    });
  });

  it('rejects full-audit item patches without matching source and confidence preview metadata before writing', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'unmatched-widget', status: 'candidate', body: '# Unmatched Widget\n\n## Evidence\n\n- Prior\n' });
      const source = await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false });
      const entry = await recordPlanningTaskWorkflowEntry(cwd, { taskId: 'task-1', originalRequest: '', derivedRequest: 'curate', selection: {}, requestedOutputSections: ['backlogCurationDraft', 'recommendations'], includeRoadmap: true, purpose: 'backlog-curation', sourceFingerprint: source.sourceFingerprint, createdAt: 'now' });
      const snapshot = await readBacklogItemSnapshot(cwd, 'unmatched-widget');
      const before = await readFile(resolveBacklogItemPath(cwd, 'unmatched-widget'), 'utf-8');
      await writeBacklogCurationSourcePreviewMetadata(cwd, source);
      const task = curationTask(source.sourceFingerprint, {
        itemChanges: [{ kind: 'item', id: 'unmatched-widget', precondition: { kind: 'item', id: 'unmatched-widget', bodySha256: snapshot!.bodySha256, recordSha256: snapshot!.recordSha256 }, metadata: { status: 'shipped' }, rationale: 'Attempt unsupported full-audit closure.', evidence: [`${SHIPPED_CURRENT_SOURCE_EVIDENCE_PREFIX} invented/current-source.ts`] }],
        epicChanges: [],
        noOpRechecks: [],
      });

      const preview = await previewBacklogCurationDraftFromTask(cwd, task, entry);

      expect(preview.valid).toBe(false);
      expect(preview.errors).toEqual([expect.objectContaining({ path: 'backlogCurationDraft.itemChanges[0].evidence', message: expect.stringContaining('matching strong current-source closure preview metadata') })]);
      await expect(applyBacklogCurationDraftFromTask(cwd, task, { taskId: 'task-1', applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } }, entry)).rejects.toThrow(/matching strong current-source closure preview metadata/);
      expect(await readFile(resolveBacklogItemPath(cwd, 'unmatched-widget'), 'utf-8')).toBe(before);
    });
  });

  it('accepts agent-verified current-source closure evidence with required role labels', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'agent-verified-widget', status: 'planned', body: '# Agent Verified Widget\n\n## Evidence\n\n- Prior\n' });
      const source = await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false });
      const entry = await recordPlanningTaskWorkflowEntry(cwd, { taskId: 'task-1', originalRequest: '', derivedRequest: 'curate', selection: {}, requestedOutputSections: ['backlogCurationDraft', 'recommendations'], includeRoadmap: true, purpose: 'backlog-curation', sourceFingerprint: source.sourceFingerprint, createdAt: 'now' });
      const snapshot = await readBacklogItemSnapshot(cwd, 'agent-verified-widget');
      await writeBacklogCurationSourcePreviewMetadata(cwd, source);
      const task = curationTask(source.sourceFingerprint, {
        itemChanges: [{
          kind: 'item',
          id: 'agent-verified-widget',
          precondition: { kind: 'item', id: 'agent-verified-widget', bodySha256: snapshot!.bodySha256, recordSha256: snapshot!.recordSha256 },
          metadata: { status: 'shipped' },
          rationale: 'Read-only item audit verified implementation and product-surface wiring in current source.',
          evidence: [
            `${SHIPPED_CURRENT_SOURCE_EVIDENCE_PREFIX} implementation: src/agent-verified-widget.ts — handler implements the widget`,
            `${SHIPPED_CURRENT_SOURCE_EVIDENCE_PREFIX} product-surface: src/index.ts — action exports the widget`,
          ],
        }],
        epicChanges: [],
        noOpRechecks: [],
      });

      const preview = await previewBacklogCurationDraftFromTask(cwd, task, entry);
      expect(preview.valid).toBe(true);
      await applyBacklogCurationDraftFromTask(cwd, task, { taskId: 'task-1', applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } }, entry);
      expect((await readBacklogItem(cwd, 'agent-verified-widget'))?.status).toBe('shipped');
    });
  });

  it('rejects source-first closed-status patches supported only by historical or session-plan evidence in preview and apply', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'history-only-widget', status: 'planned', body: '# History Only Widget\n\n## Evidence\n\n- Prior\n' });
      const source = await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false });
      const entry = await recordPlanningTaskWorkflowEntry(cwd, { taskId: 'task-1', originalRequest: '', derivedRequest: 'curate', selection: {}, requestedOutputSections: ['backlogCurationDraft', 'recommendations'], includeRoadmap: true, purpose: 'backlog-curation', sourceFingerprint: source.sourceFingerprint, createdAt: 'now' });
      const snapshot = await readBacklogItemSnapshot(cwd, 'history-only-widget');
      await writeBacklogCurationSourcePreviewMetadata(cwd, source);

      for (const evidence of [`${SHIPPED_GIT_PR_EVIDENCE_PREFIX} merge abc123`, `${SHIPPED_LIFECYCLE_EVIDENCE_PREFIX} trace row landed`, 'Shipped evidence: session plan — completed in prior session']) {
        const task = curationTask(source.sourceFingerprint, {
          itemChanges: [{ kind: 'item', id: 'history-only-widget', precondition: { kind: 'item', id: 'history-only-widget', bodySha256: snapshot!.bodySha256, recordSha256: snapshot!.recordSha256 }, metadata: { status: 'shipped' }, rationale: 'Unsupported historical closure.', evidence: [evidence] }],
          epicChanges: [],
          noOpRechecks: [],
        });
        const preview = await previewBacklogCurationDraftFromTask(cwd, task, entry);

        expect(preview.valid).toBe(false);
        expect(preview.errors).toEqual([expect.objectContaining({ path: 'backlogCurationDraft.itemChanges[0].evidence', message: expect.stringMatching(/current source|matching shipped evidence prefix/i) })]);
        await expect(applyBacklogCurationDraftFromTask(cwd, task, { taskId: 'task-1', applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } }, entry)).rejects.toThrow(/current source|matching shipped evidence prefix/i);
      }
    });
  });

  it('rejects full-audit closed-status patches supported only by current-state evidence', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'partial-widget', status: 'planned', body: '# Partial Widget\n\n## Evidence\n\n- Prior\n' });
      await mkdir(join(cwd, 'src'), { recursive: true });
      await writeFile(join(cwd, 'src', 'partial-widget.ts'), 'Partial Widget partial-widget is partly implemented.\n');
      const source = await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false });
      const entry = await recordPlanningTaskWorkflowEntry(cwd, { taskId: 'task-1', originalRequest: '', derivedRequest: 'curate', selection: {}, requestedOutputSections: ['backlogCurationDraft', 'recommendations'], includeRoadmap: true, purpose: 'backlog-curation', sourceFingerprint: source.sourceFingerprint, createdAt: 'now' });
      const snapshot = await readBacklogItemSnapshot(cwd, 'partial-widget');
      const task = curationTask(source.sourceFingerprint, {
        itemChanges: [{ kind: 'item', id: 'partial-widget', precondition: { kind: 'item', id: 'partial-widget', bodySha256: snapshot!.bodySha256, recordSha256: snapshot!.recordSha256 }, metadata: { status: 'shipped' }, rationale: 'Unsupported closure from current state.', evidence: [`${SHIPPED_CURRENT_SOURCE_EVIDENCE_PREFIX} src/partial-widget.ts`] }],
        epicChanges: [],
        noOpRechecks: [],
      });

      await writeBacklogCurationSourcePreviewMetadata(cwd, source);

      await expect(applyBacklogCurationDraftFromTask(cwd, task, { taskId: 'task-1', applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } }, entry)).rejects.toThrow(/matching strong current-source closure preview metadata/);
    });
  });

  it('rejects source-first closure citations with only empty preview citation fields', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'empty-citation-widget', status: 'planned', body: '# Empty Citation Widget\n\n## Evidence\n\n- Prior\n' });
      const source = await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false });
      source.fullImplementationAuditPreview = { scope: { itemIds: ['empty-citation-widget'], openItemCount: 1 }, coverage: { auditedItemCount: 1 }, itemSummaries: [{ itemId: 'empty-citation-widget', candidateIntent: 'source-shipped', confidence: 'strong', closureCandidates: [{ source: 'current-source', confidence: 'strong', intent: 'shipped', evidenceSource: 'current-source', citations: [{ path: ' ', excerpt: ' ' }] }] }] };
      const entry = await recordPlanningTaskWorkflowEntry(cwd, { taskId: 'task-1', originalRequest: '', derivedRequest: 'curate', selection: {}, requestedOutputSections: ['backlogCurationDraft', 'recommendations'], includeRoadmap: true, purpose: 'backlog-curation', sourceFingerprint: source.sourceFingerprint, createdAt: 'now' });
      const snapshot = await readBacklogItemSnapshot(cwd, 'empty-citation-widget');
      const task = curationTask(source.sourceFingerprint, {
        itemChanges: [{ kind: 'item', id: 'empty-citation-widget', precondition: { kind: 'item', id: 'empty-citation-widget', bodySha256: snapshot!.bodySha256, recordSha256: snapshot!.recordSha256 }, metadata: { status: 'shipped' }, rationale: 'Unsupported empty citation closure.', evidence: [`${SHIPPED_CURRENT_SOURCE_EVIDENCE_PREFIX} current-source closure`] }],
        epicChanges: [],
        noOpRechecks: [],
      });

      await writeBacklogCurationSourcePreviewMetadata(cwd, source);

      await expect(applyBacklogCurationDraftFromTask(cwd, task, { taskId: 'task-1', applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } }, entry)).rejects.toThrow(/matching strong current-source closure preview metadata/);
    });
  });

  it('rejects full-audit closed-status patches supported only by ambiguous closure metadata', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'ambiguous-widget', status: 'planned', body: '# Ambiguous Widget\n\n## Evidence\n\n- Prior\n' });
      const source = await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false });
      source.fullImplementationAuditPreview = { scope: { itemIds: ['ambiguous-widget'], openItemCount: 1 }, coverage: { auditedItemCount: 1 }, itemSummaries: [{ itemId: 'ambiguous-widget', candidateIntent: 'needs-input', confidence: 'ambiguous', closureCandidates: [{ source: 'git-history', confidence: 'ambiguous', intent: 'ambiguous-shipped', evidence: 'Ambiguous shipped candidate: needs input.' }] }] };
      const entry = await recordPlanningTaskWorkflowEntry(cwd, { taskId: 'task-1', originalRequest: '', derivedRequest: 'curate', selection: {}, requestedOutputSections: ['backlogCurationDraft', 'recommendations'], includeRoadmap: true, purpose: 'backlog-curation', sourceFingerprint: source.sourceFingerprint, createdAt: 'now' });
      const snapshot = await readBacklogItemSnapshot(cwd, 'ambiguous-widget');
      const task = curationTask(source.sourceFingerprint, {
        itemChanges: [{ kind: 'item', id: 'ambiguous-widget', precondition: { kind: 'item', id: 'ambiguous-widget', bodySha256: snapshot!.bodySha256, recordSha256: snapshot!.recordSha256 }, metadata: { status: 'shipped' }, rationale: 'Unsupported ambiguous closure.', evidence: [`${SHIPPED_CURRENT_SOURCE_EVIDENCE_PREFIX} Ambiguous shipped candidate: needs input.`] }],
        epicChanges: [],
        noOpRechecks: [],
      });

      await writeBacklogCurationSourcePreviewMetadata(cwd, source);

      await expect(applyBacklogCurationDraftFromTask(cwd, task, { taskId: 'task-1', applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } }, entry)).rejects.toThrow(/matching strong current-source closure preview metadata/);
    });
  });

  it('accepts source-first shipped and superseded patches with matching current-source preview metadata', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'rocket-launcher', status: 'planned', body: '# Rocket Launcher\n\n## Acceptance Criteria\n\n- Launcher is implemented and exported.\n' });
      await writeBacklogItem(cwd, { id: 'legacy-panel', status: 'planned', body: '# Legacy Panel\n\n## Acceptance Criteria\n\n- Superseded replacement implementation is wired.\n' });
      await mkdir(join(cwd, 'src'), { recursive: true });
      await writeFile(join(cwd, 'src', 'rocket-launcher.ts'), 'Rocket Launcher rocket-launcher core implementation is present.\n');
      await writeFile(join(cwd, 'src', 'legacy-panel.ts'), 'Legacy Panel legacy-panel replacement implementation is present.\n');
      await writeFile(join(cwd, 'src', 'rocket-entry.ts'), 'export { RocketLauncher } from "./rocket-launcher"; // rocket-launcher\n');
      await writeFile(join(cwd, 'src', 'legacy-entry.ts'), 'export { LegacyPanel } from "./legacy-panel"; // legacy-panel\n');
      const source = await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false });
      const entry = await recordPlanningTaskWorkflowEntry(cwd, { taskId: 'task-1', originalRequest: '', derivedRequest: 'curate', selection: {}, requestedOutputSections: ['backlogCurationDraft', 'recommendations'], includeRoadmap: true, purpose: 'backlog-curation', sourceFingerprint: source.sourceFingerprint, createdAt: 'now' });
      const shippedSnapshot = await readBacklogItemSnapshot(cwd, 'rocket-launcher');
      const obsoleteSnapshot = await readBacklogItemSnapshot(cwd, 'legacy-panel');
      const task = curationTask(source.sourceFingerprint, {
        itemChanges: [
          { kind: 'item', id: 'rocket-launcher', precondition: { kind: 'item', id: 'rocket-launcher', bodySha256: shippedSnapshot!.bodySha256, recordSha256: shippedSnapshot!.recordSha256 }, metadata: { status: 'shipped' }, rationale: 'Close with source-first current-source metadata.', evidence: [`${SHIPPED_CURRENT_SOURCE_EVIDENCE_PREFIX} src/rocket-launcher.ts and src/rocket-entry.ts`] },
          { kind: 'item', id: 'legacy-panel', precondition: { kind: 'item', id: 'legacy-panel', bodySha256: obsoleteSnapshot!.bodySha256, recordSha256: obsoleteSnapshot!.recordSha256 }, metadata: { status: 'superseded' }, rationale: 'Close with source-first current-source metadata.', evidence: [`${SUPERSEDED_CURRENT_SOURCE_EVIDENCE_PREFIX} src/legacy-panel.ts and src/legacy-entry.ts`] },
        ],
        epicChanges: [],
        noOpRechecks: [],
      });

      await writeBacklogCurationSourcePreviewMetadata(cwd, source);
      const mixedHistoricalEvidenceTask = curationTask(source.sourceFingerprint, {
        itemChanges: [{ kind: 'item', id: 'rocket-launcher', precondition: { kind: 'item', id: 'rocket-launcher', bodySha256: shippedSnapshot!.bodySha256, recordSha256: shippedSnapshot!.recordSha256 }, metadata: { status: 'shipped' }, rationale: 'Do not mix historical hints into source-first closure evidence.', evidence: [`${SHIPPED_CURRENT_SOURCE_EVIDENCE_PREFIX} src/rocket-launcher.ts and src/rocket-entry.ts`, `${SHIPPED_LIFECYCLE_EVIDENCE_PREFIX} historical lifecycle hint`] }],
        epicChanges: [],
        noOpRechecks: [],
      });
      const mixedPreview = await previewBacklogCurationDraftFromTask(cwd, mixedHistoricalEvidenceTask, entry);
      expect(mixedPreview.errors).toEqual([expect.objectContaining({ path: 'backlogCurationDraft.itemChanges[0].evidence', message: expect.stringMatching(/matching shipped evidence prefix/i) })]);
      await expect(applyBacklogCurationDraftFromTask(cwd, mixedHistoricalEvidenceTask, { taskId: 'task-1', applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } }, entry)).rejects.toThrow(/matching shipped evidence prefix/i);

      const preview = await previewBacklogCurationDraftFromTask(cwd, task, entry);
      const apply = await applyBacklogCurationDraftFromTask(cwd, task, { taskId: 'task-1', applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } }, entry);

      expect(preview.valid).toBe(true);
      expect(preview.fullImplementationAudit?.itemSummaries).toEqual(expect.arrayContaining([
        expect.objectContaining({ itemId: 'rocket-launcher', closureCandidates: expect.arrayContaining([expect.objectContaining({ source: 'current-source', confidence: 'strong', intent: 'shipped' })]) }),
        expect.objectContaining({ itemId: 'legacy-panel', closureCandidates: expect.arrayContaining([expect.objectContaining({ source: 'current-source', confidence: 'strong', intent: 'superseded' })]) }),
      ]));
      expect(apply.changedItemIds).toEqual(expect.arrayContaining(['rocket-launcher', 'legacy-panel']));
      expect((await readBacklogItem(cwd, 'rocket-launcher'))?.status).toBe('shipped');
      expect((await readBacklogItem(cwd, 'legacy-panel'))?.status).toBe('superseded');
    });
  });

  it('keeps partial full-audit items in open recommendation lanes when curation only appends evidence', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'partial-widget', status: 'candidate', body: '# Partial Widget\n\n## Evidence\n\n- Prior\n' });
      await mkdir(join(cwd, 'src'), { recursive: true });
      await writeFile(join(cwd, 'src', 'partial-widget.ts'), 'Partial Widget partial-widget is partly implemented.\n');
      const source = await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false });
      const entry = await recordPlanningTaskWorkflowEntry(cwd, { taskId: 'task-1', originalRequest: '', derivedRequest: 'curate', selection: {}, requestedOutputSections: ['backlogCurationDraft', 'recommendations'], includeRoadmap: true, purpose: 'backlog-curation', sourceFingerprint: source.sourceFingerprint, createdAt: 'now' });
      const snapshot = await readBacklogItemSnapshot(cwd, 'partial-widget');
      const recommendations = { ...createEmptyRecommendationModel(), readyCandidates: [{ itemId: 'partial-widget', rationale: 'Still open after partial evidence.' }] };
      const task = curationTask(source.sourceFingerprint, {
        itemChanges: [{ kind: 'item', id: 'partial-widget', precondition: { kind: 'item', id: 'partial-widget', bodySha256: snapshot!.bodySha256, recordSha256: snapshot!.recordSha256 }, sectionOperations: [{ heading: 'Evidence', action: 'append', content: '- Partial implementation evidence remains open from src/partial-widget.ts.' }], rationale: 'Append partial evidence without closure.', evidence: ['Partial implementation evidence remains open from src/partial-widget.ts.'] }],
        epicChanges: [],
        noOpRechecks: [],
      }, recommendations);

      await writeBacklogCurationSourcePreviewMetadata(cwd, source);
      const preview = await previewBacklogCurationDraftFromTask(cwd, task, entry);
      const apply = await applyBacklogCurationDraftFromTask(cwd, task, { taskId: 'task-1', applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } }, entry);

      expect(preview.recommendationProjection?.removed.itemIds).toEqual([]);
      expect(preview.recommendationProjection?.effectiveRecommendations?.readyCandidates).toEqual([{ itemId: 'partial-widget', rationale: 'Still open after partial evidence.' }]);
      expect(apply.recommendations?.recommendations.readyCandidates).toEqual([{ itemId: 'partial-widget', rationale: 'Still open after partial evidence.' }]);
    });
  });

  it('rejects wrong-lane generated recommendations before backlog, recommendations, or baseline writes', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'candidate-item', status: 'candidate', body: '# Candidate\n\n## Claim\n\nNot active yet.\n' });
      const { source, entry } = await workflowEntry(cwd);
      const snapshot = await readBacklogItemSnapshot(cwd, 'candidate-item');
      const before = await readFile(resolveBacklogItemPath(cwd, 'candidate-item'), 'utf-8');
      const task = curationTask(source.sourceFingerprint, {
        itemChanges: [{ kind: 'item', id: 'candidate-item', precondition: { kind: 'item', id: 'candidate-item', bodySha256: snapshot!.bodySha256, recordSha256: snapshot!.recordSha256 }, sectionOperations: [{ heading: 'Claim', action: 'replace', content: 'Curated claim.' }], rationale: 'Refresh without activating.' }],
        epicChanges: [],
        noOpRechecks: [],
      }, { ...createEmptyRecommendationModel(), activeWork: [{ itemId: 'candidate-item', rationale: 'Wrong lane.' }] });

      await expect(applyBacklogCurationDraftFromTask(cwd, task, { taskId: 'task-1', applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } }, entry)).rejects.toThrow(/wrong-lane|activeWork|candidate-item/);
      expect(await readFile(resolveBacklogItemPath(cwd, 'candidate-item'), 'utf-8')).toBe(before);
      expect(await readRecommendations(cwd)).toBeNull();
      expect(await readAcceptedAnalysisBaseline(cwd)).toBeNull();
    });
  });

  it('records a backlog-curation accepted baseline after normal generated-recommendation apply', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', body: '# Item\n\n## Claim\n\nOld\n' });
      const { source, entry } = await workflowEntry(cwd);
      const snapshot = await readBacklogItemSnapshot(cwd, 'item-1');
      const task = curationTask(source.sourceFingerprint, {
        itemChanges: [{ kind: 'item', id: 'item-1', precondition: { kind: 'item', id: 'item-1', bodySha256: snapshot!.bodySha256, recordSha256: snapshot!.recordSha256 }, metadata: { status: 'planned' }, rationale: 'Ready to plan.' }],
        epicChanges: [],
        noOpRechecks: [],
      }, { ...createEmptyRecommendationModel(), readyCandidates: [{ itemId: 'item-1', rationale: 'Ready after curation.' }] });

      await applyBacklogCurationDraftFromTask(cwd, task, { taskId: 'task-1', applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } }, entry);

      expect(await readAcceptedAnalysisBaseline(cwd)).toMatchObject({ taskId: 'task-1', passKind: 'backlog-curation', sourceFingerprint: source.sourceFingerprint });
    });
  });

  it('records the accepted baseline using the workflow entry scan mode', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', body: '# Item\n\n## Claim\n\nOld\n' });
      await mkdir(join(cwd, 'src'), { recursive: true });
      await writeFile(join(cwd, 'src', 'item-1.ts'), 'item-1 implementation evidence.\n');
      const source = await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false });
      const entry = await recordPlanningTaskWorkflowEntry(cwd, { taskId: 'task-1', originalRequest: '', derivedRequest: 'curate', selection: {}, requestedOutputSections: ['backlogCurationDraft', 'recommendations'], includeRoadmap: true, purpose: 'backlog-curation', sourceFingerprint: source.sourceFingerprint, createdAt: 'now' });
      const snapshot = await readBacklogItemSnapshot(cwd, 'item-1');
      const task = curationTask(source.sourceFingerprint, {
        itemChanges: [{ kind: 'item', id: 'item-1', precondition: { kind: 'item', id: 'item-1', bodySha256: snapshot!.bodySha256, recordSha256: snapshot!.recordSha256 }, metadata: { status: 'planned' }, rationale: 'Ready to plan from full-audit metadata.', evidence: ['Implementation evidence from src/item-1.ts.'] }],
        epicChanges: [],
        noOpRechecks: [],
      });

      await writeBacklogCurationSourcePreviewMetadata(cwd, source);
      await applyBacklogCurationDraftFromTask(cwd, task, { taskId: 'task-1', applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } }, entry);

      expect(await readAcceptedAnalysisBaseline(cwd)).toMatchObject({ taskId: 'task-1', passKind: 'backlog-curation', sourceFingerprint: source.sourceFingerprint });
    });
  });

  it('records a backlog-curation baseline while curation-only apply skips recommendation writes', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', body: '# Item\n\n## Claim\n\nOld\n' });
      const { source, entry } = await workflowEntry(cwd);
      const snapshot = await readBacklogItemSnapshot(cwd, 'item-1');
      const task = curationTask(source.sourceFingerprint, {
        itemChanges: [{ kind: 'item', id: 'item-1', precondition: { kind: 'item', id: 'item-1', bodySha256: snapshot!.bodySha256, recordSha256: snapshot!.recordSha256 }, metadata: { status: 'planned' }, rationale: 'Ready to plan.' }],
        epicChanges: [],
        noOpRechecks: [],
      }, { ...createEmptyRecommendationModel(), activeWork: [{ itemId: 'missing-item', rationale: 'Invalid if applied.' }] });

      const result = await applyBacklogCurationDraftFromTask(cwd, task, { taskId: 'task-1', applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true, applyCurationOnly: true } }, entry);

      expect(result.recommendations).toBeUndefined();
      expect(result.recommendationsSkipped).toMatchObject({ reason: 'apply-curation-only' });
      expect(result.recommendationProjection?.validation.valid).toBe(false);
      expect(await readRecommendations(cwd)).toBeNull();
      expect(existsSync(resolveRecommendationsPathForCwd(cwd))).toBe(false);
      expect(await readAcceptedAnalysisBaseline(cwd)).toMatchObject({ taskId: 'task-1', passKind: 'backlog-curation', sourceFingerprint: source.sourceFingerprint });
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

  it('previews existing recommendations as stale against a prospective curation-only status change', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', body: '# Item\n\n## Claim\n\nOld\n' });
      await writeRecommendations(cwd, { ...createEmptyRecommendationModel(), readyCandidates: [{ itemId: 'item-1', rationale: 'Previously ready.' }] });
      await recordPlannerRecommendationApplied(cwd, 'test');
      const freshStatus = await readDerivedRecommendationStatus(cwd);
      expect(freshStatus.state).toBe('fresh');
      const { source, entry } = await workflowEntry(cwd);
      const snapshot = await readBacklogItemSnapshot(cwd, 'item-1');
      const task = curationTask(source.sourceFingerprint, {
        itemChanges: [{ kind: 'item', id: 'item-1', precondition: { kind: 'item', id: 'item-1', bodySha256: snapshot!.bodySha256, recordSha256: snapshot!.recordSha256 }, metadata: { status: 'planned' }, rationale: 'Substantive status change.' }],
        epicChanges: [],
        noOpRechecks: [],
      });

      const preview = await previewBacklogCurationDraftFromTask(cwd, task, entry);

      expect(preview.valid).toBe(true);
      expect(preview.recommendationFreshness?.state).toBe('stale');
      expect(preview.recommendationFreshness?.storedSourceFingerprint).toBe(freshStatus.lastAppliedSourceFingerprint);
      expect(preview.recommendationFreshness?.comparedSourceFingerprint).not.toBe(freshStatus.lastAppliedSourceFingerprint);
    });
  });

  it('enforces status-specific shipped and superseded evidence prefixes before writing', async () => {
    const cases = [
      { status: 'shipped', evidence: undefined, rejected: /Closed-status transitions.*durable evidence entries/i },
      { status: 'shipped', evidence: [`${SUPERSEDED_GIT_PR_EVIDENCE_PREFIX}wrong status`], rejected: /matching shipped evidence prefix/i },
      { status: 'shipped', evidence: [`${AMBIGUOUS_SHIPPED_EVIDENCE_PREFIX}ask human`], rejected: /matching shipped evidence prefix/i },
      { status: 'superseded', evidence: [`${SHIPPED_GIT_PR_EVIDENCE_PREFIX}wrong status`], rejected: /matching superseded evidence prefix/i },
      { status: 'superseded', evidence: [`${AMBIGUOUS_SUPERSEDED_EVIDENCE_PREFIX}ask human`], rejected: /matching superseded evidence prefix/i },
    ] as const;

    for (const testCase of cases) {
      await withTempProject(async (cwd) => {
        await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', body: '# Item\n\n## Evidence\n\n- Prior\n' });
        const { source, entry } = await workflowEntry(cwd);
        const snapshot = await readBacklogItemSnapshot(cwd, 'item-1');
        const before = await readFile(resolveBacklogItemPath(cwd, 'item-1'), 'utf-8');
        const task = curationTask(source.sourceFingerprint, {
          itemChanges: [{ kind: 'item', id: 'item-1', precondition: { kind: 'item', id: 'item-1', bodySha256: snapshot!.bodySha256, recordSha256: snapshot!.recordSha256 }, metadata: { status: testCase.status }, rationale: 'Attempt closed status without matching evidence.', ...(testCase.evidence !== undefined && { evidence: testCase.evidence }) }],
          epicChanges: [],
          noOpRechecks: [],
        });

        await expect(applyBacklogCurationDraftFromTask(cwd, task, { taskId: 'task-1', applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } }, entry)).rejects.toThrow(testCase.rejected);
        expect(await readFile(resolveBacklogItemPath(cwd, 'item-1'), 'utf-8')).toBe(before);
      });
    }
  });

  it('rejects historical closure prefixes in source-first mode but leaves stale evidence prefix-free', async () => {
    const rejectedCases = [
      { id: 'shipped-lifecycle', status: 'shipped', evidence: `${SHIPPED_LIFECYCLE_EVIDENCE_PREFIX}trace row landed` },
      { id: 'shipped-git', status: 'shipped', evidence: `${SHIPPED_GIT_PR_EVIDENCE_PREFIX}merge abc123` },
      { id: 'superseded-lifecycle', status: 'superseded', evidence: `${SUPERSEDED_LIFECYCLE_EVIDENCE_PREFIX}trace row superseded` },
      { id: 'superseded-git', status: 'superseded', evidence: `${SUPERSEDED_GIT_PR_EVIDENCE_PREFIX}obsolete merge abc123` },
    ] as const;

    for (const testCase of rejectedCases) {
      await withTempProject(async (cwd) => {
        await writeBacklogItem(cwd, { id: testCase.id, status: 'candidate', body: `# ${testCase.id}\n\n## Evidence\n\n- Prior\n` });
        const { source, entry } = await workflowEntry(cwd);
        const snapshot = await readBacklogItemSnapshot(cwd, testCase.id);
        const task = curationTask(source.sourceFingerprint, {
          itemChanges: [{ kind: 'item', id: testCase.id, precondition: { kind: 'item', id: testCase.id, bodySha256: snapshot!.bodySha256, recordSha256: snapshot!.recordSha256 }, metadata: { status: testCase.status }, rationale: 'Historical evidence is navigation only in source-first mode.', evidence: [testCase.evidence] }],
          epicChanges: [],
          noOpRechecks: [],
        });

        await expect(applyBacklogCurationDraftFromTask(cwd, task, { taskId: 'task-1', applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } }, entry)).rejects.toThrow(/matching .* evidence prefix|current source/i);
      });
    }

    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'stale-freeform', status: 'candidate', body: '# stale-freeform\n\n## Evidence\n\n- Prior\n' });
      const { source, entry } = await workflowEntry(cwd);
      const snapshot = await readBacklogItemSnapshot(cwd, 'stale-freeform');
      const task = curationTask(source.sourceFingerprint, {
        itemChanges: [{ kind: 'item', id: 'stale-freeform', precondition: { kind: 'item', id: 'stale-freeform', bodySha256: snapshot!.bodySha256, recordSha256: snapshot!.recordSha256 }, metadata: { status: 'stale' }, rationale: 'Manual stale evidence remains valid without a closure prefix.', evidence: ['Manual stale evidence remains valid without a closure prefix.'] }],
        epicChanges: [],
        noOpRechecks: [],
      });
      await applyBacklogCurationDraftFromTask(cwd, task, { taskId: 'task-1', applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } }, entry);
      expect((await readBacklogItem(cwd, 'stale-freeform'))?.status).toBe('stale');
    });
  });

  it('accepts reducer-shaped curation output through reducer validation and apply validation', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', body: '# Item\n\n## Claim\n\nOld\n' });
      const { source, entry } = await workflowEntry(cwd);
      const snapshot = await readBacklogItemSnapshot(cwd, 'item-1');
      const reducerResult = {
        summary: 'Reduced curation outcomes.',
        assumptionsOpenQuestions: [],
        backlogCurationDraft: {
          schemaVersion: 1,
          sourceFingerprint: source.sourceFingerprint,
          summary: ['Reducer accepted.'],
          itemChanges: [{ kind: 'item', id: 'item-1', precondition: { kind: 'item', id: 'item-1', bodySha256: snapshot!.bodySha256, recordSha256: snapshot!.recordSha256 }, metadata: { status: 'planned' }, rationale: 'Ready to plan from reducer finding.' }],
          epicChanges: [],
          noOpRechecks: [],
          skipped: [],
          needsInput: [],
        },
      };

      await expect(validateBacklogCurationPlanningDraftResult(cwd, reducerResult, { sourceFingerprint: source.sourceFingerprint })).resolves.toEqual([]);
      const task = { taskId: 'task-1', kind: 'eforge-plan.planning-draft', status: 'completed', result: reducerResult };
      await expect(previewBacklogCurationDraftFromTask(cwd, task, entry)).resolves.toMatchObject({ valid: true, itemChanges: 1 });
      await expect(applyBacklogCurationDraftFromTask(cwd, task, { taskId: 'task-1', applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } }, entry)).resolves.toMatchObject({ changedItemIds: ['item-1'] });
    });
  });

  it('rejects invalid reducer-shaped curation outputs through existing validation', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', body: '# Item\n\n## Evidence\n\n- Prior\n' });
      const { source } = await workflowEntry(cwd);
      const snapshot = await readBacklogItemSnapshot(cwd, 'item-1');
      const validPatch = { kind: 'item', id: 'item-1', precondition: { kind: 'item', id: 'item-1', bodySha256: snapshot!.bodySha256, recordSha256: snapshot!.recordSha256 }, metadata: { status: 'planned' }, rationale: 'Reducer patch.' };
      const cases = [
        { name: 'stale precondition', patch: { ...validPatch, precondition: { ...validPatch.precondition, bodySha256: '0'.repeat(64) } }, expected: /precondition.*stale|bodySha256/i },
        { name: 'invalid status', patch: { ...validPatch, metadata: { status: 'not-a-status' } }, expected: /Unknown backlog status|metadata\.status/i },
        { name: 'invalid evidence', patch: { ...validPatch, metadata: { status: 'shipped' }, evidence: ['Historical closure without a matching current-source prefix.'] }, expected: /evidence|matching shipped/i },
      ];

      for (const testCase of cases) {
        const result = {
          summary: testCase.name,
          assumptionsOpenQuestions: [],
          backlogCurationDraft: { schemaVersion: 1, sourceFingerprint: source.sourceFingerprint, summary: [], itemChanges: [testCase.patch], epicChanges: [], noOpRechecks: [], skipped: [], needsInput: [] },
        };
        const errors = await validateBacklogCurationPlanningDraftResult(cwd, result, { sourceFingerprint: source.sourceFingerprint });
        expect(errors.join('\n'), testCase.name).toMatch(testCase.expected);
      }
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
