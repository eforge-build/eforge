/**
 * Pi coding agent harness — implements AgentHarness using @earendil-works/pi-coding-agent.
 * All Pi SDK imports are isolated to this file and pi-mcp-bridge.ts.
 */

import {
  createAgentSession,
  createCodingTools,
  createReadOnlyTools,
  SessionManager,
  SettingsManager,
  ModelRegistry,
  AuthStorage,
  DefaultResourceLoader,
  discoverAndLoadExtensions,
  getAgentDir,
  type AgentSessionEvent,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { getModel } from '@earendil-works/pi-ai';
import type { Model, Api } from '@earendil-works/pi-ai';
import type { AgentTool, ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { EforgeEvent, AgentRole, AgentResultData } from '../events.js';
import type { AgentHarness, AgentRunOptions, ThinkingConfig, EffortLevel, HarnessDebugCallback, HarnessDebugPayload } from '../harness.js';
import { AgentTerminalError, isTransientTransportError } from '../harness.js';
import { isPiToolInfrastructureError } from '../harness.js';
import type { PiConfig } from '../config.js';
import { AsyncEventQueue } from '../concurrency.js';
import { PiMcpBridge } from './pi-mcp-bridge.js';
import { discoverPiExtensions, type PiExtensionConfig } from './pi-extensions.js';
import { normalizeUsage, toModelUsageEntry } from './usage.js';
import { buildAgentStartEvent, normalizeToolUseId } from './common.js';
import { isEforgePiResource, EFORGE_PI_PACKAGE_NAME } from './eforge-resource-filter.js';
import { expandDisallowedToolAliasesForPi } from './tool-safety.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PiHarnessOptions {
  /** MCP servers to bridge as Pi AgentTools. */
  mcpServers?: Record<string, McpServerConfig>;
  /** Pi extension discovery configuration. */
  extensions?: PiExtensionConfig;
  /** When true, skip extension auto-discovery and Pi settings files. */
  bare?: boolean;
  /** Pi-specific configuration from eforge/config.yaml. */
  piConfig?: PiConfig;
  /**
   * Optional callback fired just before each `session.prompt` dispatch with a
   * snapshot of the request (system prompt, tools, model, etc.). Used by
   * diagnostic tooling like `eforge debug-composer` to compare framing across
   * harnesses.
   */
  onDebugPayload?: HarnessDebugCallback;
}

// ---------------------------------------------------------------------------
// Thinking mapping
// ---------------------------------------------------------------------------

/**
 * Map eforge ThinkingConfig to Pi ThinkingLevel.
 *
 * - disabled -> 'off'
 * - adaptive -> 'medium'
 * - enabled -> 'high'
 */
function mapThinkingConfig(thinking: ThinkingConfig): ThinkingLevel {
  switch (thinking.type) {
    case 'disabled': return 'off';
    case 'adaptive': return 'medium';
    case 'enabled': return 'high';
  }
}

/**
 * Map eforge EffortLevel to Pi ThinkingLevel.
 *
 * pi-ai's ThinkingLevel range is 'off' | 'low' | 'medium' | 'high' | 'xhigh'.
 * pi-ai has no 'max' level; its 'xhigh' is adaptive-max for Opus 4.6+,
 * which semantically matches eforge's 'max'.
 *
 * - low -> 'low'
 * - medium -> 'medium'
 * - high -> 'high'
 * - xhigh -> 'xhigh'
 * - max -> 'xhigh'
 */
function mapEffortLevel(effort: EffortLevel): ThinkingLevel {
  switch (effort) {
    case 'low': return 'low';
    case 'medium': return 'medium';
    case 'high': return 'high';
    case 'xhigh': return 'xhigh';
    case 'max': return 'xhigh';
  }
}

/**
 * Resolve thinking level from options, with Pi config as default fallback.
 */
function resolveThinkingLevel(options: AgentRunOptions, piConfig?: PiConfig): ThinkingLevel {
  if (options.thinking) return mapThinkingConfig(options.thinking);
  if (options.effort) return mapEffortLevel(options.effort);
  return piConfig?.thinkingLevel ?? 'medium';
}

// ---------------------------------------------------------------------------
// Tool filtering
// ---------------------------------------------------------------------------

/**
 * Filter tools based on allowedTools / disallowedTools lists.
 * Pi doesn't have built-in tool filtering, so we do it before passing to the session.
 *
 * Generic over any object with a `name` field so that the same filter logic
 * applies to both Pi built-in/bridged `AgentTool`s and `ToolDefinition`s
 * without commingling them into a single array.
 */
function filterTools<T extends { name: string }>(
  tools: T[],
  allowedTools?: string[],
  disallowedTools?: string[],
): T[] {
  let filtered = tools;

  if (allowedTools && allowedTools.length > 0) {
    const allowed = new Set(allowedTools);
    filtered = filtered.filter(t => allowed.has(t.name));
  }

  if (disallowedTools && disallowedTools.length > 0) {
    const disallowed = new Set(disallowedTools);
    filtered = filtered.filter(t => !disallowed.has(t.name));
  }

  return filtered;
}

// ---------------------------------------------------------------------------
// Event translation
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function extractTextContent(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;

  const texts = content.flatMap((block) => {
    const record = asRecord(block);
    if (!record) return [];

    const type = typeof record.type === 'string' ? record.type : undefined;
    const text = typeof record.text === 'string'
      ? record.text
      : typeof record.content === 'string'
        ? record.content
        : undefined;

    // Pi/pi-ai providers have historically used `text` blocks; OpenAI
    // Responses-style providers may expose `output_text`-like shapes. Accept
    // any block with textual payload unless it is clearly a non-text block.
    if (text === undefined) return [];
    if (type === undefined || type === 'text' || type === 'output_text') return [text];
    return [];
  });

  return texts.length > 0 ? texts.join('') : undefined;
}

function extractAssistantMessageText(message: unknown): string | undefined {
  const record = asRecord(message);
  if (!record) return undefined;
  if (record.role !== undefined && record.role !== 'assistant') return undefined;
  return extractTextContent(record.content);
}

function extractLastAssistantMessageText(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = extractAssistantMessageText(messages[i]);
    if (text !== undefined) return text;
  }
  return undefined;
}

