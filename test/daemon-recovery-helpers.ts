import { execFileSync } from 'node:child_process';
import type { BuildFailureSummary, EforgeEvent } from '@eforge-build/engine/events';

export function initDaemonRecoveryGitRepo(dir: string): void {
  const opts = { cwd: dir };
  execFileSync('git', ['init', '-b', 'main'], opts);
  execFileSync('git', ['config', 'user.email', 'test@eforge.test'], opts);
  execFileSync('git', ['config', 'user.name', 'Test'], opts);
  execFileSync('git', ['commit', '--allow-empty', '-m', 'initial'], opts);
}

export function makeDaemonRecoverySummary(overrides: Partial<BuildFailureSummary> = {}): BuildFailureSummary {
  return {
    prdId: 'test-prd',
    setName: 'test-set',
    featureBranch: 'eforge/test-set',
    baseBranch: 'main',
    plans: [{ planId: 'plan-01', status: 'failed', error: 'Type error' }],
    failingPlan: { planId: 'plan-01', errorMessage: 'Type error' },
    landedCommits: [],
    diffStat: '',
    modelsUsed: [],
    failedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeManualRecoveryVerdict() {
  return {
    verdict: 'manual' as const,
    confidence: 'low' as const,
    rationale: 'Insufficient evidence.',
    completedWork: [],
    remainingWork: [],
    risks: [],
  };
}

export async function collectDaemonRecoveryEvents(gen: AsyncGenerator<EforgeEvent>): Promise<EforgeEvent[]> {
  const events: EforgeEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}
