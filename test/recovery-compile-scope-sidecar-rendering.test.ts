import { describe, expect, it } from 'vitest';
import type { RecoveryVerdictSidecar } from '@eforge-build/client';
import { renderRecoverySidecarMarkdown } from '../packages/engine/src/recovery/sidecar-markdown.js';

function payload(): RecoveryVerdictSidecar {
  return {
    schemaVersion: 4,
    generatedAt: '2026-01-01T00:00:00Z',
    prdId: 'oversized-prd',
    setName: 'demo-set',
    verdict: { verdict: 'manual', confidence: 'high', rationale: 'Manual scope reduction required.', completedWork: [], remainingWork: [], risks: [] },
    report: { operatorSummary: 'Compile failed.', recommendedAction: 'Reduce scope.', keyEvidence: [], completedWork: [], remainingWork: [], risks: [] },
    boundedEvidence: {
      identity: { prdId: 'oversized-prd', setName: 'demo-set', featureBranch: 'eforge/demo', baseBranch: 'main', failedAt: '2026-01-01T00:00:00Z' },
      plans: [],
      failingPlan: { planId: 'compile' },
      landedCommits: [],
      modelsUsed: [],
    },
    continueRepairEligibility: { source: 'continueRepairEligibility', eligible: true, featureBranch: 'eforge/demo', artifactAvailability: 'merge-worktree', landedCommitCount: 1, partial: false },
    recoveryOptions: [
      { kind: 'continue-repair', action: 'continue-repair', recommended: true, reason: 'Continue from artifacts.' },
      { kind: 'compile-scope-context', action: 'manual-reduce-scope', recommended: true, eligible: true, reason: 'Reduce oversized scope.', attempted: true, attempt: 1, maxAttempts: 2, source: 'provider', failureKind: 'context-window' },
    ],
  } as unknown as RecoveryVerdictSidecar;
}

describe('compile scope/context sidecar markdown', () => {
  it('renders read-only guidance alongside continue repair', () => {
    const markdown = renderRecoverySidecarMarkdown(payload());

    expect(markdown).toContain('## Continue-and-repair eligibility');
    expect(markdown).toContain('## Compile scope/context recovery guidance');
    expect(markdown).toContain('not map to an `apply-recovery` mutation');
    expect(markdown).toContain('**Action:** manual-reduce-scope');
    expect(markdown).toContain('**Eligible:** yes');
    expect(markdown).toContain('**Attempted:** yes');
    expect(markdown).toContain('**Attempt:** 1/2');
    expect(markdown).toContain('**Source:** provider');
    expect(markdown).toContain('**Failure Kind:** context-window');
    expect(markdown).toContain('Reduce oversized scope.');
  });
});
