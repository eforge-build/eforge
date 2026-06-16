import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readRoadmapState, updateRoadmapState } from '../roadmap-context.js';

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-roadmap-context-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

describe('roadmap context backend', () => {
  it('stores and projects local focus roadmap from private storage', async () => {
    await withTempProject(async (cwd) => {
      const state = await updateRoadmapState(cwd, { localFocusContent: '# Focus\n\nShip local roadmaps.\n' });
      expect(existsSync(join(cwd, '.eforge/storage/extensions/eforge-plan/roadmaps/local-focus.md'))).toBe(true);
      expect(state.context.localSteering).toMatchObject({ path: '.eforge/storage/extensions/eforge-plan/roadmaps/local-focus.md', kind: 'local-focus', role: 'local-steering', configured: true, editable: true, exists: true });
      expect(state.context.localSteering.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect((await readRoadmapState(cwd, { includeLocalFocusContent: true })).context.localSteering.content).toContain('Ship local roadmaps');
    });
  });

  it('projects configured shared sources and discovers conventional roadmap only when unconfigured', async () => {
    await withTempProject(async (cwd) => {
      await mkdir(join(cwd, 'docs'), { recursive: true });
      await writeFile(join(cwd, 'docs/roadmap.md'), '# Roadmap\n\nConventional.\n');
      await writeFile(join(cwd, 'docs/shared.md'), '# Shared\n\nConfigured.\n');
      const discovered = await readRoadmapState(cwd);
      expect(discovered.context.discoveredContextSources[0]).toMatchObject({ kind: 'discovered-conventional', role: 'shared-context', configured: false, path: 'docs/roadmap.md' });
      const configured = await updateRoadmapState(cwd, { sharedSources: [{ id: 'shared', path: 'docs/shared.md', label: 'Shared source' }, { id: 'roadmap', path: 'docs/roadmap.md' }] });
      expect(configured.context.sharedContextSources.map((source) => source.path)).toEqual(['docs/shared.md', 'docs/roadmap.md']);
      expect(configured.context.sharedContextSources[0]).toMatchObject({ kind: 'configured-shared', role: 'shared-context', editable: false, configured: true, label: 'Shared source' });
      expect(configured.context.discoveredContextSources).toEqual([]);
    });
  });

  it('surfaces missing, duplicate, and invalid config conflicts from manually edited config', async () => {
    await withTempProject(async (cwd) => {
      await mkdir(join(cwd, '.eforge/storage/extensions/eforge-plan/roadmaps'), { recursive: true });
      await writeFile(join(cwd, '.eforge/storage/extensions/eforge-plan/roadmaps/config.json'), JSON.stringify({ schemaVersion: 1, sharedSources: [{ id: 'dup', path: 'missing.md' }, { id: 'dup', path: 'missing.md' }] }));
      const state = await readRoadmapState(cwd);
      expect(state.context.sharedContextSources).toHaveLength(2);
      expect(state.context.conflicts.map((conflict) => conflict.code)).toEqual(expect.arrayContaining(['duplicate-source', 'configured-source-missing']));
      await writeFile(join(cwd, '.eforge/storage/extensions/eforge-plan/roadmaps/config.json'), '{bad json');
      const invalid = await readRoadmapState(cwd);
      expect(invalid.context.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid-config', path: '.eforge/storage/extensions/eforge-plan/roadmaps/config.json' })]));
    });
  });

  it('rejects unsafe configured paths, stale local focus hashes, and bounds long excerpts', async () => {
    await withTempProject(async (cwd) => {
      for (const path of ['../roadmap.md', '/tmp/roadmap.md', 'C:/roadmap.md', 'bad\0path.md']) {
        await expect(updateRoadmapState(cwd, { sharedSources: [{ id: 'bad', path }] })).rejects.toThrow(/path/);
      }
      await expect(updateRoadmapState(cwd, { sharedSources: [], expectedLocalFocusSha256: '0'.repeat(64) })).rejects.toThrow(/Local focus roadmap changed/);
      await mkdir(join(cwd, 'docs'), { recursive: true });
      await writeFile(join(cwd, 'docs/shared.md'), `# ${'H'.repeat(250)}\n\nFirst.\n\nSecond.\n\nThird.\n\nFourth.\n\nFifth.\n\nSixth.\n\n${'Long paragraph. '.repeat(2000)}\n`);
      const state = await updateRoadmapState(cwd, { sharedSources: [{ id: 'shared', path: 'docs/shared.md' }] });
      const source = state.context.sharedContextSources[0]!;
      expect(source.headings[0]!.length).toBeLessThanOrEqual(201);
      expect(source.excerpts).toHaveLength(5);
      expect(state.context.truncation.sourceExcerpts).toBeGreaterThan(0);
      expect(state.context.truncation.sourceContent).toBeGreaterThan(0);
      expect(await readFile(join(cwd, 'docs/shared.md'), 'utf-8')).toContain('Long paragraph');
    });
  });

  it('reports source read errors for discovered roadmap sources', async () => {
    await withTempProject(async (cwd) => {
      await mkdir(join(cwd, 'docs/roadmap.md'), { recursive: true });
      const state = await readRoadmapState(cwd);
      expect(state.context.discoveredContextSources[0]).toMatchObject({ path: 'docs/roadmap.md', readError: expect.stringContaining('Failed to read roadmap source') });
      expect(state.context.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'source-read-error', path: 'docs/roadmap.md' })]));
    });
  });
});
