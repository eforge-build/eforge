// Foundation barrel — re-exports all shared types and utilities

// --- events ---
export type {
  ForgeEvent,
  AgentRole,
  ForgeResult,
  ClarificationQuestion,
  ReviewIssue,
  PlanFile,
  OrchestrationConfig,
  ForgeState,
  PlanState,
  PlanOptions,
  BuildOptions,
  ReviewOptions,
  ForgeStatus,
} from './events.js';

// --- plan ---
export {
  parsePlanFile,
  parseOrchestrationConfig,
  resolveDependencyGraph,
  validatePlanSet,
} from './plan.js';

// --- prompts ---
export { loadPrompt } from './prompts.js';

// --- agents/common ---
export { mapSDKMessages, parseClarificationBlocks } from './agents/common.js';

// --- state ---
export { loadState, saveState, updatePlanStatus, isResumable } from './state.js';

// --- planner ---

// --- builder ---

// --- reviewer ---
export { runReview, parseReviewIssues, composeReviewPrompt } from './agents/reviewer.js';
export type { ReviewerOptions } from './agents/reviewer.js';

// --- orchestration ---

// --- config ---

// --- forge-core ---
