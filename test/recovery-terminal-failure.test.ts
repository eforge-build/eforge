/**
 * Recovery regression tests for the authoritative terminal failure contract.
 *
 * Tests cover:
 *   - Authoritative precedence: build:terminal-failure in DB → authoritative:true, partial omitted
 *   - Legacy fallback without authoritative event → partial:true, authoritative:false
 *   - Artifact-recording sequence: scope=artifact-recording, validation commands, landing:skipped
 *   - Stale agent:stop supersession by completed/merged plan status
 *   - Fallback taxonomy: distinct stages/scopes per validation gate
 *   - Non-plan terminal failures: failingPlans remains empty
 */

import { describe, it, expect } from 'vitest';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { BuildFailureSummary } from '@eforge-build/engine/events';
import { useTempDir } from './test-tmpdir.js';
import { synthesizeFromEvents } from '@eforge-build/engine/recovery/event-history';
import { buildFailureSummary } from '@eforge-build/engine/recovery/failure-summary';
import { writeRecoverySidecar } from '@eforge-build/engine/recovery/sidecar';
import { openDatabase } from '@eforge-build/monitor/db';
import { EforgeEngine } from '@eforge-build/engine/eforge';
import { StubHarness } from './stub-harness.js';
import { collectEvents, filterEvents } from './test-events.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seedGitRepo(dir: string): void {
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
  const gitOpts = { cwd: dir };
  execFileSync('git', ['init', '-b', 'main'], gitOpts);
  execFileSync('git', ['config', 'user.email', 'test@example.com'], gitOpts);
  execFileSync('git', ['config', 'user.name', 'Test'], gitOpts);
  execFileSync('git', ['commit', '--allow-empty', '-m', 'initial'], gitOpts);
}

function makeBaseRun(db: ReturnType<typeof openDatabase>, runId: string, setName: string, dir: string): void {
  db.insertRun({ id: runId, sessionId: `session-${runId}`, planSet: setName, command: 'build', status: 'failed', startedAt: new Date('2026-01-01T10:00:00.000Z').toISOString(), cwd: dir, pid: 9999 });
}

function insertPhaseEnd(db: ReturnType<typeof openDatabase>, runId: string, status: 'failed' | 'completed', id_hint?: string): void {
  db.insertEvent({ runId, type: 'phase:end', data: JSON.stringify({ type: 'phase:end', runId, result: { status, summary: `Phase ${status}` } }), timestamp: new Date('2026-01-01T11:00:00.000Z').toISOString() });
}

// ---------------------------------------------------------------------------
// Recovery run selection
// ---------------------------------------------------------------------------

