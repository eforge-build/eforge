import {
  AuthStorage,
  ModelRegistry,
} from '@earendil-works/pi-coding-agent';
import type { Api, Model } from '@earendil-works/pi-ai';
import { getBuiltinModel } from '@earendil-works/pi-ai/providers/all';
import type { CompileContextGuardDiagnostics } from '../events.js';
import type { ModelRef } from '../config.js';
import {
  DEFAULT_COMPILE_CONTEXT_GUARD_LIMITS,
  resolveCompileContextGuardLimits,
  type CompileContextGuardLimits,
} from '../compile-resilience/context-guard.js';

// Keep aligned with the public client MAX_COMPILE_SCOPE_CONTEXT_EXPLANATION_LENGTH bound.
const MAX_PI_GUARD_FALLBACK_REASON_LENGTH = 2000;

export const PI_COMPILE_CONTEXT_DEFAULT_OUTPUT_RESERVE_TOKENS = 16_384;
// Planner-family Pi guards cap valid model output metadata at 64 Ki tokens so
// very large generation limits do not consume the entire live input budget.
export const PI_COMPILE_CONTEXT_PLANNER_OUTPUT_RESERVE_TOKEN_CAP = 64 * 1024;
export const PI_COMPILE_CONTEXT_OVERHEAD_RESERVE_TOKENS = 8_192;
export const PI_COMPILE_CONTEXT_SAFETY_MARGIN = 0.95;

type PiAuthStorage = ReturnType<typeof AuthStorage.create>;
type PiModelRegistry = ReturnType<typeof ModelRegistry.create>;

export type PiModelMetadataSource = 'registry' | 'builtin' | 'synthetic';

export interface PiRuntimeModelResolution {
  authStorage: PiAuthStorage;
  modelRegistry: PiModelRegistry;
  model: Model<Api>;
  metadataSource: PiModelMetadataSource;
  fallbackReason?: string;
}

export interface PiRuntimeModelResolutionInput {
  provider?: string;
  modelId?: string;
  authStorage?: PiAuthStorage;
  modelRegistry?: PiModelRegistry;
}

export interface PiCompileContextGuardDerivation {
  limits: Partial<CompileContextGuardLimits>;
  guardDiagnostics: CompileContextGuardDiagnostics;
}

export interface PiCompileContextGuardDerivationInput {
  model: ModelRef;
  limits?: Partial<CompileContextGuardLimits>;
  authStorage?: PiAuthStorage;
  modelRegistry?: PiModelRegistry;
}

