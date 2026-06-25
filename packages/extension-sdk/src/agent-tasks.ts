import type { Static, TObject, TSchema } from './schema.js';
import type { ExtensionTool } from './tools.js';
import type {
  ExtensionContributionAvailability,
  ExtensionContributionRequirements,
} from './dependencies.js';

export type ExtensionAgentTaskPromptSource =
  | { kind: 'asset'; asset: string }
  | { kind: 'export'; module: string; exportName?: string };

export interface ExtensionAgentTaskSectionProgressUpdate {
  currentSection?: string;
  coveredSections?: string[];
  remainingSections?: string[];
  message?: string;
}

export interface ExtensionAgentTaskResolverContext<TInput = unknown> {
  input: TInput;
  extensionName: string;
  extensionPath: string;
  signal: AbortSignal;
  effectiveCustomToolName: (name: string) => string;
  onProgress: (update: ExtensionAgentTaskSectionProgressUpdate) => void | Promise<void>;
}

export interface ExtensionAgentTaskResolverResult<TOutput = unknown> {
  prompt?: string;
  variables?: Record<string, string>;
  run?: {
    role?: string;
    tools?: ExtensionAgentTaskCustomTool[];
    toolsPreset?: 'coding' | 'read-only' | 'none';
  };
  getResult?: () => TOutput | undefined;
  missingResultMessage?: string;
}

export type ExtensionAgentTaskPromptResolver<TInput = unknown, TOutput = unknown> = (
  ctx: ExtensionAgentTaskResolverContext<TInput>,
) => ExtensionAgentTaskResolverResult<TOutput> | Promise<ExtensionAgentTaskResolverResult<TOutput>>;

export type ExtensionAgentTaskCustomTool = ExtensionTool;

export interface ExtensionAgentTaskContribution<
  TInput extends TObject = TObject,
  TOutput extends TSchema | undefined = undefined,
> {
  id: string;
  title: string;
  description?: string;
  inputSchema: TInput;
  outputSchema?: TOutput;
  prompt: ExtensionAgentTaskPromptSource;
  requirements?: ExtensionContributionRequirements;
  availability?: ExtensionContributionAvailability;
  tools?: ExtensionAgentTaskCustomTool[];
  resolvePrompt?: ExtensionAgentTaskPromptResolver<Static<TInput>, ExtensionAgentTaskContributionOutput<TOutput>>;
}

export type ExtensionAgentTaskContributionOutput<TOutput extends TSchema | undefined = undefined> =
  TOutput extends TSchema ? Static<TOutput> : unknown;

export function defineExtensionAgentTaskContribution<
  TInput extends TObject,
  TOutput extends TSchema | undefined = undefined,
>(contribution: ExtensionAgentTaskContribution<TInput, TOutput>): ExtensionAgentTaskContribution<TInput, TOutput> {
  return contribution;
}
