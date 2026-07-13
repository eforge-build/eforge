import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { EforgeEvent, OrchestrationConfig, PlanFile } from '../events.js';
import type { EforgeConfig } from '../config.js';
import type { AgentRuntimeRegistry } from '../agent-runtime-registry.js';
import type { RuntimeChoiceRouterRegistration } from '../extensions/types.js';
import type { RuntimeChoiceRouterRuntimeOptions } from '../extensions/runtime-choice-router.js';
import type { RuntimeChoiceInvocationMetadata } from '../pipeline/runtime-choice.js';
import { resolveAgentRuntimeForInvocationWithExtensions } from '../pipeline/agent-runtime.js';
import { runPrdValidator } from '../agents/prd-validator.js';
import { runAcceptanceUnknownResolver } from '../agents/acceptance-unknown-resolver.js';
import { runGapCloser } from '../agents/gap-closer.js';
import { buildPrdValidatorDiff } from '../prd-validator-diff.js';
import { resolveValidationBase } from './validation-base.js';
import { createToolTracker, runBuildPipeline } from '../pipeline.js';
import type { AcceptanceUnknownResolver, GapCloser, PrdValidator } from '../orchestrator.js';
import type { createTracingContext } from '../tracing.js';
import { extractExpectedAcceptanceCriteria, type ExpectedAcceptanceCriterion } from './acceptance-criteria.js';
import {
  requireAcceptanceCriteriaInventoryFromPrd,
  stripAcceptanceCriteriaInventoryBlock,
} from './acceptance-criteria-inventory.js';

export interface PrdValidationSourceInput {
  /** Queue/runtime PRD source path, resolved relative to cwd when needed. */
  prdFilePath?: string;
  /** Already-resolved PRD markdown content. Used by compiled resume fallbacks. */
  prdContent?: string;
  /** Human-readable label for resolved content. */
  prdSourceLabel?: string;
  /** Permit expected-criteria extraction when recovered content has no inventory block. */
  allowInventoryFallback?: boolean;
}

export interface CreatePrdValidationWiringOptions extends PrdValidationSourceInput {
  cwd: string;
  config: EforgeConfig;
  agentRuntimes: AgentRuntimeRegistry;
  tracing: ReturnType<typeof createTracingContext>;
  planSetName: string;
  orchConfig: OrchestrationConfig;
  planFileMap: Map<string, PlanFile>;
  buildPipeline: OrchestrationConfig['pipeline'];
  verbose?: boolean;
  abortController?: AbortController;
  extensionRuntimeChoiceRouters?: RuntimeChoiceRouterRegistration[];
  configProfileName?: string | null;
  extensionConfigDir?: string;
}

export interface PrdValidationWiring {
  prdValidator?: PrdValidator;
  acceptanceUnknownResolver?: AcceptanceUnknownResolver;
  gapCloser?: GapCloser;
  expectedAcceptanceCriteria: ExpectedAcceptanceCriterion[];
  /** Stripped PRD content suitable for provenance materialization. */
  prdProvenanceContent?: string;
}

interface LoadedPrdSource {
  content: string;
  visibleContent: string;
}

export async function createPrdValidationWiring(options: CreatePrdValidationWiringOptions): Promise<PrdValidationWiring> {
  const prdSource = await loadPrdSource(options);
  const expectedAcceptanceCriteria = prdSource
    ? expectedCriteriaFromPrdSource(prdSource.content, options)
    : expectedCriteriaFromPlanFiles(options.planFileMap);

  if (!prdSource) {
    return { expectedAcceptanceCriteria };
  }

  const prdValidator = createPrdValidator(options, prdSource.visibleContent, expectedAcceptanceCriteria);
  const acceptanceUnknownResolver = createAcceptanceUnknownResolver(options);
  const gapCloser = createGapCloser(options, prdSource.visibleContent);

  return {
    prdValidator,
    acceptanceUnknownResolver,
    gapCloser,
    expectedAcceptanceCriteria,
    prdProvenanceContent: prdSource.visibleContent,
  };
}

