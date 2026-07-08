import { readFile, readdir, rename, rm, unlink, writeFile, mkdir, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname, basename, extname, join as pathJoin } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
const execFileAsync = promisify(execFile);
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod/v4';
import { sanitizeProfileName, parseRawConfigLegacy, REVIEW_PERSPECTIVES } from '@eforge-build/client';
import type { ReviewProfileConfig, BuildStageSpec } from '@eforge-build/client';
import type { AgentRole } from './events.js';
import type { ShardScope } from './schemas.js';
import { overlayEffectiveAgentRecipe, type EffectiveAgentRecipe } from './pipeline/runtime-choice.js';
import { resolveNamedSet, resolveLayeredSingletons, getScopeDirectory, userEforgeConfigDir } from '@eforge-build/scopes';
import { DEFAULT_NATIVE_EVENT_HOOK_TIMEOUT_MS } from './extensions/event-runtime.js';
import { DEFAULT_PLANNING_DECOMPOSITION_CONFIG, PLANNING_DECOMPOSITION_CONFIG_MAXIMA } from './compile-resilience/planning-decomposition-limits.js';
import { resolveDirectPrBaseSyncConflictAttempts } from './direct-pr-base-sync.js';
import type { PlanningDecompositionConfig } from './compile-resilience/planning-decomposition-limits.js';
export { DEFAULT_NATIVE_EVENT_HOOK_TIMEOUT_MS };
export { ADAPTIVE_RESCOPE_LIMITS_MAXIMA, DEFAULT_ADAPTIVE_RESCOPE_LIMITS, DEFAULT_PLANNING_DECOMPOSITION_CONFIG, PLANNING_DECOMPOSITION_CONFIG_MAXIMA, resolveAdaptiveRescopeLimits, resolvePlanningDecompositionLimits, resolveSharedPlanningBriefLimits, type AdaptiveRescopeLimits } from './compile-resilience/planning-decomposition-limits.js';
export type { PlanningDecompositionConfig } from './compile-resilience/planning-decomposition-limits.js';
export type { ShardScope } from './schemas.js';
// Re-export shared types from @eforge-build/client so engine-internal callers
// (plan.ts, eforge.ts, pipeline.ts, compiler.ts, events.ts, agents/*) can keep
// importing from this module. The client package is the single owner.
export type { ReviewProfileConfig, BuildStageSpec } from '@eforge-build/client';
// Zod Schemas — single source of truth for config types
/** Agent roles matching the AgentRole union in events.ts. */
export const AGENT_ROLES = [
  'planner', 'builder', 'reviewer', 'review-fixer', 'evaluator', 'plan-reviewer', 'plan-evaluator',
  'validation-fixer', 'merge-conflict-resolver', 'staleness-assessor', 'formatter', 'doc-author', 'doc-syncer',
  'test-writer', 'tester', 'prd-validator', 'dependency-detector', 'gap-closer', 'recovery-analyst',
] as const;
const agentRoleSchema = z.enum(AGENT_ROLES);
/** Agent tiers group agent roles by workload type for batch configuration. */
export const AGENT_TIERS = ['planning', 'implementation', 'review', 'evaluation'] as const;
export type AgentTier = (typeof AGENT_TIERS)[number];
export const agentTierSchema = z.enum(AGENT_TIERS).describe('Agent tier for grouping roles by workload type');
/** Built-in global fallback when neither a role nor its tier sets maxTurns. */
export const DEFAULT_AGENT_MAX_TURNS = 50;
/** Built-in max-turn defaults for each agent tier. */
export const DEFAULT_TIER_MAX_TURNS: Record<AgentTier, number> = Object.freeze({
  planning: 80,
  implementation: 80,
  review: 60,
  evaluation: DEFAULT_AGENT_MAX_TURNS,
});
const toolPresetConfigSchema = z.enum(['coding', 'read-only', 'none']);
const boundedPositiveIntegerConfigSchema = (key: keyof PlanningDecompositionConfig) => z.number().int().positive().max(PLANNING_DECOMPOSITION_CONFIG_MAXIMA[key]!, `${key} must be <= ${PLANNING_DECOMPOSITION_CONFIG_MAXIMA[key]}`);
const clampedPositiveIntegerConfigSchema = z.number().int().positive();
const RECOVERY_AUTO_RESUME_MAX_ATTEMPTS = 3;
const compileConfigSchema = z.object({
  planningUnitParallelism: boundedPositiveIntegerConfigSchema('planningUnitParallelism').optional(),
  planningUnitMaxDepth: boundedPositiveIntegerConfigSchema('planningUnitMaxDepth').optional(),
  planningUnitMaxPromptSourceBytes: boundedPositiveIntegerConfigSchema('planningUnitMaxPromptSourceBytes').optional(),
  planningUnitMaxPromptBytes: boundedPositiveIntegerConfigSchema('planningUnitMaxPromptBytes').optional(),
  planningUnitMaxObservedInputTokens: boundedPositiveIntegerConfigSchema('planningUnitMaxObservedInputTokens').optional(),
  planningUnitMaxObservedTurns: boundedPositiveIntegerConfigSchema('planningUnitMaxObservedTurns').optional(),
  planningUnitMaxCompactHandoffBytes: boundedPositiveIntegerConfigSchema('planningUnitMaxCompactHandoffBytes').optional(),
  planningUnitMaxLocalExplorationToolUses: boundedPositiveIntegerConfigSchema('planningUnitMaxLocalExplorationToolUses').optional(),
  planningUnitMaxCriteriaPerUnit: boundedPositiveIntegerConfigSchema('planningUnitMaxCriteriaPerUnit').optional(),
  planningUnitMaxSubsystemsPerUnit: boundedPositiveIntegerConfigSchema('planningUnitMaxSubsystemsPerUnit').optional(),
  planningUnitMaxSplitAttemptsPerUnit: boundedPositiveIntegerConfigSchema('planningUnitMaxSplitAttemptsPerUnit').optional(),
  planningSharedBriefMaxTotalBytes: boundedPositiveIntegerConfigSchema('planningSharedBriefMaxTotalBytes').optional(),
  planningSharedBriefMaxSectionBytes: boundedPositiveIntegerConfigSchema('planningSharedBriefMaxSectionBytes').optional(),
  planningSharedBriefMaxSectionsPerAtom: boundedPositiveIntegerConfigSchema('planningSharedBriefMaxSectionsPerAtom').optional(),
  directPrBaseSyncConflictAttempts: clampedPositiveIntegerConfigSchema.optional().describe('Compatibility fallback for the direct non-stacked PR base-sync conflict-resolution attempt budget; clamped after landing.directPrBaseSync.conflictAttempts precedence is resolved.'),
}).strict().describe('Compile planning-unit limits; direct PR base-sync budget fallback remains available for compatibility');
// Toolbelt Schemas
/** Reserved toolbelt names that users cannot declare in tools.toolbelts. */
export const RESERVED_TOOLBELT_NAMES = new Set(['none']);
/** Valid toolbelt name pattern: letters, digits, dot, underscore, or dash. */
const toolbeltNameSchema = z.string().regex(/^[A-Za-z0-9._-]+$/);
const toolbeltConfigSchema = z.object({
  description: z.string().optional(),
  mcpServers: z.array(z.string().min(1)).nonempty(),
});
const toolsConfigSchema = z.object({
  toolbelts: z.record(z.string(), toolbeltConfigSchema).optional(),
}).superRefine((data, ctx) => {
  if (data.toolbelts) {
    for (const name of Object.keys(data.toolbelts)) {
      if (RESERVED_TOOLBELT_NAMES.has(name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Toolbelt name "${name}" is reserved`,
          path: ['toolbelts', name],
        });
      } else if (!toolbeltNameSchema.safeParse(name).success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Toolbelt name "${name}" does not match pattern ^[A-Za-z0-9._-]+$`,
          path: ['toolbelts', name],
        });
      }
    }
  }
});
// ModelRef — model references
/** A model reference: id is always required. Resolver-only `provider` is spliced
 * in for Pi harness from `agents.tiers.<tier>.pi.provider`. Do not set `provider`
 * on config model refs. */
export interface ModelRef {
  id: string;
  provider?: string;
}
export const modelRefSchema = z.object({
  id: z.string().describe('Model identifier (e.g. "claude-opus-4-7", "gpt-5.4")'),
  provider: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.provider !== undefined) {
    ctx.addIssue({
      code: 'custom',
      message: '"provider" must not be set on model refs. Set provider on the tier\'s pi.provider instead.',
      path: ['provider'],
    });
  }
}).describe('Model reference (provider must not be set here; use tier pi.provider)');
// SDK Passthrough Config Schemas
export const thinkingConfigSchema = z.union([
  z.object({ type: z.literal('adaptive') }),
  z.object({ type: z.literal('enabled'), budgetTokens: z.number().int().positive().optional() }),
  z.object({ type: z.literal('disabled') }),
]).describe('Controls Claude\'s thinking/reasoning behavior');
export const effortLevelSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max']).describe('Effort level for controlling thinking depth');
export const sdkPassthroughConfigSchema = z.object({
  model: modelRefSchema.optional().describe('Model override'),
  thinking: thinkingConfigSchema.optional().describe('Thinking/reasoning behavior'),
  effort: effortLevelSchema.optional().describe('Effort level'),
  maxBudgetUsd: z.number().positive().optional().describe('Maximum budget in USD'),
  fallbackModel: z.string().optional().describe('Fallback model if primary is unavailable'),
  allowedTools: z.array(z.string()).optional().describe('Whitelist of allowed tool names'),
  disallowedTools: z.array(z.string()).optional().describe('Blacklist of disallowed tool names'),
});
const STRATEGIES = ['auto', 'single', 'parallel'] as const;
const STRICTNESS = ['strict', 'standard', 'lenient'] as const;
/** Safe key rule for review perspective identifiers: lowercase slug 1–64 chars. */
const reviewPerspectiveKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,63}$/, 'Perspective key must be a lowercase slug starting with a letter (e.g. "code", "accessibility")');
// Bound to `z.ZodType<ReviewProfileConfig>` so a drift between this schema and
// the shared TypeScript type in `@eforge-build/client` produces a compile error.
export const reviewProfileConfigSchema: z.ZodType<ReviewProfileConfig> = z.object({
  strategy: z.enum(STRATEGIES).describe('Review strategy: "auto" picks based on perspective count, "single" uses one reviewer, "parallel" runs all perspectives concurrently'),
  perspectives: z.array(reviewPerspectiveKeySchema).nonempty()
    .describe(`Review perspective keys. Built-ins: ${REVIEW_PERSPECTIVES.join(', ')}. Custom extension keys are also accepted (lowercase slugs). Example: ["code", "security", "api"]`),
  maxRounds: z.number().int().positive().describe('Number of review-fix-evaluate cycles (default 1)'),
  evaluatorStrictness: z.enum(STRICTNESS).describe('How strictly the evaluator judges fixes: "strict", "standard", or "lenient"'),
});
/** A build stage spec: either a single stage name or an array of stage names to run in parallel. */
export const buildStageSpecSchema = z.union([
  z.string().describe('A single stage name'),
  z.array(z.string()).describe('Stage names to run in parallel'),
]).describe('A stage name or array of stage names to run in parallel');
const hookConfigSchema = z.object({
  event: z.string(),
  command: z.string(),
  timeout: z.number().positive().default(5000),
});
const pluginConfigSchema = z.object({
  enabled: z.boolean().optional(),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  paths: z.array(z.string()).optional(),
});
export const extensionConfigSchema = z.object({
  enabled: z.boolean().optional().describe('Enable native eforge extension discovery and loading'),
  include: z.array(z.string()).optional().describe('Native extension names to include during auto-discovery'),
  exclude: z.array(z.string()).optional().describe('Native extension names to exclude during auto-discovery'),
  paths: z.array(z.string()).optional().describe('Explicit native extension module paths to load'),
  eventHookTimeoutMs: z.number().int().positive().optional().describe('Default timeout in milliseconds for native extension event-hook handlers'),
  agentContextHookTimeoutMs: z.number().int().positive().optional().describe('Timeout in milliseconds for agent-context hook handlers (defaults to eventHookTimeoutMs)'),
  policyGateTimeoutMs: z.number().int().positive().optional().describe('Timeout in milliseconds for policy gate handlers (defaults to eventHookTimeoutMs)'),
  policyGateFailurePolicy: z.enum(['fail-open', 'fail-closed']).optional().describe('Failure policy for thrown, timed-out, or invalid policy gate handlers'),
  profileRouterTimeoutMs: z.number().int().positive().optional().describe('Timeout in milliseconds for profile router handlers (defaults to eventHookTimeoutMs)'),
  validationProviderTimeoutMs: z.number().int().positive().optional().describe('Timeout in milliseconds for validation provider handlers and commands (defaults to eventHookTimeoutMs)'),
}).strict().describe('Native eforge extension configuration');
const SETTING_SOURCES = ['user', 'project', 'local'] as const;
/** Harness kind for a tier recipe. */
export const harnessTypeSchema = z.enum(['claude-sdk', 'pi']).describe('Harness kind for the tier recipe');
/** Backwards-compatible alias. */
export const harnessSchema = harnessTypeSchema;

export const piThinkingLevelSchema = z.enum(['off', 'low', 'medium', 'high', 'xhigh']).describe('Pi-native thinking level');

export const claudeSdkConfigSchema = z.object({
  disableSubagents: z.boolean().optional().describe('Disable the Task tool so agents cannot spawn subagents. Defaults to true. Claude SDK harness only.'),
}).describe('Configuration specific to the Claude SDK harness');

export const piConfigSchema = z.object({
  provider: z.string().optional().describe('Pi provider name (required when used in a pi tier)'),
  apiKey: z.string().optional().describe('API key for the Pi provider'),
  thinkingLevel: piThinkingLevelSchema.optional().describe('Thinking level for Pi agents'),
  resources: z.enum(['isolated', 'ambient']).optional().describe(
    "Whether ambient Pi resources (project/user/global extensions, skills, prompts, themes) are loaded into eforge agent sessions. Default 'isolated' suppresses all ambient resources; 'ambient' opts in to loading them (use with care — project-local Pi extensions must guard TUI state access for headless SDK contexts).",
  ),
  extensions: z.object({
    autoDiscover: z.boolean().optional().describe('Automatically discover Pi extensions'),
    include: z.array(z.string()).optional().describe('Extension names to include'),
    exclude: z.array(z.string()).optional().describe('Extension names to exclude'),
    paths: z.array(z.string()).optional().describe('Explicit extension directory paths to load'),
  }).optional().describe('Pi extension configuration'),
  compaction: z.object({
    enabled: z.boolean().optional().describe('Enable context compaction'),
    threshold: z.number().int().positive().optional().describe('Token threshold before compaction triggers'),
  }).optional().describe('Context compaction settings'),
  retry: z.object({
    maxRetries: z.number().int().nonnegative().optional().describe('Maximum retry attempts'),
    backoffMs: z.number().int().positive().optional().describe('Initial backoff in milliseconds'),
  }).optional().describe('Retry configuration for Pi API calls'),
}).describe('Configuration for the Pi coding agent harness');

const runtimeChoiceNameSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/, 'Choice names must be lowercase slugs starting with a letter');

