/**
 * EforgeEngine — the sole public API for plan-build-review workflows.
 * All methods return AsyncGenerator<EforgeEvent> (except status() which is synchronous).
 * Engine emits, consumers render — never writes to stdout.
 */

import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { readFile, readdir, mkdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import type {
  EforgeEvent,
  EforgeStatus,
  CompileOptions,
  BuildOptions,
  EnqueueOptions,
  PlanFile,
  ClarificationQuestion,
  RecoveryVerdict,
  BuildFailureSummary,
} from './events.js';
import { loadQueue, resolveQueueOrder, enqueuePrd, inferTitle, releasePrd, movePrdToSubdir, moveFailedWithSidecar, materializePrdArtifact, cleanupCompletedPrd, QueueExecExitCode, propagateSkip as propagateSkipFS, unblockWaiting, classifyAfterQueueId, getCompiledResumeFrontmatter } from './prd-queue.js';
import { runRecoveryAnalyst } from './agents/recovery-analyst.js';
import { buildFailureSummary } from './recovery/failure-summary.js';
import { writeRecoverySidecar } from './recovery/sidecar.js';
import { projectRecoverySidecarResumeEvidence } from './recovery/resume-sidecar.js';
import { finalizeFailedQueuedResumeSidecars } from './recovery/failed-resume-sidecar-finalization.js';
import { applyRecoveryRetry, applyRecoveryContinueRepair, applyRecoveryAbandon, applyRecoveryManual } from './recovery/apply.js';
import { determineRecoveryRecommendation, selectFinalVerdict } from './recovery/recommendation.js';
import { parseRecoverySidecarPayload, projectRecoverySidecar } from './recovery/sidecar-read.js';
import type { ApplyRecoveryOptions, ApplyRecoveryResult } from './schemas.js';
import { emitBuildDecisionForPlan } from './decisions.js';
import { runFormatter } from './agents/formatter.js';
import { runAcceptanceCriteriaExtractor } from './agents/acceptance-criteria-extractor.js';
import { runDependencyDetector, type QueueItemSummary, type RunningBuildSummary } from './agents/dependency-detector.js';
import type { EforgeConfig, PluginConfig, ReviewProfileConfig, BuildStageSpec } from './config.js';
import type { NativeExtensionDiagnostic, NativeExtensionRegistry } from './extensions/index.js';
import type { AgentHarness } from './harness.js';
import type { ClaudeSDKHarnessOptions } from './harnesses/claude-sdk.js';
import type { SdkPluginConfig, SettingSource } from '@anthropic-ai/claude-agent-sdk';
import { loadConfig, DEFAULT_REVIEW, getConfigDir, getConventionalConfigDir } from './config.js';
import { loadNativeExtensions, withAgentContextHooks } from './extensions/index.js';
import { setPromptDir } from './prompts.js';
import { type AgentRuntimeRegistry, singletonRegistry, buildAgentRuntimeRegistry } from './agent-runtime-registry.js';
import { createTracingContext } from './tracing.js';
import { runValidationFixer } from './agents/validation-fixer.js';
import { runMergeConflictResolver } from './agents/merge-conflict-resolver.js';
import { Orchestrator, type ValidationFixer } from './orchestrator.js';
import { createBuildTerminalFailureTracker } from './terminal-failure.js';
import type { MergeResolver } from './worktree-ops.js';
import { computeWorktreeBase, createMergeWorktree } from './worktree-ops.js';
import { deriveNameFromSource, parseOrchestrationConfig, parsePlanFile, validatePlanSet, validatePlanSetName } from './plan.js';
import { runCompilePipeline, runBuildPipeline, createToolTracker, resolveAgentConfig, type PipelineContext, type BuildStageContext } from './pipeline.js';
import { forgeCommit } from './git.js';
import { ModelTracker, composeCommitMessage } from './model-tracker.js';
import { cleanupPlanFiles } from './cleanup.js';
import { Semaphore, AsyncEventQueue } from './concurrency.js';
import { applyShardedPlanGuard } from './sharded-plan-guard.js';
import { QueueScheduler, SCHEDULER_INPUT_TYPES, type SchedulerInputEvent } from './queue/scheduler.js';
import { inferStackParentFromDependencies } from './queue/stack-parent-inference.js';
import { applyStackedDispatchValidation } from './queue/dispatch-validation.js';
import { runQueuedPrdBuild } from './queue/build-single-prd.js';
import { classifyQueueChildExit, consumeQueuePrdCancellation } from './queue/cancellation.js';
import { beginQueuedResume, finalizeQueuedResumeSuccess, rollbackQueuedResume } from './queue/resume-cascade.js';
import { loadArtifactRegistry, hasUsableArtifact } from './artifacts/registry.js';
import type { ArtifactRegistry } from './artifacts/registry.js';
import { loadCompletionRegistry, lookupCompletion, upsertCompletion } from './artifacts/completions.js';
import type { CompletionRegistry } from './artifacts/completions.js';
import type { ProfileUsageProvider } from './profile-usage.js';
export type { ProfileUsageProvider } from './profile-usage.js';
import { formatAcceptanceFailureSummary } from './validation/acceptance-summary.js';
import { stripAcceptanceCriteriaInventoryBlock, type CanonicalAcceptanceCriteriaInventory } from './validation/acceptance-criteria-inventory.js';
import { createPrdValidationWiring } from './validation/prd-validation-wiring.js';
import { buildCompilePromptSourceBundle, estimateCompilePreflightRisk, type CompilePreflightOptions } from './compile-resilience/preflight.js';
import { compileScopeTerminalFailureEvent, scopeContextFailureEvent, toCompileScopeContextError } from './compile-resilience/context-recovery.js';
import { CompileScopeContextError } from './compile-resilience/context-guard.js';
import { validateCompileArtifacts } from './compile-resilience/artifact-validation.js';

const exec = promisify(execFile);

export interface EforgeEngineOptions {
  /** Working directory (defaults to process.cwd()) */
  cwd?: string;
  /** Config overrides (deep-merged with loaded config) */
  config?: Partial<EforgeConfig>;
  /** Agent runtime registry. Accepts a registry, a bare AgentHarness (auto-wrapped in singletonRegistry), or omit to build from config. */
  agentRuntimes?: AgentRuntimeRegistry | AgentHarness;
  /** MCP servers to make available to agents (Claude SDK harness only, ignored if agentRuntimes is provided) */
  mcpServers?: ClaudeSDKHarnessOptions['mcpServers'];
  /** Claude Code plugins to load (Claude SDK backend only, ignored if agentRuntimes is provided) */
  plugins?: SdkPluginConfig[];
  /** Which settings sources to load — 'user', 'project', 'local' (Claude SDK backend only) */
  settingSources?: SettingSource[];
  /** Clarification callback for interactive planning */
  onClarification?: (questions: ClarificationQuestion[]) => Promise<Record<string, string>>;
  /** Approval callback for build gates */
  onApproval?: (action: string, details: string) => Promise<boolean>;
  /** Override the active profile for this engine instance. Takes precedence over marker-chain resolution. */
  profileOverride?: string;
  /**
   * Optional usage provider for profile routers.
   * The daemon supplies a MonitorDB-backed implementation; CLI/direct runs omit
   * this so routers receive `{ dataSource: 'none' }` for all profiles.
   */
  profileUsageProvider?: ProfileUsageProvider;
}

export interface QueueOptions {
  /** Plan set name override */
  name?: string;
  /** Process all PRDs (including non-pending) */
  all?: boolean;
  /** Bypass approval gates */
  auto?: boolean;
  /** Stream verbose agent output */
  verbose?: boolean;
  /** Disable web monitor */
  noMonitor?: boolean;
  /** AbortController for cancellation */
  abortController?: AbortController;
  /** Enable watch mode — poll for new PRDs after each cycle */
  watch?: boolean;
  /** Poll interval in milliseconds (overrides config) */
  pollIntervalMs?: number;
  /**
   * Callback invoked with an `inject` function once the scheduler is ready.
   * The daemon passes this to capture the inject handle so HTTP routes can
   * wake the scheduler via explicit `queue:mutation` events without relying
   * on fs.watch. The inject function is a no-op after the watcher is aborted.
   */
  onInjectEventRegister?: (inject: (event: SchedulerInputEvent) => void) => void;
  /** Override the project-level landing action for this build. */
  landingAction?: 'pr' | 'merge' | 'leave';
  /** Per-run PR auto-merge intent override. Resolved against `landing.pr.autoMerge` policy. */
  landingAutoMerge?: boolean;
  /**
   * Callback invoked once the scheduler is ready, passing a control object
   * that lets the daemon pause/resume launches and check liveness.
   * Mirrors the `onInjectEventRegister` pattern.
   */
  onSchedulerControlRegister?: (control: SchedulerControl) => void;
}

/**
 * Control handle for the QueueScheduler passed to the daemon via
 * `onSchedulerControlRegister`. Lets the daemon pause/resume new PRD launches
 * and check whether the underlying watcher is still alive.
 */
export type SchedulerControl = {
  /** Suspend new PRD launches (in-flight builds continue). */
  pause: () => void;
  /** Resume PRD launches; triggers an immediate discovery tick. */
  resume: () => void;
  /** Returns true while the watcher's AbortController is not yet aborted. */
  isAlive: () => boolean;
};

export interface RecoveryOptions {
  /** Stream verbose agent output */
  verbose?: boolean;
  /** AbortController for cancellation */
  abortController?: AbortController;
  /** Working directory override */
  cwd?: string;
}

/**
 * Sleep for the given duration, returning early if the signal fires.
 * Resolves to `true` when aborted, `false` when the timer completes normally.
 */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    let timer: ReturnType<typeof setTimeout>;

    const onAbort = () => {
      clearTimeout(timer);
      resolve(true);
    };

    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(false);
    }, ms);

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export { abortableSleep };
export type { SchedulerInputEvent };

export class EforgeEngine {
  private readonly config: EforgeConfig;
  private readonly cwd: string;
  private readonly agentRuntimes: AgentRuntimeRegistry;
  private readonly onClarification?: EforgeEngineOptions['onClarification'];
  private readonly onApproval?: EforgeEngineOptions['onApproval'];
  /** Config warnings collected during loadConfig — emitted as config:warning events. */
  private readonly configWarnings: string[];
  /** Profile data collected during loadConfig — emitted as session:profile event. */
  private readonly configProfile: { name: string | null; source: 'local' | 'project' | 'user-local' | 'missing' | 'none' | 'override'; scope: 'local' | 'project' | 'user' | null; config: unknown | null };
  private readonly extensionRegistry: NativeExtensionRegistry;
  private readonly extensionDiagnostics: NativeExtensionDiagnostic[];
  private readonly profileUsageProvider?: ProfileUsageProvider;
  private readonly configDir: string;

  private constructor(config: EforgeConfig, options: EforgeEngineOptions = {}, configWarnings: string[] = [], configProfile?: { name: string | null; source: 'local' | 'project' | 'user-local' | 'missing' | 'none' | 'override'; scope: 'local' | 'project' | 'user' | null; config: unknown | null }, extensionRegistry?: NativeExtensionRegistry, extensionDiagnostics: NativeExtensionDiagnostic[] = [], configDir?: string) {
    this.config = config;
    this.configWarnings = configWarnings;
    this.configProfile = configProfile ?? { name: null, source: 'none', scope: null, config: null };
    this.extensionRegistry = extensionRegistry ?? {
      extensions: [], candidates: [], eventHooks: [], agentRunHooks: [], policyGates: [], profileRouters: [], inputSources: [], prdEnrichers: [], reviewerPerspectives: [], validationProviders: [], tools: [], actions: [], agentTasks: [], consoleContributions: [], consoleWorkstations: [], integrationCommands: [], deepLinks: [], diagnostics: [],
    };
    this.extensionDiagnostics = extensionDiagnostics;
    this.profileUsageProvider = options.profileUsageProvider;
    this.cwd = options.cwd ?? process.cwd();
    this.configDir = configDir ?? getConventionalConfigDir(this.cwd);
    // agentRuntimes is always resolved to a registry by create() before reaching the constructor
    this.agentRuntimes = options.agentRuntimes as AgentRuntimeRegistry;
    this.onClarification = options.onClarification;
    this.onApproval = options.onApproval;
  }

  /** Expose resolved config for CLI diagnostics. */
  get resolvedConfig(): EforgeConfig {
    return this.config;
  }

  get nativeExtensionRegistry(): NativeExtensionRegistry {
    return this.extensionRegistry;
  }

  get nativeExtensionDiagnostics(): readonly NativeExtensionDiagnostic[] {
    return this.extensionDiagnostics;
  }

  get nativeExtensionConfigDir(): string {
    return this.configDir;
  }

  private startupWarnings(): Array<{ message: string; source: string; details?: string }> {
    return [
      ...this.configWarnings.map((message) => ({ message, source: 'loadConfig' })),
      ...this.extensionDiagnostics
        .filter((diagnostic) => diagnostic.severity === 'warning' || diagnostic.severity === 'error')
        .map((diagnostic) => ({
          message: diagnostic.message,
          source: 'extensions',
          details: [diagnostic.code, diagnostic.path].filter(Boolean).join(' '),
        })),
    ];
  }

