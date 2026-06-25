import {
  EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT,
  EforgePlanPlanningDraftResultSchema,
  parseEforgePlanPlanningDraftResult,
  safeParseExtensionAgentTaskStartRequest,
  safeParseWithSchema,
  normalizeExtensionAgentTaskStartRequest,
  type EforgePlanPlanningDraftResult,
  type ExtensionAgentTaskCancelResponse,
  type ExtensionAgentTaskGetResponse,
  type ExtensionAgentTaskBacklogCurationProgress,
  type ExtensionAgentTaskRequestedBy,
  type ExtensionAgentTaskSanitizedMetadata,
  type ExtensionAgentTaskStartRequest,
  type ExtensionAgentTaskStartResponse,
} from '@eforge-build/client';
import type { AgentRuntimeRegistry } from '@eforge-build/engine/agent-runtime-registry';
import type { AgentRole } from '@eforge-build/engine/events';
import type { NativeExtensionRegistry } from '@eforge-build/engine/extensions/index';
import type { MonitorContext } from '../../context.js';
import {
  emitAgentTaskCancelled,
  emitAgentTaskComplete,
  emitAgentTaskFailed,
  emitAgentTaskProgress,
  emitAgentTaskStart,
  sanitizeMetadata,
} from './agent-task-events.js';
import {
  buildBacklogCurationRuntimeIdentity,
  runBacklogCurationMapReduceTask,
  type BacklogCurationAgentTaskContributionHandle,
} from './backlog-curation-map-reduce-runner.js';
import {
  AgentTaskStoreError,
  assertValidAgentTaskId,
  createAgentTaskId,
  projectAgentTaskRecord,
  readAgentTaskRecord,
  writeAgentTaskRecord,
  type ExtensionAgentTaskOwner,
  type StoredExtensionAgentTaskRecord,
} from './agent-task-store.js';
import {
  countOutputSections,
  errorCodeFor,
  eventBase,
  findAgentTaskContribution,
  loadContributionPromptTemplate,
  loadNativeExtensionRegistry,
  logBackgroundTaskError,
  resolveAgentRuntimes,
  resolveContributionPrompt,
  runDeferredSourceProvider,
  sanitizeErrorMessage,
  sectionProgressMessage,
  sourceProviderItemAuditConcurrency,
  toCustomTool,
  validateContributionOutput,
  isEforgePlanCurationMapReduceTask,
  AgentTaskServiceError,
  type ContributionStartRequest,
  type ResolvedAgentTaskContributionStart,
  type ResolvedDeferredSourceInput,
  type SectionProgressUpdate,
} from './agent-task-service-helpers.js';

export { AgentTaskServiceError } from './agent-task-service-helpers.js';

type LegacyExtensionAgentTaskStartRequest = Extract<ExtensionAgentTaskStartRequest, { kind: typeof EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT }>;

export interface ExtensionAgentTaskStartOptions {
  owner?: ExtensionAgentTaskOwner;
  requestedBy?: ExtensionAgentTaskRequestedBy;
  registry?: NativeExtensionRegistry;
}

function isPlanningDraftOutputSchema(schema: unknown): boolean {
  return schema === EforgePlanPlanningDraftResultSchema || JSON.stringify(schema) === JSON.stringify(EforgePlanPlanningDraftResultSchema);
}

// --- eforge:region agent-task-service-class ---
export class ExtensionAgentTaskService {
  private readonly controllers = new Map<string, AbortController>();

  constructor(private readonly context: MonitorContext) {}

