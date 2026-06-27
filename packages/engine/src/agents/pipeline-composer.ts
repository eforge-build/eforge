import type { AgentHarness, SdkPassthroughConfig } from '../harness.js';
import { pickSdkOptions } from '../harness.js';
import { isAlwaysYieldedAgentEvent, type EforgeEvent } from '../events.js';
import type { BuildStageSpec, ReviewProfileConfig } from '../config.js';
import { loadPrompt } from '../prompts.js';
import { pipelineCompositionSchema, getPipelineCompositionSchemaYaml } from '../schemas.js';
import type { PipelineComposition } from '../schemas.js';
import { formatStageRegistry, validatePipeline } from '../pipeline.js';
import { REVIEW_PERSPECTIVES, parseWithSchema } from '@eforge-build/client';
import { DEFAULT_TIER_MAX_TURNS } from '../config.js';
import type { ValidationProviderRegistration } from '../extensions/types.js';
// --- eforge:region plan-03-planner-guardrails ---
import { createCompileContextGuard, type CompileContextGuardOptions } from '../compile-resilience/context-guard.js';
// --- eforge:endregion plan-03-planner-guardrails ---

/**
 * Options for the pipeline composer agent.
 */
export interface PipelineComposerOptions extends SdkPassthroughConfig {
  /** Harness for running the agent */
  harness: AgentHarness;
  /** The PRD / source document content */
  source: string;
  // --- eforge:region plan-02-preflight-compaction ---
  /** Prompt-safe compacted source content. Defaults to source. */
  promptSourceContent?: string;
  // --- eforge:endregion plan-02-preflight-compaction ---
  // --- eforge:region plan-03-planner-guardrails ---
  /** Prompt/live context guardrails for planner-family runs. */
  contextGuard?: CompileContextGuardOptions;
  // --- eforge:endregion plan-03-planner-guardrails ---
  /** Working directory */
  cwd: string;
  /** Whether to emit verbose agent-level events */
  verbose?: boolean;
  /** AbortController for cancellation */
  abortController?: AbortController;
  /** Override max conversation turns (default: planning tier default). */
  maxTurns?: number;
  /**
   * Validation provider registrations from loaded native extensions.
   * When present and non-empty, the composer is informed to include the
   * `validate` build stage so providers run.
   */
  validationProviders?: ValidationProviderRegistration[];
  /** Orchestrator-assigned lane id forwarded as the harness.run planId arg. */
  lane?: string;
}

/**
 * Extract a JSON object from a text response.
 * Strips markdown code fences and finds the first `{...}` block.
 */
function extractJson(text: string): unknown {
  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  const fencePattern = /```(?:json)?\s*\n?([\s\S]*?)```/;
  const fenceMatch = text.match(fencePattern);
  const cleaned = fenceMatch ? fenceMatch[1].trim() : text.trim();

  // Try parsing the cleaned text directly first (handles clean JSON or fence-extracted content)
  try {
    return JSON.parse(cleaned);
  } catch {
    // Fall back to finding the JSON object in surrounding text
  }

  // Find the first JSON object
  const startIdx = cleaned.indexOf('{');
  if (startIdx === -1) {
    throw new Error('No JSON object found in response');
  }

  // Try parsing from startIdx, trimming from the end until JSON.parse succeeds
  for (let endIdx = cleaned.length; endIdx > startIdx; endIdx--) {
    if (cleaned[endIdx - 1] !== '}') continue;
    try {
      return JSON.parse(cleaned.slice(startIdx, endIdx));
    } catch {
      // Try a shorter substring
    }
  }

  throw new Error('No valid JSON object found in response');
}

/**
 * Compose a pipeline from a PRD using text-based JSON extraction.
 *
 * Loads the pipeline-composer prompt with the stage registry and schema injected,
 * calls the backend with the planning tier maxTurns, extracts JSON from the text response,
 * validates it against the PipelineComposition schema, and yields a `plan:pipeline` event.
 * Retries up to 3 times on parse failure, feeding the error back to the model.
 *
 * Yields:
 * - `agent:start`, `agent:stop`, `agent:result` (always)
 * - `agent:message` events (when verbose)
 * - `planning:pipeline` event with the composition result
 */
