import { describe, expect, it } from 'vitest';
import type { CompilePreflightRisk, CompileScopeContextFailure } from '@eforge-build/client/browser';
import { compilePreflightDetail, compilePreflightSummary, compileScopeContextFailureDetail, compileScopeContextFailureSummary, recoveryActionLabel } from '@/lib/compile-resilience-format';

const hash = 'b'.repeat(64);

const risk: CompilePreflightRisk = {
  level: 'overflow-risk',
  sourceBytes: 4096,
  promptSourceBytes: 2048,
  acceptanceCriteriaCount: 4,
  score: 4,
  generatedInventory: { detected: true, contentHashes: [hash], pathReferences: ['docs/generated.md'], headings: ['Generated'], blockCount: 2, sidecarCount: 1, omittedBytes: 9 },
  subsystemBreadth: { count: 2, subsystems: ['cli', 'console'], evidence: ['two surfaces'] },
  reasons: ['too large'],
  recommendation: { action: 'bounded-decomposition', eligible: true, reason: 'Split the PRD.' },
};

const failure: CompileScopeContextFailure = {
  source: 'live-context-guard',
  failureKind: 'context-budget',
  stage: 'compile',
  explanation: 'Guard stopped compile.',
  risk,
  observed: { promptBytes: 8192, inputTokens: 10, outputTokens: 20, turns: 3 },
  recovery: { action: 'retry-as-expedition', eligible: true, attempted: true, attempt: 1, maxAttempts: 2, reason: 'Retry broader pipeline.' },
  artifacts: { orchestrationExists: false, validPlanCount: 0, invalidPlanCount: 1, missingPlanFileCount: 1, missingPlanFiles: ['plan-01.md'], invalidPlanFiles: ['plan-02.md'] },
};

const failureWithGuardDiagnostics: CompileScopeContextFailure = {
  ...failure,
  guardDiagnostics: {
    provider: 'anthropic',
    modelId: 'claude-sonnet-4',
    metadataSource: 'fallback',
    fallbackReason: 'model registry did not return context metadata',
    contextWindow: 200000,
    outputReserveTokens: 64000,
    overheadReserveTokens: 8192,
    safetyMargin: 0.75,
    limits: {
      maxPromptBytes: 500000,
      maxObservedInputTokens: 95744,
      maxObservedTurns: 8,
      maxExplanationBytes: 2000,
    },
  },
};

describe('compile resilience console formatting', () => {
  it('formats preflight summary and detail', () => {
    expect(compilePreflightSummary(risk)).toContain('overflow-risk');
    const detail = compilePreflightDetail(risk);
    expect(detail).toContain('Generated inventory');
    expect(detail).toContain(hash);
    expect(detail).toContain('Subsystem evidence');
    expect(detail).toContain('Split the PRD.');
  });

  it('formats failure summary and detail', () => {
    expect(compileScopeContextFailureSummary(failure)).toContain('context-budget from live-context-guard at compile');
    const detail = compileScopeContextFailureDetail(failure);
    expect(detail).toContain('Guard stopped compile.');
    expect(detail).toContain('attempt 1/2');
    expect(detail).toContain('Artifacts:');
    expect(detail).toContain('8.0 KiB prompt');
    expect(detail).not.toContain('Model:');
  });

  it('formats optional guard diagnostics', () => {
    const detail = compileScopeContextFailureDetail(failureWithGuardDiagnostics);
    expect(detail).toContain('Model: anthropic/claude-sonnet-4');
    expect(detail).toContain('maxObservedInputTokens=95744');
    expect(detail).toContain('contextWindow=200000');
    expect(detail).toContain('outputReserveTokens=64000');
    expect(detail).toContain('overheadReserveTokens=8192');
    expect(detail).toContain('safetyMargin=0.75');
    expect(detail).toContain('metadataSource=fallback');
    expect(detail).toContain('model registry did not return context metadata');
  });

  it('maps recovery actions', () => {
    expect(recoveryActionLabel('retry-as-expedition')).toBe('retry as expedition');
    expect(recoveryActionLabel('bounded-decomposition')).toBe('bounded decomposition');
    expect(recoveryActionLabel('manual-reduce-scope')).toBe('manual scope reduction');
    expect(recoveryActionLabel('repair-existing-artifacts')).toBe('repair existing artifacts');
  });
});
