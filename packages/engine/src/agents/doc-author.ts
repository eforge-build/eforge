import type { AgentHarness, SdkPassthroughConfig } from '../harness.js';
import { pickSdkOptions } from '../harness.js';
import { isAlwaysYieldedAgentEvent, type EforgeEvent } from '../events.js';
import { loadPrompt } from '../prompts.js';

export interface DocAuthorOptions extends SdkPassthroughConfig {
  harness: AgentHarness;
  cwd: string;
  planId: string;
  planContent: string;
  verbose?: boolean;
  abortController?: AbortController;
  maxTurns?: number;
}

/**
 * Parse `<doc-author-summary count="N" created="..." updated="...">` from agent output.
 * Returns the count of docs authored (created + updated), or 0 if no summary block is found.
 */
function parseDocAuthorSummary(text: string): number {
  const match = text.match(/<doc-author-summary\s+count="(\d+)"/);
  if (!match) return 0;
  return parseInt(match[1], 10);
}

/**
 * Doc-author agent — authors plan-specified documentation.
 * Reads the plan as the spec; can create new doc files the plan names.
 * Runs in parallel with implement (no predecessors).
 * Non-fatal: errors are caught (except AbortError), complete event always yielded.
 */
export async function* runDocAuthor(
  options: DocAuthorOptions,
): AsyncGenerator<EforgeEvent> {
  yield { timestamp: new Date().toISOString(), type: 'plan:build:doc-author:start', planId: options.planId };

  let docsAuthored = 0;

  try {
    const prompt = await loadPrompt('doc-author', {
      plan_id: options.planId,
      plan_content: options.planContent,
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
      'doc-author',
      options.planId,
    )) {
      if (event.type === 'agent:message' && event.content) {
        fullText += event.content;
      }

      if (isAlwaysYieldedAgentEvent(event) || options.verbose) {
        yield event;
      }
    }

    docsAuthored = parseDocAuthorSummary(fullText);
  } catch (err) {
    // Re-throw abort errors so the pipeline can respect cancellation
    if (err instanceof Error && err.name === 'AbortError') throw err;
    // Other doc-author failures are non-fatal
  }

  yield { timestamp: new Date().toISOString(), type: 'plan:build:doc-author:complete', planId: options.planId, docsAuthored };
}
