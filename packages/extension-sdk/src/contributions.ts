import type { TObject, TSchema, Static } from './schema.js';
import type { ExtensionLogger } from './context.js';
import type { EforgeProjectPaths } from './project-paths.js';
import type {
  ExtensionAgentTaskCancelResponse,
  ExtensionAgentTaskGetResponse,
  ExtensionAgentTaskStartRequest,
  ExtensionAgentTaskStartResponse,
  ExtensionActionRequestedBy,
  ExtensionActionRequestedByHost,
  EnqueueRequest,
  EnqueueResponse,
  ExtensionJsonValue,
} from '@eforge-build/client';

export type { ExtensionActionRequestedBy, ExtensionActionRequestedByHost };

export type ExtensionActionSideEffect =
  | 'none'
  | 'local-read'
  | 'local-write'
  | 'network'
  | 'daemon-state'
  | 'build-queue';

// --- eforge:region extension-agent-task-context ---
export interface ExtensionAgentTasksApi {
  start(request: Omit<ExtensionAgentTaskStartRequest, 'requestedBy'>): Promise<ExtensionAgentTaskStartResponse>;
  get(taskId: string): Promise<ExtensionAgentTaskGetResponse>;
  cancel(taskId: string, reason?: string): Promise<ExtensionAgentTaskCancelResponse>;
}
// --- eforge:endregion extension-agent-task-context ---

// --- eforge:region extension-build-queue-context ---
export interface ExtensionBuildQueueApi {
  enqueue(request: EnqueueRequest): Promise<EnqueueResponse>;
}
// --- eforge:endregion extension-build-queue-context ---

export interface ExtensionActionContext {
  invocationId: string;
  actionId: string;
  /**
   * Caller-declared display provenance from the HTTP request. This is not an
   * authenticated identity and must not be used for authorization decisions.
   */
  requestedBy: ExtensionActionRequestedBy;
  cwd: string;
  /** Aborted when the daemon action timeout elapses; handlers should stop side effects promptly. */
  signal: AbortSignal;
  logger: ExtensionLogger;
  /** Scoped path helpers for resolving eforge-owned storage locations. */
  paths: EforgeProjectPaths;
  // --- eforge:region extension-agent-task-context ---
  /** Daemon-owned single-shot agent tasks available to extension actions. */
  agentTasks: ExtensionAgentTasksApi;
  // --- eforge:endregion extension-agent-task-context ---
  // --- eforge:region extension-build-queue-context ---
  /** Daemon-owned build queue operations available to trusted extension actions. */
  buildQueue: ExtensionBuildQueueApi;
  // --- eforge:endregion extension-build-queue-context ---
}

export type ExtensionActionOutput<TOutput extends TSchema | undefined = undefined> =
  TOutput extends TSchema ? Static<TOutput> : unknown;

export interface ExtensionActionInputValidationErrorDetail {
  path: string;
  message: string;
  [key: string]: ExtensionJsonValue;
}

export class ExtensionActionInputValidationError extends Error {
  details: ExtensionActionInputValidationErrorDetail[];

  constructor(message: string, details: ExtensionActionInputValidationErrorDetail[]) {
    super(message);
    this.name = 'ExtensionActionInputValidationError';
    this.details = details;
  }
}

export interface ExtensionAction<
  TInput extends TObject = TObject,
  TOutput extends TSchema | undefined = undefined,
> {
  id: string;
  title: string;
  description?: string;
  inputSchema: TInput;
  outputSchema?: TOutput;
  sideEffects?: ExtensionActionSideEffect[];
  handler: (
    input: Static<TInput>,
    ctx: ExtensionActionContext,
  ) => ExtensionActionOutput<TOutput> | Promise<ExtensionActionOutput<TOutput>>;
}

export interface ExtensionActionBinding {
  actionId: string;
  inputDefaults?: Record<string, unknown>;
}

export type ConsoleContributionRendererId =
  | 'text'
  | 'markdown'
  | 'status-badge'
  | 'link'
  | 'action-button'
  | 'action-form';

export type ConsoleContributionBlock =
  | { rendererId: 'text'; title?: string; content: string }
  | { rendererId: 'markdown'; title?: string; content: string }
  | { rendererId: 'status-badge'; title?: string; content: string; status: string }
  | { rendererId: 'link'; title?: string; content: string; href: string }
  | { rendererId: 'action-button'; title?: string; content: string; action: ExtensionActionBinding }
  | { rendererId: 'action-form'; title?: string; content: string; action: ExtensionActionBinding };

export interface ConsoleContribution {
  id: string;
  title: string;
  description?: string;
  blocks: ConsoleContributionBlock[];
}

export interface ConsoleWorkstationBase {
  id: string;
  title: string;
  description?: string;
  /** Local action ids registered by this same extension. Omit to allow all same-extension actions; use [] to expose no actions. */
  allowedActions?: string[];
}

export interface ConsoleWorkstationFrameBundle {
  root: string;
  entrypoint: string;
  styles?: string[];
  assets?: string[];
  browserSdkVersion?: 1;
}

export interface ConsoleWorkstationSrcDoc extends ConsoleWorkstationBase {
  srcDoc: string;
  frameBundle?: never;
}

export interface ConsoleWorkstationFrameBundleWorkstation extends ConsoleWorkstationBase {
  srcDoc?: never;
  frameBundle: ConsoleWorkstationFrameBundle;
}

export type ConsoleWorkstation = ConsoleWorkstationSrcDoc | ConsoleWorkstationFrameBundleWorkstation;

export interface IntegrationCommand<TInput extends TObject | undefined = TObject | undefined> {
  id: string;
  label: string;
  description?: string;
  inputSchema?: TInput;
  action: ExtensionActionBinding;
}

export interface ExtensionDeepLink {
  id: string;
  label: string;
  description?: string;
  urlTemplate?: string;
  action?: ExtensionActionBinding;
}

export function defineExtensionAction<
  TInput extends TObject,
  TOutput extends TSchema | undefined = undefined,
>(action: ExtensionAction<TInput, TOutput>): ExtensionAction<TInput, TOutput> {
  return action;
}

export function defineConsoleContribution(contribution: ConsoleContribution): ConsoleContribution {
  return contribution;
}

export function defineConsoleWorkstation<TWorkstation extends ConsoleWorkstation>(workstation: TWorkstation): TWorkstation {
  return workstation;
}

export function defineIntegrationCommand<TInput extends TObject | undefined = TObject | undefined>(
  command: IntegrationCommand<TInput>,
): IntegrationCommand<TInput> {
  return command;
}

export function defineExtensionDeepLink(deepLink: ExtensionDeepLink): ExtensionDeepLink {
  return deepLink;
}