describe('recovery run selection', () => {
  const makeTempDir = useTempDir('eforge-recovery-run-selection-');

  it('uses the failed build run when a newer running resume run exists for the same plan set', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    mkdirSync(join(dir, '.eforge'), { recursive: true });
    const dbPath = join(dir, '.eforge', 'run-selection.db');
    const db = openDatabase(dbPath);

    db.insertRun({ id: 'run-build-failed', sessionId: 'session-build-failed', planSet: 'selection-set', command: 'build', status: 'failed', startedAt: new Date('2026-01-01T10:00:00.000Z').toISOString(), cwd: dir, pid: 9999 });
    db.insertEvent({ runId: 'run-build-failed', type: 'plan:status:change', planId: 'plan-failed', data: JSON.stringify({ status: 'failed' }), timestamp: new Date('2026-01-01T10:20:00.000Z').toISOString() });
    db.insertEvent({ runId: 'run-build-failed', type: 'plan:build:failed', planId: 'plan-failed', data: JSON.stringify({ type: 'plan:build:failed', planId: 'plan-failed', error: 'Build failed in original build run' }), timestamp: new Date('2026-01-01T10:30:00.000Z').toISOString() });
    insertPhaseEnd(db, 'run-build-failed', 'failed');

    db.insertRun({ id: 'run-resume-running', sessionId: 'session-resume-running', planSet: 'selection-set', command: 'resume', status: 'running', startedAt: new Date('2026-01-01T12:00:00.000Z').toISOString(), cwd: dir, pid: 9998 });
    db.close();

    const summary = await buildFailureSummary({ setName: 'selection-set', prdId: 'selection-prd', cwd: dir, dbPath });

    expect(summary.failingPlan.planId).toBe('plan-failed');
    expect(summary.failingPlan.errorMessage).toBe('Build failed in original build run');
    expect(summary.plans).toContainEqual(expect.objectContaining({ planId: 'plan-failed', status: 'failed' }));
  });

  it('falls back to the newest run when no failed build run exists', async () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, '.eforge'), { recursive: true });
    const dbPath = join(dir, '.eforge', 'run-selection-fallback.db');
    const db = openDatabase(dbPath);

    db.insertRun({ id: 'run-resume-fallback', sessionId: 'session-resume-fallback', planSet: 'selection-fallback-set', command: 'resume', status: 'running', startedAt: new Date('2026-01-01T12:00:00.000Z').toISOString(), cwd: dir, pid: 9998 });
    db.insertEvent({ runId: 'run-resume-fallback', type: 'plan:status:change', planId: 'plan-fallback', data: JSON.stringify({ status: 'failed' }), timestamp: new Date('2026-01-01T12:20:00.000Z').toISOString() });
    db.insertEvent({ runId: 'run-resume-fallback', type: 'plan:build:failed', planId: 'plan-fallback', data: JSON.stringify({ type: 'plan:build:failed', planId: 'plan-fallback', error: 'Fallback run failure evidence' }), timestamp: new Date('2026-01-01T12:30:00.000Z').toISOString() });
    insertPhaseEnd(db, 'run-resume-fallback', 'failed');
    db.close();

    const fragment = synthesizeFromEvents({ setName: 'selection-fallback-set', prdId: 'selection-fallback-prd', dbPath });

    expect(fragment).not.toBeNull();
    expect(fragment!.failingPlan?.planId).toBe('plan-fallback');
    expect(fragment!.failingPlan?.errorMessage).toBe('Fallback run failure evidence');
  });
});

// ---------------------------------------------------------------------------
// Authoritative precedence
// ---------------------------------------------------------------------------

describe('authoritative terminal failure precedence', () => {
  const makeTempDir = useTempDir('eforge-tf-test-');

  it('uses build:terminal-failure event as authoritative source when present', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    mkdirSync(join(dir, '.eforge'), { recursive: true });
    const dbPath = join(dir, '.eforge', 'tf-auth.db');
    const db = openDatabase(dbPath);

    makeBaseRun(db, 'run-auth-01', 'auth-set', dir);
    // Insert a misleading stale agent:stop with error
    db.insertEvent({ runId: 'run-auth-01', type: 'agent:stop', data: JSON.stringify({ type: 'agent:stop', agent: 'builder', planId: 'plan-old', error: 'stale error from old run' }), timestamp: new Date('2026-01-01T10:10:00.000Z').toISOString() });
    // Insert plan:status:change to mark plan-old as completed (superseded)
    db.insertEvent({ runId: 'run-auth-01', type: 'plan:status:change', planId: 'plan-old', data: JSON.stringify({ status: 'completed' }), timestamp: new Date('2026-01-01T10:20:00.000Z').toISOString() });
    // Insert the authoritative terminal failure event
    db.insertEvent({ runId: 'run-auth-01', type: 'build:terminal-failure', data: JSON.stringify({ type: 'build:terminal-failure', runId: 'run-auth-01', failure: { scope: 'artifact-recording', message: 'Stack artifact recording failed', authoritative: true } }), timestamp: new Date('2026-01-01T10:50:00.000Z').toISOString() });
    insertPhaseEnd(db, 'run-auth-01', 'failed');
    db.close();

    const fragment = synthesizeFromEvents({ setName: 'auth-set', prdId: 'auth-prd', dbPath });
    expect(fragment).not.toBeNull();
    expect(fragment!.terminalFailure).toBeDefined();
    expect(fragment!.terminalFailure!.scope).toBe('artifact-recording');
    expect(fragment!.terminalFailure!.authoritative).toBe(true);
    // partial should NOT be set in authoritative path
    expect(fragment!.partial).toBeUndefined();
    // The stale agent:stop for plan-old should not affect failingPlan
    expect(fragment!.failingPlan?.planId).toBe('artifact-recording');
  });

  it('fallback without authoritative event sets partial:true and authoritative:false', async () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, '.eforge'), { recursive: true });
    const dbPath = join(dir, '.eforge', 'tf-fallback.db');
    const db = openDatabase(dbPath);

    makeBaseRun(db, 'run-fb-01', 'fallback-set', dir);
    db.insertEvent({ runId: 'run-fb-01', type: 'plan:build:failed', planId: 'plan-02', data: JSON.stringify({ type: 'plan:build:failed', planId: 'plan-02', error: 'Build failed: type error' }), timestamp: new Date('2026-01-01T10:30:00.000Z').toISOString() });
    insertPhaseEnd(db, 'run-fb-01', 'failed');
    db.close();

    const fragment = synthesizeFromEvents({ setName: 'fallback-set', prdId: 'fallback-prd', dbPath });
    expect(fragment).not.toBeNull();
    expect(fragment!.partial).toBe(true);
    expect(fragment!.terminalFailure).toBeDefined();
    expect(fragment!.terminalFailure!.authoritative).toBe(false);
    expect(fragment!.terminalFailure!.scope).toBe('plan');
  });
});