  async start(request: ExtensionAgentTaskStartRequest, options: ExtensionAgentTaskStartOptions = {}): Promise<ExtensionAgentTaskStartResponse> {
    const cwd = this.requireCwd();
    const parsed = safeParseExtensionAgentTaskStartRequest(request);
    if (!parsed.success) {
      throw new AgentTaskServiceError(`Invalid task start request: ${parsed.error.message}`, 400);
    }
    const validRequest = parsed.data;
    const contributionRequest = normalizeExtensionAgentTaskStartRequest(validRequest);
    const contribution = await this.resolveContributionStart(contributionRequest, options);
    if (!isPlanningDraftOutputSchema(contribution.contribution.value.outputSchema)) {
      throw new AgentTaskServiceError(`Task contribution ${contribution.contribution.id} cannot be started directly because it does not produce a planning draft result.`, 400);
    }
    const owner = contribution.owner;
    if (contribution.input.sourceProvider !== undefined && owner === undefined) {
      throw new AgentTaskServiceError('Deferred source providers require an extension owner', 400);
    }
    const now = new Date().toISOString();
    const taskId = createAgentTaskId();
    const metadata = sanitizeMetadata({ label: owner?.extensionName ?? 'extension agent task', progressMessage: 'Starting planner task' });
    const record: StoredExtensionAgentTaskRecord = {
      taskId,
      kind: EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      ...(metadata !== undefined && { metadata }),
      ...(owner !== undefined && { owner }),
    };
    await writeAgentTaskRecord(cwd, record);

    const controller = new AbortController();
    this.controllers.set(taskId, controller);
    emitAgentTaskStart(this.context, eventBase(record));
    queueMicrotask(() => {
      void this.runInBackground({ taskId, contribution, controller, startedAtMs: Date.now(), owner, registry: options.registry })
        .catch((err: unknown) => logBackgroundTaskError(taskId, err));
    });
    return { task: projectAgentTaskRecord(record) };
  }

  async get(taskId: string, owner?: ExtensionAgentTaskOwner): Promise<ExtensionAgentTaskGetResponse> {
    const record = await this.readExisting(taskId, owner);
    return { task: projectAgentTaskRecord(record) };
  }

  async cancel(taskId: string, reason?: string, owner?: ExtensionAgentTaskOwner): Promise<ExtensionAgentTaskCancelResponse> {
    const cwd = this.requireCwd();
    const record = await this.readExisting(taskId, owner);
    if (record.status === 'cancelled') return { task: projectAgentTaskRecord(record) };
    if (record.status !== 'running' && record.status !== 'queued') {
      throw new AgentTaskServiceError(`Task ${taskId} is not running`, 409);
    }

    this.controllers.get(taskId)?.abort();
    this.controllers.delete(taskId);
    const now = new Date().toISOString();
    const cancelled: StoredExtensionAgentTaskRecord = {
      ...record,
      status: 'cancelled',
      updatedAt: now,
      cancelledAt: now,
      ...(reason !== undefined && reason.trim().length > 0 && { errorMessage: sanitizeErrorMessage(reason) }),
    };
    await writeAgentTaskRecord(cwd, cancelled);
    emitAgentTaskCancelled(this.context, eventBase(cancelled), reason);
    return { task: projectAgentTaskRecord(cancelled) };
  }

  private async runInBackground(options: { taskId: string; contribution: ResolvedAgentTaskContributionStart; controller: AbortController; startedAtMs: number; owner?: ExtensionAgentTaskOwner; registry?: NativeExtensionRegistry }): Promise<void> {
    try {
      const result = await this.runContributionTask({ ...options, contribution: options.contribution });
      await this.complete(options.taskId, result, options.startedAtMs);
    } catch (err) {
      await this.failUnlessCancelled(options.taskId, err, options.startedAtMs, options.controller.signal.aborted);
    } finally {
      this.controllers.delete(options.taskId);
    }
  }

  private async resolveContributionStart(request: ContributionStartRequest, options: ExtensionAgentTaskStartOptions): Promise<ResolvedAgentTaskContributionStart> {
    const registry = options.registry ?? await loadNativeExtensionRegistry(this.requireCwd());
    return await this.resolveContributionFromRegistry(registry, request, request.input, options.owner);
  }

  private async resolveContributionFromRegistry(registry: NativeExtensionRegistry, request: ContributionStartRequest, input: Record<string, unknown>, owner?: ExtensionAgentTaskOwner): Promise<ResolvedAgentTaskContributionStart> {
    const contribution = findAgentTaskContribution(registry, request, owner);
    if (contribution === undefined) throw new AgentTaskServiceError(`Unknown task contribution: ${request.task.id}`, 404);
    if (contribution.availability !== undefined && contribution.availability.available === false) {
      throw new AgentTaskServiceError(contribution.availability.message ?? `Task contribution ${contribution.id} is unavailable`, 409);
    }
    const parsedInput = safeParseWithSchema(contribution.value.inputSchema as Parameters<typeof safeParseWithSchema>[0], input);
    if (!parsedInput.success) {
      throw new AgentTaskServiceError(`Task contribution input failed schema validation: ${parsedInput.error.message}`, 400);
    }
    const promptTemplate = await loadContributionPromptTemplate(contribution);
    return {
      contribution,
      owner: { extensionName: contribution.extensionName, extensionPath: contribution.extensionPath },
      input: parsedInput.data as Record<string, unknown>,
      promptTemplate,
    };
  }

