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
  MAX_COMPILE_RISK_LIST_ITEMS,
  MAX_VALIDATION_DIAGNOSTIC_EXCERPT_LENGTH,
  MAX_VALIDATION_DIAGNOSTIC_MESSAGE_LENGTH,
  safeParseEforgeEvent,
  type CompilePreflightRisk,
} from '../events.js';
import type { RecoverySidecarRecoveryOption } from '../routes.js';

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
      failure: { ...failure, observed: { inputTokens: 250000 } },
    }).success).toBe(true);
    expect(safeParseEforgeEvent({
      type: 'planning:scope-context:failure',
      timestamp,
      failure: { ...failure, recovery: { ...failure.recovery, action: 'mutate-queue' } },
    }).success).toBe(false);
  });

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

    expect(preflightSummary).toContain('elevated');
    expect(preflightSummary).not.toContain('docs/prd.md');
    expect(failureSummary).toContain('context-window');
    expect(failureSummary).not.toContain('too broad');
  });

  it('exports schemas and constants from public client barrels', () => {
    for (const facade of [client, events, browser]) {
      expect(facade.MAX_COMPILE_RISK_LIST_ITEMS).toBe(MAX_COMPILE_RISK_LIST_ITEMS);
      expect(facade.CompilePreflightRiskSchema).toBeDefined();
      expect(facade.CompileScopeContextFailureSchema).toBeDefined();
      expect(facade.BoundedValidationDiagnosticSchema).toBeDefined();
    }
  });
});