// ---------------------------------------------------------------------------
// Legacy fallback artifact-recording detection
// ---------------------------------------------------------------------------

describe('legacy fallback artifact-recording detection', () => {
  const makeTempDir = useTempDir('eforge-tf-legacy-art-');

  it('legacy fallback without authoritative event: stale agent:stop plus artifact-recording evidence sets authoritative:false and correct scope', async () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, '.eforge'), { recursive: true });
    const dbPath = join(dir, '.eforge', 'tf-legacy-art.db');
    const db = openDatabase(dbPath);

    makeBaseRun(db, 'run-legacy-art-01', 'legacy-art-set', dir);
    // Stale errored agent:stop for plan-old (later completed — should be ignored)
    db.insertEvent({ runId: 'run-legacy-art-01', type: 'agent:stop', planId: 'plan-old', data: JSON.stringify({ type: 'agent:stop', agent: 'builder', planId: 'plan-old', error: 'Stale error from old attempt' }), timestamp: new Date('2026-01-01T10:10:00.000Z').toISOString() });
    db.insertEvent({ runId: 'run-legacy-art-01', type: 'plan:status:change', planId: 'plan-old', data: JSON.stringify({ status: 'completed' }), timestamp: new Date('2026-01-01T10:20:00.000Z').toISOString() });
    // Validation passed
    db.insertEvent({ runId: 'run-legacy-art-01', type: 'validation:complete', data: JSON.stringify({ type: 'validation:complete', passed: true }), timestamp: new Date('2026-01-01T10:25:00.000Z').toISOString() });
    // PRD validation passed
    db.insertEvent({ runId: 'run-legacy-art-01', type: 'prd_validation:complete', data: JSON.stringify({ type: 'prd_validation:complete', passed: true, gaps: [] }), timestamp: new Date('2026-01-01T10:27:00.000Z').toISOString() });
    // Acceptance validation passed
    db.insertEvent({ runId: 'run-legacy-art-01', type: 'acceptance_validation:complete', data: JSON.stringify({ type: 'acceptance_validation:complete', passed: true, verdicts: [{ criterion: 'C1', verdict: 'pass', evidence: 'OK' }], source: 'prd' }), timestamp: new Date('2026-01-01T10:28:00.000Z').toISOString() });
    // Landing skipped due to artifact recording failure
    db.insertEvent({ runId: 'run-legacy-art-01', type: 'landing:skipped', data: JSON.stringify({ type: 'landing:skipped', action: 'pr', featureBranch: 'eforge/legacy-art-set', baseBranch: 'main', reason: 'artifact recording failed' }), timestamp: new Date('2026-01-01T10:30:00.000Z').toISOString() });
    // Daemon artifact-recording error (NO authoritative build:terminal-failure event)
    db.insertEvent({ runId: 'run-legacy-art-01', type: 'daemon:error', data: JSON.stringify({ type: 'daemon:error', source: 'stack:artifact-recording', message: 'Failed to record stack artifact: ENOENT' }), timestamp: new Date('2026-01-01T10:35:00.000Z').toISOString() });
    insertPhaseEnd(db, 'run-legacy-art-01', 'failed');
    db.close();

    const fragment = synthesizeFromEvents({ setName: 'legacy-art-set', prdId: 'legacy-art-prd', dbPath });
    expect(fragment).not.toBeNull();
    // Should detect artifact-recording from daemon:error without authoritative event
    expect(fragment!.terminalFailure).toBeDefined();
    expect(fragment!.terminalFailure!.authoritative).toBe(false);
    expect(fragment!.terminalFailure!.scope).toBe('artifact-recording');
    expect(fragment!.terminalFailure!.message).toContain('artifact');
    // partial must be true (legacy fallback)
    expect(fragment!.partial).toBe(true);
    // Landing should be captured
    expect(fragment!.landing).toBeDefined();
    expect(fragment!.landing!.status).toBe('skipped');
    // failingPlans should be empty (non-plan terminal failure)
    expect(fragment!.failingPlans).toBeUndefined();
    // Stale plan-old agent:stop should NOT be in failingPlan
    expect(fragment!.failingPlan?.planId).not.toBe('plan-old');
  });
});

