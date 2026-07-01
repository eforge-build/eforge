/** Runtime support for fail-open extension runtime-choice routers. */

import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { createEforgeProjectPaths, type EforgeProjectPaths } from '@eforge-build/extension-sdk/project-paths';
import type { AgentRole } from '../events.js';
import type { EforgeConfig, TierConfig } from '../config.js';
import type { RuntimeChoiceRouterRegistration } from './types.js';
import type { PlanEntry } from '../pipeline/agent-config.js';
import {
  availableRuntimeChoicesForTier,
  canonicalizeChoiceRef,
  resolveRuntimeChoiceForExplicitChoice,
  resolveRuntimeChoiceForInvocation,
  runtimeChoiceExists,
  type RuntimeChoiceFallbackReason,
  type RuntimeChoiceInvocationMetadata,
  type RuntimeChoiceSelection,
} from '../pipeline/runtime-choice.js';

const SUMMARY_LIMIT = 1_200;
const KEYWORD_LIMIT = 2_000;

interface RuntimeChoiceRouterContextMirror {
  role: AgentRole;
  tier: string;
  profile: string;
  availableChoices: Array<{ name: string; qualified: string }>;
  phase?: string;
  stage?: string;
  planId?: string;
  planName?: string;
  planSummary?: string;
  prdTitle?: string;
  prdSummary?: string;
  taskSummary?: string;
  keywordText?: string;
  pathHints?: string[];
  changedFiles?: string[];
  shardIds?: string[];
  shardRoots?: string[];
  shardFiles?: string[];
  paths: EforgeProjectPaths;
  logger: { debug(message: string): void; info(message: string): void; warn(message: string): void; error(message: string): void };
  exec: { run(command: string, args?: string[], options?: { cwd?: string; env?: Record<string, string> }): Promise<{ stdout: string; stderr: string; exitCode: number }> };
}

interface RuntimeChoiceRouterResultMirror {
  choice?: string;
  decline?: boolean;
  reason?: string;
  confidence?: number;
}

export interface RuntimeChoiceRouterRuntimeOptions {
  routers: RuntimeChoiceRouterRegistration[];
  profileName: string;
  cwd: string;
  configDir?: string;
  timeoutMs: number;
}

type RouterOutcome =
  | { kind: 'declined' }
  | { kind: 'selected'; choice: string; router: string }
  | { kind: 'fallback'; reason: RuntimeChoiceFallbackReason };

function cap(value: string | undefined, limit: number): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.slice(0, limit);
}

function safeArray(values: string[] | undefined): string[] | undefined {
  if (values === undefined) return undefined;
  return [...values].slice(0, 200);
}

function createLogger(extensionName: string, routerName: string) {
  const prefix = `[eforge ext:${extensionName} runtime-choice-router:${routerName}]`;
  return {
    debug: (msg: string) => process.stderr.write(`${prefix} debug: ${msg}\n`),
    info: (msg: string) => process.stderr.write(`${prefix} info: ${msg}\n`),
    warn: (msg: string) => process.stderr.write(`${prefix} warn: ${msg}\n`),
    error: (msg: string) => process.stderr.write(`${prefix} error: ${msg}\n`),
  };
}

function createExec(cwd: string, signal: AbortSignal) {
  return {
    run: async (
      command: string,
      args: string[] = [],
      options?: { cwd?: string; env?: Record<string, string> },
    ): Promise<{ stdout: string; stderr: string; exitCode: number }> => new Promise((resolveResult) => {
      execFile(command, args, { cwd: options?.cwd ?? cwd, env: options?.env ? { ...process.env, ...options.env } : process.env, signal }, (error, stdout, stderr) => {
        resolveResult({ stdout: stdout || '', stderr: stderr || (error ? error.message : ''), exitCode: error ? 1 : 0 });
      });
    }),
  };
}

