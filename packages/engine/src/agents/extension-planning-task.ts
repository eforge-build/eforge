import { Type } from '@sinclair/typebox';
import {
  EforgePlanPlanningDepthSchema,
  EforgePlanPlanningDraftResultSchema,
  EforgePlanPlanningTypeSchema,
  getSchemaYaml,
  parseEforgePlanPlanningDraftResult,
  type EforgePlanPlanningDraftInput,
  type EforgePlanPlanningDraftResult,
} from '@eforge-build/client';
import type { AgentHarness, CustomTool, SdkPassthroughConfig } from '../harness.js';
import { pickSdkOptions } from '../harness.js';
import { isAlwaysYieldedAgentEvent, type EforgeEvent } from '../events.js';
import { DEFAULT_TIER_MAX_TURNS } from '../config.js';
import { loadPrompt } from '../prompts.js';

export interface EforgePlanPlanningProgressUpdate {
  currentSection?: string;
  coveredSections?: string[];
  remainingSections?: string[];
  message?: string;
}

export type EforgePlanPlanningProgressCallback = (update: EforgePlanPlanningProgressUpdate) => void | Promise<void>;

export interface ExtensionPlanningTaskOptions extends SdkPassthroughConfig {
  harness: AgentHarness;
  cwd: string;
  input: EforgePlanPlanningDraftInput;
  verbose?: boolean;
  abortController?: AbortController;
  maxTurns?: number;
  taskId?: string;
  /** Optional telemetry-only callback invoked with sanitized section progress reported by the agent. */
  onProgress?: EforgePlanPlanningProgressCallback;
}

const MAX_PROGRESS_STRING_LENGTH = 200;
const MAX_PROGRESS_ARRAY_ITEMS = 50;

const planningProgressToolSchema = Type.Object({
  currentSection: Type.Optional(Type.String()),
  coveredSections: Type.Optional(Type.Array(Type.String())),
  remainingSections: Type.Optional(Type.Array(Type.String())),
  message: Type.Optional(Type.String()),
}, { additionalProperties: false });

function sanitizeProgressString(value: string): string {
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length > MAX_PROGRESS_STRING_LENGTH ? `${cleaned.slice(0, MAX_PROGRESS_STRING_LENGTH - 3)}...` : cleaned;
}

function sanitizeProgressArray(values: string[]): string[] {
  return values.slice(0, MAX_PROGRESS_ARRAY_ITEMS).map(sanitizeProgressString).filter((entry) => entry.length > 0);
}

function sanitizeProgressUpdate(input: unknown): EforgePlanPlanningProgressUpdate {
  const raw = (input ?? {}) as Record<string, unknown>;
  const update: EforgePlanPlanningProgressUpdate = {};
  if (typeof raw.currentSection === 'string') {
    const current = sanitizeProgressString(raw.currentSection);
    if (current.length > 0) update.currentSection = current;
  }
  if (Array.isArray(raw.coveredSections)) {
    update.coveredSections = sanitizeProgressArray(raw.coveredSections.filter((entry): entry is string => typeof entry === 'string'));
  }
  if (Array.isArray(raw.remainingSections)) {
    update.remainingSections = sanitizeProgressArray(raw.remainingSections.filter((entry): entry is string => typeof entry === 'string'));
  }
  if (typeof raw.message === 'string') {
    const message = sanitizeProgressString(raw.message);
    if (message.length > 0) update.message = message;
  }
  return update;
}

const planningDraftSubmissionToolSchema = Type.Object({
  summary: Type.String(),
  assumptionsOpenQuestions: Type.Array(Type.String()),
  nextSteps: Type.Optional(Type.Array(Type.String())),
  recommendations: Type.Optional(Type.Object({}, { additionalProperties: true })),
  handoffDraft: Type.Optional(Type.Object({}, { additionalProperties: true })),
  handoffDrafts: Type.Optional(Type.Array(Type.Object({}, { additionalProperties: true }), { minItems: 1 })),
  planDrafts: Type.Optional(Type.Array(Type.Object({
    title: Type.String(),
    body: Type.String(),
  }, { additionalProperties: false }), { minItems: 1 })),
  playbookDraft: Type.Optional(Type.Object({
    name: Type.String(),
    body: Type.String(),
  }, { additionalProperties: false })),
  sessionPlanPatch: Type.Optional(Type.Object({
    sections: Type.Array(Type.Object({
      dimension: Type.String(),
      content: Type.String(),
    }, { additionalProperties: false }), { minItems: 1 }),
    skippedDimensions: Type.Optional(Type.Array(Type.Object({
      dimension: Type.String(),
      reason: Type.String(),
    }, { additionalProperties: false }))),
  }, { additionalProperties: false })),
  decision: Type.Optional(Type.Union([Type.Literal('ready'), Type.Literal('needs-input')])),
  sessionPlanCreationDraft: Type.Optional(Type.Object({
    session: Type.String(),
    topic: Type.String(),
    planningType: EforgePlanPlanningTypeSchema,
    planningDepth: EforgePlanPlanningDepthSchema,
    profile: Type.Optional(Type.Union([Type.Literal('errand'), Type.Literal('excursion'), Type.Literal('expedition')])),
    agentProfile: Type.Optional(Type.String()),
    sections: Type.Array(Type.Object({
      dimension: Type.String(),
      content: Type.String(),
    }, { additionalProperties: false }), { minItems: 1 }),
    skippedDimensions: Type.Optional(Type.Array(Type.Object({
      dimension: Type.String(),
      reason: Type.String(),
    }, { additionalProperties: false }))),
  }, { additionalProperties: false })),
  clarificationQuestions: Type.Optional(Type.Array(Type.Object({
    question: Type.String(),
    why: Type.Optional(Type.String()),
    options: Type.Optional(Type.Array(Type.String())),
  }, { additionalProperties: false }), { minItems: 1 })),
  rationale: Type.Optional(Type.String()),
}, { additionalProperties: false });

