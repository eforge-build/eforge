import type { TObject, TSchema, Static } from './schema.js';
import type { ExtensionLogger } from './context.js';
import type { EforgeProjectPaths } from './project-paths.js';
import type {
  ExtensionActionRequestedBy,
  ExtensionActionRequestedByHost,
} from '@eforge-build/client';

export type { ExtensionActionRequestedBy, ExtensionActionRequestedByHost };

export type ExtensionActionSideEffect =
  | 'none'
  | 'local-read'
  | 'local-write'
  | 'network'
  | 'daemon-state'
  | 'build-queue';

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
}

export type ExtensionActionOutput<TOutput extends TSchema | undefined = undefined> =
  TOutput extends TSchema ? Static<TOutput> : unknown;

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

// --- eforge:region plan-01-workstation-contract-runtime ---
export interface ConsoleWorkstation {
  id: string;
  title: string;
  description?: string;
  srcDoc: string;
  /** Local action ids registered by this same extension. Omit or use [] to expose no actions. */
  allowedActions?: string[];
}

export interface EforgeConsoleBridge {
  invokeAction<TOutput = unknown>(actionId: string, input?: Record<string, unknown>): Promise<TOutput>;
}
// --- eforge:endregion plan-01-workstation-contract-runtime ---

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

// --- eforge:region plan-01-workstation-contract-runtime ---
export function defineConsoleWorkstation(workstation: ConsoleWorkstation): ConsoleWorkstation {
  return workstation;
}
// --- eforge:endregion plan-01-workstation-contract-runtime ---

export function defineIntegrationCommand<TInput extends TObject | undefined = TObject | undefined>(
  command: IntegrationCommand<TInput>,
): IntegrationCommand<TInput> {
  return command;
}

export function defineExtensionDeepLink(deepLink: ExtensionDeepLink): ExtensionDeepLink {
  return deepLink;
}
