import { describe, expect, it } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import * as browserFacade from '../browser.js';
import * as eventsFacade from '../events.js';
import * as mainFacade from '../index.js';
import { eventRegistry } from '../event-registry.js';
import {
  CompileScopeContextFailureSchema,
  DecompositionFailureEvidenceSchema,
  PLANNING_DECOMPOSITION_EVENT_TYPES,
  PlanningDecompositionLimitsSchema,
  PlanningDecompositionUnitSummarySchema,
  PlanningScheduleBlockedPairSchema,
  PlanningSourceSliceSummarySchema,
  PlanningSplitAttemptEvidenceSchema,
  PlanningUnitConstraintSchema,
  PlanningUnresolvedCriterionSchema,
  PLANNING_DECOMPOSITION_MAX_BLOCKED_PAIRS,
  PLANNING_DECOMPOSITION_MAX_CRITERIA,
  PLANNING_DECOMPOSITION_MAX_DEPENDENCIES,
  PLANNING_DECOMPOSITION_MAX_LIST_ITEMS,
  PLANNING_DECOMPOSITION_MAX_SOURCE_SLICES,
  PLANNING_DECOMPOSITION_MAX_SPLIT_ATTEMPTS,
  PLANNING_DECOMPOSITION_MAX_STRING_LENGTH,
  PLANNING_DECOMPOSITION_MAX_UNITS,
  PLANNING_DECOMPOSITION_MAX_UNRESOLVED_CRITERIA,
  safeParseEforgeEvent,
} from '../events.schemas.js';
import { RecoverySidecarCompileScopeContextOptionSchema } from '../routes.js';

const timestamp = '2025-01-01T00:00:00.000Z';
const hash = 'b'.repeat(64);
const limits = { parallelism: 2, maxDepth: 3, maxPromptSourceBytes: 40000, maxPromptBytes: 80000, maxObservedInputTokens: 120000, maxCompactHandoffBytes: 12000, maxLocalExplorationToolUses: 24, maxCriteriaPerUnit: 20, maxSubsystemsPerUnit: 2, maxSplitAttemptsPerUnit: 2 };
const budget = { maxRecursiveDepth: 3, maxPromptSourceBytes: 40000, maxPromptBytes: 80000, maxObservedInputTokens: 120000, maxCompactHandoffBytes: 12000, maxLocalExplorationToolUses: 24, maxCriteriaPerUnit: 20, maxSubsystemsPerUnit: 2, maxSplitAttemptsPerUnit: 2 };
const observed = { promptSourceBytes: 1, promptBytes: 2, observedInputTokens: 3, observedTurns: 1, compactHandoffBytes: 4, localExplorationToolUses: 1, criteriaCount: 1, subsystemCount: 1, splitAttempts: 1, triggeredLimitKeys: [] };
const coverage = { coveredCriteria: [{ criterionId: 'AC-1', sourceHash: hash, coveredByUnitIds: ['unit-1'] }], unresolvedCriteria: [] };
const unit = { unitId: 'unit-1', depth: 0, sourceSlices: [{ kind: 'prd', sourceHash: hash, criteriaIds: ['AC-1'], byteLength: 100 }], coverage, subsystemHints: ['engine'], dependencies: [], interfaceConstraints: [], sharedFileConstraints: [], budgets: budget, status: 'queued' };
const evidence = { unitId: 'unit-1', depth: 0, budgets: budget, observed, assignedCriteriaIds: ['AC-1'], unresolvedCriteria: [], blockers: [], splitAttempts: [{ attempt: 1, reason: 'split', resultingUnitIds: ['unit-2'] }] };

const events = [
  { type: 'planning:decomposition:start', limits },
  { type: 'planning:decomposition:unit:queued', unit },
  { type: 'planning:decomposition:unit:running', unitId: 'unit-1' },
  { type: 'planning:decomposition:unit:progress', unitId: 'unit-1', message: 'working', observed },
  { type: 'planning:decomposition:unit:completed', unit: { ...unit, status: 'completed' } },
  { type: 'planning:decomposition:unit:skipped', unitId: 'unit-1', reason: 'duplicate' },
  { type: 'planning:decomposition:unit:failed', unitId: 'unit-1', reason: 'exhausted', evidence },
  { type: 'planning:decomposition:schedule', decision: { readyUnitIds: ['unit-1'], runningUnitIds: [], waitingUnitIds: [], selectedBatchUnitIds: ['unit-1'], parallelism: 2, blockedPairs: [] } },
  { type: 'planning:decomposition:budget', limits, unitBudgets: [budget], observed },
  { type: 'planning:decomposition:compact-handoff', byteLength: 100, contentHash: hash, omittedUnitIds: [] },
  { type: 'planning:decomposition:synthesis:complete', unitCount: 1, coverage, artifactPaths: ['plans.md'] },
];

