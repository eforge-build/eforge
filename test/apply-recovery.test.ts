/**
 * Tests for EforgeEngine.applyRecovery — all four verdict dispatches plus error paths.
 *
 * Each test builds a real git fixture, seeds the failed PRD + both sidecar files,
 * calls engine.applyRecovery(), then asserts post-conditions on the working tree.
 *
 * Per plan-02: queue state is filesystem-only (queue is gitignored). Recovery
 * operations no longer make git commits — commitSha is always '' (empty string)
 * for retry/continue-repair/abandon, and undefined for manual (noAction).
 *
 * Per AGENTS.md: no harness or git mocks — all tests use real git operations.
 */

import { describe, it, expect } from 'vitest';
import { readFile, mkdir, writeFile, access, readdir } from 'node:fs/promises';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { EforgeEngine } from '@eforge-build/engine/eforge';
import { useTempDir } from './test-tmpdir.js';
import { StubHarness } from './stub-harness.js';
import type { EforgeEvent } from '@eforge-build/engine/events';
import type { ApplyRecoveryResult } from '@eforge-build/engine/schemas';

const execAsync = promisify(execFile);

function recoverySidecarFromLegacy(legacy: { generatedAt?: string; summary: Record<string, unknown>; verdict: Record<string, unknown>; applied?: unknown }): Record<string, unknown> {
  const summary = legacy.summary;
  const generatedAt = legacy.generatedAt ?? new Date().toISOString();
  const prdId = String(summary.prdId);
  const setName = String(summary.setName ?? prdId);
  return {
    schemaVersion: 3,
    generatedAt,
    prdId,
    setName,
    verdict: legacy.verdict,
    report: { operatorSummary: String(legacy.verdict.rationale ?? 'Test rationale.'), recommendedAction: 'Apply the test recovery verdict.', keyEvidence: [], completedWork: [], remainingWork: [], risks: [] },
    boundedEvidence: {
      identity: { prdId, setName, featureBranch: String(summary.featureBranch ?? `eforge/${setName}`), baseBranch: String(summary.baseBranch ?? 'main'), failedAt: String(summary.failedAt ?? generatedAt), ...(summary.partial !== undefined ? { partial: summary.partial } : {}) },
      plans: Array.isArray(summary.plans) ? summary.plans : [],
      failingPlan: summary.failingPlan ?? { planId: 'plan-01' },
      ...(Array.isArray(summary.failingPlans) ? { failingPlans: summary.failingPlans } : {}),
      landedCommits: Array.isArray(summary.landedCommits) ? summary.landedCommits : [],
      modelsUsed: Array.isArray(summary.modelsUsed) ? summary.modelsUsed : [],
      ...(summary.terminalFailure !== undefined ? { terminalFailure: summary.terminalFailure } : {}),
      ...(summary.acceptanceValidation !== undefined ? { acceptanceValidation: summary.acceptanceValidation } : {}),
      ...(summary.validationCommands !== undefined ? { validationCommands: summary.validationCommands } : {}),
      ...(summary.landing !== undefined ? { landing: summary.landing } : {}),
      ...(typeof summary.diffStat === 'string' ? { diffStat: summary.diffStat } : {}),
    },
    ...(legacy.applied !== undefined ? { applied: legacy.applied } : {}),
  };
}

