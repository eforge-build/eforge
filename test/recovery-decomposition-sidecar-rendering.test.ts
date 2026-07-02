import { describe, expect, it } from 'vitest';
import type { BuildFailureSummary, RecoveryVerdict } from '@eforge-build/engine/events';
import type { DecompositionFailureEvidence, RecoverySidecarRecoveryOption } from '@eforge-build/client';
import { compileScopeContextRecoveryOption } from '@eforge-build/engine/compile-resilience/context-recovery';
import { renderDecompositionEvidenceMarkdownLines } from '@eforge-build/engine/recovery/decomposition-evidence-render';
import { renderRecoveryGuidanceSection } from '@eforge-build/engine/recovery/guidance-render';
import { renderRecoverySidecarMarkdown } from '@eforge-build/engine/recovery/sidecar-markdown';
import { buildRecoverySidecarPayload } from '@eforge-build/engine/recovery/sidecar-payload';
import { parseRecoverySidecarPayload } from '@eforge-build/engine/recovery/sidecar-read';

const hash = 'd'.repeat(64);
const budget = { maxRecursiveDepth: 3, maxPromptSourceBytes: 40000, maxPromptBytes: 80000, maxObservedInputTokens: 120000, maxCompactHandoffBytes: 12000, maxLocalExplorationToolUses: 24, maxCriteriaPerUnit: 20, maxSubsystemsPerUnit: 2, maxSplitAttemptsPerUnit: 2 };
const evidence: DecompositionFailureEvidence = {
  unitId: 'unit-overflow',
  parentUnitId: 'unit-parent',
  depth: 2,
  budgets: budget,
  observed: { promptSourceBytes: 39000, promptBytes: 79000, observedInputTokens: 121000, observedTurns: 5, compactHandoffBytes: 10000, localExplorationToolUses: 12, criteriaCount: 3, subsystemCount: 2, splitAttempts: 2, triggeredLimitKeys: ['maxObservedInputTokens'] },
  assignedCriteriaIds: ['AC-1', 'AC-2', 'AC-3'],
  unresolvedCriteria: [{ criterionId: 'AC-2', reason: 'needs smaller slice', evidence: 'bounded evidence only' }],
  blockers: ['shared file owner pending'],
  splitAttempts: [{ attempt: 1, unitId: 'unit-overflow', reason: 'split by subsystem', resultingUnitIds: ['unit-a', 'unit-b'] }],
};

function summary(): BuildFailureSummary {
  return {
    prdId: 'prd-decomposition',
    setName: 'set-a',
    featureBranch: 'eforge/set-a',
    baseBranch: 'main',
    plans: [{ planId: 'plan-05', status: 'failed', error: 'decomposition exhausted' }],
    failingPlan: { planId: 'plan-05', errorMessage: 'decomposition exhausted' },
    failedAt: '2025-01-01T00:00:00.000Z',
    landedCommits: [],
    modelsUsed: [],
    diffStat: '0 files changed',
  };
}

const verdict: RecoveryVerdict = {
  verdict: 'manual',
  confidence: 'high',
  rationale: 'Inspect bounded decomposition evidence and reduce scope manually.',
  completedWork: [],
  remainingWork: ['Reduce the source manually.'],
  risks: ['Context-managed decomposition exhausted.'],
};

function option(overrides: Partial<RecoverySidecarRecoveryOption> = {}): RecoverySidecarRecoveryOption {
  return {
    kind: 'compile-scope-context',
    action: 'bounded-decomposition',
    recommended: true,
    eligible: false,
    reason: 'Context-managed decomposition exhausted in unit unit-overflow; the engine does not auto-author and does not auto-enqueue successor PRDs.',
    attempted: true,
    attempt: 1,
    maxAttempts: 1,
    source: 'decomposition',
    failureKind: 'decomposition-exhausted',
    decompositionEvidence: evidence,
    ...overrides,
  } as RecoverySidecarRecoveryOption;
}