function extractMessageUpdateText(event: unknown): { fullText?: string; delta?: string } {
  const record = asRecord(event);
  const update = asRecord(record?.assistantMessageEvent);
  if (!update) return {};

  const partialText = extractAssistantMessageText(update.partial);
  if (partialText !== undefined) return { fullText: partialText };

  const messageText = extractAssistantMessageText(record?.message);
  if (messageText !== undefined) return { fullText: messageText };

  if (typeof update.content === 'string') return { fullText: update.content };
  if (typeof update.delta === 'string') return { delta: update.delta };

  return {};
}

function stringifyToolResult(result: unknown): string {
  return typeof result === 'string' ? result : JSON.stringify(result);
}

function isPiToolExecutionInfrastructureError(event: unknown): boolean {
  const record = asRecord(event);
  if (record?.type !== 'tool_execution_end') return false;
  // A successful tool can legitimately return source/test text containing the
  // phrase used by the infra classifier. Only failed Pi tool executions are
  // candidates for session-aborting infrastructure errors.
  if (record.isError !== true) return false;
  return isPiToolInfrastructureError(stringifyToolResult(record.result));
}


/**
 * Counter snapshot from a `buildResourceLoaderOverrides` result.
 * Tracks how many resources were filtered by the `@eforge-build/pi-eforge` guard
 * (anti-recursion) vs. the isolation step.
 */
export interface ResourceLoaderFilterCounters {
  eforgeExtensionsFiltered: number;
  eforgeSkillsFiltered: number;
  eforgePromptsFiltered: number;
  eforgeThemesFiltered: number;
}

/**
 * Build `DefaultResourceLoader` override callbacks for the given isolation mode.
 *
 * In **isolated** mode (the deterministic default), the eforge anti-recursion filter
 * still runs (incrementing the counters) but the result arrays are replaced with
 * empty arrays — no ambient project/user/global Pi resources reach the session.
 *
 * In **ambient** mode, non-eforge resources are preserved. This matches the
 * pre-isolation behavior; users who explicitly opt in can still bring their own
 * Pi extensions into eforge agent sessions, but eforge's own resources are always
 * excluded to prevent recursion.
 *
 * @param mode - 'isolated' (default) or 'ambient' (opt-in).
 * @returns Override callbacks compatible with `DefaultResourceLoader` options, plus
 *   a `getCounters()` snapshot accessor.
 */
function buildResourceLoaderOverrides(mode: 'isolated' | 'ambient'): {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extensionsOverride: (base: any) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  skillsOverride: (base: any) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  promptsOverride: (base: any) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  themesOverride: (base: any) => any;
  getCounters: () => ResourceLoaderFilterCounters;
} {
  let eforgeExtensionsFiltered = 0;
  let eforgeSkillsFiltered = 0;
  let eforgePromptsFiltered = 0;
  let eforgeThemesFiltered = 0;

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    extensionsOverride: (base: any): any => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nonEforge = base.extensions.filter((ext: any) => {
        const drop = isEforgePiResource({
          resolvedPath: ext.resolvedPath,
          sourceInfoSource: ext.sourceInfo?.source,
        });
        if (drop) eforgeExtensionsFiltered += 1;
        return !drop;
      });
      return { ...base, extensions: mode === 'isolated' ? [] : nonEforge };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    skillsOverride: (base: any): any => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nonEforge = base.skills.filter((skill: any) => {
        const drop = isEforgePiResource({
          resolvedPath: skill.filePath,
          sourceInfoSource: skill.sourceInfo?.source,
        });
        if (drop) eforgeSkillsFiltered += 1;
        return !drop;
      });
      return { ...base, skills: mode === 'isolated' ? [] : nonEforge };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    promptsOverride: (base: any): any => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nonEforge = base.prompts.filter((prompt: any) => {
        const drop = isEforgePiResource({
          resolvedPath: prompt.filePath,
          sourceInfoSource: prompt.sourceInfo?.source,
        });
        if (drop) eforgePromptsFiltered += 1;
        return !drop;
      });
      return { ...base, prompts: mode === 'isolated' ? [] : nonEforge };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    themesOverride: (base: any): any => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nonEforge = base.themes.filter((theme: any) => {
        const resolvedPath = theme.sourceInfo?.path ?? '';
        const drop = isEforgePiResource({
          resolvedPath,
          sourceInfoSource: theme.sourceInfo?.source,
        });
        if (drop) eforgeThemesFiltered += 1;
        return !drop;
      });
      return { ...base, themes: mode === 'isolated' ? [] : nonEforge };
    },
    getCounters: () => ({
      eforgeExtensionsFiltered,
      eforgeSkillsFiltered,
      eforgePromptsFiltered,
      eforgeThemesFiltered,
    }),
  };
}