function buildRouterContext(
  registration: RuntimeChoiceRouterRegistration,
  selection: RuntimeChoiceSelection,
  tierRecipe: TierConfig,
  metadata: RuntimeChoiceInvocationMetadata,
  planEntry: PlanEntry | undefined,
  options: RuntimeChoiceRouterRuntimeOptions,
  role: AgentRole,
  signal: AbortSignal,
): RuntimeChoiceRouterContextMirror {
  const configDir = options.configDir ?? resolve(options.cwd, 'eforge');
  return {
    role,
    tier: selection.tier,
    profile: options.profileName,
    availableChoices: availableRuntimeChoicesForTier(tierRecipe, selection.tier),
    ...(metadata.phase !== undefined && { phase: metadata.phase }),
    ...(metadata.stage !== undefined && { stage: metadata.stage }),
    ...(metadata.planId !== undefined && { planId: metadata.planId }),
    ...(cap(metadata.planName ?? (planEntry && 'name' in planEntry ? String((planEntry as { name?: unknown }).name ?? '') : undefined), SUMMARY_LIMIT) !== undefined && { planName: cap(metadata.planName ?? (planEntry && 'name' in planEntry ? String((planEntry as { name?: unknown }).name ?? '') : undefined), SUMMARY_LIMIT) }),
    ...(cap(metadata.planSummary, SUMMARY_LIMIT) !== undefined && { planSummary: cap(metadata.planSummary, SUMMARY_LIMIT) }),
    ...(cap(metadata.prdTitle, SUMMARY_LIMIT) !== undefined && { prdTitle: cap(metadata.prdTitle, SUMMARY_LIMIT) }),
    ...(cap(metadata.prdSummary, SUMMARY_LIMIT) !== undefined && { prdSummary: cap(metadata.prdSummary, SUMMARY_LIMIT) }),
    ...(cap(metadata.taskSummary, SUMMARY_LIMIT) !== undefined && { taskSummary: cap(metadata.taskSummary, SUMMARY_LIMIT) }),
    ...(cap(metadata.keywordText, KEYWORD_LIMIT) !== undefined && { keywordText: cap(metadata.keywordText, KEYWORD_LIMIT) }),
    ...(safeArray(metadata.pathHints) !== undefined && { pathHints: safeArray(metadata.pathHints) }),
    ...(safeArray(metadata.changedFiles) !== undefined && { changedFiles: safeArray(metadata.changedFiles) }),
    ...(safeArray(metadata.shardIds) !== undefined && { shardIds: safeArray(metadata.shardIds) }),
    ...(safeArray(metadata.shardRoots) !== undefined && { shardRoots: safeArray(metadata.shardRoots) }),
    ...(safeArray(metadata.shardFiles) !== undefined && { shardFiles: safeArray(metadata.shardFiles) }),
    paths: createEforgeProjectPaths({ cwd: options.cwd, configDir, extensionName: registration.extensionName }),
    logger: createLogger(registration.extensionName, registration.name),
    exec: createExec(options.cwd, signal),
  };
}

async function executeRouterWithTimeout(
  registration: RuntimeChoiceRouterRegistration,
  ctx: RuntimeChoiceRouterContextMirror,
  timeoutMs: number,
  abortController: AbortController,
): Promise<{ result?: unknown } | { timedOut: true } | { error: unknown }> {
  const handler = registration.value.resolveRuntimeChoice as unknown as (ctx: RuntimeChoiceRouterContextMirror) => unknown;
  let timedOut = false;
  const handlerPromise = Promise.resolve()
    .then(() => handler(ctx))
    .then(
      (result) => timedOut ? { timedOut: true as const } : { result },
      (error) => timedOut ? { timedOut: true as const } : { error },
    );
  handlerPromise.catch(() => undefined);
  return new Promise((resolveResult) => {
    const timer = setTimeout(() => {
      timedOut = true;
      abortController.abort();
      resolveResult({ timedOut: true });
    }, timeoutMs);
    timer.unref();
    handlerPromise.then((outcome) => {
      if (timedOut) return;
      clearTimeout(timer);
      resolveResult(outcome);
    });
  });
}