const tierRecipeShape = {
  harness: harnessTypeSchema.describe('Which harness to run for roles in this tier'),
  pi: piConfigSchema.optional().describe('Pi-specific configuration (only when harness === "pi")'),
  claudeSdk: claudeSdkConfigSchema.optional().describe('Claude SDK-specific configuration (only when harness === "claude-sdk")'),
  model: z.string().describe('Model identifier for this tier (provider is taken from pi.provider for pi)'),
  effort: effortLevelSchema.describe('Effort level for roles in this tier'),
  thinking: z.boolean().optional().describe('When true, request thinking; coerced to adaptive for adaptive-only models'),
  fallbackModel: z.string().optional().describe('Fallback model id when primary is unavailable'),
  maxTurns: z.number().int().positive().optional().describe('Default maxTurns for roles in this tier'),
  allowedTools: z.array(z.string()).optional().describe('Whitelist of allowed tool names'),
  disallowedTools: z.array(z.string()).optional().describe('Blacklist of disallowed tool names'),
  promptAppend: z.string().optional().describe('Text appended to every agent prompt in this tier after variable substitution'),
  toolbelt: z.string().optional().describe('Toolbelt name to activate for roles in this tier (must be declared in tools.toolbelts, or "none" to disable)'),
} satisfies z.ZodRawShape;

const tierRecipeBaseSchema = z.object(tierRecipeShape);

const tierChoiceOverlaySchema = tierRecipeBaseSchema.partial().strict();

const runtimeRoutingWhenSchema = z.object({
  roles: z.array(agentRoleSchema).nonempty().optional(),
  phase: z.array(z.string().min(1)).nonempty().optional(),
  stage: z.array(z.string().min(1)).nonempty().optional(),
  pathGlobs: z.array(z.string().min(1)).nonempty().optional(),
  keywords: z.array(z.string().min(1)).nonempty().optional(),
  shardIds: z.array(z.string().min(1)).nonempty().optional(),
  shardRoots: z.array(z.string().min(1)).nonempty().optional(),
}).strict().superRefine((data, ctx) => {
  if (Object.keys(data).length === 0) {
    ctx.addIssue({ code: 'custom', message: 'Routing rule when block must include at least one predicate group' });
  }
});

const runtimeRoutingRuleSchema = z.object({
  name: z.string().min(1),
  choice: z.string().min(1),
  when: runtimeRoutingWhenSchema,
}).strict();

const tierRoutingSchema = z.object({
  rules: z.array(runtimeRoutingRuleSchema),
}).strict();

function addHarnessSpecificTierRecipeIssues(
  data: { harness?: 'claude-sdk' | 'pi'; pi?: z.output<typeof piConfigSchema>; claudeSdk?: z.output<typeof claudeSdkConfigSchema> },
  ctx: z.RefinementCtx,
  pathPrefix: Array<string | number> = [],
): void {
  if (data.harness === 'pi' && data.claudeSdk !== undefined) {
    ctx.addIssue({ code: 'custom', message: 'Tier with harness "pi" cannot include "claudeSdk" configuration.', path: [...pathPrefix, 'claudeSdk'] });
  }
  if (data.harness === 'claude-sdk' && data.pi !== undefined) {
    ctx.addIssue({ code: 'custom', message: 'Tier with harness "claude-sdk" cannot include "pi" configuration.', path: [...pathPrefix, 'pi'] });
  }
  if (data.harness === 'pi' && (!data.pi?.provider || data.pi.provider.trim() === '')) {
    ctx.addIssue({ code: 'custom', message: 'Tier with harness "pi" requires non-empty "pi.provider".', path: [...pathPrefix, 'pi', 'provider'] });
  }
}

/**
 * A self-contained tier recipe: harness + harness-specific config + model + effort,
 * optionally with tier-local runtime choices and ordered routing rules.
 */
export const tierConfigSchema = tierRecipeBaseSchema.extend({
  choices: z.record(runtimeChoiceNameSchema, tierChoiceOverlaySchema).optional(),
  routing: tierRoutingSchema.optional(),
}).strict().superRefine((data, ctx) => {
  addHarnessSpecificTierRecipeIssues(data, ctx);
  const tierPath = (ctx as unknown as { path?: Array<string | number> }).path ?? [];
  const tierName = typeof tierPath[tierPath.length - 1] === 'string' ? String(tierPath[tierPath.length - 1]) : undefined;
  for (const [choiceName, overlay] of Object.entries(data.choices ?? {})) {
    if (choiceName === 'default') {
      ctx.addIssue({ code: 'custom', message: 'Runtime choice name "default" is reserved for the implicit tier default', path: ['choices', choiceName] });
      continue;
    }
    const effective = overlayEffectiveAgentRecipe(data as EffectiveAgentRecipe, overlay);
    if (!effective.harness) ctx.addIssue({ code: 'custom', message: `Choice "${choiceName}" is missing effective harness after inheritance`, path: ['choices', choiceName, 'harness'] });
    if (!effective.model) ctx.addIssue({ code: 'custom', message: `Choice "${choiceName}" is missing effective model after inheritance`, path: ['choices', choiceName, 'model'] });
    if (!effective.effort) ctx.addIssue({ code: 'custom', message: `Choice "${choiceName}" is missing effective effort after inheritance`, path: ['choices', choiceName, 'effort'] });
    addHarnessSpecificTierRecipeIssues(effective, ctx, ['choices', choiceName]);
  }
  for (const [index, rule] of (data.routing?.rules ?? []).entries()) {
    const raw = rule.choice.trim();
    const parts = raw.split('.');
    const choiceName = parts.length === 2 ? parts[1] : raw;
    if (parts.length > 2) {
      ctx.addIssue({ code: 'custom', message: `Routing choice "${raw}" must be "default", a choice name, or "${tierName}.<choice>"`, path: ['routing', 'rules', index, 'choice'] });
      continue;
    }
    if (parts.length === 2 && tierName !== undefined && parts[0] !== tierName) {
      ctx.addIssue({ code: 'custom', message: `Routing choice "${raw}" crosses tiers; use a choice under "${tierName}"`, path: ['routing', 'rules', index, 'choice'] });
      continue;
    }
  }
}).describe('A self-contained tier recipe (harness + model + effort + tuning) with optional runtime choices');

// Local Zod copy of shardScopeSchema for use within Zod-based config schemas.
// config.ts will be migrated to TypeBox in a follow-up PRD. Mirrors the TypeBox
// shardScopeSchema + validateShardScope pair from schemas.ts: the .refine() here
// enforces the same "must specify at least one of roots or files" constraint
// that validateShardScope enforces on the TypeBox side.
const localShardScopeSchema = z.object({
  id: z.string().min(1).describe('Unique shard identifier within the plan'),
  roots: z.array(z.string().min(1)).optional().describe('Directory roots claimed by this shard (matched via path prefix)'),
  files: z.array(z.string().min(1)).optional().describe('Explicit file paths claimed by this shard'),
}).refine(
  (shard) => (shard.roots !== undefined && shard.roots.length > 0) || (shard.files !== undefined && shard.files.length > 0),
  { message: 'Each shard must specify at least one of roots or files' },
).describe('Scope definition for a single implementation shard');

/**
 * Per-role override block. Roles select a tier and may further tune per-role
 * fields without redeclaring the harness/model/etc. (those flow from the tier).
 */
const roleOverrideSchema = z.object({
  tier: agentTierSchema.optional().describe('Override the tier assignment for this role'),
  effort: effortLevelSchema.optional().describe('Override effort for this role'),
  thinking: z.boolean().optional().describe('Override thinking for this role'),
  maxTurns: z.number().int().positive().optional().describe('Override maxTurns for this role'),
  allowedTools: z.array(z.string()).optional().describe('Override allowedTools for this role'),
  disallowedTools: z.array(z.string()).optional().describe('Override disallowedTools for this role'),
  promptAppend: z.string().optional().describe('Text appended to this role\'s prompt after variable substitution'),
  shards: z.array(localShardScopeSchema).optional().describe('Parallel implementation shards (builder role only)'),
});

/** Zod schema for the stacking subsystem config. */
const stackingConfigSchema = z.object({
  enabled: z.boolean().optional().describe(
    'Enable git-spice stacked PR support. When true, each build\'s artifact branch targets the parent artifact branch instead of the trunk, forming a linear stack of pull requests. Requires git-spice to be installed. Default: false.',
  ),
  provider: z.literal('git-spice').optional().describe(
    'Stack provider. Only "git-spice" is supported in v1.',
  ),
  gitSpice: z.object({
    command: z.string().optional().describe(
      'Path or name of the git-spice executable. Defaults to "git-spice" on PATH. Set this if git-spice is installed to a non-standard location or you use a wrapper script.',
    ),
  }).optional().describe('git-spice provider settings.'),
  sync: z.object({
    afterBuild: z.boolean().optional().describe(
      'When true and stacking is enabled, the daemon automatically triggers a stack sync after each successful build session completes. The sync runs as a daemon-owned operation with full active-build awareness. Default: false.',
    ),
  }).optional().describe('Stack sync scheduling settings.'),
}).describe(
  'Stacking configuration for git-spice backed stacked PRs. Set stacking.enabled: true to activate; each artifact branch PR then targets the parent artifact branch rather than trunk. PRD frontmatter fields stack_id (logical stack name) and stack_parent (parent PRD id) control the topology.',
);

const recoveryAutoResumeConfigSchema = z.object({ enabled: z.boolean().optional().describe('Opt in to daemon-owned bounded recovery auto-resume for high-confidence compiled-artifact continue-repair recommendations. Default: false; disabled policy consumers stop before mutation.'), maxAttempts: z.number().int().nonnegative().max(RECOVERY_AUTO_RESUME_MAX_ATTEMPTS).optional().describe(`Maximum automatic continue-repair attempts per failed PRD before policy stops. Default: 1. Maximum: ${RECOVERY_AUTO_RESUME_MAX_ATTEMPTS}. Set 0 to audit decisions without mutation even when enabled.`) }).strict().describe('Disabled-by-default bounded recovery auto-resume policy.');
const recoveryConfigSchema = z.object({ autoResume: recoveryAutoResumeConfigSchema.optional() }).strict().describe('Recovery automation settings. Manual recovery tools remain available regardless of this policy.');
const LEGACY_BUILD_ON_SUCCESS_MIGRATION_MESSAGE =
  `"build.onSuccess" is no longer supported. Use "landing.action: pr|merge|leave" instead. ` +
  `Replace build.onSuccess: merge-to-base-branch → landing.action: merge, ` +
  `build.onSuccess: issue-pr → landing.action: pr, ` +
  `build.onSuccess: leave-branch → landing.action: leave.`;

function hasLegacyBuildOnSuccess(data: Record<string, unknown>): boolean {
  const buildField = data.build;
  return !!(
    buildField &&
    typeof buildField === 'object' &&
    'onSuccess' in (buildField as Record<string, unknown>)
  );
}

/** Zod schema for the landing publication config. */
const landingConfigSchema = z.object({
  action: z.enum(['pr', 'merge', 'leave']).optional().describe(
    'Landing action after a successful build. "pr" opens a GitHub pull request from the artifact branch targeting the resolved base branch (current base branch for non-stacked builds, parent artifact branch for stacked builds). "merge" merges the artifact branch into the base branch directly. "leave" commits to the artifact branch and exits without merging or opening a PR. Default: "merge".',
  ),
  pr: z.object({
    autoMerge: z.enum(['ask', 'always', 'never']).optional().describe(
      'GitHub PR auto-merge policy. "always": enable auto-merge on every PR unless the per-run landingAutoMerge flag is explicitly false. "ask": enable auto-merge only when the per-run landingAutoMerge flag is explicitly true. "never": never enable auto-merge and emit a skipped event. Default: "ask".',
    ),
  }).optional(),
  directPrBaseSync: z.object({
    conflictAttempts: clampedPositiveIntegerConfigSchema.optional().describe('Direct non-stacked PR base-sync conflict-resolution attempt budget; clamped to the supported range.'),
  }).optional(),
}).describe(
  'Publication action taken after all plans complete and validation passes.',
);

/**
 * Explicit validation waiver config. Allows specific validation requirements to be
 * waived for builds that cannot satisfy standard requirements. Every waiver must
 * carry a non-empty reason string that is surfaced in events.
 */
const validationWaiverConfigSchema = z.object({
  allowNoCommands: z.boolean().optional().describe(
    'Allow builds with zero combined validation commands to pass instead of failing. Requires noCommandsReason.',
  ),
  noCommandsReason: z.string().optional().describe(
    'Required human-readable reason when allowNoCommands is true.',
  ),
  allowEmptyPrdDiff: z.boolean().optional().describe(
    'Allow PRD validation to pass when the diff is empty (no changes detected). Requires emptyPrdDiffReason.',
  ),
  emptyPrdDiffReason: z.string().optional().describe(
    'Required human-readable reason when allowEmptyPrdDiff is true.',
  ),
  allowNoAcceptanceCriteria: z.boolean().optional().describe('Allow builds with no extractable acceptance criteria to pass instead of failing. Requires noAcceptanceCriteriaReason.'),
  noAcceptanceCriteriaReason: z.string().optional().describe('Required human-readable reason when allowNoAcceptanceCriteria is true.'),
  acceptanceConflictPolicy: z.enum(['fail', 'manual', 'auto-waive-narrow']).optional().describe('Handle validator-reported acceptance criteria conflicts. Default: "manual".'),
  allowNoCommittedChanges: z.boolean().optional().describe('Allow builds that produce no committed changes to pass instead of failing. Requires noCommittedChangesReason.'),
  noCommittedChangesReason: z.string().optional().describe('Required human-readable reason when allowNoCommittedChanges is true.'),
}).superRefine((data, ctx) => {
  if (data.allowNoCommands && !data.noCommandsReason?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '"noCommandsReason" must be a non-empty string when "allowNoCommands" is true',
      path: ['noCommandsReason'],
    });
  }
  if (data.allowEmptyPrdDiff && !data.emptyPrdDiffReason?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '"emptyPrdDiffReason" must be a non-empty string when "allowEmptyPrdDiff" is true',
      path: ['emptyPrdDiffReason'],
    });
  }
  if (data.allowNoAcceptanceCriteria && !data.noAcceptanceCriteriaReason?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '"noAcceptanceCriteriaReason" must be a non-empty string when "allowNoAcceptanceCriteria" is true',
      path: ['noAcceptanceCriteriaReason'],
    });
  }
  if (data.allowNoCommittedChanges && !data.noCommittedChangesReason?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '"noCommittedChangesReason" must be a non-empty string when "allowNoCommittedChanges" is true',
      path: ['noCommittedChangesReason'],
    });
  }
}).describe('Explicit validation waivers. Each waiver boolean requires a non-empty reason string.');