export const piHarnessInternalsForTest = {
  extractAssistantMessageText,
  extractLastAssistantMessageText,
  extractMessageUpdateText,
  buildResourceLoaderOverrides,
  isPiToolInfrastructureError,
  isPiToolExecutionInfrastructureError,
};

/**
 * Translate a Pi AgentEvent to EforgeEvent(s) and push them into the queue.
 */
function translatePiEvent(
  event: AgentSessionEvent,
  queue: AsyncEventQueue<EforgeEvent>,
  agent: AgentRole,
  agentId: string,
  planId?: string,
): void {
  const ts = new Date().toISOString();

  switch (event.type) {
    case 'message_start':
    case 'message_end':
      // message_start/end are lifecycle markers — we extract text from message_update
      break;

    case 'message_update': {
      // Extract text content from the partial assistant message
      const msg = event.assistantMessageEvent;
      if (msg.type === 'text_delta') {
        queue.push({
          timestamp: ts,
          type: 'agent:message',
          planId,
          agentId,
          agent,
          content: msg.delta,
        });
      }
      break;
    }

    case 'tool_execution_start': {
      queue.push({
        timestamp: ts,
        type: 'agent:tool_use',
        planId,
        agentId,
        agent,
        tool: event.toolName,
        toolUseId: normalizeToolUseId({ toolCallId: event.toolCallId }),
        input: event.args,
      });
      break;
    }

    case 'tool_execution_end': {
      const output = typeof event.result === 'string'
        ? event.result
        : JSON.stringify(event.result);
      queue.push({
        timestamp: ts,
        type: 'agent:tool_result',
        planId,
        agentId,
        agent,
        tool: event.toolName,
        toolUseId: normalizeToolUseId({ toolCallId: event.toolCallId }),
        output: truncateOutput(output, 4096),
      });
      break;
    }

    case 'agent_end':
      // We'll emit agent:result from the run() method after session stats are available.
      break;

    default:
      // turn_start, turn_end, agent_start, tool_execution_update — not mapped
      break;
  }
}

/**
 * Truncate tool output to prevent bloated traces.
 */
function truncateOutput(output: string, maxLength: number): string {
  if (output.length <= maxLength) return output;
  return output.slice(0, maxLength) + `... [truncated from ${output.length} chars]`;
}

// ---------------------------------------------------------------------------
// PiHarness
// ---------------------------------------------------------------------------

export class PiHarness implements AgentHarness {
  private readonly mcpServers?: Record<string, McpServerConfig>;
  private readonly extensions?: PiExtensionConfig;
  private readonly bare: boolean;
  private readonly piConfig?: PiConfig;
  private readonly onDebugPayload?: HarnessDebugCallback;
  private mcpBridge: PiMcpBridge | null = null;

  constructor(options?: PiHarnessOptions) {
    this.mcpServers = options?.mcpServers;
    this.extensions = options?.extensions;
    this.bare = options?.bare ?? false;
    this.piConfig = options?.piConfig;
    this.onDebugPayload = options?.onDebugPayload;
  }

  /**
   * Pi registers custom tools directly by their bare name — there is no
   * MCP-wrapper convention like the Claude SDK's `mcp__<server>__<tool>`
   * prefix. The model calls the tool by exactly `CustomTool.name`.
   */
  effectiveCustomToolName(name: string): string {
    return name;
  }