// ---------------------------------------------------------------------------
// Artifact-recording sequence fixture
// ---------------------------------------------------------------------------

describe('artifact-recording terminal failure sequence', () => {
  const makeTempDir = useTempDir('eforge-tf-art-');

  it('produces scope=artifact-recording, validation commands, landing:skipped, empty failingPlans', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    mkdirSync(join(dir, '.eforge'), { recursive: true });
    const dbPath = join(dir, '.eforge', 'tf-art.db');
    const db = openDatabase(dbPath);

    makeBaseRun(db, 'run-art-01', 'art-set', dir);
    // Validation run completed
    db.insertEvent({ runId: 'run-art-01', type: 'validation:start', data: JSON.stringify({ type: 'validation:start', commands: ['pnpm test'] }), timestamp: new Date('2026-01-01T10:10:00.000Z').toISOString() });
    db.insertEvent({ runId: 'run-art-01', type: 'validation:command:complete', data: JSON.stringify({ type: 'validation:command:complete', command: 'pnpm test', exitCode: 0 }), timestamp: new Date('2026-01-01T10:15:00.000Z').toISOString() });
    db.insertEvent({ runId: 'run-art-01', type: 'validation:complete', data: JSON.stringify({ type: 'validation:complete', passed: true }), timestamp: new Date('2026-01-01T10:20:00.000Z').toISOString() });
    // Landing skipped
    db.insertEvent({ runId: 'run-art-01', type: 'landing:skipped', data: JSON.stringify({ type: 'landing:skipped', action: 'pr', reason: 'validation passed but artifact recording failed' }), timestamp: new Date('2026-01-01T10:30:00.000Z').toISOString() });
    // Daemon artifact-recording error
    db.insertEvent({ runId: 'run-art-01', type: 'daemon:error', data: JSON.stringify({ type: 'daemon:error', source: 'stack:artifact-recording', message: 'Failed to record stack artifact: ENOENT' }), timestamp: new Date('2026-01-01T10:35:00.000Z').toISOString() });
    // Authoritative terminal failure
    db.insertEvent({ runId: 'run-art-01', type: 'build:terminal-failure', data: JSON.stringify({ type: 'build:terminal-failure', runId: 'run-art-01', failure: { scope: 'artifact-recording', message: 'Failed to record stack artifact: ENOENT', authoritative: true } }), timestamp: new Date('2026-01-01T10:36:00.000Z').toISOString() });
    insertPhaseEnd(db, 'run-art-01', 'failed');
    db.close();

    const summary = await buildFailureSummary({ setName: 'art-set', prdId: 'art-prd', cwd: dir, dbPath });

    // Scope and stage must be artifact-recording
    expect(summary.terminalFailure).toBeDefined();
    expect(summary.terminalFailure!.scope).toBe('artifact-recording');
    expect(summary.terminalFailure!.authoritative).toBe(true);
    expect(summary.terminalFailure!.message).toContain('artifact');

    // Validation commands must be included
    expect(summary.validationCommands).toBeDefined();
    expect(summary.validationCommands!.length).toBeGreaterThan(0);
    expect(summary.validationCommands![0].command).toBe('pnpm test');
    expect(summary.validationCommands![0].exitCode).toBe(0);

    // Landing info must be present
    expect(summary.landing).toBeDefined();
    expect(summary.landing!.status).toBe('skipped');

    // failingPlans must be empty (non-plan terminal failure)
    expect(summary.failingPlans).toBeUndefined();
    // failingPlan uses synthetic compat ID
    expect(summary.failingPlan.planId).toBe('artifact-recording');

    // Sidecar markdown must contain expected sections
    const { mdPath } = await writeRecoverySidecar({
      failedPrdDir: dir,
      prdId: 'art-prd',
      summary,
      verdict: { verdict: 'manual', confidence: 'low', rationale: 'artifact-recording failure', completedWork: [], remainingWork: [], risks: [] },
    });
    const { readFile } = require('node:fs/promises') as typeof import('node:fs/promises');
    const md = await readFile(mdPath, 'utf-8');
    expect(md).toContain('Terminal Failure');
    expect(md).toContain('artifact-recording');
    expect(md).toContain('Landing Status');
    // Partial warning should NOT appear since authoritative
    expect(md).not.toContain('Partial analysis');
  });
});

