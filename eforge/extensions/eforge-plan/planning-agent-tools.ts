import {
  EforgePlanPlanningBacklogCurationDraftSchema,
  EforgePlanPlanningDraftResultSchema,
  EforgePlanPlanningSessionPlanCreationDraftSchema,
  EforgePlanPlanningPlanRevisionTurnSchema,
  getSchemaYaml,
  parseEforgePlanPlanningDraftResult,
  type EforgePlanPlanningDraftInput,
  type EforgePlanPlanningDraftResult,
  type EforgePlanPlanningSessionPlanCreationDraft,
} from '@eforge-build/client';
import { Type, type ExtensionAgentTaskCustomTool } from '@eforge-build/extension-sdk';

export interface EforgePlanPlanningProgressUpdate {
  currentSection?: string;
  coveredSections?: string[];
  remainingSections?: string[];
  message?: string;
}

export type EforgePlanPlanningProgressCallback = (update: EforgePlanPlanningProgressUpdate) => void | Promise<void>;
export type PlanningDraftResultValidator = (result: EforgePlanPlanningDraftResult, rawInput: unknown) => string | string[] | undefined | Promise<string | string[] | undefined>;

export const PLANNING_DRAFT_SUBMIT_TOOL_NAME = 'submit_eforge_plan_planning_result' as const;
export const PLANNING_PROGRESS_TOOL_NAME = 'report_eforge_plan_planning_progress' as const;

const MAX_PROGRESS_STRING_LENGTH = 200;
const MAX_PROGRESS_ARRAY_ITEMS = 50;
const MAX_REJECTION_MESSAGE_LENGTH = 4_000;

export const planningProgressToolSchema = Type.Object({
  currentSection: Type.Optional(Type.String()),
  coveredSections: Type.Optional(Type.Array(Type.String())),
  remainingSections: Type.Optional(Type.Array(Type.String())),
  message: Type.Optional(Type.String()),
}, { additionalProperties: false });

export const planningDraftSubmissionToolSchema = Type.Object({
  summary: Type.String(),
  assumptionsOpenQuestions: Type.Array(Type.String()),
  nextSteps: Type.Optional(Type.Array(Type.String())),
  recommendations: Type.Optional(Type.Object({}, { additionalProperties: true })),
  backlogCurationDraft: Type.Optional(EforgePlanPlanningBacklogCurationDraftSchema),
  handoffDraft: Type.Optional(Type.Object({}, { additionalProperties: true })),
  handoffDrafts: Type.Optional(Type.Array(Type.Object({}, { additionalProperties: true }), { minItems: 1 })),
  planDrafts: Type.Optional(Type.Array(Type.Object({
    title: Type.String(),
    body: Type.String(),
  }, { additionalProperties: false }), { minItems: 1 })),
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
  planRevisionTurn: Type.Optional(EforgePlanPlanningPlanRevisionTurnSchema),
  decision: Type.Optional(Type.Union([Type.Literal('ready'), Type.Literal('needs-input')])),
  sessionPlanCreationDraft: Type.Optional(EforgePlanPlanningSessionPlanCreationDraftSchema),
  clarificationQuestions: Type.Optional(Type.Array(Type.Object({
    question: Type.String(),
    why: Type.Optional(Type.String()),
    options: Type.Optional(Type.Array(Type.String())),
  }, { additionalProperties: false }), { minItems: 1 })),
  rationale: Type.Optional(Type.String()),
}, { additionalProperties: false });

export function planningDraftResultSchemaYaml(): string {
  return getSchemaYaml('eforge-plan-planning-draft-result', EforgePlanPlanningDraftResultSchema);
}