  async *run(options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
    const agentId = crypto.randomUUID();

    // Validate model ref before proceeding
    if (!options.model) {
      yield buildAgentStartEvent({
        planId,
        agentId,
        agent,
        model: 'unknown',
        harness: 'pi',
        harnessSource: 'tier',
        tier: options.tier!,
        tierSource: options.tierSource!,
        effort: options.effort,
        effortSource: options.effortSource,
        thinking: options.thinking,
        thinkingSource: options.thinkingSource,
        effortClamped: options.effortClamped,
        effortOriginal: options.effortOriginal,
        thinkingCoerced: options.thinkingCoerced,
        thinkingOriginal: options.thinkingOriginal,
        perspective: options.perspective,
        toolbelt: options.toolbelt,
        toolbeltSource: options.toolbeltSource,
        projectMcpSelection: options.projectMcpSelection,
        projectMcpServerNames: options.projectMcpServerNames,
      });
      yield { type: 'agent:stop', planId, agent, agentId, error: 'No model configured for Pi backend. Set the model on the tier recipe in eforge/config.yaml.', timestamp: new Date().toISOString() };
      return;
    }

    if (!options.model.provider) {
      yield buildAgentStartEvent({
        planId,
        agentId,
        agent,
        model: options.model.id,
        harness: 'pi',
        harnessSource: 'tier',
        tier: options.tier!,
        tierSource: options.tierSource!,
        effort: options.effort,
        effortSource: options.effortSource,
        thinking: options.thinking,
        thinkingSource: options.thinkingSource,
        effortClamped: options.effortClamped,
        effortOriginal: options.effortOriginal,
        thinkingCoerced: options.thinkingCoerced,
        thinkingOriginal: options.thinkingOriginal,
        perspective: options.perspective,
        toolbelt: options.toolbelt,
        toolbeltSource: options.toolbeltSource,
        projectMcpSelection: options.projectMcpSelection,
        projectMcpServerNames: options.projectMcpServerNames,
      });
      yield { type: 'agent:stop', planId, agent, agentId, error: `No provider in model ref for Pi backend. Tier recipes with harness "pi" must set pi.provider.`, timestamp: new Date().toISOString() };
      return;
    }

    const thinkingLevel = resolveThinkingLevel(options, this.piConfig);

    yield buildAgentStartEvent({
      planId,
      agentId,
      agent,
      model: options.model.id,
      harness: 'pi',
      harnessSource: 'tier',
      tier: options.tier!,
      tierSource: options.tierSource!,
      effort: options.effort,
      effortSource: options.effortSource,
      thinking: options.thinking,
      thinkingSource: options.thinkingSource,
      effortClamped: options.effortClamped,
      effortOriginal: options.effortOriginal,
      thinkingCoerced: options.thinkingCoerced,
      thinkingOriginal: options.thinkingOriginal,
      perspective: options.perspective,
      toolbelt: options.toolbelt,
      toolbeltSource: options.toolbeltSource,
      projectMcpSelection: options.projectMcpSelection,
      projectMcpServerNames: options.projectMcpServerNames,
    });

    if (options.thinkingCoerced) {
      yield { type: 'agent:warning', planId, agentId, agent, code: 'thinking-coerced', message: `Thinking coerced from 'enabled' to 'adaptive': model ${options.model.id} only supports adaptive thinking`, timestamp: new Date().toISOString() };
    }

    let error: string | undefined;
    let infraError: AgentTerminalError | undefined;
    const startTime = Date.now();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let session: any;

    try {
      // Resolve effective isolation mode. 'isolated' is the deterministic default; 'ambient'
      // must be explicitly opted in via pi.resources: 'ambient' in config. When agents.bare
      // is true the registry already coerces resources to 'isolated' before constructing this
      // harness, but we defensively default here for any path that bypasses the registry.
      const mode: 'isolated' | 'ambient' = this.piConfig?.resources ?? 'isolated';

      // Build file-backed auth storage (reads ~/.pi/agent/auth.json, env vars, and OAuth tokens)
      const authStorage = AuthStorage.create();

      // Resolve model via ModelRegistry (async) with fallback to getModel then synthetic
      const modelRegistry = ModelRegistry.create(authStorage);
      let model: Model<Api>;
      const registryModel = await modelRegistry.find(options.model.provider!, options.model.id) as Model<Api> | undefined;
      if (registryModel) {
        model = registryModel;
      } else {
        const knownModel = getModel(options.model.provider as never, options.model.id as never) as Model<Api> | undefined;
        if (knownModel) {
          model = knownModel;
        } else {
          // Unknown model id for this provider — crib transport metadata (baseUrl,
          // api, compat) from any sibling model already registered under the same
          // provider. This is essential for aggregator providers like OpenRouter,
          // where any model id is valid as long as the endpoint is right, so new
          // ids work the day they ship without waiting for pi-ai's static list
          // to catch up.
          const sibling = (modelRegistry.getAll() as Model<Api>[]).find(
            (m) => m.provider === options.model!.provider,
          );
          if (!sibling) {
            throw new Error(
              `Unknown model "${options.model.id}" and no models registered for provider "${options.model.provider}". ` +
              `Register the provider in ~/.pi/agent/models.json or choose a known model.`,
            );
          }
          model = {
            ...sibling,
            id: options.model.id,
            name: options.model.id,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          };
        }
      }

      // Apply explicit API key override from piConfig if set
      if (this.piConfig?.apiKey) {
        authStorage.setRuntimeApiKey(model.provider, this.piConfig.apiKey);
      }

      // Build tools
      const isCoding = options.tools === 'coding';
      const isReadOnly = options.tools === 'read-only';
      const baseTools = isCoding
        ? createCodingTools(options.cwd)
        : isReadOnly
          ? createReadOnlyTools(options.cwd)
          : [];

      // Collect bridged MCP tools (only for coding agents). These come from
      // `PiMcpBridge` and are kept strictly separate from planner-supplied
      // `customTools` so each tool source can be filtered independently and
      // no cast is needed when handing them to the Pi session.
      let bridgedMcpTools: AgentTool[] = [];
      if (isCoding && this.mcpServers && Object.keys(this.mcpServers).length > 0) {
        if (!this.mcpBridge) {
          this.mcpBridge = new PiMcpBridge(this.mcpServers);
        }
        bridgedMcpTools = await this.mcpBridge.getTools();
      }

      // Collect extension tools (only for coding agents, skip in bare or isolated mode).
      // In isolated mode (the default), discoverPiExtensions is skipped entirely —
      // no ambient project/user/global Pi extensions are loaded. discoverAndLoadExtensions
      // and session.bindExtensions() are similarly skipped below. See PiHarness architecture
      // notes for the full isolation contract.
      let extensionPaths: string[] = [];
      if (isCoding && !this.bare && mode === 'ambient') {
        extensionPaths = await discoverPiExtensions(options.cwd, this.extensions);
      }

      // Convert eforge CustomTools to Pi 0.68 ToolDefinition objects. The
      // execute callback matches Pi's arity-5 signature
      // `(toolCallId, params, signal, onUpdate, ctx)`; the planner handler
      // only uses `params`, the rest are accepted and ignored.
      // The inputSchema is now a TypeBox TObject — pass it directly as parameters
      // without any Zod/JSON-Schema round-trip.
      // Read-only agents never receive custom tools — they are blind sensors with
      // no submission or mutation capability.
      const eforgeCustomTools: ToolDefinition[] = [];
      if (!isReadOnly && options.customTools && options.customTools.length > 0) {
        for (const ct of options.customTools) {
          const parameters = ct.inputSchema;
          const execute: ToolDefinition['execute'] = async (
            _toolCallId,
            params,
            _signal,
            _onUpdate,
            _ctx,
          ) => {
            try {
              const result = await ct.handler(params);
              return {
                content: [{ type: 'text' as const, text: result }],
                details: {},
              };
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              return {
                content: [{ type: 'text' as const, text: `Error: ${message}` }],
                details: {},
              };
            }
          };
          eforgeCustomTools.push({
            name: ct.name,
            label: ct.name,
            description: ct.description,
            parameters,
            execute,
          });
        }
      }

      // Expand Claude SDK PascalCase mutation tool names to their Pi lowercase
      // equivalents so that a caller who sets disallowedTools: ['Write', 'Edit', 'Bash']
      // also blocks 'write', 'edit', 'bash' in Pi without requiring separate callsites.
      const effectiveDisallowed = expandDisallowedToolAliasesForPi(options.disallowedTools ?? []);

      // Filter built-in, bridged, and eforge custom tools independently so
      // each respects `allowedTools`/`disallowedTools` without interfering
      // with the others.
      const filteredBaseTools = filterTools(baseTools, options.allowedTools, effectiveDisallowed);
      const filteredBridgedMcpTools = filterTools(bridgedMcpTools, options.allowedTools, effectiveDisallowed);
      const filteredEforgeCustomTools = filterTools(eforgeCustomTools, options.allowedTools, effectiveDisallowed);

      // Create session manager (in-memory, no persistence needed for one-shot agents)
      const sessionManager = SessionManager.inMemory();

      // Create settings manager
      const settingsManager = SettingsManager.create(options.cwd);

      // Build a resource loader with overrides that strip anything contributed by the
      // `@eforge-build/pi-eforge` package (anti-recursion) and — in isolated mode (the
      // default) — all other ambient resources too. See buildResourceLoaderOverrides for
      // the full isolation contract. User-installed packages that are NOT pi-eforge are
      // preserved when mode === 'ambient', so users who explicitly opt in can still bring
      // their own skills / extensions into eforge agent contexts.
      const overrideResult = buildResourceLoaderOverrides(mode);
      const resourceLoader = new DefaultResourceLoader({
        cwd: options.cwd,
        agentDir: getAgentDir(),
        settingsManager,
        extensionsOverride: overrideResult.extensionsOverride,
        skillsOverride: overrideResult.skillsOverride,
        promptsOverride: overrideResult.promptsOverride,
        themesOverride: overrideResult.themesOverride,
      });
      await resourceLoader.reload();

      // Create agent session using the filtered resource loader.
      //
      // `tools` on `createAgentSession` is an allowlist that gates BOTH
      // built-in tools AND the `customTools` array (see pi-coding-agent
      // `agent-session.ts#_refreshToolRegistry`: `isAllowedTool(name)` is
      // applied to every custom tool). If we only pass built-in tool names,
      // pi strips every bridged MCP tool and every planner submission tool
      // before the model ever sees them - the model then reads the planner
      // prompt, tries to call `submit_plan_set`, gets a "tool not registered"
      // response from pi's dispatch, and declares the tool "isn't available
      // in this environment" before falling back to Write.
      //
      // Include the bridged + eforge custom tool names in the allowlist so
      // they survive pi's filter.
      ({ session } = await createAgentSession({
        cwd: options.cwd,
        model,
        thinkingLevel,
        tools: [
          ...filteredBaseTools.map((t) => t.name),
          ...filteredBridgedMcpTools.map((t) => t.name),
          ...filteredEforgeCustomTools.map((t) => t.name),
        ],
        customTools: [...filteredBridgedMcpTools, ...filteredEforgeCustomTools],
        authStorage,
        modelRegistry,
        sessionManager,
        settingsManager,
        resourceLoader,
      }));

      // Set up extension tools on the session if we have extensions
      if (extensionPaths.length > 0) {
        // Load extensions via Pi's discovery mechanism
        const extensionResult = await discoverAndLoadExtensions(extensionPaths, options.cwd);
        // Extension tools are registered through the session's extension runner
        if (extensionResult.extensions.length > 0) {
          await session.bindExtensions({});
        }
      }

      // Set up the event queue for bridging Pi events to EforgeEvents
      const eventQueue = new AsyncEventQueue<EforgeEvent>();
      eventQueue.addProducer();

      // Track usage for result
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let totalCacheRead = 0;
      let totalCacheWrite = 0;
      let totalCost = 0;
      let numTurns = 0;
      let resultText = '';
      let streamingAssistantText = '';

      // Cumulative snapshot captured at the end of each turn. Pi's
      // `session.getSessionStats()` reports cumulative session totals; we
      // subtract the previous snapshot to emit per-turn deltas on
      // `agent:usage`, matching the unified cadence contract (deltas per
      // turn plus one `final: true` cumulative at session end).
      const prevCumulative = {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0,
      };

      // Subscribe to Pi agent events (session emits AgentSessionEvent which is a superset of AgentEvent)
      const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
        translatePiEvent(event, eventQueue, agent, agentId, planId);

        if (event.type === 'message_start') {
          streamingAssistantText = '';
        }

        if (event.type === 'message_update') {
          const updateText = extractMessageUpdateText(event);
          if (updateText.fullText !== undefined) {
            streamingAssistantText = updateText.fullText;
            resultText = updateText.fullText;
          } else if (updateText.delta !== undefined) {
            streamingAssistantText += updateText.delta;
            resultText = streamingAssistantText;
          }
        }

        if (event.type === 'message_end') {
          const text = extractAssistantMessageText((event as { message?: unknown }).message);
          if (text !== undefined) {
            streamingAssistantText = text;
            resultText = text;
          }
        }

        // Track turns and check budget per-turn
        if (event.type === 'turn_end') {
          // Detect SDK-level backend errors reported via the assistant message's
          // stopReason. pi-ai does not throw on unreachable backends; it returns
          // an AssistantMessage with stopReason='error' and errorMessage set.
          const turnMsg = (event as { message?: { stopReason?: string; errorMessage?: string } }).message;
          if (turnMsg && turnMsg.stopReason === 'error') {
            const backendMsg = turnMsg.errorMessage && turnMsg.errorMessage.length > 0
              ? `Backend error: ${turnMsg.errorMessage}`
              : 'Backend returned an error response with no message';
            error = backendMsg;
            try { session.abort(); } catch { /* ignore */ }
            return;
          }
          numTurns++;
          // Update cumulative cost from session stats after each turn
          const stats = session.getSessionStats();
          totalInputTokens = stats.tokens.input;
          totalOutputTokens = stats.tokens.output;
          totalCacheRead = stats.tokens.cacheRead;
          totalCacheWrite = stats.tokens.cacheWrite;
          totalCost = stats.cost;

          // Compute per-turn deltas by subtracting the previously observed
          // cumulative snapshot, then advance the snapshot. Per the unified
          // cadence contract, non-final `agent:usage` events carry deltas;
          // the authoritative cumulative total is emitted once at session
          // end with `final: true`.
          const deltaUncachedInput = totalInputTokens - prevCumulative.input;
          const deltaOutput = totalOutputTokens - prevCumulative.output;
          const deltaCacheRead = totalCacheRead - prevCumulative.cacheRead;
          const deltaCacheWrite = totalCacheWrite - prevCumulative.cacheWrite;
          const deltaCost = totalCost - prevCumulative.cost;
          prevCumulative.input = totalInputTokens;
          prevCumulative.output = totalOutputTokens;
          prevCumulative.cacheRead = totalCacheRead;
          prevCumulative.cacheWrite = totalCacheWrite;
          prevCumulative.cost = totalCost;

          // Emit agent:usage event (per-turn delta) for live monitoring
          eventQueue.push({
            timestamp: new Date().toISOString(),
            type: 'agent:usage',
            planId,
            agentId,
            agent,
            usage: normalizeUsage({
              uncachedInput: deltaUncachedInput,
              output: deltaOutput,
              cacheRead: deltaCacheRead,
              cacheCreation: deltaCacheWrite,
            }),
            costUsd: deltaCost,
            numTurns: 1,
          });

          // Enforce budget per-turn to abort early
          if (options.maxBudgetUsd !== undefined && totalCost > options.maxBudgetUsd) {
            session.abort();
            error = `Budget exceeded: $${totalCost.toFixed(4)} > $${options.maxBudgetUsd}`;
          }
        }

        // Handle error events — prevent the generator from hanging
        if ((event as { type: string }).type === 'error') {
          const errMsg = 'error' in event && (event as { error: unknown }).error instanceof Error
            ? ((event as { error: Error }).error).message
            : 'message' in event ? String((event as { message: unknown }).message) : 'Pi session error';
          error = errMsg;
        }

        // Detect Pi tool-call infrastructure failures (e.g. global theme proxy accessed
        // without initTheme() in a headless SDK session). Classify the *raw* result before
        // truncation so the full message is available for pattern matching. When detected,
        // abort the session and record the typed error for the throw path below.
        if (event.type === 'tool_execution_end' && !infraError && isPiToolExecutionInfrastructureError(event)) {
          const rawResult = stringifyToolResult((event as { result?: unknown }).result);
          const infraMsg = `Pi tool-call infrastructure failure: ${rawResult}`;
          error = infraMsg;
          infraError = new AgentTerminalError('error_pi_tool_infrastructure', infraMsg);
          try { session.abort(); } catch { /* ignore abort errors */ }
        }

        // Capture final result text from agent_end when Pi delivers it, but
        // do not rely on agent_end exclusively. Some provider/session paths can
        // resolve the prompt before the final lifecycle event is observed; the
        // streaming/message_end fallback above keeps agent:result populated.
        if (event.type === 'agent_end') {
          const text = extractLastAssistantMessageText(event.messages);
          if (text !== undefined) resultText = text;
        }
      });

