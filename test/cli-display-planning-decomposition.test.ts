import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DecompositionFailureEvidence, EforgeEvent } from '@eforge-build/client';
import { renderCompileScopeContextFailureModel } from '../packages/eforge/src/cli/compile-resilience-display.js';
import { initDisplay, renderEvent, stopAllSpinners } from '../packages/eforge/src/cli/display.js';
import { renderDecompositionEvidenceLines, renderPlanningDecompositionEventModel } from '../packages/eforge/src/cli/planning-decomposition-display.js';

const timestamp = '2025-01-01T00:00:00.000Z';
const hash = 'a'.repeat(64);
const limits = { parallelism: 2, maxDepth: 3, maxPromptSourceBytes: 40000, maxPromptBytes: 80000, maxObservedInputTokens: 120000, maxCompactHandoffBytes: 12000, maxLocalExplorationToolUses: 24, maxCriteriaPerUnit: 20, maxSubsystemsPerUnit: 2, maxSplitAttemptsPerUnit: 2 };
const budget = { maxRecursiveDepth: 3, maxPromptSourceBytes: 40000, maxPromptBytes: 80000, maxObservedInputTokens: 120000, maxCompactHandoffBytes: 12000, maxLocalExplorationToolUses: 24, maxCriteriaPerUnit: 20, maxSubsystemsPerUnit: 2, maxSplitAttemptsPerUnit: 2 };
const observed = { promptSourceBytes: 39000, promptBytes: 79000, observedInputTokens: 121000, observedTurns: 5, compactHandoffBytes: 10000, localExplorationToolUses: 12, criteriaCount: 3, subsystemCount: 2, splitAttempts: 2, triggeredLimitKeys: ['maxObservedInputTokens'] };
const coverage = { totalCriteria: 3, coveredCriteria: [{ criterionId: 'AC-1', sourceHash: hash, coveredByUnitIds: ['unit-overflow'] }], unresolvedCriteria: [{ criterionId: 'AC-2', reason: 'needs smaller slice', evidence: 'bounded evidence only' }] };
const unit = { unitId: 'unit-overflow', parentUnitId: 'unit-parent', depth: 2, sourceSlices: [{ kind: 'criteria', sourceHash: hash, criteriaIds: ['AC-1', 'AC-2'], byteLength: 1000, path: 'prd.md' }], coverage, subsystemHints: ['engine', 'console'], dependencies: ['unit-foundation'], interfaceConstraints: [{ description: 'client event contracts' }], sharedFileConstraints: [{ description: 'event-card region' }], budgets: budget, status: 'queued' };
const evidence: DecompositionFailureEvidence = { unitId: 'unit-overflow', parentUnitId: 'unit-parent', depth: 2, budgets: budget, observed, assignedCriteriaIds: ['AC-1', 'AC-2', 'AC-3'], unresolvedCriteria: coverage.unresolvedCriteria, blockers: ['shared file owner pending'], splitAttempts: [{ attempt: 1, unitId: 'unit-overflow', reason: 'split by subsystem', resultingUnitIds: ['unit-a', 'unit-b'] }] };

function stripAnsi(value: string): string { return value.replace(/\u001b\[[0-9;]*m/g, ''); }
function captureConsoleLogs(run: () => void): string[] {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(' ')); });
  try { run(); } finally { spy.mockRestore(); }
  return lines.map(stripAnsi);
}

afterEach(() => { stopAllSpinners(); initDisplay(); });

