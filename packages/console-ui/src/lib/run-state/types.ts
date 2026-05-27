/**
 * Consolidated type definitions for the run-state subsystem.
 *
 * Re-exports wire types from @eforge-build/client that the reducer and handlers
 * depend on, and defines local types (PipelineStage, RunState, AgentThread, etc.)
 * that are owned by this subsystem.
 */

// Re-export key types from @eforge-build/client wire events
export type {
  EforgeEvent,
  AgentRole,
  AgentResultData,
  EforgeResult,
  ClarificationQuestion,
  ReviewIssue,
  PlanFile,
  OrchestrationConfig,
  PlanState,
  EforgeState,
  ExpeditionModule,
} from '@eforge-build/client/browser';

// Shared types owned by @eforge-build/client; re-export so every
// run-state importer continues to resolve the same names.
import type { BuildStageSpec, ReviewProfileConfig } from '@eforge-build/client/browser';
export type { BuildStageSpec, ReviewProfileConfig };

import type { BuildDecision, PlanningDecision } from '@eforge-build/client/browser';

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';

export type PipelineStage = 'plan' | 'implement' | 'doc-author' | 'doc-sync' | 'test' | 'review' | 'evaluate' | 'complete' | 'failed';

export type ValidationCommandStatus = 'running' | 'passed' | 'failed' | 'timeout';

export interface ValidationCommandSpan {
  command: string;
  startedAt: string;
  endedAt: string | null;
  status: ValidationCommandStatus;
  exitCode: number | null;
}

export type SessionProfile = {
  profileName: string | null;
  source: 'local' | 'project' | 'user-local' | 'missing' | 'none' | 'override';
  scope: 'local' | 'project' | 'user' | null;
  config: unknown | null;
};

/** Union of all decision kinds that can appear in the decisions timeline. */
export type Decision = BuildDecision | PlanningDecision;

/** A decision wrapped with its event timestamp and event type for time-positioning on the timeline. */
export interface DecisionPoint {
  decision: Decision;
  timestamp: string;
  eventType: 'planning:decision' | 'plan:build:decision';
}

/**
 * Mirrors the `agent:activity` wire shape minus the envelope fields
 * (sessionId, runId, timestamp, type, agentId, agent, planId).
 * Stored on `AgentThread` after an `agent:activity` event arrives.
 */
export interface AgentActivityFacts {
  files?: Array<{
    path: string;
    status?: string;
    additions?: number;
    deletions?: number;
    binary?: boolean;
  }>;
  totals?: {
    filesChanged: number;
    additions: number;
    deletions: number;
  };
  attribution: 'exact' | 'best_effort' | 'unavailable';
  notes?: string[];
}

export type ModuleStatus = 'pending' | 'planning' | 'complete';

export interface StoredEvent {
  event: import('@eforge-build/client/browser').EforgeEvent;
  eventId: string;
}

export interface AgentThread {
  agentId: string;
  agent: string; // AgentRole
  planId?: string;
  startedAt: string;      // ISO from agent:start timestamp
  endedAt: string | null; // ISO from agent:stop timestamp
  durationMs: number | null; // from agent:result
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cacheRead: number | null;
  cacheCreation: number | null;
  costUsd: number | null;
  numTurns: number | null;
  model: string;
  /** The harness kind for this tier entry. */
  harness?: string;
  /** Provenance source for harness — "tier", "role", or "plan". */
  harnessSource?: string;
  effort?: string;
  thinking?: string;
  effortClamped?: boolean;
  effortOriginal?: string;
  effortSource?: string;
  thinkingSource?: string;
  thinkingCoerced?: boolean;
  thinkingOriginal?: Record<string, unknown>;
  tier?: string;
  tierSource?: string;
  perspective?: string;
  /** The toolbelt name selected for this tier. Null when explicitly 'none', string when named. */
  toolbelt?: string | null;
  /** Provenance of the toolbelt selection ('tier', 'role', 'plan', or 'default'). */
  toolbeltSource?: string;
  /** Which project MCP servers were selected ('all', 'none', or 'toolbelt'). */
  projectMcpSelection?: string;
  /** Sorted names of the project MCP servers passed to this tier's harness. */
  projectMcpServerNames?: string[];
  /** Final result text from the agent:result event. */
  resultText?: string;
  /** Error message from the agent:stop event, when the agent stopped with an error. */
  stopError?: string;
  /** Deterministic file/diffstat facts from the agent:activity event. */
  activity?: AgentActivityFacts;
}

export interface RunState {
  events: StoredEvent[];
  startTime: number | null;
  planStatuses: Record<string, PipelineStage>;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheCreation: number;
  totalCost: number;
  isComplete: boolean;
  resultStatus: 'completed' | 'failed' | null;
  fileChanges: Map<string, string[]>;
  reviewIssues: Record<string, import('@eforge-build/client/browser').ReviewIssue[]>;
  agentThreads: AgentThread[];
  expeditionModules: import('@eforge-build/client/browser').ExpeditionModule[];
  moduleStatuses: Record<string, ModuleStatus>;
  earlyOrchestration: import('@eforge-build/client/browser').OrchestrationConfig | null;
  profile: SessionProfile | null;
  endTime: number | null;
  mergeCommits: Record<string, string>;
  liveAgentUsage: Record<string, { input: number; output: number; cacheRead: number; cacheCreation: number; cost: number; turns: number }>;
  enqueueStatus: 'running' | 'complete' | 'failed' | null;
  enqueueTitle: string | null;
  enqueueSource: string | null;
  validationCommands: ValidationCommandSpan[];
  autoBuildPausedReason: string | null;
  autoBuildPausedAt: string | null;
  perspectiveErrors: Record<string, Array<{ perspective: string; error: string; timestamp: string }>>;
  reviewIssuesByPerspective: Record<string, Record<string, import('@eforge-build/client/browser').ReviewIssue[]>>;
  /**
   * Decisions keyed by planId (for build-phase decisions) or by the sentinel
   * `'__run__'` for session-level planning-phase decisions not tied to a specific plan.
   */
  decisions: Record<string, DecisionPoint[]>;
}

// Ensure BuildDecision and PlanningDecision are used (they compose Decision above)
export type { BuildDecision, PlanningDecision };
