/**
 * Tests for EforgeEngine.applyRecovery — all four verdict dispatches plus error paths.
 *
 * Each test builds a real git fixture, seeds the failed PRD + both sidecar files,
 * calls engine.applyRecovery(), then asserts post-conditions on the working tree.
 *
 * Per plan-02: queue state is filesystem-only (queue is gitignored). Recovery
 * operations no longer make git commits — commitSha is always '' (empty string)
 * for retry/split/abandon, and undefined for manual (noAction).
 *
 * Per AGENTS.md: no harness or git mocks — all tests use real git operations.
 */

import { describe, it, expect } from 'vitest';
import { readFile, mkdir, writeFile, access, readdir } from 'node:fs/promises';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { EforgeEngine } from '@eforge-build/engine/eforge';
import { requireAcceptanceCriteriaInventoryFromPrd } from '@eforge-build/engine/validation/acceptance-criteria-inventory';
import { useTempDir } from './test-tmpdir.js';
import { StubHarness } from './stub-harness.js';
import type { EforgeEvent } from '@eforge-build/engine/events';
import type { ApplyRecoveryResult } from '@eforge-build/engine/schemas';

const execAsync = promisify(execFile);
const RECOVERY_AC_SENTENCE = 'The successor must persist canonical acceptance criteria before recovery queueing completes.';

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

function bodyWithRecoveryAcceptanceCriteria(body: string): string {
  return `${body.trimEnd()}\n\n## Acceptance Criteria\n\n- ${RECOVERY_AC_SENTENCE}\n`;
}

