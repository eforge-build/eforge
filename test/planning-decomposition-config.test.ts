import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as engineEventsFacade from '../packages/engine/src/events.js';
import {
  configYamlSchema,
  DEFAULT_CONFIG,
  mergePartialConfigs,
  resolveConfig,
  resolvePlanningDecompositionLimits,
} from '../packages/engine/src/config.js';

const expectedDefaults = {
  parallelism: 2,
  maxDepth: 3,
  maxPromptSourceBytes: 40000,
  maxPromptBytes: 80000,
  maxObservedInputTokens: 120000,
  maxCompactHandoffBytes: 12000,
  maxLocalExplorationToolUses: 24,
  maxCriteriaPerUnit: 20,
  maxSubsystemsPerUnit: 2,
  maxSplitAttemptsPerUnit: 2,
};

const compileIntegerKeys = [
  'planningUnitParallelism',
  'planningUnitMaxDepth',
  'planningUnitMaxPromptSourceBytes',
  'planningUnitMaxPromptBytes',
  'planningUnitMaxObservedInputTokens',
  'planningUnitMaxObservedTurns',
  'planningUnitMaxCompactHandoffBytes',
  'planningUnitMaxLocalExplorationToolUses',
  'planningUnitMaxCriteriaPerUnit',
  'planningUnitMaxSubsystemsPerUnit',
  'planningUnitMaxSplitAttemptsPerUnit',
] as const;

describe('planning decomposition compile config', () => {
  it('resolves defaults and freezes the compile section', () => {
    const config = resolveConfig({});
    expect(config.compile.planningUnitParallelism).toBe(2);
    expect(config.compile).toEqual(DEFAULT_CONFIG.compile);
    expect(Object.isFrozen(config.compile)).toBe(true);
    expect(resolvePlanningDecompositionLimits(config)).toEqual(expectedDefaults);
  });

  it('accepts overrides and maps them to client-owned limits', () => {
    const config = resolveConfig({ compile: { planningUnitParallelism: 4, planningUnitMaxDepth: 5, planningUnitMaxObservedTurns: 7 } });
    expect(resolvePlanningDecompositionLimits(config)).toEqual({ ...expectedDefaults, parallelism: 4, maxDepth: 5, maxObservedTurns: 7 });
  });

  it('rejects zero, negative, and fractional compile integers for every planning limit', () => {
    for (const key of compileIntegerKeys) {
      expect(configYamlSchema.safeParse({ compile: { [key]: 0 } }).success, `${key} rejects zero`).toBe(false);
      expect(configYamlSchema.safeParse({ compile: { [key]: -1 } }).success, `${key} rejects negative values`).toBe(false);
      expect(configYamlSchema.safeParse({ compile: { [key]: 1.5 } }).success, `${key} rejects fractions`).toBe(false);
    }
  });

  it('shallow-merges layered compile partials with project precedence', () => {
    expect(mergePartialConfigs(
      { compile: { planningUnitParallelism: 3, planningUnitMaxPromptBytes: 60000 } },
      { compile: { planningUnitMaxDepth: 5, planningUnitParallelism: 4 } },
    ).compile).toEqual({ planningUnitParallelism: 4, planningUnitMaxPromptBytes: 60000, planningUnitMaxDepth: 5 });
  });

  it('exports decomposition contracts through the engine event facade', () => {
    expect(engineEventsFacade.PlanningDecompositionLimitsSchema).toBeDefined();
    expect(engineEventsFacade.DecompositionFailureEvidenceSchema).toBeDefined();
    expect(engineEventsFacade.PlanningUnresolvedCriterionSchema).toBeDefined();
    expect(engineEventsFacade.PlanningUnitConstraintSchema).toBeDefined();
    expect(engineEventsFacade.PlanningScheduleBlockedPairSchema).toBeDefined();
    expect(engineEventsFacade.PlanningSplitAttemptEvidenceSchema).toBeDefined();
    expect(engineEventsFacade.PLANNING_DECOMPOSITION_EVENT_TYPES).toContain('planning:decomposition:synthesis:complete');
    expect(engineEventsFacade.PLANNING_DECOMPOSITION_MAX_STRING_LENGTH).toBeGreaterThan(0);
    expect(engineEventsFacade.PLANNING_DECOMPOSITION_MAX_SOURCE_SLICES).toBeGreaterThan(0);
    expect(engineEventsFacade.PLANNING_DECOMPOSITION_MAX_CRITERIA).toBeGreaterThan(0);
    expect(engineEventsFacade.PLANNING_DECOMPOSITION_MAX_UNRESOLVED_CRITERIA).toBeGreaterThan(0);
    expect(engineEventsFacade.PLANNING_DECOMPOSITION_MAX_DEPENDENCIES).toBeGreaterThan(0);
    expect(engineEventsFacade.PLANNING_DECOMPOSITION_MAX_BLOCKED_PAIRS).toBeGreaterThan(0);
  });

  it('keeps generated public schemas in sync with compile and decomposition contracts', () => {
    const configSchema = readGeneratedSchema('config.schema.json');
    const eventsSchema = readGeneratedSchema('events.schema.json');

    expect(JSON.stringify(configSchema)).toContain('planningUnitParallelism');
    expect(JSON.stringify(configSchema)).toContain('planningUnitMaxPromptSourceBytes');
    expect(JSON.stringify(eventsSchema)).toContain('planning:decomposition:synthesis:complete');
    expect(JSON.stringify(eventsSchema)).toContain('planning:decomposition:unit:progress');
  });
});

function readGeneratedSchema(fileName: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), 'web/public/schemas', fileName), 'utf8')) as unknown;
}
