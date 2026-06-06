import type { AgentHarness, SdkPassthroughConfig } from '../harness.js';
import { pickSdkOptions } from '../harness.js';
import { isAlwaysYieldedAgentEvent, type EforgeEvent } from '../events.js';
import type { MergeConflictInfo } from '../worktree-ops.js';
import { loadPrompt } from '../prompts.js';
import { emitBuildDecisionForPlan } from '../decisions.js';
import { DEFAULT_TIER_MAX_TURNS } from '../config.js';

export interface MergeConflictResolverOptions extends SdkPassthroughConfig {
  harness: AgentHarness;
  cwd: string;
  conflict: MergeConflictInfo;
  verbose?: boolean;
  abortController?: AbortController;
  /** Override max conversation turns (default: planning tier default). */
  maxTurns?: number;
}

/**
 * Merge conflict resolver agent — one-shot coding agent that resolves
 * git merge conflicts by understanding intent from both plans' summaries,
 * reading conflicted files, and editing them to resolve all conflict markers.
 */
export async function* runMergeConflictResolver(
  options: MergeConflictResolverOptions,
): AsyncGenerator<EforgeEvent> {
  const planId = options.conflict.branch;
  yield { timestamp: new Date().toISOString(), type: 'plan:merge:resolve:start', planId };

  const prompt = await loadPrompt('merge-conflict-resolver', {
    branch: options.conflict.branch,
    base_branch: options.conflict.baseBranch,
    conflicted_files: options.conflict.conflictedFiles.join('\n'),
    conflict_diff: options.conflict.conflictDiff,
    plan_name: options.conflict.planName ?? '',
    plan_summary: options.conflict.planSummary ?? '',
    other_plan_name: options.conflict.otherPlanName ?? '',
    other_plan_summary: options.conflict.otherPlanSummary ?? '',
  }, options.promptAppend);

  try {
    for await (const event of options.harness.run(
      {
        prompt,
        cwd: options.cwd,
        maxTurns: options.maxTurns ?? DEFAULT_TIER_MAX_TURNS.planning,
        tools: 'coding',
        abortSignal: options.abortController?.signal,
        ...pickSdkOptions(options),
      },
      'merge-conflict-resolver',
      planId,
    )) {
      if (isAlwaysYieldedAgentEvent(event) || options.verbose) {
        yield withPlanId(event, planId);
      }
    }
  } catch (err) {
    // Re-throw abort errors so the orchestrator can respect cancellation
    if (err instanceof Error && err.name === 'AbortError') throw err;
    // Other resolver failures are non-fatal — fall through to resolved: false
    yield { timestamp: new Date().toISOString(), type: 'plan:merge:resolve:complete', planId, resolved: false };
    return;
  }

  yield { timestamp: new Date().toISOString(), type: 'plan:merge:resolve:complete', planId, resolved: true };

  // Emit merge-conflict-resolution decision alongside the resolution success
  yield emitBuildDecisionForPlan(planId, {
    kind: 'merge-conflict-resolution',
    strategy: 'agent-resolved',
    files: options.conflict.conflictedFiles,
    rationale: `Merge conflict resolver agent resolved ${options.conflict.conflictedFiles.length} conflicted file(s)`,
  });
}

function withPlanId(event: EforgeEvent, planId: string): EforgeEvent {
  if (!event.type.startsWith('agent:')) return event;
  const agentEvent = event as EforgeEvent & { planId?: string };
  if (agentEvent.planId !== undefined) return event;
  return { ...agentEvent, planId } as EforgeEvent;
}
