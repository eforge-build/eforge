import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildBacklogCurationSource } from '../backlog-curation-source.js';
import { writeBacklogItem } from '../markdown-store.js';
import { preparePlannerContext } from '../planner-orchestration.js';
import { buildRecommendationRefreshSource } from '../recommendation-refresh.js';
import { buildRecommendationSourceProjection, computeRecommendationSourceFingerprint } from '../recommendation-status.js';
import { updateRoadmapState } from '../roadmap-context.js';

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-roadmap-integration-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

async function seed(cwd: string) {
  await writeBacklogItem(cwd, { id: 'item-one', status: 'candidate', body: '# Item One\n\n## Claim\n\nPlan it.\n' });
}

async function seedRoadmapContext(cwd: string) {
  await mkdir(join(cwd, 'docs'), { recursive: true });
  await writeFile(join(cwd, 'docs/roadmap.md'), '# Roadmap\n\n## Next\n\nPlan.\n');
  await writeFile(join(cwd, 'docs/shared.md'), '# Shared\n\nShared direction.\n');
  await updateRoadmapState(cwd, {
    localFocusContent: '# Focus\n\nLocal direction.\n',
    sharedSources: [{ id: 'shared', path: 'docs/shared.md', label: 'Shared source' }],
  });
}

function parseJsonObject(text: string): Record<string, unknown> {
  return JSON.parse(text) as Record<string, unknown>;
}

function expectRoadmapContextFields(payload: { roadmapContext?: unknown }) {
  expect(payload).toHaveProperty('roadmapContext.localSteering');
  expect(payload).toHaveProperty('roadmapContext.sharedContextSources');
  expect(payload).toHaveProperty('roadmapContext.discoveredContextSources');
  expect(payload.roadmapContext).toMatchObject({ localSteering: { kind: 'local-focus', exists: true } });
  expect(payload.roadmapContext).toEqual(expect.objectContaining({
    sharedContextSources: expect.arrayContaining([expect.objectContaining({ id: 'shared', path: 'docs/shared.md', label: 'Shared source' })]),
    discoveredContextSources: expect.arrayContaining([expect.objectContaining({ path: 'docs/roadmap.md', kind: 'discovered-conventional' })]),
  }));
}

describe('roadmap context integration', () => {
  it('preparePlannerContext uses roadmapContext and honors includeRoadmap false', async () => {
    await withTempProject(async (cwd) => {
      await seed(cwd);
      await seedRoadmapContext(cwd);
      const packet = await preparePlannerContext(cwd);
      expectRoadmapContextFields(packet);
      expect(packet).not.toHaveProperty('roadmapEvidence');
      const omitted = await preparePlannerContext(cwd, { includeRoadmap: false });
      expect(omitted.roadmapContext.sharedContextSources).toEqual([]);
      expect(omitted.roadmapContext.discoveredContextSources).toEqual([]);
      expect(omitted.roadmapContext.assumptions.join('\n')).toMatch(/includeRoadmap was false/);
    });
  });

  it('curation and recommendation fingerprints drift with roadmap context changes', async () => {
    await withTempProject(async (cwd) => {
      await seed(cwd);
      const curation = await buildBacklogCurationSource(cwd);
      await updateRoadmapState(cwd, { localFocusContent: '# Focus\n\nLocal direction.\n' });
      const afterLocal = await buildBacklogCurationSource(cwd);
      expect(afterLocal.sourceFingerprint).not.toBe(curation.sourceFingerprint);
      expect(afterLocal.sourceText).toContain('roadmapContext');
      await mkdir(join(cwd, 'docs'), { recursive: true });
      await writeFile(join(cwd, 'docs/roadmap.md'), '# Roadmap\n\nConventional direction.\n');
      await writeFile(join(cwd, 'docs/shared.md'), '# Shared\n\nInitial.\n');
      const firstRecommendation = await computeRecommendationSourceFingerprint(cwd);
      await updateRoadmapState(cwd, { sharedSources: [{ id: 'shared', path: 'docs/shared.md', label: 'Shared source' }] });
      const afterRoadmapCuration = await buildBacklogCurationSource(cwd);
      expectRoadmapContextFields(afterRoadmapCuration.source);
      expectRoadmapContextFields(parseJsonObject(afterRoadmapCuration.sourceText));
      const afterConfig = await computeRecommendationSourceFingerprint(cwd);
      await writeFile(join(cwd, 'docs/shared.md'), '# Shared\n\nChanged.\n');
      const afterSharedChange = await computeRecommendationSourceFingerprint(cwd);
      expect(afterConfig).not.toBe(firstRecommendation);
      expect(afterSharedChange).not.toBe(afterConfig);
    });
  });

  it('recommendation projection and refresh source include roadmap context details', async () => {
    await withTempProject(async (cwd) => {
      await seed(cwd);
      await mkdir(join(cwd, 'docs'), { recursive: true });
      await writeFile(join(cwd, 'docs/roadmap.md'), '# Roadmap\n\nConventional.\n');
      await writeFile(join(cwd, 'docs/shared.md'), '# Shared\n\nShared.\n');
      await updateRoadmapState(cwd, {
        localFocusContent: '# Focus\n\nLocal.\n',
        sharedSources: [
          { id: 'shared', path: 'docs/shared.md', label: 'Shared source' },
          { id: 'missing', path: 'docs/missing-shared.md', label: 'Missing shared' },
        ],
      });
      const projection = await buildRecommendationSourceProjection(cwd);
      expectRoadmapContextFields(projection);
      expect(projection.roadmapContext).toEqual(expect.objectContaining({ sharedContextSources: expect.arrayContaining([expect.objectContaining({ label: 'Missing shared' })]) }));
      const refresh = await buildRecommendationRefreshSource(cwd);
      const refreshSource = parseJsonObject(refresh.sourceText);
      const refreshContext = refreshSource.context as Record<string, unknown>;
      expectRoadmapContextFields(refreshContext);
      expect(JSON.stringify(refreshContext.roadmapContext)).toMatch(/Missing shared|configured-source-missing/);
      expect(refreshSource).toHaveProperty('context.sourceFingerprint');
    });
  });
});