async function loadPrdSource(options: PrdValidationSourceInput & { cwd: string }): Promise<LoadedPrdSource | undefined> {
  const rawContent = options.prdContent ?? (options.prdFilePath ? await readFile(resolve(options.cwd, options.prdFilePath), 'utf-8') : undefined);
  if (rawContent === undefined) return undefined;
  return {
    content: rawContent,
    visibleContent: stripAcceptanceCriteriaInventoryBlock(rawContent),
  };
}

function expectedCriteriaFromPrdSource(
  prdContent: string,
  options: CreatePrdValidationWiringOptions,
): ExpectedAcceptanceCriterion[] {
  try {
    const inventory = requireAcceptanceCriteriaInventoryFromPrd(prdContent, {
      allowNoAcceptanceCriteria: options.config.build.validation.allowNoAcceptanceCriteria,
    });
    return inventory.criteria.map((criterion) => ({
      id: criterion.id,
      text: criterion.text,
      raw: criterion.raw,
    }));
  } catch (err) {
    if (!options.allowInventoryFallback || !(err instanceof Error) || !err.message.includes('[missing-block]')) throw err;
    return extractExpectedAcceptanceCriteria(stripAcceptanceCriteriaInventoryBlock(prdContent), { allowFallbackSections: true })
      .map((criterion, index) => ({
        id: `ac-${String(index + 1).padStart(3, '0')}`,
        text: criterion.text,
        raw: criterion.raw,
      }));
  }
}

function expectedCriteriaFromPlanFiles(planFileMap: Map<string, PlanFile>): ExpectedAcceptanceCriterion[] {
  const allCriteria: ExpectedAcceptanceCriterion[] = [];
  let counter = 1;
  for (const planFile of planFileMap.values()) {
    const planCriteria = extractExpectedAcceptanceCriteria(planFile.body, { allowFallbackSections: true });
    for (const c of planCriteria) {
      allCriteria.push({ id: `ac-${String(counter).padStart(3, '0')}`, text: c.text, raw: c.raw });
      counter++;
    }
  }
  return allCriteria;
}

function runtimeChoiceRouterOptions(options: CreatePrdValidationWiringOptions, invocationCwd: string): RuntimeChoiceRouterRuntimeOptions | undefined {
  const routers = options.extensionRuntimeChoiceRouters ?? [];
  return routers.length === 0
    ? undefined
    : {
        routers,
        profileName: options.configProfileName ?? 'default',
        cwd: invocationCwd,
        configDir: options.extensionConfigDir,
        timeoutMs: options.config.extensions.eventHookTimeoutMs,
      };
}

function prdSummary(prdContent: string): string {
  return prdContent.trim().slice(0, 1_200);
}

function gapTaskSummary(gaps: readonly { requirement: string; explanation: string }[]): string {
  return gaps.map((gap) => `${gap.requirement}: ${gap.explanation}`).join('\n').slice(0, 2_000);
}