// ---------------------------------------------------------------------------
// Stale agent:stop supersession
// ---------------------------------------------------------------------------

describe('stale agent:stop supersession', () => {
  const makeTempDir = useTempDir('eforge-tf-stale-');

  it('ignores errored agent:stop for plan later marked completed', async () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, '.eforge'), { recursive: true });
    const dbPath = join(dir, '.eforge', 'tf-stale.db');
    const db = openDatabase(dbPath);

    makeBaseRun(db, 'run-stale-01', 'stale-set', dir);
    // Old errored stop for plan-01 which later completed
    db.insertEvent({ runId: 'run-stale-01', type: 'agent:stop', planId: 'plan-01', data: JSON.stringify({ type: 'agent:stop', agent: 'builder', planId: 'plan-01', error: 'Stale error from old attempt' }), timestamp: new Date('2026-01-01T10:10:00.000Z').toISOString() });
    // plan-01 later completed
    db.insertEvent({ runId: 'run-stale-01', type: 'plan:status:change', planId: 'plan-01', data: JSON.stringify({ status: 'completed' }), timestamp: new Date('2026-01-01T10:20:00.000Z').toISOString() });
    // No plan:build:failed events, no authoritative terminal event
    insertPhaseEnd(db, 'run-stale-01', 'failed');
    db.close();

    const fragment = synthesizeFromEvents({ setName: 'stale-set', prdId: 'stale-prd', dbPath });
    expect(fragment).not.toBeNull();
    // The stale stop for plan-01 should be ignored
    // Either failingPlan is 'unknown' (all stops superseded) or plan-01 is NOT the failing plan
    if (fragment!.failingPlan) {
      expect(fragment!.failingPlan.planId).not.toBe('plan-01');
    }
  });

  it('ignores errored agent:stop for plan later marked merged', async () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, '.eforge'), { recursive: true });
    const dbPath = join(dir, '.eforge', 'tf-stale-merged.db');
    const db = openDatabase(dbPath);

    makeBaseRun(db, 'run-stale-02', 'stale-merged-set', dir);
    // Old errored stop for plan-01 which later was merged
    db.insertEvent({ runId: 'run-stale-02', type: 'agent:stop', planId: 'plan-01', data: JSON.stringify({ type: 'agent:stop', agent: 'builder', planId: 'plan-01', error: 'Stale error from old attempt' }), timestamp: new Date('2026-01-01T10:10:00.000Z').toISOString() });
    // plan-01 later merged
    db.insertEvent({ runId: 'run-stale-02', type: 'plan:status:change', planId: 'plan-01', data: JSON.stringify({ status: 'merged' }), timestamp: new Date('2026-01-01T10:20:00.000Z').toISOString() });
    // No plan:build:failed events, no authoritative terminal event
    insertPhaseEnd(db, 'run-stale-02', 'failed');
    db.close();

    const fragment = synthesizeFromEvents({ setName: 'stale-merged-set', prdId: 'stale-merged-prd', dbPath });
    expect(fragment).not.toBeNull();
    // The stale stop for plan-01 should be ignored (plan later merged)
    // failingPlan should NOT be plan-01
    if (fragment!.failingPlan) {
      expect(fragment!.failingPlan.planId).not.toBe('plan-01');
    }
    // failingPlans should not contain plan-01
    if (fragment!.failingPlans) {
      expect(fragment!.failingPlans.map((p) => p.planId)).not.toContain('plan-01');
    }
  });
});