/** Base object schema without refinements — .partial() is derived from this. */
const eforgeConfigBaseSchema = z.object({
  maxConcurrentBuilds: z.number().int().positive().optional(),
  langfuse: z.object({
    enabled: z.boolean().optional(),
    publicKey: z.string().optional(),
    secretKey: z.string().optional(),
    host: z.string().optional(),
  }).optional(),
  agents: z.object({
    maxTurns: z.number().int().positive().optional(),
    maxContinuations: z.number().int().nonnegative().optional(),
    permissionMode: z.enum(['bypass', 'default']).optional(),
    settingSources: z.array(z.enum(SETTING_SOURCES)).nonempty().optional(),
    bare: z.boolean().optional(),
    promptDir: z.string().optional().describe('Directory of .md files that shadow bundled prompts by name match'),
    tiers: z.record(z.string(), tierConfigSchema).optional().describe('Tier recipes — every tier referenced by any role must be declared'),
    roles: z.record(agentRoleSchema, roleOverrideSchema.optional()).optional().describe('Per-agent role overrides'),
  }).optional(),
  compile: compileConfigSchema.optional(),
  build: z.object({
    worktreeDir: z.string().optional(),
    postMergeCommands: z.array(z.string()).optional(),
    postMergeCommandTimeoutMs: z.number().int().positive().optional(),
    maxValidationRetries: z.number().int().nonnegative().optional(),
    cleanupPlanFiles: z.boolean().optional(),
    onSuccess: z.never({ error: LEGACY_BUILD_ON_SUCCESS_MIGRATION_MESSAGE }).optional(),
    trunkBranch: z.string().optional(),
    allowLocalMergeToTrunk: z.boolean().optional(),
    validation: validationWaiverConfigSchema.optional(),
    trunkSync: z.object({
      enabled: z.boolean().optional().describe('Enable pre-compile trunk freshness gate. When true (default), fetches remote trunk before compile and uses the fetched SHA as the compile base when remote is ahead. Set false to disable for offline or local-only workflows.'),
      remote: z.string().optional().describe('Git remote to fetch the trunk branch from. Default: "origin".'),
      strategy: z.literal('fetchedRemoteRef').optional().describe('Base selection strategy. Only "fetchedRemoteRef" is supported: use the exact fetched commit SHA so the compile base is reproducible if the remote branch moves during the run. Default: "fetchedRemoteRef".'),
      onDiverged: z.enum(['warn', 'fail', 'use-remote']).optional().describe('Policy when local and remote trunk have diverged (neither is an ancestor of the other). "warn": emit a diagnostic and fall back to local trunk (default). "fail": fail the build before compile. "use-remote": use the fetched remote SHA with a diagnostic.'),
    }).optional().describe('Pre-compile trunk freshness gate. Fetches remote trunk before compile and selects a reproducible base SHA when the remote is ahead of the local trunk.'),
  }).optional(),
  plan: z.object({
    outputDir: z.string().optional(),
  }).optional(),
  plugins: pluginConfigSchema.optional(),
  extensions: extensionConfigSchema.optional(),
  prdQueue: z.object({
    dir: z.string().optional(),
    autoBuild: z.boolean().optional(),
    watchPollIntervalMs: z.number().int().positive().optional(),
  }).optional(),
  daemon: z.object({
    idleShutdownMs: z.number().int().nonnegative().optional(),
  }).optional(),
  monitor: z.object({
    retentionCount: z.number().int().positive().optional(),
  }).optional(), recovery: recoveryConfigSchema.optional(),
  hooks: z.array(hookConfigSchema).optional(),
  tools: toolsConfigSchema.optional(),
  stacking: stackingConfigSchema.optional(),
  landing: landingConfigSchema.optional(),
});

function collectEffectiveRecipeConfigErrors(recipe: unknown, path: string): string[] {
  const errors: string[] = [];
  const parsed = tierRecipeBaseSchema.safeParse(recipe);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`${path}${issue.path.length > 0 ? `.${issue.path.join('.')}` : ''}: ${issue.message}`);
    }
    return errors;
  }
  if (parsed.data.harness === 'pi' && parsed.data.claudeSdk !== undefined) {
    errors.push(`${path}.claudeSdk: Tier with harness "pi" cannot include "claudeSdk" configuration.`);
  }
  if (parsed.data.harness === 'claude-sdk' && parsed.data.pi !== undefined) {
    errors.push(`${path}.pi: Tier with harness "claude-sdk" cannot include "pi" configuration.`);
  }
  if (parsed.data.harness === 'pi' && (!parsed.data.pi?.provider || parsed.data.pi.provider.trim() === '')) {
    errors.push(`${path}.pi.provider: Tier with harness "pi" requires non-empty "pi.provider".`);
  }
  return errors;
}

function collectRuntimeChoiceConfigErrors(data: { agents?: { tiers?: Record<string, unknown> } }, options: { validateUnknownChoices?: boolean; validateEffectiveRecipes?: boolean } = {}): string[] {
  const errors: string[] = [];
  for (const [tierName, tierValue] of Object.entries(data.agents?.tiers ?? {})) {
    if (!tierValue || typeof tierValue !== 'object') continue;
    const tier = tierValue as { choices?: Record<string, unknown>; routing?: { rules?: Array<{ choice?: unknown; name?: unknown }> } };
    const choices = tier.choices ?? {};
    if (options.validateEffectiveRecipes === true) {
      const { choices: _choices, routing: _routing, ...baseRecipe } = tier as Record<string, unknown>;
      errors.push(...collectEffectiveRecipeConfigErrors(baseRecipe, `agents.tiers.${tierName}`));
      for (const [choiceName, overlay] of Object.entries(choices)) {
        if (!overlay || typeof overlay !== 'object') continue;
        const effective = overlayEffectiveAgentRecipe(baseRecipe as EffectiveAgentRecipe, overlay as NonNullable<TierConfig['choices']>[string]);
        errors.push(...collectEffectiveRecipeConfigErrors(effective, `agents.tiers.${tierName}.choices.${choiceName}`));
      }
    }
    if (Object.prototype.hasOwnProperty.call(choices, 'default')) {
      errors.push(`agents.tiers.${tierName}.choices.default: Runtime choice name "default" is reserved for the implicit tier default`);
    }
    for (const [index, rule] of (tier.routing?.rules ?? []).entries()) {
      if (typeof rule.choice !== 'string') continue;
      const raw = rule.choice.trim();
      const parts = raw.split('.');
      const choiceName = parts.length === 2 ? parts[1] : raw;
      if (parts.length === 2 && parts[0] !== tierName) {
        errors.push(`agents.tiers.${tierName}.routing.rules.${index}.choice: Routing choice "${raw}" crosses tiers; use a choice under "${tierName}"`);
      } else if (options.validateUnknownChoices === true && choiceName !== 'default' && !Object.prototype.hasOwnProperty.call(choices, choiceName)) {
        errors.push(`agents.tiers.${tierName}.routing.rules.${index}.choice: Routing choice "${raw}" references unknown choice "${choiceName}"`);
      }
    }
  }
  return errors;
}

function addRuntimeChoiceConfigIssues(data: { agents?: { tiers?: Record<string, unknown> } }, ctx: z.RefinementCtx): void {
  for (const error of collectRuntimeChoiceConfigErrors(data)) {
    const [pathText, ...messageParts] = error.split(': ');
    ctx.addIssue({ code: 'custom', message: messageParts.join(': '), path: pathText.split('.') });
  }
}

function assertMergedRuntimeChoiceConfig(data: { agents?: { tiers?: Record<string, unknown> } }, label = 'config'): void {
  const errors = collectRuntimeChoiceConfigErrors(data, { validateUnknownChoices: true, validateEffectiveRecipes: true });
  if (errors.length > 0) {
    throw new ConfigValidationError(`Invalid ${label}: ${errors.join('; ')}`);
  }
}

/** Exported schema. Cross-field validation is performed in tierConfigSchema; unknown runtime-choice references are validated after config layers are merged. */
export const eforgeConfigSchema = eforgeConfigBaseSchema.superRefine(addRuntimeChoiceConfigIssues);

// ---------------------------------------------------------------------------
// Derived TypeScript types — from schemas, not hand-written
// ---------------------------------------------------------------------------

export type ToolPresetConfig = z.output<typeof toolPresetConfigSchema>;
// `ReviewProfileConfig` and `BuildStageSpec` are owned by `@eforge-build/client`
// and re-exported at the top of this file.
export type HookConfig = z.output<typeof hookConfigSchema>;
export type PluginConfig = z.output<typeof pluginConfigSchema>;
export type ExtensionConfig = z.output<typeof extensionConfigSchema> & {
  enabled: boolean;
  eventHookTimeoutMs: number;
  agentContextHookTimeoutMs: number;
  policyGateTimeoutMs: number;
  policyGateFailurePolicy: 'fail-open' | 'fail-closed';
  profileRouterTimeoutMs: number;
  validationProviderTimeoutMs: number;
};
export type TierConfig = z.output<typeof tierConfigSchema>;

/** Resolved validation waiver config. All fields have explicit defaults (false/undefined). */
export interface ValidationConfig {
  allowNoCommands: boolean;
  noCommandsReason?: string;
  allowEmptyPrdDiff: boolean;
  emptyPrdDiffReason?: string;
  allowNoAcceptanceCriteria: boolean;
  noAcceptanceCriteriaReason?: string;
  acceptanceConflictPolicy: 'fail' | 'manual' | 'auto-waive-narrow';
  allowNoCommittedChanges: boolean;
  noCommittedChangesReason?: string;
}

/** Resolved stacking subsystem config. */
export interface StackingConfig {
  enabled: boolean;
  provider: 'git-spice';
  gitSpice: { command?: string };
  /** Stack sync scheduling settings. */
  sync: {
    /**
     * When true and stacking is enabled, the daemon automatically triggers a
     * stack sync after each successful build session completes.
     * Default: false.
     */
    afterBuild: boolean;
  };
}

/** Resolved landing publication config. */
export interface LandingConfig {
  action: 'pr' | 'merge' | 'leave';
  pr: {
    /** GitHub PR auto-merge policy. Default: 'ask'. */
    autoMerge: 'ask' | 'always' | 'never';
  };
  directPrBaseSync: {
    /** Direct non-stacked PR base-sync conflict-resolution attempt budget. */
    conflictAttempts: number;
  };
}

/** Resolved pre-compile trunk sync gate config. */
export interface TrunkSyncConfig {
  enabled: boolean;
  remote: string;
  strategy: 'fetchedRemoteRef';
  onDiverged: 'warn' | 'fail' | 'use-remote';
}


/**
 * Resolved agent config for a specific role, combining tier recipe + role/plan
 * overrides. Provenance for each tunable field is `tier | role | plan`.
 */
export interface ResolvedAgentConfig {
  /** Harness kind resolved from the tier recipe. */
  harness: 'claude-sdk' | 'pi';
  /** Source of harness — always `'tier'` since harness flows from the tier. */
  harnessSource: 'tier';
  /** Resolved tier name. */
  tier: AgentTier;
  /** Provenance of the tier value. */
  tierSource: 'tier' | 'role' | 'plan';
  runtimeChoice?: string; runtimeChoiceQualified?: string; runtimeChoiceSource?: import('./pipeline/runtime-choice.js').RuntimeChoiceSource; runtimeChoiceRule?: string; runtimeChoiceRouter?: string; runtimeChoiceFallbackReason?: import('./pipeline/runtime-choice.js').RuntimeChoiceFallbackReason;
  /** Resolved model ref. Provider is spliced from tier.pi.provider for pi harness. */
  model: ModelRef;
  /** Resolved effort level. */
  effort: import('./harness.js').EffortLevel;
  /** Provenance of the resolved effort value. */
  effortSource: 'tier' | 'role' | 'plan';
  /** Resolved thinking config (when set). */
  thinking?: import('./harness.js').ThinkingConfig;
  /** Provenance of the resolved thinking value. */
  thinkingSource: 'tier' | 'role' | 'plan';
  /** Resolved maxTurns value. */
  maxTurns?: number;
  /** Resolved fallback model id. */
  fallbackModel?: string;
  /** Resolved allowed tools list. */
  allowedTools?: string[];
  /** Resolved disallowed tools list. */
  disallowedTools?: string[];
  /** Text appended to the agent prompt after variable substitution. */
  promptAppend?: string;
  /** True when the resolved effort was clamped to the model's maximum supported level. */
  effortClamped?: boolean;
  /** The original effort level before clamping was applied. */
  effortOriginal?: import('./harness.js').EffortLevel;
  /** True when thinking was coerced from 'enabled' to 'adaptive' for models that only support adaptive thinking. */
  thinkingCoerced?: boolean;
  /** The original thinking config before coercion was applied. */
  thinkingOriginal?: import('./harness.js').ThinkingConfig;
  /** Parallel implementation shards for the builder role. When present, the implement stage fans out. */
  shards?: ShardScope[];
  /**
   * The toolbelt name selected for this role's tier. Undefined when the tier omits toolbelt
   * (default = all project MCP servers), null when toolbelt is explicitly 'none',
   * string when a named toolbelt is active.
   */
  toolbelt?: string | null;
  /** Provenance of the toolbelt selection. */
  toolbeltSource?: 'tier' | 'role' | 'plan' | 'default';
  /** Which project MCP servers were selected for this tier. */
  projectMcpSelection?: 'all' | 'none' | 'toolbelt';
  /** Sorted names of the project MCP servers passed to this tier's harness. */
  projectMcpServerNames?: string[];
}

export interface PiConfig {
  /** Optional explicit API key override. */
  apiKey?: string;
  /** Optional provider override. */
  provider?: string;
  thinkingLevel: 'off' | 'low' | 'medium' | 'high' | 'xhigh';
  /**
   * Whether ambient Pi resources (project/user/global extensions, skills, prompts, themes)
   * are loaded into eforge agent sessions. Required (defaulted to 'isolated' by buildPiConfig).
   * 'isolated' suppresses all ambient resources (deterministic default).
   * 'ambient' opts in — project-local Pi extensions must guard TUI state for headless contexts.
   */
  resources: 'isolated' | 'ambient';
  extensions: { autoDiscover: boolean; include?: string[]; exclude?: string[]; paths?: string[] };
  compaction: { enabled: boolean; threshold: number };
  retry: { maxRetries: number; backoffMs: number };
}

/** Resolved Claude SDK harness config. */
export interface ClaudeSdkConfig {
  /** Defaults to true for Claude SDK tiers; set false to allow the Task/subagent tool. */
  disableSubagents: boolean;
}

export interface RecoveryAutoResumeConfig { enabled: boolean; maxAttempts: number }
export interface EforgeConfig {
  maxConcurrentBuilds: number;
  langfuse: { enabled: boolean; publicKey?: string; secretKey?: string; host: string };
  recovery: { autoResume: RecoveryAutoResumeConfig };
  agents: {
    maxTurns: number;
    maxContinuations: number;
    permissionMode: 'bypass' | 'default';
    settingSources?: string[];
    bare: boolean;
    promptDir?: string;
    tiers: Partial<Record<AgentTier, TierConfig>>;
    roles?: Partial<Record<AgentRole, z.output<typeof roleOverrideSchema>>>;
  };
  compile: PlanningDecompositionConfig;
  build: {
    worktreeDir?: string;
    postMergeCommands?: string[];
    postMergeCommandTimeoutMs?: number;
    maxValidationRetries: number;
    cleanupPlanFiles: boolean;
    trunkBranch?: string;
    allowLocalMergeToTrunk: boolean;
    validation: ValidationConfig;
    trunkSync: TrunkSyncConfig;
  };
  plan: { outputDir: string };
  plugins: PluginConfig;
  extensions: ExtensionConfig;
  prdQueue: { dir: string; autoBuild: boolean; watchPollIntervalMs: number };
  daemon: { idleShutdownMs: number };
  monitor: { retentionCount: number };
  hooks: readonly HookConfig[];
  tools: {
    toolbelts: Record<string, { description?: string; mcpServers: string[] }>;
  };
  stacking: StackingConfig;
  landing: LandingConfig;
}

/** Deep-partial version of EforgeConfig used for parsing and merging — derived from the zod schema. */
const partialEforgeConfigSchema = eforgeConfigBaseSchema.partial();
export type PartialEforgeConfig = z.output<typeof partialEforgeConfigSchema>;

// ---------------------------------------------------------------------------
// Profile Metadata Schema — profile-only descriptive fields
// ---------------------------------------------------------------------------

/**
 * Optional descriptive metadata for agent runtime profile files.
 * These fields are preserved on read, accepted on create, and surfaced in wire
 * responses but MUST NOT participate in runtime config construction.
 */
