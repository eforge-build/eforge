import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as engineEventsFacade from '../packages/engine/src/events.js';
import {
  ConfigValidationError,
  configYamlSchema,
  DEFAULT_CONFIG,
  loadConfig,
  mergePartialConfigs,
  parseRawConfig,
  resolveConfig,
  resolvePlanningDecompositionLimits,
  resolveSharedPlanningBriefLimits,
  PLANNING_DECOMPOSITION_CONFIG_MAXIMA,
} from '../packages/engine/src/config.js';
import {
  DEFAULT_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS,
  MAX_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS,
  MIN_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS,
  resolveDirectPrBaseSyncConflictAttempts,
} from '../packages/engine/src/direct-pr-base-sync.js';

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
  'planningSharedBriefMaxTotalBytes',
  'planningSharedBriefMaxSectionBytes',
  'planningSharedBriefMaxSectionsPerAtom',
  'directPrBaseSyncConflictAttempts',
] as const;

describe('planning decomposition compile config', () => {
  it('resolves defaults and freezes the compile section', () => {
    const config = resolveConfig({});
    expect(config.compile.planningUnitParallelism).toBe(2);
    expect(config.compile.directPrBaseSyncConflictAttempts).toBe(DEFAULT_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS);
    expect(config.landing.directPrBaseSync.conflictAttempts).toBe(DEFAULT_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS);
    expect(config.compile).toEqual(DEFAULT_CONFIG.compile);
    expect(Object.isFrozen(config.compile)).toBe(true);
    expect(resolvePlanningDecompositionLimits(config)).toEqual(expectedDefaults);
  });

  it('accepts overrides and maps them to client-owned limits', () => {
    const config = resolveConfig({ compile: { planningUnitParallelism: 4, planningUnitMaxDepth: 5, planningUnitMaxObservedTurns: 7, directPrBaseSyncConflictAttempts: 4 } });
    expect(resolvePlanningDecompositionLimits(config)).toEqual({ ...expectedDefaults, parallelism: 4, maxDepth: 5, maxObservedTurns: 7 });
    expect(config.compile.directPrBaseSyncConflictAttempts).toBe(4);
  });

  it('loads direct PR base-sync defaults from a temp project when compile config is absent', async () => {
    await withIsolatedProjectConfig('build:\n  maxValidationRetries: 0\n', async (projectDir) => {
      const { config } = await loadConfig(projectDir);
      expect(config.compile.directPrBaseSyncConflictAttempts).toBe(DEFAULT_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS);
      expect(config.compile.planningUnitParallelism).toBe(DEFAULT_CONFIG.compile.planningUnitParallelism);
    });
  });

  it('loads explicit temp project compile values and clamps the direct PR base-sync budget', async () => {
    await withIsolatedProjectConfig('compile:\n  planningUnitParallelism: 4\n  directPrBaseSyncConflictAttempts: 150\n', async (projectDir) => {
      const { config } = await loadConfig(projectDir);
      expect(config.compile.planningUnitParallelism).toBe(4);
      expect(config.compile.directPrBaseSyncConflictAttempts).toBe(MAX_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS);
      expect(config.landing.directPrBaseSync.conflictAttempts).toBe(MAX_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS);
    });
  });

  it('loads and clamps the primary landing direct PR base-sync budget', async () => {
    expect(resolveConfig({ landing: { directPrBaseSync: { conflictAttempts: 5 } } }).landing.directPrBaseSync.conflictAttempts).toBe(5);
    expect(resolveConfig({ landing: { directPrBaseSync: { conflictAttempts: 150 } } }).landing.directPrBaseSync.conflictAttempts).toBe(MAX_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS);

    await withIsolatedProjectConfig('landing:\n  directPrBaseSync:\n    conflictAttempts: 6\n', async (projectDir) => {
      const { config } = await loadConfig(projectDir);
      expect(config.landing.directPrBaseSync.conflictAttempts).toBe(6);
    });
  });

  it('resolves shared-brief budgets from config with tunable overrides', () => {
    expect(resolveSharedPlanningBriefLimits(resolveConfig({}))).toEqual({ maxTotalBriefBytes: 12000, maxSectionBytes: 1500, maxSectionsPerAtom: 8 });
    expect(resolveSharedPlanningBriefLimits(resolveConfig({ compile: { planningSharedBriefMaxTotalBytes: 24000, planningSharedBriefMaxSectionsPerAtom: 12 } }))).toEqual({ maxTotalBriefBytes: 24000, maxSectionBytes: 1500, maxSectionsPerAtom: 12 });
  });

  it('rejects zero, negative, and fractional compile integers for every planning limit', () => {
    for (const key of compileIntegerKeys) {
      expect(configYamlSchema.safeParse({ compile: { [key]: 0 } }).success, `${key} rejects zero`).toBe(false);
      expect(configYamlSchema.safeParse({ compile: { [key]: -1 } }).success, `${key} rejects negative values`).toBe(false);
      expect(configYamlSchema.safeParse({ compile: { [key]: 1.5 } }).success, `${key} rejects fractions`).toBe(false);
    }
  });

  it('reports invalid direct PR base-sync config paths and integer constraints while loading config', async () => {
    for (const value of [0, -1, 1.5]) {
      expect(() => parseRawConfig({ compile: { directPrBaseSyncConflictAttempts: value } })).toThrow(ConfigValidationError);
      expect(() => parseRawConfig({ compile: { directPrBaseSyncConflictAttempts: value } })).toThrow(/compile\.directPrBaseSyncConflictAttempts/);
      expect(() => parseRawConfig({ compile: { directPrBaseSyncConflictAttempts: value } })).toThrow(value === 1.5 ? /expected int/ : /Too small/);
      expect(() => parseRawConfig({ landing: { directPrBaseSync: { conflictAttempts: value } } })).toThrow(ConfigValidationError);
      expect(() => parseRawConfig({ landing: { directPrBaseSync: { conflictAttempts: value } } })).toThrow(/landing\.directPrBaseSync\.conflictAttempts/);
      expect(() => parseRawConfig({ landing: { directPrBaseSync: { conflictAttempts: value } } })).toThrow(value === 1.5 ? /expected int/ : /Too small/);
    }

    await withIsolatedProjectConfig('compile:\n  directPrBaseSyncConflictAttempts: 1.5\n', async (projectDir) => {
      await expect(loadConfig(projectDir)).rejects.toThrow(ConfigValidationError);
      await expect(loadConfig(projectDir)).rejects.toThrow(/compile\.directPrBaseSyncConflictAttempts/);
      await expect(loadConfig(projectDir)).rejects.toThrow(/expected int/);
    });
  });

  it('rejects compile integers above operational maxima except clamped direct base-sync attempts', () => {
    for (const key of compileIntegerKeys) {
      if (key === 'directPrBaseSyncConflictAttempts') continue;
      expect(configYamlSchema.safeParse({ compile: { [key]: PLANNING_DECOMPOSITION_CONFIG_MAXIMA[key] + 1 } }).success, `${key} rejects oversized values`).toBe(false);
    }
    expect(configYamlSchema.safeParse({ compile: { directPrBaseSyncConflictAttempts: MAX_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS + 1 } }).success).toBe(true);
    expect(configYamlSchema.safeParse({ landing: { directPrBaseSync: { conflictAttempts: MAX_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS + 1 } } }).success).toBe(true);
    expect(resolveConfig({ compile: { directPrBaseSyncConflictAttempts: MAX_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS + 1 } }).compile.directPrBaseSyncConflictAttempts).toBe(MAX_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS);
    expect(resolveConfig({ landing: { directPrBaseSync: { conflictAttempts: MAX_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS + 1 } } }).landing.directPrBaseSync.conflictAttempts).toBe(MAX_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS);
  });

  it('shallow-merges layered compile partials with project precedence', () => {
    expect(mergePartialConfigs(
      { compile: { planningUnitParallelism: 3, planningUnitMaxPromptBytes: 60000, directPrBaseSyncConflictAttempts: 6 } },
      { compile: { planningUnitMaxDepth: 5, planningUnitParallelism: 4 } },
    ).compile).toEqual({ planningUnitParallelism: 4, planningUnitMaxPromptBytes: 60000, directPrBaseSyncConflictAttempts: 6, planningUnitMaxDepth: 5 });
  });

  it('resolves direct PR base-sync conflict attempts with override precedence and clamping', () => {
    expect(resolveDirectPrBaseSyncConflictAttempts()).toBe(DEFAULT_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS);
    expect(resolveDirectPrBaseSyncConflictAttempts(7)).toBe(7);
    expect(resolveDirectPrBaseSyncConflictAttempts(7, 4)).toBe(4);
    expect(() => resolveDirectPrBaseSyncConflictAttempts(7, 1.5)).toThrow(/landing\.directPrBaseSync\.conflictAttempts must be a finite integer/);
    expect(() => resolveDirectPrBaseSyncConflictAttempts(7, Number.NaN)).toThrow(/landing\.directPrBaseSync\.conflictAttempts must be a finite integer/);
    expect(resolveDirectPrBaseSyncConflictAttempts(MAX_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS + 10, 4)).toBe(4);
    expect(resolveDirectPrBaseSyncConflictAttempts(7, 0)).toBe(MIN_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS);
    expect(resolveDirectPrBaseSyncConflictAttempts(7, MAX_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS + 10)).toBe(MAX_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS);
    expect(resolveDirectPrBaseSyncConflictAttempts(MIN_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS)).toBe(MIN_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS);
    expect(resolveDirectPrBaseSyncConflictAttempts(MAX_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS)).toBe(MAX_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS);
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
    const directPrConflictAttemptsSchema = (configSchema as {
      properties?: { compile?: { properties?: Record<string, unknown> }; landing?: { properties?: { directPrBaseSync?: { properties?: Record<string, unknown> } } } };
    }).properties?.compile?.properties?.directPrBaseSyncConflictAttempts as
      | { type?: unknown; exclusiveMinimum?: unknown; maximum?: unknown; description?: unknown }
      | undefined;
    const landingDirectPrConflictAttemptsSchema = (configSchema as {
      properties?: { landing?: { properties?: { directPrBaseSync?: { properties?: Record<string, unknown> } } } };
    }).properties?.landing?.properties?.directPrBaseSync?.properties?.conflictAttempts as
      | { type?: unknown; exclusiveMinimum?: unknown; description?: unknown }
      | undefined;
    expect(directPrConflictAttemptsSchema).toMatchObject({
      type: 'integer',
      exclusiveMinimum: 0,
      description: expect.stringContaining('Compatibility fallback'),
    });
    expect(landingDirectPrConflictAttemptsSchema).toMatchObject({
      type: 'integer',
      exclusiveMinimum: 0,
      description: expect.stringContaining('clamped'),
    });
    expect(typeof directPrConflictAttemptsSchema?.maximum).toBe('number');
    expect(directPrConflictAttemptsSchema?.maximum).toBeGreaterThanOrEqual(MAX_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS);
    expect(JSON.stringify(eventsSchema)).toContain('planning:decomposition:synthesis:complete');
    expect(JSON.stringify(eventsSchema)).toContain('planning:decomposition:unit:progress');
  });
});

async function withIsolatedProjectConfig(configYaml: string, run: (projectDir: string) => Promise<void>): Promise<void> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'eforge-direct-base-sync-config-'));
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = join(tmpDir, 'xdg');
  try {
    const projectDir = join(tmpDir, 'project');
    await mkdir(join(projectDir, 'eforge'), { recursive: true });
    await writeFile(join(projectDir, 'eforge', 'config.yaml'), configYaml, 'utf8');
    await run(projectDir);
  } finally {
    if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    await rm(tmpDir, { recursive: true, force: true });
  }
}

function readGeneratedSchema(fileName: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), 'web/public/schemas', fileName), 'utf8')) as unknown;
}