export async function* composePipeline(
  options: PipelineComposerOptions,
): AsyncGenerator<EforgeEvent> {
  const { harness, source, cwd, verbose, abortController } = options;
  // --- eforge:region plan-03-planner-guardrails ---
  const contextGuard = createCompileContextGuard(options.contextGuard ?? { stage: 'pipeline-composer' });
  // --- eforge:endregion plan-03-planner-guardrails ---
  // --- eforge:region plan-02-preflight-compaction ---
  const promptSourceContent = options.promptSourceContent ?? source;
  // --- eforge:endregion plan-02-preflight-compaction ---

  const stageRegistry = formatStageRegistry();
  const schema = getPipelineCompositionSchemaYaml();

  // Build validation provider summary for injection into the prompt append so
  // the composer knows to include the `validate` build stage when providers are loaded.
  let validationProviderAppend: string | undefined;
  if (options.validationProviders && options.validationProviders.length > 0) {
    const summary = options.validationProviders
      .map((p) => `${p.name} (${p.extensionName})`)
      .join(', ');
    validationProviderAppend = `\n\n## Validation providers loaded\n\nThe following validation providers are registered and will run in the \`validate\` build stage: ${summary}.\n\nInclude the \`validate\` stage in defaultBuild pipelines (after \`implement\`, before review stages) so these providers run as quality gates.`;
  }

  const maxAttempts = 3;
  const maxPriorOutputChars = 8192;
  let lastError: string | undefined;
  let lastResultText: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const composedAppend = [options.promptAppend, validationProviderAppend].filter(Boolean).join('\n\n') || undefined;
    let promptText = await loadPrompt('pipeline-composer', {
      source: promptSourceContent,
      stageRegistry,
      schema,
      validPerspectives: `${REVIEW_PERSPECTIVES.join(', ')} (built-in defaults; custom extension keys are also accepted as lowercase slugs such as "accessibility" or "performance-review", but generated plans should use built-ins unless a project explicitly configures extension keys)`,
    }, composedAppend);

    // On retry, include the prior output AND the error so the model has
    // concrete state to correct from, not just the error string.
    if (lastError) {
      const priorOutput = lastResultText !== undefined
        ? (lastResultText.length > maxPriorOutputChars
          ? lastResultText.slice(0, maxPriorOutputChars) + '\n... [truncated]'
          : lastResultText)
        : '(no prior output captured)';
      promptText += `\n\nYour previous attempt produced:\n\n${priorOutput}\n\n`
        + `That response was rejected: ${lastError}\n\n`
        + `Return valid JSON matching the schema above, correcting the specific issue noted.`;
    }

    // --- eforge:region plan-03-planner-guardrails ---
    try {
      contextGuard.assertPrompt(promptText);
    } catch (err) {
      abortController?.abort();
      throw err;
    }
    // --- eforge:endregion plan-03-planner-guardrails ---

    let resultText: string | undefined;

    for await (const event of harness.run(
      {
        prompt: promptText,
        cwd,
        maxTurns: options.maxTurns ?? DEFAULT_TIER_MAX_TURNS.planning,
        tools: 'none',
        abortSignal: abortController?.signal,
        ...pickSdkOptions(options),
      },
      'pipeline-composer',
      options.lane,
    )) {
      // --- eforge:region plan-03-planner-guardrails ---
      try {
        contextGuard.observe(event);
      } catch (err) {
        abortController?.abort();
        throw err;
      }
      // --- eforge:endregion plan-03-planner-guardrails ---
      if (isAlwaysYieldedAgentEvent(event) || verbose) {
        yield event;
      }
      // Capture result text from the result event
      if (event.type === 'agent:result' && event.result.resultText !== undefined) {
        resultText = event.result.resultText;
      }
    }

    if (resultText === undefined) {
      throw new Error('Pipeline composer did not return any text');
    }

    // Try to extract and validate JSON
    try {
      const parsed = extractJson(resultText);
      const composition: PipelineComposition = parseWithSchema(pipelineCompositionSchema, parsed);

      // Validate the composed pipeline against registered stages
      const validation = validatePipeline(composition.compile, composition.defaultBuild);
      if (!validation.valid) {
        throw new Error(`Pipeline composition is invalid: ${validation.errors.join('; ')}`);
      }

      yield {
        timestamp: new Date().toISOString(),
        type: 'planning:pipeline',
        scope: composition.scope,
        compile: composition.compile,
        defaultBuild: composition.defaultBuild as BuildStageSpec[],
        defaultReview: composition.defaultReview as ReviewProfileConfig,
        rationale: composition.rationale,
      };

      return; // Success - exit the retry loop
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      lastResultText = resultText;
      if (attempt === maxAttempts) {
        throw new Error(`Pipeline composer failed after ${maxAttempts} attempts: ${lastError}`);
      }
      // Continue to next attempt
    }
  }
}