  private async runContributionTask(options: { taskId: string; contribution: ResolvedAgentTaskContributionStart; controller: AbortController; owner?: ExtensionAgentTaskOwner; registry?: NativeExtensionRegistry }): Promise<EforgePlanPlanningDraftResult> {
    const cwd = this.requireCwd();
    const { loadConfig } = await import('@eforge-build/engine/config');
    const { resolveAgentConfig } = await import('@eforge-build/engine/pipeline');
    const { buildAgentRuntimeRegistry, singletonRegistry } = await import('@eforge-build/engine/agent-runtime-registry');
    const { runResolvedAgentTask } = await import('@eforge-build/engine/agents/resolved-agent-task');

    const { config, warnings } = await loadConfig(cwd);
    for (const warning of warnings) process.stderr.write(`${warning}\n`);
    const agentRuntimes = await resolveAgentRuntimes(this.context.options.agentRuntimes, config, buildAgentRuntimeRegistry, singletonRegistry);
    const { harness: resolverHarness, toolbeltSummary: plannerToolbeltSummary } = agentRuntimes.forRoleResolved('planner');
    const contribution = await this.resolveContributionDeferredSource(options);
    if (isEforgePlanCurationMapReduceTask(contribution.deferredSource, contribution.owner)) {
      const plannerConfig = resolveAgentConfig('planner', config, undefined, plannerToolbeltSummary);
      const curationContributions = await this.resolveBacklogCurationContributions({ owner: contribution.owner, registry: options.registry });
      return await runBacklogCurationMapReduceTask({
        ...plannerConfig,
        harness: resolverHarness,
        cwd,
        taskId: options.taskId,
        input: contribution.input as LegacyExtensionAgentTaskStartRequest['input'],
        sourceBundle: contribution.deferredSource.structuredSource,
        providerHooks: contribution.deferredSource.providerHooks,
        runtimeIdentity: buildBacklogCurationRuntimeIdentity(plannerConfig, plannerToolbeltSummary),
        itemAuditContribution: curationContributions.itemAuditContribution,
        reducerContribution: curationContributions.reducerContribution,
        ...(sourceProviderItemAuditConcurrency({ kind: EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT, input: contribution.originalInput as LegacyExtensionAgentTaskStartRequest['input'] }) !== undefined && { itemAuditConcurrency: sourceProviderItemAuditConcurrency({ kind: EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT, input: contribution.originalInput as LegacyExtensionAgentTaskStartRequest['input'] }) }),
        abortController: options.controller,
        progress: (message) => this.updateProgress(options.taskId, message),
        backlogCurationProgress: (progress) => this.updateBacklogCurationProgress(options.taskId, progress),
        sectionProgress: (update) => this.updateSectionProgress(options.taskId, update),
      });
    }
    const resolved = await resolveContributionPrompt(contribution, {
      signal: options.controller.signal,
      effectiveCustomToolName: (name) => resolverHarness.effectiveCustomToolName(name),
      onProgress: (update) => this.updateSectionProgress(options.taskId, update),
    });
    const role = (resolved.run?.role ?? 'planner') as AgentRole;
    const { harness, toolbeltSummary } = agentRuntimes.forRoleResolved(role);
    const plannerConfig = resolveAgentConfig(role, config, undefined, toolbeltSummary);
    const customTools = (resolved.run?.tools ?? contribution.contribution.value.tools ?? []).map(toCustomTool);
    let sawProgress = false;
    const task = runResolvedAgentTask({
      ...plannerConfig,
      harness,
      cwd,
      promptTemplate: resolved.prompt && resolved.prompt.trim().length > 0 ? resolved.prompt : contribution.promptTemplate,
      variables: resolved.variables,
      promptLabel: `extension agent task ${contribution.contribution.id}`,
      role,
      tools: resolved.run?.toolsPreset ?? 'read-only',
      customTools,
      abortController: options.controller,
      maxTurns: plannerConfig.maxTurns,
      taskId: options.taskId,
      phase: 'standalone',
      stage: 'extension-agent-task',
      getResult: resolved.getResult ?? (() => undefined),
      missingResultMessage: resolved.missingResultMessage ?? `Task contribution ${contribution.contribution.id} did not submit a result.`,
    });
    let next = await task.next();
    while (!next.done) {
      if (!sawProgress) {
        sawProgress = true;
        await this.updateProgress(options.taskId, 'Planner task is running');
      }
      next = await task.next();
    }
    const output = JSON.parse(JSON.stringify(next.value));
    validateContributionOutput(contribution.contribution, output);
    return parseEforgePlanPlanningDraftResult(output);
  }