function normalizeRouterChoice(result: unknown): { kind: 'declined' } | { kind: 'choice'; choice: string } | { kind: 'invalid' } {
  if (result == null) return { kind: 'declined' };
  if (typeof result === 'string') {
    const choice = result.trim();
    return choice.length > 0 ? { kind: 'choice', choice } : { kind: 'invalid' };
  }
  if (typeof result !== 'object') return { kind: 'invalid' };
  const routerResult = result as RuntimeChoiceRouterResultMirror;
  if (routerResult.decline === true) return { kind: 'declined' };
  if (typeof routerResult.choice !== 'string') return { kind: 'invalid' };
  const choice = routerResult.choice.trim();
  return choice.length > 0 ? { kind: 'choice', choice } : { kind: 'invalid' };
}

function validateRouterChoice(choice: string, tier: RuntimeChoiceSelection['tier'], tierRecipe: TierConfig): string | undefined {
  try {
    const ref = canonicalizeChoiceRef(tier, choice);
    return runtimeChoiceExists(tierRecipe, ref.choice) ? ref.choice : undefined;
  } catch {
    return undefined;
  }
}

export async function resolveRuntimeChoiceWithExtensionRouters(
  role: AgentRole,
  config: EforgeConfig,
  planEntry: PlanEntry | undefined,
  metadata: RuntimeChoiceInvocationMetadata,
  options: RuntimeChoiceRouterRuntimeOptions,
): Promise<RuntimeChoiceSelection> {
  const base = resolveRuntimeChoiceForInvocation(role, config, planEntry, metadata);
  if (base.source === 'rule' || options.routers.length === 0) return base;
  const tierRecipe = config.agents.tiers?.[base.tier];
  if (!tierRecipe) return base;

  let fallbackReason: RuntimeChoiceFallbackReason = 'router-declined';
  for (const registration of options.routers) {
    const abortController = new AbortController();
    const ctx = buildRouterContext(registration, base, tierRecipe, metadata, planEntry, options, role, abortController.signal);
    const outcome = await executeRouterWithTimeout(registration, ctx, options.timeoutMs, abortController);
    let routerOutcome: RouterOutcome;
    if ('timedOut' in outcome) {
      routerOutcome = { kind: 'fallback', reason: 'router-timeout' };
    } else if ('error' in outcome) {
      routerOutcome = { kind: 'fallback', reason: 'router-error' };
    } else {
      const requestedChoice = normalizeRouterChoice(outcome.result);
      if (requestedChoice.kind === 'declined') {
        routerOutcome = { kind: 'declined' };
      } else if (requestedChoice.kind === 'invalid') {
        routerOutcome = { kind: 'fallback', reason: 'router-invalid-choice' };
      } else {
        const validChoice = validateRouterChoice(requestedChoice.choice, base.tier, tierRecipe);
        routerOutcome = validChoice === undefined
          ? { kind: 'fallback', reason: 'router-invalid-choice' }
          : { kind: 'selected', choice: validChoice, router: registration.name };
      }
    }

    if (routerOutcome.kind === 'selected') {
      return resolveRuntimeChoiceForExplicitChoice(role, config, planEntry, {
        choice: routerOutcome.choice,
        source: 'extension-router',
        router: routerOutcome.router,
      });
    }
    if (routerOutcome.kind === 'fallback') {
      return resolveRuntimeChoiceForExplicitChoice(role, config, planEntry, {
        choice: 'default',
        source: 'fallback',
        fallbackReason: routerOutcome.reason,
      });
    }
  }

  return resolveRuntimeChoiceForExplicitChoice(role, config, planEntry, {
    choice: 'default',
    source: 'fallback',
    fallbackReason,
  });
}