export const profileMetadataSchema = z.object({
  description: z.string().optional(),
  whenToUse: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});

export type ProfileMetadata = z.output<typeof profileMetadataSchema>;

/**
 * Schema used ONLY for profile YAML file parsing. Extends partialEforgeConfigSchema
 * to accept the three optional metadata fields at the top level. Keep
 * partialEforgeConfigSchema unchanged so config.yaml continues to reject these
 * keys via configYamlSchema's passthrough+superRefine knownConfigYamlKeys check.
 */
const profileFileSchema = partialEforgeConfigSchema.extend({
  description: z.string().optional(),
  whenToUse: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});

type ProfileFileData = z.output<typeof profileFileSchema>;

/**
 * Extract optional profile metadata from an opaque profile object.
 * Returns `undefined` when none of the three metadata fields are present.
 * Useful for the daemon to lift metadata out of opaque profile partials
 * without re-parsing YAML.
 */
export function extractProfileMetadata(profile: unknown): ProfileMetadata | undefined {
  if (!profile || typeof profile !== 'object') return undefined;
  const obj = profile as Record<string, unknown>;
  const description = typeof obj.description === 'string' ? obj.description : undefined;
  const whenToUse =
    Array.isArray(obj.whenToUse) && obj.whenToUse.every((v) => typeof v === 'string')
      ? (obj.whenToUse as string[])
      : undefined;
  const tags =
    Array.isArray(obj.tags) && obj.tags.every((v) => typeof v === 'string')
      ? (obj.tags as string[])
      : undefined;
  if (description === undefined && whenToUse === undefined && tags === undefined) return undefined;
  const result: ProfileMetadata = {};
  if (description !== undefined) result.description = description;
  if (whenToUse !== undefined) result.whenToUse = whenToUse;
  if (tags !== undefined) result.tags = tags;
  return result;
}

/**
 * Set of top-level keys recognized by config.yaml. Derived from the base schema's
 * shape so it stays in sync with the source of truth — adding a new top-level
 * field updates this automatically.
 */
const knownConfigYamlKeys = new Set(Object.keys(eforgeConfigBaseSchema.shape));

// For configYamlSchema: build a passthrough agents schema so that unknown
// nested keys like `agents.models` survive inner-object parsing and are
// detectable in the superRefine legacy-detection step. Without passthrough,
// Zod strips unknown keys from the agents sub-object before superRefine runs.
const _configYamlAgentsSchema = (
  eforgeConfigBaseSchema.shape.agents as z.ZodOptional<z.ZodObject<any>>
).unwrap().passthrough().optional();

/**
 * Schema for config.yaml validation. Unknown top-level keys are rejected,
 * legacy keys (`backend:`, `pi:`, `claudeSdk:`, `agentRuntimes:`,
 * `defaultAgentRuntime:`, `agents.models`) get a migration hint.
 *
 * Implemented via .passthrough() + superRefine rather than .strict() so the
 * legacy migration hint always wins over the generic message and ordering is
 * fully under our control.
 */
export const configYamlSchema = eforgeConfigBaseSchema.partial()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .extend({ agents: _configYamlAgentsSchema as any })
  .passthrough()
  .superRefine((data, ctx) => {
  if (!data || typeof data !== 'object') return;
  const obj = data as Record<string, unknown>;
  const legacyTopLevel = new Set(['backend', 'pi', 'claudeSdk', 'agentRuntimes', 'defaultAgentRuntime']);
  for (const key of Object.keys(obj)) {
    if (legacyTopLevel.has(key)) {
      ctx.addIssue({
        code: 'custom',
        message: `"${key}:" is no longer valid in config.yaml. Each tier under agents.tiers is now a self-contained recipe with harness + model + effort. See docs/config-migration.md for before/after examples.`,
        path: [key],
      });
    } else if (!knownConfigYamlKeys.has(key)) {
      ctx.addIssue({
        code: 'custom',
        message: `Unrecognized key "${key}" in config.yaml. Recognized keys: ${Array.from(knownConfigYamlKeys).sort().join(', ')}.`,
        path: [key],
      });
    }
  }
  // agents.models is also legacy now — tier recipes carry the model directly.
  const agents = obj.agents;
  if (agents && typeof agents === 'object' && 'models' in (agents as Record<string, unknown>)) {
    ctx.addIssue({
      code: 'custom',
      message: '"agents.models" is no longer supported. Each tier under agents.tiers carries its own model. See docs/config-migration.md for before/after examples.',
      path: ['agents', 'models'],
    });
  }
});

/** Minimum allowed value for postMergeCommandTimeoutMs. Values below this are clamped. */
export const MIN_POST_MERGE_COMMAND_TIMEOUT_MS = 10_000;

export function normalizePostMergeCommandTimeoutMs(timeoutMs: number | undefined, defaultTimeoutMs = 300_000): number {
  return Math.max(timeoutMs ?? defaultTimeoutMs, MIN_POST_MERGE_COMMAND_TIMEOUT_MS);
}

export const DEFAULT_REVIEW: ReviewProfileConfig = Object.freeze({
  strategy: 'auto' as const,
  perspectives: Object.freeze(['code']) as unknown as ReviewProfileConfig['perspectives'],
  maxRounds: 1,
  evaluatorStrictness: 'standard' as const,
});

const DEFAULT_TIER_RECIPES: Partial<Record<AgentTier, TierConfig>> = Object.freeze({
  planning: Object.freeze({
    harness: 'claude-sdk' as const,
    model: 'claude-opus-4-7',
    effort: 'high' as const,
    maxTurns: DEFAULT_TIER_MAX_TURNS.planning,
  }),
  implementation: Object.freeze({
    harness: 'claude-sdk' as const,
    model: 'claude-sonnet-4-6',
    effort: 'medium' as const,
    maxTurns: DEFAULT_TIER_MAX_TURNS.implementation,
  }),
  review: Object.freeze({
    harness: 'claude-sdk' as const,
    model: 'claude-opus-4-7',
    effort: 'high' as const,
    maxTurns: DEFAULT_TIER_MAX_TURNS.review,
  }),
  evaluation: Object.freeze({
    harness: 'claude-sdk' as const,
    model: 'claude-opus-4-7',
    effort: 'high' as const,
    maxTurns: DEFAULT_TIER_MAX_TURNS.evaluation,
  }),
}) as Partial<Record<AgentTier, TierConfig>>;

export const DEFAULT_CONFIG: EforgeConfig = Object.freeze({
  maxConcurrentBuilds: 2,
  langfuse: Object.freeze({ enabled: false, host: 'https://cloud.langfuse.com' }),
  recovery: Object.freeze({ autoResume: Object.freeze({ enabled: false, maxAttempts: 1 }) }),
  compile: DEFAULT_PLANNING_DECOMPOSITION_CONFIG,
  agents: Object.freeze({
    maxTurns: DEFAULT_AGENT_MAX_TURNS,
    maxContinuations: 3,
    permissionMode: 'bypass' as const,
    settingSources: ['project'] as string[],
    bare: false,
    tiers: DEFAULT_TIER_RECIPES,
  }),
  build: Object.freeze({
    worktreeDir: undefined,
    postMergeCommands: undefined,
    postMergeCommandTimeoutMs: 300_000,
    maxValidationRetries: 2,
    cleanupPlanFiles: true,
    trunkBranch: undefined as string | undefined,
    allowLocalMergeToTrunk: false,
    validation: Object.freeze({
      allowNoCommands: false,
      allowEmptyPrdDiff: false,
      allowNoAcceptanceCriteria: false,
      acceptanceConflictPolicy: 'manual',
      allowNoCommittedChanges: false,
    } as ValidationConfig),
    trunkSync: Object.freeze({
      enabled: true,
      remote: 'origin',
      strategy: 'fetchedRemoteRef' as const,
      onDiverged: 'warn' as const,
    } as TrunkSyncConfig),
  }),
  plan: Object.freeze({ outputDir: 'eforge/plans' }),
  plugins: Object.freeze({ enabled: true }),
  extensions: Object.freeze({
    enabled: true,
    eventHookTimeoutMs: DEFAULT_NATIVE_EVENT_HOOK_TIMEOUT_MS,
    agentContextHookTimeoutMs: DEFAULT_NATIVE_EVENT_HOOK_TIMEOUT_MS,
    policyGateTimeoutMs: DEFAULT_NATIVE_EVENT_HOOK_TIMEOUT_MS,
    policyGateFailurePolicy: 'fail-closed' as const,
    profileRouterTimeoutMs: DEFAULT_NATIVE_EVENT_HOOK_TIMEOUT_MS,
    validationProviderTimeoutMs: DEFAULT_NATIVE_EVENT_HOOK_TIMEOUT_MS,
  }),
  prdQueue: Object.freeze({ dir: '.eforge/queue', autoBuild: true, watchPollIntervalMs: 5000 }),
  daemon: Object.freeze({ idleShutdownMs: 7_200_000 }),
  monitor: Object.freeze({ retentionCount: 100 }),
  hooks: Object.freeze([]),
  tools: Object.freeze({ toolbelts: {} }),
  stacking: Object.freeze({ enabled: false, provider: 'git-spice' as const, gitSpice: Object.freeze({}) as { command?: string }, sync: Object.freeze({ afterBuild: false }) }),
  landing: Object.freeze({
    action: 'merge' as const,
    pr: Object.freeze({ autoMerge: 'ask' as const }),
    directPrBaseSync: Object.freeze({ conflictAttempts: DEFAULT_PLANNING_DECOMPOSITION_CONFIG.directPrBaseSyncConflictAttempts }),
  }),
});

/**
 * Walk up the directory tree looking for eforge/config.yaml.
 * Returns the absolute path if found, null otherwise.
 */
export async function findConfigFile(startDir: string): Promise<string | null> {
  let dir = resolve(startDir);

  while (true) {
    const candidate = resolve(dir, 'eforge', 'config.yaml');
    try {
      await access(candidate);
      return candidate;
    } catch {
      // not found, move up
    }

    const parent = dirname(dir);
    if (parent === dir) {
      break; // reached filesystem root
    }
    dir = parent;
  }

  return null;
}

function mergeTierRecipesWithDefaults(
  tiers?: Partial<Record<AgentTier, TierConfig>>,
): Partial<Record<AgentTier, TierConfig>> {
  if (!tiers) return DEFAULT_CONFIG.agents.tiers;

  const merged: Partial<Record<AgentTier, TierConfig>> = { ...DEFAULT_CONFIG.agents.tiers };
  for (const tierName of new Set<AgentTier>([
    ...AGENT_TIERS,
    ...(Object.keys(tiers) as AgentTier[]),
  ])) {
    const defaultTier = DEFAULT_CONFIG.agents.tiers[tierName];
    const configuredTier = tiers[tierName];
    if (configuredTier) {
      merged[tierName] = defaultTier ? { ...defaultTier, ...configuredTier } : configuredTier;
    }
  }
  return merged;
}

/**
 * Merge file-based config with env vars. Env vars take precedence.
 * Sets langfuse.enabled = true only when both keys are present.
 */