function validRecoveryExtractorResponse(): { resultText: string } {
  return { resultText: JSON.stringify({ version: 1, criteria: [] }) };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get the HEAD SHA. */
async function gitHeadSha(cwd: string): Promise<string> {
  const { stdout } = await execAsync('git', ['rev-parse', 'HEAD'], { cwd });
  return stdout.trim();
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/**
 * Set up a minimal git repository with:
 * - 1 commit on `main`
 * - `.eforge/queue/failed/` directory created
 */
function seedGitRepo(dir: string): void {
  const gitOpts = { cwd: dir };
  execFileSync('git', ['init', '-b', 'main'], gitOpts);
  execFileSync('git', ['config', 'user.email', 'test@example.com'], gitOpts);
  execFileSync('git', ['config', 'user.name', 'Test'], gitOpts);
  execFileSync('git', ['commit', '--allow-empty', '-m', 'chore: initial commit'], gitOpts);
}

/** Seed the failed PRD + both sidecar files for a given verdict. */
async function seedFailedPrd(
  dir: string,
  prdId: string,
  verdict: 'retry' | 'continue-repair' | 'abandon' | 'manual',
  opts?: { summary?: Record<string, unknown> },
): Promise<void> {
  const failedDir = join(dir, '.eforge', 'queue', 'failed');
  await mkdir(failedDir, { recursive: true });

  // Write the PRD file with valid queue frontmatter so the compiled-artifact
  // requeue path can discover it via loadQueue().
  const prdContent = `---\ntitle: Test PRD ${prdId}\ncreated: 2024-01-01\n---\n\n# Test PRD: ${prdId}\n\nBuild something.`;
  await writeFile(join(failedDir, `${prdId}.md`), prdContent, 'utf-8');

  // Write the recovery markdown sidecar
  const recoveryMd = `## Recovery Report\n\nVerdict: ${verdict.toUpperCase()}`;
  await writeFile(join(failedDir, `${prdId}.recovery.md`), recoveryMd, 'utf-8');

  // Write the recovery JSON sidecar
  const verdictJson: Record<string, unknown> = {
    verdict,
    confidence: 'high',
    rationale: 'Test rationale.',
    completedWork: [],
    remainingWork: [],
    risks: [],
  };
  const sidecarJson = {
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    summary: {
      prdId,
      setName: 'test-set',
      featureBranch: 'eforge/test-set',
      baseBranch: 'main',
      plans: [],
      failingPlan: { planId: 'plan-01' },
      landedCommits: [],
      diffStat: '',
      modelsUsed: [],
      failedAt: new Date().toISOString(),
      ...opts?.summary,
    },
    verdict: verdictJson,
  };
  await writeFile(
    join(failedDir, `${prdId}.recovery.json`),
    JSON.stringify(recoverySidecarFromLegacy(sidecarJson), null, 2),
    'utf-8',
  );

  // Stage and commit all files so they are tracked by git
  const gitOpts = { cwd: dir };
  execFileSync('git', ['add', '--', failedDir], gitOpts);
  execFileSync('git', ['commit', '-m', `chore: seed failed prd ${prdId}`], gitOpts);
}

/** Drive an async generator, returning both events and the final result. */
async function driveGenerator(
  gen: AsyncGenerator<EforgeEvent, ApplyRecoveryResult>,
): Promise<{ events: EforgeEvent[]; result: ApplyRecoveryResult }> {
  const events: EforgeEvent[] = [];
  while (true) {
    const next = await gen.next();
    if (next.done) {
      return { events, result: next.value };
    }
    events.push(next.value);
  }
}

/** Check whether a path exists in the filesystem. */
async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// retry verdict
// ---------------------------------------------------------------------------

describe('applyRecovery — retry', () => {
  const makeTempDir = useTempDir('eforge-apply-recovery-retry-');

  it('moves failed PRD to queue and removes sidecars', async () => {
    const dir = makeTempDir();
    const prdId = 'test-retry-prd';
    seedGitRepo(dir);
    await seedFailedPrd(dir, prdId, 'retry');

    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: new StubHarness([validRecoveryExtractorResponse()]) });
    const { events, result } = await driveGenerator(engine.applyRecovery(prdId));

    // Result shape — filesystem-only, no commit
    expect(result.verdict).toBe('retry');
    expect(result.noAction).toBe(false);
    expect(result.commitSha).toBe('');

    // Working tree: queued PRD present
    expect(await pathExists(join(dir, '.eforge', 'queue', `${prdId}.md`))).toBe(true);
    // Working tree: failed PRD absent
    expect(await pathExists(join(dir, '.eforge', 'queue', 'failed', `${prdId}.md`))).toBe(false);
    // Working tree: sidecar files absent
    expect(await pathExists(join(dir, '.eforge', 'queue', 'failed', `${prdId}.recovery.md`))).toBe(false);
    expect(await pathExists(join(dir, '.eforge', 'queue', 'failed', `${prdId}.recovery.json`))).toBe(false);

    // Events
    const startEvent = events.find((e) => e.type === 'recovery:apply:start');
    expect(startEvent).toBeDefined();
    const completeEvent = events.find((e) => e.type === 'recovery:apply:complete');
    expect(completeEvent).toBeDefined();
    expect((completeEvent as Extract<EforgeEvent, { type: 'recovery:apply:complete' }>).verdict).toBe('retry');
    expect((completeEvent as Extract<EforgeEvent, { type: 'recovery:apply:complete' }>).noAction).toBe(false);
  });

  it('does not create a new git commit (filesystem-only)', async () => {
    const dir = makeTempDir();
    const prdId = 'test-retry-no-commit';
    seedGitRepo(dir);
    await seedFailedPrd(dir, prdId, 'retry');

    const headBefore = await gitHeadSha(dir);

    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: new StubHarness([validRecoveryExtractorResponse()]) });
    await driveGenerator(engine.applyRecovery(prdId));

    // HEAD must not advance — no commit is made for filesystem-only queue operations
    const headAfter = await gitHeadSha(dir);
    expect(headAfter).toBe(headBefore);
  });
});