function createPrdValidator(
  options: CreatePrdValidationWiringOptions,
  prdContent: string,
  expectedAcceptanceCriteria: ExpectedAcceptanceCriterion[],
): PrdValidator {
  const { config, tracing, verbose, abortController, agentRuntimes, orchConfig } = options;
  return async function* (validatorCwd, validatorContext, lane) {
    const base = await resolveValidationBase({ cwd: validatorCwd, baseBranch: orchConfig.baseBranch, diffBaseRef: orchConfig.diffBaseRef, stackedValidationPinRequired: orchConfig.stackedValidationPinRequired, config });
    const built = base.available
      ? await buildPrdValidatorDiff({ cwd: validatorCwd, baseRef: base.baseRef })
      : undefined;
    if (!base.available || built === undefined || !built.available) {
      const reason = !base.available ? base.reason : built !== undefined && !built.available ? built.reason : 'Failed to build implementation diff.';
      yield { timestamp: new Date().toISOString(), type: 'prd_validation:start' } as EforgeEvent;
      yield { timestamp: new Date().toISOString(), type: 'prd_validation:complete', passed: false, gaps: [{ requirement: 'Implementation diff unavailable', explanation: reason }] } as EforgeEvent;
      yield { timestamp: new Date().toISOString(), type: 'acceptance_validation:complete', passed: false, verdicts: [{ criterion: 'Acceptance criteria', verdict: 'unknown', evidence: reason }], source: 'prd' } as EforgeEvent;
      return;
    }

    const validationPolicy = config.build.validation;
    if (!built.renderedText.trim()) {
      yield { timestamp: new Date().toISOString(), type: 'prd_validation:start' } as EforgeEvent;
      if (validationPolicy?.allowEmptyPrdDiff && validationPolicy.emptyPrdDiffReason?.trim()) {
        yield { timestamp: new Date().toISOString(), type: 'prd_validation:complete', passed: true, gaps: [], completionPercent: 100 } as EforgeEvent;
        yield { timestamp: new Date().toISOString(), type: 'acceptance_validation:complete', passed: true, verdicts: [{ criterion: 'Acceptance criteria', verdict: 'unknown', evidence: 'No implementation diff to evaluate (waived).' }], waivers: [validationPolicy.emptyPrdDiffReason], source: 'prd' } as EforgeEvent;
      } else {
        yield { timestamp: new Date().toISOString(), type: 'prd_validation:complete', passed: false, gaps: [{ requirement: 'Empty implementation diff', explanation: 'No changes were found in the implementation diff; cannot validate PRD coverage.' }] } as EforgeEvent;
        yield { timestamp: new Date().toISOString(), type: 'acceptance_validation:complete', passed: false, verdicts: [{ criterion: 'Acceptance criteria', verdict: 'unknown', evidence: 'No implementation changes to evaluate.' }], source: 'prd' } as EforgeEvent;
      }
      return;
    }

    const diff = built.renderedText;
    const prdSpan = tracing.createSpan('prd-validator', {});
    prdSpan.setInput({
      prdLength: prdContent.length,
      diffLength: diff.length,
      totalBytes: built.totalBytes,
      summarizedCount: built.summarizedCount,
      summarizedByPerFileBudget: built.summarizedByPerFileBudget,
      summarizedByGlobalCap: built.summarizedByGlobalCap,
      globalBudgetBytes: built.globalBudgetBytes,
      fileCount: built.files.length,
    });
    const prdTracker = createToolTracker(prdSpan);
    try {
      const metadata: RuntimeChoiceInvocationMetadata = {
        phase: 'standalone',
        stage: 'prd-validator',
        prdSummary: prdSummary(prdContent),
        changedFiles: built.files.map((file) => file.path),
        pathHints: built.files.map((file) => file.path),
      };
      const { agentConfig: prdValidatorConfig, harness: prdValidatorHarness } = await resolveAgentRuntimeForInvocationWithExtensions('prd-validator', config, agentRuntimes, undefined, metadata, runtimeChoiceRouterOptions(options, validatorCwd));
      for await (const event of runPrdValidator({
        ...prdValidatorConfig,
        cwd: validatorCwd,
        prdContent,
        diff,
        verbose,
        abortController,
        phase: 'standalone',
        stage: 'prd-validator',
        harness: prdValidatorHarness,
        expectedAcceptanceCriteria,
        validationCommandEvidence: validatorContext?.validationCommandEvidence,
        lane,
      })) {
        prdTracker.handleEvent(event);
        yield event;
      }
      prdTracker.cleanup();
      prdSpan.end();
    } catch (err) {
      prdTracker.cleanup();
      prdSpan.error(err as Error);
      throw err;
    }
  };
}