export function resolveConfig(
  fileConfig: PartialEforgeConfig,
  env: Record<string, string | undefined> = process.env,
): EforgeConfig {
  assertMergedRuntimeChoiceConfig(fileConfig as { agents?: { tiers?: Record<string, unknown> } });
  const langfusePublicKey = env.LANGFUSE_PUBLIC_KEY ?? fileConfig.langfuse?.publicKey;
  const langfuseSecretKey = env.LANGFUSE_SECRET_KEY ?? fileConfig.langfuse?.secretKey;
  const langfuseHost = env.LANGFUSE_BASE_URL ?? fileConfig.langfuse?.host ?? DEFAULT_CONFIG.langfuse.host;
  const langfuseEnabled = !!(langfusePublicKey && langfuseSecretKey);

  const tiers = mergeTierRecipesWithDefaults(fileConfig.agents?.tiers as Partial<Record<AgentTier, TierConfig>> | undefined);
  const landingAction = fileConfig.landing?.action ?? DEFAULT_CONFIG.landing.action;

  return Object.freeze({
    maxConcurrentBuilds: fileConfig.maxConcurrentBuilds ?? DEFAULT_CONFIG.maxConcurrentBuilds,
    langfuse: Object.freeze({
      enabled: langfuseEnabled,
      publicKey: langfusePublicKey,
      secretKey: langfuseSecretKey,
      host: langfuseHost,
    }),
    compile: Object.freeze({
      ...DEFAULT_CONFIG.compile,
      ...fileConfig.compile,
      directPrBaseSyncConflictAttempts: resolveDirectPrBaseSyncConflictAttempts(fileConfig.compile?.directPrBaseSyncConflictAttempts),
    }),
    agents: Object.freeze({
      maxTurns: fileConfig.agents?.maxTurns ?? DEFAULT_CONFIG.agents.maxTurns,
      maxContinuations: fileConfig.agents?.maxContinuations ?? DEFAULT_CONFIG.agents.maxContinuations,
      permissionMode: fileConfig.agents?.permissionMode ?? DEFAULT_CONFIG.agents.permissionMode,
      settingSources: fileConfig.agents?.settingSources ?? DEFAULT_CONFIG.agents.settingSources,
      bare: fileConfig.agents?.bare ?? !!env.ANTHROPIC_API_KEY,
      promptDir: fileConfig.agents?.promptDir,
      tiers,
      roles: fileConfig.agents?.roles as EforgeConfig['agents']['roles'] | undefined,
    }),
    build: Object.freeze({
      worktreeDir: fileConfig.build?.worktreeDir ?? DEFAULT_CONFIG.build.worktreeDir,
      postMergeCommands: fileConfig.build?.postMergeCommands ?? DEFAULT_CONFIG.build.postMergeCommands,
      postMergeCommandTimeoutMs: fileConfig.build?.postMergeCommandTimeoutMs ?? DEFAULT_CONFIG.build.postMergeCommandTimeoutMs,
      maxValidationRetries: fileConfig.build?.maxValidationRetries ?? DEFAULT_CONFIG.build.maxValidationRetries,
      cleanupPlanFiles: fileConfig.build?.cleanupPlanFiles ?? DEFAULT_CONFIG.build.cleanupPlanFiles,
      trunkBranch: fileConfig.build?.trunkBranch,
      allowLocalMergeToTrunk: fileConfig.build?.allowLocalMergeToTrunk ?? DEFAULT_CONFIG.build.allowLocalMergeToTrunk,
      validation: Object.freeze({
        allowNoCommands: fileConfig.build?.validation?.allowNoCommands ?? false,
        noCommandsReason: fileConfig.build?.validation?.noCommandsReason,
        allowEmptyPrdDiff: fileConfig.build?.validation?.allowEmptyPrdDiff ?? false,
        emptyPrdDiffReason: fileConfig.build?.validation?.emptyPrdDiffReason,
        allowNoAcceptanceCriteria: fileConfig.build?.validation?.allowNoAcceptanceCriteria ?? false,
        noAcceptanceCriteriaReason: fileConfig.build?.validation?.noAcceptanceCriteriaReason,
        acceptanceConflictPolicy: fileConfig.build?.validation?.acceptanceConflictPolicy ?? DEFAULT_CONFIG.build.validation.acceptanceConflictPolicy,
        allowNoCommittedChanges: fileConfig.build?.validation?.allowNoCommittedChanges ?? false,
        noCommittedChangesReason: fileConfig.build?.validation?.noCommittedChangesReason,
      } as ValidationConfig),
      trunkSync: Object.freeze({
        enabled: fileConfig.build?.trunkSync?.enabled ?? DEFAULT_CONFIG.build.trunkSync.enabled,
        remote: fileConfig.build?.trunkSync?.remote ?? DEFAULT_CONFIG.build.trunkSync.remote,
        strategy: (fileConfig.build?.trunkSync?.strategy ?? DEFAULT_CONFIG.build.trunkSync.strategy) as 'fetchedRemoteRef',
        onDiverged: (fileConfig.build?.trunkSync?.onDiverged ?? DEFAULT_CONFIG.build.trunkSync.onDiverged) as 'warn' | 'fail' | 'use-remote',
      } as TrunkSyncConfig),
    }),
    plan: Object.freeze({
      outputDir: fileConfig.plan?.outputDir ?? DEFAULT_CONFIG.plan.outputDir,
    }),
    plugins: Object.freeze({
      enabled: fileConfig.plugins?.enabled ?? DEFAULT_CONFIG.plugins.enabled,
      include: fileConfig.plugins?.include,
      exclude: fileConfig.plugins?.exclude,
      paths: fileConfig.plugins?.paths,
    }),
    extensions: Object.freeze({
      enabled: fileConfig.extensions?.enabled ?? DEFAULT_CONFIG.extensions.enabled,
      eventHookTimeoutMs: fileConfig.extensions?.eventHookTimeoutMs ?? DEFAULT_CONFIG.extensions.eventHookTimeoutMs,
      agentContextHookTimeoutMs: fileConfig.extensions?.agentContextHookTimeoutMs ?? fileConfig.extensions?.eventHookTimeoutMs ?? DEFAULT_CONFIG.extensions.agentContextHookTimeoutMs,
      policyGateTimeoutMs: fileConfig.extensions?.policyGateTimeoutMs ?? fileConfig.extensions?.eventHookTimeoutMs ?? DEFAULT_CONFIG.extensions.policyGateTimeoutMs,
      policyGateFailurePolicy: fileConfig.extensions?.policyGateFailurePolicy ?? DEFAULT_CONFIG.extensions.policyGateFailurePolicy,
      profileRouterTimeoutMs: fileConfig.extensions?.profileRouterTimeoutMs ?? fileConfig.extensions?.eventHookTimeoutMs ?? DEFAULT_CONFIG.extensions.profileRouterTimeoutMs,
      validationProviderTimeoutMs: fileConfig.extensions?.validationProviderTimeoutMs ?? fileConfig.extensions?.eventHookTimeoutMs ?? DEFAULT_CONFIG.extensions.validationProviderTimeoutMs,
      include: fileConfig.extensions?.include,
      exclude: fileConfig.extensions?.exclude,
      paths: fileConfig.extensions?.paths,
    }),
    prdQueue: Object.freeze({
      dir: fileConfig.prdQueue?.dir ?? DEFAULT_CONFIG.prdQueue.dir,
      autoBuild: fileConfig.prdQueue?.autoBuild ?? DEFAULT_CONFIG.prdQueue.autoBuild,
      watchPollIntervalMs: fileConfig.prdQueue?.watchPollIntervalMs ?? DEFAULT_CONFIG.prdQueue.watchPollIntervalMs,
    }),
    daemon: Object.freeze({
      idleShutdownMs: fileConfig.daemon?.idleShutdownMs ?? DEFAULT_CONFIG.daemon.idleShutdownMs,
    }),
    monitor: Object.freeze({
      retentionCount: fileConfig.monitor?.retentionCount ?? DEFAULT_CONFIG.monitor.retentionCount,
    }),
    recovery: Object.freeze({ autoResume: Object.freeze({ enabled: fileConfig.recovery?.autoResume?.enabled ?? DEFAULT_CONFIG.recovery.autoResume.enabled, maxAttempts: fileConfig.recovery?.autoResume?.maxAttempts ?? DEFAULT_CONFIG.recovery.autoResume.maxAttempts }) }),
    hooks: Object.freeze(fileConfig.hooks ?? DEFAULT_CONFIG.hooks) as HookConfig[],
    tools: Object.freeze({
      toolbelts: fileConfig.tools?.toolbelts ?? DEFAULT_CONFIG.tools.toolbelts,
    }),
    stacking: Object.freeze({
      enabled: fileConfig.stacking?.enabled ?? DEFAULT_CONFIG.stacking.enabled,
      provider: (fileConfig.stacking?.provider ?? DEFAULT_CONFIG.stacking.provider) as 'git-spice',
      gitSpice: Object.freeze({
        command: fileConfig.stacking?.gitSpice?.command,
      }),
      sync: Object.freeze({
        afterBuild: fileConfig.stacking?.sync?.afterBuild ?? DEFAULT_CONFIG.stacking.sync.afterBuild,
      }),
    }),
    landing: Object.freeze({
      action: landingAction,
      pr: Object.freeze({
        autoMerge: fileConfig.landing?.pr?.autoMerge ?? DEFAULT_CONFIG.landing.pr.autoMerge,
      }),
      directPrBaseSync: Object.freeze({
        conflictAttempts: resolveDirectPrBaseSyncConflictAttempts(
          fileConfig.landing?.directPrBaseSync?.conflictAttempts ?? fileConfig.compile?.directPrBaseSyncConflictAttempts,
        ),
      }),
    }),
  });
}

/**
 * Resolve whether GitHub PR auto-merge should be enabled for this landing.
 *
 * Resolution rules:
 *   - `always`: enable unless the per-run `requested` flag is explicitly `false`.
 *   - `ask`:    enable only when `requested` is explicitly `true`.
 *   - `never`:  always disable regardless of `requested`.
 *
 * @param policy   - The configured `landing.pr.autoMerge` value.
 * @param requested - Per-run intent from `landingAutoMerge` option/frontmatter.
 */
export function resolvePrAutoMergeIntent(
  policy: 'ask' | 'always' | 'never',
  requested: boolean | undefined,
): boolean {
  if (policy === 'never') return false;
  if (policy === 'always') return requested !== false;
  // 'ask': only enable when explicitly requested
  return requested === true;
}

/**
 * Error thrown when config.yaml contains a legacy field that must be migrated.
 */
export class ConfigMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigMigrationError';
  }
}

/**
 * Error thrown when config.yaml or a profile YAML fails schema validation.
 * Strict-by-design: invalid fields are NOT silently dropped — the user gets
 * a clear error so the typo or schema mismatch surfaces immediately.
 */
export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

/**
 * Parse and validate a raw YAML object into a partial EforgeConfig.
 * Strict: any schema validation failure throws `ConfigValidationError`.
 * No silent dropping of invalid fields.
 *
 * @param context  `'config'` (default) for config.yaml parsing — rejects legacy fields.
 *                 `'profile'` for profile file parsing.
 */
export function parseRawConfig(data: Record<string, unknown>, context: 'config' | 'profile' = 'config'): PartialEforgeConfig {
  // Reject legacy top-level fields with a migration pointer (in both contexts).
  const offending: string[] = [];
  if (data.backend !== undefined) offending.push('backend');
  if (data.pi !== undefined) offending.push('pi');
  if (data.claudeSdk !== undefined) offending.push('claudeSdk');
  if (data.agentRuntimes !== undefined) offending.push('agentRuntimes');
  if (data.defaultAgentRuntime !== undefined) offending.push('defaultAgentRuntime');

  if (offending.length > 0) {
    const fieldList = offending.map((f) => `"${f}:"`).join(', ');
    throw new ConfigMigrationError(
      `Legacy field(s) ${fieldList} are no longer valid. ` +
      `Each tier under agents.tiers is now a self-contained recipe (harness + model + effort + tuning). ` +
      `Example:\n\n` +
      `  agents:\n` +
      `    tiers:\n` +
      `      planning:\n` +
      `        harness: claude-sdk\n` +
      `        model: claude-opus-4-7\n` +
      `        effort: high\n\n` +
      `Offending field(s): ${offending.join(', ')}. ` +
      `See docs/config-migration.md for before/after examples.`,
    );
  }

  // Reject legacy agents.models nested field with a migration pointer.
  const agentsField = data.agents as Record<string, unknown> | undefined;
  if (agentsField && typeof agentsField === 'object' && 'models' in agentsField) {
    throw new ConfigMigrationError(
      `"agents.models" is no longer supported. Each tier under agents.tiers carries its own model. ` +
      `Move per-class model ids onto the corresponding tier(s). ` +
      `See docs/config-migration.md for before/after examples.`,
    );
  }

  // Reject legacy build.onSuccess with a migration pointer.
  const buildField = data.build as Record<string, unknown> | undefined;
  if (buildField && typeof buildField === 'object' && 'onSuccess' in buildField) {
    throw new ConfigMigrationError(
      `"build.onSuccess" is no longer supported. Use "landing.action: pr|merge|leave" instead. ` +
      `Replace build.onSuccess: merge-to-base-branch → landing.action: merge, ` +
      `build.onSuccess: issue-pr → landing.action: pr, ` +
      `build.onSuccess: leave-branch → landing.action: leave.`,
    );
  }

  const result = partialEforgeConfigSchema.safeParse(data);
  const label = context === 'profile' ? 'profile' : 'config';
  if (!result.success) {
    throw new ConfigValidationError(
      `Invalid ${label}: ` + z.prettifyError(result.error),
    );
  }
  const runtimeChoiceErrors = collectRuntimeChoiceConfigErrors(result.data as { agents?: { tiers?: Record<string, unknown> } });
  if (runtimeChoiceErrors.length > 0) {
    throw new ConfigValidationError(`Invalid ${label}: ${runtimeChoiceErrors.join('; ')}`);
  }
  return stripUndefinedSections(result.data);
}

/**
 * Remove top-level keys that are undefined so that mergePartialConfigs
 * treats absent sections correctly. Driven by the base schema's shape,
 * so any future top-level config field is preserved automatically.
 */
function stripUndefinedSections(config: PartialEforgeConfig): PartialEforgeConfig {
  const out: Record<string, unknown> = {};
  const src = config as Record<string, unknown>;
  for (const key of Object.keys(eforgeConfigBaseSchema.shape)) {
    if (src[key] !== undefined) out[key] = src[key];
  }
  return out as PartialEforgeConfig;
}


/**
 * Return the path to the user-level (global) config file.
 * Respects $XDG_CONFIG_HOME when set, else falls back to ~/.config.
 */
export function getUserConfigPath(
  env: Record<string, string | undefined> = process.env,
): string {
  const base = env.XDG_CONFIG_HOME || resolve(homedir(), '.config');
  return resolve(base, 'eforge', 'config.yaml');
}

/**
 * Merge two partial configs (global + project) into one.
 * - Scalar fields: project wins over global
 * - Object sections: shallow merge per-field, project overrides global
 * - `hooks`: concatenate (global first, then project)
 * - Other arrays (postMergeCommands, plugins.include/exclude/paths, extensions.include/exclude/paths, settingSources): project replaces
 */
export function mergePartialConfigs(
  global: PartialEforgeConfig,
  project: PartialEforgeConfig,
): PartialEforgeConfig {
  const result: PartialEforgeConfig = {};

  // Scalar fields: project wins
  if (project.maxConcurrentBuilds !== undefined || global.maxConcurrentBuilds !== undefined) {
    result.maxConcurrentBuilds = project.maxConcurrentBuilds ?? global.maxConcurrentBuilds;
  }

  // Object sections: shallow merge
  if (global.langfuse || project.langfuse) {
    result.langfuse = { ...global.langfuse, ...project.langfuse };
  }
  if (global.agents || project.agents) {
    const mergedAgents: Record<string, unknown> = { ...global.agents, ...project.agents };

    // Deep-merge tiers: per-tier shallow merge so a project override of a single
    // field doesn't drop the rest of the tier from global.
    const globalTiers = global.agents?.tiers as Record<string, Record<string, unknown>> | undefined;
    const projectTiers = project.agents?.tiers as Record<string, Record<string, unknown>> | undefined;
    if (globalTiers || projectTiers) {
      const mergedTiers: Record<string, Record<string, unknown>> = {};
      const allTierNames = new Set([
        ...Object.keys(globalTiers ?? {}),
        ...Object.keys(projectTiers ?? {}),
      ]);
      for (const tierName of allTierNames) {
        const g = globalTiers?.[tierName];
        const p = projectTiers?.[tierName];
        if (g && p) {
          mergedTiers[tierName] = { ...g, ...p };
        } else {
          mergedTiers[tierName] = (p ?? g)!;
        }
      }
      mergedAgents.tiers = mergedTiers;
    }

    // Deep-merge roles: per-role shallow merge.
    const globalRoles = global.agents?.roles as Record<string, Record<string, unknown>> | undefined;
    const projectRoles = project.agents?.roles as Record<string, Record<string, unknown>> | undefined;
    if (globalRoles || projectRoles) {
      const mergedRoles: Record<string, Record<string, unknown>> = {};
      const allRoleNames = new Set([
        ...Object.keys(globalRoles ?? {}),
        ...Object.keys(projectRoles ?? {}),
      ]);
      for (const roleName of allRoleNames) {
        const g = globalRoles?.[roleName];
        const p = projectRoles?.[roleName];
        if (g && p) {
          mergedRoles[roleName] = { ...g, ...p };
        } else {
          mergedRoles[roleName] = (p ?? g)!;
        }
      }
      mergedAgents.roles = mergedRoles;
    }

    result.agents = mergedAgents as PartialEforgeConfig['agents'];
  }
  if (global.compile || project.compile) {
    result.compile = { ...global.compile, ...project.compile };
  }
  if (global.build || project.build) {
    const mergedValidation = (global.build?.validation || project.build?.validation)
      ? { ...global.build?.validation, ...project.build?.validation }
      : undefined;
    const mergedTrunkSync = (global.build?.trunkSync || project.build?.trunkSync)
      ? { ...global.build?.trunkSync, ...project.build?.trunkSync }
      : undefined;
    result.build = {
      ...global.build,
      ...project.build,
      ...(mergedValidation !== undefined ? { validation: mergedValidation } : {}),
      ...(mergedTrunkSync !== undefined ? { trunkSync: mergedTrunkSync } : {}),
    };
  }
  if (global.plan || project.plan) {
    result.plan = { ...global.plan, ...project.plan };
  }
  if (global.recovery || project.recovery) {
    const mergedAutoResume = (global.recovery?.autoResume || project.recovery?.autoResume)
      ? { ...global.recovery?.autoResume, ...project.recovery?.autoResume }
      : undefined;
    result.recovery = {
      ...global.recovery,
      ...project.recovery,
      ...(mergedAutoResume !== undefined ? { autoResume: mergedAutoResume } : {}),
    };
  }
  if (global.plugins || project.plugins) {
    result.plugins = { ...global.plugins, ...project.plugins };
  }
  if (global.extensions || project.extensions) {
    result.extensions = { ...global.extensions, ...project.extensions };
  }
  if (global.prdQueue || project.prdQueue) {
    result.prdQueue = { ...global.prdQueue, ...project.prdQueue };
  }
  if (global.daemon || project.daemon) {
    result.daemon = { ...global.daemon, ...project.daemon };
  }
  if (global.monitor || project.monitor) {
    result.monitor = { ...global.monitor, ...project.monitor };
  }

  // hooks: concatenate (global first, then project)
  if (global.hooks || project.hooks) {
    result.hooks = [...(global.hooks ?? []), ...(project.hooks ?? [])];
  }

  // tools.toolbelts: deep-merge by name (project wins per toolbelt)
  if (global.tools || project.tools) {
    const globalToolbelts = global.tools?.toolbelts ?? {};
    const projectToolbelts = project.tools?.toolbelts ?? {};
    result.tools = {
      toolbelts: { ...globalToolbelts, ...projectToolbelts },
    };
  }

  if (global.stacking || project.stacking) {
    const mergedGitSpice = (global.stacking?.gitSpice || project.stacking?.gitSpice)
      ? { ...global.stacking?.gitSpice, ...project.stacking?.gitSpice }
      : undefined;
    const mergedSync = (global.stacking?.sync || project.stacking?.sync)
      ? { ...global.stacking?.sync, ...project.stacking?.sync }
      : undefined;
    result.stacking = {
      ...global.stacking,
      ...project.stacking,
      ...(mergedGitSpice !== undefined ? { gitSpice: mergedGitSpice } : {}),
      ...(mergedSync !== undefined ? { sync: mergedSync } : {}),
    };
  }
  if (global.landing || project.landing) {
    result.landing = { ...global.landing, ...project.landing };
  }

  return result;
}

