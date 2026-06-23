import { lstat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT,
  parseEforgePlanPlanningDraftResult,
  safeParseBacklogCurationMapReduceSourceBundle,
  safeParseExtensionAgentTaskStartRequest,
  type EforgePlanPlanningDraftResult,
  // --- eforge:region plan-03-daemon-map-reduce-integration ---
  type BacklogCurationMapReduceSourceBundle,
  // --- eforge:endregion plan-03-daemon-map-reduce-integration ---
  type ExtensionAgentTaskCancelResponse,
  type ExtensionAgentTaskGetResponse,
  type ExtensionAgentTaskKind,
  type ExtensionAgentTaskRequestedBy,
  type ExtensionAgentTaskSanitizedMetadata,
  type ExtensionAgentTaskStartRequest,
  type ExtensionAgentTaskStartResponse,
} from '@eforge-build/client';
import type { AgentHarness } from '@eforge-build/engine/harness';
import type { AgentRuntimeRegistry } from '@eforge-build/engine/agent-runtime-registry';
import type { MonitorContext } from '../../context.js';
import {
  emitAgentTaskCancelled,
  emitAgentTaskComplete,
  emitAgentTaskFailed,
  emitAgentTaskProgress,
  emitAgentTaskStart,
  sanitizeMetadata,
} from './agent-task-events.js';
// --- eforge:region plan-03-daemon-map-reduce-integration ---
import {
  buildBacklogCurationRuntimeIdentity,
  isBacklogCurationMapReduceBundle,
  resolveBacklogCurationMapReduceProviderHooks,
  runBacklogCurationMapReduceTask,
  type BacklogCurationMapReduceProviderHooks,
} from './backlog-curation-map-reduce-runner.js';
// --- eforge:endregion plan-03-daemon-map-reduce-integration ---
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

export class AgentTaskServiceError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message);
    this.name = 'AgentTaskServiceError';
  }
}

