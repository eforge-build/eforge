import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentHarness, SdkPassthroughConfig } from '../harness.js';
import { pickSdkOptions } from '../harness.js';
import { isAlwaysYieldedAgentEvent, type EforgeEvent } from '../events.js';
import { loadPrompt } from '../prompts.js';

const exec = promisify(execFile);

export interface DocSyncerOptions extends SdkPassthroughConfig {
  harness: AgentHarness;
  cwd: string;
  planId: string;
  planContent: string;
  preImplementCommit: string;
  verbose?: boolean;
  abortController?: AbortController;
  maxTurns?: number;
}

/**
 * Parse `<doc-sync-summary count="N">` from agent output.
 * Returns the count of docs synced, or 0 if no summary block is found.
 */
function parseDocSyncSummary(text: string): number {
  const match = text.match(/<doc-sync-summary\s+count="(\d+)"/);
  if (!match) return 0;
  return parseInt(match[1], 10);
}

/**
 * Doc-syncer agent — syncs existing documentation against the post-implement diff.
 * Reads the diff between preImplementCommit and HEAD; edits-only (no file creation).
 * Runs after implement (predecessors: ['implement']).
 * Non-fatal: errors are caught (except AbortError), complete event always yielded.
 */
export async function* runDocSyncer(
  options: DocSyncerOptions,
): AsyncGenerator<EforgeEvent> {
  yield { timestamp: new Date().toISOString(), type: 'plan:build:doc-sync:start', planId: options.planId };

  let docsSynced = 0;

  try {
    // Capture the diff before invoking the agent so the prompt is self-contained
    let diffSummary = '';
    let diff = '';
    try {
      const { stdout: statOut } = await exec(
        'git',
        ['diff', '--stat', `${options.preImplementCommit}..HEAD`],
        { cwd: options.cwd },
      );
      diffSummary = statOut;
      const { stdout: diffOut } = await exec(
        'git',
        ['diff', `${options.preImplementCommit}..HEAD`],
        { cwd: options.cwd },
      );
      diff = diffOut;
    } catch {
      // If diff capture fails, proceed with empty diff — agent will emit count="0"
    }

    const prompt = await loadPrompt('doc-syncer', {
      plan_id: options.planId,
      plan_content: options.planContent,
      diff_summary: diffSummary,
      diff,
    }, options.promptAppend);

    let fullText = '';

    for await (const event of options.harness.run(
      {
        prompt,
        cwd: options.cwd,
        maxTurns: options.maxTurns ?? 20,
        tools: 'coding',
        abortSignal: options.abortController?.signal,
        ...pickSdkOptions(options),
      },
      'doc-syncer',
      options.planId,
    )) {
      if (event.type === 'agent:message' && event.content) {
        fullText += event.content;
      }

      if (isAlwaysYieldedAgentEvent(event) || options.verbose) {
        yield event;
      }
    }

    docsSynced = parseDocSyncSummary(fullText);
  } catch (err) {
    // Re-throw abort errors so the pipeline can respect cancellation
    if (err instanceof Error && err.name === 'AbortError') throw err;
    // Other doc-syncer failures are non-fatal
  }

  yield { timestamp: new Date().toISOString(), type: 'plan:build:doc-sync:complete', planId: options.planId, docsSynced };
}