/**
 * Load the user-level (global) config file.
 * Returns an empty partial on any failure (missing file, bad YAML, etc.).
 */
export async function loadUserConfig(
  env: Record<string, string | undefined> = process.env,
): Promise<PartialEforgeConfig> {
  const configPath = getUserConfigPath(env);
  let raw: string;
  try {
    raw = await readFile(configPath, 'utf-8');
  } catch (err) {
    // Missing user-level global config is fine — most users don't have one.
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return {};
    throw err;
  }
  const data = parseYaml(raw);
  if (!data || typeof data !== 'object') return {};
  return parseRawConfig(data as Record<string, unknown>);
}

/**
 * Read and parse `eforge/config.yaml` from a config directory.
 * Returns `{}` when the file does not exist (ENOENT).
 * Propagates `ConfigMigrationError` and `ConfigValidationError` so callers
 * surface clear errors instead of silently falling back to an empty baseline.
 */
async function readProjectConfigOrEmpty(configDir: string): Promise<PartialEforgeConfig> {
  const cfgPath = resolve(configDir, 'config.yaml');
  let raw: string;
  try {
    raw = await readFile(cfgPath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return {};
    throw err;
  }
  const data = parseYaml(raw);
  if (!data || typeof data !== 'object') return {};
  return parseRawConfig(data as Record<string, unknown>);
}

/**
 * Load eforge/config.yaml from the given directory (searching upward),
 * merged with user-level global config (~/.config/eforge/config.yaml).
 * Returns DEFAULT_CONFIG when no config files exist.
 *
 * When an active profile is found (via `eforge/.active-profile`
 * marker), the profile is merged on top of the project config before
 * env-var resolution.
 *
 * Throws `ConfigMigrationError` if a legacy `eforge.yaml` is detected at
 * the start directory and no `eforge/config.yaml` is found.
 */
export async function loadConfig(cwd?: string, options?: { profileOverride?: string }): Promise<{ config: EforgeConfig; warnings: string[]; profile: { name: string | null; source: ActiveProfileSource; scope: 'local' | 'project' | 'user' | null; config: PartialEforgeConfig | null } }> {
  const allWarnings: string[] = [];

  const startDir = cwd ?? process.cwd();
  const configPath = await findConfigFile(startDir);

  // Detect legacy eforge.yaml and abort with a migration error
  if (!configPath) {
    const legacyCandidate = resolve(startDir, 'eforge.yaml');
    try {
      await access(legacyCandidate);
      throw new ConfigMigrationError(
        `Found legacy config at ${legacyCandidate}. ` +
        `eforge/config.yaml is now required. ` +
        `Run: mkdir -p eforge && mv eforge.yaml eforge/config.yaml`,
      );
    } catch (err) {
      if (err instanceof ConfigMigrationError) throw err;
      // no legacy config either — continue with defaults
    }
  }

  // Establish configDir and projectRoot early (needed for resolveLayeredSingletons)
  const projectRoot = configPath ? dirname(dirname(configPath)) : startDir;
  const configDir = configPath ? dirname(configPath) : projectRoot;

  // Auto-migrate eforge/backends/ -> eforge/profiles/ on first load after upgrade
  if (configPath) {
    try {
      await migrateBackendsToProfiles(configDir);
    } catch {
      // best-effort: migration failure should not break config loading
    }
  }
  // Auto-migrate user-scope backends/ -> profiles/ (always, independent of project config)
  try {
    await migrateUserBackendsToProfiles();
  } catch {
    // best-effort: migration failure should not break config loading
  }

  // Load all config.yaml layers via resolveLayeredSingletons (user → project-team → project-local)
  let globalConfig: PartialEforgeConfig = {};
  let projectConfig: PartialEforgeConfig = {};
  let localConfig: PartialEforgeConfig = {};
  const configYamlLayers = await resolveLayeredSingletons('config.yaml', { cwd: projectRoot, configDir });
  for (const { scope, path } of configYamlLayers) {
    const raw = await readFile(path, 'utf-8');
    const data = parseYaml(raw);
    if (data && typeof data === 'object') {
      const partial = parseRawConfig(data as Record<string, unknown>);
      if (scope === 'user') globalConfig = partial;
      else if (scope === 'project-team') {
        projectConfig = partial;
      } else localConfig = partial;
    }
  }

  let profileConfig: PartialEforgeConfig | null = null;
  let resolvedProfileName: string | null = null;
  let resolvedProfileSource: ActiveProfileSource = 'none';
  let resolvedProfileScope: 'local' | 'project' | 'user' | null = null;
  if (options?.profileOverride) {
    // Short-circuit marker chain — load named profile directly, no fallback.
    const overrideName = options.profileOverride;
    const result = await loadProfile(configDir, overrideName, projectRoot);
    if (!result) {
      throw new Error(
        `Profile override '${overrideName}' not found in any scope (searched: project-local <.eforge/profiles/>, project-team <eforge/profiles/>, user <~/.config/eforge/profiles/>)`,
      );
    }
    resolvedProfileName = overrideName;
    resolvedProfileSource = 'override';
    profileConfig = result.profile;
    resolvedProfileScope = result.scope;
  } else {
    const { name, source, warnings } = await resolveActiveProfileName(configDir, projectConfig, globalConfig, projectRoot);
    allWarnings.push(...warnings);
    resolvedProfileName = name;
    resolvedProfileSource = source;
    if (name) {
      const result = await loadProfile(configDir, name, projectRoot);
      if (result) {
        profileConfig = result.profile;
        resolvedProfileScope = result.scope;
      }
    }
  }

  // Merge sequence: user → project → local (three-tier deep merge)
  const baseMerged = mergePartialConfigs(mergePartialConfigs(globalConfig, projectConfig), localConfig);
  const merged = profileConfig ? mergePartialConfigs(baseMerged, profileConfig) : baseMerged;
  assertMergedRuntimeChoiceConfig(merged as { agents?: { tiers?: Record<string, unknown> } });

  // Toolbelt static validation — fatal: any reference error throws ConfigValidationError
  // so the engine refuses to boot with broken toolbelt configuration.
  if (configPath) {
    let mcpProbe: { exists: boolean; names: string[] } | null = null;
    try {
      mcpProbe = await loadProjectMcpServerNames(projectRoot);
    } catch {
      // best-effort: if .mcp.json can't be read, skip MCP checks
    }
    const toolbeltErrors = validateToolbeltReferences(merged, mcpProbe);
    if (toolbeltErrors.length > 0) {
      throw new ConfigValidationError(
        `Toolbelt reference errors:\n  - ${toolbeltErrors.join('\n  - ')}`,
      );
    }
  }


  return {
    config: resolveConfig(merged),
    warnings: allWarnings,
    profile: {
      name: resolvedProfileName,
      source: resolvedProfileSource,
      scope: resolvedProfileScope,
      config: profileConfig,
    },
  };
}

// ---------------------------------------------------------------------------
// Profile Loader
// ---------------------------------------------------------------------------

/**
 * Source of the active profile resolution.
 */
export type ActiveProfileSource = 'local' | 'project' | 'user-local' | 'missing' | 'none' | 'override';

/** Marker filename inside the eforge config directory. */
const ACTIVE_PROFILE_MARKER = '.active-profile';

/** Profile subdirectory inside the eforge config directory. */
const PROFILES_SUBDIR = 'profiles';


function profilePath(configDir: string, name: string): string {
  return resolve(configDir, PROFILES_SUBDIR, `${name}.yaml`);
}

function profilesDir(configDir: string): string {
  return resolve(configDir, PROFILES_SUBDIR);
}

function markerPath(configDir: string): string {
  return resolve(configDir, ACTIVE_PROFILE_MARKER);
}


/** Return the user-scope profiles directory (~/.config/eforge/profiles/). */
function userProfilesDir(): string {
  return resolve(userEforgeConfigDir(), PROFILES_SUBDIR);
}

/** Return the path to a user-scope profile file. */
function userProfilePath(name: string): string {
  return resolve(userProfilesDir(), `${name}.yaml`);
}

/** Return the path to the user-scope active-profile marker file. */
function userMarkerPath(): string {
  return resolve(userEforgeConfigDir(), ACTIVE_PROFILE_MARKER);
}

// ---------------------------------------------------------------------------
// Project-local tier paths (.eforge/ inside project root — gitignored)
// ---------------------------------------------------------------------------

/** Return the project-local scope root directory (<cwd>/.eforge/). */
function localScopeDir(cwd: string): string {
  return getScopeDirectory('project-local', { cwd, configDir: '' });
}

/** Return the project-local profiles directory (<cwd>/.eforge/profiles/). */
function localProfilesDir(cwd: string): string {
  return resolve(localScopeDir(cwd), PROFILES_SUBDIR);
}

/** Return the path to a project-local profile file. */
function localProfilePath(cwd: string, name: string): string {
  return resolve(localScopeDir(cwd), PROFILES_SUBDIR, `${name}.yaml`);
}

/** Return the path to the project-local active-profile marker file. */
function localMarkerPath(cwd: string): string {
  return resolve(localScopeDir(cwd), ACTIVE_PROFILE_MARKER);
}

/** Check whether a profile file exists in local, project, or user scope. */
async function profileExistsInAnyScope(configDir: string, name: string, cwd?: string): Promise<boolean> {
  const effectiveCwd = cwd ?? dirname(configDir);
  if (await fileExists(localProfilePath(effectiveCwd, name))) return true;
  if (await fileExists(profilePath(configDir, name))) return true;
  if (await fileExists(userProfilePath(name))) return true;
  return false;
}

/** Read a marker file and return the trimmed name, or null if absent/empty. */
async function readMarkerName(path: string): Promise<string | null> {
  try {
    const raw = await readFile(path, 'utf-8');
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Auto-migrate `eforge/backends/` -> `eforge/profiles/` and
 * `.active-backend` -> `.active-profile` on first load after upgrade.
 */
async function migrateBackendsToProfiles(configDir: string): Promise<void> {
  const oldDir = resolve(configDir, 'backends');
  const newDir = profilesDir(configDir);
  const oldMarker = resolve(configDir, '.active-backend');
  const newMarker = markerPath(configDir);

  const [oldDirExists, newDirExists, oldMarkerExists, newMarkerExists] = await Promise.all([
    fileExists(oldDir),
    fileExists(newDir),
    fileExists(oldMarker),
    fileExists(newMarker),
  ]);

  if (!oldDirExists) {
    if (newDirExists && oldMarkerExists && !newMarkerExists) {
      try {
        await rename(oldMarker, newMarker);
        process.stderr.write('[eforge] Migrated orphaned eforge/.active-backend -> .active-profile\n');
      } catch {
        process.stderr.write(
          '[eforge] Failed to migrate orphaned eforge/.active-backend marker. ' +
          'To fix manually, run: mv eforge/.active-backend eforge/.active-profile\n',
        );
      }
    }
    return;
  }

  if (newDirExists) {
    process.stderr.write(
      '[eforge] Both eforge/backends/ and eforge/profiles/ exist. ' +
      'Migration skipped; please resolve manually and remove eforge/backends/.\n',
    );
    return;
  }

  const projectRoot = dirname(configDir);
  let migrated = false;
  try {
    await execFileAsync('git', ['-C', projectRoot, 'mv', 'eforge/backends', 'eforge/profiles']);
    migrated = true;
  } catch {
    try {
      await rename(oldDir, newDir);
      migrated = true;
    } catch {
      process.stderr.write('[eforge] Failed to migrate eforge/backends/ to eforge/profiles/.\n');
      return;
    }
  }

  if (migrated) {
    process.stderr.write('[eforge] Migrated eforge/backends/ -> eforge/profiles/\n');

    if (oldMarkerExists) {
      try {
        await rename(oldMarker, newMarker);
        process.stderr.write('[eforge] Migrated .active-backend -> .active-profile\n');
      } catch {
        process.stderr.write(
          '[eforge] Failed to migrate .active-backend marker. ' +
          'To fix manually, run: mv eforge/.active-backend eforge/.active-profile\n',
        );
      }
    }
  }
}

/**
 * Auto-migrate user-scope `~/.config/eforge/backends/` -> `~/.config/eforge/profiles/`.
 */
async function migrateUserBackendsToProfiles(): Promise<void> {
  const userDir = userEforgeConfigDir();
  const oldDir = resolve(userDir, 'backends');
  const newDir = userProfilesDir();
  const oldMarker = resolve(userDir, '.active-backend');
  const newMarker = userMarkerPath();

  const [oldDirExists, newDirExists, oldMarkerExists, newMarkerExists] = await Promise.all([
    fileExists(oldDir),
    fileExists(newDir),
    fileExists(oldMarker),
    fileExists(newMarker),
  ]);

  if (!oldDirExists) {
    if (newDirExists && oldMarkerExists && !newMarkerExists) {
      try {
        await rename(oldMarker, newMarker);
        process.stderr.write('[eforge] Migrated orphaned ~/.config/eforge/.active-backend -> .active-profile\n');
      } catch {
        process.stderr.write(
          '[eforge] Failed to migrate orphaned ~/.config/eforge/.active-backend marker. ' +
          'To fix manually, run: mv ~/.config/eforge/.active-backend ~/.config/eforge/.active-profile\n',
        );
      }
    }
    return;
  }

  if (newDirExists) {
    process.stderr.write(
      '[eforge] Both ~/.config/eforge/backends/ and ~/.config/eforge/profiles/ exist. ' +
      'Migration skipped; please resolve manually and remove ~/.config/eforge/backends/.\n',
    );
    return;
  }

  try {
    await rename(oldDir, newDir);
  } catch {
    process.stderr.write('[eforge] Failed to migrate ~/.config/eforge/backends/ to ~/.config/eforge/profiles/.\n');
    return;
  }

  process.stderr.write('[eforge] Migrated ~/.config/eforge/backends/ -> ~/.config/eforge/profiles/\n');

  if (oldMarkerExists) {
    try {
      await rename(oldMarker, newMarker);
      process.stderr.write('[eforge] Migrated ~/.config/eforge/.active-backend -> .active-profile\n');
    } catch {
      process.stderr.write(
        '[eforge] Failed to migrate ~/.config/eforge/.active-backend marker. ' +
        'To fix manually, run: mv ~/.config/eforge/.active-backend ~/.config/eforge/.active-profile\n',
      );
    }
  }
}

/**
 * Return the directory containing `eforge/config.yaml` from the given start
 * directory, or null when no config file is found.
 */
export async function getConfigDir(cwd?: string): Promise<string | null> {
  const startDir = cwd ?? process.cwd();
  const configPath = await findConfigFile(startDir);
  return configPath ? dirname(configPath) : null;
}

// Conventional project config dir relative to a working directory. Used when no
// config has been discovered yet (e.g. during init or profile listing) and a
// caller needs to synthesize the path that init would create.
export function getConventionalConfigDir(cwd?: string): string {
  return resolve(cwd ?? process.cwd(), 'eforge');
}

/**
 * Resolve the active agent runtime profile name and how it was selected.
 */
export async function resolveActiveProfileName(
  configDir: string,
  projectConfig: PartialEforgeConfig,
  userConfig?: PartialEforgeConfig,
  cwd?: string,
): Promise<{ name: string | null; source: ActiveProfileSource; warnings: string[] }> {
  const warnings: string[] = [];
  const effectiveCwd = cwd ?? dirname(configDir);

  // Step 0: Local marker
  const localMarkerName = await readMarkerName(localMarkerPath(effectiveCwd));
  if (localMarkerName !== null) {
    if (await profileExistsInAnyScope(configDir, localMarkerName, effectiveCwd)) {
      return { name: localMarkerName, source: 'local', warnings };
    }
    warnings.push(
      `[eforge] Active profile marker ${localMarkerPath(effectiveCwd)} points at ` +
      `"${localMarkerName}" but no profile file exists in any scope. ` +
      `Falling back to next available source.`,
    );
  }

  // Step 1: Project marker
  const projectMarkerName = await readMarkerName(markerPath(configDir));

  if (projectMarkerName !== null) {
    if (await profileExistsInAnyScope(configDir, projectMarkerName, effectiveCwd)) {
      return { name: projectMarkerName, source: 'project', warnings };
    }
    warnings.push(
      `[eforge] Active profile marker ${markerPath(configDir)} points at ` +
      `"${projectMarkerName}" but no profile file exists in any scope. ` +
      `Falling back to next available source.`,
    );
    const userMarker = await readMarkerName(userMarkerPath());
    if (userMarker && await profileExistsInAnyScope(configDir, userMarker, effectiveCwd)) {
      return { name: userMarker, source: 'user-local', warnings };
    }
    return { name: null, source: 'missing', warnings };
  }

  // Step 2: User marker
  const userMarker = await readMarkerName(userMarkerPath());
  if (userMarker && await profileExistsInAnyScope(configDir, userMarker, effectiveCwd)) {
    return { name: userMarker, source: 'user-local', warnings };
  }

  // Step 3: None
  return { name: null, source: 'none', warnings };
}

/**
 * Load and parse an agent runtime profile file from a specific path. Returns null
 * when the file does not exist. Throws if the file exists but is invalid
 * (malformed YAML or schema validation failure).
 *
 * The returned profile object carries metadata fields (description, whenToUse, tags)
 * at runtime alongside the config fields, so that extractProfileMetadata() works on
 * the opaque profile value passed through the daemon boundary.
 */
async function loadProfileFromPath(path: string): Promise<{ profile: PartialEforgeConfig; metadata?: ProfileMetadata } | null> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw err;
  }
  const data = parseYaml(raw);
  if (!data || typeof data !== 'object') return { profile: {} };

  const rawData = data as Record<string, unknown>;

  // Reject legacy top-level fields with a migration pointer (same as parseRawConfig).
  const offending: string[] = [];
  if (rawData.backend !== undefined) offending.push('backend');
  if (rawData.pi !== undefined) offending.push('pi');
  if (rawData.claudeSdk !== undefined) offending.push('claudeSdk');
  if (rawData.agentRuntimes !== undefined) offending.push('agentRuntimes');
  if (rawData.defaultAgentRuntime !== undefined) offending.push('defaultAgentRuntime');

  if (offending.length > 0) {
    const fieldList = offending.map((f) => `"${f}:"`).join(', ');
    throw new ConfigMigrationError(
      `Legacy field(s) ${fieldList} are no longer valid. ` +
      `Each tier under agents.tiers is now a self-contained recipe (harness + model + effort + tuning). ` +
      `Offending field(s): ${offending.join(', ')}. ` +
      `See docs/config-migration.md for before/after examples.`,
    );
  }

  // Reject legacy agents.models nested field.
  const agentsField = rawData.agents as Record<string, unknown> | undefined;
  if (agentsField && typeof agentsField === 'object' && 'models' in agentsField) {
    throw new ConfigMigrationError(
      `"agents.models" is no longer supported. Each tier under agents.tiers carries its own model. ` +
      `See docs/config-migration.md for before/after examples.`,
    );
  }

  // Reject legacy build.onSuccess in profiles with the same migration guidance
  // as config.yaml. The profile schema would otherwise strip unknown nested
  // build keys before validation completes.
  if (hasLegacyBuildOnSuccess(rawData)) {
    throw new ConfigMigrationError(LEGACY_BUILD_ON_SUCCESS_MIGRATION_MESSAGE);
  }

  // Parse with profile-aware schema that accepts metadata fields.
  const result = profileFileSchema.safeParse(data);
  if (!result.success) {
    throw new ConfigValidationError(
      'Invalid profile: ' + z.prettifyError(result.error),
    );
  }

  const parsed = result.data as ProfileFileData;
  // Build the runtime profile object: known config fields + metadata fields.
  // Config fields are stripped of undefined values (same as stripUndefinedSections).
  // Metadata fields are preserved so extractProfileMetadata() works on the opaque value.
  const profileObj: Record<string, unknown> = {};
  for (const key of Object.keys(eforgeConfigBaseSchema.shape)) {
    const val = (parsed as Record<string, unknown>)[key];
    if (val !== undefined) profileObj[key] = val;
  }
  if (parsed.description !== undefined) profileObj.description = parsed.description;
  if (parsed.whenToUse !== undefined) profileObj.whenToUse = parsed.whenToUse;
  if (parsed.tags !== undefined) profileObj.tags = parsed.tags;

  const metadata = extractProfileMetadata(profileObj);
  return { profile: profileObj as PartialEforgeConfig, metadata };
}

/**
 * Load and parse a profile file. Looks up local / project / user scope.
 */
export async function loadProfile(
  configDir: string,
  name: string,
  cwd?: string,
): Promise<{ profile: PartialEforgeConfig; metadata?: ProfileMetadata; scope: 'local' | 'project' | 'user' } | null> {
  const effectiveCwd = cwd ?? dirname(configDir);
  const profiles = await resolveNamedSet('profiles', { cwd: effectiveCwd, configDir, extension: 'yaml' });
  const artifact = profiles.get(name);
  if (!artifact) return null;
  const result = await loadProfileFromPath(artifact.path);
  if (result === null) return null;
  const scope = artifact.scope === 'project-local' ? 'local'
    : artifact.scope === 'project-team' ? 'project'
    : 'user';
  return { profile: result.profile, metadata: result.metadata, scope };
}

/** Shared entry type returned by scanProfilesDir. */
type ScannedProfileEntry = { name: string; harness: 'claude-sdk' | 'pi' | undefined; path: string; scope: 'local' | 'project' | 'user'; metadata?: ProfileMetadata };

/**
 * Scan a profiles directory and return an entry for each `.yaml` file.
 *
 * Harness inference: walks the parsed yaml's tier recipes (when present)
 * and returns the most common harness; otherwise falls back to undefined.
 * Legacy profiles using `backend:` are still recognized for harness inference.
 */
async function scanProfilesDir(dir: string, scope: 'local' | 'project' | 'user'): Promise<ScannedProfileEntry[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const out: ScannedProfileEntry[] = [];
  for (const entry of entries.sort()) {
    if (extname(entry) !== '.yaml') continue;
    const name = basename(entry, '.yaml');
    const path = resolve(dir, entry);
    let harness: 'claude-sdk' | 'pi' | undefined;
    let metadata: ProfileMetadata | undefined;
    try {
      const raw = await readFile(path, 'utf-8');
      const data = parseYaml(raw);
      if (data && typeof data === 'object') {
        const raw_data = data as Record<string, unknown>;
        // Prefer the new shape: agents.tiers.<tier>.harness
        const agents = raw_data.agents as Record<string, unknown> | undefined;
        const tiers = agents?.tiers as Record<string, unknown> | undefined;
        if (tiers) {
          for (const tierData of Object.values(tiers)) {
            if (tierData && typeof tierData === 'object') {
              const h = (tierData as Record<string, unknown>).harness;
              const parsed = harnessTypeSchema.safeParse(h);
              if (parsed.success) { harness = parsed.data; break; }
            }
          }
        }
        // Legacy fallback: backend:
        if (harness === undefined) {
          const harnessVal = raw_data.harness ?? raw_data.backend;
          const parsed = harnessTypeSchema.safeParse(harnessVal);
          if (parsed.success) harness = parsed.data;
        }
        metadata = extractProfileMetadata(raw_data);
      }
    } catch {
      // unreadable — still include the entry with harness=undefined
    }
    out.push({ name, harness, path, scope, metadata });
  }
  return out;
}

/**
 * List all profile files from local / project / user scopes.
 */
export async function listProfiles(
  configDir: string,
  cwd?: string,
): Promise<Array<{ name: string; harness: 'claude-sdk' | 'pi' | undefined; path: string; scope: 'local' | 'project' | 'user'; shadowedBy?: 'local' | 'project'; metadata?: ProfileMetadata }>> {
  type ProfileEntry = { name: string; harness: 'claude-sdk' | 'pi' | undefined; path: string; scope: 'local' | 'project' | 'user'; shadowedBy?: 'local' | 'project'; metadata?: ProfileMetadata };
  const effectiveCwd = cwd ?? dirname(configDir);

  const scopeOpts = { cwd: effectiveCwd, configDir };
  const localEntries = await scanProfilesDir(resolve(getScopeDirectory('project-local', scopeOpts), PROFILES_SUBDIR), 'local') as ProfileEntry[];
  const projectEntries = await scanProfilesDir(resolve(getScopeDirectory('project-team', scopeOpts), PROFILES_SUBDIR), 'project') as ProfileEntry[];
  const userEntries = await scanProfilesDir(resolve(getScopeDirectory('user', scopeOpts), PROFILES_SUBDIR), 'user') as ProfileEntry[];

  const localNames = new Set(localEntries.map((e) => e.name));
  const projectNames = new Set(projectEntries.map((e) => e.name));

  for (const entry of projectEntries) {
    if (localNames.has(entry.name)) {
      entry.shadowedBy = 'local';
    }
  }
  for (const entry of userEntries) {
    if (localNames.has(entry.name)) {
      entry.shadowedBy = 'local';
    } else if (projectNames.has(entry.name)) {
      entry.shadowedBy = 'project';
    }
  }

  return [...localEntries, ...projectEntries, ...userEntries];
}

/**
 * List all profile files from only the user scope.
 */
export async function listUserProfiles(): Promise<Array<{ name: string; harness: 'claude-sdk' | 'pi' | undefined; path: string; scope: 'user'; metadata?: ProfileMetadata }>> {
  const entries = await scanProfilesDir(userProfilesDir(), 'user');
  return entries as Array<{ name: string; harness: 'claude-sdk' | 'pi' | undefined; path: string; scope: 'user'; metadata?: ProfileMetadata }>;
}

/**
 * Resolve the active profile from the user-scope marker only.
 */
export async function resolveUserActiveProfile(): Promise<{ name: string | null; source: 'user-local' | 'none'; warnings: string[] }> {
  const warnings: string[] = [];
  const markerName = await readMarkerName(userMarkerPath());
  if (markerName !== null) {
    if (await fileExists(userProfilePath(markerName))) {
      return { name: markerName, source: 'user-local', warnings };
    }
    warnings.push(
      `[eforge] Active profile marker ${userMarkerPath()} points at ` +
      `"${markerName}" but no profile file exists in user scope. ` +
      `Falling back to next available source.`,
    );
    return { name: null, source: 'none', warnings };
  }
  return { name: null, source: 'none', warnings };
}

/**
 * Load a user-scope profile by name from `~/.config/eforge/profiles/`.
 */
export async function loadUserProfile(name: string): Promise<{ profile: PartialEforgeConfig; metadata?: ProfileMetadata; scope: 'user' } | null> {
  const result = await loadProfileFromPath(userProfilePath(name));
  if (result !== null) {
    return { profile: result.profile, metadata: result.metadata, scope: 'user' };
  }
  return null;
}

/**
 * Set the active profile by writing the marker file atomically.
 */
export async function setActiveProfile(
  configDir: string,
  name: string,
  opts?: { scope?: 'local' | 'project' | 'user' },
  cwd?: string,
): Promise<void> {
  const scope = opts?.scope ?? 'project';
  const effectiveCwd = cwd ?? dirname(configDir);
  name = name.trim();
  if (name.length === 0) {
    throw new Error('Profile name must be a non-empty string');
  }

  if (!(await profileExistsInAnyScope(configDir, name, effectiveCwd))) {
    throw new Error(`Profile "${name}" not found in local, project, or user scope`);
  }

  // Validate that the merged result passes the schema. Strict.
  const globalConfig = await loadUserConfig();
  const projectConfig = await readProjectConfigOrEmpty(configDir);

  const profileResult = await loadProfile(configDir, name, effectiveCwd);
  if (!profileResult) {
    throw new Error(`Profile "${name}" could not be parsed`);
  }

  const baseMerged = mergePartialConfigs(globalConfig, projectConfig);
  const merged = mergePartialConfigs(baseMerged, profileResult.profile);

  const result = eforgeConfigSchema.safeParse(merged);
  if (!result.success) {
    throw new Error(
      `Profile "${name}" produces an invalid merged config: ` +
      z.prettifyError(result.error),
    );
  }
  assertMergedRuntimeChoiceConfig(merged as { agents?: { tiers?: Record<string, unknown> } }, `profile "${name}" merged config`);

  // Toolbelt cross-reference validation
  const projectRoot = dirname(configDir);
  let mcpProbe: { exists: boolean; names: string[] } | null = null;
  try {
    mcpProbe = await loadProjectMcpServerNames(projectRoot);
  } catch {
    // best-effort
  }
  const toolbeltErrors = validateToolbeltReferences(merged, mcpProbe);
  if (toolbeltErrors.length > 0) {
    throw new Error(
      `Profile "${name}" has toolbelt reference errors:\n` +
      toolbeltErrors.map((e) => `  - ${e}`).join('\n'),
    );
  }

  const target = scope === 'user' ? userMarkerPath()
    : scope === 'local' ? localMarkerPath(effectiveCwd)
    : markerPath(configDir);
  await mkdir(dirname(target), { recursive: true });
  const tmp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, `${name}\n`, 'utf-8');
  await rename(tmp, target);
}

