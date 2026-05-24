import type { EforgeEvent, AgentRole } from './events.js';
import type { ModelRef } from './config.js';
import type { TObject } from '@sinclair/typebox';

export type ToolPreset = 'coding' | 'read-only' | 'none';

// ---------------------------------------------------------------------------
// SDK Passthrough Types
// ---------------------------------------------------------------------------

/** Controls Claude's thinking/reasoning behavior. */
export type ThinkingConfig =
  | { type: 'adaptive' }
  | { type: 'enabled'; budgetTokens?: number }
  | { type: 'disabled' };

/** Effort level for controlling how much thinking/reasoning Claude applies. */
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * SDK passthrough fields that can be configured per-agent.
 * All fields are optional — when `undefined`, the SDK uses its own defaults.
 */
export interface SdkPassthroughConfig {
  model?: ModelRef;
  thinking?: ThinkingConfig;
  effort?: EffortLevel;
  maxBudgetUsd?: number;
  fallbackModel?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  /** Text appended to the agent prompt after variable substitution. Not passed to the backend SDK. */
  promptAppend?: string;
  // --- eforge:region plan-01-agent-context-runtime ---
  /**
   * Build phase context for extension hooks. Values: 'compile' | 'build' | 'standalone'.
   * Not forwarded to the backend SDK.
   */
  phase?: string;
  /**
   * Build stage context for extension hooks (e.g. 'implement', 'review', 'planner').
   * Not forwarded to the backend SDK.
   */
  stage?: string;
  // --- eforge:endregion plan-01-agent-context-runtime ---
}

/**
 * Keys that are part of resolved agent config but should NOT be forwarded to the backend SDK.
 * `phase` and `stage` are excluded here because they need to flow through to the harness's
 * `run()` method for extension-hook context. SDK backends never forward these to the external
 * API — they only read specific known fields when constructing API calls.
 */
const NON_SDK_KEYS = new Set(['promptAppend']);

/**
 * Strip `undefined` values from an SdkPassthroughConfig so the SDK
 * doesn't receive explicit `undefined` keys, and omit non-SDK keys
 * like `promptAppend`. Returns a new object containing only the keys
 * that have defined values and are safe to forward to the backend.
 */

export function pickSdkOptions(config: SdkPassthroughConfig): Partial<SdkPassthroughConfig> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (value !== undefined && !NON_SDK_KEYS.has(key)) {
      result[key] = value;
    }
  }
  return result as Partial<SdkPassthroughConfig>;
}

// ---------------------------------------------------------------------------
// Event-Stream Naming Contracts
// ---------------------------------------------------------------------------

/**
 * Tool-call identifier normalization.
 *
 * Every `agent:tool_use` and `agent:tool_result` event on the `AgentHarness`
 * event stream carries a stable identifier under the name `toolUseId`.
 * Provider SDKs use different names natively:
 *
 *  - Claude Agent SDK: `block.id` on `tool_use` content blocks.
 *  - Pi coding agent: `toolCallId` on `tool_execution_start` / `tool_execution_end` events.
 *
 * Harnesses are responsible for mapping their provider-native name onto
 * `toolUseId` before emission. The shared helper `normalizeToolUseId` in
 * `./harnesses/common.ts` is the single source of truth for that mapping so
 * downstream consumers (monitor UI, CLI renderer, tracing) only ever see the
 * unified `toolUseId` name.
 */

// ---------------------------------------------------------------------------
// Custom Tools
// ---------------------------------------------------------------------------

/**
 * A custom tool that can be injected into an agent run.
 * The handler captures submission state via closure - no state management needed in the backend.
 */
export interface CustomTool {
  name: string;
  description: string;
  inputSchema: TObject;
  handler: (input: unknown) => Promise<string>;
}

// ---------------------------------------------------------------------------
// Agent Run Options & Backend Interface
// ---------------------------------------------------------------------------

