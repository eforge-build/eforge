// --- eforge:region agent-task-service-helpers ---
import { lstat, readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT,
  parseEforgePlanPlanningDraftResult,
  safeParseBacklogCurationMapReduceSourceBundle,
  safeParseWithSchema,
  type EforgePlanPlanningDraftResult,
  type BacklogCurationMapReduceSourceBundle,
  type ExtensionAgentTaskKind,
  type ExtensionAgentTaskSanitizedMetadata,
  type ExtensionAgentTaskStartRequest,
} from '@eforge-build/client';
import type { AgentHarness, CustomTool } from '@eforge-build/engine/harness';
import type { AgentRuntimeRegistry } from '@eforge-build/engine/agent-runtime-registry';
import type { AgentTaskRegistration, NativeExtensionRegistry } from '@eforge-build/engine/extensions/index';
import {
  buildBacklogCurationRuntimeIdentity,
  isBacklogCurationMapReduceBundle,
  resolveBacklogCurationMapReduceProviderHooks,
  type BacklogCurationMapReduceProviderHooks,
} from './backlog-curation-map-reduce-runner.js';
import type { ExtensionAgentTaskOwner, StoredExtensionAgentTaskRecord } from './agent-task-store.js';

export class AgentTaskServiceError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message);
    this.name = 'AgentTaskServiceError';
  }
}

const DAEMON_ROUTE_EXTENSION_NAME = 'daemon-route';

export interface ResolvedAgentTaskContributionStart {
  contribution: AgentTaskRegistration;
  owner: ExtensionAgentTaskOwner;
  input: Record<string, unknown>;
  promptTemplate: string;
}

export interface ResolvedContributionPrompt {
  prompt?: string;
  variables?: Record<string, string>;
  run?: {
    role?: string;
    tools?: Array<CustomTool | ExtensionToolLike>;
    toolsPreset?: 'coding' | 'read-only' | 'none';
  };
  getResult?: () => EforgePlanPlanningDraftResult | undefined;
  missingResultMessage?: string;
}

type LegacyExtensionAgentTaskStartRequest = Extract<ExtensionAgentTaskStartRequest, { kind: typeof EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT }>;
export type ContributionStartRequest = Extract<ExtensionAgentTaskStartRequest, { task: unknown }> & { task: { id: string; extensionName?: string } };

export interface ExtensionToolLike {
  name: string;
  description: string;
  inputSchema: object;
  handler: (input: unknown) => Promise<string> | string;
}

export async function loadNativeExtensionRegistry(cwd: string): Promise<NativeExtensionRegistry> {
  const { loadConfig, getConfigDir, getConventionalConfigDir } = await import('@eforge-build/engine/config');
  const { loadNativeExtensions } = await import('@eforge-build/engine/extensions/index');
  const { config, warnings } = await loadConfig(cwd);
  for (const warning of warnings) process.stderr.write(`${warning}\n`);
  const configDir = await getConfigDir(cwd) ?? getConventionalConfigDir(cwd);
  return (await loadNativeExtensions({ cwd, configDir, config: config.extensions })).registry;
}

export function findAgentTaskContribution(
  registry: NativeExtensionRegistry,
  request: ContributionStartRequest,
  owner?: ExtensionAgentTaskOwner,
): AgentTaskRegistration | undefined {
  const candidates = registry.agentTasks.filter((entry) => {
    if (owner !== undefined && (entry.extensionName !== owner.extensionName || entry.extensionPath !== owner.extensionPath)) return false;
    if (request.task.extensionName !== undefined && entry.extensionName !== request.task.extensionName) return false;
    return entry.id === request.task.id || entry.localId === request.task.id;
  });
  if (candidates.length > 1) throw new AgentTaskServiceError(`Ambiguous task contribution: ${request.task.id}`, 400);
  return candidates[0];
}

export async function loadContributionPromptTemplate(contribution: AgentTaskRegistration): Promise<string> {
  const prompt = contribution.value.prompt;
  if (prompt.kind === 'asset') return await loadContributionPromptAsset(contribution.extensionPath, prompt.asset);
  if (prompt.kind === 'export') return await loadContributionPromptExport(contribution, prompt.module, prompt.exportName);
  throw new AgentTaskServiceError(`Unsupported task prompt source for ${contribution.id}`, 400);
}