  /**
   * Async factory — loads config, applies overrides, returns engine.
   * Auto-loads MCP servers from .mcp.json if not explicitly provided.
   */
  static async create(options: EforgeEngineOptions = {}): Promise<EforgeEngine> {
    const cwd = options.cwd ?? process.cwd();
    const { config: loadedConfig, warnings: configWarnings, profile: configProfile } = await loadConfig(cwd, { profileOverride: options.profileOverride });
    let config = loadedConfig;

    if (options.config) {
      config = mergeConfig(config, options.config);
    }

    // Wire project-level prompt directory override
    setPromptDir(config.agents.promptDir, cwd);

    const extensionConfigDir = await getConfigDir(cwd) ?? getConventionalConfigDir(cwd);
    const extensionLoadResult = await loadNativeExtensions({
      cwd,
      configDir: extensionConfigDir,
      config: config.extensions,
    });

    // Auto-load MCP servers from .mcp.json if not explicitly provided
    if (!options.mcpServers && !options.agentRuntimes) {
      const discovered = await loadProjectMcpServers(cwd);
      if (discovered) {
        options = { ...options, mcpServers: discovered };
      }
    }

    // Auto-load plugins from ~/.claude/plugins/ if not explicitly provided
    if (!options.plugins && !options.agentRuntimes) {
      const discovered = await loadPlugins(cwd, config.plugins);
      if (discovered) {
        options = { ...options, plugins: discovered };
      }
    }

    // Build or wrap the agent runtime registry
    let agentRuntimes: AgentRuntimeRegistry;
    const provided = options.agentRuntimes;
    if (provided !== undefined) {
      // Accept either a full registry or a bare AgentHarness (auto-wrap for test ergonomics)
      agentRuntimes = 'forRole' in (provided as object)
        ? (provided as AgentRuntimeRegistry)
        : singletonRegistry(provided as AgentHarness);
    } else {
      // Build registry from config (handles Pi lazy import, memoization, etc.)
      agentRuntimes = await buildAgentRuntimeRegistry(config, {
        mcpServers: options.mcpServers,
        plugins: options.plugins,
        settingSources: (options.settingSources ?? config.agents.settingSources) as SettingSource[] | undefined,
        toolbelts: config.tools.toolbelts,
      });
    }
    // Wrap the registry with the agent-context hook decorator so every harness
    // returned by forRole/forRoleResolved executes registered agentRunHooks.
    agentRuntimes = withAgentContextHooks(agentRuntimes, {
      extensionRegistry: extensionLoadResult.registry,
      profileName: configProfile.name ?? 'default',
      cwd,
      configDir: extensionConfigDir,
      timeoutMs: config.extensions.agentContextHookTimeoutMs,
    });

    options = { ...options, agentRuntimes };

    return new EforgeEngine(config, options, configWarnings, configProfile, extensionLoadResult.registry, extensionLoadResult.diagnostics, extensionConfigDir);
  }

  /**
   * Plan: explore codebase, assess scope, write and validate planning artifacts.
   *
   * The planner explores and assesses scope. Based on the assessment:
   * - errand/excursion: planner generates plan files + orchestration.yaml directly
   * - expedition: planner generates architecture.md + index.yaml + module list,
   *   then engine runs module planners and compiles plan files
   *
   * Non-skipped compiles report success only after persisted orchestration and
   * plan files validate.
   */
  async *compile(source: string, options: Partial<CompileOptions> = {}): AsyncGenerator<EforgeEvent> {
    const runId = randomUUID();
    const cwd = options.cwd ?? this.cwd;
    let tracing: ReturnType<typeof createTracingContext> | undefined;

    let status: 'completed' | 'failed' = 'completed';
    let summary = 'Compile complete';
    let compileCtx: PipelineContext | undefined;

    // Emit profile info before config warnings
    yield { timestamp: new Date().toISOString(), type: 'session:profile', profileName: this.configProfile.name, source: this.configProfile.source, scope: this.configProfile.scope, config: this.configProfile.config };

    // Emit any config warnings collected during engine creation
    for (const warning of this.startupWarnings()) {
      yield { timestamp: new Date().toISOString(), type: 'config:warning', message: warning.message, source: warning.source, details: warning.details };
    }

    try {
      const planSetName = options.name ?? deriveNameFromSource(source);
      validatePlanSetName(planSetName);
      tracing = createTracingContext(this.config, runId, 'compile', planSetName);

      yield {
        type: 'phase:start',
        runId,
        planSet: planSetName,
        command: 'compile',
        timestamp: new Date().toISOString(),
      };

      tracing.setInput({ source, planSet: planSetName });

      // Resolve source content early — needed for plan review + evaluate
      let sourceContent: string;
      try {
        const sourcePath = resolve(cwd, source);
        const stats = await stat(sourcePath);
        sourceContent = stats.isFile() ? stripAcceptanceCriteriaInventoryBlock(await readFile(sourcePath, 'utf-8')) : source;
      } catch {
        sourceContent = stripAcceptanceCriteriaInventoryBlock(source);
      }
      const compilePreflightOptions: CompilePreflightOptions = {
        selectedProfile: this.configProfile.name,
      };
      const compilePromptSourceBundle = buildCompilePromptSourceBundle(sourceContent, compilePreflightOptions);
      const compilePreflight = estimateCompilePreflightRisk(compilePromptSourceBundle, compilePreflightOptions);
      yield { timestamp: new Date().toISOString(), type: 'planning:preflight', risk: compilePreflight };
      // Create merge worktree — all plan artifact commits go here, not repoRoot
      const featureBranch = `eforge/${planSetName}`;
      const baseBranch = options.baseBranchOverride ?? (await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd })).stdout.trim();
      const worktreeBase = computeWorktreeBase(cwd, planSetName);
      // Use worktreeBaseRefOverride (fetched SHA) when provided; fall back to logical baseBranch.
      // This keeps the commit SHA separate from the landing/orchestration base branch name.
      const worktreeBaseRef = options.worktreeBaseRefOverride ?? baseBranch;
      // diffBaseRef is the SHA used for diff/validation base computations. When trunk sync
      // selected a fetched SHA, that SHA is the true divergence point for the worktree.
      // baseBranch keeps the logical branch name for PR/merge targeting.
      const diffBaseRef = options.worktreeBaseRefOverride !== undefined && options.worktreeBaseRefOverride !== baseBranch
        ? options.worktreeBaseRefOverride
        : undefined;
      const mergeWorktreePath = await createMergeWorktree(cwd, worktreeBase, featureBranch, worktreeBaseRef);

      // Default pipeline — the planner stage's composePipeline() call will update ctx.pipeline
      // with the actual composition before the planner agent runs.
      const defaultPipeline: import('./schemas.js').PipelineComposition = {
        scope: 'excursion',
        compile: ['planner', 'plan-review-cycle'],
        defaultBuild: ['implement', 'review-cycle'],
        defaultReview: DEFAULT_REVIEW,
        rationale: 'Default pipeline (will be replaced by composer)',
      };

      const ctx: PipelineContext = {
        agentRuntimes: this.agentRuntimes,
        config: this.config,
        pipeline: defaultPipeline,
        tracing,
        cwd: mergeWorktreePath,
        planCommitCwd: mergeWorktreePath,
        baseBranch,
        ...(diffBaseRef !== undefined && { diffBaseRef }),
        planSetName,
        runId,
        sourceContent,
        promptSourceContent: compilePromptSourceBundle.promptSource,
        compilePromptSourceBundle,
        compilePreflightOptions,
        compilePreflight,
        verbose: options.verbose,
        auto: options.auto,
        abortController: options.abortController,
        onClarification: this.onClarification,
        modelTracker: new ModelTracker(),
        plans: [],
        expeditionModules: [],
        moduleBuildConfigs: new Map(),
        extensionReviewerPerspectives: this.extensionRegistry.reviewerPerspectives,
        extensionValidationProviders: this.extensionRegistry.validationProviders,
      };
      compileCtx = ctx;

      // Run compile pipeline
      yield* runCompilePipeline(ctx);

      const artifactValidation = await validateCompileArtifacts(ctx);
      for (const warning of artifactValidation.warnings) {
        yield { timestamp: new Date().toISOString(), type: 'planning:warning', message: warning, source: 'artifact-validation' };
      }
      if (!artifactValidation.ok) {
        status = 'failed';
        summary = artifactValidation.message;
        yield { timestamp: new Date().toISOString(), type: 'planning:error', reason: artifactValidation.message };
        return;
      }
      ctx.plans = artifactValidation.plans;