export interface AgentRunOptions {
  prompt: string;
  cwd: string;
  maxTurns: number;
  tools: ToolPreset;
  model?: ModelRef;
  thinking?: ThinkingConfig;
  effort?: EffortLevel;
  maxBudgetUsd?: number;
  fallbackModel?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  abortSignal?: AbortSignal;
  /** Custom tools to inject into the agent run (e.g. submission tools for planners). */
  customTools?: CustomTool[];
  /** True when the resolved effort was clamped to the model's maximum supported level. */
  effortClamped?: boolean;
  /** The original effort level before clamping was applied. */
  effortOriginal?: EffortLevel;
  /** Provenance of the resolved effort value. */
  effortSource?: 'tier' | 'role' | 'plan';
  /** Provenance of the resolved thinking value. */
  thinkingSource?: 'tier' | 'role' | 'plan';
  /** True when thinking was coerced from 'enabled' to 'adaptive' for models that only support adaptive thinking. */
  thinkingCoerced?: boolean;
  /** The original thinking config before coercion was applied. */
  thinkingOriginal?: ThinkingConfig;
  /** The resolved tier for this role. Stamped from resolveAgentConfig. */
  tier?: string;
  /** Provenance of the resolved tier value. */
  tierSource?: 'tier' | 'role' | 'plan';
  /** Harness kind for this role. Stamped from resolveAgentConfig. */
  harness?: 'claude-sdk' | 'pi';
  /** Provenance of the resolved harness value. */
  harnessSource?: 'tier';
  /** The perspective this agent is reviewing from (e.g. 'code', 'security'). Set only for parallel reviewer agents. */
  perspective?: string;
  /**
   * The toolbelt name selected for this role's tier. Undefined when the tier omits toolbelt
   * (default = all project MCP servers), null when toolbelt is explicitly 'none',
   * string when a named toolbelt is active. Stamped from the registry toolbelt summary.
   */
  toolbelt?: string | null;
  /** Provenance of the toolbelt selection. */
  toolbeltSource?: 'tier' | 'role' | 'plan' | 'default';
  /** Which project MCP servers were selected for this tier. */
  projectMcpSelection?: 'all' | 'none' | 'toolbelt';
  /** Sorted names of the project MCP servers passed to this tier's harness. */
  projectMcpServerNames?: string[];
  // --- eforge:region plan-01-agent-context-runtime ---
  /**
   * Build phase for this agent run. Populated by build and compile stage
   * call sites; undefined for programmatic/standalone invocations.
   * Values: 'compile' | 'build' | 'standalone'.
   * Not forwarded to the backend SDK.
   */
  phase?: string;
  /**
   * Build stage name for this agent run (e.g. 'implement', 'review', 'planner').
   * Populated by build and compile stage call sites; undefined for standalone runs.
   * Not forwarded to the backend SDK.
   */
  stage?: string;
  // --- eforge:endregion plan-01-agent-context-runtime ---
}

/**
 * Harness abstraction for running AI agents.
 * Agent runners consume this interface — they never import the AI SDK directly.
 */
export interface AgentHarness {
  /** Run an agent with the given prompt and yield EforgeEvents. */
  run(options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent>;
  /**
   * Translate a bare `CustomTool.name` into the name the model will actually
   * see when the backend registers the tool. Agent runners (e.g. the planner)
   * use this to inject the correct backend-visible identifier into prompts so
   * the model calls the tool by its real name.
   *
   * - Claude SDK wraps custom tools in an in-process MCP server, so it
   *   prepends the SDK's MCP-server prefix to the bare name.
   * - Pi registers custom tools directly by their bare name, so it returns
   *   `name` unchanged.
   */
  effectiveCustomToolName(name: string): string;
}

// ---------------------------------------------------------------------------
// Debug Payload Capture
// ---------------------------------------------------------------------------

/**
 * Snapshot of the request a backend is about to send. Used by the
 * `eforge debug-composer` command and other diagnostic tooling to compare how
 * different backends frame the same agent run (system prompt, tools, model,
 * etc.) without needing to proxy the actual HTTP traffic.
 */
export interface HarnessDebugPayload {
  /** Which harness produced this payload. */
  harness: 'claude-sdk' | 'pi';
  /** The agent role this payload is for (e.g. `'pipeline-composer'`). */
  agent: AgentRole;
  /** The user prompt string passed into the run. */
  userPrompt: string;
  /** The fully-constructed system prompt as the backend sees it. */
  systemPrompt: string;
  /** Tool definitions the backend will expose to the model. Empty array means no tools. */
  tools: Array<{ name: string; description?: string; parameters?: unknown }>;
  /** Model identifier (id plus provider for pi). */
  model: { id: string; provider?: string };
  /** Effort level, if set. */
  effort?: EffortLevel;
  /** Thinking config, if set. */
  thinking?: ThinkingConfig;
  /** Max turns for the run. */
  maxTurns: number;
  /** Tool allowlist, if any. */
  allowedTools?: string[];
  /** Tool denylist (after `disableSubagents` is applied on claude-sdk), if any. */
  disallowedTools?: string[];
  /** Arbitrary backend-specific context (e.g. settingSources, contextFiles, thinkingLevel). */
  extra?: Record<string, unknown>;
}

/** Callback fired by a harness just before it dispatches a run to its SDK. */
export type HarnessDebugCallback = (payload: HarnessDebugPayload) => void | Promise<void>;

// ---------------------------------------------------------------------------
// Typed Terminal Errors
// ---------------------------------------------------------------------------

/**
 * Terminal error subtypes mirrored from the Claude Agent SDK's `SDKResultError`.
 */
export type AgentTerminalSubtype =
  | 'error_max_turns'
  | 'error_max_budget_usd'
  | 'error_max_structured_output_retries'
  | 'error_during_execution'
  // --- eforge:region plan-01-pi-headless-isolation ---
  /**
   * A Pi tool-call hook handler (e.g. `session_start`, `tool_call`) threw before the model
   * could receive the tool result. The most common cause is a project-local Pi extension
   * accessing the global Pi theme proxy (`ctx.ui.theme`) without calling `initTheme()` first,
   * which is only available in interactive/TUI Pi sessions.
   *
   * Remediation: Set `pi.resources: ambient` only if you intentionally want project/user/global
   * Pi extensions inside eforge agent sessions, and ensure those extensions guard
   * `ctx.ui.theme` access for headless SDK contexts.
   */
  | 'error_pi_tool_infrastructure'
  // --- eforge:endregion plan-01-pi-headless-isolation ---
  // --- eforge:region plan-01-transport-resilience ---
  | 'error_transient_transport';
  // --- eforge:endregion plan-01-transport-resilience ---

/**
 * Thrown by backends when an agent run ends with a terminal SDK error.
 */
export class AgentTerminalError extends Error {
  readonly subtype: AgentTerminalSubtype;