async function loadContributionPromptAsset(extensionPath: string, asset: string): Promise<string> {
  const realTarget = await resolveContainedExtensionPath(extensionPath, asset, 'Task prompt asset');
  return await readFile(realTarget, 'utf-8');
}

async function loadContributionPromptExport(contribution: AgentTaskRegistration, moduleSpecifier: string, exportName: string | undefined): Promise<string> {
  const exportLabel = exportName ?? 'default';
  let modulePath: string;
  try {
    modulePath = await resolveContainedExtensionPath(contribution.extensionPath, moduleSpecifier, 'Task prompt export module');
  } catch (err) {
    throw wrapContributionPromptExportError(contribution.id, moduleSpecifier, exportLabel, 'resolve', err);
  }
  if (!/\.(?:mjs|js|mts|ts)$/.test(modulePath)) {
    throw new AgentTaskServiceError(`Task prompt export module ${moduleSpecifier} for ${contribution.id} must be .js, .mjs, .ts, or .mts`, 400);
  }
  let moduleExports: Record<string, unknown>;
  try {
    moduleExports = await importExtensionModule(modulePath);
  } catch (err) {
    throw wrapContributionPromptExportError(contribution.id, moduleSpecifier, exportLabel, 'import', err);
  }
  const selected = exportName === undefined ? moduleExports.default : moduleExports[exportName];
  if (selected === undefined) {
    throw new AgentTaskServiceError(`Task prompt export ${exportLabel} was not found for ${contribution.id} in ${moduleSpecifier}`, 500);
  }
  let value: unknown;
  try {
    value = typeof selected === 'function' ? selected() : selected;
  } catch (err) {
    throw wrapContributionPromptExportError(contribution.id, moduleSpecifier, exportLabel, 'invoke', err);
  }
  if (typeof value !== 'string') {
    throw new AgentTaskServiceError(`Task prompt export ${exportLabel} for ${contribution.id} in ${moduleSpecifier} must be a string or no-arg function returning a string`, 500);
  }
  return value;
}

function wrapContributionPromptExportError(contributionId: string, moduleSpecifier: string, exportName: string, phase: 'resolve' | 'import' | 'invoke', err: unknown): AgentTaskServiceError {
  if (err instanceof AgentTaskServiceError) {
    return new AgentTaskServiceError(`Task prompt export ${exportName} for ${contributionId} in ${moduleSpecifier} failed to ${phase}: ${err.message}`, err.status);
  }
  const detail = err instanceof Error ? err.message : String(err);
  return new AgentTaskServiceError(`Task prompt export ${exportName} for ${contributionId} in ${moduleSpecifier} failed to ${phase}: ${detail}`, 500);
}

async function resolveContainedExtensionPath(extensionPath: string, pathSpecifier: string, label: string): Promise<string> {
  const root = await resolveExtensionOwnerRoot(extensionPath);
  const target = resolve(root, pathSpecifier);
  const rel = relative(root, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new AgentTaskServiceError(`${label} must stay within the extension root`, 400);
  }
  const realRoot = await realpath(root);
  const realTarget = await realpath(target);
  const realRel = relative(realRoot, realTarget);
  if (realRel === '' || realRel === '..' || realRel.startsWith(`..${sep}`) || isAbsolute(realRel)) {
    throw new AgentTaskServiceError(`${label} must stay within the extension root`, 400);
  }
  return realTarget;
}

export async function resolveContributionPrompt(
  resolved: ResolvedAgentTaskContributionStart,
  hooks: {
    signal: AbortSignal;
    effectiveCustomToolName: (name: string) => string;
    onProgress: (update: SectionProgressUpdate) => void | Promise<void>;
  },
): Promise<ResolvedContributionPrompt> {
  const resolver = resolved.contribution.value.resolvePrompt;
  if (typeof resolver !== 'function') return { variables: stringifyPromptVariables(resolved.input), run: { tools: resolved.contribution.value.tools?.map(toCustomTool) } };
  const raw = await resolver({
    input: resolved.input,
    extensionName: resolved.owner.extensionName,
    extensionPath: resolved.owner.extensionPath,
    signal: hooks.signal,
    effectiveCustomToolName: hooks.effectiveCustomToolName,
    onProgress: hooks.onProgress,
  } as never);
  return normalizeResolvedContributionPrompt(raw, resolved.input);
}

