import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import * as browser from '../browser.js';
import * as client from '../index.js';
import * as events from '../events.js';
import { eventRegistry, getEventSummary } from '../event-registry.js';
import {
  AgentTerminalSubtypeSchema,
  BoundedDiagnosticOptionsSchema,
  BoundedValidationDiagnosticSchema,
  CompileArtifactSummarySchema,
  CompileContextGuardDiagnosticsSchema,
  CompileContextGuardLimitsSchema,
  // --- eforge:region plan-02-planner-continuation-surfaces ---
  MAX_PLANNER_INSPECTION_OBSERVED_FACTS,
  PlannerInspectionSummarySchema,
  // --- eforge:endregion plan-02-planner-continuation-surfaces ---
  MAX_COMPILE_RISK_LIST_ITEMS,
  MAX_VALIDATION_DIAGNOSTIC_EXCERPT_LENGTH,
  MAX_VALIDATION_DIAGNOSTIC_MESSAGE_LENGTH,
  safeParseEforgeEvent,
  type CompilePreflightRisk,
  // --- eforge:region plan-02-planner-continuation-surfaces ---
  type PlannerInspectionSummary,
  // --- eforge:endregion plan-02-planner-continuation-surfaces ---
} from '../events.js';
import {
  RECOVERY_SIDECAR_COMPILE_SCOPE_CONTEXT_REASON_MAX_BYTES,
  RecoverySidecarCompileScopeContextOptionSchema,
  type RecoverySidecarRecoveryOption,
} from '../routes.js';

const timestamp = '2026-06-26T10:00:00.000Z';

function validRisk(): CompilePreflightRisk {
  return {
    level: 'elevated',
    sourceBytes: 1024,
    promptSourceBytes: 2048,
    acceptanceCriteriaCount: 3,
    score: 42,
    generatedInventory: {
      detected: true,
      contentHashes: ['a'.repeat(64)],
      pathReferences: ['docs/prd.md'],
      headings: ['Implementation Plan'],
      blockCount: 2,
      sidecarCount: 1,
      omittedBytes: 0,
    },
    subsystemBreadth: {
      count: 1,
      subsystems: ['client'],
      evidence: ['packages/client'],
    },
    selectedProfile: null,
    pipelineScope: 'excursion',
    reasons: ['large compile prompt'],
    recommendation: {
      action: 'retry-as-expedition',
      eligible: true,
      reason: 'split planning across expedition stages',
    },
  };
}

function artifactSummary() {
  return {
    orchestrationExists: true,
    validPlanCount: 1,
    invalidPlanCount: 0,
    missingPlanFileCount: 0,
    missingPlanFiles: [],
    invalidPlanFiles: [],
  };
}

function riskWith(update: (risk: CompilePreflightRisk) => CompilePreflightRisk): CompilePreflightRisk {
  return update(validRisk());
}

