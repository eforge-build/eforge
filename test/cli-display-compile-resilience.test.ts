import { describe, expect, it } from 'vitest';
import type { CompileScopeContextFailure, PlannerInspectionSummary } from '@eforge-build/client';
import { plannerContinuationReasonLabel, renderCompileScopeContextFailureModel, renderPlannerInspectionSummaryModel } from '../packages/eforge/src/cli/compile-resilience-display.js';

function plannerInspectionSummary(): PlannerInspectionSummary {
  return {
    kind: 'planner-inspection-handoff',
    version: 1,
    source: { sourceName: 'Queue cleanup', planSetName: 'set-a' },
    relevantFiles: ['packages/engine/src/queue/scheduler.ts'],
    observedFacts: ['Read scheduler cleanup code.'],
    importantFindings: ['Queue cleanup coverage was removed.'],
    inferredImplementationAreas: ['packages/engine/src/queue'],
    unresolvedQuestions: ['Confirm failed dispatch shape.'],
    sourceBuildContext: { sourceSummary: 'Fix removed queue coverage cleanup.' },
    budgetDiagnostics: {
      maxObservedInputTokens: 160000,
      softInputTokenThreshold: 115200,
      plannerMaxTurns: 80,
      inspectionTurnBudget: 60,
      softInputTokenRatio: 0.72,
      softTurnRatio: 0.75,
      observed: { inputTokens: 115200, outputTokens: 1200, turns: 44, promptBytes: 4096 },
      toolUseCount: 32,
      toolResultCount: 31,
    },
    caveats: ['Inspection is incomplete.'],
    omittedCounts: { toolResults: 1 },
  };
}

function failure(): CompileScopeContextFailure {
  return {
    source: 'provider',
    failureKind: 'context-window',
    stage: 'planner',
    explanation: 'Provider rejected context window.',
    observed: { promptBytes: 8192, inputTokens: 1000, outputTokens: 20, turns: 2 },
    recovery: { action: 'manual-reduce-scope', eligible: true, attempted: false, attempt: 1, maxAttempts: 2, reason: 'Reduce scope.' },
    artifacts: { orchestrationExists: true, validPlanCount: 1, invalidPlanCount: 2, missingPlanFileCount: 3, missingPlanFiles: ['plan-03.md'], invalidPlanFiles: ['plan-02.md'] },
  };
}

function failureWithGuardDiagnostics(): CompileScopeContextFailure {
  return {
    ...failure(),
    source: 'live-context-guard',
    failureKind: 'context-budget',
    guardDiagnostics: {
      provider: 'openai',
      modelId: 'gpt-5',
      metadataSource: 'registry',
      fallbackReason: 'registry entry lacked token limits; used provider fallback',
      contextWindow: 200000,
      outputReserveTokens: 32000,
      overheadReserveTokens: 4096,
      safetyMargin: 0.8,
      limits: {
        maxPromptBytes: 500000,
        maxObservedInputTokens: 131072,
        maxObservedTurns: 12,
        maxExplanationBytes: 2000,
      },
    },
  };
}

describe('compile resilience CLI formatting', () => {
  it('renders compact planner inspection details and continuation reason labels', () => {
    const model = renderPlannerInspectionSummaryModel(plannerInspectionSummary());
    const detail = model.details.join('\n');
    expect(model.headline).toContain('Planner compact inspection summary');
    expect(detail).toContain('packages/engine/src/queue/scheduler.ts');
    expect(detail).toContain('Queue cleanup coverage was removed');
    expect(plannerContinuationReasonLabel('compact_inspection')).toBe('compact inspection synthesis');
  });

  it('renders scope/context failure details without raw payloads', () => {
    const model = renderCompileScopeContextFailureModel(failure());
    const detail = model.details.join('\n');
    expect(model.headline).toContain('Compile scope/context failure');
    expect(model.headline).toContain('context-window');
    expect(detail).toContain('attempt 1/2');
    expect(detail).toContain('1 valid plan');
    expect(detail).toContain('1000 input tokens');
    expect(detail).not.toContain('Model:');
  });

  it('renders optional guard diagnostics when present', () => {
    const detail = renderCompileScopeContextFailureModel(failureWithGuardDiagnostics()).details.join('\n');
    expect(detail).toContain('Model: openai/gpt-5');
    expect(detail).toContain('maxObservedInputTokens=131072');
    expect(detail).toContain('contextWindow=200000');
    expect(detail).toContain('outputReserveTokens=32000');
    expect(detail).toContain('overheadReserveTokens=4096');
    expect(detail).toContain('safetyMargin=0.8');
    expect(detail).toContain('metadataSource=registry');
    expect(detail).toContain('registry entry lacked token limits; used provider fallback');
  });
});