  private async resolveBacklogCurationContributions(options: { owner?: ExtensionAgentTaskOwner; registry?: NativeExtensionRegistry }): Promise<{ itemAuditContribution: BacklogCurationAgentTaskContributionHandle; reducerContribution: BacklogCurationAgentTaskContributionHandle }> {
    if (options.owner === undefined) throw new AgentTaskServiceError('Backlog curation map/reduce requires an extension owner', 400);
    const registry = options.registry ?? await loadNativeExtensionRegistry(this.requireCwd());
    return {
      itemAuditContribution: await this.resolveContributionHandle(registry, 'backlog-item-audit', options.owner),
      reducerContribution: await this.resolveContributionHandle(registry, 'backlog-reducer', options.owner),
    };
  }

  private async resolveContributionHandle(registry: NativeExtensionRegistry, id: string, owner: ExtensionAgentTaskOwner): Promise<BacklogCurationAgentTaskContributionHandle> {
    const request: ContributionStartRequest = { task: { id, extensionName: owner.extensionName }, input: {} };
    const contribution = findAgentTaskContribution(registry, request, owner);
    if (contribution === undefined) throw new AgentTaskServiceError(`Unknown task contribution: ${id}`, 404);
    if (contribution.availability !== undefined && contribution.availability.available === false) {
      throw new AgentTaskServiceError(contribution.availability.message ?? `Task contribution ${contribution.id} is unavailable`, 409);
    }
    return { contribution, owner: { extensionName: contribution.extensionName, extensionPath: contribution.extensionPath }, promptTemplate: await loadContributionPromptTemplate(contribution) };
  }

  private async resolveContributionDeferredSource(options: { taskId: string; contribution: ResolvedAgentTaskContributionStart; controller: AbortController }): Promise<ResolvedAgentTaskContributionStart & { originalInput: Record<string, unknown>; deferredSource: ResolvedDeferredSourceInput }> {
    const deferredSource = await this.resolveDeferredInput(options.taskId, options.contribution.input as LegacyExtensionAgentTaskStartRequest['input'], options.contribution.owner, options.controller);
    return { ...options.contribution, originalInput: options.contribution.input, input: deferredSource.input, deferredSource };
  }

  private async resolveDeferredInput(taskId: string, input: LegacyExtensionAgentTaskStartRequest['input'], owner: ExtensionAgentTaskOwner, controller: AbortController): Promise<ResolvedDeferredSourceInput> {
    const provider = input.sourceProvider;
    if (provider === undefined) return { input };
    await this.updateProgress(taskId, 'Preparing planner source');
    const source = await runDeferredSourceProvider({ cwd: this.requireCwd(), owner, provider: provider as NonNullable<LegacyExtensionAgentTaskStartRequest['input']['sourceProvider']>, signal: controller.signal });
    const { sourceProvider: _omitted, ...inputWithoutProvider } = input;
    return { ...source, input: { ...inputWithoutProvider, sourceText: source.sourceText } };
  }

  private async complete(taskId: string, result: EforgePlanPlanningDraftResult, startedAtMs: number): Promise<void> {
    const cwd = this.requireCwd();
    const current = await readAgentTaskRecord(cwd, taskId);
    if (!current || current.status === 'cancelled') return;
    const safeResult = parseEforgePlanPlanningDraftResult(JSON.parse(JSON.stringify(result)));
    const now = new Date().toISOString();
    const completed: StoredExtensionAgentTaskRecord = {
      ...current,
      status: 'completed',
      updatedAt: now,
      completedAt: now,
      result: safeResult,
      metadata: sanitizeMetadata({
        ...current.metadata,
        summary: safeResult.summary,
        progressMessage: 'Planner task completed',
        outputSectionCount: countOutputSections(safeResult),
        warningCount: safeResult.assumptionsOpenQuestions.length,
      }),
    };
    await writeAgentTaskRecord(cwd, completed);
    emitAgentTaskComplete(this.context, eventBase(completed), Date.now() - startedAtMs);
  }