/**
 * Input for `createAgentRuntimeProfile`.
 *
 * The new shape carries `agents.tiers` recipes directly. Callers that still
 * pass the legacy single-runtime shape should be updated to the new tier shape.
 */
export type CreateProfileInput = {
  name: string;
  agents?: PartialEforgeConfig['agents'];
  metadata?: ProfileMetadata;
  overwrite?: boolean;
  scope?: 'local' | 'project' | 'user';
};

/**
 * Create an agent runtime profile file. Validates the partial-config shape and
 * the merged result before writing.
 */
export async function createAgentRuntimeProfile(
  configDir: string,
  input: CreateProfileInput,
  cwd?: string,
): Promise<{ path: string }> {
  const { name, agents, metadata, overwrite, scope: inputScope } = input;
  const scope = inputScope ?? 'project';
  const effectiveCwd = cwd ?? dirname(configDir);
  if (!name || typeof name !== 'string' || !/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new Error(
      `Invalid profile name "${name}": must contain only letters, digits, dot, underscore, or dash.`,
    );
  }

  const targetDir = scope === 'user' ? userProfilesDir()
    : scope === 'local' ? localProfilesDir(effectiveCwd)
    : profilesDir(configDir);
  const path = resolve(targetDir, `${name}.yaml`);
  if (await fileExists(path)) {
    if (!overwrite) {
      throw new Error(`Profile "${name}" already exists at ${path}. Pass overwrite: true to replace it.`);
    }
  }

  const partial: PartialEforgeConfig = {};
  if (agents !== undefined) partial.agents = agents as PartialEforgeConfig['agents'];

  // Validate the config portion against the partial schema first.
  const partialResult = partialEforgeConfigSchema.safeParse(partial);
  if (!partialResult.success) {
    throw new Error(
      `Profile "${name}" failed partial-config validation: ` +
      z.prettifyError(partialResult.error),
    );
  }

  // Validate metadata separately if provided.
  if (metadata !== undefined) {
    const metadataResult = profileMetadataSchema.safeParse(metadata);
    if (!metadataResult.success) {
      throw new ConfigValidationError(
        `Profile "${name}" failed metadata validation: ` +
        z.prettifyError(metadataResult.error),
      );
    }
  }

  // Validate against the merged schema (global + project + profile).
  const globalConfig = await loadUserConfig();
  const projectConfig = await readProjectConfigOrEmpty(configDir);

  const baseMerged = mergePartialConfigs(globalConfig, projectConfig);
  const merged = mergePartialConfigs(baseMerged, partialResult.data);
  const mergedResult = eforgeConfigSchema.safeParse(merged);
  if (!mergedResult.success) {
    throw new Error(
      `Profile "${name}" produces an invalid merged config: ` +
      z.prettifyError(mergedResult.error),
    );
  }
  assertMergedRuntimeChoiceConfig(merged as { agents?: { tiers?: Record<string, unknown> } }, `profile "${name}" merged config`);

  // Toolbelt cross-reference validation
  const createProfileProjectRoot = dirname(configDir);
  let createProfileMcpProbe: { exists: boolean; names: string[] } | null = null;
  try {
    createProfileMcpProbe = await loadProjectMcpServerNames(createProfileProjectRoot);
  } catch {
    // best-effort
  }
  const createToolbeltErrors = validateToolbeltReferences(merged, createProfileMcpProbe);
  if (createToolbeltErrors.length > 0) {
    throw new Error(
      `Profile "${name}" has toolbelt reference errors:\n` +
      createToolbeltErrors.map((e) => `  - ${e}`).join('\n'),
    );
  }

  // Build the YAML output: config fields + optional metadata fields.
  const yamlData: Record<string, unknown> = { ...stripUndefinedSections(partialResult.data) };
  if (metadata?.description !== undefined) yamlData.description = metadata.description;
  if (metadata?.whenToUse !== undefined) yamlData.whenToUse = metadata.whenToUse;
  if (metadata?.tags !== undefined) yamlData.tags = metadata.tags;

  const yamlOut = stringifyYaml(yamlData);

  await mkdir(targetDir, { recursive: true });
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, yamlOut, 'utf-8');
  await rename(tmp, path);

  // Round-trip verify: parse the written file and re-validate using the profile-aware schema.
  try {
    const verifyRaw = await readFile(path, 'utf-8');
    const verifyData = parseYaml(verifyRaw);
    if (verifyData && typeof verifyData === 'object') {
      const verifyResult = profileFileSchema.safeParse(verifyData);
      if (!verifyResult.success) {
        throw new Error(
          `Profile "${name}" failed round-trip validation after write: ` +
          z.prettifyError(verifyResult.error),
        );
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith(`Profile "${name}"`)) {
      throw err;
    }
    // ignore verify-read errors
  }

  return { path };
}

