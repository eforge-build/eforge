import type { AgentBackend, SdkPassthroughConfig } from '../backend.js';
import { pickSdkOptions } from '../backend.js';
import { isAlwaysYieldedAgentEvent, type EforgeEvent, type PrdValidationGap } from '../events.js';
import { loadPrompt } from '../prompts.js';

export interface PrdValidatorOptions extends SdkPassthroughConfig {
  backend: AgentBackend;
  cwd: string;
  prdContent: string;
  diff: string;
  verbose?: boolean;
  abortController?: AbortController;
}

/**
 * PRD validator agent — compares original PRD requirements against the full
 * worktree diff and reports substantive gaps.
 */
export async function* runPrdValidator(
  options: PrdValidatorOptions,
): AsyncGenerator<EforgeEvent> {
  yield { timestamp: new Date().toISOString(), type: 'prd_validation:start' };

  const prompt = await loadPrompt('prd-validator', {
    prd: options.prdContent,
    diff: options.diff,
  });

  let gaps: PrdValidationGap[] = [];

  try {
    let accumulatedText = '';

    for await (const event of options.backend.run(
      {
        prompt,
        cwd: options.cwd,
        maxTurns: 15,
        tools: 'coding',
        abortSignal: options.abortController?.signal,
        ...pickSdkOptions(options),
      },
      'prd-validator',
    )) {
      if (isAlwaysYieldedAgentEvent(event) || options.verbose) {
        yield event;
      }

      // Accumulate text from agent messages
      if (event.type === 'agent:message' && 'content' in event) {
        accumulatedText += event.content;
      }
    }

    // Parse structured JSON output from accumulated text
    gaps = parseGaps(accumulatedText);
  } catch (err) {
    // Re-throw abort errors so the orchestrator can respect cancellation
    if (err instanceof Error && err.name === 'AbortError') throw err;
    // Agent errors are non-fatal — the build continues
  }

  const passed = gaps.length === 0;
  yield { timestamp: new Date().toISOString(), type: 'prd_validation:complete', passed, gaps };
}

/**
 * Parse gap analysis JSON from agent output.
 * Looks for a JSON block containing { "gaps": [...] }.
 */
function parseGaps(text: string): PrdValidationGap[] {
  // Try to find a JSON block (fenced or raw)
  const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) ?? text.match(/(\{[\s\S]*"gaps"[\s\S]*\})/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[1]);
    if (Array.isArray(parsed.gaps)) {
      return parsed.gaps
        .filter((g: unknown): g is { requirement: string; explanation: string } =>
          typeof g === 'object' && g !== null &&
          typeof (g as Record<string, unknown>).requirement === 'string' &&
          typeof (g as Record<string, unknown>).explanation === 'string',
        )
        .map((g: { requirement: string; explanation: string }) => ({
          requirement: g.requirement,
          explanation: g.explanation,
        }));
    }
  } catch {
    // JSON parse failure — treat as no gaps
  }

  return [];
}
