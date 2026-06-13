import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { BACKLOG_CURATION_SHIPPED_EVIDENCE_CONTEXT_CAPS, buildBacklogCurationSource } from '../backlog-curation-source.js';
import { listBacklogEpicSnapshots, listBacklogItemSnapshots, writeBacklogEpic, writeBacklogItem } from '../markdown-store.js';
import { createTraceSidecar, writeTraceSidecar } from '../trace-store.js';

const execFile = promisify(execFileCallback);

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-curation-source-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

describe('backlog curation source', () => {
  it('retains every visible open item and precondition when the backlog exceeds planner bounds', async () => {
    await withTempProject(async (cwd) => {
      for (let index = 0; index < 30; index += 1) await writeBacklogItem(cwd, { id: `item-${index}`, status: 'candidate', body: `# Item ${index}\n\n## Claim\n\nClaim ${index}\n` });
      const snapshots = await listBacklogItemSnapshots(cwd);
      const source = await buildBacklogCurationSource(cwd);
      const packet = source.source as { openItems: Array<{ id: string; precondition: { bodySha256: string; recordSha256: string } }> };
      expect(packet.openItems.map((item) => item.id)).toHaveLength(30);
      for (const snapshot of snapshots) {
        const projected = packet.openItems.find((item) => item.id === snapshot.id);
        expect(projected?.precondition.bodySha256).toBe(snapshot.bodySha256);
        expect(projected?.precondition.recordSha256).toBe(snapshot.recordSha256);
      }
    });
  });

  it('returns valid compact JSON with every open item id and precondition when planner text needs a minimal fallback', async () => {
    await withTempProject(async (cwd) => {
      for (let index = 0; index < 500; index += 1) await writeBacklogItem(cwd, { id: `item-${index}`, status: 'candidate', body: `# Item ${index}\n\n## Claim\n\n${'Large claim. '.repeat(80)}\n` });
      const snapshots = await listBacklogItemSnapshots(cwd);
      const source = await buildBacklogCurationSource(cwd);
      const packet = JSON.parse(source.sourceText) as { openItems: Array<{ id: string; precondition: { bodySha256: string; recordSha256: string } }> };

      expect(packet.openItems).toHaveLength(500);
      for (const snapshot of snapshots) {
        const projected = packet.openItems.find((item) => item.id === snapshot.id);
        expect(projected?.precondition.bodySha256).toBe(snapshot.bodySha256);
        expect(projected?.precondition.recordSha256).toBe(snapshot.recordSha256);
      }
    });
  });

  it('records origin, relative path, body hash, record hash, and updated preconditions', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', updated: '2026-01-01T00:00:00.000Z', body: '# Item 1\n\n## Claim\n\nClaim\n' });
      await writeBacklogEpic(cwd, { id: 'epic-1', status: 'candidate', updated: '2026-01-02T00:00:00.000Z', body: '# Epic 1\n\n## Goal\n\nGoal\n' });
      const source = await buildBacklogCurationSource(cwd);
      const packet = source.source as { openItems: Array<{ id: string; precondition: Record<string, string> }>; openEpics: Array<{ id: string; precondition: Record<string, string> }> };

      expect(packet.openItems[0]?.precondition).toMatchObject({ origin: 'private', relativePath: '.eforge/storage/extensions/eforge-plan/backlog/items/item-1.md', updated: '2026-01-01T00:00:00.000Z', bodySha256: expect.stringMatching(/^[a-f0-9]{64}$/), recordSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
      expect(packet.openEpics[0]?.precondition).toMatchObject({ origin: 'private', relativePath: '.eforge/storage/extensions/eforge-plan/backlog/epics/epic-1.md', updated: '2026-01-02T00:00:00.000Z', bodySha256: expect.stringMatching(/^[a-f0-9]{64}$/), recordSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    });
  });

  it('includes freshness metadata and dependency status details for planner noise control', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'open-dep', status: 'planned', body: '# Open dependency\n' });
      await writeBacklogItem(cwd, { id: 'closed-dep', status: 'shipped', body: '# Closed dependency\n' });
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', last_checked: '2026-01-01', stale_after: '2026-02-01', depends_on: ['open-dep', 'closed-dep', 'missing-dep'], recheck_notes: 'Recheck only after product direction changes.', body: '# Item 1\n\n## Claim\n\nClaim\n' });
      const source = await buildBacklogCurationSource(cwd);
      const packet = source.source as { openItems: Array<Record<string, unknown>>; dependencyDetails: Array<{ itemId: string; openDependsOn: Array<Record<string, unknown>>; closedDependsOn: Array<Record<string, unknown>>; missingDependsOn: Array<Record<string, unknown>> }> };
      const details = packet.dependencyDetails.find((entry) => entry.itemId === 'item-1');

      expect(packet.openItems.find((item) => item.id === 'item-1')).toMatchObject({ id: 'item-1', last_checked: '2026-01-01', stale_after: '2026-02-01', recheck_notes: 'Recheck only after product direction changes.' });
      expect(details).toMatchObject({
        itemId: 'item-1',
        openDependsOn: [{ id: 'open-dep', title: 'Open dependency', status: 'planned' }],
        closedDependsOn: [{ id: 'closed-dep', title: 'Closed dependency', status: 'shipped' }],
        missingDependsOn: [{ id: 'missing-dep' }],
      });
      expect(packet).not.toHaveProperty('dependencies');
    });
  });

  it('changes the source fingerprint when item bodies or roadmap evidence changes', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', body: '# Item 1\n\n## Claim\n\nClaim\n' });
      const first = await buildBacklogCurationSource(cwd);
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', body: '# Item 1\n\n## Claim\n\nChanged claim\n' });
      const afterBodyChange = await buildBacklogCurationSource(cwd);
      await mkdir(join(cwd, 'docs'), { recursive: true });
      await writeFile(join(cwd, 'docs', 'roadmap.md'), '# Roadmap\n\n## Next\n\nCurate all backlog items.\n');
      const afterRoadmapChange = await buildBacklogCurationSource(cwd);

      expect(afterBodyChange.sourceFingerprint).not.toBe(first.sourceFingerprint);
      expect(afterRoadmapChange.sourceFingerprint).not.toBe(afterBodyChange.sourceFingerprint);
    });
  });

  it('retains every visible open epic and precondition when the backlog exceeds planner bounds', async () => {
    await withTempProject(async (cwd) => {
      for (let index = 0; index < 12; index += 1) await writeBacklogEpic(cwd, { id: `epic-${index}`, status: 'candidate', body: `# Epic ${index}\n\n## Goal\n\nGoal ${index}\n` });
      const snapshots = await listBacklogEpicSnapshots(cwd);
      const source = await buildBacklogCurationSource(cwd);
      const packet = source.source as { openEpics: Array<{ id: string; precondition: { bodySha256: string; recordSha256: string } }> };
      expect(packet.openEpics.map((epic) => epic.id)).toHaveLength(12);
      for (const snapshot of snapshots) {
        const projected = packet.openEpics.find((epic) => epic.id === snapshot.id);
        expect(projected?.precondition.bodySha256).toBe(snapshot.bodySha256);
        expect(projected?.precondition.recordSha256).toBe(snapshot.recordSha256);
      }
    });
  });

  it('includes bounded strong git-history shipped evidence with commit, PR, and path citations and no full diff', async () => {
    await withTempProject(async (cwd) => {
      await initRepo(cwd);
      await writeFile(join(cwd, 'README.md'), 'base\n');
      await git(cwd, ['add', 'README.md']);
      await git(cwd, ['commit', '-m', 'initial']);
      await writeBacklogItem(cwd, { id: 'ship-evidence-provider', status: 'candidate', body: '# Shipped Evidence Provider\n\n## Claim\n\nDetect shipped evidence.\n' });
      await git(cwd, ['checkout', '-b', 'feature/ship-evidence-provider']);
      await mkdir(join(cwd, 'src'), { recursive: true });
      await writeFile(join(cwd, 'src', 'shipped-evidence-provider.ts'), 'export const note = "Shipped Evidence Provider ship-evidence-provider";\n');
      await git(cwd, ['add', 'src/shipped-evidence-provider.ts']);
      await git(cwd, ['commit', '-m', 'feat(ship-evidence-provider): shipped evidence provider']);
      await git(cwd, ['checkout', 'main']);
      await git(cwd, ['merge', '--no-ff', 'feature/ship-evidence-provider', '-m', 'Merge pull request #191 from owner/feature/ship-evidence-provider']);

      const source = await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false });
      const packet = source.source as { shippedEvidenceCandidates: Array<Record<string, unknown>>; truncation: Record<string, number> };
      const candidate = packet.shippedEvidenceCandidates.find((entry) => entry.itemId === 'ship-evidence-provider');

      expect(candidate).toMatchObject({ itemId: 'ship-evidence-provider', confidence: 'strong', source: 'git-history', evidenceLabel: 'Shipped evidence: inferred from git/PR history' });
      expect(candidate?.commit).toMatchObject({ shortHash: expect.stringMatching(/^[a-f0-9]{7,12}$/), subject: expect.stringContaining('Merge pull request #191') });
      expect(candidate?.changedPaths).toEqual(expect.arrayContaining(['src/shipped-evidence-provider.ts']));
      expect(candidate?.citations).toEqual([expect.stringContaining('git ')]);
      const serialized = JSON.stringify(candidate);
      expect(serialized).not.toContain('@@');
      expect((candidate?.changedPaths as unknown[]).length).toBeLessThanOrEqual(BACKLOG_CURATION_SHIPPED_EVIDENCE_CONTEXT_CAPS.changedPathCount);
      expect((candidate?.excerpts as unknown[]).length).toBeLessThanOrEqual(BACKLOG_CURATION_SHIPPED_EVIDENCE_CONTEXT_CAPS.excerptCount);
    });
  });

  it('includes ambiguous git-history shipped evidence candidates in source context and source text', async () => {
    await withTempProject(async (cwd) => {
      await initRepo(cwd);
      await writeFile(join(cwd, 'README.md'), 'base\n');
      await git(cwd, ['add', 'README.md']);
      await git(cwd, ['commit', '-m', 'initial']);
      await writeBacklogItem(cwd, { id: 'ambiguous-candidate', status: 'candidate', body: '# Ambiguous Candidate\n' });
      await writeFile(join(cwd, 'unrelated.ts'), 'unrelated implementation\n');
      await git(cwd, ['add', 'unrelated.ts']);
      await git(cwd, ['commit', '-m', 'ship ambiguous-candidate']);

      const source = await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false });
      const packet = source.source as { shippedEvidenceCandidates: Array<Record<string, unknown>> };
      const parsed = JSON.parse(source.sourceText) as { shippedEvidenceCandidates: Array<Record<string, unknown>> };
      const candidate = packet.shippedEvidenceCandidates.find((entry) => entry.itemId === 'ambiguous-candidate');
      const textCandidate = parsed.shippedEvidenceCandidates.find((entry) => entry.itemId === 'ambiguous-candidate');

      expect(candidate).toMatchObject({ itemId: 'ambiguous-candidate', confidence: 'ambiguous', evidenceLabel: 'Ambiguous shipped candidate: needs input' });
      expect(textCandidate).toMatchObject({ itemId: 'ambiguous-candidate', confidence: 'ambiguous', evidenceLabel: 'Ambiguous shipped candidate: needs input' });
    });
  });

  it('projects successful PR metadata enrichment into shipped evidence source context and text', async () => {
    await withTempProject(async (cwd) => {
      await initRepo(cwd);
      await writeFile(join(cwd, 'README.md'), 'base\n');
      await git(cwd, ['add', 'README.md']);
      await git(cwd, ['commit', '-m', 'initial']);
      await writeBacklogItem(cwd, { id: 'enriched-pr', status: 'candidate', body: '# Enriched PR\n' });
      await git(cwd, ['checkout', '-b', 'feature/enriched-pr']);
      await mkdir(join(cwd, 'src'), { recursive: true });
      await writeFile(join(cwd, 'src', 'enriched-pr.ts'), 'Enriched PR enriched-pr\n');
      await git(cwd, ['add', 'src/enriched-pr.ts']);
      await git(cwd, ['commit', '-m', 'feat: enriched pr']);
      await git(cwd, ['checkout', 'main']);
      await git(cwd, ['merge', '--no-ff', 'feature/enriched-pr', '-m', 'Merge pull request #222 from owner/feature/enriched-pr']);
      const fakeBin = join(cwd, 'fake-bin');
      await mkdir(fakeBin, { recursive: true });
      await writeFile(join(fakeBin, 'gh'), '#!/usr/bin/env node\nconsole.log(JSON.stringify({ number: 222, title: "Ship enriched PR metadata", headRefName: "feature/enriched-pr", state: "MERGED", mergedAt: "2026-01-01T00:00:00Z", mergeCommit: {}, files: [{ path: "src/enriched-pr.ts" }] }));\n');
      await chmod(join(fakeBin, 'gh'), 0o755);
      const previousPath = process.env.PATH;
      process.env.PATH = `${fakeBin}${delimiter}${previousPath ?? ''}`;
      try {
        const source = await buildBacklogCurationSource(cwd, undefined, { shippedEvidenceCaps: { prEnrichmentCount: 1 } });
        const packet = source.source as { shippedEvidenceCandidates: Array<Record<string, unknown>> };
        const candidate = packet.shippedEvidenceCandidates.find((entry) => entry.itemId === 'enriched-pr');
        const parsed = JSON.parse(source.sourceText) as { shippedEvidenceCandidates: Array<Record<string, unknown>> };
        const textCandidate = parsed.shippedEvidenceCandidates.find((entry) => entry.itemId === 'enriched-pr');

        expect(candidate).toMatchObject({ pr: { number: 222, title: 'Ship enriched PR metadata', branch: 'feature/enriched-pr' } });
        expect(textCandidate).toMatchObject({ pr: { number: 222, title: 'Ship enriched PR metadata', branch: 'feature/enriched-pr' } });
        expect(source.sourceText).toContain('Ship enriched PR metadata');
        expect(source.sourceText).toContain('feature/enriched-pr');
      } finally {
        process.env.PATH = previousPath;
      }
    });
  });

  it('returns source text and git-only candidates when PR metadata enrichment is unavailable', async () => {
    await withTempProject(async (cwd) => {
      await initRepo(cwd);
      await writeFile(join(cwd, 'README.md'), 'base\n');
      await git(cwd, ['add', 'README.md']);
      await git(cwd, ['commit', '-m', 'initial']);
      await writeBacklogItem(cwd, { id: 'fallback-pr', status: 'candidate', body: '# Fallback PR Item\n' });
      await writeFile(join(cwd, 'fallback-pr.ts'), 'Fallback PR Item fallback-pr\n');
      await git(cwd, ['add', 'fallback-pr.ts']);
      await git(cwd, ['commit', '-m', 'Merge pull request #999999 from owner/fallback-pr']);

      const source = await buildBacklogCurationSource(cwd, undefined, { shippedEvidenceCaps: { subprocessTimeoutMs: 1000, prEnrichmentCount: 1 } });
      const packet = JSON.parse(source.sourceText) as { shippedEvidenceCandidates: Array<Record<string, unknown>>; shippedEvidenceDiagnostics: Array<{ code: string }> };

      expect(packet.shippedEvidenceCandidates.some((candidate) => candidate.itemId === 'fallback-pr' && candidate.source === 'git-history')).toBe(true);
      expect(packet.shippedEvidenceDiagnostics.some((diagnostic) => diagnostic.code.startsWith('pr'))).toBe(true);
    });
  });

  it('caps shipped evidence candidates and keeps them in compact source text fallback', async () => {
    await withTempProject(async (cwd) => {
      await writeCappedLifecycleEvidence(cwd, { itemCount: 40, bodyRepeat: 500 });

      const source = await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false });
      const packet = JSON.parse(source.sourceText) as { openItems: Array<Record<string, unknown>>; shippedEvidenceCandidates: unknown[]; shippedEvidenceCandidateCounts: Record<string, unknown>; shippedEvidenceDiagnostics: unknown[]; truncation: { shippedEvidenceCandidates: number; fallback?: string } };

      expect(packet.openItems[0]).not.toHaveProperty('sections');
      expect(packet.truncation.fallback).toBeUndefined();
      expect(packet.shippedEvidenceCandidates.length).toBeLessThanOrEqual(BACKLOG_CURATION_SHIPPED_EVIDENCE_CONTEXT_CAPS.candidateCount);
      expect(packet.truncation.shippedEvidenceCandidates).toBeGreaterThan(0);
      expect(packet.shippedEvidenceCandidateCounts).toMatchObject({ included: packet.shippedEvidenceCandidates.length });
      expect(packet.shippedEvidenceDiagnostics).toBeDefined();
    });
  });

  it('keeps shipped evidence in minimal source text fallback', async () => {
    await withTempProject(async (cwd) => {
      await writeCappedLifecycleEvidence(cwd, { itemCount: 40, bodyRepeat: 500, evidenceNoteRepeat: 1000 });

      const source = await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false });
      const packet = JSON.parse(source.sourceText) as { shippedEvidenceCandidates: unknown[]; shippedEvidenceCandidateCounts: Record<string, unknown>; shippedEvidenceDiagnostics: unknown[]; truncation: { shippedEvidenceCandidates: number; fallback?: string } };

      expect(packet.truncation.fallback).toBe('minimal');
      expect(packet.shippedEvidenceCandidates.length).toBeLessThanOrEqual(BACKLOG_CURATION_SHIPPED_EVIDENCE_CONTEXT_CAPS.candidateCount);
      expect(packet.truncation.shippedEvidenceCandidates).toBeGreaterThan(0);
      expect(packet.shippedEvidenceCandidateCounts).toMatchObject({ included: packet.shippedEvidenceCandidates.length });
      expect(packet.shippedEvidenceDiagnostics).toBeDefined();
    });
  });

  it('omits weak git-history shipped evidence candidates from source context and source text', async () => {
    await withTempProject(async (cwd) => {
      await initRepo(cwd);
      await writeFile(join(cwd, 'README.md'), 'base\n');
      await git(cwd, ['add', 'README.md']);
      await git(cwd, ['commit', '-m', 'initial']);
      await writeBacklogItem(cwd, { id: 'api-ui', status: 'candidate', body: '# API UI\n' });
      await writeFile(join(cwd, 'api.ts'), 'api helper\n');
      await git(cwd, ['add', 'api.ts']);
      await git(cwd, ['commit', '-m', 'update api ui tests']);

      const source = await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false });
      const packet = source.source as { shippedEvidenceCandidates: Array<Record<string, unknown>>; shippedEvidenceCandidateCounts: { weakOmitted: number }; truncation: { shippedEvidenceCandidates: number } };
      const parsed = JSON.parse(source.sourceText) as { shippedEvidenceCandidates: Array<Record<string, unknown>>; shippedEvidenceCandidateCounts: { weakOmitted: number }; truncation: { shippedEvidenceCandidates: number } };

      expect(packet.shippedEvidenceCandidates.some((candidate) => candidate.itemId === 'api-ui')).toBe(false);
      expect(parsed.shippedEvidenceCandidates.some((candidate) => candidate.itemId === 'api-ui')).toBe(false);
      expect(packet.shippedEvidenceCandidateCounts.weakOmitted).toBeGreaterThan(0);
      expect(parsed.shippedEvidenceCandidateCounts.weakOmitted).toBe(packet.shippedEvidenceCandidateCounts.weakOmitted);
      expect(packet.truncation.shippedEvidenceCandidates).toBeGreaterThan(0);
    });
  });

  it('prioritizes lifecycle trace shipped evidence ahead of git-history evidence with lifecycle labeling', async () => {
    await withTempProject(async (cwd) => {
      await initRepo(cwd);
      await writeFile(join(cwd, 'README.md'), 'base\n');
      await git(cwd, ['add', 'README.md']);
      await git(cwd, ['commit', '-m', 'initial']);
      await writeBacklogItem(cwd, { id: 'lifecycle-first', status: 'candidate', body: '# Lifecycle First\n' });
      const trace = createTraceSidecar('lifecycle-first');
      trace.landingResults.push({ featureBranch: 'feature/lifecycle-first', commitSha: '1234567890abcdef', status: 'shipped', path: 'src/lifecycle-first.ts', landedAt: '2026-01-01T00:00:00.000Z' });
      await writeTraceSidecar(cwd, trace);
      await mkdir(join(cwd, 'src'), { recursive: true });
      await writeFile(join(cwd, 'src', 'lifecycle-first.ts'), 'Lifecycle First lifecycle-first\n');
      await git(cwd, ['add', 'src/lifecycle-first.ts']);
      await git(cwd, ['commit', '-m', 'Merge pull request #401 from owner/lifecycle-first']);

      const source = await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false });
      const packet = source.source as { shippedEvidenceCandidates: Array<Record<string, unknown>> };

      expect(packet.shippedEvidenceCandidates[0]).toMatchObject({ itemId: 'lifecycle-first', source: 'lifecycle-trace', evidenceLabel: 'Shipped evidence: lifecycle trace' });
      expect(packet.shippedEvidenceCandidates.some((candidate, index) => index > 0 && candidate.itemId === 'lifecycle-first' && candidate.source === 'git-history')).toBe(true);
    });
  });

  it('changes the source fingerprint when reachable git shipped evidence changes for the same open item', async () => {
    await withTempProject(async (cwd) => {
      await initRepo(cwd);
      await writeFile(join(cwd, 'README.md'), 'base\n');
      await git(cwd, ['add', 'README.md']);
      await git(cwd, ['commit', '-m', 'initial']);
      await writeBacklogItem(cwd, { id: 'fingerprint-item', status: 'candidate', body: '# Fingerprint Item\n' });
      const first = await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false });
      await writeFile(join(cwd, 'fingerprint-item.ts'), 'Fingerprint Item fingerprint-item\n');
      await git(cwd, ['add', 'fingerprint-item.ts']);
      await git(cwd, ['commit', '-m', 'Merge pull request #401 from owner/fingerprint-item']);
      const second = await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false });
      const third = await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false });

      expect(second.sourceFingerprint).not.toBe(first.sourceFingerprint);
      expect(third.sourceFingerprint).toBe(second.sourceFingerprint);
    });
  });
});