function validRecoveryExtractorResponse(): { resultText: string } {
  return {
    resultText: JSON.stringify({
      version: 1,
      criteria: [{
        text: RECOVERY_AC_SENTENCE,
        raw: `- ${RECOVERY_AC_SENTENCE}`,
        sourceQuote: RECOVERY_AC_SENTENCE,
        confidence: 0.95,
      }],
    }),
  };
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
  verdict: 'retry' | 'split' | 'abandon' | 'manual',
  opts?: { suggestedSuccessorPrd?: string; summary?: Record<string, unknown> },
): Promise<void> {
  const failedDir = join(dir, '.eforge', 'queue', 'failed');
  await mkdir(failedDir, { recursive: true });

  // Write the PRD file
  const prdContent = `# Test PRD: ${prdId}\n\nBuild something.`;
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
  if (verdict === 'split') {
    verdictJson.suggestedSuccessorPrd = bodyWithRecoveryAcceptanceCriteria(
      opts?.suggestedSuccessorPrd ?? '# Successor Feature\n\nContinue the work.',
    );
  }
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
// split verdict
// ---------------------------------------------------------------------------

describe('applyRecovery — split', () => {
  const makeTempDir = useTempDir('eforge-apply-recovery-split-');

  it('writes successor PRD to queue, leaves failed PRD and sidecars', async () => {
    const dir = makeTempDir();
    const prdId = 'test-split-prd';
    seedGitRepo(dir);
    await seedFailedPrd(dir, prdId, 'split', {
      suggestedSuccessorPrd: '# Successor Feature\n\nContinue the API work.',
    });

    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: new StubHarness([validRecoveryExtractorResponse()]) });
    const { events, result } = await driveGenerator(engine.applyRecovery(prdId));

    // Result shape — filesystem-only, no commit
    expect(result.verdict).toBe('split');
    expect(result.noAction).toBe(false);
    expect(result.successorPrdId).toBeDefined();
    expect(result.commitSha).toBe('');

    const successorPrdId = result.successorPrdId!;

    // Working tree: successor PRD present in queue
    expect(await pathExists(join(dir, '.eforge', 'queue', `${successorPrdId}.md`))).toBe(true);
    // Working tree: failed PRD still present
    expect(await pathExists(join(dir, '.eforge', 'queue', 'failed', `${prdId}.md`))).toBe(true);
    // Working tree: sidecars still present
    expect(await pathExists(join(dir, '.eforge', 'queue', 'failed', `${prdId}.recovery.md`))).toBe(true);
    expect(await pathExists(join(dir, '.eforge', 'queue', 'failed', `${prdId}.recovery.json`))).toBe(true);

    // Successor content matches suggestedSuccessorPrd
    const successorContent = await readFile(
      join(dir, '.eforge', 'queue', `${successorPrdId}.md`),
      'utf-8',
    );
    expect(successorContent).toContain('Successor Feature');
    expect(requireAcceptanceCriteriaInventoryFromPrd(successorContent).criteria).toHaveLength(1);

    // Events
    const completeEvent = events.find((e) => e.type === 'recovery:apply:complete') as
      | Extract<EforgeEvent, { type: 'recovery:apply:complete' }>
      | undefined;
    expect(completeEvent).toBeDefined();
    expect(completeEvent!.verdict).toBe('split');
    expect(completeEvent!.successorPrdId).toBe(successorPrdId);
  });

  it('strips agent-emitted frontmatter and rebuilds clean frontmatter with no depends_on', async () => {
    const dir = makeTempDir();
    const prdId = 'test-split-frontmatter-strip';
    seedGitRepo(dir);
    await seedFailedPrd(dir, prdId, 'split', {
      suggestedSuccessorPrd: [
        '',
        '  ',
        '---',
        'title: Wrong Title',
        'depends_on: ["the-failed-prd-id"]',
        '---',
        '',
        '# Real Title',
        '',
        'Body content here.',
      ].join('\n'),
    });

    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: new StubHarness([validRecoveryExtractorResponse()]) });
    const { result } = await driveGenerator(engine.applyRecovery(prdId));

    // Successor ID should come from the body heading, not the agent frontmatter
    expect(result.successorPrdId).toBe('real-title');

    // Successor file should exist
    const successorPath = join(dir, '.eforge', 'queue', 'real-title.md');
    expect(await pathExists(successorPath)).toBe(true);

    const successorContent = await readFile(successorPath, 'utf-8');

    // Frontmatter should have title from the H1 heading
    expect(successorContent).toContain('title: Real Title');

    // Frontmatter must not contain depends_on
    expect(successorContent).not.toMatch(/depends_on:/);

    // Body section (after trailing ---) must not begin with ---
    const fmEnd = successorContent.indexOf('\n---\n', successorContent.indexOf('---'));
    const bodySection = successorContent.slice(fmEnd + 5).replace(/^\s+/, '');
    expect(bodySection).not.toMatch(/^---/);
  });

  it('derives successor ID from the first heading', async () => {
    const dir = makeTempDir();
    const prdId = 'test-split-slug';
    seedGitRepo(dir);
    await seedFailedPrd(dir, prdId, 'split', {
      suggestedSuccessorPrd: '# REST API Layer\n\nBuild the REST layer.',
    });

    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: new StubHarness([validRecoveryExtractorResponse()]) });
    const { result } = await driveGenerator(engine.applyRecovery(prdId));

    expect(result.successorPrdId).toBe('rest-api-layer');
  });

  it('writes continuation frontmatter when landed commits exist on a preserved feature branch', async () => {
    const dir = makeTempDir();
    const prdId = 'test-split-landed-continuation';
    seedGitRepo(dir);
    execFileSync('git', ['branch', 'eforge/test-set'], { cwd: dir });
    await seedFailedPrd(dir, prdId, 'split', {
      summary: {
        landedCommits: [{ sha: 'abc123', subject: 'partial work', author: 'Test', date: new Date().toISOString() }],
      },
    });

    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: new StubHarness([validRecoveryExtractorResponse()]) });
    const { result } = await driveGenerator(engine.applyRecovery(prdId));
    const content = await readFile(join(dir, '.eforge', 'queue', `${result.successorPrdId}.md`), 'utf-8');

    expect(content).toContain(`recovery_from: ${prdId}`);
    expect(content).toContain('recovery_set_name: test-set');
    expect(content).toContain('recovery_feature_branch: eforge/test-set');
    expect(content).toContain('recovery_base_branch: main');
  });

  it('writes continuation frontmatter when a plan has mergedAt even with no landed commits', async () => {
    const dir = makeTempDir();
    const prdId = 'test-split-merged-continuation';
    seedGitRepo(dir);
    execFileSync('git', ['branch', 'eforge/test-set'], { cwd: dir });
    await seedFailedPrd(dir, prdId, 'split', {
      summary: {
        landedCommits: [],
        plans: [{ planId: 'plan-01', status: 'merged', mergedAt: new Date().toISOString() }],
      },
    });

    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: new StubHarness([validRecoveryExtractorResponse()]) });
    const { result } = await driveGenerator(engine.applyRecovery(prdId));
    const content = await readFile(join(dir, '.eforge', 'queue', `${result.successorPrdId}.md`), 'utf-8');

    expect(content).toContain(`recovery_from: ${prdId}`);
    expect(content).toContain('recovery_set_name: test-set');
    expect(content).toContain('recovery_feature_branch: eforge/test-set');
    expect(content).toContain('recovery_base_branch: main');
  });

  it('strips conflicting agent recovery frontmatter and uses sidecar-derived continuation fields', async () => {
    const dir = makeTempDir();
    const prdId = 'test-split-conflicting-frontmatter';
    seedGitRepo(dir);
    execFileSync('git', ['branch', 'eforge/test-set'], { cwd: dir });
    await seedFailedPrd(dir, prdId, 'split', {
      suggestedSuccessorPrd: [
        '---',
        'title: Wrong Title',
        'recovery_from: attacker',
        'recovery_set_name: attacker-set',
        'recovery_feature_branch: eforge/attacker',
        'recovery_base_branch: attacker-base',
        '---',
        '',
        '# Trusted Successor',
        '',
        'Continue safely.',
      ].join('\n'),
      summary: {
        landedCommits: [{ sha: 'abc123', subject: 'partial work', author: 'Test', date: new Date().toISOString() }],
      },
    });

    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: new StubHarness([validRecoveryExtractorResponse()]) });
    const { result } = await driveGenerator(engine.applyRecovery(prdId));
    const content = await readFile(join(dir, '.eforge', 'queue', `${result.successorPrdId}.md`), 'utf-8');

    expect(content).not.toContain('attacker');
    expect(content).toContain(`recovery_from: ${prdId}`);
    expect(content).toContain('recovery_feature_branch: eforge/test-set');
  });

  it('rejects partial-work split with a missing preserved feature branch before writing a successor', async () => {
    const dir = makeTempDir();
    const prdId = 'test-split-missing-branch';
    seedGitRepo(dir);
    await seedFailedPrd(dir, prdId, 'split', {
      summary: {
        landedCommits: [{ sha: 'abc123', subject: 'partial work', author: 'Test', date: new Date().toISOString() }],
      },
    });

    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: new StubHarness([validRecoveryExtractorResponse()]) });
    await expect(driveGenerator(engine.applyRecovery(prdId))).rejects.toThrow(/eforge\/test-set/);

    const entries = await readdir(join(dir, '.eforge', 'queue'));
    expect(entries.filter((entry) => entry.endsWith('.md'))).toEqual([]);
  });

  it('rejects partial-work split with an unsafe preserved feature branch before writing a successor', async () => {
    const dir = makeTempDir();
    const prdId = 'test-split-unsafe-branch';
    seedGitRepo(dir);
    await seedFailedPrd(dir, prdId, 'split', {
      summary: {
        featureBranch: 'eforge/test-set..evil',
        landedCommits: [{ sha: 'abc123', subject: 'partial work', author: 'Test', date: new Date().toISOString() }],
      },
    });

    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: new StubHarness([validRecoveryExtractorResponse()]) });
    await expect(driveGenerator(engine.applyRecovery(prdId))).rejects.toThrow(/test-set\.\.evil/);

    const entries = await readdir(join(dir, '.eforge', 'queue'));
    expect(entries.filter((entry) => entry.endsWith('.md'))).toEqual([]);
  });

  it('rejects partial-work split with a missing original base branch before writing a successor', async () => {
    const dir = makeTempDir();
    const prdId = 'test-split-missing-base';
    seedGitRepo(dir);
    execFileSync('git', ['branch', 'eforge/test-set'], { cwd: dir });
    await seedFailedPrd(dir, prdId, 'split', {
      summary: {
        baseBranch: 'missing-base',
        landedCommits: [{ sha: 'abc123', subject: 'partial work', author: 'Test', date: new Date().toISOString() }],
      },
    });

    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: new StubHarness([validRecoveryExtractorResponse()]) });
    await expect(driveGenerator(engine.applyRecovery(prdId))).rejects.toThrow(/missing-base/);

    const entries = await readdir(join(dir, '.eforge', 'queue'));
    expect(entries.filter((entry) => entry.endsWith('.md'))).toEqual([]);
  });

  it('rejects partial-work split with an unsafe original base branch before writing a successor', async () => {
    const dir = makeTempDir();
    const prdId = 'test-split-unsafe-base';
    seedGitRepo(dir);
    execFileSync('git', ['branch', 'eforge/test-set'], { cwd: dir });
    await seedFailedPrd(dir, prdId, 'split', {
      summary: {
        baseBranch: 'main^{commit}',
        landedCommits: [{ sha: 'abc123', subject: 'partial work', author: 'Test', date: new Date().toISOString() }],
      },
    });

    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: new StubHarness([validRecoveryExtractorResponse()]) });
    await expect(driveGenerator(engine.applyRecovery(prdId))).rejects.toThrow(/main\^\{commit\}/);

    const entries = await readdir(join(dir, '.eforge', 'queue'));
    expect(entries.filter((entry) => entry.endsWith('.md'))).toEqual([]);
  });

  it.each([
    ['malformed JSON', 'NOT JSON', /invalid/i],
    ['empty criteria', JSON.stringify({ version: 1, criteria: [] }), /empty/i],
    ['ungrounded source quote', JSON.stringify({ version: 1, criteria: [{ text: RECOVERY_AC_SENTENCE, raw: `- ${RECOVERY_AC_SENTENCE}`, sourceQuote: 'not in source', confidence: 0.95 }] }), /sourceQuote/i],
    ['low confidence', JSON.stringify({ version: 1, criteria: [{ text: RECOVERY_AC_SENTENCE, raw: `- ${RECOVERY_AC_SENTENCE}`, sourceQuote: RECOVERY_AC_SENTENCE, confidence: 0.2 }] }), /confidence/i],
    ['duplicate criteria', JSON.stringify({ version: 1, criteria: [{ text: RECOVERY_AC_SENTENCE, raw: `- ${RECOVERY_AC_SENTENCE}`, sourceQuote: RECOVERY_AC_SENTENCE, confidence: 0.95 }, { text: RECOVERY_AC_SENTENCE, raw: `- ${RECOVERY_AC_SENTENCE}`, sourceQuote: RECOVERY_AC_SENTENCE, confidence: 0.95 }] }), /duplicate/i],
    ['grouping-label criteria', JSON.stringify({ version: 1, criteria: [{ text: 'Security:', raw: '- Security:', sourceQuote: RECOVERY_AC_SENTENCE, confidence: 0.95 }] }), /criteria/i],
    ['bare-command criteria', JSON.stringify({ version: 1, criteria: [{ text: 'Run pnpm test', raw: '- Run pnpm test', sourceQuote: RECOVERY_AC_SENTENCE, confidence: 0.95 }] }), /criteria/i],
    ['vague criteria', JSON.stringify({ version: 1, criteria: [{ text: 'Ensure it works', raw: '- Ensure it works', sourceQuote: RECOVERY_AC_SENTENCE, confidence: 0.95 }] }), /criteria/i],
    ['no extractor output', '', /no output/i],
  ])('rejects %s before writing a successor', async (_name, resultText, messagePattern) => {
    const dir = makeTempDir();
    const prdId = `test-split-invalid-extractor-${String(_name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    seedGitRepo(dir);
    await seedFailedPrd(dir, prdId, 'split', {
      suggestedSuccessorPrd: '# Successor Feature\n\nContinue the API work.',
    });

    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: new StubHarness([{ resultText }]) });
    await expect(driveGenerator(engine.applyRecovery(prdId))).rejects.toThrow(messagePattern);

    const entries = await readdir(join(dir, '.eforge', 'queue'));
    expect(entries.filter((entry) => entry.endsWith('.md'))).toEqual([]);
  });

  it('omits continuation frontmatter (but keeps the split-source marker) when no partial landed or merged evidence exists', async () => {
    const dir = makeTempDir();
    const prdId = 'test-split-fresh-successor';
    seedGitRepo(dir);
    await seedFailedPrd(dir, prdId, 'split');

    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: new StubHarness([validRecoveryExtractorResponse()]) });
    const { result } = await driveGenerator(engine.applyRecovery(prdId));
    const content = await readFile(join(dir, '.eforge', 'queue', `${result.successorPrdId}.md`), 'utf-8');

    // No resume continuation metadata is written without landed/merged evidence...
    expect(content).not.toMatch(/^recovery_from:/m);
    expect(content).not.toMatch(/^recovery_set_name:/m);
    expect(content).not.toMatch(/^recovery_feature_branch:/m);
    expect(content).not.toMatch(/^recovery_base_branch:/m);
    // ...but the durable split-source idempotency marker is always present.
    expect(content).toMatch(new RegExp(`^recovery_split_source: ${prdId}$`, 'm'));
    expect(await pathExists(join(dir, '.eforge', 'queue', 'failed', `${prdId}.md`))).toBe(true);
    expect(await pathExists(join(dir, '.eforge', 'queue', 'failed', `${prdId}.recovery.md`))).toBe(true);
    expect(await pathExists(join(dir, '.eforge', 'queue', 'failed', `${prdId}.recovery.json`))).toBe(true);
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

  it('returns noAction for a manual sidecar that contains a compiled-build resume recommendation', async () => {
    const dir = makeTempDir();
    const prdId = 'test-manual-with-resume';
    seedGitRepo(dir);
    await seedFailedPrd(dir, prdId, 'manual');

    const sidecarPath = join(dir, '.eforge', 'queue', 'failed', `${prdId}.recovery.json`);
    const sidecar = JSON.parse(await readFile(sidecarPath, 'utf-8')) as Record<string, unknown>;
    sidecar.resumeEligibility = {
      source: 'projectResumeEligibility',
      eligible: true,
      featureBranch: 'eforge/test-set',
      artifactAvailability: 'feature-branch',
      landedCommitCount: 1,
      diffStat: '1 file changed',
    };
    sidecar.recoveryOptions = [{ kind: 'compiled-build-resume', action: 'eforge_resume_build', recommended: true, reason: 'Eligible compiled artifacts.' }];
    await writeFile(sidecarPath, JSON.stringify(sidecar, null, 2), 'utf-8');
    execFileSync('git', ['add', '--', sidecarPath], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'chore: add resume sidecar fields'], { cwd: dir });

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

  it('throws with suggestedSuccessorPrd message for split without successor content', async () => {
    const dir = makeTempDir();
    const prdId = 'split-no-successor';
    seedGitRepo(dir);

    const failedDir = join(dir, '.eforge', 'queue', 'failed');
    await mkdir(failedDir, { recursive: true });
    await writeFile(join(failedDir, `${prdId}.md`), '# PRD', 'utf-8');
    await writeFile(join(failedDir, `${prdId}.recovery.md`), '# Report', 'utf-8');

    // Write a split verdict with NO suggestedSuccessorPrd
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
        verdict: 'split',
        confidence: 'medium',
        rationale: 'Foundation done; API remains.',
        completedWork: [],
        remainingWork: [],
        risks: [],
        // suggestedSuccessorPrd intentionally omitted
      },
    };
    await writeFile(
      join(failedDir, `${prdId}.recovery.json`),
      JSON.stringify(recoverySidecarFromLegacy(sidecarJson), null, 2),
      'utf-8',
    );

    // Stage and commit
    execFileSync('git', ['add', '--', failedDir], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'chore: seed split-no-successor'], { cwd: dir });

    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: new StubHarness([validRecoveryExtractorResponse()]) });

    await expect(
      driveGenerator(engine.applyRecovery(prdId)),
    ).rejects.toThrow(/suggestedSuccessorPrd/);
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
    verdictType: 'retry' | 'split',
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
    if (verdictType === 'split') {
      verdictJson.suggestedSuccessorPrd = bodyWithRecoveryAcceptanceCriteria('# Successor PRD\n\nRetry the failed plans.');
    }

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

  it('applyRecovery — split sidecar with recommendationSource metadata is applied without error', async () => {
    const dir = makeTempDir();
    const prdId = 'compat-split-metadata';
    seedGitRepo(dir);
    await seedSidecarWithVerdictMetadata(dir, prdId, 'split');

    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: new StubHarness([validRecoveryExtractorResponse()]) });
    const { result } = await driveGenerator(engine.applyRecovery(prdId));

    expect(result.verdict).toBe('split');
    expect(result.noAction).toBe(false);
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

// ---------------------------------------------------------------------------
// split idempotency (durable applied marker + crash-window successor scan)
// ---------------------------------------------------------------------------

describe('applyRecovery — split idempotency', () => {
  const makeTempDir = useTempDir('eforge-apply-recovery-split-idempotency-');

  /** Read the recovery sidecar JSON for a failed PRD. */
  async function readSidecarJson(dir: string, prdId: string): Promise<Record<string, unknown>> {
    const raw = await readFile(join(dir, '.eforge', 'queue', 'failed', `${prdId}.recovery.json`), 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  }

  /** Count `.md` files directly in the queue root (excludes subdirectories). */
  async function countQueueRootPrds(dir: string): Promise<number> {
    const entries = await readdir(join(dir, '.eforge', 'queue'));
    return entries.filter((e) => e.endsWith('.md')).length;
  }

  it('writes a durable applied marker on first split apply', async () => {
    const dir = makeTempDir();
    const prdId = 'test-split-marker';
    seedGitRepo(dir);
    await seedFailedPrd(dir, prdId, 'split', { suggestedSuccessorPrd: '# Marker Successor\n\nContinue.' });

    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: new StubHarness([validRecoveryExtractorResponse()]) });
    const { result } = await driveGenerator(engine.applyRecovery(prdId));

    expect(result.status).toBe('applied');
    expect(result.successorPrdId).toBeDefined();

    const json = await readSidecarJson(dir, prdId);
    const applied = json.applied as { action?: string; appliedAt?: string; successorPrdId?: string } | undefined;
    expect(applied).toBeDefined();
    expect(applied!.action).toBe('split');
    expect(typeof applied!.appliedAt).toBe('string');
    expect(applied!.appliedAt!.length).toBeGreaterThan(0);
    expect(applied!.successorPrdId).toBe(result.successorPrdId);
    // Unrelated sidecar fields are preserved.
    expect(json.schemaVersion).toBeDefined();
    expect(json.boundedEvidence).toBeDefined();
    expect(json.verdict).toBeDefined();
  });

  it('two split applies create exactly one successor and the second reports already-applied', async () => {
    const dir = makeTempDir();
    const prdId = 'test-split-twice';
    seedGitRepo(dir);
    await seedFailedPrd(dir, prdId, 'split', { suggestedSuccessorPrd: '# Twice Successor\n\nContinue.' });

    // Single extractor response suffices: the second apply short-circuits on the marker.
    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: new StubHarness([validRecoveryExtractorResponse()]) });
    const first = await driveGenerator(engine.applyRecovery(prdId));
    expect(first.result.status).toBe('applied');
    expect(await countQueueRootPrds(dir)).toBe(1);

    const second = await driveGenerator(engine.applyRecovery(prdId));
    expect(second.result.status).toBe('already-applied');
    expect(second.result.successorPrdId).toBe(first.result.successorPrdId);

    // Still exactly one successor file — no `-2` duplicate.
    expect(await countQueueRootPrds(dir)).toBe(1);
  });

  it('records the marker and enqueues no duplicate when a live successor exists without a marker (crash window)', async () => {
    const dir = makeTempDir();
    const prdId = 'test-split-crash-window';
    seedGitRepo(dir);
    execFileSync('git', ['branch', 'eforge/test-set'], { cwd: dir });
    await seedFailedPrd(dir, prdId, 'split', {
      suggestedSuccessorPrd: '# Crash Window Successor\n\nContinue.',
      summary: {
        landedCommits: [{ sha: 'abc123', subject: 'partial work', author: 'Test', date: new Date().toISOString() }],
      },
    });

    // Simulate a successor enqueued before the marker was written (crash window):
    // it carries recovery continuation frontmatter pointing back at the failed PRD.
    const successorId = 'preexisting-successor';
    const successorBody = [
      '---',
      'title: Preexisting Successor',
      'created: 2024-01-01',
      `recovery_from: ${prdId}`,
      'recovery_set_name: test-set',
      'recovery_feature_branch: eforge/test-set',
      'recovery_base_branch: main',
      '---',
      '',
      '# Preexisting Successor',
      '',
      'Already enqueued before the marker write.',
    ].join('\n');
    await writeFile(join(dir, '.eforge', 'queue', `${successorId}.md`), successorBody, 'utf-8');

    expect(await countQueueRootPrds(dir)).toBe(1);

    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: new StubHarness([validRecoveryExtractorResponse()]) });
    const { result } = await driveGenerator(engine.applyRecovery(prdId));

    expect(result.status).toBe('already-applied');
    expect(result.successorPrdId).toBe(successorId);

    // No new successor enqueued — still exactly the one pre-existing file.
    expect(await countQueueRootPrds(dir)).toBe(1);

    // Marker now written, pointing at the pre-existing successor.
    const json = await readSidecarJson(dir, prdId);
    const applied = json.applied as { action?: string; appliedAt?: string; successorPrdId?: string } | undefined;
    expect(applied).toBeDefined();
    expect(applied!.action).toBe('split');
    expect(applied!.appliedAt!.length).toBeGreaterThan(0);
    expect(applied!.successorPrdId).toBe(successorId);
  });

  it('matches a live successor via recovery_split_source when no continuation metadata exists (crash window, no landed work)', async () => {
    const dir = makeTempDir();
    const prdId = 'test-split-crash-window-no-evidence';
    seedGitRepo(dir);
    // No landedCommits and no mergedAt plans: deriveSplitRecoveryContinuation
    // returns undefined, so the successor carries no continuation frontmatter —
    // only the durable recovery_split_source marker drives idempotency here.
    await seedFailedPrd(dir, prdId, 'split', {
      suggestedSuccessorPrd: '# No-Evidence Successor\n\nContinue.',
    });

    // Simulate a successor enqueued before the marker was written, carrying only
    // the recovery_split_source marker (no continuation frontmatter).
    const successorId = 'preexisting-no-evidence-successor';
    const successorBody = [
      '---',
      'title: Preexisting No-Evidence Successor',
      'created: 2024-01-01',
      `recovery_split_source: ${prdId}`,
      '---',
      '',
      '# Preexisting No-Evidence Successor',
      '',
      'Already enqueued before the marker write.',
    ].join('\n');
    await writeFile(join(dir, '.eforge', 'queue', `${successorId}.md`), successorBody, 'utf-8');

    expect(await countQueueRootPrds(dir)).toBe(1);

    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: new StubHarness([validRecoveryExtractorResponse()]) });
    const { result } = await driveGenerator(engine.applyRecovery(prdId));

    expect(result.status).toBe('already-applied');
    expect(result.successorPrdId).toBe(successorId);

    // No duplicate successor enqueued.
    expect(await countQueueRootPrds(dir)).toBe(1);

    // Marker now written, pointing at the pre-existing successor.
    const json = await readSidecarJson(dir, prdId);
    const applied = json.applied as { action?: string; successorPrdId?: string } | undefined;
    expect(applied).toBeDefined();
    expect(applied!.action).toBe('split');
    expect(applied!.successorPrdId).toBe(successorId);
  });

  it('writes recovery_split_source on a first split apply even without continuation metadata', async () => {
    const dir = makeTempDir();
    const prdId = 'test-split-source-no-evidence';
    seedGitRepo(dir);
    await seedFailedPrd(dir, prdId, 'split', { suggestedSuccessorPrd: '# Source Marker Successor\n\nContinue.' });

    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: new StubHarness([validRecoveryExtractorResponse()]) });
    const { result } = await driveGenerator(engine.applyRecovery(prdId));
    expect(result.status).toBe('applied');
    expect(result.successorPrdId).toBeDefined();

    // The enqueued successor carries the durable recovery_split_source marker so a
    // crash before the applied-marker write is still idempotently recoverable.
    const successorContent = await readFile(join(dir, '.eforge', 'queue', `${result.successorPrdId}.md`), 'utf-8');
    expect(successorContent).toContain(`recovery_split_source: ${prdId}`);
  });
});