      // If compile pipeline didn't produce plans and there's no plan-review-cycle
      // in the compile stages, commit artifacts here
      // (runCompilePipeline handles the commit before plan-review-cycle when present)
      if (ctx.plans.length > 0 && !ctx.pipeline.compile.includes('plan-review-cycle')) {
        const planDir = resolve(mergeWorktreePath, this.config.plan.outputDir, planSetName);
        await exec('git', ['add', planDir], { cwd: mergeWorktreePath });
        // Guard: only commit if there are staged changes (prevents "nothing to commit" errors
        // when artifacts were already committed by a previous run/retry).
        const { stdout: staged } = await exec('git', ['diff', '--cached', '--name-only'], { cwd: mergeWorktreePath });
        if (staged.trim().length > 0) {
          await forgeCommit(mergeWorktreePath, composeCommitMessage(`plan(${planSetName}): initial planning artifacts`, ctx.modelTracker));
        }
      }

    } catch (err) {
      status = 'failed';
      const contextError = compileCtx ? await toCompileScopeContextError(compileCtx, err, err instanceof CompileScopeContextError ? err.failure.stage : 'compile') : null;
      if (contextError) {
        summary = contextError.failure.explanation;
        yield scopeContextFailureEvent(contextError.failure, runId);
        yield compileScopeTerminalFailureEvent({ runId, failure: contextError.failure });
      } else {
        summary = (err as Error).message;
      }
    } finally {
      tracing?.setOutput({ status, summary });
      yield {
        type: 'phase:end',
        runId,
        result: { status, summary },
        timestamp: new Date().toISOString(),
      };
      await tracing?.flush();
    }
  }

  /**
   * Enqueue: format a source document and add it to the PRD queue.
   * Runs the formatter agent to normalize content, then writes the
   * PRD file with frontmatter to the queue directory.
   */
  async *enqueue(source: string, options: Partial<EnqueueOptions> = {}): AsyncGenerator<EforgeEvent> {
    const cwd = this.cwd;
    const verbose = options.verbose;
    const abortController = options.abortController;

    // Resolve source content (file path or inline text)
    let sourceContent: string;
    try {
      const sourcePath = resolve(cwd, source);
      const stats = await stat(sourcePath);
      sourceContent = stats.isFile() ? await readFile(sourcePath, 'utf-8') : source;
    } catch {
      sourceContent = source;
    }

    yield { timestamp: new Date().toISOString(), type: 'enqueue:start', source };

    // First ask the LLM for explicit ACs in the submitted source. If there are
    // none, format rough input and infer ACs from that normalized context.
    let formattedBody = sourceContent;
    try {
      const extractorConfig = resolveAgentConfig('prd-validator', this.config);
      const sourceExtractorGen = runAcceptanceCriteriaExtractor({
        ...extractorConfig,
        cwd,
        prdContent: sourceContent,
        verbose,
        abortController,
        phase: 'standalone',
        harness: this.agentRuntimes.forRole('prd-validator'),
        allowNoAcceptanceCriteria: true,
        explicitOnly: true,
      });
      let sourceExtractorResult = await sourceExtractorGen.next();
      while (!sourceExtractorResult.done) {
        yield sourceExtractorResult.value;
        sourceExtractorResult = await sourceExtractorGen.next();
      }
      let acceptanceCriteriaInventory: CanonicalAcceptanceCriteriaInventory | undefined = sourceExtractorResult.value;

      if (acceptanceCriteriaInventory.criteria.length === 0) {
        const formatterConfig = resolveAgentConfig('formatter', this.config);
        const gen = runFormatter({ ...formatterConfig, sourceContent, verbose, abortController, phase: 'standalone', harness: this.agentRuntimes.forRole('formatter') });
        let result = await gen.next();
        while (!result.done) {
          yield result.value;
          result = await gen.next();
        }
        if (result.value?.body) formattedBody = result.value.body;

        const formattedExtractorGen = runAcceptanceCriteriaExtractor({
          ...extractorConfig,
          cwd,
          prdContent: formattedBody,
          verbose,
          abortController,
          phase: 'standalone',
          harness: this.agentRuntimes.forRole('prd-validator'),
          allowNoAcceptanceCriteria: this.config.build.validation.allowNoAcceptanceCriteria,
        });
        let formattedExtractorResult = await formattedExtractorGen.next();
        while (!formattedExtractorResult.done) {
          yield formattedExtractorResult.value;
          formattedExtractorResult = await formattedExtractorGen.next();
        }
        acceptanceCriteriaInventory = formattedExtractorResult.value;
      }

      // Infer title from formatted content (or from name override)
      const title = options.name ?? inferTitle(formattedBody, !source.includes('\n') ? source : undefined);

      // When an explicit afterQueueId is provided, classify the upstream and
      // skip dependency-detector output. Otherwise, run dependency detection.
      let dependsOn: string[] = [];
      let intoWaiting = false;
      if (options.afterQueueId !== undefined) {
        const classification = await classifyAfterQueueId(
          options.afterQueueId,
          this.config.prdQueue.dir,
          cwd,
        );
        dependsOn = classification.dependsOn;
        intoWaiting = classification.intoWaiting;
      } else {
        // Run dependency detection (graceful fallback on failure)
        try {
          const queue = await loadQueue(this.config.prdQueue.dir, cwd);
          const queueItems: QueueItemSummary[] = queue
            .map((p) => ({
              id: p.id,
              title: p.frontmatter.title,
              scopeSummary: stripAcceptanceCriteriaInventoryBlock(p.content).slice(0, 500),
            }));

          // In CLI-only mode, running builds are not tracked via state.json.
          // Daemon-mode dependency detection consults monitor data separately.
          const runningBuilds: RunningBuildSummary[] = [];

          if (queueItems.length > 0 || runningBuilds.length > 0) {
            const depDetectorConfig = resolveAgentConfig('dependency-detector', this.config);
            const depGen = runDependencyDetector({
              ...depDetectorConfig,
              prdContent: formattedBody,
              queueItems,
              runningBuilds,
              verbose,
              abortController,
              phase: 'standalone',
              harness: this.agentRuntimes.forRole('dependency-detector'),
              lane: 'planning',
            });
            let depResult = await depGen.next();
            while (!depResult.done) {
              yield depResult.value;
              depResult = await depGen.next();
            }
            dependsOn = depResult.value?.dependsOn ?? [];
          }
        } catch {
          // Dependency detection failure should not block enqueue
          dependsOn = [];
        }
      }

      let stackParent = options.stack_parent;
      if (this.config.stacking.enabled && stackParent === undefined && dependsOn.length > 0) {
        const inferred = await inferStackParentFromDependencies({
          cwd,
          queueDir: this.config.prdQueue.dir,
          dependsOn,
        });
        if (inferred.ambiguous) {
          throw new Error(inferred.reason ?? 'Cannot infer stack_parent for queued stacked build.');
        }
        stackParent = inferred.stackParent;
      }

      // Write to queue (filesystem-only — queue state is runtime, not tracked in git)
      const enqueueResult = await enqueuePrd({
        body: formattedBody,
        title,
        acceptanceCriteriaInventory,
        queueDir: this.config.prdQueue.dir,
        cwd,
        depends_on: dependsOn,
        ...(intoWaiting && { intoWaiting: true }),
        ...(options.profile !== undefined && { profile: options.profile }),
        ...(options.postMerge !== undefined && { postMerge: options.postMerge }),
        ...(options.landingAction !== undefined && { landingAction: options.landingAction }),
        ...(options.landingAutoMerge !== undefined && { landingAutoMerge: options.landingAutoMerge }),
        ...(options.stack_id !== undefined && { stack_id: options.stack_id }),
        ...(stackParent !== undefined && { stack_parent: stackParent }),
        ...(options.stack_provider !== undefined && { stack_provider: options.stack_provider }),
      });

      yield {
        timestamp: new Date().toISOString(),
        type: 'enqueue:complete',
        id: enqueueResult.id,
        filePath: enqueueResult.filePath,
        title,
        planSet: title,
      };
    } catch (err) {
      yield { timestamp: new Date().toISOString(), type: 'enqueue:failed', error: err instanceof Error ? err.message : String(err) };
      return;
    }
  }

  /**
   * Build: validate plan set, orchestrate parallel execution.
   * Creates Orchestrator with PlanRunner closure for three-phase pipeline.
   */
  async *build(planSet: string, options: Partial<BuildOptions> = {}): AsyncGenerator<EforgeEvent> {
    const runId = randomUUID();
    const cwd = options.cwd ?? this.cwd;
    let tracing: ReturnType<typeof createTracingContext> | undefined;

    let status: 'completed' | 'failed' = 'completed';
    let summary = 'Build complete';
    const terminalTracker = createBuildTerminalFailureTracker(runId);

    // Emit profile info before config warnings
    yield { timestamp: new Date().toISOString(), type: 'session:profile', profileName: this.configProfile.name, source: this.configProfile.source, scope: this.configProfile.scope, config: this.configProfile.config };

    // Emit any config warnings collected during engine creation
    for (const warning of this.startupWarnings()) {
      yield { timestamp: new Date().toISOString(), type: 'config:warning', message: warning.message, source: warning.source, details: warning.details };
    }

    try {
      validatePlanSetName(planSet);
      tracing = createTracingContext(this.config, runId, 'build', planSet);

      yield {
        type: 'phase:start',
        runId,
        planSet,
        command: 'build',
        timestamp: new Date().toISOString(),
      };

      tracing.setInput({ planSet });
      // Validate plan set
      // Compute mergeWorktreePath deterministically — the same path compile() created.
      const mergeWorktreePath = join(computeWorktreeBase(cwd, planSet), '__merge__');

      // Plan files live in the merge worktree (committed there during compile).
      const planBaseCwd = mergeWorktreePath;
      const configPath = resolve(planBaseCwd, this.config.plan.outputDir, planSet, 'orchestration.yaml');
      if (!existsSync(configPath)) {
        status = 'failed';
        summary = `orchestration.yaml not found at ${configPath}. The planner may have generated 0 plans without emitting a skip signal.`;
        return;
      }
      const validation = await validatePlanSet(configPath);
      if (!validation.valid) {
        status = 'failed';
        summary = `Plan set validation failed: ${validation.errors.join('; ')}`;
        return;
      }

      // Load orchestration config
      const orchConfig = await parseOrchestrationConfig(configPath);
      // Emit any orchestration config warnings as plan:warning events
      for (const warning of orchConfig.warnings ?? []) {
        yield { timestamp: new Date().toISOString(), type: 'planning:warning', message: warning, source: 'parseOrchestrationConfig' };
      }

      // Pre-load plan files for the runner
      const planDir = resolve(planBaseCwd, this.config.plan.outputDir, planSet);
      const planFileMap = new Map<string, PlanFile>();
      for (const plan of orchConfig.plans) {
        const planFile = await parsePlanFile(resolve(planDir, `${plan.id}.md`));
        // Emit any plan file warnings as plan:warning events
        for (const warning of planFile.warnings ?? []) {
          yield { timestamp: new Date().toISOString(), type: 'planning:warning', planId: plan.id, message: warning, source: 'parsePlanFile' };
        }
        planFileMap.set(plan.id, planFile);
      }

      // Per-plan runner closure — iterates build stages from the composed pipeline
      const config = this.config;
      const agentRuntimes = this.agentRuntimes;
      const verbose = options.verbose;
      const abortController = options.abortController;
      const extensionReviewerPerspectives = this.extensionRegistry.reviewerPerspectives;
      const extensionValidationProviders = this.extensionRegistry.validationProviders;

      // Use the pipeline persisted in orchestration.yaml during compile
      const buildPipeline = orchConfig.pipeline;

      const planRunner = async function* (
        planId: string,
        worktreePath: string,
      ): AsyncGenerator<EforgeEvent> {
        const planFile = planFileMap.get(planId);
        if (!planFile) {
          yield { timestamp: new Date().toISOString(), type: 'plan:build:failed', planId, error: `Plan file not found: ${planId}` };
          return;
        }

        // Read per-plan build/review from orchestration.yaml plan entry (required fields)
        const planEntry = orchConfig.plans.find((p) => p.id === planId)!;
        let planBuild: BuildStageSpec[] = planEntry.build;
        let planReview: ReviewProfileConfig = planEntry.review;

        // Runtime guard: sharded plans must run review-cycle with the verify perspective.
        // Belt-and-suspenders against planner-prompt omissions. Shards do not self-verify,
        // so the review-cycle's verify perspective is the integration gate.
        const builderShards = planFile.agents?.['builder']?.shards;
        const guardResult = applyShardedPlanGuard(planBuild, planReview, builderShards);
        planBuild = guardResult.planBuild;
        planReview = guardResult.planReview;
        for (const item of guardResult.injected) {
          yield {
            timestamp: new Date().toISOString(),
            type: 'plan:build:progress',
            planId,
            message: `Runtime guard: injected ${item} into sharded plan (shards do not self-verify; review-cycle is the integration gate)`,
          };
        }

        const buildCtx: BuildStageContext = {
          agentRuntimes,
          config,
          pipeline: buildPipeline,
          tracing: tracing!,
          cwd: worktreePath,
          planSetName: planSet,
          sourceContent: '', // Not needed for build stages
          verbose,
          abortController,
          modelTracker: new ModelTracker(),
          plans: Array.from(planFileMap.values()),
          expeditionModules: [],
          moduleBuildConfigs: new Map(),
          planId,
          worktreePath,
          planFile,
          orchConfig,
          planEntry,
          reviewIssues: [],
          build: planBuild,
          review: planReview,
          extensionReviewerPerspectives: extensionReviewerPerspectives,
          extensionValidationProviders: extensionValidationProviders,
        };

        yield* runBuildPipeline(buildCtx);
      };

      // Create validation fixer closure
      const validationFixer: ValidationFixer = async function* (fixerCwd, failures, attempt, maxAttempts, lane) {
        const fixerSpan = tracing!.createSpan('validation-fixer', { attempt, maxAttempts });
        fixerSpan.setInput({ failures: failures.map((f) => f.command) });
        const fixerTracker = createToolTracker(fixerSpan);
        try {
          const validationFixerConfig = resolveAgentConfig('validation-fixer', config);
          for await (const event of runValidationFixer({
            ...validationFixerConfig,
            cwd: fixerCwd,
            failures,
            attempt,
            maxAttempts,
            verbose,
            abortController,
            phase: 'standalone',
            harness: agentRuntimes.forRole('validation-fixer'),
            lane,
          })) {
            fixerTracker.handleEvent(event);
            yield event;
          }
          fixerTracker.cleanup();
          fixerSpan.end();
        } catch (err) {
          fixerTracker.cleanup();
          fixerSpan.error(err as Error);
        }
      };

      // Create merge conflict resolver closure
      const mergeEvents: EforgeEvent[] = [];
      const mergeEventSink = (event: EforgeEvent) => { mergeEvents.push(event); };

      const mergeResolver: MergeResolver = async (resolverCwd, conflict) => {
        const resolverSpan = tracing!.createSpan('merge-conflict-resolver', {
          branch: conflict.branch,
          files: conflict.conflictedFiles,
        });
        const resolverTracker = createToolTracker(resolverSpan);
        let resolved = false;
        try {
          const mergeResolverConfig = resolveAgentConfig('merge-conflict-resolver', config);
          for await (const event of runMergeConflictResolver({
            ...mergeResolverConfig,
            cwd: resolverCwd,
            conflict,
            verbose,
            abortController,
            phase: 'standalone',
            harness: agentRuntimes.forRole('merge-conflict-resolver'),
          })) {
            resolverTracker.handleEvent(event);
            mergeEventSink(event);
            if (event.type === 'plan:merge:resolve:complete') {
              resolved = event.resolved;
            }
          }
          resolverTracker.cleanup();
          resolverSpan.end();
        } catch (err) {
          resolverTracker.cleanup();
          resolverSpan.error(err as Error);
        }
        return resolved;
      };

      const validationPolicy = this.config.build.validation;
      const {
        prdValidator,
        acceptanceUnknownResolver,
        gapCloser,
        expectedAcceptanceCriteria,
        prdProvenanceContent,
      } = await createPrdValidationWiring({
        cwd,
        config,
        agentRuntimes,
        tracing: tracing!,
        planSetName: planSet,
        orchConfig,
        planFileMap,
        buildPipeline,
        verbose,
        abortController,
        ...(options.prdFilePath !== undefined ? { prdFilePath: options.prdFilePath } : {}),
      });

      // Materialize PRD provenance artifact on the eforge work branch.
      // Done before the orchestrator starts so the artifact appears early in
      // the eforge work branch history. The artifact path replaces the source
      // queue path for cleanup purposes — the queue file is gitignored and
      // never needs cleanup.
      let cleanupPrdFilePath: string | undefined;
      if (prdProvenanceContent !== undefined) {
        try {
          const { artifactRelPath } = await materializePrdArtifact({
            mergeWorktreePath,
            prdId: planSet,
            prdContent: prdProvenanceContent,
          });
          cleanupPrdFilePath = artifactRelPath;
        } catch {
          // Non-fatal — build continues without PRD provenance artifact
        }
      }

      // Create and run orchestrator
      const signal = abortController?.signal;
      const effectivePostMergeCommands = [
        ...(config.build.postMergeCommands ?? []),
        ...(options.postMergeCommands ?? []),
      ];
      const shouldCleanup = options.cleanup ?? this.config.build.cleanupPlanFiles;
      const effectiveLandingAction = options.landingAction ?? this.config.landing.action;
      if (options.landingAutoMerge === true && effectiveLandingAction !== 'pr') {
        status = 'failed';
        summary = `landingAutoMerge: true is only valid when the effective landing action is 'pr' (got '${effectiveLandingAction}')`;
        return;
      }
      const orchestrator = new Orchestrator({
        repoRoot: cwd,
        planRunner,
        signal,
        postMergeCommands: effectivePostMergeCommands,
        validateCommands: orchConfig.validate,
        postMergeCommandTimeoutMs: config.build.postMergeCommandTimeoutMs,
        validationFixer,
        maxValidationRetries: config.build.maxValidationRetries,
        mergeResolver,
        prdValidator,
        acceptanceUnknownResolver,
        gapCloser,
        mergeWorktreePath,
        shouldCleanup,
        cleanupPlanSet: planSet,
        cleanupOutputDir: this.config.plan.outputDir,
        cleanupPrdFilePath,
        extensionRegistry: this.extensionRegistry,
        policyGateTimeoutMs: this.config.extensions.policyGateTimeoutMs,
        policyGateFailurePolicy: this.config.extensions.policyGateFailurePolicy,
        engineConfig: config,
        prdId: options.prdId,
        stackContext: options.stackContext,
        landingAction: effectiveLandingAction,
        prAutoMergePolicy: this.config.landing.pr.autoMerge,
        ...(options.landingAutoMerge !== undefined && { landingAutoMerge: options.landingAutoMerge }),
        ...(options.stackProvider !== undefined && { stackProvider: options.stackProvider }),
        validationPolicy,
        expectedAcceptanceCriteria,
      });

      for await (const event of orchestrator.execute(orchConfig)) {
        // Drain any buffered merge resolution events before yielding the orchestrator event
        while (mergeEvents.length > 0) {
          yield mergeEvents.shift()!;
        }
        yield event;
        terminalTracker.observe(event);
        if (event.type === 'plan:build:failed') { status = 'failed'; summary = event.error.startsWith('Merge failed') ? `Merge failed for ${event.planId}` : `Build failed for ${event.planId}`; }
        if (event.type === 'validation:complete') { status = event.passed ? 'completed' : 'failed'; summary = event.passed ? 'Build complete' : 'Post-merge validation failed'; }
        if (event.type === 'prd_validation:complete') {
          if (!event.passed) {
            status = 'failed';
            summary = `PRD validation failed: ${event.gaps.length} gap(s) found`;
          }
        }
        if (event.type === 'acceptance_validation:complete') {
          const failCount = event.verdicts.filter((v) => v.verdict !== 'pass').length;
          const hasWaiver = (event.waivers ?? []).some((waiver) => waiver.trim().length > 0);
          if (!event.passed || (failCount > 0 && !hasWaiver)) {
            status = 'failed';
            summary = formatAcceptanceFailureSummary(event.verdicts, event.acceptanceConflicts);
          }
        }
        if (event.type === 'daemon:error' && event.source === 'stack:artifact-recording') {
          status = 'failed';
          summary = event.message;
        }
        if (event.type === 'stack:landing:update' && event.status === 'failed') {
          status = 'failed';
          summary = event.reason ? `Stack landing failed: ${event.reason}` : 'Stack landing failed';
        }
      }

      // Drain any remaining merge resolution events after orchestrator completes
      while (mergeEvents.length > 0) {
        yield mergeEvents.shift()!;
      }

    } catch (err) {
      status = 'failed';
      summary = (err as Error).message;
    } finally {
      tracing?.setOutput({ status, summary });
      const terminalEvt = terminalTracker.toEvent(status, summary);
      if (terminalEvt) yield terminalEvt;
      yield {
        type: 'phase:end',
        runId,
        result: { status, summary },
        timestamp: new Date().toISOString(),
      };
      await tracing?.flush();
    }
  }

  /**
   * Process a single PRD: claim, staleness check, compile, build.
   *
   * This method is the subprocess entry point: the scheduler spawns one child
   * process per PRD that calls this directly. It emits events (which the child's
   * monitor recorder writes to SQLite) and returns. The parent scheduler handles
   * lock release and file-location transitions in its child.on('exit') handler
   * based on the child's exit code.
   *
   * When `sessionId` is provided (injected by the parent scheduler via `--session-id`),
   * the child uses it verbatim and does NOT emit `session:start` — the parent already
   * emitted it onto its own event queue so the DB row exists before the child starts.
   * When absent (direct programmatic invocation), generates a new UUID and emits
   * `session:start` as before.
   */
  async *buildSinglePrd(
    prd: import('./prd-queue.js').QueuedPrd,
    options: QueueOptions,
    sessionId?: string,
  ): AsyncGenerator<EforgeEvent> {
    yield* runQueuedPrdBuild({
      cwd: this.cwd,
      config: this.config,
      agentRuntimes: this.agentRuntimes,
      compile: this.compile.bind(this),
      build: this.build.bind(this),
      resumeBuild: this.resumeBuild.bind(this),
    }, prd, options, sessionId);
  }

  /**
   * Spawn a child process to build a single PRD, and do all file/lock
   * cleanup in the exit handler.
   *
   * This is the sole cleanup path for normal and crash scenarios alike: when
   * the child exits (cleanly, via signal, or via spawn error), the parent
   * decides what to do with the PRD file and the lock based on the exit
   * code contract defined by `QueueExecExitCode`. This replaces the
   * finally-block cleanup in `buildSinglePrd` so a SIGTERM mid-build cannot
   * leave stale state behind — the parent's exit handler runs regardless.
   */
  private spawnPrdChild(
    prd: import('./prd-queue.js').QueuedPrd,
    options: QueueOptions,
    prdSessionId: string,
    pushEvent: (event: EforgeEvent) => void,
    routedProfileOverride?: string,
  ): Promise<'completed' | 'failed' | 'skipped' | 'already-claimed'> {
    const cwd = this.cwd;
    const agentRuntimes = this.agentRuntimes; // captured for inline recovery
    const config = this.config;               // captured for inline recovery
    const prdId = prd.id;
    const filePath = prd.filePath;
    const abortController = options.abortController;

    return new Promise((resolvePromise) => {
      // Pre-flight: when the PRD has a profile override in its frontmatter (or
      // a routed override was provided as fallback), validate it before spawning
      // the worker. On miss, hard-fail the PRD.
      const preflightAndSpawn = async (): Promise<void> => {
        // Effective profile: frontmatter.profile (persisted) takes precedence,
        // then the in-memory routedProfileOverride (persist-failed fallback).
        const effectiveProfile = prd.frontmatter.profile ?? routedProfileOverride;
        if (effectiveProfile) {
          const overrideName = effectiveProfile;
          const { getConfigDir, getConventionalConfigDir, loadProfile: loadProfileFn } = await import('./config.js');
          const discoveredConfigDir = await getConfigDir(cwd);
          const configDir = discoveredConfigDir ?? getConventionalConfigDir(cwd);
          const profileResult = await loadProfileFn(configDir, overrideName, cwd);
          if (!profileResult) {
            // Profile not found — fail the PRD without spawning a worker.
            const errMessage = `Profile override '${overrideName}' not found in any scope (searched: project-local <.eforge/profiles/>, project-team <eforge/profiles/>, user <~/.config/eforge/profiles/>)`;
            pushEvent({
              type: 'plan:status:change',
              planId: prdId,
              status: 'failed',
            } as EforgeEvent);
            pushEvent({
              type: 'plan:error:set',
              planId: prdId,
              error: errMessage,
            } as EforgeEvent);
            const isCompiledResumePrd = (() => {
              try {
                return getCompiledResumeFrontmatter(prd.frontmatter) !== undefined;
              } catch {
                return prd.frontmatter.resume_mode !== undefined ||
                  prd.frontmatter.resume_from !== undefined ||
                  prd.frontmatter.resume_set_name !== undefined ||
                  prd.frontmatter.resume_feature_branch !== undefined ||
                  prd.frontmatter.resume_base_branch !== undefined;
              }
            })();
            if (isCompiledResumePrd) {
              try {
                await rollbackQueuedResume({ cwd, prdId, queueDir: config.prdQueue.dir });
              } catch {
                try { await releasePrd(prdId, cwd); } catch { /* best-effort */ }
              }
            } else {
              try {
                await releasePrd(prdId, cwd);
              } catch { /* best-effort */ }
              try {
                await movePrdToSubdir(filePath, 'failed', cwd);
              } catch { /* best-effort */ }
            }
            resolvePromise('failed');
            return;
          }
        }

        const args = ['queue', 'exec', prdId];
        if (options.auto) args.push('--auto');
        if (options.verbose) args.push('--verbose');
        args.push('--no-monitor');
        args.push('--session-id', prdSessionId);
        if (prd.frontmatter.profile) {
          args.push('--profile', prd.frontmatter.profile);
        } else if (routedProfileOverride) {
          args.push('--profile', routedProfileOverride);
        }
        const childLandingAction = options.landingAction ?? prd.frontmatter.landing;
        if (childLandingAction) {
          args.push('--landing-action', childLandingAction);
        }
        const childLandingAutoMerge = options.landingAutoMerge ?? prd.frontmatter.landing_auto_merge;
        if (childLandingAutoMerge !== undefined) {
          args.push('--landing-auto-merge', String(childLandingAutoMerge));
        }
        doSpawn(args);
      };

      const doSpawn = (args: string[]): void => {

      // Use the current Node binary + the CLI entrypoint so the child is
      // guaranteed to be the same build as the parent. Spawning bare `eforge`
      // from PATH would risk parent/child version skew (the exit code contract
      // could be interpreted differently on each side).
      //
      // Prefer EFORGE_CLI_PATH — the CLI sets this when forking the daemon so
      // the in-process watcher can still locate the CLI even though its own
      // argv[1] points at the monitor's server-main. Fall back to argv[1] for
      // the direct-CLI path (e.g. `eforge run --queue --watch`).
      const cliEntrypoint = process.env.EFORGE_CLI_PATH ?? process.argv[1];
      const child = cliEntrypoint
        ? spawn(process.execPath, [cliEntrypoint, ...args], { cwd, stdio: 'ignore' })
        : spawn('eforge', args, { cwd, stdio: 'ignore' });

      // Aborting the scheduler does not kill this child — children are
      // always left to drain. When the user wants to cancel a specific
      // build, the daemon's cancelWorker path sends SIGTERM directly by
      // PID; on terminal Ctrl+C, the signal reaches children via the
      // shared process group without needing a listener here.

      // `exit` and `error` can both fire (e.g. ENOENT during spawn emits
      // `error` plus a synthetic `exit` with code=null). Guard so cleanup
      // runs exactly once.
      let finalized = false;

      const finalize = async (exitCode: number | null, signal: NodeJS.Signals | null): Promise<void> => {
        if (finalized) return;
        finalized = true;

        const isSignalKill = signal !== null;
        const wasAborted = abortController?.signal.aborted === true;
        const isAlreadyClaimed = exitCode === QueueExecExitCode.SkippedAlreadyClaimed;
        const needsRevision = exitCode === QueueExecExitCode.SkippedNeedsRevision;
        const operatorCancellation = signal !== null ? await consumeQueuePrdCancellation({ cwd, prdId, expectedSessionId: prdSessionId, ...(child.pid !== undefined ? { expectedPid: child.pid } : {}) }) : null;
        let compiledResume: ReturnType<typeof getCompiledResumeFrontmatter>;
        try { compiledResume = getCompiledResumeFrontmatter(prd.frontmatter); } catch { compiledResume = undefined; }
        const isCompiledResumePrd = compiledResume !== undefined || prd.frontmatter.resume_mode !== undefined || prd.frontmatter.resume_from !== undefined || prd.frontmatter.resume_set_name !== undefined || prd.frontmatter.resume_feature_branch !== undefined || prd.frontmatter.resume_base_branch !== undefined;
        const finalizeFailedResumeSidecars = (degradedReason?: string) => compiledResume === undefined ? Promise.resolve() : finalizeFailedQueuedResumeSidecars({ cwd, queueDir: config.prdQueue.dir, prdId, setName: compiledResume.setName, featureBranch: compiledResume.featureBranch, baseBranch: compiledResume.baseBranch, trunkBranch: config.build.trunkBranch, agentRuntimes, config, verbose: options.verbose, abortController, resumeSessionId: prdSessionId, ...(degradedReason !== undefined ? { degradedReason, activationReached: true } : {}) });

        let status: 'completed' | 'failed' | 'skipped' | 'already-claimed';
        let moveTo: 'failed' | 'skipped' | null;
        let shouldCleanupCompleted = false;
        const shouldRelease = !isAlreadyClaimed;

        const childExit = classifyQueueChildExit({ exitCode, signal, schedulerAborted: wasAborted, operatorCancellation });
        status = childExit.status;
        moveTo = childExit.moveTo;
        shouldCleanupCompleted = childExit.shouldCleanupCompleted;

        if (isSignalKill && wasAborted) {
          // User-requested cancel (parent sent SIGTERM in response to abort).
          // Leave the PRD in queue/ so a subsequent run can pick it up;
          // don't mark it failed — that would trip the "don't retry failed
          // builds" behavior.
        } else if (isSignalKill && operatorCancellation) {
          // Operator PRD cancellation is classified as skipped and moved to skipped/.
        } else if (isSignalKill) {
          // Unsolicited signal (OOM kill, SIGKILL from outside). Treat as failure.
        } else if (isAlreadyClaimed) {
          // Non-terminal: another process holds the claim. Return 'already-claimed'
          // so the scheduler keeps the PRD in running state without emitting a
          // terminal queue:prd:complete. Lock is NOT released (shouldRelease=false above).
        } else if (needsRevision) {
          // Needs revision leaves the file in queue/ for manual updates.
        }

        try {
          if (isCompiledResumePrd && !isAlreadyClaimed) {
            let resumeStatus = status;
            try {
              if (status === 'completed') {
                const finalization = await finalizeQueuedResumeSuccess({ cwd, prdId, queueDir: config.prdQueue.dir });
                if (finalization.status === 'blocked') {
                  const rollback = await rollbackQueuedResume({ cwd, prdId, queueDir: config.prdQueue.dir });
                  if (rollback.status === 'rolled-back') await finalizeFailedResumeSidecars(finalization.reason);
                  resumeStatus = 'failed';
                }
              } else {
                const rollback = await rollbackQueuedResume({ cwd, prdId, queueDir: config.prdQueue.dir });
                if (rollback.status === 'rolled-back') await finalizeFailedResumeSidecars();
              }
            } catch {
              resumeStatus = 'failed';
              try { await releasePrd(prdId, cwd); } catch { /* best-effort */ }
            }
            status = resumeStatus;
            return;
          }

          if (shouldRelease) {
            try { await releasePrd(prdId, cwd); } catch { /* best-effort */ }
          }
          if (shouldCleanupCompleted) {
            // Successful builds leave the committed provenance copy under
            // `eforge/prds/` to the normal git cleanup path, but the runtime
            // queue source under `.eforge/queue/` is gitignored and must be
            // removed here so daemon restarts do not rediscover completed work.
            try { await cleanupCompletedPrd(filePath, config.prdQueue.dir, cwd); } catch { /* best-effort */ }
          } else if (moveTo === 'failed') {
            // Run recovery inline, synthesizing from monitor DB and git.
            const setName = prdId;
            const dbPath = resolve(cwd, '.eforge', 'monitor.db');

            // Build failure summary (tolerates missing state.json)
            let summary: BuildFailureSummary;
            try {
              summary = await buildFailureSummary({ setName, prdId, cwd, dbPath, trunkBranch: config.build.trunkBranch });
            } catch {
              summary = {
                prdId,
                setName,
                featureBranch: `eforge/${setName}`,
                baseBranch: '',
                plans: [],
                failingPlan: { planId: 'unknown' },
                landedCommits: [],
                diffStat: '',
                modelsUsed: [],
                failedAt: new Date().toISOString(),
                partial: true,
              };
            }

            // Read PRD content (best-effort — child just exited, file should exist)
            let prdContent = '';
            try { prdContent = await readFile(filePath, 'utf-8'); } catch { /* ignore */ }

            const continueRepairEvidence = await projectRecoverySidecarResumeEvidence({
              cwd,
              setName,
              prdId,
              outputDir: config.plan.outputDir,
              dbPath,
              ...(config.build.trunkBranch !== undefined ? { trunkBranch: config.build.trunkBranch } : {}),
              featureBranch: summary.featureBranch,
              baseBranch: summary.baseBranch,
              failureSummary: summary,
            });

            // Run recovery analyst with 90s timeout
            let verdict: RecoveryVerdict;
            const recoveryModelTracker = new ModelTracker();
            const recoveryAbort = new AbortController();
            const recoveryTimer = setTimeout(() => recoveryAbort.abort(), 90_000);
            const inlineDeterministicRec = determineRecoveryRecommendation(summary, continueRepairEvidence.continueRepairEligibility);
            try {
              let verdictResult: RecoveryVerdict | null = null;
              const harness = agentRuntimes.forRole('recovery-analyst');
              const agentConfig = resolveAgentConfig('recovery-analyst', config);
              let inlineAgentError: string | undefined;
              let inlineParseError: string | undefined;

              try {
                for await (const event of runRecoveryAnalyst({
                  ...agentConfig,
                  harness,
                  prdContent,
                  summary,
                  deterministicRecommendation: inlineDeterministicRec,
                  continueRepairEligibility: continueRepairEvidence.continueRepairEligibility,
                  prdId,
                  cwd,
                  abortController: recoveryAbort,
                  phase: 'standalone',
                })) {
                  if (event.type === 'recovery:complete') {
                    verdictResult = event.verdict;
                  }
                  if (event.type === 'recovery:error') {
                    inlineParseError = event.error;
                  }
                  if (event.type === 'agent:start' && 'model' in event && typeof event.model === 'string') {
                    recoveryModelTracker.record(event.model);
                  }
                }
              } catch (agentErr) {
                inlineAgentError = agentErr instanceof Error ? agentErr.message : String(agentErr);
              }

              verdict = selectFinalVerdict({
                deterministicRecommendation: inlineDeterministicRec,
                analystVerdict: verdictResult,
                analystError: inlineAgentError,
                parseError: inlineParseError,
                summary,
              });
            } finally {
              clearTimeout(recoveryTimer);
            }

            // Move PRD to failed/ and write sidecar files (filesystem-only)
            try {
              await moveFailedWithSidecar(filePath, summary, verdict!, recoveryModelTracker, cwd, continueRepairEvidence);
            } catch {
              // Fallback: plain move without sidecars
              try { await movePrdToSubdir(filePath, 'failed', cwd); } catch { /* best-effort */ }
            }

          } else if (moveTo) {
            try {
              await movePrdToSubdir(filePath, moveTo, cwd);
            } catch {
              // File may already be moved, deleted (completed), or missing.
              // Best-effort — the startup reconciler is the backstop.
            }
          }
        } finally {
          resolvePromise(status);
        }
      };

      child.on('exit', (code, signal) => {
        void finalize(code, signal);
      });
      child.on('error', () => {
        void finalize(QueueExecExitCode.Failed, null);
      });
      };

      void preflightAndSpawn().catch(() => {
        resolvePromise('failed');
      });
    });
  }

  /**
   * Queue: process PRDs from a queue directory with greedy semaphore-limited scheduling.
   * For each PRD: staleness check → compile → build.
   * Updates frontmatter status as PRDs are processed.
   * At parallelism=1 (default), behavior is identical to sequential execution.
   */
  async *runQueue(options: QueueOptions = {}): AsyncGenerator<EforgeEvent> {
    const cwd = this.cwd;
    const queueDir = this.config.prdQueue.dir;
    const abortController = options.abortController;

    // Load and order queue
    const allPrds = await loadQueue(queueDir, cwd);
    const allOrdered = resolveQueueOrder(allPrds);

    // If a name is provided, filter to only that PRD (used by foreground build)
    let orderedPrds = options.name
      ? allOrdered.filter((p) => p.id === options.name)
      : [...allOrdered];

    yield {
      timestamp: new Date().toISOString(),
      type: 'queue:start',
      prdCount: orderedPrds.length,
      dir: queueDir,
    };

    // Per-PRD state tracking for the greedy scheduler
    type PrdRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'blocked';
    interface PrdRunState {
      status: PrdRunStatus;
      dependsOn: string[];
    }

    const prdState = new Map<string, PrdRunState>();
    for (const prd of orderedPrds) {
      const deps = prd.frontmatter.depends_on ?? [];
      prdState.set(prd.id, { status: 'pending', dependsOn: deps });
    }

    const loadTerminalDependencyIds = async (): Promise<Set<string>> => new Set<string>([
      ...(await loadQueue(`${queueDir}/failed`, cwd).catch((): import('./prd-queue.js').QueuedPrd[] => [])).map((p) => p.id),
      ...(await loadQueue(`${queueDir}/skipped`, cwd).catch((): import('./prd-queue.js').QueuedPrd[] => [])).map((p) => p.id),
    ]);
    const isDependencySatisfied = (dep: string, artifactRegistry: ArtifactRegistry, terminalIds: Set<string>, completionRegistry: CompletionRegistry): boolean => {
      if (terminalIds.has(dep)) return false;
      const depState = prdState.get(dep);
      if (depState) {
        // Active in-memory queue state takes precedence over stale completion
        // records from prior attempts; wait for the live run outcome.
        return depState.status === 'completed' && hasUsableArtifact(artifactRegistry, dep);
      }
      const completionRecord = lookupCompletion(completionRegistry, dep);
      if (completionRecord?.status === 'failed' || completionRecord?.status === 'skipped') return false;
      if (completionRecord?.status === 'completed' && !completionRecord.artifactAvailable) return false;
      return hasUsableArtifact(artifactRegistry, dep);
    };
    const isDependencyBlocking = (dep: string, terminalIds: Set<string>, completionRegistry: CompletionRegistry): boolean => {
      if (terminalIds.has(dep)) return true;
      const depState = prdState.get(dep);
      if (depState) {
        return depState.status === 'failed' || depState.status === 'skipped' || depState.status === 'blocked';
      }
      const completionRecord = lookupCompletion(completionRegistry, dep);
      return completionRecord?.status === 'failed' || completionRecord?.status === 'skipped';
    };

    const isReady = (prdId: string, artifactRegistry: ArtifactRegistry, terminalIds: Set<string>, completionRegistry: CompletionRegistry): boolean => {
      const state = prdState.get(prdId)!;
      if (state.status !== 'pending') return false;
      return state.dependsOn.every((dep) => isDependencySatisfied(dep, artifactRegistry, terminalIds, completionRegistry));
    };

    // --- eforge:region gap-close ---
    const failDispatch = async (prd: import('./prd-queue.js').QueuedPrd, message: string, stage: 'stacking-validation' | 'policy-gate' | 'profile-routing' | 'dispatch' = 'dispatch'): Promise<void> => {
      eventQueue.push({ timestamp: new Date().toISOString(), type: 'queue:prd:dispatch-failed', prdId: prd.id, title: prd.frontmatter.title, reason: message, stage } as EforgeEvent);
      const state = prdState.get(prd.id);
      if (state) state.status = 'failed';
      eventQueue.push({ timestamp: new Date().toISOString(), type: 'plan:status:change', planId: prd.id, status: 'failed' } as EforgeEvent);
      eventQueue.push({ timestamp: new Date().toISOString(), type: 'plan:error:set', planId: prd.id, error: message } as EforgeEvent);
      try { await movePrdToSubdir(prd.filePath, 'failed', cwd); } catch { /* best-effort */ }
      eventQueue.push({ timestamp: new Date().toISOString(), type: 'queue:prd:complete', prdId: prd.id, status: 'failed' } as EforgeEvent);
    };

    const applyStackingDispatchValidation = async (prd: import('./prd-queue.js').QueuedPrd): Promise<import('./prd-queue.js').QueuedPrd | null> => {
      const result = await applyStackedDispatchValidation({ prd, cwd, stackingEnabled: this.config.stacking.enabled === true });
      if ('prd' in result) return result.prd;
      await failDispatch(prd, result.error, 'stacking-validation');
      return null;
    };
    // --- eforge:endregion gap-close ---

    const propagateBlocked = (failedId: string): void => {
      // Mark all transitive dependents as blocked
      const queue = [failedId];
      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const [id, state] of prdState) {
          if (state.status === 'pending' && state.dependsOn.includes(current)) {
            state.status = 'blocked';
            queue.push(id);
          }
        }
      }
    };

    const parallelism = this.config.maxConcurrentBuilds;
    const semaphore = new Semaphore(parallelism);
    const eventQueue = new AsyncEventQueue<EforgeEvent>();

    let processed = 0;
    let skipped = 0;

    /**
     * Re-scan the queue directory, discover new PRDs not yet in prdState,
     * and emit queue:prd:discovered for each. Idempotent - safe to call repeatedly.
     */
    const discoverNewPrds = async (): Promise<void> => {
      let freshPrds: Awaited<ReturnType<typeof loadQueue>>;
      try {
        freshPrds = await loadQueue(queueDir, cwd);
      } catch {
        // Filesystem or parse error during re-scan — skip discovery this cycle
        // rather than crashing the queue while other PRDs may be running.
        return;
      }
      const freshOrdered = resolveQueueOrder(freshPrds);
      for (const prd of freshOrdered) {
        if (!prdState.has(prd.id)) {
          const deps = prd.frontmatter.depends_on ?? [];
          prdState.set(prd.id, { status: 'pending', dependsOn: deps });
          orderedPrds.push(prd);
          eventQueue.push({
            timestamp: new Date().toISOString(),
            type: 'queue:prd:discovered',
            prdId: prd.id,
            title: prd.frontmatter.title ?? prd.id, dependsOn: deps,
          } as EforgeEvent);
        }
      }
    };

    const startReadyPrds = async (): Promise<void> => {
      const [artifactRegistry, completionRegistry] = await Promise.all([
        loadArtifactRegistry(cwd),
        loadCompletionRegistry(cwd),
      ]);
      const terminalIds = await loadTerminalDependencyIds();
      for (const prd of orderedPrds) {
        if (abortController?.signal.aborted) break;
        const candidateState = prdState.get(prd.id);
        if (candidateState?.status === 'pending' && prd.frontmatter.held === true) continue;
        if (candidateState?.status === 'pending') {
          const blockingDeps = candidateState.dependsOn.filter((dep) => isDependencyBlocking(dep, terminalIds, completionRegistry));
          if (blockingDeps.length > 0) {
            candidateState.status = 'blocked';
            propagateBlocked(prd.id);
          }
        }
        if (!isReady(prd.id, artifactRegistry, terminalIds, completionRegistry)) continue;

        // --- eforge:region gap-close ---
        const stackValidatedPrd = await applyStackingDispatchValidation(prd);
        if (!stackValidatedPrd) continue;
        const currentPrd = stackValidatedPrd;
        // --- eforge:endregion gap-close ---

        const state = prdState.get(currentPrd.id)!;
        state.status = 'running';

        // Parent owns the sessionId: generate it here and emit session:start
        // immediately so the DB row exists before the child subprocess starts.
        // The child receives the id via --session-id and skips its own
        // session:start emission to avoid double-creating the row.
        const prdSessionId = randomUUID();
        eventQueue.push({
          type: 'session:start',
          sessionId: prdSessionId,
          timestamp: new Date().toISOString(),
        } as EforgeEvent);
        eventQueue.push({
          type: 'session:profile',
          sessionId: prdSessionId,
          profileName: this.configProfile.name,
          source: this.configProfile.source,
          scope: this.configProfile.scope,
          config: this.configProfile.config,
          timestamp: new Date().toISOString(),
        } as EforgeEvent);
        for (const warning of this.startupWarnings()) {
          eventQueue.push({ timestamp: new Date().toISOString(), type: 'config:warning', message: warning.message, source: warning.source, details: warning.details } as EforgeEvent);
        }

        eventQueue.addProducer();

        // Launch asynchronously — semaphore gates actual execution.
        // Each PRD runs as its own OS process via spawnPrdChild, which
        // owns lock release and PRD file transitions in its exit handler.
        void (async () => {
          let acquired = false;
          let status: 'completed' | 'failed' | 'skipped' | 'already-claimed' = 'failed';
          try {
            await semaphore.acquire();
            acquired = true;

            // --- eforge:region gap-close ---
            status = await this.spawnPrdChild(currentPrd, options, prdSessionId, (event) => eventQueue.push(event));
            // --- eforge:endregion gap-close ---

            // 'already-claimed' is non-terminal: do not emit a terminal completion
            // or mark dependencies satisfied. The PRD remains in queue for the
            // original lock owner (or a later run after lock cleanup) to finish.
            if (status !== 'already-claimed') {
              eventQueue.push({
                timestamp: new Date().toISOString(),
                type: 'queue:prd:complete',
                prdId: prd.id,
                status,
              } as EforgeEvent);
            }
          } catch {
            status = 'failed';
            eventQueue.push({
              timestamp: new Date().toISOString(),
              type: 'queue:prd:complete',
              prdId: prd.id,
              status: 'failed',
            } as EforgeEvent);
          } finally {
            if (acquired) semaphore.release();

            const finalState = prdState.get(prd.id)!;
            if (status !== 'already-claimed' && finalState.status === 'running') {
              finalState.status = status;
            }

            if (finalState.status === 'failed' || finalState.status === 'skipped') {
              propagateBlocked(prd.id);
            }

            eventQueue.removeProducer();
          }
        })();
      }

    };

    // Seed the scheduler
    await startReadyPrds();

    // If nothing was launched (empty queue or all blocked), add/remove a producer to close the queue
    const hasAnyRunning = [...prdState.values()].some((s) => s.status === 'running');
    if (!hasAnyRunning) {
      eventQueue.addProducer();
      eventQueue.removeProducer();
    }

    // Consume multiplexed events
    for await (const event of eventQueue) {
      yield event;

      // On PRD completion, update counters and try to launch newly-ready PRDs.
      // State transitions are handled by the producer's finally block (which runs
      // before removeProducer), so we only need to update counters here.
      if (event.type === 'queue:prd:complete') {
        const completionStatus = (event as { status: string }).status;
        const completedPrdId = (event as { prdId: string }).prdId;
        if (completionStatus === 'skipped') {
          skipped++;
        } else {
          processed++;
        }

        // Keep the queue open during discovery so pushed events are not dropped
        eventQueue.addProducer();

        // Record terminal completion in the completion index before unblocking
        // waiting PRDs or propagating skips.
        try {
          const now = new Date().toISOString();
          let artifactAvailable = false;
          let artifactBranch: string | undefined;
          if (completionStatus === 'completed') {
            try {
              const artifactRegistry = await loadArtifactRegistry(cwd);
              const record = artifactRegistry.builds.find((b) => b.prdId === completedPrdId);
              artifactAvailable = record?.status === 'built';
              artifactBranch = record?.artifactBranch;
            } catch {
              // Best-effort: if registry can't be read, artifactAvailable stays false.
            }
          }
          await upsertCompletion(cwd, {
            prdId: completedPrdId,
            status: completionStatus as 'completed' | 'failed' | 'skipped',
            artifactAvailable,
            ...(artifactBranch !== undefined && { artifactBranch }),
            completedAt: now,
            updatedAt: now,
          });
        } catch {
          // Non-fatal: completion index recording failure must not block scheduling.
        }

        // Transition filesystem state for waiting PRDs before discovering new ones.
        // This ensures discoverNewPrds() finds any newly unblocked PRDs.
        if (completionStatus === 'completed') {
          try {
            await unblockWaiting(queueDir, cwd, completedPrdId, { requireArtifacts: true });
          } catch {
            // Non-fatal: filesystem unblock failure doesn't stop the scheduler
          }
        } else if (completionStatus === 'failed') {
          try {
            await propagateSkipFS(queueDir, cwd, completedPrdId, 'failed');
          } catch {
            // Non-fatal: filesystem skip propagation failure doesn't stop the scheduler
          }
        } else if (completionStatus === 'skipped') {
          try {
            await propagateSkipFS(queueDir, cwd, completedPrdId, 'cancelled');
          } catch {
            // Non-fatal
          }
        }

        // Discover any new PRDs enqueued mid-cycle, then launch newly-ready PRDs
        await discoverNewPrds();
        await startReadyPrds();
        eventQueue.removeProducer();
      }
    }

    // Count blocked PRDs as skipped
    for (const [, state] of prdState) {
      if (state.status === 'blocked') {
        skipped++;
      }
    }

    yield {
      timestamp: new Date().toISOString(),
      type: 'queue:complete',
      processed,
      skipped,
    };
  }

  /**
   * Watch queue: long-lived event-driven watcher that discovers new PRDs
   * via explicit `queue:mutation` events injected by daemon HTTP routes.
   * Stays alive until the abort signal fires or SIGTERM.
   *
   * Discovery is triggered by:
   *   - `onInjectEventRegister` callback (used by the daemon to wire HTTP routes)
   *   - `queue:prd:complete` events re-emitted from the pump after each build
   *
   * The consumer loop (pump) yields every event from `eventQueue` to the
   * caller, then conditionally re-emits scheduler-relevant events onto the
   * internal bus so the QueueScheduler can react without relying on fs.watch.
   */
  async *watchQueue(options: QueueOptions = {}): AsyncGenerator<EforgeEvent> {
    const cwd = this.cwd;
    const queueDir = this.config.prdQueue.dir;
    const absQueueDir = resolve(cwd, queueDir);
    // If no abortController provided, create an internal one wired to process
    // signals so the watcher can be gracefully shut down on SIGTERM/SIGINT
    const abortController = options.abortController ?? new AbortController();
    if (!options.abortController) {
      const signalHandler = (): void => { abortController.abort(); };
      process.once('SIGTERM', signalHandler);
      process.once('SIGINT', signalHandler);
    }

    // Ensure queue directory exists before scanning
    await mkdir(absQueueDir, { recursive: true });

    // Load and order initial queue
    const allPrds = await loadQueue(queueDir, cwd);
    const allOrdered = resolveQueueOrder(allPrds);

    const orderedPrds = options.name
      ? allOrdered.filter((p) => p.id === options.name)
      : [...allOrdered];

    const bus = new EventEmitter();
    const eventQueue = new AsyncEventQueue<EforgeEvent>();

    // Resolve configDir needed by profile routers in the scheduler.
    const schedulerConfigDir = this.configDir;

    const scheduler = new QueueScheduler({
      bus,
      cwd,
      queueDir,
      config: this.config,
      configProfile: this.configProfile,
      parallelism: this.config.maxConcurrentBuilds,
      abortController,
      eventQueue,
      spawnPrdChild: (prd, opts, sessionId, routedProfileOverride) => this.spawnPrdChild(prd, opts, sessionId, (event) => eventQueue.push(event), routedProfileOverride),
      options,
      initialPrds: orderedPrds,
      extensionRegistry: this.extensionRegistry,
      profileUsageProvider: this.profileUsageProvider,
      configDir: schedulerConfigDir,
    });

    // Wire the inject callback BEFORE yielding queue:start so callers that
    // want to inject immediately upon receiving the first event can do so.
    // HTTP routes use this to wake the scheduler without relying on fs.watch.
    options.onInjectEventRegister?.((event) => bus.emit(event.type, event));

    // Register the scheduler control handle so the daemon can pause/resume
    // new PRD launches without aborting the watcher generator.
    options.onSchedulerControlRegister?.({
      pause: () => scheduler.pause(),
      resume: () => scheduler.resume(),
      isAlive: () => !abortController.signal.aborted,
    });

    yield {
      timestamp: new Date().toISOString(),
      type: 'queue:start',
      prdCount: orderedPrds.length,
      dir: queueDir,
    };

    // Watcher producer — keeps the consumer loop alive while the watcher is running.
    eventQueue.addProducer();

    // Clean shutdown on abort: remove bus listeners and release the watcher producer.
    // In-flight build producers drain naturally (their IIFEs complete independently).
    const onAbort = (): void => {
      bus.removeAllListeners();
      eventQueue.removeProducer();
    };

    if (abortController.signal.aborted) {
      onAbort();
    } else {
      abortController.signal.addEventListener('abort', onAbort, { once: true });
    }

    // Initial scan + launch ready PRDs.
    await scheduler.start();

    // Thin pump: emit scheduler-relevant events onto the bus BEFORE yielding
    // to the outer caller. This ensures QueueScheduler.onComplete() is queued
    // (as a microtask via the bus handler) before the consumer's synchronous
    // reaction runs. Any follow-up session:start / spawn events pushed by
    // onComplete() are enqueued into eventQueue asynchronously, so they still
    // appear after the completion event in the outer consumer's view — the
    // emit-before-yield ordering does NOT cause out-of-order events.
    for await (const event of eventQueue) {
      if (SCHEDULER_INPUT_TYPES.has(event.type)) {
        bus.emit(event.type, event);
      }
      yield event;
    }

    // Finalize: count blocked PRDs as skipped, then emit the terminal event.
    scheduler.finalizeBlockedAsSkipped();

    yield {
      timestamp: new Date().toISOString(),
      type: 'queue:complete',
      processed: scheduler.processed,
      skipped: scheduler.skipped,
    };
  }

  /**
   * Recover: analyse a failed build, emit a typed verdict, and write sidecar files.
   *
   * Orchestrates: PRD file read → buildFailureSummary → recovery-analyst agent →
   * writeRecoverySidecar. On any error (PRD missing, agent timeout, git failure),
   * still writes a sidecar with a degraded manual verdict so the caller always
   * receives an artifact. Never throws.
   *
   * When state.json is missing, synthesizes a partial summary from monitor.db events
   * and git history. Passes `partial: true` through to the verdict so the recovery
   * analyst and sidecar both indicate degraded context.
   */
  async *recover(setName: string, prdId: string, options: RecoveryOptions = {}): AsyncGenerator<EforgeEvent> {
    const cwd = options.cwd ?? this.cwd;
    const verbose = options.verbose;
    const abortController = options.abortController;

    const failedDir = resolve(cwd, this.config.prdQueue.dir, 'failed');
    const prdPath = join(failedDir, `${prdId}.md`);
    const dbPath = resolve(cwd, '.eforge', 'monitor.db');

    // Always emit recovery:start first
    yield { timestamp: new Date().toISOString(), type: 'recovery:start', prdId, setName };
    yield { timestamp: new Date().toISOString(), type: 'session:profile', profileName: this.configProfile.name, source: this.configProfile.source, scope: this.configProfile.scope, config: this.configProfile.config };
    for (const warning of this.startupWarnings()) {
      yield { timestamp: new Date().toISOString(), type: 'config:warning', message: warning.message, source: warning.source, details: warning.details };
    }

    try {
      // Try to read PRD file
      let prdContent: string | undefined;
      let prdMissingError: string | undefined;
      try {
        prdContent = await readFile(prdPath, 'utf-8');
      } catch {
        prdMissingError = `PRD file not found: ${prdPath}`;
      }

      if (prdMissingError !== undefined || prdContent === undefined) {
        // PRD missing — write degraded sidecar and return
        const summary: BuildFailureSummary = {
          prdId, setName,
          featureBranch: `eforge/${setName}`,
          baseBranch: 'main',
          plans: [],
          failingPlan: { planId: 'unknown' },
          landedCommits: [],
          diffStat: '',
          modelsUsed: [],
          failedAt: new Date().toISOString(),
          partial: true,
        };
        const verdict: RecoveryVerdict = {
          verdict: 'manual',
          confidence: 'low',
          rationale: 'Recovery failed: PRD file not found.',
          completedWork: [],
          remainingWork: [],
          risks: [],
          partial: true,
          recoveryError: prdMissingError ?? 'PRD file not found',
          recommendationSource: 'manual-fallback',
          recommendationRationale: 'PRD file not found; cannot perform automated recovery analysis.',
        };
        const continueRepairEvidence = await projectRecoverySidecarResumeEvidence({
          cwd,
          setName,
          prdId,
          outputDir: this.config.plan.outputDir,
          dbPath,
          ...(this.config.build.trunkBranch !== undefined ? { trunkBranch: this.config.build.trunkBranch } : {}),
          featureBranch: summary.featureBranch,
          baseBranch: summary.baseBranch,
          failureSummary: summary,
        });
        const { mdPath, jsonPath } = await writeRecoverySidecar({ failedPrdDir: failedDir, prdId, summary, verdict, continueRepairEvidence });
        yield {
          timestamp: new Date().toISOString(),
          type: 'recovery:complete',
          prdId,
          verdict,
          sidecarMdPath: mdPath,
          sidecarJsonPath: jsonPath,
        };
        return;
      }

      // Get failure summary (tolerates missing state.json via partial synthesis)
      let summary: BuildFailureSummary;
      try {
        summary = await buildFailureSummary({ setName, prdId, cwd, dbPath, trunkBranch: this.config.build.trunkBranch });
      } catch {
        summary = {
          prdId, setName,
          featureBranch: `eforge/${setName}`,
          baseBranch: 'main',
          plans: [],
          failingPlan: { planId: 'unknown' },
          landedCommits: [],
          diffStat: '',
          modelsUsed: [],
          failedAt: new Date().toISOString(),
          partial: true,
        };
      }

      // Get recovery-analyst harness and config
      const harness = this.agentRuntimes.forRole('recovery-analyst');
      const agentConfig = resolveAgentConfig('recovery-analyst', this.config);

      // Run recovery analyst — collect verdict or error
      let verdictResult: RecoveryVerdict | null = null;
      let parseError: string | undefined;
      let agentError: string | undefined;

      const continueRepairEvidence = await projectRecoverySidecarResumeEvidence({
        cwd,
        setName,
        prdId,
        outputDir: this.config.plan.outputDir,
        dbPath,
        ...(this.config.build.trunkBranch !== undefined ? { trunkBranch: this.config.build.trunkBranch } : {}),
        featureBranch: summary.featureBranch,
        baseBranch: summary.baseBranch,
        failureSummary: summary,
      });
      const deterministicRec = determineRecoveryRecommendation(summary, continueRepairEvidence.continueRepairEligibility);

      try {
        for await (const event of runRecoveryAnalyst({
          ...agentConfig,
          harness,
          prdContent,
          summary,
          deterministicRecommendation: deterministicRec,
          continueRepairEligibility: continueRepairEvidence.continueRepairEligibility,
          prdId,
          cwd,
          verbose,
          abortController,
          phase: 'standalone',
        })) {
          if (event.type === 'recovery:complete') {
            // Collect the verdict; we will re-emit recovery:complete with sidecar paths below
            verdictResult = event.verdict;
          } else if (event.type === 'recovery:error') {
            parseError = event.error;
            yield event;
          } else {
            yield event;
          }
        }
      } catch (err) {
        agentError = err instanceof Error ? err.message : String(err);
      }

      // Determine final verdict using deterministic recommendation + analyst output
      const verdict: RecoveryVerdict = selectFinalVerdict({
        deterministicRecommendation: deterministicRec,
        analystVerdict: verdictResult,
        analystError: agentError,
        parseError,
        summary,
      });

      // Write sidecar files
      const { mdPath, jsonPath } = await writeRecoverySidecar({
        failedPrdDir: failedDir,
        prdId,
        summary,
        verdict,
        continueRepairEvidence,
      });

      // Emit final recovery:complete with sidecar paths
      yield {
        timestamp: new Date().toISOString(),
        type: 'recovery:complete',
        prdId,
        verdict,
        sidecarMdPath: mdPath,
        sidecarJsonPath: jsonPath,
      };

    } catch (err) {
      // Last-resort outer catch — write degraded sidecar even if something unexpected fails
      const errMsg = err instanceof Error ? err.message : String(err);
      try {
        const summary: BuildFailureSummary = {
          prdId, setName,
          featureBranch: `eforge/${setName}`,
          baseBranch: 'main',
          plans: [],
          failingPlan: { planId: 'unknown' },
          landedCommits: [],
          diffStat: '',
          modelsUsed: [],
          failedAt: new Date().toISOString(),
          partial: true,
        };
        const verdict: RecoveryVerdict = {
          verdict: 'manual',
          confidence: 'low',
          rationale: 'Recovery process failed unexpectedly.',
          completedWork: [],
          remainingWork: [],
          risks: [],
          partial: true,
          recoveryError: errMsg,
          recommendationSource: 'manual-fallback',
          recommendationRationale: 'Recovery process failed unexpectedly; cannot perform automated recovery analysis.',
        };
        const continueRepairEvidence = await projectRecoverySidecarResumeEvidence({
          cwd,
          setName,
          prdId,
          outputDir: this.config.plan.outputDir,
          dbPath,
          ...(this.config.build.trunkBranch !== undefined ? { trunkBranch: this.config.build.trunkBranch } : {}),
          featureBranch: summary.featureBranch,
          baseBranch: summary.baseBranch,
          failureSummary: summary,
        });
        const { mdPath, jsonPath } = await writeRecoverySidecar({ failedPrdDir: failedDir, prdId, summary, verdict, continueRepairEvidence });
        yield {
          timestamp: new Date().toISOString(),
          type: 'recovery:complete',
          prdId,
          verdict,
          sidecarMdPath: mdPath,
          sidecarJsonPath: jsonPath,
        };
      } catch {
        // Best-effort — if even sidecar write fails, emit recovery:error
        yield {
          timestamp: new Date().toISOString(),
          type: 'recovery:error',
          prdId,
          error: errMsg,
        };
      }
    }
  }

  /**
   * Apply the recovery verdict for a failed build plan.
   *
   * Reads the recovery sidecar JSON written by `recover()`, validates the verdict,
   * and dispatches to one of four verdict-specific helpers:
   *   - retry: prepares recovery guidance, then moves the failed PRD back to the queue and removes sidecars
   *   - continue-repair: prepares recovery guidance, then queues the failed PRD through the compiled-artifact repair path
   *   - abandon: removes the failed PRD and both sidecars
   *   - manual: no-op, returns noAction: true
   *
   * Queue mutations are filesystem-only. Retry and continue-and-repair may also
   * create a tracked compiled-plan guidance commit. Throws on missing sidecar,
   * validation failure, or retry/continue-and-repair guidance eligibility failure.
   */
  async *applyRecovery(
    prdId: string,
    _options?: ApplyRecoveryOptions,
  ): AsyncGenerator<EforgeEvent, ApplyRecoveryResult> {
    const cwd = this.cwd;

    // Validate path segment — reject values containing path separators or traversal
    if (
      !prdId ||
      prdId.includes('/') ||
      prdId.includes('\\') ||
      prdId.includes('..')
    ) {
      throw new Error('Invalid prdId: must not contain path separators or traversal sequences');
    }

    const queueRelDir = this.config.prdQueue.dir;
    const queueDir = resolve(cwd, queueRelDir);
    const failedDir = join(queueDir, 'failed');
    const sidecarJsonPath = join(failedDir, `${prdId}.recovery.json`);

    yield {
      timestamp: new Date().toISOString(),
      type: 'recovery:apply:start',
      prdId,
    };
    yield { timestamp: new Date().toISOString(), type: 'session:profile', profileName: this.configProfile.name, source: this.configProfile.source, scope: this.configProfile.scope, config: this.configProfile.config };
    for (const warning of this.startupWarnings()) {
      yield { timestamp: new Date().toISOString(), type: 'config:warning', message: warning.message, source: warning.source, details: warning.details };
    }

    try {
      // Read the recovery sidecar JSON
      let rawJson: string;
      try {
        rawJson = await readFile(sidecarJsonPath, 'utf-8');
      } catch {
        throw new Error(`Recovery sidecar not found for ${prdId}; run recover() first`);
      }

      // Parse and validate the current v3 sidecar; derive decision attribution
      // from bounded evidence.
      const projectedSidecar = projectRecoverySidecar(parseRecoverySidecarPayload(rawJson, prdId));
      const failingPlanId = projectedSidecar.summary.failingPlan?.planId ?? prdId;
      const verdict = projectedSidecar.verdict;

      const helperOptions = {
        cwd,
        prdId,
        queueDir,
        outputDir: this.config.plan.outputDir,
        dbPath: resolve(cwd, '.eforge', 'monitor.db'),
        ...(this.config.build.trunkBranch !== undefined ? { trunkBranch: this.config.build.trunkBranch } : {}),
      };

      let result: ApplyRecoveryResult;

      switch (verdict.verdict) {
        case 'retry': {
          const { commitSha, detail } = await applyRecoveryRetry(helperOptions);
          result = {
            verdict: 'retry',
            noAction: false,
            commitSha,
            ...(detail !== undefined ? { detail } : {}),
          };
          break;
        }
        case 'continue-repair': {
          const { commitSha, status, detail } = await applyRecoveryContinueRepair(helperOptions);
          result = {
            verdict: 'continue-repair',
            noAction: false,
            commitSha,
            status: status === 'already-queued' ? 'already-applied' : 'applied',
            detail,
          };
          break;
        }
        case 'abandon': {
          const { commitSha } = await applyRecoveryAbandon(helperOptions);
          result = { verdict: 'abandon', noAction: false, commitSha };
          break;
        }
        case 'manual': {
          await applyRecoveryManual(helperOptions);
          result = { verdict: 'manual', noAction: true };
          break;
        }
        default: {
          // TypeScript exhaustiveness guard
          const _never: never = verdict.verdict;
          throw new Error(`Unknown verdict: ${_never}`);
        }
      }

      yield {
        timestamp: new Date().toISOString(),
        type: 'recovery:apply:complete',
        prdId,
        verdict: result.verdict,
        noAction: result.noAction,
      };

      // Emit recovery-verdict decision attributed to the failing plan
      yield emitBuildDecisionForPlan(failingPlanId, {
        kind: 'recovery-verdict',
        verdict: result.verdict,
        rationale: verdict.rationale,
      });

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      yield {
        timestamp: new Date().toISOString(),
        type: 'recovery:apply:error',
        prdId,
        message,
      };
      throw err;
    }
  }

  /**
   * Resume a compiled build that previously failed.
   *
   * Checks eligibility (feature branch, orchestration.yaml, failure evidence),
   * reconstructs plan state from monitor DB and git history, seeds the orchestrator
   * with merged/pending plan statuses, and runs the existing build pipeline without
   * invoking any compile/planner stages.
   *
   * Emits: build:resume:start → build:resume:state OR build:resume:ineligible →
   *        build:resume:artifacts → (build pipeline events) → build:resume:complete
   */
  async *resumeBuild(
    prdId: string,
    options: {
      setName?: string;
      featureBranch?: string;
      baseBranch?: string;
      cwd?: string;
      verbose?: boolean;
      abortController?: AbortController;
      schedulerOwned?: boolean;
      landingAction?: 'pr' | 'merge' | 'leave';
      landingAutoMerge?: boolean;
    } = {},
  ): AsyncGenerator<EforgeEvent> {
    const cwd = options.cwd ?? this.cwd;
    const dbPath = resolve(cwd, '.eforge', 'monitor.db');

    // Validate path segment — reject values containing path separators or traversal
    // before any prdId-derived filesystem path is constructed.
    if (
      !prdId ||
      prdId.includes('/') ||
      prdId.includes('\\') ||
      prdId.includes('..')
    ) {
      throw new Error('Invalid prdId: must not contain path separators or traversal sequences');
    }

    // Resolve setName from sidecar when not provided — ensures featureBranch and worktree
    // paths match the original build when setName differs from prdId.
    let setName = options.setName;
    if (!setName) {
      const { resolveResumeSetName } = await import('./resume/compiled-build.js');
      const failedDir = join(resolve(cwd, this.config.prdQueue.dir), 'failed');
      setName = await resolveResumeSetName({ prdId, failedDir });
    }
    const featureBranch = options.featureBranch ?? `eforge/${setName}`;
    const baseBranch = options.baseBranch;
    const mergeWorktreePath = join(computeWorktreeBase(cwd, setName), '__merge__');

    const ts = () => new Date().toISOString();

    // Emit profile info upfront unless the queue scheduler already emitted it.
    if (!options.schedulerOwned) {
      yield { timestamp: ts(), type: 'session:profile', profileName: this.configProfile.name, source: this.configProfile.source, scope: this.configProfile.scope, config: this.configProfile.config };
    }
    for (const warning of this.startupWarnings()) {
      yield { timestamp: ts(), type: 'config:warning', message: warning.message, source: warning.source, details: warning.details };
    }

    // Delegate to the existing build pipeline, passing resume seed
    // to suppress compile phases and seed orchestrator state.
    const runId = randomUUID();
    let status: 'completed' | 'failed' = 'completed';
    let buildSummary = 'Continue-and-repair complete';
    const terminalTracker = createBuildTerminalFailureTracker(runId);
    let tracing: ReturnType<typeof createTracingContext> | undefined;
    let queuedResumeStarted = false;
    let queuedResumeFinalized = false;
    let resumeActivationReached = false;
    let queuedResumeFinalizationFailure: string | undefined;

    try {
      validatePlanSetName(setName);
      tracing = createTracingContext(this.config, runId, 'continue-repair', setName);

      yield { type: 'phase:start', runId, planSet: setName, command: 'continue-repair', timestamp: ts() };
      tracing.setInput({ planSet: setName, prdId, resumeMode: true });

      if (!options.schedulerOwned) {
        const queueResumeStart = await beginQueuedResume({ cwd, prdId, queueDir: this.config.prdQueue.dir });
        if (queueResumeStart.status === 'blocked') {
          status = 'failed';
          buildSummary = queueResumeStart.reason;
          yield { timestamp: ts(), type: 'build:resume:ineligible', reason: queueResumeStart.reason };
          return;
        }
        queuedResumeStarted = queueResumeStart.status === 'started';
      }

      // Eligibility check runs inside the phase so failures are correlated with runId.
      const { checkResumeEligibility, deriveResumeSeedState, formatResumeContext, buildResumeArtifactsProjection, resolveResumePrdContent } = await import('./resume/compiled-build.js');
      let eligibility = await checkResumeEligibility({
        cwd, setName, prdId, mergeWorktreePath,
        outputDir: this.config.plan.outputDir, dbPath,
        trunkBranch: baseBranch ?? this.config.build.trunkBranch,
        featureBranch,
        ...(baseBranch !== undefined ? { baseBranch } : {}),
      });

      if (!eligibility.eligible) {
        status = 'failed';
        buildSummary = eligibility.reason;
        yield {
          timestamp: ts(), type: 'build:resume:ineligible', reason: eligibility.reason,
          ...(eligibility.checkedPath ? { checkedPath: eligibility.checkedPath } : {}),
        };
        return;
      }

      const { prepareRecoveryGuidance, recoveryGuidanceResumeBlocker } = await import('./recovery/guidance.js');
      let recoveryGuidance: Awaited<ReturnType<typeof prepareRecoveryGuidance>>;
      try {
        recoveryGuidance = await prepareRecoveryGuidance({
          cwd,
          prdId,
          setName,
          featureBranch,
          queueDir: this.config.prdQueue.dir,
          outputDir: this.config.plan.outputDir,
          dbPath,
          trunkBranch: baseBranch ?? this.config.build.trunkBranch,
          ...(baseBranch !== undefined ? { baseBranch } : {}),
        });
      } catch (err) {
        const reason = `Recovery guidance could not be prepared: ${(err as Error).message}`;
        status = 'failed';
        buildSummary = reason;
        yield { timestamp: ts(), type: 'build:resume:ineligible', reason };
        return;
      }
      const recoveryGuidanceBlocker = recoveryGuidanceResumeBlocker(recoveryGuidance);
      if (recoveryGuidanceBlocker) {
        status = 'failed';
        buildSummary = recoveryGuidanceBlocker;
        yield { timestamp: ts(), type: 'build:resume:ineligible', reason: recoveryGuidanceBlocker };
        return;
      }
      if (recoveryGuidance.commitSha !== undefined) {
        eligibility = await checkResumeEligibility({
          cwd, setName, prdId, mergeWorktreePath,
          outputDir: this.config.plan.outputDir, dbPath,
          trunkBranch: baseBranch ?? this.config.build.trunkBranch,
          featureBranch,
          ...(baseBranch !== undefined ? { baseBranch } : {}),
        });
        if (!eligibility.eligible) {
          status = 'failed';
          buildSummary = eligibility.reason;
          yield {
            timestamp: ts(), type: 'build:resume:ineligible', reason: eligibility.reason,
            ...(eligibility.checkedPath ? { checkedPath: eligibility.checkedPath } : {}),
          };
          return;
        }
      }

      const { summary, diffStat, artifactBasePath } = eligibility;

      resumeActivationReached = true;
      yield { timestamp: ts(), type: 'build:resume:start', prdId, setName, featureBranch };

      // Orchestration artifacts are read from the recreated merge worktree when
      // present, or from a read-only recovery copy materialized from branch history.
      const planBaseCwd = artifactBasePath;
      const configPath = resolve(planBaseCwd, this.config.plan.outputDir, setName, 'orchestration.yaml');

      const validation = await validatePlanSet(configPath);
      if (!validation.valid) {
        status = 'failed';
        buildSummary = `Plan set validation failed: ${validation.errors.join('; ')}`;
        return;
      }

      const orchConfig = await parseOrchestrationConfig(configPath);
      if (baseBranch !== undefined && orchConfig.baseBranch !== baseBranch) {
        orchConfig.baseBranch = baseBranch;
      }
      for (const warning of orchConfig.warnings ?? []) {
        yield { timestamp: ts(), type: 'planning:warning', message: warning, source: 'parseOrchestrationConfig' };
      }

      const planDir = resolve(planBaseCwd, this.config.plan.outputDir, setName);
      const planFileMap = new Map<string, PlanFile>();
      for (const plan of orchConfig.plans) {
        const planFilePath = resolve(planDir, `${plan.id}.md`);
        if (!existsSync(planFilePath)) {
          status = 'failed';
          buildSummary = `Missing plan markdown: ${plan.id}.md`;
          yield {
            timestamp: ts(), type: 'build:resume:ineligible',
            reason: `plan markdown file not found: ${plan.id}.md`,
            checkedPath: planFilePath,
          };
          return;
        }
        const planFile = await parsePlanFile(planFilePath);
        for (const warning of planFile.warnings ?? []) {
          yield { timestamp: ts(), type: 'planning:warning', planId: plan.id, message: warning, source: 'parsePlanFile' };
        }
        planFileMap.set(plan.id, planFile);
      }

      const allowedResumePlanIds = new Set(orchConfig.plans.map((plan) => plan.id));
      const { seededMerged, seededPending } = deriveResumeSeedState(summary.plans, allowedResumePlanIds);
      yield {
        timestamp: ts(), type: 'build:resume:state',
        seededMerged, seededPending, featureBranch,
        landedCommitCount: summary.landedCommits.length, diffStat,
      };

      // Build per-plan resume context map for builder prompt injection
      const resumeContextByPlan = new Map<string, string>();
      for (const planId of seededPending) {
        resumeContextByPlan.set(planId, formatResumeContext({ planId, summary, seededMerged, seededPending }));
      }

      const resolvedResumePrdContent = await resolveResumePrdContent({
        cwd,
        prdId,
        setName,
        featureBranch,
        summaryPrdContent: summary.prdContent,
      });

      yield { timestamp: ts(), type: 'build:resume:artifacts', ...(await buildResumeArtifactsProjection({ cwd, prdId, setName, featureBranch, artifactSource: eligibility.artifactSource, ...(eligibility.artifactCommit !== undefined ? { artifactCommit: eligibility.artifactCommit } : {}), summary, orchConfig, planFileMap })) };

      const config = this.config;
      const agentRuntimes = this.agentRuntimes;
      const verbose = options.verbose;
      const abortController = options.abortController;
      const extensionReviewerPerspectives = this.extensionRegistry.reviewerPerspectives;
      const extensionValidationProviders = this.extensionRegistry.validationProviders;
      const buildPipeline = orchConfig.pipeline;

      const planRunner = async function* (
        planId: string,
        worktreePath: string,
      ): AsyncGenerator<EforgeEvent> {
        const planFile = planFileMap.get(planId);
        if (!planFile) {
          yield { timestamp: new Date().toISOString(), type: 'plan:build:failed', planId, error: `Plan file not found: ${planId}` };
          return;
        }

        const planEntry = orchConfig.plans.find((p) => p.id === planId)!;
        let planBuild: BuildStageSpec[] = planEntry.build;
        let planReview: ReviewProfileConfig = planEntry.review;

        const builderShards = planFile.agents?.['builder']?.shards;
        const guardResult = applyShardedPlanGuard(planBuild, planReview, builderShards);
        planBuild = guardResult.planBuild;
        planReview = guardResult.planReview;
        for (const item of guardResult.injected) {
          yield {
            timestamp: new Date().toISOString(),
            type: 'plan:build:progress',
            planId,
            message: `Runtime guard: injected ${item} into sharded plan (shards do not self-verify; review-cycle is the integration gate)`,
          };
        }

        const buildCtx: BuildStageContext = {
          agentRuntimes,
          config,
          pipeline: buildPipeline,
          tracing: tracing!,
          cwd: worktreePath,
          planSetName: setName,
          sourceContent: '',
          verbose,
          abortController,
          modelTracker: new ModelTracker(),
          plans: Array.from(planFileMap.values()),
          expeditionModules: [],
          moduleBuildConfigs: new Map(),
          planId,
          worktreePath,
          planFile,
          orchConfig,
          planEntry,
          reviewIssues: [],
          build: planBuild,
          review: planReview,
          extensionReviewerPerspectives,
          extensionValidationProviders,
          resumeContext: resumeContextByPlan.get(planId),
        };

        yield* runBuildPipeline(buildCtx);
      };

      // Validation fixer closure
      const validationFixer: ValidationFixer = async function* (fixerCwd, failures, attempt, maxAttempts, lane) {
        const fixerSpan = tracing!.createSpan('validation-fixer', { attempt, maxAttempts });
        fixerSpan.setInput({ failures: failures.map((f) => f.command) });
        const fixerTracker = createToolTracker(fixerSpan);
        try {
          const validationFixerConfig = resolveAgentConfig('validation-fixer', config);
          for await (const event of runValidationFixer({
            ...validationFixerConfig,
            cwd: fixerCwd,
            failures,
            attempt,
            maxAttempts,
            verbose,
            abortController,
            phase: 'standalone',
            harness: agentRuntimes.forRole('validation-fixer'),
            lane,
          })) {
            fixerTracker.handleEvent(event);
            yield event;
          }
          fixerTracker.cleanup();
          fixerSpan.end();
        } catch (err) {
          fixerTracker.cleanup();
          fixerSpan.error(err as Error);
        }
      };

      // Merge conflict resolver closure
      const mergeEvents: EforgeEvent[] = [];
      const mergeEventSink = (event: EforgeEvent) => { mergeEvents.push(event); };

      const mergeResolver: MergeResolver = async (resolverCwd, conflict) => {
        const resolverSpan = tracing!.createSpan('merge-conflict-resolver', {
          branch: conflict.branch,
          files: conflict.conflictedFiles,
        });
        const resolverTracker = createToolTracker(resolverSpan);
        let resolved = false;
        try {
          const mergeResolverConfig = resolveAgentConfig('merge-conflict-resolver', config);
          for await (const event of runMergeConflictResolver({
            ...mergeResolverConfig,
            cwd: resolverCwd,
            conflict,
            verbose,
            abortController,
            phase: 'standalone',
            harness: agentRuntimes.forRole('merge-conflict-resolver'),
          })) {
            resolverTracker.handleEvent(event);
            mergeEventSink(event);
            if (event.type === 'plan:merge:resolve:complete') {
              resolved = event.resolved;
            }
          }
          resolverTracker.cleanup();
          resolverSpan.end();
        } catch (err) {
          resolverTracker.cleanup();
          resolverSpan.error(err as Error);
        }
        return resolved;
      };

      const validationPolicy = this.config.build.validation;
      const {
        prdValidator,
        acceptanceUnknownResolver,
        gapCloser,
        expectedAcceptanceCriteria,
      } = await createPrdValidationWiring({
        cwd,
        config,
        agentRuntimes,
        tracing: tracing!,
        planSetName: setName,
        orchConfig,
        planFileMap,
        buildPipeline,
        verbose,
        abortController,
        ...(options.schedulerOwned && resolvedResumePrdContent !== undefined ? { prdContent: resolvedResumePrdContent.content, prdSourceLabel: resolvedResumePrdContent.label, allowInventoryFallback: true } : {}),
      });

      const signal = abortController?.signal;
      const shouldCleanup = this.config.build.cleanupPlanFiles;
      const effectiveLandingAction = options.landingAction ?? this.config.landing.action;
      if (options.landingAutoMerge === true && effectiveLandingAction !== 'pr') {
        status = 'failed';
        buildSummary = `landingAutoMerge: true is only valid when the effective landing action is 'pr' (got '${effectiveLandingAction}')`;
        return;
      }

      // Build the resume seed for the orchestrator
      const resumeSeed = { seededMerged, resumeContextByPlan };

      const orchestrator = new Orchestrator({
        repoRoot: cwd,
        planRunner,
        signal,
        postMergeCommands: config.build.postMergeCommands,
        validateCommands: orchConfig.validate,
        postMergeCommandTimeoutMs: config.build.postMergeCommandTimeoutMs,
        validationFixer,
        maxValidationRetries: config.build.maxValidationRetries,
        mergeResolver,
        prdValidator,
        acceptanceUnknownResolver,
        gapCloser,
        mergeWorktreePath,
        shouldCleanup,
        cleanupPlanSet: setName,
        cleanupOutputDir: this.config.plan.outputDir,
        extensionRegistry: this.extensionRegistry,
        policyGateTimeoutMs: this.config.extensions.policyGateTimeoutMs,
        policyGateFailurePolicy: this.config.extensions.policyGateFailurePolicy,
        engineConfig: config,
        landingAction: effectiveLandingAction,
        prAutoMergePolicy: this.config.landing.pr.autoMerge,
        ...(options.landingAutoMerge !== undefined && { landingAutoMerge: options.landingAutoMerge }),
        validationPolicy,
        expectedAcceptanceCriteria,
        resumeSeed,
        prdId,
      });

      for await (const event of orchestrator.execute(orchConfig)) {
        while (mergeEvents.length > 0) {
          yield mergeEvents.shift()!;
        }
        yield event;
        terminalTracker.observe(event);
        if (event.type === 'plan:build:failed') { status = 'failed'; buildSummary = event.error.startsWith('Merge failed') ? `Merge failed for ${event.planId}` : `Build failed for ${event.planId}`; }
        if (event.type === 'validation:complete') { status = event.passed ? 'completed' : 'failed'; buildSummary = event.passed ? 'Continue-and-repair complete' : 'Post-merge validation failed'; }
        if (event.type === 'prd_validation:complete') {
          if (!event.passed) {
            status = 'failed';
            buildSummary = `PRD validation failed: ${event.gaps.length} gap(s) found`;
          }
        }
        if (event.type === 'acceptance_validation:complete') {
          const failCount = event.verdicts.filter((v) => v.verdict !== 'pass').length;
          const hasWaiver = (event.waivers ?? []).some((waiver) => waiver.trim().length > 0);
          if (!event.passed || (failCount > 0 && !hasWaiver)) {
            status = 'failed';
            buildSummary = formatAcceptanceFailureSummary(event.verdicts, event.acceptanceConflicts);
          }
        }
        if (event.type === 'daemon:error' && event.source === 'stack:artifact-recording') {
          status = 'failed';
          buildSummary = event.message;
        }
        if (event.type === 'stack:landing:update' && event.status === 'failed') {
          status = 'failed';
          buildSummary = event.reason ? `Stack landing failed: ${event.reason}` : 'Stack landing failed';
        }
        if (event.type === 'landing:skipped') {
          status = 'failed';
          buildSummary = event.reason ? `Landing skipped: ${event.reason}` : 'Landing skipped';
        }
      }

      while (mergeEvents.length > 0) {
        yield mergeEvents.shift()!;
      }

      if (status === 'completed' && queuedResumeStarted) {
        const queueResumeFinalization = await finalizeQueuedResumeSuccess({ cwd, prdId, queueDir: this.config.prdQueue.dir });
        if (queueResumeFinalization.status === 'completed') {
          queuedResumeFinalized = true;
        } else if (queueResumeFinalization.status === 'blocked') {
          status = 'failed';
          buildSummary = queueResumeFinalization.reason;
          queuedResumeFinalizationFailure = queueResumeFinalization.reason;
        }
      }

    } catch (err) {
      status = 'failed';
      buildSummary = (err as Error).message;
    } finally {
      if (queuedResumeStarted && !queuedResumeFinalized) {
        try {
          const rollback = await rollbackQueuedResume({ cwd, prdId, queueDir: this.config.prdQueue.dir });
          if (rollback.status === 'blocked') {
            status = 'failed';
            buildSummary = `Continue-and-repair rollback blocked: ${rollback.reason}`;
          } else if (rollback.status === 'rolled-back' && resumeActivationReached) {
            await finalizeFailedQueuedResumeSidecars({ cwd, queueDir: this.config.prdQueue.dir, prdId, setName, featureBranch, baseBranch: baseBranch ?? this.config.build.trunkBranch ?? 'main', trunkBranch: this.config.build.trunkBranch, agentRuntimes: this.agentRuntimes, config: this.config, verbose: options.verbose, abortController: options.abortController, activationReached: true, resumeRunId: runId, ...(queuedResumeFinalizationFailure !== undefined ? { degradedReason: queuedResumeFinalizationFailure } : {}) });
          }
        } catch (err) {
          status = 'failed';
          buildSummary = `Continue-and-repair rollback failed: ${(err as Error).message}`;
        }
      }
      tracing?.setOutput({ status, summary: buildSummary });
      const terminalEvt = terminalTracker.toEvent(status, buildSummary);
      if (terminalEvt) yield terminalEvt;
      yield {
        type: 'phase:end',
        runId,
        result: { status, summary: buildSummary },
        timestamp: ts(),
      };
      await tracing?.flush();
    }

    if (status === 'completed') {
      yield {
        timestamp: ts(),
        type: 'build:resume:complete',
        prdId,
        setName,
      };
    }
  }

  /**
   * Status: returns idle shape. Active build state lives in memory only;
   * daemon-mode running-build signal comes from the monitor REST API.
   */
  status(): EforgeStatus {
    return {
      running: false,
      plans: {},
      completedPlans: [],
    };
  }
}

