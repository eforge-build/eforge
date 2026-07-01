/**
 * AgentRuntimeRegistry — maps agent roles to harness instances.
 *
 * With tier recipes, the registry's job is simple: for any role, look up
 * the role's tier and return the harness instance for that tier. Pi
 * harness instances are memoized by (harness, provider, sortedProjectMcpServers,
 * disableSubagents) so two tiers sharing the same effective tool surface share
 * one instance; tiers with different toolbelts (different effective project MCP
 * server sets) get distinct instances. Claude SDK tiers disable subagents by default
 * unless they explicitly opt out.
 */

import type { AgentRole } from './events.js';
import type { EforgeConfig, TierConfig, PiConfig } from './config.js';
import type { AgentHarness } from './harness.js';
import type { EffectiveAgentRecipe, RuntimeChoiceInvocationMetadata, RuntimeChoiceSelection } from './pipeline/runtime-choice.js';
import type { ClaudeSDKHarnessOptions } from './harnesses/claude-sdk.js';
import type { SdkPluginConfig, SettingSource, McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeSDKHarness } from './harnesses/claude-sdk.js';
import { resolveTierForRole } from './pipeline/agent-config.js';
import { resolveRuntimeChoiceForInvocation } from './pipeline/runtime-choice.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Summary of which project MCP servers were selected for a tier.
 * Always computed at registry construction time and returned from forRoleResolved().
 */
export interface ToolbeltSummary {
  /**
   * The toolbelt name. Undefined when the tier omits toolbelt (default = all),
   * null when toolbelt is explicitly 'none', string when a named toolbelt.
   */
  toolbelt?: string | null;
  /** Provenance of the toolbelt selection. */
  toolbeltSource: 'tier' | 'role' | 'plan' | 'default';
  /** Which project MCP servers were selected for this tier. */
  projectMcpSelection: 'all' | 'none' | 'toolbelt';
  /** Sorted names of the project MCP servers passed to this tier's harness. */
  projectMcpServerNames: string[];
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

/**
 * Minimal plan-entry shape consumed by the registry — only the tier override
 * field is needed here.
 */
export interface PlanEntryForRegistry {
  agents?: Record<string, { tier?: string; [key: string]: unknown }>;
}

/**
 * Registry that maps agent roles to harness instances.
 */
export interface AgentRuntimeRegistry {
  /**
   * Resolve the harness for an agent role.
   *
   * @param role - The agent role to resolve.
   * @param planEntry - Optional plan-file entry. When the plan overrides a
   *   role's tier, the harness instance for the plan-resolved tier is returned
   *   so the advertised harness matches the harness actually running the role.
   */
  forRole(role: AgentRole, planEntry?: PlanEntryForRegistry): AgentHarness;

  /**
   * Resolve the harness and toolbelt summary for an agent role.
   *
   * Returns both the harness instance and the toolbelt summary (which project
   * MCP servers are active for this tier). Call sites spread the toolbelt
   * summary fields onto agent run options so the harness can stamp them on
   * agent:start events for observability.
   */
  forRoleResolved(role: AgentRole, planEntry?: PlanEntryForRegistry, metadata?: RuntimeChoiceInvocationMetadata): { harness: AgentHarness; toolbeltSummary: ToolbeltSummary; selection?: RuntimeChoiceSelection };

