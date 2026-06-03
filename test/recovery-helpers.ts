import { execFileSync } from 'node:child_process';
import type { BuildFailureSummary, EforgeEvent } from '@eforge-build/engine/events';

type RecoveryVerdict = {
  verdict: 'retry' | 'split' | 'abandon' | 'manual';
  confidence: 'low' | 'medium' | 'high';
  rationale: string;
  completedWork: string[];
  remainingWork: string[];
  risks: string[];
};

export function initRecoveryGitRepo(dir: string): void {
  const opts = { cwd: dir };
  execFileSync('git', ['init', '-b', 'main'], opts);
  execFileSync('git', ['config', 'user.email', 'test@example.com'], opts);
  execFileSync('git', ['config', 'user.name', 'Test'], opts);
  execFileSync('git', ['commit', '--allow-empty', '-m', 'chore: initial commit'], opts);
}

export function makeRecoverySummary(overrides: Partial<BuildFailureSummary> = {}): BuildFailureSummary {
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

export function makeRecoveryVerdict(verdict: RecoveryVerdict['verdict'] = 'manual'): RecoveryVerdict {
  return {
    verdict,
    confidence: 'low',
    rationale: 'Test recovery verdict.',
    completedWork: [],
    remainingWork: [],
    risks: [],
  };
}

export async function collectRecoveryEvents(gen: AsyncGenerator<EforgeEvent>): Promise<EforgeEvent[]> {
  const events: EforgeEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}