/**
 * Deep-merge config overrides onto base config.
 */
function mergeConfig(base: EforgeConfig, overrides: Partial<EforgeConfig>): EforgeConfig {
  const landing = overrides.landing ? { ...base.landing, ...overrides.landing } : { ...base.landing };
  const build = overrides.build ? { ...base.build, ...overrides.build } : { ...base.build };

  return {
    maxConcurrentBuilds: overrides.maxConcurrentBuilds ?? base.maxConcurrentBuilds,
    langfuse: overrides.langfuse ? { ...base.langfuse, ...overrides.langfuse } : base.langfuse,
    compile: overrides.compile ? { ...base.compile, ...overrides.compile } : base.compile,
    agents: overrides.agents ? { ...base.agents, ...overrides.agents } : base.agents,
    build,
    plan: overrides.plan ? { ...base.plan, ...overrides.plan } : base.plan,
    plugins: overrides.plugins ? { ...base.plugins, ...overrides.plugins } : base.plugins,
    extensions: overrides.extensions ? { ...base.extensions, ...overrides.extensions } : base.extensions,
    prdQueue: overrides.prdQueue ? { ...base.prdQueue, ...overrides.prdQueue } : base.prdQueue,
    daemon: overrides.daemon ? { ...base.daemon, ...overrides.daemon } : base.daemon,
    monitor: overrides.monitor ? { ...base.monitor, ...overrides.monitor } : base.monitor,
    hooks: overrides.hooks ?? base.hooks,
    tools: overrides.tools ? { ...base.tools, ...overrides.tools, toolbelts: { ...base.tools.toolbelts, ...overrides.tools.toolbelts } } : base.tools,
    stacking: overrides.stacking ? { ...base.stacking, ...overrides.stacking } : base.stacking,
    landing,
  };
}

