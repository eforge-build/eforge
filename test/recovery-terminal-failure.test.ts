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
import { createBuildTerminalFailureTracker } from '@eforge-build/engine/terminal-failure';

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

  it('copies plan build failure terminalSubtype into the authoritative terminal failure event', () => {
    const tracker = createBuildTerminalFailureTracker('run-tracker-subtype');
    tracker.observe({
      type: 'plan:build:failed',
      planId: 'plan-transport',
      error: 'Backend error: Codex SSE response headers timed out after 10000ms',
      terminalSubtype: 'error_transient_transport',
      timestamp: '2026-01-01T10:00:00.000Z',
    });

    const event = tracker.toEvent('failed', 'Build failed');

    expect(event).toEqual(expect.objectContaining({
      type: 'build:terminal-failure',
      failure: expect.objectContaining({
        scope: 'plan',
        planId: 'plan-transport',
        terminalSubtype: 'error_transient_transport',
      }),
    }));
  });

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

  it('preserves terminal subtype from authoritative plan-scoped terminal failures', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    mkdirSync(join(dir, '.eforge'), { recursive: true });
    const dbPath = join(dir, '.eforge', 'tf-auth-subtype.db');
    const db = openDatabase(dbPath);

    makeBaseRun(db, 'run-auth-subtype-01', 'auth-subtype-set', dir);
    db.insertEvent({ runId: 'run-auth-subtype-01', type: 'plan:status:change', planId: 'plan-codex', data: JSON.stringify({ type: 'plan:status:change', planId: 'plan-codex', status: 'failed' }), timestamp: new Date('2026-01-01T10:20:00.000Z').toISOString() });
    db.insertEvent({ runId: 'run-auth-subtype-01', type: 'build:terminal-failure', planId: 'plan-codex', data: JSON.stringify({ type: 'build:terminal-failure', runId: 'run-auth-subtype-01', failure: { scope: 'plan', planId: 'plan-codex', message: 'Backend error: Codex SSE response headers timed out after 10000ms', authoritative: true, sourceEventType: 'plan:build:failed', terminalSubtype: 'error_transient_transport' } }), timestamp: new Date('2026-01-01T10:25:00.000Z').toISOString() });
    insertPhaseEnd(db, 'run-auth-subtype-01', 'failed');
    db.close();

    const summary = await buildFailureSummary({ setName: 'auth-subtype-set', prdId: 'auth-subtype-prd', cwd: dir, dbPath });

    expect(summary.terminalFailure).toEqual(expect.objectContaining({ terminalSubtype: 'error_transient_transport' }));
    expect(summary.failingPlan).toEqual(expect.objectContaining({ planId: 'plan-codex', terminalSubtype: 'error_transient_transport' }));
    expect(summary.failingPlans?.[0]).toEqual(expect.objectContaining({ planId: 'plan-codex', terminalSubtype: 'error_transient_transport' }));
    expect(summary.plans.find((plan) => plan.planId === 'plan-codex')).toEqual(expect.objectContaining({ terminalSubtype: 'error_transient_transport' }));
  });

  it('recovers terminal subtype from referenced legacy plan:build:failed row when authoritative event omits it', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    mkdirSync(join(dir, '.eforge'), { recursive: true });
    const dbPath = join(dir, '.eforge', 'tf-auth-subtype-fallback.db');
    const db = openDatabase(dbPath);
    const sourceTimestamp = new Date('2026-01-01T10:21:00.000Z').toISOString();

    makeBaseRun(db, 'run-auth-subtype-fallback-01', 'auth-subtype-fallback-set', dir);
    db.insertEvent({ runId: 'run-auth-subtype-fallback-01', type: 'plan:status:change', planId: 'plan-codex', data: JSON.stringify({ type: 'plan:status:change', planId: 'plan-codex', status: 'failed' }), timestamp: new Date('2026-01-01T10:20:00.000Z').toISOString() });
    db.insertEvent({ runId: 'run-auth-subtype-fallback-01', type: 'plan:build:failed', planId: 'plan-codex', data: JSON.stringify({ type: 'plan:build:failed', planId: 'plan-codex', error: 'Backend error: Codex SSE response headers timed out after 10000ms', terminalSubtype: 'error_transient_transport' }), timestamp: sourceTimestamp });
    db.insertEvent({ runId: 'run-auth-subtype-fallback-01', type: 'build:terminal-failure', planId: 'plan-codex', data: JSON.stringify({ type: 'build:terminal-failure', runId: 'run-auth-subtype-fallback-01', failure: { scope: 'plan', planId: 'plan-codex', message: 'Backend error: Codex SSE response headers timed out after 10000ms', authoritative: true, sourceEventType: 'plan:build:failed', sourceEventTimestamp: sourceTimestamp } }), timestamp: new Date('2026-01-01T10:25:00.000Z').toISOString() });
    insertPhaseEnd(db, 'run-auth-subtype-fallback-01', 'failed');
    db.close();

    const summary = await buildFailureSummary({ setName: 'auth-subtype-fallback-set', prdId: 'auth-subtype-fallback-prd', cwd: dir, dbPath });

    expect(summary.terminalFailure).toEqual(expect.objectContaining({ terminalSubtype: 'error_transient_transport' }));
    expect(summary.failingPlan.terminalSubtype).toBe('error_transient_transport');
    expect(summary.failingPlans?.[0]?.terminalSubtype).toBe('error_transient_transport');
    expect(summary.plans.find((plan) => plan.planId === 'plan-codex')?.terminalSubtype).toBe('error_transient_transport');
  });

  it('keeps blocked descendants in authoritative recovery plans without treating them as failingPlans', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    mkdirSync(join(dir, '.eforge'), { recursive: true });
    const dbPath = join(dir, '.eforge', 'tf-blocked-descendants.db');
    const db = openDatabase(dbPath);
    const blockedError = 'Blocked by failed dependency: plan-a';

    makeBaseRun(db, 'run-blocked-01', 'blocked-set', dir);
    db.insertEvent({
      runId: 'run-blocked-01',
      type: 'plan:status:change',
      planId: 'plan-a',
      data: JSON.stringify({ type: 'plan:status:change', planId: 'plan-a', status: 'failed' }),
      timestamp: new Date('2026-01-01T10:20:00.000Z').toISOString(),
    });
    db.insertEvent({
      runId: 'run-blocked-01',
      type: 'plan:build:failed',
      planId: 'plan-a',
      data: JSON.stringify({ type: 'plan:build:failed', planId: 'plan-a', error: 'Upstream builder failed' }),
      timestamp: new Date('2026-01-01T10:21:00.000Z').toISOString(),
    });
    for (const [planId, offset] of [['plan-b', 22 * 60_000], ['plan-c', 23 * 60_000]] as const) {
      db.insertEvent({
        runId: 'run-blocked-01',
        type: 'plan:status:change',
        planId,
        data: JSON.stringify({ type: 'plan:status:change', planId, status: 'blocked' }),
        timestamp: new Date(new Date('2026-01-01T10:00:00.000Z').getTime() + offset).toISOString(),
      });
      db.insertEvent({
        runId: 'run-blocked-01',
        type: 'plan:error:set',
        planId,
        data: JSON.stringify({ type: 'plan:error:set', planId, error: blockedError }),
        timestamp: new Date(new Date('2026-01-01T10:00:00.000Z').getTime() + offset + 500).toISOString(),
      });
    }
    db.insertEvent({
      runId: 'run-blocked-01',
      type: 'build:terminal-failure',
      planId: 'plan-a',
      data: JSON.stringify({
        type: 'build:terminal-failure',
        runId: 'run-blocked-01',
        failure: { scope: 'plan', planId: 'plan-a', message: 'Upstream builder failed', authoritative: true, sourceEventType: 'plan:build:failed' },
      }),
      timestamp: new Date('2026-01-01T10:25:00.000Z').toISOString(),
    });
    db.insertEvent({
      runId: 'run-blocked-01',
      type: 'phase:end',
      data: JSON.stringify({ type: 'phase:end', runId: 'run-blocked-01', result: { status: 'failed', summary: 'Build failed for plan-a' } }),
      timestamp: new Date('2026-01-01T10:26:00.000Z').toISOString(),
    });
    db.close();

    const summary = await buildFailureSummary({ setName: 'blocked-set', prdId: 'blocked-prd', cwd: dir, dbPath });

    expect(summary.failingPlan.planId).toBe('plan-a');
    expect(summary.failingPlans?.map((p) => p.planId)).toEqual(['plan-a']);
    expect(summary.terminalFailure).toEqual(expect.objectContaining({ scope: 'plan', planId: 'plan-a', authoritative: true }));
    for (const planId of ['plan-b', 'plan-c']) {
      expect(summary.plans).toContainEqual(expect.objectContaining({ planId, status: 'blocked', error: blockedError }));
    }
  });

  it('removes stale lifecycle errors after plan:error:clear before authoritative summary construction', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    mkdirSync(join(dir, '.eforge'), { recursive: true });
    const dbPath = join(dir, '.eforge', 'tf-cleared-lifecycle-error.db');
    const db = openDatabase(dbPath);

    makeBaseRun(db, 'run-clear-01', 'clear-set', dir);
    db.insertEvent({
      runId: 'run-clear-01',
      type: 'plan:status:change',
      planId: 'plan-a',
      data: JSON.stringify({ type: 'plan:status:change', planId: 'plan-a', status: 'failed' }),
      timestamp: new Date('2026-01-01T10:20:00.000Z').toISOString(),
    });
    db.insertEvent({
      runId: 'run-clear-01',
      type: 'plan:status:change',
      planId: 'plan-b',
      data: JSON.stringify({ type: 'plan:status:change', planId: 'plan-b', status: 'blocked' }),
      timestamp: new Date('2026-01-01T10:21:00.000Z').toISOString(),
    });
    db.insertEvent({
      runId: 'run-clear-01',
      type: 'plan:error:set',
      planId: 'plan-b',
      data: JSON.stringify({ type: 'plan:error:set', planId: 'plan-b', error: 'stale blocked error' }),
      timestamp: new Date('2026-01-01T10:22:00.000Z').toISOString(),
    });
    db.insertEvent({
      runId: 'run-clear-01',
      type: 'plan:error:clear',
      planId: 'plan-b',
      data: JSON.stringify({ type: 'plan:error:clear', planId: 'plan-b' }),
      timestamp: new Date('2026-01-01T10:23:00.000Z').toISOString(),
    });
    db.insertEvent({
      runId: 'run-clear-01',
      type: 'build:terminal-failure',
      planId: 'plan-a',
      data: JSON.stringify({
        type: 'build:terminal-failure',
        runId: 'run-clear-01',
        failure: { scope: 'plan', planId: 'plan-a', message: 'Upstream builder failed', authoritative: true, sourceEventType: 'plan:build:failed' },
      }),
      timestamp: new Date('2026-01-01T10:24:00.000Z').toISOString(),
    });
    db.insertEvent({
      runId: 'run-clear-01',
      type: 'phase:end',
      data: JSON.stringify({ type: 'phase:end', runId: 'run-clear-01', result: { status: 'failed', summary: 'Build failed for plan-a' } }),
      timestamp: new Date('2026-01-01T10:25:00.000Z').toISOString(),
    });
    db.close();

    const summary = await buildFailureSummary({ setName: 'clear-set', prdId: 'clear-prd', cwd: dir, dbPath });

    expect(summary.failingPlans?.map((p) => p.planId)).toEqual(['plan-a']);
    expect(summary.plans).toContainEqual(expect.objectContaining({ planId: 'plan-b', status: 'blocked' }));
    expect(summary.plans.find((p) => p.planId === 'plan-b')).not.toHaveProperty('error');
  });

  it('enriches authoritative acceptance-validation failures from the latest source event at or before the terminal event', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    mkdirSync(join(dir, '.eforge'), { recursive: true });
    const dbPath = join(dir, '.eforge', 'tf-auth-acceptance.db');
    const db = openDatabase(dbPath);

    makeBaseRun(db, 'run-auth-acceptance-01', 'auth-acceptance-set', dir);
    db.insertEvent({ runId: 'run-auth-acceptance-01', type: 'prd_validation:complete', data: JSON.stringify({ type: 'prd_validation:complete', passed: true, gaps: [] }), timestamp: new Date('2026-01-01T10:05:00.000Z').toISOString() });
    db.insertEvent({ runId: 'run-auth-acceptance-01', type: 'acceptance_validation:complete', data: JSON.stringify({ type: 'acceptance_validation:complete', passed: false, verdicts: [{ criterion: 'Stale criterion', verdict: 'fail', evidence: 'Stale evidence' }] }), timestamp: new Date('2026-01-01T10:10:00.000Z').toISOString() });
    db.insertEvent({ runId: 'run-auth-acceptance-01', type: 'acceptance_validation:complete', data: JSON.stringify({
      type: 'acceptance_validation:complete',
      passed: false,
      verdicts: [
        { criterion: 'Target failed criterion', verdict: 'fail', evidence: 'Target failed evidence' },
        { criterion: 'Target unknown criterion', verdict: 'unknown', evidence: 'Target unknown evidence' },
        { criterion: 'Target passed criterion', verdict: 'pass', evidence: 'Target passed evidence' },
      ],
      waivers: ['waived criterion because of external dependency'],
      acceptanceConflicts: [{ criterion: 'Target unknown criterion', evidence: 'Conflicting acceptance text', conflictsWith: 'Original PRD scope', scope: 'unknown', recommendedAction: 'manual_review' }],
    }), timestamp: new Date('2026-01-01T10:20:00.000Z').toISOString() });
    db.insertEvent({ runId: 'run-auth-acceptance-01', type: 'build:terminal-failure', data: JSON.stringify({
      type: 'build:terminal-failure',
      runId: 'run-auth-acceptance-01',
      failure: {
        scope: 'acceptance-validation',
        message: 'Acceptance criteria validation failed',
        authoritative: true,
        sourceEventType: 'acceptance_validation:complete',
        sourceEventId: 3,
        sourceEventTimestamp: new Date('2026-01-01T10:20:00.000Z').toISOString(),
        acceptanceValidationPassed: false,
      },
    }), timestamp: new Date('2026-01-01T10:25:00.000Z').toISOString() });
    db.insertEvent({ runId: 'run-auth-acceptance-01', type: 'acceptance_validation:complete', data: JSON.stringify({ type: 'acceptance_validation:complete', passed: false, verdicts: [{ criterion: 'Later criterion must not be selected', verdict: 'fail', evidence: 'Later evidence' }] }), timestamp: new Date('2026-01-01T10:26:00.000Z').toISOString() });
    insertPhaseEnd(db, 'run-auth-acceptance-01', 'failed');
    db.close();

    const summary = await buildFailureSummary({ setName: 'auth-acceptance-set', prdId: 'auth-acceptance-prd', cwd: dir, dbPath });

    expect(summary.terminalFailure).toEqual(expect.objectContaining({ scope: 'acceptance-validation', authoritative: true, sourceEventType: 'acceptance_validation:complete', sourceEventId: 3 }));
    expect(summary.acceptanceValidation).toBeDefined();
    expect(summary.acceptanceValidation).toMatchObject({ passed: false, total: 3, pass: 1, fail: 1, unknown: 1 });
    expect(summary.acceptanceValidation!.verdicts).toContainEqual({ criterion: 'Target failed criterion', verdict: 'fail', evidence: 'Target failed evidence' });
    expect(summary.acceptanceValidation!.verdicts).toContainEqual({ criterion: 'Target unknown criterion', verdict: 'unknown', evidence: 'Target unknown evidence' });
    expect(summary.acceptanceValidation!.verdicts.map((v) => v.criterion)).not.toContain('Later criterion must not be selected');
    expect(summary.acceptanceValidation!.waivers).toEqual(['waived criterion because of external dependency']);
    expect(summary.acceptanceValidation!.conflicts).toHaveLength(1);
  });

  it('preserves authoritative acceptance-validation details when PRD validation also failed', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    mkdirSync(join(dir, '.eforge'), { recursive: true });
    const dbPath = join(dir, '.eforge', 'tf-auth-acceptance-prd-failed.db');
    const db = openDatabase(dbPath);
    const failedVerdict = { criterion: 'AC-010 reports the acceptance regression', verdict: 'fail', evidence: 'Validation command showed the regression remained' };
    const acceptanceConflict = {
      criterion: 'AC-010 reports the acceptance regression',
      evidence: 'Acceptance text conflicts with the PRD recovery behavior',
      conflictsWith: 'PRD requires preserving authoritative recovery evidence',
      scope: 'unknown',
      recommendedAction: 'manual_review',
    };

    makeBaseRun(db, 'run-auth-acceptance-prd-failed-01', 'auth-acceptance-prd-failed-set', dir);
    db.insertEvent({
      runId: 'run-auth-acceptance-prd-failed-01',
      type: 'prd_validation:complete',
      data: JSON.stringify({ type: 'prd_validation:complete', passed: false, gaps: [{ description: 'Missing PRD recovery evidence requirement' }] }),
      timestamp: new Date('2026-01-01T10:05:00.000Z').toISOString(),
    });
    db.insertEvent({
      runId: 'run-auth-acceptance-prd-failed-01',
      type: 'acceptance_validation:complete',
      data: JSON.stringify({
        type: 'acceptance_validation:complete',
        passed: false,
        verdicts: [failedVerdict, { criterion: 'AC-011 remains unknown', verdict: 'unknown', evidence: 'Manual review required' }],
        acceptanceConflicts: [acceptanceConflict],
      }),
      timestamp: new Date('2026-01-01T10:20:00.000Z').toISOString(),
    });
    db.insertEvent({
      runId: 'run-auth-acceptance-prd-failed-01',
      type: 'build:terminal-failure',
      data: JSON.stringify({
        type: 'build:terminal-failure',
        runId: 'run-auth-acceptance-prd-failed-01',
        failure: {
          scope: 'acceptance-validation',
          message: 'Acceptance criteria validation failed',
          authoritative: true,
          sourceEventType: 'acceptance_validation:complete',
          sourceEventId: 2,
          sourceEventTimestamp: new Date('2026-01-01T10:20:00.000Z').toISOString(),
          acceptanceValidationPassed: false,
        },
      }),
      timestamp: new Date('2026-01-01T10:25:00.000Z').toISOString(),
    });
    insertPhaseEnd(db, 'run-auth-acceptance-prd-failed-01', 'failed');
    db.close();

    const summary = await buildFailureSummary({ setName: 'auth-acceptance-prd-failed-set', prdId: 'auth-acceptance-prd-failed-prd', cwd: dir, dbPath });

    expect(summary.terminalFailure).toEqual(expect.objectContaining({
      scope: 'acceptance-validation',
      authoritative: true,
      sourceEventType: 'acceptance_validation:complete',
    }));
    expect(summary.partial).toBeUndefined();
    expect(summary.acceptanceValidation).toBeDefined();
    expect(summary.acceptanceValidation!.passed).toBe(false);
    expect(summary.acceptanceValidation!.verdicts).toContainEqual(failedVerdict);
    expect(summary.acceptanceValidation!.conflicts).toContainEqual(acceptanceConflict);
    expect(summary.failingPlan.planId).not.toBe('prd-validation');
  });

  it('emits placeholder acceptance-validation evidence when authoritative source lookup cannot parse a source row', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    mkdirSync(join(dir, '.eforge'), { recursive: true });
    const dbPath = join(dir, '.eforge', 'tf-auth-acceptance-placeholder.db');
    const db = openDatabase(dbPath);

    makeBaseRun(db, 'run-auth-acceptance-placeholder-01', 'auth-acceptance-placeholder-set', dir);
    db.insertEvent({ runId: 'run-auth-acceptance-placeholder-01', type: 'acceptance_validation:complete', data: JSON.stringify({ type: 'acceptance_validation:complete', passed: true, verdicts: [{ criterion: 'Passed criterion', verdict: 'pass', evidence: 'OK' }] }), timestamp: new Date('2026-01-01T10:20:00.000Z').toISOString() });
    db.insertEvent({ runId: 'run-auth-acceptance-placeholder-01', type: 'build:terminal-failure', data: JSON.stringify({ type: 'build:terminal-failure', runId: 'run-auth-acceptance-placeholder-01', failure: { scope: 'acceptance-validation', message: 'Acceptance criteria validation failed', authoritative: true, sourceEventType: 'acceptance_validation:complete', acceptanceValidationPassed: false } }), timestamp: new Date('2026-01-01T10:25:00.000Z').toISOString() });
    insertPhaseEnd(db, 'run-auth-acceptance-placeholder-01', 'failed');
    db.close();

    const summary = await buildFailureSummary({ setName: 'auth-acceptance-placeholder-set', prdId: 'auth-acceptance-placeholder-prd', cwd: dir, dbPath });

    expect(summary.acceptanceValidation).toMatchObject({ passed: false, total: 1, pass: 0, fail: 0, unknown: 1 });
    expect(summary.acceptanceValidation!.verdicts).toHaveLength(1);
    const placeholder = summary.acceptanceValidation!.verdicts[0]!;
    expect(placeholder).toMatchObject({ criterion: 'Acceptance validation evidence lookup failed', verdict: 'unknown' });
    expect(placeholder.evidence).toContain('run_id=run-auth-acceptance-placeholder-01');
    expect(placeholder.evidence).toContain('build:terminal-failure event id=2');
    expect(placeholder.evidence).toContain('acceptance_validation:complete');
    expect(placeholder.evidence).toContain('id <= 2');
    expect(placeholder.evidence).toContain('monitor.db');
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
    expect(md).toContain('**Partial Evidence:** yes');
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