      // Wire abort signal
      if (options.abortSignal) {
        options.abortSignal.addEventListener('abort', () => {
          session.abort();
        }, { once: true });
      }

      // Fire debug capture hook with the fully-constructed request. At this
      // point session.state.systemPrompt includes the pi-coding-agent preamble,
      // tool snippets, ancestor AGENTS.md/CLAUDE.md context, skills, and
      // date/cwd metadata. session.state.tools is the final tool list visible
      // to the model.
      if (this.onDebugPayload) {
        const sessionState = session.state as { systemPrompt?: string; tools?: Array<{ name: string; description?: string; parameters?: unknown }> };
        const sessionTools = Array.isArray(sessionState.tools) ? sessionState.tools : [];
        const debugPayload: HarnessDebugPayload = {
          harness: 'pi',
          agent,
          userPrompt: options.prompt,
          systemPrompt: sessionState.systemPrompt ?? '',
          tools: sessionTools.map((t) => ({
            name: t.name,
            ...(t.description !== undefined ? { description: t.description } : {}),
            ...(t.parameters !== undefined ? { parameters: t.parameters } : {}),
          })),
          model: { id: options.model.id, provider: options.model.provider },
          ...(options.effort !== undefined ? { effort: options.effort } : {}),
          ...(options.thinking !== undefined ? { thinking: options.thinking } : {}),
          maxTurns: options.maxTurns,
          ...(options.allowedTools !== undefined ? { allowedTools: options.allowedTools } : {}),
          ...(effectiveDisallowed.length > 0 ? { disallowedTools: effectiveDisallowed } : {}),
          extra: {
            toolsMode: options.tools,
            isReadOnly,
            thinkingLevel,
            bare: this.bare,
            resourcesMode: mode,
            projectMcpServerNames: Object.keys(this.mcpServers ?? {}).sort(),
            extensionPathCount: extensionPaths.length,
            baseToolCount: filteredBaseTools.length,
            bridgedMcpToolCount: filteredBridgedMcpTools.length,
            customToolCount: filteredEforgeCustomTools.length,
            systemPromptBytes: (sessionState.systemPrompt ?? '').length,
            eforgePackageName: EFORGE_PI_PACKAGE_NAME,
            ...overrideResult.getCounters(),
            note: 'systemPrompt reflects what pi-coding-agent constructed: the coding-assistant preamble + tool snippets + ancestor AGENTS.md/CLAUDE.md + skills + date/cwd. projectMcpServerNames lists project MCP servers filtered by the tier toolbelt (bridged to Pi via PiMcpBridge). Any resources contributed by @eforge-build/pi-eforge were filtered out via resourceLoader overrides to prevent eforge recursion. resourcesMode indicates whether ambient Pi resources were suppressed (isolated) or preserved (ambient).',
          },
        };
        await this.onDebugPayload(debugPayload);
      }