  // --- eforge:region plan-01-runtime-choice-core ---
  /** Resolve a harness from an already-selected effective runtime-choice recipe. */
  forEffectiveRecipe?(tierName: string, recipe: EffectiveAgentRecipe): { harness: AgentHarness; toolbeltSummary: ToolbeltSummary };
  // --- eforge:endregion plan-01-runtime-choice-core ---
}

// ---------------------------------------------------------------------------
// Options for global infrastructure (forwarded from EforgeEngine.create)
// ---------------------------------------------------------------------------

export interface RegistryGlobalOptions {
  mcpServers?: ClaudeSDKHarnessOptions['mcpServers'];
  plugins?: SdkPluginConfig[];
  settingSources?: SettingSource[];
  /** Toolbelt definitions from config.tools.toolbelts — used to resolve per-tier project MCP server filtering. */
  toolbelts?: Record<string, { description?: string; mcpServers: string[] }>;
}

// ---------------------------------------------------------------------------
// singletonRegistry — test adapter
// ---------------------------------------------------------------------------

/**
 * Create a registry where every role resolves to the same harness instance.
 * Used by test code to wrap a single StubHarness.
 */
export function singletonRegistry(harness: AgentHarness): AgentRuntimeRegistry {
  const defaultSummary: ToolbeltSummary = {
    toolbeltSource: 'default',
    projectMcpSelection: 'all',
    projectMcpServerNames: [],
  };
  return {
    forRole(_role: AgentRole, _planEntry?: PlanEntryForRegistry): AgentHarness { return harness; },
    forRoleResolved(_role: AgentRole, _planEntry?: PlanEntryForRegistry): { harness: AgentHarness; toolbeltSummary: ToolbeltSummary } {
      return { harness, toolbeltSummary: defaultSummary };
    },
    // --- eforge:region plan-01-runtime-choice-core ---
    forEffectiveRecipe(_tierName: string, _recipe: EffectiveAgentRecipe): { harness: AgentHarness; toolbeltSummary: ToolbeltSummary } {
      return { harness, toolbeltSummary: defaultSummary };
    },
    // --- eforge:endregion plan-01-runtime-choice-core ---
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a PiConfig from a tier's pi block, filling in defaults for any
 * unspecified fields.
 */
function buildPiConfig(piBlock: TierConfig['pi'] | undefined): PiConfig {
  return {
    apiKey: piBlock?.apiKey,
    provider: piBlock?.provider,
    thinkingLevel: piBlock?.thinkingLevel ?? 'medium',
    resources: piBlock?.resources ?? 'isolated',
    extensions: {
      autoDiscover: piBlock?.extensions?.autoDiscover ?? true,
      include: piBlock?.extensions?.include,
      exclude: piBlock?.extensions?.exclude,
      paths: piBlock?.extensions?.paths,
    },
    compaction: {
      enabled: piBlock?.compaction?.enabled ?? true,
      threshold: piBlock?.compaction?.threshold ?? 100_000,
    },
    retry: {
      maxRetries: piBlock?.retry?.maxRetries ?? 3,
      backoffMs: piBlock?.retry?.backoffMs ?? 1000,
    },
  };
}

/**
 * Resolve the per-tier project MCP server map and toolbelt summary.
 *
 * - omitted toolbelt → all discovered project MCP servers (back-compat default)
 * - `toolbelt: 'none'` → no project MCP servers
 * - named toolbelt → only servers listed in tools.toolbelts.<name>.mcpServers
 *
 * Throws a path-specific error if a named toolbelt is not present in `toolbelts`.
 */
function resolveTierToolbelt(
  tierName: string,
  tier: TierConfig,
  globalMcp: Record<string, McpServerConfig>,
  toolbelts: Record<string, { description?: string; mcpServers: string[] }>,
): { projectMcpServerMap: Record<string, McpServerConfig>; summary: ToolbeltSummary } {
  const toolbeltName = tier.toolbelt;

  // Omitted: pass all project MCP servers (back-compat default)
  if (toolbeltName === undefined) {
    return {
      projectMcpServerMap: globalMcp,
      summary: {
        toolbeltSource: 'default',
        projectMcpSelection: 'all',
        projectMcpServerNames: Object.keys(globalMcp).sort(),
      },
    };
  }

  // Explicit 'none': pass no project MCP servers
  if (toolbeltName === 'none') {
    return {
      projectMcpServerMap: {},
      summary: {
        toolbelt: null,
        toolbeltSource: 'tier',
        projectMcpSelection: 'none',
        projectMcpServerNames: [],
      },
    };
  }

  // Named toolbelt: must exist in tools.toolbelts
  const toolbeltDef = toolbelts[toolbeltName];
  if (!toolbeltDef) {
    throw new Error(
      `agents.tiers.${tierName}.toolbelt references "${toolbeltName}" which is not declared in tools.toolbelts. ` +
      `Add tools.toolbelts.${toolbeltName} to eforge/config.yaml (or remove the toolbelt reference).`,
    );
  }

  // Filter global MCP servers to only those listed in the toolbelt
  const filteredMap: Record<string, McpServerConfig> = {};
  for (const serverName of toolbeltDef.mcpServers) {
    const serverConfig = globalMcp[serverName];
    if (serverConfig !== undefined) {
      filteredMap[serverName] = serverConfig;
    }
    // Servers in toolbelt but not in .mcp.json are silently skipped;
    // static validation (TOOLBELTS_03) already verified MCP server references.
  }

  return {
    projectMcpServerMap: filteredMap,
    summary: {
      toolbelt: toolbeltName,
      toolbeltSource: 'tier',
      projectMcpSelection: 'toolbelt',
      projectMcpServerNames: Object.keys(filteredMap).sort(),
    },
  };
}

/**
 * Build the memoization key for a harness instance.
 *
 * Key dimensions:
 *  - harness type ('claude-sdk' or 'pi:<provider>')
 *  - sorted effective project MCP server names (toolbelt-filtered)
 *  - disableSubagents flag (claude-sdk only)
 *  - resources mode for pi ('isolated' | 'ambient') — isolated and ambient Pi instances
 *    have different resource-loader behavior and must not be shared
 *
 * Two tiers sharing all dimensions reuse a single harness instance;
 * differing on any dimension get distinct instances.
 */
function stableKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableKey(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function makeKey(
  harness: 'claude-sdk' | 'pi',
  sortedProjectMcpServerNames: string[] = [],
  disableSubagents: boolean = false,
  piCfg?: PiConfig,
  bare?: boolean,
): string {
  const serversKey = sortedProjectMcpServerNames.length > 0
    ? `:servers=${sortedProjectMcpServerNames.join(',')}`
    : '';
  const subagentsKey = disableSubagents ? ':nosubagents' : '';
  if (harness === 'pi') {
    return `pi:${stableKey({ bare: bare === true, piCfg })}${serversKey}${subagentsKey}`;
  }
  return `claude-sdk${serversKey}${subagentsKey}`;
}

// ---------------------------------------------------------------------------
// buildAgentRuntimeRegistry — async factory
// ---------------------------------------------------------------------------

/**
 * Build an `AgentRuntimeRegistry` from config.
 *
 * Lazily imports `./harnesses/pi.js` the first time a Pi tier is needed.
 * Harness instances are memoized by (harness, provider, sortedProjectMcpServerNames,
 * disableSubagents) so tiers sharing the same effective tool surface reuse one
 * instance; tiers with different toolbelts get distinct instances. Claude SDK tiers
 * default disableSubagents to true.
 */
export async function buildAgentRuntimeRegistry(
  config: EforgeConfig,
  globalOptions: RegistryGlobalOptions = {},
): Promise<AgentRuntimeRegistry> {
  const tiers = config.agents.tiers;
  if (!tiers || Object.keys(tiers).length === 0) {
    throw new Error(
      'buildAgentRuntimeRegistry: "agents.tiers" is not declared or is empty in config. ' +
      'Add agents.tiers entries (each with harness + model + effort) to eforge/config.yaml.',
    );
  }

  // Detect whether any tier uses Pi so we can lazily import the module.
  let PiHarnessCtor: (typeof import('./harnesses/pi.js'))['PiHarness'] | undefined;
  const hasPi = Object.values(tiers).some((t) => t?.harness === 'pi' || Object.values(t?.choices ?? {}).some((choice) => choice.harness === 'pi'));
  if (hasPi) {
    try {
      const piModule = await import('./harnesses/pi.js');
      PiHarnessCtor = piModule.PiHarness;
    } catch (err) {
      throw new Error(
        'Failed to load Pi harness. Ensure Pi SDK dependencies are installed ' +
        '(@earendil-works/pi-ai and @earendil-works/pi-agent-core). ' +
        `Original error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Global project MCP servers from .mcp.json (already filtered of 'eforge' server by caller).
  const globalMcp: Record<string, McpServerConfig> = globalOptions.mcpServers ?? {};
  // Toolbelt definitions from config.tools.toolbelts.
  const toolbelts: Record<string, { description?: string; mcpServers: string[] }> = globalOptions.toolbelts ?? {};

  // Memoize harness instances keyed by (harness, provider, sortedProjectMcpServers, disableSubagents).
  // Only the harness is cached: the per-tier toolbeltSummary is always recomputed and returned
  // fresh, so two tiers that share an effective MCP map but differ in toolbelt source/selection
  // (e.g. omitted vs explicit `none` when globalMcp is empty) still observe their own summary.
  const instances = new Map<string, AgentHarness>();

  function instanceForTier(tierName: string, tierRecipe: TierConfig): { harness: AgentHarness; toolbeltSummary: ToolbeltSummary } {
    const { projectMcpServerMap, summary } = resolveTierToolbelt(tierName, tierRecipe, globalMcp, toolbelts);
    const disableSubagents = tierRecipe.harness === 'claude-sdk'
      ? (tierRecipe.claudeSdk?.disableSubagents ?? true)
      : false;

    // Build piCfg before makeKey so the effective resources mode (after bare coercion)
    // is included in the memoization key. agents.bare forces 'isolated' regardless of
    // the per-tier pi.resources setting — bare is never weaker than the deterministic default.
    let piCfg: PiConfig | undefined;
    if (tierRecipe.harness === 'pi') {
      piCfg = buildPiConfig(tierRecipe.pi);
      if (config.agents.bare) {
        piCfg.resources = 'isolated';
      }
    }
    const key = makeKey(tierRecipe.harness, summary.projectMcpServerNames, disableSubagents, piCfg, config.agents.bare);

    const existingHarness = instances.get(key);
    if (existingHarness) return { harness: existingHarness, toolbeltSummary: summary };

    let harness: AgentHarness;
    if (tierRecipe.harness === 'pi') {
      if (!PiHarnessCtor) throw new Error('Internal: Pi module not loaded despite pi tier');
      // piCfg already built and coerced above
      harness = new PiHarnessCtor({
        mcpServers: projectMcpServerMap,
        piConfig: piCfg!,
        bare: config.agents.bare,
        extensions: {
          autoDiscover: piCfg!.extensions.autoDiscover,
          include: piCfg!.extensions.include,
          exclude: piCfg!.extensions.exclude,
          paths: piCfg!.extensions.paths,
        },
      });
    } else {
      harness = new ClaudeSDKHarness({
        mcpServers: projectMcpServerMap,
        plugins: globalOptions.plugins,
        settingSources: globalOptions.settingSources ?? config.agents.settingSources as SettingSource[] | undefined,
        bare: config.agents.bare,
        disableSubagents,
      });
    }

    instances.set(key, harness);
    return { harness, toolbeltSummary: summary };
  }

  function resolveForRole(role: AgentRole, planEntry?: PlanEntryForRegistry, metadata?: RuntimeChoiceInvocationMetadata): { harness: AgentHarness; toolbeltSummary: ToolbeltSummary; selection: RuntimeChoiceSelection } {
    // --- eforge:region plan-01-runtime-choice-core ---
    const selection = resolveRuntimeChoiceForInvocation(role, config, planEntry, metadata ?? {});
    const resolved = instanceForTier(selection.tier, selection.effectiveRecipe);
    return { ...resolved, selection };
    // --- eforge:endregion plan-01-runtime-choice-core ---
  }

  function resolveDefaultForRole(role: AgentRole, planEntry?: PlanEntryForRegistry): AgentHarness {
    const { tier } = resolveTierForRole(role, config, planEntry);
    const tierRecipe = config.agents.tiers?.[tier];
    if (!tierRecipe) throw new Error(`Role "${role}" resolves to tier "${tier}" but no tier recipe is configured.`);
    const { choices: _choices, routing: _routing, ...defaultRecipe } = tierRecipe;
    return instanceForTier(tier, defaultRecipe as TierConfig).harness;
  }

  const registry: AgentRuntimeRegistry = {
    forRole(role: AgentRole, planEntry?: PlanEntryForRegistry): AgentHarness {
      return resolveDefaultForRole(role, planEntry);
    },
    forRoleResolved(role: AgentRole, planEntry?: PlanEntryForRegistry, metadata?: RuntimeChoiceInvocationMetadata): { harness: AgentHarness; toolbeltSummary: ToolbeltSummary; selection: RuntimeChoiceSelection } {
      return resolveForRole(role, planEntry, metadata);
    },
    // --- eforge:region plan-01-runtime-choice-core ---
    forEffectiveRecipe(tierName: string, recipe: EffectiveAgentRecipe): { harness: AgentHarness; toolbeltSummary: ToolbeltSummary } {
      return instanceForTier(tierName, recipe as TierConfig);
    },
    // --- eforge:endregion plan-01-runtime-choice-core ---
  };

  return registry;
}