export interface ExtensionAgentTaskStartOptions {
  owner?: ExtensionAgentTaskOwner;
  requestedBy?: ExtensionAgentTaskRequestedBy;
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
    if (validRequest.kind !== EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT) {
      throw new AgentTaskServiceError(`Unsupported task kind: ${validRequest.kind as string}`, 400);
    }
    const owner = options.owner;
    if (validRequest.input.sourceProvider !== undefined && owner === undefined) {
      throw new AgentTaskServiceError('Deferred source providers require an extension owner', 400);
    }
    const now = new Date().toISOString();
    const taskId = createAgentTaskId();
    const metadata = sanitizeMetadata({ label: owner?.extensionName ?? 'extension agent task', progressMessage: 'Starting planner task' });
    const record: StoredExtensionAgentTaskRecord = {
      taskId,
      kind: validRequest.kind,
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
      void this.runInBackground({ taskId, request: validRequest, controller, startedAtMs: Date.now(), owner })
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

  private async runInBackground(options: { taskId: string; request: ExtensionAgentTaskStartRequest; controller: AbortController; startedAtMs: number; owner?: ExtensionAgentTaskOwner }): Promise<void> {
    try {
      const result = await this.runPlannerTask(options);
      await this.complete(options.taskId, result, options.startedAtMs);
    } catch (err) {
      await this.failUnlessCancelled(options.taskId, err, options.startedAtMs, options.controller.signal.aborted);
    } finally {
      this.controllers.delete(options.taskId);
    }
  }

  private async runPlannerTask(options: { taskId: string; request: ExtensionAgentTaskStartRequest; controller: AbortController; owner?: ExtensionAgentTaskOwner }): Promise<EforgePlanPlanningDraftResult> {
    const cwd = this.requireCwd();
    const deferredSource = await this.resolveDeferredSourceInput(options);
    const input = deferredSource.input;
    const { loadConfig } = await import('@eforge-build/engine/config');
    const { resolveAgentConfig } = await import('@eforge-build/engine/pipeline');
    const { buildAgentRuntimeRegistry, singletonRegistry } = await import('@eforge-build/engine/agent-runtime-registry');
    const { runEforgePlanPlanningDraftTask } = await import('@eforge-build/engine/agents/extension-planning-task');

    const { config, warnings } = await loadConfig(cwd);
    for (const warning of warnings) process.stderr.write(`${warning}\n`);
    const agentRuntimes = await resolveAgentRuntimes(this.context.options.agentRuntimes, config, buildAgentRuntimeRegistry, singletonRegistry);
    const { harness, toolbeltSummary } = agentRuntimes.forRoleResolved('planner');
    const plannerConfig = resolveAgentConfig('planner', config, undefined, toolbeltSummary);
    // --- eforge:region plan-03-daemon-map-reduce-integration ---
    if (isEforgePlanCurationMapReduceTask(deferredSource, options.owner)) {
      return await runBacklogCurationMapReduceTask({
        ...plannerConfig,
        harness,
        cwd,
        taskId: options.taskId,
        input,
        sourceBundle: deferredSource.structuredSource,
        providerHooks: deferredSource.providerHooks,
        runtimeIdentity: buildBacklogCurationRuntimeIdentity(plannerConfig, toolbeltSummary),
        ...(sourceProviderItemAuditConcurrency(options.request) !== undefined && { itemAuditConcurrency: sourceProviderItemAuditConcurrency(options.request) }),
        abortController: options.controller,
        progress: (message) => this.updateProgress(options.taskId, message),
        sectionProgress: (update) => this.updateSectionProgress(options.taskId, update),
      });
    }
    // --- eforge:endregion plan-03-daemon-map-reduce-integration ---
    let sawProgress = false;
    const task = runEforgePlanPlanningDraftTask({
      ...plannerConfig,
      harness,
      cwd,
      input,
      abortController: options.controller,
      maxTurns: plannerConfig.maxTurns,
      taskId: options.taskId,
      phase: 'standalone',
      stage: 'extension-agent-task',
      onProgress: (update) => this.updateSectionProgress(options.taskId, update),
    });
    let next = await task.next();
    while (!next.done) {
      if (!sawProgress) {
        sawProgress = true;
        await this.updateProgress(options.taskId, 'Planner task is running');
      }
      next = await task.next();
    }
    return next.value;
  }

  private async resolveDeferredSourceInput(options: { taskId: string; request: ExtensionAgentTaskStartRequest; controller: AbortController; owner?: ExtensionAgentTaskOwner }): Promise<ResolvedDeferredSourceInput> {
    const provider = options.request.input.sourceProvider;
    if (provider === undefined) return { input: options.request.input };
    if (options.owner === undefined) throw new AgentTaskServiceError('Deferred source providers require an extension owner', 400);
    await this.updateProgress(options.taskId, 'Preparing planner source');
    const source = await runDeferredSourceProvider({ cwd: this.requireCwd(), owner: options.owner, provider, signal: options.controller.signal });
    const { sourceProvider: _omitted, ...inputWithoutProvider } = options.request.input;
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

// --- eforge:region agent-task-service-helpers ---
const DAEMON_ROUTE_EXTENSION_NAME = 'daemon-route';

function eventBase(record: StoredExtensionAgentTaskRecord): { taskId: string; taskKind: ExtensionAgentTaskKind; extensionName: string; status: StoredExtensionAgentTaskRecord['status']; metadata?: ExtensionAgentTaskSanitizedMetadata } {
  return {
    taskId: record.taskId,
    taskKind: record.kind,
    extensionName: record.owner?.extensionName ?? DAEMON_ROUTE_EXTENSION_NAME,
    status: record.status,
    ...(record.metadata !== undefined && { metadata: record.metadata }),
  };
}

async function resolveAgentRuntimes(
  provided: AgentRuntimeRegistry | AgentHarness | undefined,
  config: Parameters<typeof import('@eforge-build/engine/agent-runtime-registry').buildAgentRuntimeRegistry>[0],
  buildAgentRuntimeRegistry: typeof import('@eforge-build/engine/agent-runtime-registry').buildAgentRuntimeRegistry,
  singletonRegistry: typeof import('@eforge-build/engine/agent-runtime-registry').singletonRegistry,
): Promise<AgentRuntimeRegistry> {
  if (provided !== undefined) {
    return isAgentRuntimeRegistry(provided) ? provided : singletonRegistry(provided);
  }
  return buildAgentRuntimeRegistry(config, { toolbelts: config.tools.toolbelts });
}

function isAgentRuntimeRegistry(value: AgentRuntimeRegistry | AgentHarness): value is AgentRuntimeRegistry {
  return typeof (value as AgentRuntimeRegistry).forRoleResolved === 'function';
}

interface SectionProgressUpdate {
  currentSection?: string;
  coveredSections?: string[];
  remainingSections?: string[];
  message?: string;
}

function sectionProgressMessage(update: SectionProgressUpdate): string {
  if (update.currentSection) return `Drafting section: ${update.currentSection}`;
  const covered = update.coveredSections?.length ?? 0;
  return covered > 0 ? `Covered ${covered} section(s)` : 'Section progress update';
}

function countOutputSections(result: EforgePlanPlanningDraftResult): number {
  const taskResult = result as Record<string, unknown>;
  const creationDraft = taskResult.decision === 'ready' && taskResult.sessionPlanCreationDraft ? 1 : 0;
  const backlogCurationDraft = taskResult.backlogCurationDraft ? 1 : 0;
  // --- eforge:region client-engine-task-contract ---
  const planRevisionTurn = taskResult.planRevisionTurn ? 1 : 0;
  // --- eforge:endregion client-engine-task-contract ---
  return (taskResult.recommendations ? 1 : 0) + backlogCurationDraft + planRevisionTurn + (taskResult.handoffDraft ? 1 : 0) + (Array.isArray(taskResult.handoffDrafts) ? taskResult.handoffDrafts.length : 0) + (Array.isArray(taskResult.planDrafts) ? taskResult.planDrafts.length : 0) + (taskResult.playbookDraft ? 1 : 0) + (taskResult.sessionPlanPatch ? 1 : 0) + creationDraft;
}

type DeferredSourceProviderSpec = NonNullable<ExtensionAgentTaskStartRequest['input']['sourceProvider']>;
type DeferredSourceProviderHandler = (context: { cwd: string; input: Record<string, unknown>; signal: AbortSignal }) => Promise<unknown> | unknown;

// --- eforge:region plan-03-daemon-map-reduce-integration ---
interface ResolvedDeferredSourceInput {
  input: ExtensionAgentTaskStartRequest['input'];
  sourceText?: string;
  structuredSource?: unknown;
  providerHooks?: BacklogCurationMapReduceProviderHooks;
}
// --- eforge:endregion plan-03-daemon-map-reduce-integration ---

async function runDeferredSourceProvider(options: { cwd: string; owner: ExtensionAgentTaskOwner; provider: DeferredSourceProviderSpec; signal: AbortSignal }): Promise<{ sourceText: string; structuredSource?: unknown; providerHooks: BacklogCurationMapReduceProviderHooks }> {
  throwIfSourceProviderAborted(options.signal);
  const modulePath = await resolveProviderModulePath(options.owner.extensionPath, options.provider.module);
  const moduleExports = await importDeferredSourceProviderModule(modulePath);
  const handler = resolveDeferredSourceProviderHandler(moduleExports, options.provider.exportName);
  const result = await handler({ cwd: options.cwd, input: options.provider.input ?? {}, signal: options.signal });
  throwIfSourceProviderAborted(options.signal);
  if (!isRecord(result) || typeof result.sourceText !== 'string') {
    throw new AgentTaskServiceError(`Deferred source provider ${options.provider.module} did not return { sourceText: string }`, 500);
  }
  // --- eforge:region plan-03-daemon-map-reduce-integration ---
  const parsedStructuredSource = result.backlogCurationMapReduce === undefined ? undefined : safeParseBacklogCurationMapReduceSourceBundle(result.backlogCurationMapReduce);
  if (parsedStructuredSource !== undefined && !parsedStructuredSource.success) {
    throw new AgentTaskServiceError(`Invalid backlogCurationMapReduce source: ${parsedStructuredSource.error.message}`, 500);
  }
  return {
    sourceText: result.sourceText,
    ...(parsedStructuredSource?.success === true && { structuredSource: parsedStructuredSource.data }),
    providerHooks: resolveBacklogCurationMapReduceProviderHooks(moduleExports),
  };
  // --- eforge:endregion plan-03-daemon-map-reduce-integration ---
}

async function resolveProviderModulePath(extensionPath: string, moduleSpecifier: string): Promise<string> {
  if (moduleSpecifier.includes('\0') || isAbsolute(moduleSpecifier)) {
    throw new AgentTaskServiceError('Deferred source provider module must be relative to the extension root', 400);
  }
  const root = await resolveExtensionOwnerRoot(extensionPath);
  const target = resolve(root, moduleSpecifier);
  const rel = relative(root, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new AgentTaskServiceError('Deferred source provider module must stay within the extension root', 400);
  }
  return target;
}

async function resolveExtensionOwnerRoot(extensionPath: string): Promise<string> {
  if (extensionPath.includes('\0')) {
    throw new AgentTaskServiceError('Extension owner path is invalid', 400);
  }
  const resolved = resolve(extensionPath);
  try {
    const info = await lstat(resolved);
    return info.isDirectory() ? resolved : dirname(resolved);
  } catch {
    throw new AgentTaskServiceError(`Extension owner path is unavailable: ${extensionPath}`, 500);
  }
}

async function importDeferredSourceProviderModule(modulePath: string): Promise<Record<string, unknown>> {
  if (/\.[cm]?tsx?$/.test(modulePath)) {
    const require = createRequire(import.meta.url);
    const { createJiti } = require('jiti') as { createJiti: (filename: string, options?: { moduleCache?: boolean }) => { import: (id: string) => Promise<unknown> } };
    const jiti = createJiti(import.meta.url, { moduleCache: false });
    return await jiti.import(modulePath) as Record<string, unknown>;
  }
  return await import(pathToFileURL(modulePath).href) as Record<string, unknown>;
}

function resolveDeferredSourceProviderHandler(moduleExports: Record<string, unknown>, exportName: string | undefined): DeferredSourceProviderHandler {
  const value = exportName === undefined ? moduleExports.default ?? moduleExports.buildSource : moduleExports[exportName];
  if (typeof value !== 'function') {
    throw new AgentTaskServiceError(`Deferred source provider export ${exportName ?? 'default'} is not a function`, 500);
  }
  return value as DeferredSourceProviderHandler;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// --- eforge:region plan-03-daemon-map-reduce-integration ---
function isEforgePlanCurationMapReduceTask(source: ResolvedDeferredSourceInput, owner: ExtensionAgentTaskOwner | undefined): source is ResolvedDeferredSourceInput & { structuredSource: BacklogCurationMapReduceSourceBundle; providerHooks: BacklogCurationMapReduceProviderHooks } {
  if (source.structuredSource === undefined || source.providerHooks === undefined || !isBacklogCurationMapReduceBundle(source.structuredSource)) return false;
  const bundle = source.structuredSource;
  return owner?.extensionName === 'eforge-plan' || bundle.globalContext.purpose === 'backlog-curation-map-reduce';
}

function sourceProviderItemAuditConcurrency(request: ExtensionAgentTaskStartRequest): number | undefined {
  const input = request.input.sourceProvider?.input as { itemAuditConcurrency?: unknown } | undefined;
  return numberValue(input?.itemAuditConcurrency);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
// --- eforge:endregion plan-03-daemon-map-reduce-integration ---

function throwIfSourceProviderAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Deferred source provider was aborted.');
}

function sanitizeErrorMessage(message: string): string {
  const cleaned = message.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return (cleaned || 'Task failed').slice(0, 1000);
}

function logBackgroundTaskError(taskId: string, err: unknown): void {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`Extension agent task ${taskId} background failure: ${message}\n`);
}

function errorCodeFor(err: unknown): string {
  if (err instanceof Error && err.name) return err.name.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 80) || 'error';
  return 'error';
}
// --- eforge:endregion agent-task-service-helpers ---