describe('planning decomposition CLI display', () => {
  it('renders summaries for representative decomposition event groups', () => {
    const start = renderPlanningDecompositionEventModel({ type: 'planning:decomposition:start', timestamp, graphId: 'graph-1', rootUnitId: 'unit-root', unitCount: 2, edgeCount: 1, limits, riskEvidence: { level: 'overflow-risk', score: 90, sourceBytes: 100000, promptSourceBytes: 90000, acceptanceCriteriaCount: 3, subsystemSummaries: ['engine'], recommendationAction: 'bounded-decomposition', selectedScope: 'expedition' } } as EforgeEvent & { type: 'planning:decomposition:start' });
    expect(start.headline).toContain('Context-managed planning');
    expect(start.headline).toContain('2 unit(s)');

    const queued = renderPlanningDecompositionEventModel({ type: 'planning:decomposition:unit:queued', timestamp, unit } as unknown as Extract<EforgeEvent, { type: 'planning:decomposition:unit:queued' }>);
    expect(queued.headline).toContain('Planning unit queued: unit-overflow');
    expect(queued.headline).toContain('engine');

    const completed = renderPlanningDecompositionEventModel({ type: 'planning:decomposition:unit:completed', timestamp, unit: { ...unit, status: 'completed' } } as unknown as Extract<EforgeEvent, { type: 'planning:decomposition:unit:completed' }>);
    expect(completed.headline).toContain('Planning unit completed: unit-overflow (1 criteria)');
    expect(completed.details.join('\n')).toContain('Unresolved criteria: 1');

    const synthesis = renderPlanningDecompositionEventModel({ type: 'planning:decomposition:synthesis:complete', timestamp, unitCount: 3, completedUnitCount: 2, failedUnitCount: 0, skippedUnitCount: 1, coverage, artifactPaths: ['plans/architecture.md', 'plans/unit.md'] } as unknown as Extract<EforgeEvent, { type: 'planning:decomposition:synthesis:complete' }>);
    expect(synthesis.headline).toContain('Context-managed synthesis complete: 2 artifact(s)');
    expect(synthesis.details.join('\n')).toContain('plans/architecture.md');
  });

  it('renders schedule selected batches, waiting reasons, and dependency blockers', () => {
    const model = renderPlanningDecompositionEventModel({ type: 'planning:decomposition:schedule', timestamp, decision: { readyUnitIds: ['unit-a', 'unit-b'], runningUnitIds: ['unit-active'], waitingUnitIds: ['unit-waiting'], waitingReasons: [{ unitId: 'unit-waiting', reasons: ['dependency:unit-foundation'] }], selectedBatchUnitIds: ['unit-a', 'unit-b'], parallelism: 3, blockedPairs: [{ unitId: 'unit-waiting', blockedByUnitId: 'unit-foundation', reason: 'dependency:unit-foundation' }] } } as Extract<EforgeEvent, { type: 'planning:decomposition:schedule' }>);

    expect(model.headline).toContain('selected [unit-a, unit-b]');
    expect(model.details.join('\n')).toContain('selectedBatch: unit-a, unit-b');
    expect(model.details.join('\n')).toContain('dependency:unit-foundation');
  });

  it('renders budget pressure and compact handoff details without raw payload sentinels', () => {
    const budgetModel = renderPlanningDecompositionEventModel({ type: 'planning:decomposition:budget', timestamp, limits, unitId: 'unit-overflow', unitBudgets: [{ unitId: 'unit-overflow', budget }], observed, rawSource: 'ROOT-SOURCE-SHOULD-NOT-APPEAR', prompt: 'PROMPT-SHOULD-NOT-APPEAR' } as unknown as Extract<EforgeEvent, { type: 'planning:decomposition:budget' }>);
    expect(budgetModel.headline).toContain('triggered maxObservedInputTokens');
    expect(budgetModel.details.join('\n')).toContain('maxObservedInputTokens');
    expect(budgetModel.details.join('\n')).not.toContain('ROOT-SOURCE-SHOULD-NOT-APPEAR');
    expect(budgetModel.details.join('\n')).not.toContain('PROMPT-SHOULD-NOT-APPEAR');

    const handoff = captureConsoleLogs(() => renderEvent({ type: 'planning:decomposition:compact-handoff', timestamp, unitId: 'unit-overflow', artifactPath: '.decomposition/unit-overflow/handoff.md', byteLength: 2048, contentHash: hash, omittedUnitIds: [], rawTranscript: 'RAW-TRANSCRIPT-SHOULD-NOT-APPEAR' } as unknown as EforgeEvent));
    const rendered = handoff.join('\n');
    expect(rendered).toContain('unit-overflow');
    expect(rendered).toContain('.decomposition/unit-overflow/handoff.md');
    expect(rendered).toContain('2048 B');
    expect(rendered).toContain(hash.slice(0, 12));
    expect(rendered).not.toContain('RAW-TRANSCRIPT-SHOULD-NOT-APPEAR');
  });

  it('renders decomposition-exhausted compile failures as decomposition evidence', () => {
    const model = renderCompileScopeContextFailureModel({ source: 'decomposition', failureKind: 'decomposition-exhausted', stage: 'planning-decomposition', explanation: 'decomposition exhausted', observed: { inputTokens: 121000 }, recovery: { action: 'bounded-decomposition', eligible: false, attempted: true, attempt: 1, maxAttempts: 1, reason: 'manual reduced source only' }, artifacts: { orchestrationExists: false, validPlanCount: 0, invalidPlanCount: 0, missingPlanFileCount: 0, missingPlanFiles: [], invalidPlanFiles: [] }, decompositionEvidence: evidence } as unknown as Parameters<typeof renderCompileScopeContextFailureModel>[0]);
    const detail = model.details.join('\n');
    expect(model.headline).toContain('decomposition-exhausted');
    expect(model.headline).toContain('decomposition');
    expect(model.headline).toContain('planning-decomposition');
    expect(detail).toContain('Decomposition exhausted in unit unit-overflow');
    expect(detail).toContain('Depth: 2');
    expect(detail).toContain('Triggered limits: maxObservedInputTokens');
    expect(detail).toContain('Assigned criteria: 3');
    expect(detail).toContain('Unresolved criteria: 1');
    expect(detail).toContain('shared file owner pending');
  });

  it('renders failed-unit evidence lines without forbidden raw field sentinels', () => {
    const lines = renderDecompositionEvidenceLines({ ...evidence, rawSource: 'ROOT-SOURCE-SHOULD-NOT-APPEAR', prompt: 'PROMPT-SHOULD-NOT-APPEAR', rawTranscript: 'RAW-TRANSCRIPT-SHOULD-NOT-APPEAR' } as unknown as DecompositionFailureEvidence).join('\n');
    expect(lines).toContain('unit-overflow');
    expect(lines).not.toContain('ROOT-SOURCE-SHOULD-NOT-APPEAR');
    expect(lines).not.toContain('PROMPT-SHOULD-NOT-APPEAR');
    expect(lines).not.toContain('RAW-TRANSCRIPT-SHOULD-NOT-APPEAR');
  });
});