      // Send prompt — non-blocking so events stream through the queue concurrently
      const promptDone = session.prompt(options.prompt).then(() => {
        // Final stats update (in case turn_end didn't fire for the last turn)
        const stats = session.getSessionStats();
        totalInputTokens = stats.tokens.input;
        totalOutputTokens = stats.tokens.output;
        totalCacheRead = stats.tokens.cacheRead;
        totalCacheWrite = stats.tokens.cacheWrite;
        totalCost = stats.cost;
      }).catch((err: unknown) => {
        if (!error) {
          const msg = err instanceof Error ? err.message : String(err);
          error = msg;
          // Also classify prompt-level infra failures (e.g. Theme not initialized thrown
          // from session.prompt() itself rather than from a tool_execution_end event).
          if (isPiToolInfrastructureError(msg) && !infraError) {
            const infraMsg = `Pi tool-call infrastructure failure: ${msg}`;
            infraError = new AgentTerminalError('error_pi_tool_infrastructure', infraMsg);
          }
        }
      }).finally(() => {
        unsubscribe();
        eventQueue.removeProducer();
      });

      // Yield events as they stream in from the queue
      for await (const event of eventQueue) {
        yield event;
        // If budget was exceeded in the subscriber, stop yielding
        if (error) break;
      }

      // Wait for prompt to finish
      await promptDone;