// --- eforge:region plan-02-planner-continuation-surfaces ---
function validPlannerInspectionSummary(): PlannerInspectionSummary {
  return {
    kind: 'planner-inspection-handoff',
    version: 1,
    source: { sourceId: 'prd-1', sourceName: 'Queue cleanup', planSetName: 'set-a', runId: 'run-1' },
    relevantFiles: ['packages/engine/src/queue/scheduler.ts'],
    observedFacts: ['Read scheduler cleanup code.'],
    importantFindings: ['Queue cleanup coverage was removed.'],
    inferredImplementationAreas: ['packages/engine/src/queue'],
    unresolvedQuestions: ['Confirm failed dispatch cleanup shape.'],
    sourceBuildContext: { sourceSummary: 'Fix removed queue coverage cleanup.', buildGoal: 'Restore coverage.', promptSourceSnippet: '# Fix removed queue coverage cleanup' },
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
// --- eforge:endregion plan-02-planner-continuation-surfaces ---

describe('compile resilience contracts', () => {
  it('parses valid planning preflight events', () => {
    const result = safeParseEforgeEvent({
      type: 'planning:preflight',
      timestamp,
      risk: validRisk(),
    });

    expect(result.success).toBe(true);
  });

  it('rejects preflight representative arrays above the public bound', () => {
    const oversizedList = Array.from({ length: MAX_COMPILE_RISK_LIST_ITEMS + 1 }, (_, index) => `item-${index}`);
    const cases: Array<[string, CompilePreflightRisk]> = [
      ['generatedInventory.contentHashes', riskWith((risk) => ({ ...risk, generatedInventory: { ...risk.generatedInventory, contentHashes: oversizedList } }))],
      ['generatedInventory.pathReferences', riskWith((risk) => ({ ...risk, generatedInventory: { ...risk.generatedInventory, pathReferences: oversizedList } }))],
      ['generatedInventory.headings', riskWith((risk) => ({ ...risk, generatedInventory: { ...risk.generatedInventory, headings: oversizedList } }))],
      ['subsystemBreadth.subsystems', riskWith((risk) => ({ ...risk, subsystemBreadth: { ...risk.subsystemBreadth, subsystems: oversizedList } }))],
      ['subsystemBreadth.evidence', riskWith((risk) => ({ ...risk, subsystemBreadth: { ...risk.subsystemBreadth, evidence: oversizedList } }))],
      ['reasons', riskWith((risk) => ({ ...risk, reasons: oversizedList }))],
    ];

    for (const [field, risk] of cases) {
      expect(safeParseEforgeEvent({ type: 'planning:preflight', timestamp, risk }).success, field).toBe(false);
    }
  });

  it('parses provider scope/context failures and rejects unknown recovery actions', () => {
    const failure = {
      source: 'provider',
      failureKind: 'context-length',
      stage: 'planner',
      explanation: 'Provider rejected the prompt as too long.',
      observed: {
        inputTokens: 250000,
        outputTokens: 1000,
        turns: 3,
        promptBytes: 2048,
      },
      recovery: {
        action: 'bounded-decomposition',
        eligible: true,
        attempted: false,
        attempt: 1,
        maxAttempts: 2,
        reason: 'Decompose the oversized compile scope.',
      },
      artifacts: artifactSummary(),
    };

    expect(safeParseEforgeEvent({ type: 'planning:scope-context:failure', timestamp, failure }).success).toBe(true);
    expect(safeParseEforgeEvent({
      type: 'planning:scope-context:failure',
      timestamp,
      failure: { ...failure, recovery: { ...failure.recovery, attempt: 3, maxAttempts: 2 } },
    }).success).toBe(false);
    expect(safeParseEforgeEvent({
      type: 'planning:scope-context:failure',
      timestamp,
      failure: { ...failure, observed: { inputTokens: 250000 } },
    }).success).toBe(true);
    expect(safeParseEforgeEvent({
      type: 'planning:scope-context:failure',
      timestamp,
      failure: { ...failure, recovery: { ...failure.recovery, action: 'mutate-queue' } },
    }).success).toBe(false);
  });

  it('accepts scope/context failures with optional model-aware guard diagnostics and legacy failures without them', () => {
    const baseFailure = {
      source: 'live-context-guard',
      failureKind: 'context-budget',
      stage: 'planner',
      explanation: 'Planner context budget exceeded.',
      observed: { inputTokens: 200000, outputTokens: 1000, turns: 2, promptBytes: 4096 },
      recovery: { action: 'bounded-decomposition', eligible: true, attempted: false, attempt: 0, maxAttempts: 1, reason: 'decompose' },
      artifacts: artifactSummary(),
    };
    const guardDiagnostics = {
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      metadataSource: 'registry',
      contextWindow: 1_000_000,
      outputReserveTokens: 64_000,
      overheadReserveTokens: 8_192,
      safetyMargin: 0.9,
      limits: { maxPromptBytes: 1_500_000, maxObservedInputTokens: 835_027, maxExplanationBytes: 1_500 },
    };

    expect(Value.Check(CompileContextGuardLimitsSchema, guardDiagnostics.limits)).toBe(true);
    expect(Value.Check(CompileContextGuardDiagnosticsSchema, guardDiagnostics)).toBe(true);
    expect(safeParseEforgeEvent({ type: 'planning:scope-context:failure', timestamp, failure: { ...baseFailure, guardDiagnostics } }).success).toBe(true);
    expect(safeParseEforgeEvent({ type: 'planning:scope-context:failure', timestamp, failure: baseFailure }).success).toBe(true);
    expect(safeParseEforgeEvent({ type: 'planning:scope-context:failure', timestamp, failure: { ...baseFailure, guardDiagnostics: { ...guardDiagnostics, safetyMargin: 0 } } }).success).toBe(false);
  });

  // --- eforge:region plan-02-planner-continuation-surfaces ---
  it('parses compact planner inspection summaries and rejects oversized summary arrays', () => {
    const summary = validPlannerInspectionSummary();
    expect(Value.Check(PlannerInspectionSummarySchema, summary)).toBe(true);
    expect(safeParseEforgeEvent({ type: 'planning:inspection-summary', timestamp, summary, artifactPath: '/tmp/handoff.json' }).success).toBe(true);
    expect(safeParseEforgeEvent({ type: 'planning:continuation', timestamp, attempt: 1, maxContinuations: 1, reason: 'compact_inspection' }).success).toBe(true);

    const oversizedFacts = Array.from({ length: MAX_PLANNER_INSPECTION_OBSERVED_FACTS + 1 }, (_, index) => `fact-${index}`);
    expect(safeParseEforgeEvent({
      type: 'planning:inspection-summary',
      timestamp,
      summary: { ...summary, observedFacts: oversizedFacts },
    }).success).toBe(false);
  });
  // --- eforge:endregion plan-02-planner-continuation-surfaces ---

  it('accepts context-window terminal subtypes for compile terminal failures', () => {
    expect(Value.Check(AgentTerminalSubtypeSchema, 'error_context_window')).toBe(true);
    expect(safeParseEforgeEvent({
      type: 'build:terminal-failure',
      timestamp,
      runId: 'run-1',
      failure: {
        scope: 'compile',
        message: 'Compile prompt exceeded the provider context window.',
        authoritative: true,
        terminalSubtype: 'error_context_window',
      },
    }).success).toBe(true);
  });

  it('rejects invalid compile preflight hashes and accepts detected inventory state', () => {
    expect(validRisk().generatedInventory.detected).toBe(true);
    expect(safeParseEforgeEvent({ type: 'planning:preflight', timestamp, risk: validRisk() }).success).toBe(true);
    expect(safeParseEforgeEvent({
      type: 'planning:preflight',
      timestamp,
      risk: riskWith((risk) => ({ ...risk, generatedInventory: { ...risk.generatedInventory, detected: false, blockCount: 0, contentHashes: [] } })),
    }).success).toBe(true);
    expect(safeParseEforgeEvent({
      type: 'planning:preflight',
      timestamp,
      risk: riskWith((risk) => ({ ...risk, generatedInventory: { ...risk.generatedInventory, contentHashes: ['not-a-sha'] } })),
    }).success).toBe(false);
  });

  it('validates bounded diagnostic options and payload hashes', () => {
    const diagnostic = {
      schemaPath: '/plans/0/body',
      expectedType: 'string',
      receivedType: 'object',
      excerpt: '{"body":{}}',
      payloadBytes: 128,
      payloadSha256: 'a'.repeat(64),
      omittedBytes: 0,
      truncated: false,
      message: 'Expected a string body.',
    };

    expect(Value.Check(BoundedDiagnosticOptionsSchema, { maxMessageBytes: 4096, maxExcerptBytes: 256 })).toBe(true);
    expect(Value.Check(BoundedDiagnosticOptionsSchema, { maxMessageBytes: 0, maxExcerptBytes: 256 })).toBe(false);
    expect(Value.Check(BoundedValidationDiagnosticSchema, diagnostic)).toBe(true);
    expect(Value.Check(BoundedValidationDiagnosticSchema, { ...diagnostic, payloadSha256: 'ABC' })).toBe(false);
    expect(Value.Check(BoundedValidationDiagnosticSchema, { ...diagnostic, excerpt: 'x'.repeat(MAX_VALIDATION_DIAGNOSTIC_EXCERPT_LENGTH + 1) })).toBe(false);
    expect(Value.Check(BoundedValidationDiagnosticSchema, { ...diagnostic, message: 'x'.repeat(MAX_VALIDATION_DIAGNOSTIC_MESSAGE_LENGTH + 1) })).toBe(false);
  });

  it('type-checks recovery sidecar options for continue repair and compile guidance', () => {
    const options: RecoverySidecarRecoveryOption[] = [
      { kind: 'continue-repair', action: 'continue-repair', recommended: true, reason: 'Artifacts are available.' },
      {
        kind: 'compile-scope-context',
        action: 'manual-reduce-scope',
        recommended: false,
        eligible: true,
        reason: 'Reduce the PRD scope before retrying compile.',
        source: 'provider',
        failureKind: 'context-window',
        attempted: true,
        attempt: 1,
        maxAttempts: 2,
      },
    ];

    expect(options).toHaveLength(2);
    expect(Value.Check(RecoverySidecarCompileScopeContextOptionSchema, options[1])).toBe(true);
    expect(Value.Check(RecoverySidecarCompileScopeContextOptionSchema, { ...options[1], reason: 'é'.repeat(RECOVERY_SIDECAR_COMPILE_SCOPE_CONTEXT_REASON_MAX_BYTES) })).toBe(false);
  });

  it('bounds artifact summary representative plan-file arrays while preserving count fields', () => {
    const tooManyFiles = Array.from({ length: MAX_COMPILE_RISK_LIST_ITEMS + 1 }, (_, index) => `plan-${index}.md`);
    const summary = { ...artifactSummary(), missingPlanFileCount: 100, missingPlanFiles: tooManyFiles };

    expect(Value.Check(CompileArtifactSummarySchema, { ...summary, missingPlanFiles: tooManyFiles.slice(0, MAX_COMPILE_RISK_LIST_ITEMS) })).toBe(true);
    expect(Value.Check(CompileArtifactSummarySchema, summary)).toBe(false);
    expect(Value.Check(CompileArtifactSummarySchema, { ...artifactSummary(), invalidPlanFiles: tooManyFiles })).toBe(false);
  });

  it('registers concise event metadata and summaries', () => {
    expect(eventRegistry['planning:preflight']).toMatchObject({ scope: 'session', persist: false });
    expect(eventRegistry['planning:scope-context:failure']).toMatchObject({ scope: 'session', persist: true });
    // --- eforge:region plan-02-planner-continuation-surfaces ---
    expect(eventRegistry['planning:inspection-summary']).toMatchObject({ scope: 'session', persist: true });
    // --- eforge:endregion plan-02-planner-continuation-surfaces ---

    const preflightSummary = getEventSummary({ type: 'planning:preflight', timestamp, risk: validRisk() });
    const failureSummary = getEventSummary({
      type: 'planning:scope-context:failure',
      timestamp,
      failure: {
        source: 'provider',
        failureKind: 'context-window',
        stage: 'compile',
        explanation: 'too broad',
        recovery: { action: 'retry-as-expedition', eligible: true, attempted: false, attempt: 1, maxAttempts: 2, reason: 'retry wider pipeline' },
        artifacts: artifactSummary(),
      },
    });

    // --- eforge:region plan-02-planner-continuation-surfaces ---
    const inspectionSummary = getEventSummary({ type: 'planning:inspection-summary', timestamp, summary: validPlannerInspectionSummary() });
    // --- eforge:endregion plan-02-planner-continuation-surfaces ---

    expect(preflightSummary).toContain('elevated');
    expect(preflightSummary).not.toContain('docs/prd.md');
    expect(failureSummary).toContain('context-window');
    expect(failureSummary).not.toContain('too broad');
    // --- eforge:region plan-02-planner-continuation-surfaces ---
    expect(inspectionSummary).toContain('Planner compact inspection summary');
    expect(inspectionSummary).not.toContain('Queue cleanup');
    // --- eforge:endregion plan-02-planner-continuation-surfaces ---
  });

  it('exports schemas and constants from public client barrels', () => {
    for (const facade of [client, events, browser]) {
      expect(facade.MAX_COMPILE_RISK_LIST_ITEMS).toBe(MAX_COMPILE_RISK_LIST_ITEMS);
      expect(facade.CompilePreflightRiskSchema).toBeDefined();
      expect(facade.CompileScopeContextFailureSchema).toBeDefined();
      expect(facade.CompileContextGuardDiagnosticsSchema).toBeDefined();
      expect(facade.CompileContextGuardLimitsSchema).toBeDefined();
      expect(facade.BoundedValidationDiagnosticSchema).toBeDefined();
      // --- eforge:region plan-02-planner-continuation-surfaces ---
      expect(facade.PlannerInspectionSummarySchema).toBeDefined();
      expect(facade.MAX_PLANNER_INSPECTION_OBSERVED_FACTS).toBe(MAX_PLANNER_INSPECTION_OBSERVED_FACTS);
      // --- eforge:endregion plan-02-planner-continuation-surfaces ---
    }
  });
});
