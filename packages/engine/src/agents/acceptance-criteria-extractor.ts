import type { AgentHarness, SdkPassthroughConfig } from '../harness.js';
import { pickSdkOptions } from '../harness.js';
import { isAlwaysYieldedAgentEvent, type EforgeEvent } from '../events.js';
import { loadPrompt } from '../prompts.js';
import { DEFAULT_TIER_MAX_TURNS } from '../config.js';
import { AC_EXTRACTION_MIN_CONFIDENCE, parseAcceptanceCriteriaExtractorOutput, type CanonicalAcceptanceCriteriaInventory } from '../validation/acceptance-criteria-inventory.js';

export interface AcceptanceCriteriaExtractorOptions extends SdkPassthroughConfig {
  harness: AgentHarness;
  cwd: string;
  prdContent: string;
  verbose?: boolean;
  abortController?: AbortController;
  maxTurns?: number;
  allowNoAcceptanceCriteria?: boolean;
}

export async function* runAcceptanceCriteriaExtractor(
  options: AcceptanceCriteriaExtractorOptions,
): AsyncGenerator<EforgeEvent, CanonicalAcceptanceCriteriaInventory> {
  const prompt = await loadPrompt('acceptance-criteria-extractor', {
    prd: options.prdContent,
    minConfidence: String(AC_EXTRACTION_MIN_CONFIDENCE),
  }, options.promptAppend);

  let fullText = '';
  let resultText: string | undefined;

  for await (const event of options.harness.run(
    {
      prompt,
      cwd: options.cwd,
      maxTurns: options.maxTurns ?? DEFAULT_TIER_MAX_TURNS.implementation,
      tools: 'none',
      abortSignal: options.abortController?.signal,
      ...pickSdkOptions(options),
    },
    'prd-validator',
  )) {
    if (isAlwaysYieldedAgentEvent(event) || options.verbose) {
      yield event;
    }
    if (event.type === 'agent:message' && event.content) {
      fullText += event.content;
    }
    if (event.type === 'agent:result' && event.result.resultText !== undefined) {
      resultText = event.result.resultText;
    }
  }

  const output = (resultText?.trim() ? resultText : fullText).trim();
  if (output === '') {
    throw new Error('Acceptance criteria extractor produced no output; re-enqueue after fixing extractor availability.');
  }

  return parseAcceptanceCriteriaExtractorOutput(output, options.prdContent, {
    allowNoAcceptanceCriteria: options.allowNoAcceptanceCriteria,
  });
}
