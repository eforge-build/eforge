import type { EforgeEvent, CompilePreflightRisk, CompileScopeContextFailure } from '../events.js';

export interface CompileContextGuardLimits {
  maxPromptBytes: number;
  maxObservedInputTokens: number;
  maxObservedTurns?: number;
  maxExplanationBytes: number;
}

export interface CompileContextGuardOptions {
  stage: 'pipeline-composer' | 'planner' | 'module-planner';
  risk?: CompilePreflightRisk;
  limits?: Partial<CompileContextGuardLimits>;
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

export function createCompileContextGuard(options?: CompileContextGuardOptions): {
  assertPrompt(prompt: string): void;
  observe(event: EforgeEvent): void;
} {
  const stage = options?.stage ?? 'planner';
  const limits = resolveCompileContextGuardLimits(options?.limits);
  const observed = { inputTokens: 0, outputTokens: 0, turns: 0, promptBytes: 0 };
  const cumulativeFallback = { inputTokens: 0, turns: 0 };
  let sawFinalUsage = false;

  function fail(reason: string): never {
    throw new CompileScopeContextError(buildFailure({ stage, limits, risk: options?.risk, observed, reason }));
  }

  return {
    assertPrompt(prompt: string): void {
      observed.promptBytes = Buffer.byteLength(prompt, 'utf8');
      if (observed.promptBytes > limits.maxPromptBytes) {
        fail(`prompt bytes ${observed.promptBytes} exceed maxPromptBytes ${limits.maxPromptBytes}`);
      }
    },
    observe(event: EforgeEvent): void {
      if (event.type !== 'agent:usage' || event.agent !== stage) return;
      const usesInputDelta = event.usage.input > 0;
      const effectiveInput = usesInputDelta ? event.usage.input : event.usage.total;
      if (event.final) {
        observed.inputTokens = Math.max(observed.inputTokens, effectiveInput);
        observed.outputTokens = Math.max(observed.outputTokens, event.usage.output);
        observed.turns = Math.max(observed.turns, event.numTurns);
        sawFinalUsage = true;
        return;
      }
      if (sawFinalUsage) {
        observed.inputTokens = 0;
        observed.outputTokens = 0;
        observed.turns = 0;
        cumulativeFallback.inputTokens = 0;
        cumulativeFallback.turns = 0;
        sawFinalUsage = false;
      }
      const turnInputTokens = usesInputDelta
        ? effectiveInput
        : Math.max(0, effectiveInput - cumulativeFallback.inputTokens);
      const turnCount = usesInputDelta
        ? event.numTurns
        : Math.max(0, event.numTurns - cumulativeFallback.turns);
      if (!usesInputDelta) {
        cumulativeFallback.inputTokens = Math.max(cumulativeFallback.inputTokens, effectiveInput);
        cumulativeFallback.turns = Math.max(cumulativeFallback.turns, event.numTurns);
      }
      observed.inputTokens = Math.max(observed.inputTokens, turnInputTokens);
      observed.turns += turnCount;
      observed.outputTokens += event.usage.output;
      if (turnInputTokens > limits.maxObservedInputTokens) {
        fail(`observed per-turn input tokens ${turnInputTokens} exceed maxObservedInputTokens ${limits.maxObservedInputTokens}`);
      }
      if (limits.maxObservedTurns !== undefined && observed.turns > limits.maxObservedTurns) {
        fail(`observed turns ${observed.turns} exceed maxObservedTurns ${limits.maxObservedTurns}`);
      }
    },
  };
}

export function resolveCompileContextGuardLimits(limits?: Partial<CompileContextGuardLimits>): CompileContextGuardLimits {
  const resolved = { ...DEFAULT_COMPILE_CONTEXT_GUARD_LIMITS, ...limits };
  return {
    ...resolved,
    maxExplanationBytes: Math.min(resolved.maxExplanationBytes, MAX_COMPILE_SCOPE_CONTEXT_EXPLANATION_LENGTH),
  };
}

export function compileContextGuardOptions(input: {
  stage: CompileContextGuardOptions['stage'];
  risk?: CompilePreflightRisk;
  limits?: Partial<CompileContextGuardLimits>;
}): CompileContextGuardOptions {
  return { stage: input.stage, risk: input.risk, limits: input.limits };
}

function buildFailure(input: {
  stage: CompileContextGuardOptions['stage'];
  risk?: CompilePreflightRisk;
  limits: CompileContextGuardLimits;
  observed: { inputTokens: number; outputTokens: number; turns: number; promptBytes: number };
  reason: string;
}): CompileScopeContextFailure {
  const explanation = capUtf8([
    `Planner-family context budget exceeded at stage=${input.stage}.`,
    input.reason,
    `observed promptBytes=${input.observed.promptBytes} inputTokens=${input.observed.inputTokens} outputTokens=${input.observed.outputTokens} turns=${input.observed.turns}.`,
    `limits maxPromptBytes=${input.limits.maxPromptBytes} maxObservedInputTokens=${input.limits.maxObservedInputTokens} maxObservedTurns=${input.limits.maxObservedTurns ?? 'none'}.`,
    input.risk ? `risk level=${input.risk.level} score=${input.risk.score} recovery=${input.risk.recommendation.action}.` : 'risk unavailable.',
  ].join(' '), input.limits.maxExplanationBytes);

  return {
    source: 'live-context-guard',
    failureKind: 'context-budget',
    stage: input.stage,
    explanation,
    ...(input.risk && { risk: input.risk }),
    observed: {
      inputTokens: Math.max(0, Math.floor(input.observed.inputTokens)),
      outputTokens: Math.max(0, Math.floor(input.observed.outputTokens)),
      turns: Math.max(0, Math.floor(input.observed.turns)),
      promptBytes: Math.max(0, Math.floor(input.observed.promptBytes)),
    },
    recovery: {
      action: input.risk?.recommendation.action ?? 'none',
      eligible: input.risk?.recommendation.eligible ?? false,
      attempted: false,
      attempt: 0,
      maxAttempts: 1,
      reason: capUtf8(input.risk?.recommendation.reason ?? input.reason, 1_000),
    },
    artifacts: {
      orchestrationExists: false,
      validPlanCount: 0,
      invalidPlanCount: 0,
      missingPlanFileCount: 0,
      missingPlanFiles: [],
      invalidPlanFiles: [],
    },
  };
}

function capUtf8(text: string, maxBytes: number): string {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= maxBytes) return text;
  let end = Math.max(0, maxBytes - Buffer.byteLength('…', 'utf8'));
  while (Buffer.byteLength(text.slice(0, end), 'utf8') > maxBytes - Buffer.byteLength('…', 'utf8')) end--;
  return `${text.slice(0, end)}…`;
}