  private async failUnlessCancelled(taskId: string, err: unknown, startedAtMs: number, aborted: boolean): Promise<void> {
    const cwd = this.requireCwd();
    const current = await readAgentTaskRecord(cwd, taskId);
    if (!current || current.status === 'cancelled') return;
    if (aborted) {
      const now = new Date().toISOString();
      const cancelled: StoredExtensionAgentTaskRecord = { ...current, status: 'cancelled', updatedAt: now, cancelledAt: now, errorMessage: 'Task cancelled' };
      await writeAgentTaskRecord(cwd, cancelled);
      emitAgentTaskCancelled(this.context, eventBase(cancelled), 'Task cancelled');
      return;
    }
    const now = new Date().toISOString();
    const errorCode = errorCodeFor(err);
    const errorMessage = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
    const failed: StoredExtensionAgentTaskRecord = {
      ...current,
      status: 'failed',
      updatedAt: now,
      completedAt: now,
      errorCode,
      errorMessage,
      metadata: sanitizeMetadata({ ...current.metadata, progressMessage: 'Planner task failed' }),
    };
    await writeAgentTaskRecord(cwd, failed);
    emitAgentTaskFailed(this.context, eventBase(failed), { durationMs: Date.now() - startedAtMs, errorCode, message: errorMessage });
  }

  private async updateProgress(taskId: string, message: string): Promise<void> {
    const cwd = this.requireCwd();
    const current = await readAgentTaskRecord(cwd, taskId);
    if (!current || current.status !== 'running') return;
    const updated: StoredExtensionAgentTaskRecord = {
      ...current,
      updatedAt: new Date().toISOString(),
      metadata: sanitizeMetadata({ ...current.metadata, progressMessage: message }),
    };
    await writeAgentTaskRecord(cwd, updated);
    emitAgentTaskProgress(this.context, eventBase(updated), message);
  }

  private async updateBacklogCurationProgress(taskId: string, progress: ExtensionAgentTaskBacklogCurationProgress): Promise<void> {
    const cwd = this.requireCwd();
    const current = await readAgentTaskRecord(cwd, taskId);
    if (!current || current.status !== 'running') return;
    const updated: StoredExtensionAgentTaskRecord = {
      ...current,
      updatedAt: new Date().toISOString(),
      metadata: sanitizeMetadata({ ...current.metadata, backlogCurationProgress: progress }),
    };
    await writeAgentTaskRecord(cwd, updated);
    emitAgentTaskProgress(this.context, eventBase(updated), current.metadata?.progressMessage ?? 'Backlog curation progress updated');
  }

  private async updateSectionProgress(taskId: string, update: SectionProgressUpdate): Promise<void> {
    const cwd = this.requireCwd();
    const current = await readAgentTaskRecord(cwd, taskId);
    if (!current || current.status !== 'running') return;
    const sectionProgress: NonNullable<ExtensionAgentTaskSanitizedMetadata['sectionProgress']> = { ...current.metadata?.sectionProgress };
    if (update.currentSection !== undefined) sectionProgress.currentSection = update.currentSection;
    if (update.coveredSections !== undefined) sectionProgress.coveredSections = update.coveredSections;
    if (update.remainingSections !== undefined) sectionProgress.remainingSections = update.remainingSections;
    const message = update.message ?? sectionProgressMessage(update);
    const updated: StoredExtensionAgentTaskRecord = {
      ...current,
      updatedAt: new Date().toISOString(),
      metadata: sanitizeMetadata({
        ...current.metadata,
        progressMessage: message,
        ...(Object.keys(sectionProgress).length > 0 && { sectionProgress }),
      }),
    };
    await writeAgentTaskRecord(cwd, updated);
    emitAgentTaskProgress(this.context, eventBase(updated), message);
  }

  private async readExisting(taskId: string, owner?: ExtensionAgentTaskOwner): Promise<StoredExtensionAgentTaskRecord> {
    try {
      assertValidAgentTaskId(taskId);
      const record = await readAgentTaskRecord(this.requireCwd(), taskId);
      if (!record) throw new AgentTaskServiceError(`Unknown task id: ${taskId}`, 404);
      if (owner && (!record.owner || record.owner.extensionName !== owner.extensionName || record.owner.extensionPath !== owner.extensionPath)) {
        throw new AgentTaskServiceError(`Unknown task id: ${taskId}`, 404);
      }
      return record;
    } catch (err) {
      if (err instanceof AgentTaskStoreError) throw new AgentTaskServiceError(err.message, err.status);
      throw err;
    }
  }

  private requireCwd(): string {
    if (!this.context.cwd) throw new AgentTaskServiceError('Working directory not configured', 503);
    return this.context.cwd;
  }
}
// --- eforge:endregion agent-task-service-class ---