  constructor(subtype: AgentTerminalSubtype, detail: string) {
    super(detail);
    this.name = 'AgentTerminalError';
    this.subtype = subtype;
  }
}

/** True when `err` is an `AgentTerminalError` with subtype `error_max_turns`. */
export function isMaxTurnsError(err: unknown): err is AgentTerminalError {
  return err instanceof AgentTerminalError && err.subtype === 'error_max_turns';
}

// --- eforge:region plan-01-transport-resilience ---
/**
 * Matches `Backend error: WebSocket closed <code>` messages from the backend SDK,
 * where <code> is any numeric WebSocket close code (e.g. 1000, 1012).
 * Requires the `backend error:` prefix so unrelated messages containing
 * a close code number are not misclassified as transient transport failures.
 */
const BACKEND_WS_CLOSE_RE = /backend error:\s*websocket closed\s+\d+\b/i;

/** True when an error message matches a known transient backend transport close. */
export function isTransientTransportError(message: string): boolean {
  if (BACKEND_WS_CLOSE_RE.test(message)) return true;
  const normalized = message.toLowerCase();
  return normalized.includes('backend error: websocket error');
}

/** Classify a thrown value into a terminal subtype when the engine can do so safely. */
export function classifyAgentTerminalSubtype(err: unknown): AgentTerminalSubtype | undefined {
  if (err instanceof AgentTerminalError) return err.subtype;
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : undefined;
  if (message && isTransientTransportError(message)) return 'error_transient_transport';
  // --- eforge:region plan-01-pi-headless-isolation ---
  if (message && isPiToolInfrastructureError(message)) return 'error_pi_tool_infrastructure';
  // --- eforge:endregion plan-01-pi-headless-isolation ---
  return undefined;
}
// --- eforge:endregion plan-01-transport-resilience ---

// --- eforge:region plan-01-pi-headless-isolation ---
/**
 * Pattern that matches Pi tool-call infrastructure failures caused by the global theme
 * proxy being accessed before `initTheme()` is called. These errors appear as tool-result
 * text when a Pi extension hook (e.g. `tool_call`) throws during a headless agent session.
 *
 * Intentionally narrow — matches only the well-attested `Theme not initialized` family.
 * Broader heuristics for other infra failures belong in a follow-up if they surface.
 */
const PI_TOOL_INFRA_THEME_RE = /theme\s+not\s+initialized/i;

/**
 * Matches explicit Pi tool-call infrastructure failure wrapper messages of the form:
 *   [optional whitespace][optional "Error:"] "Pi tool-call infrastructure failure: ..."
 *
 * Anchored at the start of the message so mid-message occurrences are not matched.
 * Conservative: does not match generic error text that merely contains similar words.
 */
const PI_TOOL_INFRA_WRAPPER_RE = /^\s*(?:error:\s*)?pi\s+tool-call\s+infrastructure\s+failure\s*:/i;

/**
 * Returns true when a tool-result or prompt-rejection message indicates a Pi tool-call
 * infrastructure failure. Matches:
 *
 * 1. The `Theme not initialized` family (original narrow match).
 * 2. Explicit wrapper messages that start with `Pi tool-call infrastructure failure:`,
 *    optionally preceded by whitespace or `Error:`.
 *
 * Used to classify `AgentTerminalError('error_pi_tool_infrastructure', ...)` so the engine
 * surfaces it as a clear infrastructure failure with remediation hints rather than a
 * generic no-submission compile failure.
 */
export function isPiToolInfrastructureError(message: string): boolean {
  return PI_TOOL_INFRA_THEME_RE.test(message) || PI_TOOL_INFRA_WRAPPER_RE.test(message);
}
// --- eforge:endregion plan-01-pi-headless-isolation ---

/**
 * Thrown by the planner agent runner when the agent stream ends without ever
 * calling a submission tool.
 */
export class PlannerSubmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlannerSubmissionError';
  }
}

/** True when `err` is a `PlannerSubmissionError`. */
export function isPlannerSubmissionError(err: unknown): err is PlannerSubmissionError {
  return err instanceof PlannerSubmissionError;
}