// ---------------------------------------------------------------------------
// Fallback taxonomy
// ---------------------------------------------------------------------------

describe('fallback scope taxonomy', () => {
  const makeTempDir = useTempDir('eforge-tf-tax-');

  it('returns scope=post-merge-validation for failed validation:complete without authoritative event (legacy fallback)', async () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, '.eforge'), { recursive: true });
    const dbPath = join(dir, '.eforge', 'tf-postmerge.db');
    const db = openDatabase(dbPath);

    makeBaseRun(db, 'run-pm-01', 'pm-set', dir);
    // Post-merge validation:complete with passed=false — NO authoritative build:terminal-failure event
    db.insertEvent({ runId: 'run-pm-01', type: 'validation:complete', data: JSON.stringify({ type: 'validation:complete', passed: false }), timestamp: new Date('2026-01-01T10:10:00.000Z').toISOString() });
    insertPhaseEnd(db, 'run-pm-01', 'failed');
    db.close();

    const fragment = synthesizeFromEvents({ setName: 'pm-set', prdId: 'pm-prd', dbPath });
    expect(fragment).not.toBeNull();
    expect(fragment!.terminalFailure!.scope).toBe('post-merge-validation');
    expect(fragment!.terminalFailure!.stage).toBe('post-merge-validation');
    expect(fragment!.terminalFailure!.authoritative).toBe(false);
    expect(fragment!.partial).toBe(true);
  });

  it('returns scope=prd-validation for failed prd_validation:complete (no authoritative event)', async () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, '.eforge'), { recursive: true });
    const dbPath = join(dir, '.eforge', 'tf-prdval.db');
    const db = openDatabase(dbPath);

    makeBaseRun(db, 'run-pv-01', 'pv-set', dir);
    db.insertEvent({ runId: 'run-pv-01', type: 'prd_validation:complete', data: JSON.stringify({ type: 'prd_validation:complete', passed: false, gaps: [{ description: 'Missing endpoint' }] }), timestamp: new Date('2026-01-01T10:10:00.000Z').toISOString() });
    insertPhaseEnd(db, 'run-pv-01', 'failed');
    db.close();

    const fragment = synthesizeFromEvents({ setName: 'pv-set', prdId: 'pv-prd', dbPath });
    expect(fragment!.terminalFailure!.stage).toBe('prd-validation');
    expect(fragment!.terminalFailure!.scope).toBe('prd-validation');
    expect(fragment!.terminalFailure!.authoritative).toBe(false);
    expect(fragment!.partial).toBe(true);
  });

  it('returns scope=acceptance-validation for failed acceptance_validation:complete after clean prd validation', async () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, '.eforge'), { recursive: true });
    const dbPath = join(dir, '.eforge', 'tf-accval.db');
    const db = openDatabase(dbPath);

    makeBaseRun(db, 'run-av-01', 'av-set', dir);
    db.insertEvent({ runId: 'run-av-01', type: 'prd_validation:complete', data: JSON.stringify({ type: 'prd_validation:complete', passed: true, gaps: [] }), timestamp: new Date('2026-01-01T10:05:00.000Z').toISOString() });
    db.insertEvent({ runId: 'run-av-01', type: 'acceptance_validation:complete', data: JSON.stringify({ type: 'acceptance_validation:complete', passed: false, verdicts: [{ criterion: 'C1', verdict: 'fail', evidence: 'Missing' }] }), timestamp: new Date('2026-01-01T10:10:00.000Z').toISOString() });
    insertPhaseEnd(db, 'run-av-01', 'failed');
    db.close();

    const fragment = synthesizeFromEvents({ setName: 'av-set', prdId: 'av-prd', dbPath });
    expect(fragment!.terminalFailure!.stage).toBe('acceptance-validation');
    expect(fragment!.terminalFailure!.scope).toBe('acceptance-validation');
    expect(fragment!.terminalFailure!.authoritative).toBe(false);
    expect(fragment!.partial).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// writeRecoverySidecar — partial analysis warning