describe('recovery decomposition sidecar rendering', () => {
  it('renders bounded markdown evidence and detects forbidden raw keys defensively', () => {
    const lines = renderDecompositionEvidenceMarkdownLines(evidence).join('\n');
    expect(lines).toContain('Failed Unit: unit-overflow');
    expect(lines).toContain('Parent Unit: unit-parent');
    expect(lines).toContain('Depth: 2');
    expect(lines).toContain('Triggered limits: maxObservedInputTokens');
    expect(lines).toContain('Assigned criteria: 3');
    expect(lines).toContain('Unresolved criteria: 1');
    expect(lines).toContain('shared file owner pending');
  });

  it('preserves valid decomposition evidence through schema-version 4 sidecar parsing', () => {
    const payload = buildRecoverySidecarPayload({ prdId: 'prd-decomposition', summary: summary(), verdict, recoveryOptions: [option()] });
    expect(payload.schemaVersion).toBe(4);
    expect(payload.report.keyEvidence.join('\n')).toContain('Decomposition exhausted: unit-overflow');

    const parsed = parseRecoverySidecarPayload(JSON.stringify(payload), 'prd-decomposition');
    const parsedOption = parsed.recoveryOptions?.find((item) => item.kind === 'compile-scope-context');
    expect(parsedOption?.decompositionEvidence?.unitId).toBe('unit-overflow');
    expect(parsedOption?.decompositionEvidence?.observed.triggeredLimitKeys).toContain('maxObservedInputTokens');
  });

  it('rejects malformed decomposition evidence when parsing sidecar JSON', () => {
    const payload = buildRecoverySidecarPayload({ prdId: 'prd-decomposition', summary: summary(), verdict, recoveryOptions: [option()] });
    const malformed = { ...payload, recoveryOptions: [{ ...payload.recoveryOptions![0], decompositionEvidence: { ...evidence, depth: -1 } }] };
    expect(() => parseRecoverySidecarPayload(JSON.stringify(malformed), 'prd-decomposition')).toThrow(/decompositionEvidence|depth|Recovery sidecar/i);
  });

  it('renders sidecar markdown guidance without successor PRD mutation wording or raw sentinels', () => {
    const payload = buildRecoverySidecarPayload({ prdId: 'prd-decomposition', summary: summary(), verdict, recoveryOptions: [option()] });
    const markdown = renderRecoverySidecarMarkdown({ ...payload, rawSource: 'ROOT-SOURCE-SHOULD-NOT-APPEAR', prompt: 'PROMPT-SHOULD-NOT-APPEAR', rawTranscript: 'RAW-TRANSCRIPT-SHOULD-NOT-APPEAR' } as unknown as Parameters<typeof renderRecoverySidecarMarkdown>[0]);
    expect(markdown).toContain('Decomposition evidence');
    expect(markdown).toContain('Failed Unit: unit-overflow');
    expect(markdown).toContain('Triggered limits: maxObservedInputTokens');
    expect(markdown).toContain('Unresolved criteria');
    expect(markdown).toContain('does not auto-author or auto-enqueue successor PRDs');
    expect(markdown).not.toContain('ROOT-SOURCE-SHOULD-NOT-APPEAR');
    expect(markdown).not.toContain('PROMPT-SHOULD-NOT-APPEAR');
    expect(markdown).not.toContain('RAW-TRANSCRIPT-SHOULD-NOT-APPEAR');
  });

  it('renders recovery guidance with failed unit and unresolved criteria counts', () => {
    const sidecar = buildRecoverySidecarPayload({ prdId: 'prd-decomposition', summary: summary(), verdict, recoveryOptions: [option()] });
    const guidance = renderRecoveryGuidanceSection({ sidecar, planId: 'plan-05', sidecarPath: '/tmp/prd-decomposition.recovery.json', featureBranch: 'eforge/set-a', baseBranch: 'main', setName: 'set-a', prdId: 'prd-decomposition' });
    expect(guidance).toContain('Decomposition exhausted in unit unit-overflow');
    expect(guidance).toContain('maxObservedInputTokens');
    expect(guidance).toContain('Unresolved criteria: 1');
    expect(guidance).toContain('does not auto-author or auto-enqueue successor PRDs');
  });

  it('copies decomposition evidence into compile-scope-context recovery options and omits none actions', () => {
    const failure = { source: 'decomposition', failureKind: 'decomposition-exhausted', stage: 'planning-decomposition', explanation: 'decomposition exhausted', recovery: { action: 'bounded-decomposition', eligible: false, attempted: true, attempt: 1, maxAttempts: 1, reason: 'decomposition exhausted in unit-overflow' }, artifacts: { orchestrationExists: false, validPlanCount: 0, invalidPlanCount: 0, missingPlanFileCount: 0, missingPlanFiles: [], invalidPlanFiles: [] }, decompositionEvidence: evidence } as Parameters<typeof compileScopeContextRecoveryOption>[0];
    expect(compileScopeContextRecoveryOption(failure)?.decompositionEvidence?.unitId).toBe('unit-overflow');
    expect(compileScopeContextRecoveryOption({ ...failure, recovery: { ...failure.recovery, action: 'none' } })).toBeUndefined();
  });
});