export function validateContributionOutput(contribution: AgentTaskRegistration, output: unknown): void {
  if (contribution.value.outputSchema === undefined) return;
  const parsed = safeParseWithSchema(contribution.value.outputSchema as Parameters<typeof safeParseWithSchema>[0], output);
  if (!parsed.success) throw new AgentTaskServiceError(`Task contribution output failed schema validation: ${parsed.error.message}`, 500);
}

function normalizeResolvedContributionPrompt(raw: unknown, input: Record<string, unknown>): ResolvedContributionPrompt {
  if (!isRecord(raw)) return { variables: stringifyPromptVariables(input) };
  return {
    ...(typeof raw.prompt === 'string' && { prompt: raw.prompt }),
    variables: isStringRecord(raw.variables) ? raw.variables : stringifyPromptVariables(input),
    ...(isRecord(raw.run) && { run: raw.run as ResolvedContributionPrompt['run'] }),
    ...(typeof raw.getResult === 'function' && { getResult: raw.getResult as () => EforgePlanPlanningDraftResult | undefined }),
    ...(typeof raw.missingResultMessage === 'string' && { missingResultMessage: raw.missingResultMessage }),
  };
}

function stringifyPromptVariables(input: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]));
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
}

export function toCustomTool(tool: unknown): CustomTool {
  const candidate = tool as ExtensionToolLike;
  return {
    name: candidate.name,
    description: candidate.description,
    inputSchema: candidate.inputSchema as CustomTool['inputSchema'],
    handler: async (input: unknown) => String(await candidate.handler(input)),
  };
}

export function eventBase(record: StoredExtensionAgentTaskRecord): { taskId: string; taskKind: ExtensionAgentTaskKind; extensionName: string; status: StoredExtensionAgentTaskRecord['status']; metadata?: ExtensionAgentTaskSanitizedMetadata } {
  return {
    taskId: record.taskId,
    taskKind: record.kind,
    extensionName: record.owner?.extensionName ?? DAEMON_ROUTE_EXTENSION_NAME,
    status: record.status,
    ...(record.metadata !== undefined && { metadata: record.metadata }),
  };
}