      // Zero-token backstop: if the session completed turns but reported no
      // token usage at all, the backend likely failed silently (e.g. provider
      // swallowed the error without setting stopReason='error'). Legitimate
      // turns always consume at least the prompt's input tokens.
      if (!error && numTurns > 0 && totalInputTokens === 0 && totalOutputTokens === 0) {
        error = `Agent completed ${numTurns} turn(s) with zero token usage — backend may be unreachable or misconfigured`;
      }

      if (!error && resultText.length === 0 && totalOutputTokens > 0) {
        yield {
          timestamp: new Date().toISOString(),
          type: 'agent:warning',
          planId,
          agentId,
          agent,
          code: 'pi-empty-result-text',
          message: `Pi session reported ${totalOutputTokens} output token(s) but no extractable assistant text for ${model.provider}/${model.id}.`,
        };
      }

      // Emit agent:result
      const durationMs = Date.now() - startTime;
      const resultData: AgentResultData = {
        durationMs,
        durationApiMs: durationMs, // Pi doesn't separate API time
        numTurns,
        totalCostUsd: totalCost,
        usage: normalizeUsage({
          uncachedInput: totalInputTokens,
          output: totalOutputTokens,
          cacheRead: totalCacheRead,
          cacheCreation: totalCacheWrite,
        }),
        modelUsage: {
          [model.id]: toModelUsageEntry(
            {
              uncachedInput: totalInputTokens,
              output: totalOutputTokens,
              cacheRead: totalCacheRead,
              cacheCreation: totalCacheWrite,
            },
            totalCost,
          ),
        },
        harness: 'pi',
        provider: model.provider,
        resultText: resultText || undefined,
      };

