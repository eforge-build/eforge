/**
 * AgentRuntimeRegistry — maps agent roles to backend instances.
 *
 * Supports multiple named harness configurations with lazy instance creation.
 * Pi module is imported lazily: only when the config declares at least one Pi
 * runtime entry. Instances are memoized by entry name.
 */

import type { AgentRole } from './events.js';
import type { EforgeConfig, AgentRuntimeEntry, PiConfig } from './config.js';
import type { AgentBackend } from './backend.js';
import type { ClaudeSDKBackendOptions } from './backends/claude-sdk.js';
import type { SdkPluginConfig, SettingSource } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeSDKBackend } from './backends/claude-sdk.js';
import { resolveAgentRuntimeForRole } from './pipeline/agent-config.js';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

/**
 * Registry that maps agent roles (and named entries) to backend instances.
 * All methods are synchronous — async work (Pi import) is done in the factory.
 */
export interface AgentRuntimeRegistry {
  /** Resolve the backend for an agent role. */
  forRole(role: AgentRole): AgentBackend;
  /** Look up a backend instance by agentRuntime entry name. */
  byName(name: string): AgentBackend;
  /** Get the agentRuntime entry name for a role. */
  nameForRole(role: AgentRole): string;
  /** List all configured entry names. */
  configured(): string[];
}

// ---------------------------------------------------------------------------
// Options for global infrastructure (forwarded from EforgeEngine.create)
// ---------------------------------------------------------------------------

export interface RegistryGlobalOptions {
  mcpServers?: ClaudeSDKBackendOptions['mcpServers'];
  plugins?: SdkPluginConfig[];
  settingSources?: SettingSource[];
}

// ---------------------------------------------------------------------------
// singletonRegistry — test adapter
// ---------------------------------------------------------------------------

/**
 * Create a registry where every role (and every name) resolves to the same
 * harness instance. Used by test code to wrap a single StubBackend so all
 * agent roles dispatch to it.
 */
export function singletonRegistry(harness: AgentBackend): AgentRuntimeRegistry {
  return {
    forRole(_role: AgentRole): AgentBackend { return harness; },
    byName(_name: string): AgentBackend { return harness; },
    nameForRole(_role: AgentRole): string { return 'singleton'; },
    configured(): string[] { return ['singleton']; },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the effective entry map from config.
 *
 * For legacy configs (no agentRuntimes declared), synthesises a single implicit
 * entry keyed by the legacy `config.backend` scalar so the registry still works.
 */
function getEffectiveEntries(config: EforgeConfig): Record<string, AgentRuntimeEntry> {
  if (config.agentRuntimes && Object.keys(config.agentRuntimes).length > 0) {
    return config.agentRuntimes;
  }
  // Legacy fallback: synthesise a single entry from config.backend
  const harness = (config.backend ?? 'claude-sdk') as 'claude-sdk' | 'pi';
  return { [harness]: { harness } };
}

/**
 * Merge an optional per-entry Pi config with the global Pi defaults to produce
 * a fully resolved PiConfig.
 */
function mergepiConfig(global: PiConfig, override?: AgentRuntimeEntry['pi']): PiConfig {
  if (!override) return global;
  return {
    apiKey: override.apiKey ?? global.apiKey,
    thinkingLevel: override.thinkingLevel ?? global.thinkingLevel,
    extensions: {
      autoDiscover: override.extensions?.autoDiscover ?? global.extensions.autoDiscover,
      include: override.extensions?.include ?? global.extensions.include,
      exclude: override.extensions?.exclude ?? global.extensions.exclude,
      paths: override.extensions?.paths ?? global.extensions.paths,
    },
    compaction: {
      enabled: override.compaction?.enabled ?? global.compaction.enabled,
      threshold: override.compaction?.threshold ?? global.compaction.threshold,
    },
    retry: {
      maxRetries: override.retry?.maxRetries ?? global.retry.maxRetries,
      backoffMs: override.retry?.backoffMs ?? global.retry.backoffMs,
    },
  };
}

// ---------------------------------------------------------------------------
// buildAgentRuntimeRegistry — async factory
// ---------------------------------------------------------------------------

/**
 * Build an `AgentRuntimeRegistry` from config.
 *
 * Lazily imports `./backends/pi.js` the first time a `pi` entry is needed
 * (i.e. only when the config declares at least one Pi runtime). Instances are
 * memoized by entry name so two roles pointing at the same name share one instance.
 *
 * @param config - Fully resolved EforgeConfig.
 * @param globalOptions - Infrastructure options forwarded from EforgeEngine.create().
 */
export async function buildAgentRuntimeRegistry(
  config: EforgeConfig,
  globalOptions: RegistryGlobalOptions = {},
): Promise<AgentRuntimeRegistry> {
  const entries = getEffectiveEntries(config);

  // Lazily import Pi module only when at least one Pi entry is configured.
  let PiBackendCtor: (typeof import('./backends/pi.js'))['PiBackend'] | undefined;
  const hasPi = Object.values(entries).some((e) => e.harness === 'pi');
  if (hasPi) {
    try {
      const piModule = await import('./backends/pi.js');
      PiBackendCtor = piModule.PiBackend;
    } catch (err) {
      throw new Error(
        'Failed to load Pi backend. Ensure Pi SDK dependencies are installed ' +
        '(@mariozechner/pi-ai and @mariozechner/pi-agent-core). ' +
        `Original error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Memoized instances keyed by entry name.
  const instances = new Map<string, AgentBackend>();

  function createInstance(name: string): AgentBackend {
    const entry = entries[name];
    if (!entry) {
      throw new Error(
        `Unknown agentRuntime name: "${name}". Configured: ${Object.keys(entries).join(', ')}.`,
      );
    }

    if (entry.harness === 'pi') {
      if (!PiBackendCtor) throw new Error('Internal: Pi module not loaded despite pi entry');
      const piCfg = mergepiConfig(config.pi, entry.pi);
      return new PiBackendCtor({
        mcpServers: globalOptions.mcpServers,
        piConfig: piCfg,
        bare: config.agents.bare,
        extensions: {
          autoDiscover: piCfg.extensions.autoDiscover,
          include: piCfg.extensions.include,
          exclude: piCfg.extensions.exclude,
          paths: piCfg.extensions.paths,
        },
      });
    }

    // claude-sdk entry
    return new ClaudeSDKBackend({
      mcpServers: globalOptions.mcpServers,
      plugins: globalOptions.plugins,
      settingSources: globalOptions.settingSources ?? config.agents.settingSources as SettingSource[] | undefined,
      bare: config.agents.bare,
      disableSubagents: entry.claudeSdk?.disableSubagents ?? config.claudeSdk.disableSubagents,
    });
  }

  const registry: AgentRuntimeRegistry = {
    forRole(role: AgentRole): AgentBackend {
      const { agentRuntimeName } = resolveAgentRuntimeForRole(role, config);
      return registry.byName(agentRuntimeName);
    },

    byName(name: string): AgentBackend {
      if (!instances.has(name)) {
        instances.set(name, createInstance(name));
      }
      return instances.get(name)!;
    },

    nameForRole(role: AgentRole): string {
      return resolveAgentRuntimeForRole(role, config).agentRuntimeName;
    },

    configured(): string[] {
      return Object.keys(entries);
    },
  };

  return registry;
}