function createAcceptanceUnknownResolver(options: CreatePrdValidationWiringOptions): AcceptanceUnknownResolver {
  const { config, tracing, verbose, abortController, agentRuntimes, orchConfig } = options;
  return async function* (resolverCwd, request) {
    const base = await resolveValidationBase({ cwd: resolverCwd, baseBranch: orchConfig.baseBranch, diffBaseRef: orchConfig.diffBaseRef, stackedValidationPinRequired: orchConfig.stackedValidationPinRequired, config });
    const built = base.available
      ? await buildPrdValidatorDiff({ cwd: resolverCwd, baseRef: base.baseRef })
      : undefined;
    if (!base.available || built === undefined || !built.available) {
      const reason = !base.available ? base.reason : built !== undefined && !built.available ? built.reason : 'Failed to build implementation diff.';
      throw new Error(`Acceptance unknown resolver could not build implementation diff context: ${reason}`);
    }
    const resolverSpan = tracing.createSpan('prd-validator', { unknownCount: request.unknownCriteria.length, diffLength: built.renderedText.length });
    resolverSpan.setInput({ unknownCriteria: request.unknownCriteria.map((criterion) => criterion.id), validationCommandCount: request.validationCommandEvidence?.length ?? 0, totalBytes: built.totalBytes, summarizedCount: built.summarizedCount });
    const resolverTracker = createToolTracker(resolverSpan);
    try {
      const metadata: RuntimeChoiceInvocationMetadata = {
        phase: 'standalone',
        stage: 'acceptance-unknown-resolver',
        changedFiles: built.files.map((file) => file.path),
        pathHints: built.files.map((file) => file.path),
        taskSummary: request.unknownCriteria.map((criterion) => `${criterion.id}: ${criterion.text}`).join('\n'),
      };
      const { agentConfig: resolverConfig, harness: resolverHarness } = await resolveAgentRuntimeForInvocationWithExtensions('prd-validator', config, agentRuntimes, undefined, metadata, runtimeChoiceRouterOptions(options, resolverCwd));
      const result = yield* runAcceptanceUnknownResolver({ ...resolverConfig, cwd: resolverCwd, unknownCriteria: request.unknownCriteria, acceptanceVerdicts: request.acceptanceVerdicts, validationCommandEvidence: request.validationCommandEvidence, implementationDiffContext: built.renderedText, verbose, abortController, phase: 'standalone', stage: 'acceptance-unknown-resolver', harness: resolverHarness });
      resolverTracker.cleanup();
      resolverSpan.end();
      return result;
    } catch (err) {
      resolverTracker.cleanup();
      resolverSpan.error(err as Error);
      throw err;
    }
  };
}

function createGapCloser(options: CreatePrdValidationWiringOptions, prdContent: string): GapCloser {
  const { config, tracing, verbose, abortController, agentRuntimes, buildPipeline, planSetName, orchConfig, planFileMap } = options;
  return async function* (gapCloserCwd, gaps, completionPercent) {
    // Never invoke a mutating gap agent when validation evidence cannot be
    // proven. An unavailable diff is not an empty diff.
    const base = await resolveValidationBase({ cwd: gapCloserCwd, baseBranch: orchConfig.baseBranch, diffBaseRef: orchConfig.diffBaseRef, stackedValidationPinRequired: orchConfig.stackedValidationPinRequired, config });
    if (!base.available) throw new Error(`Gap closer evidence unavailable: ${base.reason}`);
    const built = await buildPrdValidatorDiff({ cwd: gapCloserCwd, baseRef: base.baseRef });
    if (!built.available) throw new Error(`Gap closer evidence unavailable: ${built.reason}`);
    const gapSpan = tracing.createSpan('gap-closer', {});
    gapSpan.setInput({ gapCount: gaps.length, completionPercent });
    const gapTracker = createToolTracker(gapSpan);
    try {
      const metadata: RuntimeChoiceInvocationMetadata = {
        phase: 'standalone',
        stage: 'gap-closer',
        prdSummary: prdSummary(prdContent),
        taskSummary: gapTaskSummary(gaps),
        keywordText: gapTaskSummary(gaps),
      };
      const { agentConfig: gapCloserConfig, harness: gapCloserHarness } = await resolveAgentRuntimeForInvocationWithExtensions('gap-closer', config, agentRuntimes, undefined, metadata, runtimeChoiceRouterOptions(options, gapCloserCwd));
      for await (const event of runGapCloser({
        ...gapCloserConfig,
        cwd: gapCloserCwd,
        gaps,
        prdContent,
        completionPercent,
        phase: 'standalone',
        stage: 'gap-closer',
        harness: gapCloserHarness,
        pipelineContext: {
          config,
          pipeline: buildPipeline,
          tracing,
          planSetName,
          orchConfig,
          planFileMap,
          agentRuntimes,
          extensionRuntimeChoiceRouters: options.extensionRuntimeChoiceRouters,
          configProfileName: options.configProfileName,
          extensionConfigDir: options.extensionConfigDir,
        },
        runBuildPipeline,
        verbose,
        abortController,
      })) {
        gapTracker.handleEvent(event);
        yield event;
      }
      gapTracker.cleanup();
      gapSpan.end();
    } catch (err) {
      gapTracker.cleanup();
      gapSpan.error(err as Error);
      throw err;
    }
  };
}
