import type { CompileScopeContextFailure } from '../events.js';

export interface CompileContextGuardLimits {
  maxPromptBytes: number;
  maxObservedInputTokens: number;
  maxObservedTurns?: number;
  maxExplanationBytes: number;
}

const MAX_COMPILE_SCOPE_CONTEXT_EXPLANATION_LENGTH = 2000;

export const DEFAULT_COMPILE_CONTEXT_GUARD_LIMITS: CompileContextGuardLimits = {
  maxPromptBytes: 1_500_000,
  maxObservedInputTokens: 160_000,
  maxObservedTurns: undefined,
  maxExplanationBytes: 1_500,
};

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
