import type { EforgeEvent, CompileContextGuardDiagnostics, CompileScopeContextFailure } from '../events.js';

export interface CompileContextGuardLimits {
  maxPromptBytes: number;
  maxObservedInputTokens: number;
  maxObservedTurns?: number;
  maxExplanationBytes: number;
}

export interface CompileContextGuardOptions {
  stage: 'planner';
  limits?: Partial<CompileContextGuardLimits>;
  guardDiagnostics?: CompileContextGuardDiagnostics;
}

const MAX_COMPILE_SCOPE_CONTEXT_EXPLANATION_LENGTH = 2000;

export const DEFAULT_COMPILE_CONTEXT_GUARD_LIMITS: CompileContextGuardLimits = {
  maxPromptBytes: 1_500_000,
  maxObservedInputTokens: 160_000,
  maxObservedTurns: undefined,
  maxExplanationBytes: 1_500,
};

export type PlannerFamilyStage = CompileContextGuardOptions['stage'];

export interface PlannerContextObservation {
  inputTokens: number;
  outputTokens: number;
  turns: number;
  promptBytes: number;
}

export interface PlannerContextUsageDelta {
  inputTokens: number;
  outputTokens: number;
  turns: number;
  final: boolean;
}

export interface PlannerContextObservationState {
  observed: PlannerContextObservation;
  cumulativeFallback: { inputTokens: number; turns: number };
  sawFinalUsage: boolean;
}

export function createPlannerContextObservationState(): PlannerContextObservationState {
  return {
    observed: { inputTokens: 0, outputTokens: 0, turns: 0, promptBytes: 0 },
    cumulativeFallback: { inputTokens: 0, turns: 0 },
    sawFinalUsage: false,
  };
}

export function setPlannerContextPromptBytes(state: PlannerContextObservationState, prompt: string): PlannerContextObservation {
  state.observed.promptBytes = Buffer.byteLength(prompt, 'utf8');
  return state.observed;
}

export function observePlannerContextUsage(
  state: PlannerContextObservationState,
  event: EforgeEvent,
  stage: PlannerFamilyStage,
): PlannerContextUsageDelta | undefined {
  if (event.type !== 'agent:usage' || event.agent !== stage) return undefined;
  const usesInputDelta = event.usage.input > 0;
  const effectiveInput = usesInputDelta ? event.usage.input : event.usage.total;
  if (event.final) {
    state.observed.inputTokens = Math.max(state.observed.inputTokens, effectiveInput);
    state.observed.outputTokens = Math.max(state.observed.outputTokens, event.usage.output);
    state.observed.turns = Math.max(state.observed.turns, event.numTurns);
    state.sawFinalUsage = true;
    return { inputTokens: effectiveInput, outputTokens: event.usage.output, turns: event.numTurns, final: true };
  }
  if (state.sawFinalUsage) {
    state.observed.inputTokens = 0;
    state.observed.outputTokens = 0;
    state.observed.turns = 0;
    state.cumulativeFallback.inputTokens = 0;
    state.cumulativeFallback.turns = 0;
    state.sawFinalUsage = false;
  }
  const turnInputTokens = usesInputDelta
    ? effectiveInput
    : Math.max(0, effectiveInput - state.cumulativeFallback.inputTokens);
  const turnCount = usesInputDelta
    ? event.numTurns
    : Math.max(0, event.numTurns - state.cumulativeFallback.turns);
  if (!usesInputDelta) {
    state.cumulativeFallback.inputTokens = Math.max(state.cumulativeFallback.inputTokens, effectiveInput);
    state.cumulativeFallback.turns = Math.max(state.cumulativeFallback.turns, event.numTurns);
  }
  state.observed.inputTokens = Math.max(state.observed.inputTokens, turnInputTokens);
  state.observed.turns += turnCount;
  state.observed.outputTokens += event.usage.output;
  return { inputTokens: turnInputTokens, outputTokens: event.usage.output, turns: turnCount, final: false };
}

export class CompileScopeContextError extends Error {
  readonly failure: CompileScopeContextFailure;

  constructor(failure: CompileScopeContextFailure) {
    super(failure.explanation);
    this.name = 'CompileScopeContextError';
    this.failure = failure;
  }
}

export function resolveCompileContextGuardLimits(limits?: Partial<CompileContextGuardLimits>): CompileContextGuardLimits {
  const resolved = { ...DEFAULT_COMPILE_CONTEXT_GUARD_LIMITS, ...limits };
  return {
    ...resolved,
    maxExplanationBytes: Math.min(resolved.maxExplanationBytes, MAX_COMPILE_SCOPE_CONTEXT_EXPLANATION_LENGTH),
  };
}