async function writeCappedLifecycleEvidence(cwd: string, options: { itemCount: number; bodyRepeat: number; evidenceNoteRepeat?: number }): Promise<void> {
  for (let index = 0; index < options.itemCount; index += 1) {
    const id = `cap-item-${index}`;
    await writeBacklogItem(cwd, {
      id,
      status: 'candidate',
      evidence_notes: options.evidenceNoteRepeat === undefined ? undefined : 'Large evidence note. '.repeat(options.evidenceNoteRepeat),
      body: `# Cap Item ${index}\n\n## Claim\n\n${'Large claim. '.repeat(options.bodyRepeat)}\n`,
    });
    const trace = createTraceSidecar(id);
    trace.landingResults.push({
      featureBranch: `feature/${id}`,
      commitSha: `${String(index).padStart(2, '0')}abcdef1234567890`,
      status: 'shipped',
      path: `${id}.ts`,
      landedAt: '2026-01-01T00:00:00.000Z',
    });
    await writeTraceSidecar(cwd, trace);
  }
}

async function initRepo(cwd: string): Promise<void> {
  await git(cwd, ['init', '-b', 'main']);
  await git(cwd, ['config', 'user.email', 'test@example.com']);
  await git(cwd, ['config', 'user.name', 'Test User']);
}

async function git(cwd: string, args: readonly string[]): Promise<void> {
  await execFile('git', [...args], { cwd });
}