      // Authoritative cumulative usage for this session. Emitted right
      // before agent:result so consumers have a single `final: true`
      // checkpoint in the usage channel co-located with the rest of the
      // lifecycle sequence.
      yield {
        timestamp: new Date().toISOString(),
        type: 'agent:usage',
        planId,
        agentId,
        agent,
        usage: resultData.usage,
        costUsd: resultData.totalCostUsd,
        numTurns: resultData.numTurns,
        final: true,
      };

      yield { timestamp: new Date().toISOString(), type: 'agent:result', planId, agentId, agent, result: resultData };

      if (error) {
        if (infraError) {
          throw infraError;
        }
        if (isTransientTransportError(error)) {
          throw new AgentTerminalError('error_transient_transport', error);
        }
        throw new Error(error);
      }

      // Handle fallback model retry
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);

      if (err instanceof AgentTerminalError && err.subtype === 'error_pi_tool_infrastructure') {
        throw err;
      }

      if (isTransientTransportError(error)) {
        throw err instanceof AgentTerminalError
          ? err
          : new AgentTerminalError('error_transient_transport', error);
      }

      // Attempt fallback model if configured and this looks like a model error
      if (options.fallbackModel && isModelError(error)) {
        // Re-run with fallback model — wrap string in ModelRef, preserving original provider
        const fallbackModelRef = { id: options.fallbackModel, provider: options.model?.provider };
        const fallbackOptions = { ...options, model: fallbackModelRef, fallbackModel: undefined };
        yield* this.run(fallbackOptions, agent, planId);
        return;
      }

      throw err;
    } finally {
      // Abort the session to prevent orphaned background processes
      try { session?.abort(); } catch { /* ignore abort errors */ }

      yield { type: 'agent:stop', planId, agent, agentId, error, timestamp: new Date().toISOString() };

      // Clean up MCP bridge if we created one
      // Note: we keep the bridge alive across runs for connection reuse
    }
  }
}

/**
 * Check if an error message suggests a model-related issue (not found, unauthorized, etc.)
 */
function isModelError(errorMsg: string): boolean {
  const modelErrorPatterns = [
    'model not found',
    'model_not_found',
    'invalid model',
    'unsupported model',
    'model not available',
    '404',
    '401',
    '403',
  ];
  const lower = errorMsg.toLowerCase();
  return modelErrorPatterns.some(p => lower.includes(p));
}
