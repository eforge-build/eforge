import { describe, expect, it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { EforgeEvent } from '@eforge-build/client';
import { safeParseEforgeEvent } from '@eforge-build/client';
import { buildFailureSummary } from '@eforge-build/engine/recovery/failure-summary';
import { openDatabase } from '@eforge-build/monitor/db';
import { useTempDir } from './test-tmpdir.js';

function seedGitRepo(dir: string): void {
  const gitOpts = { cwd: dir };
  execFileSync('git', ['init', '-b', 'main'], gitOpts);
  execFileSync('git', ['config', 'user.email', 'test@example.com'], gitOpts);
  execFileSync('git', ['config', 'user.name', 'Test'], gitOpts);
  execFileSync('git', ['commit', '--allow-empty', '-m', 'chore: initial commit'], gitOpts);
  execFileSync('git', ['checkout', '-b', 'eforge/test-recovery-set'], gitOpts);
  execFileSync('git', ['commit', '--allow-empty', '-m', 'feat: implementation'], gitOpts);
  execFileSync('git', ['checkout', 'main'], gitOpts);
}

function makeReviewFailureSummaryEvent(): EforgeEvent {
  return {
    type: 'recovery:summary',
    timestamp: '2025-01-01T00:00:00.000Z',
    prdId: 'prd-review-failure',
    summary: {
      prdId: 'prd-review-failure',
      setName: 'review-failure-set',
      featureBranch: 'eforge/review-failure-set',
      baseBranch: 'main',
      plans: [{ planId: 'plan-01-review', status: 'failed' }],
      failingPlan: { planId: 'plan-01-review' },
      landedCommits: [],
      diffStat: '',
      modelsUsed: [],
      failedAt: '2025-01-01T00:00:00.000Z',
      reviewFailure: {
        planId: 'plan-01-review',
        issues: [{ severity: 'critical', category: 'architecture', file: 'src/read.ts', description: 'Reader creates a second source of truth.', fix: 'Read from the manifest only.' }],
        evaluation: { accepted: 0, rejected: 1, review: 0, verdicts: [{ file: 'src/read.ts', action: 'reject', reason: 'The proposed fix keeps competing sources of truth.' }] },
      },
    },
  };
}

describe('recovery review failure details', () => {
  const makeTempDir = useTempDir('eforge-recovery-review-failure-');

  it('are accepted by the recovery:summary wire schema', () => {
    expect(safeParseEforgeEvent(makeReviewFailureSummaryEvent()).success).toBe(true);
  });

  it('are synthesized from final review and evaluator events', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    const dbDir = join(dir, '.eforge');
    mkdirSync(dbDir, { recursive: true });
    const dbPath = join(dbDir, 'monitor.db');
    const db = openDatabase(dbPath);
    const failureMessage = '1 unresolved issue(s) remain after 2 review round(s) (1 rejected, 0 under review).';

    db.insertRun({ id: 'run-review-failure', sessionId: 'session-review-failure', planSet: 'test-recovery-set', command: 'build', status: 'failed', startedAt: '2024-01-15T10:00:00.000Z', cwd: dir, pid: 99999 });
    db.insertEvent({ runId: 'run-review-failure', type: 'plan:status:change', planId: 'plan-01-review', data: JSON.stringify({ type: 'plan:status:change', planId: 'plan-01-review', status: 'failed' }), timestamp: '2024-01-15T10:20:00.000Z' });
    db.insertEvent({ runId: 'run-review-failure', type: 'plan:build:review:complete', planId: 'plan-01-review', data: JSON.stringify({ type: 'plan:build:review:complete', planId: 'plan-01-review', issues: [{ severity: 'critical', category: 'architecture', file: 'packages/input/src/session-plan-set/read.ts', description: 'Reader creates a second source of truth instead of consuming the manifest.', fix: 'Load artifact metadata from the manifest only.' }] }), timestamp: '2024-01-15T10:30:00.000Z' });
    db.insertEvent({ runId: 'run-review-failure', type: 'plan:build:evaluate:complete', planId: 'plan-01-review', data: JSON.stringify({ type: 'plan:build:evaluate:complete', planId: 'plan-01-review', accepted: 0, rejected: 1, verdicts: [{ file: 'packages/input/src/session-plan-set/read.ts', action: 'reject', reason: 'The proposed fix still leaves the manifest and filesystem walk as competing sources of truth.' }] }), timestamp: '2024-01-15T10:35:00.000Z' });
    db.insertEvent({ runId: 'run-review-failure', type: 'plan:build:failed', planId: 'plan-01-review', data: JSON.stringify({ type: 'plan:build:failed', planId: 'plan-01-review', error: failureMessage }), timestamp: '2024-01-15T10:40:00.000Z' });
    db.insertEvent({ runId: 'run-review-failure', type: 'build:terminal-failure', planId: 'plan-01-review', data: JSON.stringify({ type: 'build:terminal-failure', failure: { scope: 'plan', planId: 'plan-01-review', message: failureMessage, authoritative: true, sourceEventType: 'plan:build:failed' } }), timestamp: '2024-01-15T10:40:01.000Z' });
    db.insertEvent({ runId: 'run-review-failure', type: 'phase:end', data: JSON.stringify({ type: 'phase:end', result: { status: 'failed', summary: failureMessage } }), timestamp: '2024-01-15T10:41:00.000Z' });
    db.close();

    const summary = await buildFailureSummary({ setName: 'test-recovery-set', prdId: 'test-prd', cwd: dir, dbPath });
    expect(summary.reviewFailure?.planId).toBe('plan-01-review');
    expect(summary.reviewFailure?.issues[0]?.description).toContain('second source of truth');
    expect(summary.reviewFailure?.evaluation?.verdicts[0]?.reason).toContain('competing sources of truth');
    expect(summary.plans.find(p => p.planId === 'plan-01-review')?.error).toBe(failureMessage);
    expect(summary.failingPlans?.[0]?.errorMessage).toBe(failureMessage);
  });
});
