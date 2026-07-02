import { describe, expect, it } from 'vitest';
import type { DecompositionFailureEvidence, EforgeEvent, PlanningDecompositionEventType } from '@eforge-build/client/browser';
import { compileScopeContextFailureDetail, compileScopeContextFailureSummary } from '@/lib/compile-resilience-format';
import { decompositionFailureEvidenceDetail, decompositionFailureEvidenceSummary, planningDecompositionEventDetail, planningDecompositionEventSummary } from '@/lib/planning-decomposition-format';

const timestamp = '2025-01-01T00:00:00.000Z';
const hash = 'c'.repeat(64);
const limits = { parallelism: 2, maxDepth: 3, maxPromptSourceBytes: 40000, maxPromptBytes: 80000, maxObservedInputTokens: 120000, maxCompactHandoffBytes: 12000, maxLocalExplorationToolUses: 24, maxCriteriaPerUnit: 20, maxSubsystemsPerUnit: 2, maxSplitAttemptsPerUnit: 2 };
const budget = { maxRecursiveDepth: 3, maxPromptSourceBytes: 40000, maxPromptBytes: 80000, maxObservedInputTokens: 120000, maxCompactHandoffBytes: 12000, maxLocalExplorationToolUses: 24, maxCriteriaPerUnit: 20, maxSubsystemsPerUnit: 2, maxSplitAttemptsPerUnit: 2 };
const observed = { promptSourceBytes: 39000, promptBytes: 79000, observedInputTokens: 121000, observedTurns: 5, compactHandoffBytes: 10000, localExplorationToolUses: 12, criteriaCount: 3, subsystemCount: 2, splitAttempts: 2, triggeredLimitKeys: ['maxObservedInputTokens'] };
const coverage = { totalCriteria: 3, coveredCriteria: [{ criterionId: 'AC-1', sourceHash: hash, coveredByUnitIds: ['unit-overflow'] }], unresolvedCriteria: [{ criterionId: 'AC-2', reason: 'needs smaller slice', evidence: 'bounded evidence only' }] };
const unit = { unitId: 'unit-overflow', parentUnitId: 'unit-parent', depth: 2, sourceSlices: [{ kind: 'criteria', sourceHash: hash, criteriaIds: ['AC-1', 'AC-2'], byteLength: 1000, path: 'prd.md' }], coverage, subsystemHints: ['engine', 'console'], dependencies: ['unit-foundation'], interfaceConstraints: [{ description: 'client event contracts' }], sharedFileConstraints: [{ description: 'event-card region' }], budgets: budget, status: 'queued' };
const evidence: DecompositionFailureEvidence = { unitId: 'unit-overflow', parentUnitId: 'unit-parent', depth: 2, budgets: budget, observed, assignedCriteriaIds: ['AC-1', 'AC-2', 'AC-3'], unresolvedCriteria: coverage.unresolvedCriteria, blockers: ['shared file owner pending'], splitAttempts: [{ attempt: 1, unitId: 'unit-overflow', reason: 'split by subsystem', resultingUnitIds: ['unit-a', 'unit-b'] }] };

const events = [
  { type: 'planning:decomposition:start', timestamp, graphId: 'graph-1', rootUnitId: 'unit-root', unitCount: 3, edgeCount: 2, limits },
  { type: 'planning:decomposition:unit:queued', timestamp, unit },
  { type: 'planning:decomposition:unit:running', timestamp, unitId: 'unit-overflow' },
  { type: 'planning:decomposition:unit:progress', timestamp, unitId: 'unit-overflow', message: 'bounded progress message', observed },
  { type: 'planning:decomposition:unit:completed', timestamp, unit: { ...unit, status: 'completed' } },
  { type: 'planning:decomposition:unit:skipped', timestamp, unitId: 'unit-overflow', reason: 'covered by parent', unit: { ...unit, status: 'skipped' } },
  { type: 'planning:decomposition:unit:failed', timestamp, unitId: 'unit-overflow', reason: 'budget exhausted', evidence },
  { type: 'planning:decomposition:schedule', timestamp, decision: { readyUnitIds: ['unit-a', 'unit-b'], runningUnitIds: ['unit-active'], waitingUnitIds: ['unit-waiting'], waitingReasons: [{ unitId: 'unit-waiting', reasons: ['dependency:unit-foundation'] }], selectedBatchUnitIds: ['unit-a', 'unit-b'], parallelism: 3, blockedPairs: [{ unitId: 'unit-waiting', blockedByUnitId: 'unit-foundation', reason: 'dependency:unit-foundation' }] } },
  { type: 'planning:decomposition:budget', timestamp, limits, unitId: 'unit-overflow', unitBudgets: [{ unitId: 'unit-overflow', budget }], observed },
  { type: 'planning:decomposition:compact-handoff', timestamp, unitId: 'unit-overflow', artifactPath: '.decomposition/unit-overflow/handoff.md', byteLength: 2048, contentHash: hash, omittedUnitIds: ['unit-omitted'] },
  { type: 'planning:decomposition:synthesis:complete', timestamp, unitCount: 3, completedUnitCount: 2, failedUnitCount: 0, skippedUnitCount: 1, coverage, artifactPaths: ['plans/architecture.md', 'plans/unit.md'] },
] as unknown as Array<Extract<EforgeEvent, { type: PlanningDecompositionEventType }>>;