export function boundedRejectionMessage(message: string, maxLength = MAX_REJECTION_MESSAGE_LENGTH): string {
  const cleaned = message.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 3)}...` : cleaned;
}

export function sanitizeProgressUpdate(input: unknown): EforgePlanPlanningProgressUpdate {
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

export function createPlanningProgressTool(onProgress?: EforgePlanPlanningProgressCallback, name = PLANNING_PROGRESS_TOOL_NAME): ExtensionAgentTaskCustomTool {
  return {
    name,
    description: 'Report telemetry-only section progress while drafting. This never replaces the final submission and does not affect readiness.',
    inputSchema: planningProgressToolSchema,
    handler: async (input: unknown) => {
      const update = sanitizeProgressUpdate(input);
      try {
        await onProgress?.(update);
      } catch {
        // Progress reporting is telemetry-only; never fail the task because a progress update could not be recorded.
      }
      return 'Section progress recorded.';
    },
  } as ExtensionAgentTaskCustomTool;
}

export function createPlanningDraftSubmitTool(options: {
  input?: EforgePlanPlanningDraftInput;
  name?: string;
  validate?: PlanningDraftResultValidator;
  successMessage?: string;
}): { tool: ExtensionAgentTaskCustomTool; getSubmitted: () => EforgePlanPlanningDraftResult | undefined; getRejections: () => string[] } {
  let submitted: EforgePlanPlanningDraftResult | undefined;
  const rejections: string[] = [];
  const submitToolName = options.name ?? PLANNING_DRAFT_SUBMIT_TOOL_NAME;
  const tool: ExtensionAgentTaskCustomTool = {
    name: submitToolName,
    description: 'Submit the final eforge-plan planning draft result. This is the only accepted output channel for this task.',
    inputSchema: planningDraftSubmissionToolSchema,
    handler: async (input: unknown) => {
      let parsed: EforgePlanPlanningDraftResult;
      try {
        parsed = parseEforgePlanPlanningDraftResult(input);
        if (submitted !== undefined) {
          return reject(rejections, 'Error: a planning result was already submitted. Submit exactly one final result.');
        }
        const readinessError = options.input === undefined ? undefined : validateSubmittedCreationDraftAgainstContext(parsed, options.input);
        if (readinessError !== undefined) return reject(rejections, readinessError);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const creationDraftGuidance = options.input === undefined ? undefined : formatCreationDraftSchemaGuidance(input, options.input);
        const schemaRejection = boundedRejectionMessage(`Submission rejected: ${message}`, creationDraftGuidance === undefined ? MAX_REJECTION_MESSAGE_LENGTH : 1_500);
        return reject(rejections, `${schemaRejection}${creationDraftGuidance === undefined ? '' : `\n${creationDraftGuidance}`}\nFix the payload and call ${submitToolName} again.`);
      }
      const extraValidation = await options.validate?.(parsed, input);
      const validationMessages = Array.isArray(extraValidation) ? extraValidation : extraValidation === undefined ? [] : [extraValidation];
      if (validationMessages.length > 0) return reject(rejections, [`Submission rejected by reducer validation:`, ...validationMessages].join('\n'));
      submitted = parsed;
      return options.successMessage ?? 'Planning draft result submitted successfully.';
    },
  } as ExtensionAgentTaskCustomTool;
  return { tool, getSubmitted: () => submitted, getRejections: () => [...rejections] };
}

function reject(rejections: string[], message: string): string {
  const bounded = boundedRejectionMessage(message);
  rejections.push(bounded);
  return bounded;
}

function sanitizeProgressString(value: string): string {
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length > MAX_PROGRESS_STRING_LENGTH ? `${cleaned.slice(0, MAX_PROGRESS_STRING_LENGTH - 3)}...` : cleaned;
}

function sanitizeProgressArray(values: string[]): string[] {
  return values.slice(0, MAX_PROGRESS_ARRAY_ITEMS).map(sanitizeProgressString).filter((entry) => entry.length > 0);
}

function validateSubmittedCreationDraftAgainstContext(result: EforgePlanPlanningDraftResult, input: EforgePlanPlanningDraftInput): string | undefined {
  const candidate = result as { decision?: unknown; sessionPlanCreationDraft?: EforgePlanPlanningSessionPlanCreationDraft };
  const draft = candidate.decision === 'ready' ? candidate.sessionPlanCreationDraft : undefined;
  if (draft === undefined) return undefined;
  const readiness = input.sessionPlanCreationReadiness;
  if (readiness?.resolved !== undefined && (readiness.resolved.planningType !== draft.planningType || readiness.resolved.planningDepth !== draft.planningDepth)) {
    return [
      `Submission rejected: sessionPlanCreationDraft planning contract mismatch.`,
      `expected planningType/planningDepth: ${readiness.resolved.planningType}/${readiness.resolved.planningDepth}`,
      `actual planningType/planningDepth: ${draft.planningType}/${draft.planningDepth}`,
      'Copy the planningType and planningDepth from sessionPlanCreationReadiness.resolved, then call the submit tool again.',
    ].join('\n');
  }
  const entry = resolveCreationReadinessEntry(input, draft.planningType, draft.planningDepth);
  if (entry === undefined) return undefined;
  const requiredIds = new Set(entry.requiredDimensions);
  const submittedSections = draft.sections.map((section) => section.dimension);
  const submittedSkips = draft.skippedDimensions ?? [];
  const unknownIds = [...new Set([...submittedSections, ...submittedSkips.map((skip) => skip.dimension)].filter((dimension) => !requiredIds.has(dimension)))];
  const coveredIds = new Set(submittedSections.filter((dimension) => requiredIds.has(dimension)));
  const skippedIds = new Set(submittedSkips.filter((skip) => requiredIds.has(skip.dimension) && skip.reason.trim().length > 0).map((skip) => skip.dimension));
  const blankSkipIds = [...new Set(submittedSkips.filter((skip) => requiredIds.has(skip.dimension) && skip.reason.trim().length === 0).map((skip) => skip.dimension))];
  const missingIds = entry.requiredDimensions.filter((dimension) => !coveredIds.has(dimension) && !skippedIds.has(dimension));
  if (unknownIds.length === 0 && missingIds.length === 0 && blankSkipIds.length === 0) return undefined;
  return [
    `Submission rejected: sessionPlanCreationDraft does not satisfy the provided readiness contract for ${draft.planningType}/${draft.planningDepth}.`,
    `expected required dimension ids: ${entry.requiredDimensions.join(', ')}`,
    ...(unknownIds.length > 0 ? [`unknown dimension ids: ${unknownIds.join(', ')}`] : []),
    ...(missingIds.length > 0 ? [`missing required dimension ids: ${missingIds.join(', ')}`] : []),
    ...(blankSkipIds.length > 0 ? [`${blankSkipIds.join(', ')} has a blank skip reason; skipped required dimensions need non-empty reasons.`] : []),
    'Use exact kebab-case ids from sessionPlanCreationReadiness; do not use display-heading aliases such as Goal, Scope, or Validation.',
    'Fix the payload and call the submit tool again, or emit needs-input if a ready draft cannot be produced.',
  ].join('\n');
}

function resolveCreationReadinessEntry(input: EforgePlanPlanningDraftInput, planningType: string, planningDepth: string): { requiredDimensions: string[]; optionalDimensions: string[] } | undefined {
  const readiness = input.sessionPlanCreationReadiness;
  if (readiness === undefined) return undefined;
  if (readiness.resolved !== undefined && readiness.resolved.planningType === planningType && readiness.resolved.planningDepth === planningDepth) return readiness.resolved;
  const byType = readiness.dimensionContract[planningType as keyof typeof readiness.dimensionContract];
  if (byType === undefined) return undefined;
  return byType[planningDepth as keyof typeof byType];
}

function formatCreationDraftSchemaGuidance(rawInput: unknown, input: EforgePlanPlanningDraftInput): string | undefined {
  const candidate = rawInput as { sessionPlanCreationDraft?: unknown } | undefined;
  if (candidate?.sessionPlanCreationDraft === undefined) return undefined;
  const draft = candidate.sessionPlanCreationDraft as { planningType?: unknown; planningDepth?: unknown };
  const entry = typeof draft.planningType === 'string' && typeof draft.planningDepth === 'string'
    ? resolveCreationReadinessEntry(input, draft.planningType, draft.planningDepth) ?? input.sessionPlanCreationReadiness?.resolved
    : input.sessionPlanCreationReadiness?.resolved;
  return [
    'For sessionPlanCreationDraft, dimension values must be exact kebab-case ids from sessionPlanCreationReadiness.',
    ...(entry !== undefined ? [`expected required dimension ids: ${entry.requiredDimensions.join(', ')}`] : []),
    'Do not use display-heading aliases such as Goal, Scope, or Validation.',
  ].join('\n');
}