export async function* runEforgePlanPlanningDraftTask(
  options: ExtensionPlanningTaskOptions,
): AsyncGenerator<EforgeEvent, EforgePlanPlanningDraftResult> {
  let submitted: EforgePlanPlanningDraftResult | undefined;
  const submitToolName = 'submit_eforge_plan_planning_result';
  const submitTool: CustomTool = {
    name: submitToolName,
    description: 'Submit the final eforge-plan planning draft result. This is the only accepted output channel for this task.',
    inputSchema: planningDraftSubmissionToolSchema,
    handler: async (input: unknown) => {
      try {
        const parsed = parseEforgePlanPlanningDraftResult(input);
        if (submitted !== undefined) {
          return 'Error: a planning result was already submitted. Submit exactly one final result.';
        }
        submitted = parsed;
        return 'Planning draft result submitted successfully.';
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `Submission rejected: ${message}\nFix the payload and call ${submitToolName} again.`;
      }
    },
  };

  const progressToolName = 'report_eforge_plan_planning_progress';
  const progressTool: CustomTool = {
    name: progressToolName,
    description: 'Report telemetry-only section progress while drafting the session plan. This never replaces the final submission and does not affect readiness.',
    inputSchema: planningProgressToolSchema,
    handler: async (input: unknown) => {
      const update = sanitizeProgressUpdate(input);
      try {
        await options.onProgress?.(update);
      } catch {
        // Progress reporting is telemetry-only; never fail the task because a progress update could not be recorded.
      }
      return 'Section progress recorded.';
    },
  };

  const prompt = await loadPrompt('eforge-plan-planning-draft', {
    topic: options.input.topic,
    session: options.input.session ?? '(none)',
    planningType: options.input.planningType ?? '(unspecified)',
    planningDepth: options.input.planningDepth ?? '(unspecified)',
    sourceText: options.input.sourceText ?? '(none)',
    existingSessionPlan: options.input.existingSessionPlan ?? '(none)',
    requestedOutputSections: options.input.requestedOutputSections?.join(', ') ?? '(agent should choose applicable sections)',
    submitTool: options.harness.effectiveCustomToolName(submitToolName),
    progressTool: options.harness.effectiveCustomToolName(progressToolName),
    resultSchema: getSchemaYaml('eforge-plan-planning-draft-result', EforgePlanPlanningDraftResultSchema),
  }, options.promptAppend);

  const effectiveSubmitToolName = options.harness.effectiveCustomToolName(submitToolName);
  const effectiveProgressToolName = options.harness.effectiveCustomToolName(progressToolName);
  const allowedTools = options.allowedTools === undefined
    ? undefined
    : [...new Set([...options.allowedTools, effectiveSubmitToolName, effectiveProgressToolName])];
  const sdkOptions = pickSdkOptions({
    model: options.model,
    thinking: options.thinking,
    effort: options.effort,
    maxBudgetUsd: options.maxBudgetUsd,
    fallbackModel: options.fallbackModel,
    allowedTools,
    disallowedTools: options.disallowedTools,
    phase: options.phase,
    stage: options.stage,
  });

  for await (const event of options.harness.run(
    {
      prompt,
      cwd: options.cwd,
      maxTurns: options.maxTurns ?? DEFAULT_TIER_MAX_TURNS.planning,
      tools: 'read-only',
      customTools: [submitTool, progressTool],
      abortSignal: options.abortController?.signal,
      ...sdkOptions,
    },
    'planner',
    options.taskId,
  )) {
    if (isAlwaysYieldedAgentEvent(event) || options.verbose) {
      yield event;
    }
  }

  if (submitted === undefined) {
    throw new Error(`eforge-plan planning draft task did not call ${options.harness.effectiveCustomToolName(submitToolName)}.`);
  }

  return submitted;
}

export const runExtensionPlanningTask = runEforgePlanPlanningDraftTask;
