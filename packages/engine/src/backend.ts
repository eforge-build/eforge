import type { EforgeEvent, AgentRole } from './events.js';
import type { ModelRef } from './config.js';

export type ToolPreset = 'coding' | 'none';

// ---------------------------------------------------------------------------
// SDK Passthrough Types
// ---------------------------------------------------------------------------

/** Controls Claude's thinking/reasoning behavior. */
export type ThinkingConfig =
  | { type: 'adaptive' }
  | { type: 'enabled'; budgetTokens?: number }
  | { type: 'disabled' };

/** Effort level for controlling how much thinking/reasoning Claude applies. */
export type EffortLevel = 'low' | 'medium' | 'high' | 'max';

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
  /** Set when the resolved model came from a fallback class instead of the role's effective class. */
  fallbackFrom?: import('./config.js').ModelClass;
  /** Text appended to the agent prompt after variable substitution. Not passed to the backend SDK. */
  promptAppend?: string;
}

/** Keys that are part of SdkPassthroughConfig but should NOT be forwarded to the backend SDK. */
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
  /** Set when the resolved model came from a fallback class instead of the role's effective class. */
  fallbackFrom?: import('./config.js').ModelClass;
}

/**
 * Backend abstraction for running AI agents.
 * Agent runners consume this interface — they never import the AI SDK directly.
 */
export interface AgentBackend {
  /** Run an agent with the given prompt and yield EforgeEvents. */
  run(options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent>;
}