export async function resolvePiRuntimeModel(input: PiRuntimeModelResolutionInput): Promise<PiRuntimeModelResolution> {
  const authStorage = input.authStorage
    ?? input.modelRegistry?.authStorage
    ?? (input.modelRegistry ? AuthStorage.inMemory() : AuthStorage.create());
  const modelRegistry = input.modelRegistry ?? ModelRegistry.create(authStorage);
  const provider = requireNonEmpty(input.provider, 'provider');
  const modelId = requireNonEmpty(input.modelId, 'model id');

  const registryModel = await modelRegistry.find(provider, modelId) as Model<Api> | undefined;
  if (registryModel) return { authStorage, modelRegistry, model: registryModel, metadataSource: 'registry' };

  const knownModel = safeGetBuiltinModel(provider, modelId);
  if (knownModel) return { authStorage, modelRegistry, model: knownModel, metadataSource: 'builtin' };

  const sibling = (modelRegistry.getAll() as Model<Api>[]).find((m) => m.provider === provider);
  if (!sibling) {
    throw new Error(
      `Unknown model "${modelId}" and no models registered for provider "${provider}". ` +
      'Register the provider in ~/.pi/agent/models.json or choose a known model.',
    );
  }
  return {
    authStorage,
    modelRegistry,
    model: {
      ...sibling,
      id: modelId,
      name: modelId,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    metadataSource: 'synthetic',
    fallbackReason: `unknown model id "${modelId}"; using provider "${provider}" sibling transport metadata`,
  };
}

export async function derivePiCompileContextGuard(input: PiCompileContextGuardDerivationInput): Promise<PiCompileContextGuardDerivation> {
  const provider = normalizeNonEmpty(input.model.provider);
  const modelId = normalizeNonEmpty(input.model.id);
  const baseDiagnostics: Omit<CompileContextGuardDiagnostics, 'fallbackReason' | 'limits'> = {
    ...(provider ? { provider } : {}),
    ...(modelId ? { modelId } : {}),
    metadataSource: 'fallback' as const,
    outputReserveTokens: PI_COMPILE_CONTEXT_DEFAULT_OUTPUT_RESERVE_TOKENS,
    overheadReserveTokens: PI_COMPILE_CONTEXT_OVERHEAD_RESERVE_TOKENS,
    safetyMargin: PI_COMPILE_CONTEXT_SAFETY_MARGIN,
  };

  if (!provider) return fallbackDerivation(input, baseDiagnostics, 'missing Pi provider');
  if (!modelId) return fallbackDerivation(input, baseDiagnostics, 'missing Pi model id');

  let resolution: PiRuntimeModelResolution;
  try {
    resolution = await resolvePiRuntimeModel({ provider, modelId, authStorage: input.authStorage, modelRegistry: input.modelRegistry });
  } catch (err) {
    return fallbackDerivation(input, baseDiagnostics, `Pi model registry lookup failed: ${errorMessage(err)}`);
  }

  if (resolution.metadataSource === 'synthetic') {
    return fallbackDerivation(input, {
      ...baseDiagnostics,
      metadataSource: resolution.metadataSource,
    }, resolution.fallbackReason ?? 'Pi model metadata is synthetic');
  }

  const contextWindow = positiveInteger((resolution.model as Partial<Model<Api>>).contextWindow);
  if (contextWindow === undefined) {
    return fallbackDerivation(input, {
      ...baseDiagnostics,
      metadataSource: resolution.metadataSource,
    }, 'Pi model metadata is missing a positive contextWindow');
  }

  const outputReserveTokens = effectivePlannerOutputReserve((resolution.model as Partial<Model<Api>>).maxTokens);
  if (outputReserveTokens === undefined) {
    return fallbackDerivation(input, {
      ...baseDiagnostics,
      metadataSource: resolution.metadataSource,
      contextWindow,
    }, 'Pi model metadata has invalid output-token metadata');
  }
  const rawInputBudget = contextWindow - outputReserveTokens - PI_COMPILE_CONTEXT_OVERHEAD_RESERVE_TOKENS;
  const maxObservedInputTokens = Math.floor(rawInputBudget * PI_COMPILE_CONTEXT_SAFETY_MARGIN);
  if (!Number.isInteger(maxObservedInputTokens) || maxObservedInputTokens <= 0) {
    return fallbackDerivation(input, {
      ...baseDiagnostics,
      metadataSource: resolution.metadataSource,
      contextWindow,
      outputReserveTokens,
    }, 'Pi model metadata produced a non-positive input-token budget');
  }

  const limits = finalLimits(input.limits, maxObservedInputTokens);
  return {
    limits,
    guardDiagnostics: {
      provider,
      modelId,
      metadataSource: resolution.metadataSource,
      ...(resolution.fallbackReason ? { fallbackReason: boundedFallbackReason(resolution.fallbackReason) } : {}),
      contextWindow,
      outputReserveTokens,
      overheadReserveTokens: PI_COMPILE_CONTEXT_OVERHEAD_RESERVE_TOKENS,
      safetyMargin: PI_COMPILE_CONTEXT_SAFETY_MARGIN,
      limits,
    },
  };
}

function fallbackDerivation(
  input: PiCompileContextGuardDerivationInput,
  diagnostics: Omit<CompileContextGuardDiagnostics, 'fallbackReason' | 'limits'>,
  fallbackReason: string,
): PiCompileContextGuardDerivation {
  const limits = finalLimits(input.limits, DEFAULT_COMPILE_CONTEXT_GUARD_LIMITS.maxObservedInputTokens);
  return {
    limits,
    guardDiagnostics: {
      ...diagnostics,
      fallbackReason: boundedFallbackReason(fallbackReason),
      limits,
    },
  };
}

function finalLimits(limits: Partial<CompileContextGuardLimits> | undefined, maxObservedInputTokens: number): CompileContextGuardLimits {
  const maxPromptBytes = positiveInteger(limits?.maxPromptBytes);
  const explicitMaxObservedInputTokens = positiveInteger(limits?.maxObservedInputTokens);
  const maxObservedTurns = positiveInteger(limits?.maxObservedTurns);
  const maxExplanationBytes = positiveInteger(limits?.maxExplanationBytes);
  const finalMaxObservedInputTokens = explicitMaxObservedInputTokens === undefined
    ? maxObservedInputTokens
    : Math.min(explicitMaxObservedInputTokens, maxObservedInputTokens);
  const sanitized: Partial<CompileContextGuardLimits> = {
    ...(maxPromptBytes !== undefined ? { maxPromptBytes } : {}),
    ...(maxObservedTurns !== undefined ? { maxObservedTurns } : {}),
    ...(maxExplanationBytes !== undefined ? { maxExplanationBytes } : {}),
    maxObservedInputTokens: finalMaxObservedInputTokens,
  };
  const resolved = resolveCompileContextGuardLimits(sanitized);
  return {
    maxPromptBytes: resolved.maxPromptBytes,
    maxObservedInputTokens: resolved.maxObservedInputTokens,
    ...(resolved.maxObservedTurns !== undefined ? { maxObservedTurns: resolved.maxObservedTurns } : {}),
    maxExplanationBytes: resolved.maxExplanationBytes,
  };
}

function effectivePlannerOutputReserve(rawMaxTokens: unknown): number | undefined {
  if (rawMaxTokens === undefined) return PI_COMPILE_CONTEXT_DEFAULT_OUTPUT_RESERVE_TOKENS;
  const maxTokens = positiveInteger(rawMaxTokens);
  return maxTokens === undefined
    ? undefined
    : Math.min(maxTokens, PI_COMPILE_CONTEXT_PLANNER_OUTPUT_RESERVE_TOKEN_CAP);
}

function normalizeNonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function boundedFallbackReason(reason: string): string {
  return reason.length > MAX_PI_GUARD_FALLBACK_REASON_LENGTH
    ? reason.slice(0, MAX_PI_GUARD_FALLBACK_REASON_LENGTH)
    : reason;
}

function requireNonEmpty(value: string | undefined, label: string): string {
  const normalized = normalizeNonEmpty(value);
  if (!normalized) throw new Error(`Pi model ${label} is required`);
  return normalized;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function safeGetBuiltinModel(provider: string, modelId: string): Model<Api> | undefined {
  try {
    return getBuiltinModel(provider as never, modelId as never) as Model<Api> | undefined;
  } catch {
    return undefined;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
