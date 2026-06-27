import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { writeAcceptedAnalysisBaseline } from '../backlog-curation-git-delta.js';
import { BACKLOG_CURATION_SHIPPED_EVIDENCE_CONTEXT_CAPS, buildBacklogCurationSource, readBacklogCurationSourcePreviewMetadata, writeBacklogCurationSourcePreviewMetadata } from '../backlog-curation-source.js';
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
  }, 15_000);

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

  it('changes the source fingerprint when item bodies or roadmap context changes', async () => {
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
      expect(afterRoadmapChange.sourceText).toContain('roadmapContext');
    });
  });

  it('uses a single source-first backlog curation source path', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', body: '# Item 1\n\n## Claim\n\nClaim\n' });
      const defaultSource = await buildBacklogCurationSource(cwd, undefined, {});
      const explicitSource = await buildBacklogCurationSource(cwd, undefined, {});
      const repeatedExplicit = await buildBacklogCurationSource(cwd, undefined, {});
      const defaultPacket = JSON.parse(defaultSource.sourceText) as { curationGuidance: Record<string, unknown>; fullImplementationAudit?: unknown };
      const explicitPacket = JSON.parse(explicitSource.sourceText) as { curationGuidance: Record<string, unknown>; fullImplementationAudit?: unknown };

      expect(defaultSource.sourceFingerprint).toBe(explicitSource.sourceFingerprint);
      expect(repeatedExplicit.sourceFingerprint).toBe(explicitSource.sourceFingerprint);
      expect(defaultPacket.curationGuidance).toMatchObject({ instruction: expect.stringMatching(/source-first curation/i) });
      expect(explicitPacket.curationGuidance).toMatchObject({ instruction: expect.stringMatching(/source-first curation/i) });
      expect(defaultPacket.fullImplementationAudit).toBeDefined();
    });
  });

  it('persists source preview metadata without scan mode', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', body: '# Item 1\n' });
      const source = await buildBacklogCurationSource(cwd, undefined, {});

      await writeBacklogCurationSourcePreviewMetadata(cwd, source);

      await expect(readBacklogCurationSourcePreviewMetadata(cwd, source.sourceFingerprint)).resolves.toMatchObject({ sourceFingerprint: source.sourceFingerprint });
    });
  });

  it('emits coarse source assembly milestones without source excerpts', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', body: '# Item 1\n\n## Claim\n\nClaim\n' });
      const milestones: string[] = [];

      await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false, progress: async (message) => { milestones.push(message); } });

      expect(milestones).toEqual(expect.arrayContaining([
        'Starting backlog curation source assembly',
        'Reading backlog records',
        'Scanning git delta',
        'Classifying evidence',
        'Running source-first audit',
        'Preparing map/reduce packets',
      ]));
      expect(milestones.indexOf('Reading backlog records')).toBeLessThan(milestones.indexOf('Scanning git delta'));
    });
  });

  it('attaches full-audit scope, current-state evidence classes, metadata, and fix-forward guidance', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'alpha-crane-parser', status: 'candidate', body: '# Alpha Crane Parser\n' });
      await writeBacklogItem(cwd, { id: 'beta-orbit-check', status: 'planned', body: '# Beta Orbit Check\n' });
      await writeBacklogItem(cwd, { id: 'current-file-state', status: 'candidate', body: '# Current File State\n' });
      await writeBacklogItem(cwd, { id: 'fresh-no-change', status: 'candidate', body: '# Fresh No Change\n' });
      await writeBacklogItem(cwd, { id: 'gamma-doc-guide', status: 'candidate', body: '# Gamma Doc Guide\n' });
      await writeBacklogItem(cwd, { id: 'stale-cleanup', status: 'candidate', tags: ['stale'], body: '# Stale Cleanup\n' });
      await writeBacklogItem(cwd, { id: 'closed-item', status: 'shipped', body: '# Closed Item\n' });
      await mkdir(join(cwd, 'src'), { recursive: true });
      await mkdir(join(cwd, 'tests'), { recursive: true });
      await mkdir(join(cwd, 'docs'), { recursive: true });
      await writeFile(join(cwd, 'src', 'implementation.ts'), 'Alpha Crane Parser alpha-crane-parser is implemented.\n');
      await writeFile(join(cwd, 'tests', 'implementation.test.ts'), 'Beta Orbit Check beta-orbit-check is covered.\n');
      await writeFile(join(cwd, 'docs', 'implementation.md'), 'Gamma Doc Guide gamma-doc-guide is documented.\n');
      await writeFile(join(cwd, 'src', 'current-file-state.ts'), 'Current File State current-file-state exists.\n');

      const full = await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false });
      const audit = full.source.fullImplementationAudit as {
        guidance: string[];
        scope: { itemIds: string[]; openItemCount: number };
        coverage: { auditedItemCount: number };
        items: Array<{ itemId: string; candidateIntent: string; confidence: string; evidence: Array<{ source: string; path?: string }> }>;
      };
      const item = (id: string) => audit.items.find((entry) => entry.itemId === id);

      expect(audit.scope).toEqual({ itemIds: ['alpha-crane-parser', 'beta-orbit-check', 'current-file-state', 'fresh-no-change', 'gamma-doc-guide', 'stale-cleanup'], openItemCount: 6 });
      expect(audit.coverage.auditedItemCount).toBe(6);
      expect(audit.guidance.join(' ')).toMatch(/make the draft fix-forward/i);
      expect((full.source.curationGuidance as { instruction: string }).instruction).not.toMatch(/not yet attached/i);
      expect(item('alpha-crane-parser')).toMatchObject({ candidateIntent: 'partial-implementation', evidence: [expect.objectContaining({ source: 'code-search', path: 'src/implementation.ts' })] });
      expect(item('beta-orbit-check')).toMatchObject({ candidateIntent: 'partial-implementation', evidence: [expect.objectContaining({ source: 'test-search', path: 'tests/implementation.test.ts' })] });
      expect(item('gamma-doc-guide')).toMatchObject({ candidateIntent: 'partial-implementation', evidence: [expect.objectContaining({ source: 'documentation-search', path: 'docs/implementation.md' })] });
      expect(item('current-file-state')).toMatchObject({ candidateIntent: 'partial-implementation', evidence: [expect.objectContaining({ source: 'current-file-state', path: 'src/current-file-state.ts' })] });
      expect(item('stale-cleanup')).toMatchObject({ candidateIntent: 'stale-invalid', confidence: 'weak', evidence: [] });
      expect(item('fresh-no-change')).toMatchObject({ candidateIntent: 'no-change', confidence: 'weak', evidence: [] });
      expect((full.source.shippedEvidenceCandidates as Array<{ itemId: string }>).some((candidate) => candidate.itemId === 'alpha-crane-parser')).toBe(false);

      await writeBacklogCurationSourcePreviewMetadata(cwd, full);
      await expect(readBacklogCurationSourcePreviewMetadata(cwd, full.sourceFingerprint)).resolves.toMatchObject({ fullImplementationAudit: { scope: audit.scope, coverage: { auditedItemCount: 6 } } });
    });
  });

  it('includes source-first concurrency, item results, and current-source closure metadata in fingerprints and preview metadata', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'source-first-widget', status: 'candidate', body: '# Source First Widget\n\n## Acceptance Criteria\n\n- Widget behavior is implemented and exported.\n' });
      await mkdir(join(cwd, 'src'), { recursive: true });
      await writeFile(join(cwd, 'src', 'source-first-widget-core.ts'), 'class SourceFirstWidgetCore { run() { return "source-first-widget"; } }\n');
      await writeFile(join(cwd, 'src', 'index.ts'), 'export { SourceFirstWidgetCore } from "./source-first-widget-core"; // source-first-widget\n');

      const lowConcurrency = await buildBacklogCurationSource(cwd, undefined, { itemAuditConcurrency: 1, enrichPullRequests: false });
      const defaultConcurrency = await buildBacklogCurationSource(cwd, undefined, { itemAuditConcurrency: 4, enrichPullRequests: false });
      const audit = lowConcurrency.source.fullImplementationAudit as {
        settings: Record<string, unknown>;
        sourceFirstResults: Array<{ itemId: string; intent: string; citations: Array<{ kind: string; path?: string }> }>;
        closureCandidates: Array<{ itemId: string; intent: string; confidence: string; evidenceSource: string; citations: Array<{ path?: string }> }>;
      };

      expect(lowConcurrency.sourceFingerprint).not.toBe(defaultConcurrency.sourceFingerprint);
      expect(lowConcurrency.source).toMatchObject({ itemAuditConcurrency: 1 });
      expect(audit.settings).toMatchObject({ itemAuditConcurrency: 1, maxItemAuditConcurrency: 8, closureAuthority: 'current-source-only' });
      expect(audit.sourceFirstResults).toEqual(expect.arrayContaining([expect.objectContaining({
        itemId: 'source-first-widget',
        intent: 'source-shipped',
        citations: expect.arrayContaining([expect.objectContaining({ kind: 'implementation', path: 'src/source-first-widget-core.ts' }), expect.objectContaining({ kind: 'product-surface', path: 'src/index.ts' })]),
      })]));
      expect(audit.closureCandidates).toEqual([expect.objectContaining({ itemId: 'source-first-widget', intent: 'shipped', confidence: 'strong', evidenceSource: 'current-source' })]);

      await writeBacklogCurationSourcePreviewMetadata(cwd, lowConcurrency);
      await expect(readBacklogCurationSourcePreviewMetadata(cwd, lowConcurrency.sourceFingerprint)).resolves.toMatchObject({
        itemAuditConcurrency: 1,
        fullImplementationAudit: {
          settings: { itemAuditConcurrency: 1, closureAuthority: 'current-source-only' },
          sourceFirstResults: expect.arrayContaining([expect.objectContaining({ itemId: 'source-first-widget', intent: 'source-shipped' })]),
          closureCandidates: expect.arrayContaining([expect.objectContaining({ itemId: 'source-first-widget', intent: 'shipped', evidenceSource: 'current-source' })]),
        },
      });
    });
  });

  it('keeps full-audit scope, coverage, and item summaries in minimal source text fallback', async () => {
    await withTempProject(async (cwd) => {
      await mkdir(join(cwd, 'src'), { recursive: true });
      for (let index = 0; index < 220; index += 1) {
        const id = `audit-fallback-${index}`;
        await writeBacklogItem(cwd, { id, status: 'candidate', body: `# Backlog Packet ${index}\n\n## Claim\n\n${'Large full-audit claim. '.repeat(180)}\n` });
        if (index < 3) await writeFile(join(cwd, 'src', `${id}.ts`), `${id} implemented.\n`);
      }

      const source = await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false });
      const packet = JSON.parse(source.sourceText) as {
        fullImplementationAudit: {
          scope: { itemIds: string[]; openItemCount: number };
          coverage: { auditedItemCount: number; currentStateHitCount: number };
          items: Array<{ itemId: string; candidateIntent: string; evidence: Array<{ path?: string }> }>;
        };
        truncation: { fallback?: string };
      };

      expect(packet.truncation.fallback).toBe('minimal');
      expect(packet.fullImplementationAudit.scope.openItemCount).toBe(220);
      expect(packet.fullImplementationAudit.scope.itemIds).toEqual(expect.arrayContaining(['audit-fallback-0', 'audit-fallback-1', 'audit-fallback-219']));
      expect(packet.fullImplementationAudit.coverage).toMatchObject({ auditedItemCount: 220, currentStateHitCount: 3 });
      expect(packet.fullImplementationAudit.items.find((item) => item.itemId === 'audit-fallback-0')).toMatchObject({ candidateIntent: 'partial-implementation', evidence: [expect.objectContaining({ path: 'src/audit-fallback-0.ts' })] });
      expect(packet.fullImplementationAudit.items.find((item) => item.itemId === 'audit-fallback-219')).toMatchObject({ candidateIntent: 'no-change', evidence: [] });
    });
  });

  it('reports missing git history as a full-audit diagnostic while preserving bounded coverage', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'no-git-full-audit', status: 'candidate', body: '# No Git Full Audit\n' });
      await mkdir(join(cwd, 'src'), { recursive: true });
      await writeFile(join(cwd, 'src', 'no-git-full-audit.ts'), 'No Git Full Audit no-git-full-audit exists.\n');

      const source = await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false });
      const packet = JSON.parse(source.sourceText) as { fullImplementationAudit: { coverage: Record<string, unknown>; diagnostics: Array<{ code: string }> } };

      expect(packet.fullImplementationAudit.coverage).toMatchObject({ auditedItemCount: 1, currentStateHitCount: 1 });
      expect(packet.fullImplementationAudit.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'git-history-unavailable' })]));
    });
  });

  it('redacts current-state excerpts and excludes generated, dependency, private backlog, and secret-like files in full-audit mode', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'secure-widget', status: 'candidate', body: '# Secure Widget\n' });
      await mkdir(join(cwd, 'src'), { recursive: true });
      await mkdir(join(cwd, 'node_modules/pkg'), { recursive: true });
      await mkdir(join(cwd, 'dist'), { recursive: true });
      await mkdir(join(cwd, '.eforge/storage/extensions/eforge-plan/private'), { recursive: true });
      await writeFile(join(cwd, 'src', 'secure-widget.ts'), 'Secure Widget secure-widget password=super-secret-token\nconst apiKey = "sk-12345678901234567890"; // secure-widget\nGITHUB_TOKEN=ghp_123456789012345678901234567890123456 OPENAI_API_KEY: \'openai-secret-value\' Authorization: Bearer bearer-secret-token secure-widget\n');
      await writeFile(join(cwd, 'node_modules/pkg', 'secure-widget.ts'), 'Secure Widget secure-widget node_modules evidence\n');
      await writeFile(join(cwd, 'dist', 'secure-widget.ts'), 'Secure Widget secure-widget dist evidence\n');
      await writeFile(join(cwd, '.eforge/storage/extensions/eforge-plan/private', 'secure-widget.md'), 'Secure Widget secure-widget private backlog evidence\n');
      await writeFile(join(cwd, '.env'), 'SECURE_WIDGET=secure-widget secret\n');

      const full = await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false });
      const audit = full.source.fullImplementationAudit as { items: Array<{ itemId: string; evidence: Array<{ path: string; excerpt: string }> }> };
      const evidence = audit.items.find((entry) => entry.itemId === 'secure-widget')?.evidence ?? [];
      const serialized = JSON.stringify(evidence);
      const excerpt = evidence[0]?.excerpt ?? '';

      expect(evidence).toEqual([expect.objectContaining({ path: 'src/secure-widget.ts', excerpt: expect.stringContaining('password=[REDACTED]') })]);
      expect(excerpt).toContain('const apiKey = "[REDACTED]"');
      expect(excerpt).toContain('GITHUB_TOKEN=[REDACTED]');
      expect(excerpt).toContain("OPENAI_API_KEY: '[REDACTED]'");
      expect(excerpt).toContain('Authorization: Bearer [REDACTED]');
      expect(serialized).not.toContain('super-secret-token');
      expect(serialized).not.toContain('bearer-secret-token');
      expect(serialized).not.toContain('openai-secret-value');
      expect(serialized).not.toContain('node_modules');
      expect(serialized).not.toContain('dist evidence');
      expect(serialized).not.toContain('private backlog evidence');
      expect(serialized).not.toContain('SECURE_WIDGET');
    });
  });

  it('projects full-audit PR-history and lifecycle signals as navigation-only source-first hints', async () => {
    await withTempProject(async (cwd) => {
      await initRepo(cwd);
      await writeFile(join(cwd, 'README.md'), 'base\n');
      await git(cwd, ['add', 'README.md']);
      await git(cwd, ['commit', '-m', 'initial']);
      await writeBacklogItem(cwd, { id: 'enriched-full-pr', status: 'candidate', body: '# Enriched Full PR\n' });
      await writeBacklogItem(cwd, { id: 'lifecycle-full', status: 'candidate', body: '# Lifecycle Full\n' });
      await git(cwd, ['checkout', '-b', 'feature/enriched-full-pr']);
      await mkdir(join(cwd, 'src'), { recursive: true });
      await writeFile(join(cwd, 'src', 'enriched-full-pr.ts'), 'Enriched Full PR enriched-full-pr\n');
      await git(cwd, ['add', 'src/enriched-full-pr.ts']);
      await git(cwd, ['commit', '-m', 'feat: enriched full pr']);
      await git(cwd, ['checkout', 'main']);
      await git(cwd, ['merge', '--no-ff', 'feature/enriched-full-pr', '-m', 'Merge pull request #333 from owner/feature/enriched-full-pr']);
      const trace = createTraceSidecar('lifecycle-full');
      trace.landingResults.push({ featureBranch: 'feature/lifecycle-full', commitSha: 'abcdef1234567890', status: 'shipped', path: 'src/lifecycle-full.ts', landedAt: '2026-01-01T00:00:00.000Z' });
      await writeTraceSidecar(cwd, trace);
      const fakeBin = join(cwd, 'fake-bin');
      await mkdir(fakeBin, { recursive: true });
      await writeFile(join(fakeBin, 'gh'), '#!/usr/bin/env node\nconsole.log(JSON.stringify({ number: 333, title: "Ship enriched full PR", headRefName: "feature/enriched-full-pr", state: "MERGED", mergedAt: "2026-01-01T00:00:00Z", mergeCommit: {}, files: [{ path: "src/enriched-full-pr.ts" }] }));\n');
      await chmod(join(fakeBin, 'gh'), 0o755);
      const previousPath = process.env.PATH;
      process.env.PATH = `${fakeBin}${delimiter}${previousPath ?? ''}`;
      try {
        const full = await buildBacklogCurationSource(cwd, undefined, {});
        const audit = full.source.fullImplementationAudit as { closureCandidates: Array<Record<string, unknown>>; items: Array<{ itemId: string; candidateIntent: string; lifecycleTrace?: Record<string, unknown>; historicalHints?: Array<Record<string, unknown>>; sourceFirstResult?: Record<string, unknown> }> };
        const prItem = audit.items.find((entry) => entry.itemId === 'enriched-full-pr');
        const lifecycleItem = audit.items.find((entry) => entry.itemId === 'lifecycle-full');

        expect(audit.closureCandidates).toEqual([]);
        expect(prItem).toMatchObject({ candidateIntent: 'partial-implementation', historicalHints: expect.arrayContaining([expect.objectContaining({ source: 'combined', confidence: 'strong', closureAuthority: false, pr: expect.objectContaining({ number: 333, title: 'Ship enriched full PR' }) })]) });
        expect(lifecycleItem).toMatchObject({ candidateIntent: 'no-change', lifecycleTrace: { lifecycleState: 'shipped', landingRefCount: 1 }, historicalHints: expect.arrayContaining([expect.objectContaining({ source: 'lifecycle', confidence: 'strong', closureAuthority: false })]), sourceFirstResult: expect.objectContaining({ intent: 'not-found' }) });

        await writeBacklogCurationSourcePreviewMetadata(cwd, full);
        await expect(readBacklogCurationSourcePreviewMetadata(cwd, full.sourceFingerprint)).resolves.toMatchObject({ fullImplementationAudit: { itemSummaries: expect.arrayContaining([
          expect.objectContaining({ itemId: 'enriched-full-pr', candidateIntent: 'partial-implementation', closureCandidates: [] }),
          expect.objectContaining({ itemId: 'lifecycle-full', candidateIntent: 'no-change', closureCandidates: [] }),
        ]) } });
      } finally {
        process.env.PATH = previousPath;
      }
    });
  });

  it('surfaces full-audit evidence caps in source diagnostics and preview metadata', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'capped-widget', status: 'candidate', body: '# Capped Widget\n' });
      await mkdir(join(cwd, 'src'), { recursive: true });
      for (let index = 0; index < 4; index += 1) await writeFile(join(cwd, 'src', `capped-widget-${index}.ts`), `Capped Widget capped-widget evidence ${index}\n`);

      const full = await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false, fullImplementationAuditCaps: { evidencePerItem: 1, pathsPerCategory: 1, fileScanCount: 2, diagnosticCount: 10 } });
      const audit = full.source.fullImplementationAudit as { coverage: { currentStateHitCount: number; currentStateEvidenceTruncatedCount: number }; diagnostics: Array<{ code: string }>; items: Array<{ itemId: string; evidence: unknown[]; currentStateEvidenceCount: number; currentStateEvidenceTruncatedCount: number }> };
      const item = audit.items.find((entry) => entry.itemId === 'capped-widget');

      expect(item?.evidence).toHaveLength(1);
      expect(item).toMatchObject({ currentStateEvidenceCount: 2, currentStateEvidenceTruncatedCount: 1 });
      expect(audit.coverage).toMatchObject({ currentStateHitCount: 2, currentStateEvidenceTruncatedCount: 1 });
      expect(audit.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'file-scan-cap-truncated' }), expect.objectContaining({ code: 'evidence-cap-truncated' })]));
      await writeBacklogCurationSourcePreviewMetadata(cwd, full);
      await expect(readBacklogCurationSourcePreviewMetadata(cwd, full.sourceFingerprint)).resolves.toMatchObject({ fullImplementationAudit: { coverage: { currentStateEvidenceTruncatedCount: 1 }, caps: { pathsPerCategory: 1 }, diagnostics: expect.arrayContaining([expect.objectContaining({ code: 'file-scan-cap-truncated' }), expect.objectContaining({ code: 'evidence-cap-truncated' })]), itemSummaries: expect.arrayContaining([expect.objectContaining({ itemId: 'capped-widget', currentStateEvidenceTruncatedCount: 1 })]) } });
    });
  });

  it('keeps ambiguous shipped and superseded historical matches as navigation-only hints', async () => {
    await withTempProject(async (cwd) => {
      await initRepo(cwd);
      await writeFile(join(cwd, 'README.md'), 'base\n');
      await git(cwd, ['add', 'README.md']);
      await git(cwd, ['commit', '-m', 'initial']);
      await writeBacklogItem(cwd, { id: 'review-flow-item', status: 'candidate', body: '# Review Flow Item\n' });
      await writeBacklogItem(cwd, { id: 'cleanup-flow-item', status: 'candidate', body: '# Cleanup Flow Item\n' });
      await writeFile(join(cwd, 'ambiguous.txt'), 'ambiguous history\n');
      await git(cwd, ['add', 'ambiguous.txt']);
      await git(cwd, ['commit', '-m', 'ship ambiguous review flow']);
      await writeFile(join(cwd, 'ambiguous.txt'), 'ambiguous history updated\n');
      await git(cwd, ['add', 'ambiguous.txt']);
      await git(cwd, ['commit', '-m', 'obsolete ambiguous cleanup flow']);

      const full = await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false });
      const audit = full.source.fullImplementationAudit as { closureCandidates: Array<{ itemId: string; intent: string; confidence: string; evidence: string }>; items: Array<{ itemId: string; candidateIntent: string; confidence: string; guidance: string; historicalHints?: Array<Record<string, unknown>>; sourceFirstResult?: Record<string, unknown> }> };
      const review = audit.items.find((entry) => entry.itemId === 'review-flow-item');
      const cleanup = audit.items.find((entry) => entry.itemId === 'cleanup-flow-item');

      expect(audit.closureCandidates).toEqual([]);
      expect(review).toMatchObject({ candidateIntent: 'no-change', confidence: 'weak', guidance: expect.stringMatching(/No supplied repository evidence/), historicalHints: expect.arrayContaining([expect.objectContaining({ intent: 'ambiguous-shipped', confidence: 'ambiguous', closureAuthority: false })]), sourceFirstResult: expect.objectContaining({ intent: 'not-found' }) });
      expect(cleanup).toMatchObject({ candidateIntent: 'no-change', confidence: 'weak', guidance: expect.stringMatching(/No supplied repository evidence/), historicalHints: expect.arrayContaining([expect.objectContaining({ intent: 'ambiguous-superseded', confidence: 'ambiguous', closureAuthority: false })]), sourceFirstResult: expect.objectContaining({ intent: 'not-found' }) });
    });
  });

  it('returns full-audit source text and diagnostics when PR enrichment is unavailable', async () => {
    await withTempProject(async (cwd) => {
      await initRepo(cwd);
      await writeFile(join(cwd, 'README.md'), 'base\n');
      await git(cwd, ['add', 'README.md']);
      await git(cwd, ['commit', '-m', 'initial']);
      await writeBacklogItem(cwd, { id: 'fallback-full-pr', status: 'candidate', body: '# Fallback Full PR\n' });
      await writeFile(join(cwd, 'fallback-full-pr.ts'), 'Fallback Full PR fallback-full-pr\n');
      await git(cwd, ['add', 'fallback-full-pr.ts']);
      await git(cwd, ['commit', '-m', 'Merge pull request #999999 from owner/fallback-full-pr']);
      const fakeBin = join(cwd, 'fake-bin');
      await mkdir(fakeBin, { recursive: true });
      await writeFile(join(fakeBin, 'gh'), '#!/usr/bin/env node\nconsole.error("deterministic gh failure");\nprocess.exit(1);\n');
      await chmod(join(fakeBin, 'gh'), 0o755);
      const previousPath = process.env.PATH;
      process.env.PATH = `${fakeBin}${delimiter}${previousPath ?? ''}`;
      try {
        const source = await buildBacklogCurationSource(cwd, undefined, { shippedEvidenceCaps: { subprocessTimeoutMs: 1000, prEnrichmentCount: 1 } });
        const packet = JSON.parse(source.sourceText) as { fullImplementationAudit: { diagnostics: Array<{ code: string }> } };

        expect(source.sourceText).toContain('fullImplementationAudit');
        expect(packet.fullImplementationAudit.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'pr-enrichment-unavailable' })]));
      } finally {
        process.env.PATH = previousPath;
      }
    });
  });

  it('keeps pre-baseline strong shipped and superseded history as source-first navigation hints only', async () => {
    await withTempProject(async (cwd) => {
      await initRepo(cwd);
      await writeFile(join(cwd, 'README.md'), 'base\n');
      await git(cwd, ['add', 'README.md']);
      await git(cwd, ['commit', '-m', 'initial']);
      await writeBacklogItem(cwd, { id: 'launch-widget', status: 'candidate', body: '# Launch Widget\n' });
      await writeBacklogItem(cwd, { id: 'obsolete-panel', status: 'candidate', body: '# Obsolete Panel\n' });
      await git(cwd, ['checkout', '-b', 'feature/launch-widget']);
      await mkdir(join(cwd, 'src'), { recursive: true });
      await writeFile(join(cwd, 'src', 'launch-widget.ts'), 'Launch Widget launch-widget\n');
      await git(cwd, ['add', 'src/launch-widget.ts']);
      await git(cwd, ['commit', '-m', 'feat(launch-widget): implementation']);
      await git(cwd, ['checkout', 'main']);
      await git(cwd, ['merge', '--no-ff', 'feature/launch-widget', '-m', 'Merge pull request #616 from owner/feature/launch-widget']);
      await writeFile(join(cwd, 'src', 'obsolete-panel.ts'), 'Obsolete Panel obsolete-panel replacement\n');
      await git(cwd, ['add', 'src/obsolete-panel.ts']);
      await git(cwd, ['commit', '-m', 'obsolete obsolete-panel because replacement is available']);
      const baseline = await gitOutput(cwd, ['rev-parse', 'HEAD']);
      await writeAcceptedAnalysisBaseline(cwd, { taskId: 'task-git-delta', passKind: 'analyze-all', sourceFingerprint: 'baseline-fingerprint', acceptedAt: '2026-01-01T00:00:00.000Z', git: { headCommit: baseline, headCommittedAt: '2026-01-01T00:00:00.000Z' }, coverage: {}, diagnostics: [] });

      const full = await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false });
      const audit = full.source.fullImplementationAudit as { closureCandidates: Array<{ itemId: string; intent: string; confidence: string; evidence: string }>; items: Array<{ itemId: string; candidateIntent: string; historicalHints?: Array<Record<string, unknown>>; sourceFirstResult?: Record<string, unknown> }> };
      const item = (id: string) => audit.items.find((entry) => entry.itemId === id);

      expect(audit.closureCandidates).toEqual([]);
      expect(item('launch-widget')).toMatchObject({ candidateIntent: 'partial-implementation', historicalHints: expect.arrayContaining([expect.objectContaining({ intent: 'shipped', confidence: 'strong', closureAuthority: false })]), sourceFirstResult: expect.objectContaining({ intent: 'partial' }) });
      expect(item('obsolete-panel')).toMatchObject({ candidateIntent: 'partial-implementation', historicalHints: expect.arrayContaining([expect.objectContaining({ intent: 'superseded', confidence: 'strong', closureAuthority: false })]), sourceFirstResult: expect.objectContaining({ intent: 'partial' }) });
      expect(full.source.shippedEvidenceCandidates).toEqual([]);
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

      expect(candidate).toMatchObject({ itemId: 'ship-evidence-provider', confidence: 'strong', evidenceSource: 'git-history', evidenceLabel: 'Shipped evidence: inferred from git/PR history' });
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
      await writeBacklogItem(cwd, { id: 'review-flow-item', status: 'candidate', body: '# Ambiguous Candidate Review Flow\n' });
      await writeFile(join(cwd, 'unrelated.ts'), 'unrelated implementation\n');
      await git(cwd, ['add', 'unrelated.ts']);
      await git(cwd, ['commit', '-m', 'ship ambiguous candidate review']);

      const source = await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false });
      const packet = source.source as { shippedEvidenceCandidates: Array<Record<string, unknown>> };
      const parsed = JSON.parse(source.sourceText) as { shippedEvidenceCandidates: Array<Record<string, unknown>> };
      const candidate = packet.shippedEvidenceCandidates.find((entry) => entry.itemId === 'review-flow-item');
      const textCandidate = parsed.shippedEvidenceCandidates.find((entry) => entry.itemId === 'review-flow-item');

      expect(candidate).toMatchObject({ itemId: 'review-flow-item', confidence: 'ambiguous', evidenceLabel: 'Ambiguous shipped candidate: needs input' });
      expect(textCandidate).toMatchObject({ itemId: 'review-flow-item', confidence: 'ambiguous', evidenceLabel: 'Ambiguous shipped candidate: needs input' });
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

        expect(candidate).toMatchObject({ evidenceSource: 'combined', pr: { number: 222, title: 'Ship enriched PR metadata', branch: 'feature/enriched-pr' } });
        expect(textCandidate).toMatchObject({ evidenceSource: 'combined', pr: { number: 222, title: 'Ship enriched PR metadata', branch: 'feature/enriched-pr' } });
        expect(source.sourceText).toContain('Ship enriched PR metadata');
        expect(source.sourceText).toContain('feature/enriched-pr');
        expect(source.sourceText).not.toContain('github-pr');
        expect(source.sourceText).not.toContain('lifecycle-trace');
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
      const packet = JSON.parse(source.sourceText) as { shippedEvidenceCandidates: Array<Record<string, unknown>>; gitDelta: { diagnostics: Array<{ code: string }> } };

      expect(packet.shippedEvidenceCandidates.some((candidate) => candidate.itemId === 'fallback-pr' && candidate.evidenceSource === 'git-history')).toBe(true);
      expect(packet.gitDelta.diagnostics.some((diagnostic) => diagnostic.code.startsWith('pr'))).toBe(true);
    });
  });

  it('caps shipped evidence candidates and keeps them in source text fallback', async () => {
    await withTempProject(async (cwd) => {
      await writeCappedLifecycleEvidence(cwd, { itemCount: 40, bodyRepeat: 500 });

      const source = await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false });
      const packet = JSON.parse(source.sourceText) as { openItems: Array<Record<string, unknown>>; shippedEvidenceCandidates: unknown[]; shippedEvidenceCandidateCounts: Record<string, unknown>; shippedEvidenceDiagnostics: unknown[]; truncation: { shippedEvidenceCandidates: number; fallback?: string } };

      expect(packet.openItems[0]).not.toHaveProperty('sections');
      expect(packet.truncation.fallback).toBe('minimal');
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

  it('routes non-closing git-history matches to gitDelta affected candidates instead of shipped evidence context', async () => {
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
      const packet = source.source as { shippedEvidenceCandidates: Array<Record<string, unknown>>; gitDelta: { affectedItemCandidates: Array<Record<string, unknown>> } };
      const parsed = JSON.parse(source.sourceText) as { shippedEvidenceCandidates: Array<Record<string, unknown>>; gitDelta: { affectedItemCandidates: Array<Record<string, unknown>> } };

      expect(packet.shippedEvidenceCandidates.some((candidate) => candidate.itemId === 'api-ui')).toBe(false);
      expect(parsed.shippedEvidenceCandidates.some((candidate) => candidate.itemId === 'api-ui')).toBe(false);
      expect(packet.gitDelta.affectedItemCandidates.find((candidate) => candidate.itemId === 'api-ui')).toMatchObject({ intent: 'affected', evidence: expect.stringMatching(/^Affected candidate: /) });
      expect(parsed.gitDelta.affectedItemCandidates.find((candidate) => candidate.itemId === 'api-ui')).toMatchObject({ intent: 'affected', evidence: expect.stringMatching(/^Affected candidate: /) });
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

      expect(packet.shippedEvidenceCandidates[0]).toMatchObject({ itemId: 'lifecycle-first', evidenceSource: 'lifecycle', evidenceLabel: 'Shipped evidence: lifecycle trace' });
      expect(JSON.stringify(packet.shippedEvidenceCandidates[0])).not.toContain('lifecycle-trace');
      expect(packet.shippedEvidenceCandidates.some((candidate, index) => index > 0 && candidate.itemId === 'lifecycle-first' && candidate.evidenceSource === 'git-history')).toBe(true);
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

  it('includes gitDelta in source, source text, fingerprint, and minimal fallback', async () => {
    await withTempProject(async (cwd) => {
      await initRepo(cwd);
      await writeFile(join(cwd, 'README.md'), 'base\n');
      await git(cwd, ['add', 'README.md']);
      await git(cwd, ['commit', '-m', 'initial']);
      const baseline = await gitOutput(cwd, ['rev-parse', 'HEAD']);
      await writeAcceptedAnalysisBaseline(cwd, { taskId: 'task-git-delta', passKind: 'analyze-all', sourceFingerprint: 'baseline-fingerprint', acceptedAt: '2026-01-01T00:00:00.000Z', git: { headCommit: baseline, headCommittedAt: '2026-01-01T00:00:00.000Z' }, coverage: {}, diagnostics: [] });
      await writeBacklogItem(cwd, { id: 'git-delta-source', status: 'candidate', evidence_notes: 'Large evidence note. '.repeat(12000), body: `# Git Delta Source\n\n${'Large claim. '.repeat(20000)}\n` });
      const before = await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false });
      await writeFile(join(cwd, 'delta.ts'), 'delta\n');
      await git(cwd, ['add', 'delta.ts']);
      await git(cwd, ['commit', '-m', 'feat: delta source fingerprint']);
      const after = await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false });
      const packet = after.source as { gitDelta: Record<string, unknown> };
      const parsed = JSON.parse(after.sourceText) as { gitDelta: Record<string, unknown>; truncation: { fallback?: string } };

      expect(packet.gitDelta).toMatchObject({ baseline: { commit: baseline, source: 'accepted-analysis-sidecar', taskId: 'task-git-delta' }, coverage: { kind: 'complete' }, affectedItemCandidates: expect.arrayContaining([expect.objectContaining({ itemId: 'git-delta-source', intent: 'affected', matchedBy: expect.arrayContaining(['changed-path']) })]), caps: expect.any(Object) });
      expect(packet.gitDelta).toHaveProperty('currentHead');
      expect(packet.gitDelta).toHaveProperty('scannedCommits');
      expect(packet.gitDelta).toHaveProperty('diagnostics');
      expect(parsed.gitDelta).toBeDefined();
      expect(parsed.truncation.fallback).toBe('minimal');
      expect(after.sourceFingerprint).not.toBe(before.sourceFingerprint);
    });
  });

  it('populates gitDelta affected item candidates from baseline-scanned commits', async () => {
    await withTempProject(async (cwd) => {
      await initRepo(cwd);
      await writeFile(join(cwd, 'README.md'), 'base\n');
      await git(cwd, ['add', 'README.md']);
      await git(cwd, ['commit', '-m', 'initial']);
      const baseline = await gitOutput(cwd, ['rev-parse', 'HEAD']);
      await writeAcceptedAnalysisBaseline(cwd, { taskId: 'task-git-delta', passKind: 'analyze-all', sourceFingerprint: 'baseline-fingerprint', acceptedAt: '2026-01-01T00:00:00.000Z', git: { headCommit: baseline, headCommittedAt: '2026-01-01T00:00:00.000Z' }, coverage: {}, diagnostics: [] });
      await writeBacklogItem(cwd, { id: 'git-delta-match', status: 'candidate', body: '# Git Delta Match\n' });
      await mkdir(join(cwd, 'src'), { recursive: true });
      await writeFile(join(cwd, 'src/git-delta-match.ts'), 'git-delta-match shipped implementation\n');
      await git(cwd, ['add', 'src/git-delta-match.ts']);
      await git(cwd, ['commit', '-m', 'ship git-delta-match from owner/feature/git-delta-match']);
      const source = await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false });
      type GitDeltaCandidatePacket = {
        gitDelta: {
          affectedItemCandidates: Array<{ itemId: string; matchedBy: string[]; commit: { hash: string }; evidence: string; changedPaths: string[] }>;
          scannedCommits: Array<{ hash: string }>;
        };
        shippedEvidenceCandidates: Array<{ itemId: string; matchedBy: string[]; evidence: string }>;
      };
      const packet = source.source as GitDeltaCandidatePacket;
      const parsed = JSON.parse(source.sourceText) as GitDeltaCandidatePacket;
      const candidate = packet.gitDelta.affectedItemCandidates.find((entry) => entry.itemId === 'git-delta-match');

      expect(candidate).toMatchObject({
        itemId: 'git-delta-match',
        matchedBy: expect.arrayContaining(['item-id', 'item-slug', 'changed-path']),
        evidence: expect.stringMatching(/^Shipped evidence: inferred from git\/PR history — /),
        changedPaths: ['src/git-delta-match.ts'],
      });
      expect(packet.gitDelta.scannedCommits.map((commit) => commit.hash)).toContain(candidate?.commit.hash);
      expect(parsed.gitDelta.affectedItemCandidates.find((entry) => entry.itemId === 'git-delta-match')?.evidence).toBe(candidate?.evidence);
      expect(packet.shippedEvidenceCandidates.find((entry) => entry.itemId === 'git-delta-match')).toMatchObject({ matchedBy: expect.arrayContaining(['item-id']), evidence: expect.stringMatching(/^Shipped evidence: inferred from git\/PR history — /) });
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

async function gitOutput(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFile('git', [...args], { cwd });
  return String(stdout).trim();
}