// Re-export profile utilities from the shared client package
export { sanitizeProfileName, parseRawConfigLegacy } from '@eforge-build/client';

/**
 * Spec passed to `deriveProfileName` describing the tier recipes for which a
 * deterministic profile name should be computed.
 */
export interface DeriveProfileNameSpec {
  agents?: {
    tiers?: Partial<Record<AgentTier, { harness?: 'claude-sdk' | 'pi'; pi?: { provider?: string }; model?: string }>>;
  };
}

/**
 * Sanitize a raw string into a valid profile-name fragment by lowercasing,
 * replacing dots with dashes, stripping `claude-` prefix from model IDs, and
 * collapsing repeated dashes.
 */
function sanitizeFragment(raw: string): string {
  return raw.toLowerCase().replace(/\./g, '-').replace(/^claude-/, '').replace(/-{2,}/g, '-');
}

/**
 * Derive a deterministic profile name from a multi-tier spec.
 *
 * Rules:
 * - All tiers share the same model id → `<sanitized-model-id>`.
 * - Tiers share the same harness (and provider) but mixed model ids → `<harness>` or `<harness>-<provider>`.
 * - Tiers use multiple harnesses → `mixed-<planning-harness>` (or planning-harness-provider).
 */
export function deriveProfileName(spec: DeriveProfileNameSpec): string {
  const tiers = spec.agents?.tiers ?? {};
  const tierEntries = Object.values(tiers).filter((t): t is NonNullable<typeof t> => !!t);

  if (tierEntries.length === 0) {
    return 'default';
  }

  const harnesses = new Set(tierEntries.map((t) => t.harness ?? 'claude-sdk'));
  const modelIds = new Set(tierEntries.map((t) => t.model).filter((m): m is string => !!m));

  // Multiple harnesses → mixed
  if (harnesses.size > 1) {
    const planningTier = tiers.planning ?? tierEntries[0];
    const harness = planningTier?.harness ?? 'claude-sdk';
    const provider = planningTier?.pi?.provider;
    const parts = ['mixed', harness];
    if (provider) parts.push(provider);
    return parts.join('-').replace(/-{2,}/g, '-');
  }

  // Single harness, all models match
  if (modelIds.size === 1) {
    return sanitizeFragment([...modelIds][0]);
  }

  // Single harness, mixed models — use harness + optional provider
  const harness = [...harnesses][0];
  const planningTier = tiers.planning ?? tierEntries[0];
  const provider = planningTier?.pi?.provider;
  const parts: string[] = [harness];
  if (provider) parts.push(provider);
  return parts.join('-').replace(/-{2,}/g, '-');
}

/**
 * Delete an agent runtime profile file.
 */
export async function deleteAgentRuntimeProfile(
  configDir: string,
  name: string,
  force?: boolean,
  scope?: 'local' | 'project' | 'user',
  cwd?: string,
): Promise<void> {
  name = name.trim();
  if (name.length === 0) {
    throw new Error('Profile name must be a non-empty string');
  }
  const effectiveCwd = cwd ?? dirname(configDir);

  const localPath = localProfilePath(effectiveCwd, name);
  const projectPath = profilePath(configDir, name);
  const userPath = userProfilePath(name);
  const existsInLocal = await fileExists(localPath);
  const existsInProject = await fileExists(projectPath);
  const existsInUser = await fileExists(userPath);

  if (scope === undefined) {
    const existingScopes = (
      [existsInLocal && 'local', existsInProject && 'project', existsInUser && 'user'] as const
    ).filter(Boolean) as Array<'local' | 'project' | 'user'>;

    if (existingScopes.length > 1) {
      throw new Error(
        `Profile "${name}" exists in multiple scopes (${existingScopes.join(', ')}). ` +
        `Specify scope: ${existingScopes.map((s) => `'${s}'`).join(' or ')} to disambiguate.`,
      );
    }
    if (existsInLocal) {
      scope = 'local';
    } else if (existsInProject) {
      scope = 'project';
    } else if (existsInUser) {
      scope = 'user';
    } else {
      throw new Error(`Profile "${name}" not found in local, project, or user scope`);
    }
  }

  const targetPath = scope === 'user' ? userPath
    : scope === 'local' ? localPath
    : projectPath;
  if (!(await fileExists(targetPath))) {
    throw new Error(`Profile "${name}" not found in ${scope} scope at ${targetPath}`);
  }

  const localMarkerName = await readMarkerName(localMarkerPath(effectiveCwd));
  const projectMarkerName = await readMarkerName(markerPath(configDir));
  const userMarkerName = await readMarkerName(userMarkerPath());

  if ((localMarkerName === name || projectMarkerName === name || userMarkerName === name) && !force) {
    throw new Error(
      `Profile "${name}" is currently active. ` +
      `Pass force: true to delete it.`,
    );
  }

  await rm(targetPath);

  if (force) {
    if (localMarkerName === name) {
      try {
        await unlink(localMarkerPath(effectiveCwd));
      } catch {
        // marker already gone
      }
    }
    if (projectMarkerName === name) {
      try {
        await unlink(markerPath(configDir));
      } catch {
        // marker already gone
      }
    }
    if (userMarkerName === name) {
      try {
        await unlink(userMarkerPath());
      } catch {
        // marker already gone
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Toolbelt Static Validation Helpers
// ---------------------------------------------------------------------------

/**
 * Read `.mcp.json` from the project root and return the declared MCP server names.
 * Returns `{ exists: false, names: [] }` when the file does not exist.
 * Throws `ConfigValidationError` when the file exists but contains malformed JSON.
 */
export async function loadProjectMcpServerNames(projectRoot: string): Promise<{ exists: boolean; names: string[] }> {
  const mcpJsonPath = pathJoin(projectRoot, '.mcp.json');
  try {
    const content = await readFile(mcpJsonPath, 'utf-8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new ConfigValidationError([`Malformed JSON in ${mcpJsonPath}`].join(''));
    }
    if (typeof parsed !== 'object' || parsed === null || !('mcpServers' in parsed)) {
      return { exists: true, names: [] };
    }
    const mcpServers = (parsed as Record<string, unknown>).mcpServers;
    if (typeof mcpServers !== 'object' || mcpServers === null) {
      return { exists: true, names: [] };
    }
    return { exists: true, names: Object.keys(mcpServers) };
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { exists: false, names: [] };
    }
    throw err;
  }
}

/**
 * Validate toolbelt references in a merged config against a known set of MCP server names.
 *
 * Checks:
 * 1. Every `agents.tiers.<tier>.toolbelt` value (unless "none") must be declared in `tools.toolbelts`.
 * 2. Every MCP server referenced in `tools.toolbelts.<name>.mcpServers` must be declared
 *    in `.mcp.json` (when the file exists).
 *
 * When `mcpProbe` is null, MCP server presence checks are skipped (e.g. in non-project contexts).
 * Returns an array of human-readable error strings (empty array = valid).
 */
export function validateToolbeltReferences(
  merged: PartialEforgeConfig,
  mcpProbe: { exists: boolean; names: string[] } | null,
): string[] {
  const errors: string[] = [];
  const toolbelts = merged.tools?.toolbelts ?? {};

  // Check tier and choice effective-recipe references
  const tiers = merged.agents?.tiers ?? {};
  for (const [tierName, tier] of Object.entries(tiers)) {
    if (!tier) continue;
    const toolbelt = (tier as { toolbelt?: string }).toolbelt;
    if (toolbelt !== undefined && toolbelt !== 'none' && !(toolbelt in toolbelts)) {
      errors.push(`agents.tiers.${tierName}.toolbelt references "${toolbelt}", but no tools.toolbelts.${toolbelt} is defined.`);
    }
    const choices = (tier as { choices?: Record<string, { toolbelt?: string }> }).choices ?? {};
    for (const [choiceName, choice] of Object.entries(choices)) {
      const choiceToolbelt = choice.toolbelt ?? toolbelt;
      if (choiceToolbelt !== undefined && choiceToolbelt !== 'none' && !(choiceToolbelt in toolbelts)) {
        errors.push(`agents.tiers.${tierName}.choices.${choiceName}.toolbelt references "${choiceToolbelt}", but no tools.toolbelts.${choiceToolbelt} is defined.`);
      }
    }
  }

  // Check MCP server references
  for (const [name, toolbelt] of Object.entries(toolbelts)) {
    if (!toolbelt?.mcpServers?.length) continue;

    if (mcpProbe === null) continue;

    if (!mcpProbe.exists) {
      errors.push(`tools.toolbelts.${name} declares MCP servers, but .mcp.json was not found.`);
      continue;
    }

    for (const server of toolbelt.mcpServers) {
      if (!mcpProbe.names.includes(server)) {
        errors.push(`tools.toolbelts.${name} references MCP server "${server}", but .mcp.json has no mcpServers.${server} entry.`);
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Config File Validation
// ---------------------------------------------------------------------------

/**
 * Validate the eforge config file found from the given directory.
 */
export async function validateConfigFile(
  cwd?: string,
): Promise<{ configFound: boolean; valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  const startDir = cwd ?? process.cwd();
  const configPath = await findConfigFile(startDir);
  if (!configPath) {
    return { configFound: false, valid: true, errors: [] };
  }

  let raw: string;
  try {
    raw = await readFile(configPath, 'utf-8');
  } catch (err) {
    return { configFound: true, valid: false, errors: [`Failed to read config file: ${(err as Error).message}`] };
  }

  let data: unknown;
  try {
    data = parseYaml(raw);
  } catch (err) {
    return { configFound: true, valid: false, errors: [`Invalid YAML: ${(err as Error).message}`] };
  }

  if (!data || typeof data !== 'object') {
    return { configFound: true, valid: true, errors: [] };
  }

  const result = configYamlSchema.safeParse(data);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.map(String).join('.');
      errors.push(`${path}: ${issue.message}`);
    }
  }

  // Toolbelt static cross-reference validation (only when schema parsing succeeded)
  if (result.success) {
    const projectRoot = dirname(dirname(configPath));
    let mcpProbe: { exists: boolean; names: string[] } | null = null;
    try {
      mcpProbe = await loadProjectMcpServerNames(projectRoot);
    } catch {
      // best-effort: if .mcp.json can't be read, skip MCP checks
    }
    const partial = result.data as PartialEforgeConfig;
    let mergedForCrossReferences = partial;
    try {
      let globalConfig: PartialEforgeConfig = {};
      let projectConfig: PartialEforgeConfig = {};
      let localConfig: PartialEforgeConfig = {};
      const configYamlLayers = await resolveLayeredSingletons('config.yaml', { cwd: projectRoot, configDir: dirname(configPath) });
      for (const { scope, path } of configYamlLayers) {
        const layerRaw = await readFile(path, 'utf-8');
        const layerData = parseYaml(layerRaw);
        if (layerData && typeof layerData === 'object') {
          const layerPartial = parseRawConfig(layerData as Record<string, unknown>);
          if (scope === 'user') globalConfig = layerPartial;
          else if (scope === 'project-team') projectConfig = layerPartial;
          else localConfig = layerPartial;
        }
      }
      const { name } = await resolveActiveProfileName(dirname(configPath), projectConfig, globalConfig, projectRoot);
      let profileConfig: PartialEforgeConfig | null = null;
      if (name) {
        const profileResult = await loadProfile(dirname(configPath), name, projectRoot);
        profileConfig = profileResult?.profile ?? null;
      }
      const baseMerged = mergePartialConfigs(mergePartialConfigs(globalConfig, projectConfig), localConfig);
      mergedForCrossReferences = profileConfig ? mergePartialConfigs(baseMerged, profileConfig) : baseMerged;
    } catch (err) {
      errors.push(`Failed to validate merged config layers: ${(err as Error).message}`);
    }
    errors.push(...collectRuntimeChoiceConfigErrors(mergedForCrossReferences as { agents?: { tiers?: Record<string, unknown> } }, { validateUnknownChoices: true }));
    const toolbeltErrors = validateToolbeltReferences(mergedForCrossReferences, mcpProbe);
    errors.push(...toolbeltErrors);
  }

  return { configFound: true, valid: errors.length === 0, errors };
}
