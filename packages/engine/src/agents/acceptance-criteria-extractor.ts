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
  /** When true, extract only author-explicit acceptance/done criteria and do not infer from context. */
  explicitOnly?: boolean;
}

export async function* runAcceptanceCriteriaExtractor(
  options: AcceptanceCriteriaExtractorOptions,
): AsyncGenerator<EforgeEvent, CanonicalAcceptanceCriteriaInventory> {
  const prompt = await loadPrompt('acceptance-criteria-extractor', {
    prd: options.prdContent,
    minConfidence: String(AC_EXTRACTION_MIN_CONFIDENCE),
    extractionModeInstructions: options.explicitOnly
      ? 'Extract only acceptance/done criteria that the author explicitly identifies as acceptance criteria, done criteria, completion criteria, or required validation. Do not infer criteria from scope, implementation notes, file lists, or general context. If no explicit criteria are present, return an empty criteria array.'
      : 'First extract acceptance/done criteria that the author explicitly identifies. If none are explicit, determine a minimal set of concrete acceptance criteria from the PRD context.',
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
