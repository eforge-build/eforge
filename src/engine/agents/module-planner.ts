import { query } from '@anthropic-ai/claude-agent-sdk';
import type { ForgeEvent, ClarificationQuestion } from '../events.js';
import { loadPrompt } from '../prompts.js';
import { mapSDKMessages } from './common.js';

export interface ModulePlannerOptions {
  cwd: string;
  planSetName: string;
  moduleId: string;
  moduleDescription: string;
  moduleDependsOn: string[];
  architectureContent: string;
  sourceContent: string;
  verbose?: boolean;
  onClarification?: (questions: ClarificationQuestion[]) => Promise<Record<string, string>>;
  abortController?: AbortController;
}

/**
 * Run the module planner agent for a single expedition module.
 * One-shot SDK query that reads the architecture and writes a detailed
 * module plan to plans/{planSetName}/modules/{moduleId}.md.
 */
export async function* runModulePlanner(
  options: ModulePlannerOptions,
): AsyncGenerator<ForgeEvent> {
  yield { type: 'expedition:module:start', moduleId: options.moduleId };

  const prompt = await loadPrompt('module-planner', {
    source: options.sourceContent,
    planSetName: options.planSetName,
    moduleId: options.moduleId,
    moduleDescription: options.moduleDescription,
    moduleDependsOn: options.moduleDependsOn.join(', ') || 'none',
    architectureContent: options.architectureContent,
    cwd: options.cwd,
  });

  const q = query({
    prompt,
    options: {
      cwd: options.cwd,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      maxTurns: 20,
      tools: { type: 'preset', preset: 'claude_code' },
      abortController: options.abortController,
    },
  });

  for await (const event of mapSDKMessages(q, 'module-planner')) {
    // Always yield agent:result + tool events for tracing; gate streaming text on verbose
    if (event.type === 'agent:result' || event.type === 'agent:tool_use' || event.type === 'agent:tool_result' || options.verbose) {
      yield event;
    }
  }

  yield { type: 'expedition:module:complete', moduleId: options.moduleId };
}