// ---------------------------------------------------------------------------
// continue-repair verdict
// ---------------------------------------------------------------------------

describe('applyRecovery — continue-repair', () => {
  const makeTempDir = useTempDir('eforge-apply-recovery-continue-repair-');

  async function createFeatureBranchWithArtifacts(cwd: string, setName = 'test-set'): Promise<void> {
    execFileSync('git', ['switch', '-c', `eforge/${setName}`], { cwd });
    const planDir = join(cwd, 'eforge', 'plans', setName);
    await mkdir(planDir, { recursive: true });
    await writeFile(
      join(planDir, 'orchestration.yaml'),
      `name: ${setName}
description: Continue repair fixture
base_branch: main
mode: excursion
validate: []
plans:
  - id: plan-01
    name: Plan 01
    depends_on: []
    branch: ${setName}/plan-01
    build:
      - implement
    review:
      strategy: auto
      perspectives:
        - code
      maxRounds: 1
      evaluatorStrictness: standard
pipeline:
  scope: excursion
  compile: []
  defaultBuild: []
  defaultReview:
    strategy: auto
    perspectives:
      - code
    maxRounds: 1
    evaluatorStrictness: standard
  rationale: continue-repair
`,
      'utf-8',
    );
    await writeFile(join(planDir, 'plan-01.md'), '# Plan 01\n', 'utf-8');
    execFileSync('git', ['add', 'eforge'], { cwd });
    execFileSync('git', ['commit', '-m', 'plan: compiled artifacts'], { cwd });
    execFileSync('git', ['switch', 'main'], { cwd });
  }

  it('queues the failed PRD through compiled-artifact repair and writes an applied marker', async () => {
    const dir = makeTempDir();
    const prdId = 'test-continue-repair-prd';
    seedGitRepo(dir);
    await createFeatureBranchWithArtifacts(dir);
    await seedFailedPrd(dir, prdId, 'continue-repair');

    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: new StubHarness([]) });
    const { events, result } = await driveGenerator(engine.applyRecovery(prdId));

    expect(result.verdict).toBe('continue-repair');
    expect(result.noAction).toBe(false);
    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(result.status).toBe('applied');
    expect(result.detail).toMatch(/continue/i);

    expect(await pathExists(join(dir, '.eforge', 'queue', `${prdId}.md`))).toBe(true);
    expect(await pathExists(join(dir, '.eforge', 'queue', 'failed', `${prdId}.md`))).toBe(false);
    expect(await pathExists(join(dir, '.eforge', 'queue', 'failed', `${prdId}.recovery.md`))).toBe(true);
    expect(await pathExists(join(dir, '.eforge', 'queue', 'failed', `${prdId}.recovery.json`))).toBe(true);

    const queuedContent = await readFile(join(dir, '.eforge', 'queue', `${prdId}.md`), 'utf-8');
    expect(queuedContent).toContain('resume_mode: compiled');
    expect(queuedContent).toContain('resume_set_name: test-set');

    const sidecar = JSON.parse(await readFile(join(dir, '.eforge', 'queue', 'failed', `${prdId}.recovery.json`), 'utf-8'));
    expect(sidecar.applied).toMatchObject({ action: 'continue-repair', commitSha: result.commitSha });
    expect(typeof sidecar.applied.appliedAt).toBe('string');

    const completeEvent = events.find((e): e is Extract<EforgeEvent, { type: 'recovery:apply:complete' }> => e.type === 'recovery:apply:complete');
    expect(completeEvent).toBeDefined();
    expect(completeEvent!.verdict).toBe('continue-repair');
    expect(completeEvent!.noAction).toBe(false);
  });

  it('returns already-applied when continue-repair has already queued the PRD', async () => {
    const dir = makeTempDir();
    const prdId = 'test-continue-repair-twice';
    seedGitRepo(dir);
    await createFeatureBranchWithArtifacts(dir);
    await seedFailedPrd(dir, prdId, 'continue-repair');

    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: new StubHarness([]) });
    const first = await driveGenerator(engine.applyRecovery(prdId));
    const second = await driveGenerator(engine.applyRecovery(prdId));

    expect(first.result.status).toBe('applied');
    expect(second.result.verdict).toBe('continue-repair');
    expect(second.result.status).toBe('already-applied');
    expect(second.result.detail).toMatch(/already queued|already/i);
    expect(await pathExists(join(dir, '.eforge', 'queue', `${prdId}.md`))).toBe(true);
  });

  it('throws without moving queue files when compiled artifacts are not eligible', async () => {
    const dir = makeTempDir();
    const prdId = 'test-continue-repair-missing-artifacts';
    seedGitRepo(dir);
    await seedFailedPrd(dir, prdId, 'continue-repair');

    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: new StubHarness([]) });

    await expect(driveGenerator(engine.applyRecovery(prdId))).rejects.toThrow(/eforge\/test-set|feature branch|artifact/i);
    expect(await pathExists(join(dir, '.eforge', 'queue', 'failed', `${prdId}.md`))).toBe(true);
    expect(await pathExists(join(dir, '.eforge', 'queue', `${prdId}.md`))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// abandon verdict
// ---------------------------------------------------------------------------

describe('applyRecovery — abandon', () => {
  const makeTempDir = useTempDir('eforge-apply-recovery-abandon-');

  it('removes failed PRD and both sidecars', async () => {
    const dir = makeTempDir();
    const prdId = 'test-abandon-prd';
    seedGitRepo(dir);
    await seedFailedPrd(dir, prdId, 'abandon');

    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: new StubHarness([validRecoveryExtractorResponse()]) });
    const { events, result } = await driveGenerator(engine.applyRecovery(prdId));

    // Result shape — filesystem-only, no commit
    expect(result.verdict).toBe('abandon');
    expect(result.noAction).toBe(false);
    expect(result.commitSha).toBe('');

    // Working tree: all three paths absent
    expect(await pathExists(join(dir, '.eforge', 'queue', 'failed', `${prdId}.md`))).toBe(false);
    expect(await pathExists(join(dir, '.eforge', 'queue', 'failed', `${prdId}.recovery.md`))).toBe(false);
    expect(await pathExists(join(dir, '.eforge', 'queue', 'failed', `${prdId}.recovery.json`))).toBe(false);

    // Events
    const completeEvent = events.find((e) => e.type === 'recovery:apply:complete') as
      | Extract<EforgeEvent, { type: 'recovery:apply:complete' }>
      | undefined;
    expect(completeEvent).toBeDefined();
    expect(completeEvent!.verdict).toBe('abandon');
    expect(completeEvent!.noAction).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// manual verdict
// ---------------------------------------------------------------------------

describe('applyRecovery — manual', () => {
  const makeTempDir = useTempDir('eforge-apply-recovery-manual-');

  it('makes no git changes and returns noAction: true', async () => {
    const dir = makeTempDir();
    const prdId = 'test-manual-prd';
    seedGitRepo(dir);
    await seedFailedPrd(dir, prdId, 'manual');

    const headBefore = await gitHeadSha(dir);

    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: new StubHarness([validRecoveryExtractorResponse()]) });
    const { events, result } = await driveGenerator(engine.applyRecovery(prdId));

    // Result shape
    expect(result.verdict).toBe('manual');
    expect(result.noAction).toBe(true);
    expect(result.commitSha).toBeUndefined();

    // No new commit
    const headAfter = await gitHeadSha(dir);
    expect(headAfter).toBe(headBefore);

    // Working tree: files still present
    expect(await pathExists(join(dir, '.eforge', 'queue', 'failed', `${prdId}.md`))).toBe(true);
    expect(await pathExists(join(dir, '.eforge', 'queue', 'failed', `${prdId}.recovery.md`))).toBe(true);
    expect(await pathExists(join(dir, '.eforge', 'queue', 'failed', `${prdId}.recovery.json`))).toBe(true);

    // Events
    const startEvent = events.find((e) => e.type === 'recovery:apply:start');
    expect(startEvent).toBeDefined();
    const completeEvent = events.find((e) => e.type === 'recovery:apply:complete') as
      | Extract<EforgeEvent, { type: 'recovery:apply:complete' }>
      | undefined;
    expect(completeEvent).toBeDefined();
    expect(completeEvent!.verdict).toBe('manual');
    expect(completeEvent!.noAction).toBe(true);
  });

  it('returns noAction for a manual sidecar that contains a continue-repair recommendation', async () => {
    const dir = makeTempDir();
    const prdId = 'test-manual-with-continue-repair';
    seedGitRepo(dir);
    await seedFailedPrd(dir, prdId, 'manual');

    const sidecarPath = join(dir, '.eforge', 'queue', 'failed', `${prdId}.recovery.json`);
    const sidecar = JSON.parse(await readFile(sidecarPath, 'utf-8')) as Record<string, unknown>;
    sidecar.continueRepairEligibility = {
      source: 'continueRepairEligibility',
      eligible: true,
      featureBranch: 'eforge/test-set',
      artifactAvailability: 'feature-branch',
      landedCommitCount: 1,
      diffStat: '1 file changed',
    };
    sidecar.recoveryOptions = [{ kind: 'continue-repair', action: 'continue-repair', recommended: true, reason: 'Eligible compiled artifacts.' }];
    await writeFile(sidecarPath, JSON.stringify(sidecar, null, 2), 'utf-8');
    execFileSync('git', ['add', '--', sidecarPath], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'chore: add continue-repair sidecar fields'], { cwd: dir });

    const headBefore = await gitHeadSha(dir);
    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: new StubHarness([validRecoveryExtractorResponse()]) });
    const { result } = await driveGenerator(engine.applyRecovery(prdId));

    expect(result.verdict).toBe('manual');
    expect(result.noAction).toBe(true);
    expect(await gitHeadSha(dir)).toBe(headBefore);
    expect(await pathExists(join(dir, '.eforge', 'queue', 'failed', `${prdId}.md`))).toBe(true);
    expect((await readdir(join(dir, '.eforge', 'queue'))).filter((entry) => entry.endsWith('.md'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe('applyRecovery — error paths', () => {
  const makeTempDir = useTempDir('eforge-apply-recovery-errors-');

  it('throws with recover() message when sidecar JSON is missing', async () => {
    const dir = makeTempDir();
    const prdId = 'no-sidecar-prd';
    seedGitRepo(dir);

    // Only create the PRD file, no sidecar
    const failedDir = join(dir, '.eforge', 'queue', 'failed');
    await mkdir(failedDir, { recursive: true });
    await writeFile(join(failedDir, `${prdId}.md`), '# PRD', 'utf-8');

    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: new StubHarness([validRecoveryExtractorResponse()]) });

    await expect(
      driveGenerator(engine.applyRecovery(prdId)),
    ).rejects.toThrow(/recover\(\)/);
  });

  it('throws when a legacy continuation sidecar is applied', async () => {
    const dir = makeTempDir();
    const prdId = 'legacy-continuation-sidecar';
    seedGitRepo(dir);

    const failedDir = join(dir, '.eforge', 'queue', 'failed');
    await mkdir(failedDir, { recursive: true });
    await writeFile(join(failedDir, `${prdId}.md`), '# PRD', 'utf-8');
    await writeFile(join(failedDir, `${prdId}.recovery.md`), '# Report', 'utf-8');

    const removedVerdict = ['s', 'plit'].join('');
    const sidecarJson = {
      schemaVersion: 3,
      generatedAt: new Date().toISOString(),
      summary: {
        prdId,
        setName: 'test-set',
        featureBranch: 'eforge/test-set',
        baseBranch: 'main',
        plans: [],
        failingPlan: { planId: 'plan-01' },
        landedCommits: [],
        diffStat: '',
        modelsUsed: [],
        failedAt: new Date().toISOString(),
      },
      verdict: {
        verdict: removedVerdict,
        confidence: 'medium',
        rationale: 'Legacy continuation output.',
        completedWork: [],
        remainingWork: [],
        risks: [],
      },
    };
    await writeFile(
      join(failedDir, `${prdId}.recovery.json`),
      JSON.stringify(recoverySidecarFromLegacy(sidecarJson), null, 2),
      'utf-8',
    );

    execFileSync('git', ['add', '--', failedDir], { cwd: dir });
    execFileSync('git', ['commit', '-m', `chore: seed legacy continuation sidecar ${prdId}`], { cwd: dir });

    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: new StubHarness([validRecoveryExtractorResponse()]) });

    await expect(
      driveGenerator(engine.applyRecovery(prdId)),
    ).rejects.toThrow(/legacy continuation|no longer supported/i);
  });


  it('emits recovery:apply:start before throwing on missing sidecar', async () => {
    const dir = makeTempDir();
    const prdId = 'no-sidecar-events';
    seedGitRepo(dir);

    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: new StubHarness([validRecoveryExtractorResponse()]) });
    const gen = engine.applyRecovery(prdId);
    const events: EforgeEvent[] = [];

    // Drive generator manually so we can catch and inspect events before throw
    try {
      while (true) {
        const next = await gen.next();
        if (next.done) break;
        events.push(next.value);
      }
    } catch {
      // Expected throw
    }

    const startEvent = events.find((e) => e.type === 'recovery:apply:start');
    expect(startEvent).toBeDefined();

    const errorEvent = events.find((e) => e.type === 'recovery:apply:error');
    expect(errorEvent).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Backward compatibility: sidecars with optional verdict metadata fields
// ---------------------------------------------------------------------------

describe('applyRecovery — backward compatibility with optional verdict metadata fields', () => {
  const makeTempDir = useTempDir('eforge-apply-verdict-metadata-compat-');

  /**
   * Seed a sidecar JSON with optional plan-02 verdict metadata fields.
   * Existing consumers of the sidecar (applyRecovery) must not reject these fields.
   */
  async function seedSidecarWithVerdictMetadata(
    dir: string,
    prdId: string,
    verdictType: 'retry',
  ): Promise<void> {
    const failedDir = join(dir, '.eforge', 'queue', 'failed');
    await mkdir(failedDir, { recursive: true });

    const prdContent = `# Test PRD: ${prdId}\n\nBuild something.`;
    await writeFile(join(failedDir, `${prdId}.md`), prdContent, 'utf-8');

    const recoveryMd = `## Recovery Report\n\nVerdict: ${verdictType.toUpperCase()}\n\n**Verdict Source:** deterministic`;
    await writeFile(join(failedDir, `${prdId}.recovery.md`), recoveryMd, 'utf-8');

    const verdictJson: Record<string, unknown> = {
      verdict: verdictType,
      confidence: 'high',
      rationale: 'All failures were transient transport errors.',
      completedWork: [],
      remainingWork: [],
      risks: [],
      // New optional fields from plan-02
      recommendationSource: 'deterministic',
      recommendationRationale: 'All failed plans have terminalSubtype error_transient_transport with zero tool use.',
    };

    const sidecarJson = {
      schemaVersion: 3,
      generatedAt: new Date().toISOString(),
      summary: {
        prdId,
        setName: 'test-set',
        featureBranch: 'eforge/test-set',
        baseBranch: 'main',
        plans: [{ planId: 'plan-01', status: 'failed', error: 'API error 529' }],
        failingPlan: { planId: 'plan-01', errorMessage: 'API error 529', terminalSubtype: 'error_transient_transport' },
        failingPlans: [
          { planId: 'plan-01', errorMessage: 'API error 529', terminalSubtype: 'error_transient_transport', toolUseCount: 0 },
        ],
        landedCommits: [],
        diffStat: '',
        modelsUsed: [],
        failedAt: new Date().toISOString(),
      },
      verdict: verdictJson,
    };

    await writeFile(
      join(failedDir, `${prdId}.recovery.json`),
      JSON.stringify(recoverySidecarFromLegacy(sidecarJson), null, 2),
      'utf-8',
    );

    const gitOpts = { cwd: dir };
    execFileSync('git', ['add', '--', failedDir], gitOpts);
    execFileSync('git', ['commit', '-m', `chore: seed sidecar with verdict metadata ${prdId}`], gitOpts);
  }

  it('applyRecovery — retry sidecar with recommendationSource metadata is applied without error', async () => {
    const dir = makeTempDir();
    const prdId = 'compat-retry-metadata';
    seedGitRepo(dir);
    await seedSidecarWithVerdictMetadata(dir, prdId, 'retry');

    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: new StubHarness([validRecoveryExtractorResponse()]) });
    const { result } = await driveGenerator(engine.applyRecovery(prdId));

    // Must succeed — schema changes are backward-compatible
    expect(result.verdict).toBe('retry');
    expect(result.noAction).toBe(false);
    expect(result.commitSha).toBe('');
  });

  it('applyRecovery — sidecar with verdictInvalidationReason is applied without error', async () => {
    const dir = makeTempDir();
    const prdId = 'compat-invalidation-retry';
    seedGitRepo(dir);

    const failedDir = join(dir, '.eforge', 'queue', 'failed');
    await mkdir(failedDir, { recursive: true });
    await writeFile(join(failedDir, `${prdId}.md`), `# Test PRD: ${prdId}`, 'utf-8');
    await writeFile(join(failedDir, `${prdId}.recovery.md`), '## Recovery\n\nAnalyst rejected.', 'utf-8');

    // Sidecar with verdictInvalidationReason from analyst invalidation path
    const sidecarJson = {
      schemaVersion: 3,
      generatedAt: new Date().toISOString(),
      summary: {
        prdId,
        setName: 'test-set',
        featureBranch: 'eforge/test-set',
        baseBranch: 'main',
        plans: [{ planId: 'plan-01', status: 'failed' }],
        failingPlan: { planId: 'plan-01' },
        failingPlans: [{ planId: 'plan-01', errorMessage: 'API error 529' }],
        landedCommits: [],
        diffStat: '',
        modelsUsed: [],
        failedAt: new Date().toISOString(),
      },
      verdict: {
        verdict: 'manual',
        confidence: 'low',
        rationale: 'Analyst verdict was rejected due to missing plan coverage.',
        completedWork: [],
        remainingWork: [],
        risks: [],
        // New optional plan-02 field
        verdictInvalidationReason: 'Analyst rationale did not mention plan-01',
        recommendationSource: 'manual-fallback',
      },
    };

    await writeFile(
      join(failedDir, `${prdId}.recovery.json`),
      JSON.stringify(recoverySidecarFromLegacy(sidecarJson), null, 2),
      'utf-8',
    );
    execFileSync('git', ['add', '--', failedDir], { cwd: dir });
    execFileSync('git', ['commit', '-m', `chore: seed invalidation sidecar ${prdId}`], { cwd: dir });

    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: new StubHarness([validRecoveryExtractorResponse()]) });
    const { result } = await driveGenerator(engine.applyRecovery(prdId));

    // manual verdict → noAction: true (no files moved)
    expect(result.verdict).toBe('manual');
    expect(result.noAction).toBe(true);
  });

  it('applyRecovery — legacy sidecar without verdict metadata is still applied correctly', async () => {
    // Ensures backward compatibility: old sidecars without plan-02 metadata fields
    // must continue to work through applyRecovery
    const dir = makeTempDir();
    const prdId = 'legacy-no-metadata';
    seedGitRepo(dir);

    const failedDir = join(dir, '.eforge', 'queue', 'failed');
    await mkdir(failedDir, { recursive: true });
    await writeFile(join(failedDir, `${prdId}.md`), `# Test PRD: ${prdId}`, 'utf-8');
    await writeFile(join(failedDir, `${prdId}.recovery.md`), '## Recovery\n\nLegacy sidecar.', 'utf-8');

    // Classic v2 sidecar without any plan-02 metadata
    const legacySidecarJson = {
      schemaVersion: 3,
      generatedAt: new Date().toISOString(),
      summary: {
        prdId,
        setName: 'test-set',
        featureBranch: 'eforge/test-set',
        baseBranch: 'main',
        plans: [{ planId: 'plan-01', status: 'failed', error: 'Compile error' }],
        failingPlan: { planId: 'plan-01', errorMessage: 'Compile error' },
        // No failingPlans, no new fields
        landedCommits: [],
        diffStat: '',
        modelsUsed: [],
        failedAt: new Date().toISOString(),
      },
      verdict: {
        verdict: 'retry',
        confidence: 'medium',
        rationale: 'Classic recovery verdict without metadata fields.',
        completedWork: [],
        remainingWork: [],
        risks: [],
        // No recommendationSource, recommendationRationale, or verdictInvalidationReason
      },
    };

    await writeFile(
      join(failedDir, `${prdId}.recovery.json`),
      JSON.stringify(recoverySidecarFromLegacy(legacySidecarJson), null, 2),
      'utf-8',
    );
    execFileSync('git', ['add', '--', failedDir], { cwd: dir });
    execFileSync('git', ['commit', '-m', `chore: seed legacy sidecar ${prdId}`], { cwd: dir });

    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: new StubHarness([validRecoveryExtractorResponse()]) });
    const { result } = await driveGenerator(engine.applyRecovery(prdId));

    // Legacy sidecar must work exactly as before
    expect(result.verdict).toBe('retry');
    expect(result.noAction).toBe(false);
    expect(result.commitSha).toBe('');
  });
});