/**
 * Load project MCP server configs from .mcp.json in the given directory.
 * Returns the mcpServers record, or undefined if no .mcp.json exists.
 * The returned map is the unfiltered source of truth for project MCP servers;
 * per-tier filtering based on toolbelt config is applied later in the registry.
 */
async function loadProjectMcpServers(cwd: string): Promise<ClaudeSDKHarnessOptions['mcpServers'] | undefined> {
  const mcpPath = resolve(cwd, '.mcp.json');
  let content: string;
  try {
    content = await readFile(mcpPath, 'utf-8');
  } catch {
    // No .mcp.json — fine, MCP is optional
    return undefined;
  }

  try {
    const raw = JSON.parse(content);
    if (raw?.mcpServers && typeof raw.mcpServers === 'object' && !Array.isArray(raw.mcpServers)) {
      // Filter the eforge MCP server to prevent orphaned daemons in agent worktrees
      delete raw.mcpServers['eforge'];
      return raw.mcpServers;
    }
  } catch {
    // Malformed .mcp.json — warn but don't crash
    process.stderr.write(`Warning: failed to parse ${mcpPath}, MCP servers not loaded\n`);
  }
  return undefined;
}

/**
 * Discover Claude Code plugins from ~/.claude/plugins/installed_plugins.json.
 * Loads user-scoped plugins (global) and project-scoped plugins matching the cwd.
 * Applies include/exclude filters and appends manual paths from config.
 */
