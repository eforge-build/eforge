import {
  EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT,
  parseEforgePlanPlanningDraftResult,
  safeParseExtensionAgentTaskStartRequest,
  type EforgePlanPlanningDraftResult,
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
    const now = new Date().toISOString();
    const taskId = createAgentTaskId();
    const owner = options.owner;
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
      void this.runInBackground({ taskId, request: validRequest, controller, startedAtMs: Date.now() })
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

  private async runInBackground(options: { taskId: string; request: ExtensionAgentTaskStartRequest; controller: AbortController; startedAtMs: number }): Promise<void> {
    try {
      const result = await this.runPlannerTask(options);
      await this.complete(options.taskId, result, options.startedAtMs);
    } catch (err) {
      await this.failUnlessCancelled(options.taskId, err, options.startedAtMs, options.controller.signal.aborted);
    } finally {
      this.controllers.delete(options.taskId);
    }
  }

  private async runPlannerTask(options: { taskId: string; request: ExtensionAgentTaskStartRequest; controller: AbortController }): Promise<EforgePlanPlanningDraftResult> {
    const cwd = this.requireCwd();
    const { loadConfig } = await import('@eforge-build/engine/config');
    const { resolveAgentConfig } = await import('@eforge-build/engine/pipeline');
    const { buildAgentRuntimeRegistry, singletonRegistry } = await import('@eforge-build/engine/agent-runtime-registry');
    const { runEforgePlanPlanningDraftTask } = await import('@eforge-build/engine/agents/extension-planning-task');

    const { config, warnings } = await loadConfig(cwd);
    for (const warning of warnings) process.stderr.write(`${warning}\n`);
    const agentRuntimes = await resolveAgentRuntimes(this.context.options.agentRuntimes, config, buildAgentRuntimeRegistry, singletonRegistry);
    const { harness, toolbeltSummary } = agentRuntimes.forRoleResolved('planner');
    const plannerConfig = resolveAgentConfig('planner', config, undefined, toolbeltSummary);
    let sawProgress = false;
    const task = runEforgePlanPlanningDraftTask({
      ...plannerConfig,
      harness,
      cwd,
      input: options.request.input,
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
  return (taskResult.recommendations ? 1 : 0) + backlogCurationDraft + (taskResult.handoffDraft ? 1 : 0) + (Array.isArray(taskResult.handoffDrafts) ? taskResult.handoffDrafts.length : 0) + (Array.isArray(taskResult.planDrafts) ? taskResult.planDrafts.length : 0) + (taskResult.playbookDraft ? 1 : 0) + (taskResult.sessionPlanPatch ? 1 : 0) + creationDraft;
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