export async function resolveAgentRuntimes(
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

export interface SectionProgressUpdate {
  currentSection?: string;
  coveredSections?: string[];
  remainingSections?: string[];
  message?: string;
}

export function sectionProgressMessage(update: SectionProgressUpdate): string {
  if (update.currentSection) return `Drafting section: ${update.currentSection}`;
  const covered = update.coveredSections?.length ?? 0;
  return covered > 0 ? `Covered ${covered} section(s)` : 'Section progress update';
}

export function countOutputSections(result: EforgePlanPlanningDraftResult): number {
  const taskResult = result as Record<string, unknown>;
  const creationDraft = taskResult.decision === 'ready' && taskResult.sessionPlanCreationDraft ? 1 : 0;
  const backlogCurationDraft = taskResult.backlogCurationDraft ? 1 : 0;
  // --- eforge:region client-engine-task-contract ---
  const planRevisionTurn = taskResult.planRevisionTurn ? 1 : 0;
  // --- eforge:endregion client-engine-task-contract ---
  return (taskResult.recommendations ? 1 : 0) + backlogCurationDraft + planRevisionTurn + (taskResult.handoffDraft ? 1 : 0) + (Array.isArray(taskResult.handoffDrafts) ? taskResult.handoffDrafts.length : 0) + (Array.isArray(taskResult.planDrafts) ? taskResult.planDrafts.length : 0) + (taskResult.playbookDraft ? 1 : 0) + (taskResult.sessionPlanPatch ? 1 : 0) + creationDraft;
}

type DeferredSourceProviderSpec = NonNullable<LegacyExtensionAgentTaskStartRequest['input']['sourceProvider']>;
// --- eforge:region plan-01-activity-contract-daemon-core ---
type DeferredSourceProviderContext = {
  cwd: string;
  input: Record<string, unknown>;
  signal: AbortSignal;
  progress?: (message: string) => Promise<void> | void;
  activity?: (message: string) => Promise<void> | void;
};
type DeferredSourceProviderHandler = (context: DeferredSourceProviderContext) => Promise<unknown> | unknown;
// --- eforge:endregion plan-01-activity-contract-daemon-core ---

export interface ResolvedDeferredSourceInput {
  input: LegacyExtensionAgentTaskStartRequest['input'];
  sourceText?: string;
  structuredSource?: unknown;
  providerHooks?: BacklogCurationMapReduceProviderHooks;
}

export async function runDeferredSourceProvider(options: { cwd: string; owner: ExtensionAgentTaskOwner; provider: DeferredSourceProviderSpec; signal: AbortSignal; progress?: (message: string) => Promise<void> | void; activity?: (message: string) => Promise<void> | void }): Promise<{ sourceText: string; structuredSource?: unknown; providerHooks: BacklogCurationMapReduceProviderHooks }> {
  throwIfSourceProviderAborted(options.signal);
  const modulePath = await resolveProviderModulePath(options.owner.extensionPath, options.provider.module);
  const moduleExports = await importDeferredSourceProviderModule(modulePath);
  const handler = resolveDeferredSourceProviderHandler(moduleExports, options.provider.exportName);
  const result = await handler({
    cwd: options.cwd,
    input: options.provider.input ?? {},
    signal: options.signal,
    ...(options.progress !== undefined && { progress: options.progress }),
    ...(options.activity !== undefined && { activity: options.activity }),
  });
  throwIfSourceProviderAborted(options.signal);
  if (!isRecord(result) || typeof result.sourceText !== 'string') {
    throw new AgentTaskServiceError(`Deferred source provider ${options.provider.module} did not return { sourceText: string }`, 500);
  }
  const parsedStructuredSource = result.backlogCurationMapReduce === undefined ? undefined : safeParseBacklogCurationMapReduceSourceBundle(result.backlogCurationMapReduce);
  if (parsedStructuredSource !== undefined && !parsedStructuredSource.success) {
    throw new AgentTaskServiceError(`Invalid backlogCurationMapReduce source: ${parsedStructuredSource.error.message}`, 500);
  }
  return {
    sourceText: result.sourceText,
    ...(parsedStructuredSource?.success === true && { structuredSource: parsedStructuredSource.data }),
    providerHooks: resolveBacklogCurationMapReduceProviderHooks(moduleExports),
  };
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
  return await importExtensionModule(modulePath);
}

async function importExtensionModule(modulePath: string): Promise<Record<string, unknown>> {
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

export function isEforgePlanCurationMapReduceTask(source: ResolvedDeferredSourceInput, _owner: ExtensionAgentTaskOwner | undefined): source is ResolvedDeferredSourceInput & { structuredSource: BacklogCurationMapReduceSourceBundle; providerHooks: BacklogCurationMapReduceProviderHooks } {
  if (source.structuredSource === undefined || source.providerHooks === undefined || !isBacklogCurationMapReduceBundle(source.structuredSource)) return false;
  return source.structuredSource.globalContext.purpose === 'backlog-curation-map-reduce';
}

export function sourceProviderItemAuditConcurrency(request: LegacyExtensionAgentTaskStartRequest): number | undefined {
  const input = request.input.sourceProvider?.input as { itemAuditConcurrency?: unknown } | undefined;
  return numberValue(input?.itemAuditConcurrency);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function throwIfSourceProviderAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Deferred source provider was aborted.');
}

export function sanitizeErrorMessage(message: string): string {
  const cleaned = message.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return (cleaned || 'Task failed').slice(0, 1000);
}

export function logBackgroundTaskError(taskId: string, err: unknown): void {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`Extension agent task ${taskId} background failure: ${message}\n`);
}

export function errorCodeFor(err: unknown): string {
  if (err instanceof Error && err.name) return err.name.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 80) || 'error';
  return 'error';
}
// --- eforge:endregion agent-task-service-helpers ---