describe('planning decomposition event contracts', () => {
  it('accepts all decomposition event variants', () => {
    expect(events.map((event) => event.type)).toEqual([...PLANNING_DECOMPOSITION_EVENT_TYPES]);
    for (const event of events) expect(safeParseEforgeEvent({ timestamp, ...event }).success, event.type).toBe(true);
  });

  it('rejects malformed bounds, statuses, source hashes, and missing required fields', () => {
    expect(Value.Check(PlanningDecompositionLimitsSchema, { ...limits, parallelism: 0 })).toBe(false);
    expect(Value.Check(PlanningDecompositionUnitSummarySchema, { ...unit, status: 'paused' })).toBe(false);
    expect(Value.Check(PlanningSourceSliceSummarySchema, { ...unit.sourceSlices[0], sourceHash: 'not-a-sha' })).toBe(false);
    expect(safeParseEforgeEvent({ timestamp, type: 'planning:decomposition:unit:running' }).success).toBe(false);
    expect(Value.Check(PlanningDecompositionUnitSummarySchema, {
      ...unit,
      subsystemHints: Array.from({ length: PLANNING_DECOMPOSITION_MAX_LIST_ITEMS + 1 }, (_, index) => `subsystem-${index}`),
    })).toBe(false);
  });

  it('rejects top-level and nested raw source, prompt, and transcript fields', () => {
    const topLevel = safeParseEforgeEvent({ timestamp, type: 'planning:decomposition:unit:running', unitId: 'unit-1', transcript: 'raw' });
    expect(topLevel.success).toBe(false);
    if (!topLevel.success) expect(topLevel.error.errors[0]?.path).toBe('/transcript');

    const rawPrompt = safeParseEforgeEvent({
      timestamp,
      type: 'planning:decomposition:unit:queued',
      unit: { ...unit, sourceSlices: [{ ...unit.sourceSlices[0], rawPrompt: 'raw prompt' }] },
    });
    expect(rawPrompt.success).toBe(false);
    if (!rawPrompt.success) expect(rawPrompt.error.errors[0]?.path).toBe('/unit/sourceSlices/0/rawPrompt');

    const sourceText = safeParseEforgeEvent({
      timestamp,
      type: 'planning:decomposition:unit:queued',
      unit: { ...unit, sourceSlices: [{ ...unit.sourceSlices[0], sourceText: 'raw source' }] },
    });
    expect(sourceText.success).toBe(false);
    if (!sourceText.success) expect(sourceText.error.errors[0]?.path).toBe('/unit/sourceSlices/0/sourceText');

    for (const field of ['rawSourceContent', 'promptSource', 'transcriptMessages']) {
      const result = safeParseEforgeEvent({ timestamp, type: 'planning:decomposition:unit:running', unitId: 'unit-1', [field]: 'raw' });
      expect(result.success, field).toBe(false);
      if (!result.success) expect(result.error.errors[0]?.path).toBe(`/${field}`);
    }

    expect(safeParseEforgeEvent({ timestamp, type: 'planning:decomposition:budget', limits, unitBudgets: [budget], observed: { ...observed, promptBytes: 10, promptSourceBytes: 20 } }).success).toBe(true);
  });

  it('rejects schedule batches larger than the advertised parallelism', () => {
    const result = safeParseEforgeEvent({
      timestamp,
      type: 'planning:decomposition:schedule',
      decision: { readyUnitIds: ['unit-1', 'unit-2'], runningUnitIds: [], waitingUnitIds: [], selectedBatchUnitIds: ['unit-1', 'unit-2'], parallelism: 1, blockedPairs: [] },
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.errors[0]?.path).toBe('/decision/selectedBatchUnitIds');
  });

  it('rejects unit lifecycle events with mismatched unit statuses or identifiers', () => {
    expect(safeParseEforgeEvent({ timestamp, type: 'planning:decomposition:unit:queued', unit: { ...unit, status: 'completed' } }).success).toBe(false);
    expect(safeParseEforgeEvent({ timestamp, type: 'planning:decomposition:unit:completed', unit }).success).toBe(false);
    expect(safeParseEforgeEvent({ timestamp, type: 'planning:decomposition:unit:skipped', unitId: 'unit-1', reason: 'duplicate', unit }).success).toBe(false);

    const failed = safeParseEforgeEvent({ timestamp, type: 'planning:decomposition:unit:failed', unitId: 'unit-1', reason: 'exhausted', evidence: { ...evidence, unitId: 'unit-2' } });
    expect(failed.success).toBe(false);
    if (!failed.success) expect(failed.error.errors[0]?.path).toBe('/evidence/unitId');

    const skipped = safeParseEforgeEvent({ timestamp, type: 'planning:decomposition:unit:skipped', unitId: 'unit-2', reason: 'duplicate', unit: { ...unit, status: 'skipped' } });
    expect(skipped.success).toBe(false);
    if (!skipped.success) expect(skipped.error.errors[0]?.path).toBe('/unit/unitId');
  });

  it('extends scope-context failure and recovery option evidence', () => {
    const failure = { source: 'decomposition', failureKind: 'decomposition-exhausted', stage: 'planning-decomposition', explanation: 'exhausted', decompositionEvidence: evidence, recovery: { action: 'bounded-decomposition', eligible: false, attempted: true, attempt: 1, maxAttempts: 1, reason: 'exhausted' }, artifacts: { orchestrationExists: false, validPlanCount: 0, invalidPlanCount: 0, missingPlanFileCount: 0, missingPlanFiles: [], invalidPlanFiles: [] } };
    const option = { kind: 'compile-scope-context', action: 'bounded-decomposition', recommended: true, eligible: false, reason: 'exhausted', attempted: true, attempt: 1, maxAttempts: 1, source: 'decomposition', failureKind: 'decomposition-exhausted', decompositionEvidence: evidence };
    expect(Value.Check(CompileScopeContextFailureSchema, failure)).toBe(true);
    expect(Value.Check(RecoverySidecarCompileScopeContextOptionSchema, option)).toBe(true);
    expect(Value.Check(DecompositionFailureEvidenceSchema, { ...evidence, splitAttempts: [{ attempt: 0, reason: 'bad', resultingUnitIds: [] }] })).toBe(false);
    expect(Value.Check(DecompositionFailureEvidenceSchema, { ...evidence, transcript: 'raw transcript' })).toBe(false);
    expect(safeParseEforgeEvent({ timestamp, type: 'planning:scope-context:failure', failure: { ...failure, decompositionEvidence: { ...evidence, rawSourceContent: 'raw source' } } }).success).toBe(false);
    expect(Value.Check(RecoverySidecarCompileScopeContextOptionSchema, { ...option, decompositionEvidence: { ...evidence, prompt: 'raw prompt' } })).toBe(false);
  });

  it('registers persistence metadata and public exports', () => {
    expect(eventRegistry['planning:decomposition:unit:progress']).toMatchObject({ scope: 'session', persist: false });
    for (const type of PLANNING_DECOMPOSITION_EVENT_TYPES.filter((type) => type !== 'planning:decomposition:unit:progress')) {
      expect(eventRegistry[type]).toMatchObject({ scope: 'session', persist: true });
    }
    const expectedExports = {
      PlanningDecompositionLimitsSchema,
      PlanningUnresolvedCriterionSchema,
      PlanningUnitConstraintSchema,
      PlanningScheduleBlockedPairSchema,
      PlanningSplitAttemptEvidenceSchema,
      PLANNING_DECOMPOSITION_EVENT_TYPES,
      PLANNING_DECOMPOSITION_MAX_STRING_LENGTH,
      PLANNING_DECOMPOSITION_MAX_LIST_ITEMS,
      PLANNING_DECOMPOSITION_MAX_SOURCE_SLICES,
      PLANNING_DECOMPOSITION_MAX_CRITERIA,
      PLANNING_DECOMPOSITION_MAX_UNRESOLVED_CRITERIA,
      PLANNING_DECOMPOSITION_MAX_UNITS,
      PLANNING_DECOMPOSITION_MAX_DEPENDENCIES,
      PLANNING_DECOMPOSITION_MAX_BLOCKED_PAIRS,
      PLANNING_DECOMPOSITION_MAX_SPLIT_ATTEMPTS,
    };
    for (const [key, value] of Object.entries(expectedExports)) {
      expect(mainFacade[key as keyof typeof mainFacade]).toEqual(value);
      expect(eventsFacade[key as keyof typeof eventsFacade]).toEqual(value);
      expect(browserFacade[key as keyof typeof browserFacade]).toEqual(value);
    }
  });
});