describe('planning decomposition console formatting', () => {
  it('returns non-empty summaries and bounded details for every decomposition event variant', () => {
    for (const event of events) {
      expect(planningDecompositionEventSummary(event), event.type).not.toHaveLength(0);
      expect(planningDecompositionEventDetail(event), event.type).not.toContain('ROOT-SOURCE-SHOULD-NOT-APPEAR');
    }
  });

  it('includes schedule selected batches, active units, waiting reasons, and blocked pairs', () => {
    const schedule = events.find((event) => event.type === 'planning:decomposition:schedule')!;
    const detail = planningDecompositionEventDetail(schedule);
    expect(planningDecompositionEventSummary(schedule)).toContain('selected [unit-a, unit-b]');
    expect(detail).toContain('Active concurrent units: 1/3');
    expect(detail).toContain('selectedBatch: unit-a, unit-b');
    expect(detail).toContain('waitingReason:unit-waiting');
    expect(detail).toContain('blocked by unit-foundation');
  });

  it('formats bounded decomposition failure evidence', () => {
    expect(decompositionFailureEvidenceSummary(evidence)).toContain('Decomposition exhausted: unit-overflow');
    const detail = decompositionFailureEvidenceDetail({ ...evidence, rawSource: 'ROOT-SOURCE-SHOULD-NOT-APPEAR', prompt: 'PROMPT-SHOULD-NOT-APPEAR', transcript: 'RAW-TRANSCRIPT-SHOULD-NOT-APPEAR' } as unknown as DecompositionFailureEvidence);
    expect(detail).toContain('Failed Unit: unit-overflow');
    expect(detail).toContain('Depth: 2');
    expect(detail).toContain('Triggered limits: maxObservedInputTokens');
    expect(detail).toContain('Unresolved criteria: 1');
    expect(detail).toContain('shared file owner pending');
    expect(detail).not.toContain('ROOT-SOURCE-SHOULD-NOT-APPEAR');
    expect(detail).not.toContain('PROMPT-SHOULD-NOT-APPEAR');
    expect(detail).not.toContain('RAW-TRANSCRIPT-SHOULD-NOT-APPEAR');
  });

  it('labels decomposition-exhausted compile failures as decomposition failures', () => {
    const failure = { source: 'decomposition', failureKind: 'decomposition-exhausted', stage: 'planning-decomposition', explanation: 'decomposition exhausted', observed: { inputTokens: 121000 }, recovery: { action: 'bounded-decomposition', eligible: false, attempted: true, attempt: 1, maxAttempts: 1, reason: 'manual reduced source only' }, artifacts: { orchestrationExists: false, validPlanCount: 0, invalidPlanCount: 0, missingPlanFileCount: 0, missingPlanFiles: [], invalidPlanFiles: [] }, decompositionEvidence: evidence } as unknown as Parameters<typeof compileScopeContextFailureSummary>[0];
    expect(compileScopeContextFailureSummary(failure)).toContain('decomposition-exhausted from decomposition at planning-decomposition');
    const detail = compileScopeContextFailureDetail(failure);
    expect(detail).toContain('Failed Unit: unit-overflow');
    expect(detail).toContain('Depth: 2');
    expect(detail).toContain('Triggered limits: maxObservedInputTokens');
    expect(detail).toContain('Unresolved criteria: 1');
  });
});