// ---------------------------------------------------------------------------

describe('writeRecoverySidecar partial analysis warning', () => {
  const makeTempDir = useTempDir('eforge-tf-sidecar-partial-');

  it('Markdown includes Partial analysis warning when summary.partial is true even with a normal verdict', async () => {
    const dir = makeTempDir();
    const partialSummary: BuildFailureSummary = {
      prdId: 'test-prd', setName: 'test-set', featureBranch: 'eforge/test-set', baseBranch: 'main',
      plans: [{ planId: 'plan-01', status: 'failed', error: 'Build failed' }],
      failingPlan: { planId: 'plan-01', errorMessage: 'Build failed' },
      landedCommits: [], diffStat: '', modelsUsed: [], failedAt: '2024-01-01T00:00:00.000Z',
      partial: true,
    };
    const { mdPath } = await writeRecoverySidecar({
      failedPrdDir: dir, prdId: 'test-prd', summary: partialSummary,
      verdict: { verdict: 'manual', confidence: 'low', rationale: 'partial', completedWork: [], remainingWork: [], risks: [] },
    });
    const md = await readFile(mdPath, 'utf-8');
    expect(md).toContain('Partial analysis');
  });
});

// ---------------------------------------------------------------------------
// EforgeEngine.build — terminal failure event emission
// ---------------------------------------------------------------------------

describe('EforgeEngine.build terminal failure emission', () => {
  const makeTempDir = useTempDir('eforge-build-tf-test-');

  it('emits exactly one build:terminal-failure before phase:end when build fails', async () => {
    const dir = makeTempDir();
    const g = { cwd: dir };
    execFileSync('git', ['init', '-b', 'main'], g);
    execFileSync('git', ['config', 'user.email', 'test@example.com'], g);
    execFileSync('git', ['config', 'user.name', 'Test'], g);
    execFileSync('git', ['commit', '--allow-empty', '-m', 'chore: initial commit'], g);

    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: new StubHarness([]) });
    // A missing plan set causes an early failure (no orchestration.yaml)
    const events = await collectEvents(engine.build('missing-plan-set'));
    const tfEvents = filterEvents(events, 'build:terminal-failure');
    const phaseEndEvents = filterEvents(events, 'phase:end');
    // Exactly one terminal failure must be emitted before the failed phase:end
    expect(tfEvents).toHaveLength(1);
    expect(events.indexOf(tfEvents[0]!)).toBeLessThan(events.indexOf(phaseEndEvents[phaseEndEvents.length - 1]!));
    const tf = tfEvents[0] as { type: string; failure: { authoritative: boolean; scope: string } };
    expect(tf.failure.authoritative).toBe(true);
    expect(typeof tf.failure.scope).toBe('string');
    const lastPhaseEnd = phaseEndEvents[phaseEndEvents.length - 1] as { type: string; result: { status: string } };
    expect(lastPhaseEnd.result.status).toBe('failed');
  });
});
