import type { Static, TObject, TSchema } from './schema.js';
import type { ExtensionTool } from './tools.js';
import type {
  ExtensionContributionAvailability,
  ExtensionContributionRequirements,
} from './dependencies.js';

export type ExtensionAgentTaskPromptSource =
  | { kind: 'asset'; asset: string }
  | { kind: 'export'; module: string; exportName?: string };

export interface ExtensionAgentTaskResolverContext<TInput = unknown> {
  input: TInput;
  extensionName: string;
  extensionPath: string;
  signal: AbortSignal;
}

export interface ExtensionAgentTaskResolverResult {
  prompt: string;
  systemPrompt?: string;
  run?: {
    role?: string;
    profile?: string;
    tools?: ExtensionAgentTaskCustomTool[];
  };
  metadata?: Record<string, unknown>;
}

export type ExtensionAgentTaskPromptResolver<TInput = unknown> = (
  ctx: ExtensionAgentTaskResolverContext<TInput>,
) => ExtensionAgentTaskResolverResult | Promise<ExtensionAgentTaskResolverResult>;

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
  resolvePrompt?: ExtensionAgentTaskPromptResolver<Static<TInput>>;
}

export type ExtensionAgentTaskContributionOutput<TOutput extends TSchema | undefined = undefined> =
  TOutput extends TSchema ? Static<TOutput> : unknown;

export function defineExtensionAgentTaskContribution<
  TInput extends TObject,
  TOutput extends TSchema | undefined = undefined,
>(contribution: ExtensionAgentTaskContribution<TInput, TOutput>): ExtensionAgentTaskContribution<TInput, TOutput> {
  return contribution;
}