async function loadPlugins(cwd: string, pluginConfig: PluginConfig): Promise<SdkPluginConfig[] | undefined> {
  if (!pluginConfig.enabled) return undefined;

  const plugins: SdkPluginConfig[] = [];

  // Auto-discover from installed_plugins.json
  const installedPath = resolve(homedir(), '.claude/plugins/installed_plugins.json');
  let installedContent: string | undefined;
  try {
    installedContent = await readFile(installedPath, 'utf-8');
  } catch {
    // No installed plugins file — fine, plugins are optional
  }

  if (installedContent) {
    try {
      const data = JSON.parse(installedContent);
      if (data?.plugins && typeof data.plugins === 'object' && !Array.isArray(data.plugins)) {
        for (const [id, entries] of Object.entries(data.plugins)) {
          // Skip the eforge plugin itself to prevent orphaned daemons in agent worktrees
          if (id.startsWith('eforge@')) continue;

          // Find first matching entry — plugins may have multiple entries (e.g., user + project scope)
          if (!Array.isArray(entries)) continue;
          for (const entry of entries as Array<Record<string, unknown>>) {
            if (!entry || typeof entry.scope !== 'string' || typeof entry.installPath !== 'string') continue;

            // Include user-scoped (global) and project-scoped plugins matching cwd
            if (entry.scope === 'project') {
              if (typeof entry.projectPath !== 'string') continue;
              const normalizedProject = entry.projectPath.endsWith('/') ? entry.projectPath : entry.projectPath + '/';
              if (cwd !== entry.projectPath && !cwd.startsWith(normalizedProject)) continue;
            } else if (entry.scope !== 'user') {
              continue;
            }

            // Apply include/exclude filters
            if (pluginConfig.include && !pluginConfig.include.includes(id)) break;
            if (pluginConfig.exclude?.includes(id)) break;

            plugins.push({ type: 'local', path: entry.installPath as string });
            break;
          }
        }
      }
    } catch {
      process.stderr.write(`Warning: failed to parse ${installedPath}, plugins not loaded\n`);
    }
  }

  // Append manual paths
  if (pluginConfig.paths) {
    for (const p of pluginConfig.paths) {
      plugins.push({ type: 'local', path: p });
    }
  }

  return plugins.length > 0 ? plugins : undefined;
}
