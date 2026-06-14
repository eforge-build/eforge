import {
  createSessionPlan,
  getReadinessDetail,
  getSessionPlanDimensionSpec,
  setSessionPlanDimensions,
  setSessionPlanSection,
  skipDimension,
  type PlanningDepth,
  type PlanningType,
} from './session-plan.js';
import { analyzeAcceptanceCriteria, type AcDiagnostic } from './acceptance-criteria-quality.js';

export interface SessionPlanCreationDraftSection {
  dimension: string;
  content: string;
}

export interface SessionPlanCreationDraftSkippedDimension {
  dimension: string;
  reason: string;
}

export interface SessionPlanCreationDraftReadinessInput {
  session: string;
  topic: string;
  planningType: PlanningType;
  planningDepth: PlanningDepth;
  sections: SessionPlanCreationDraftSection[];
  skippedDimensions?: SessionPlanCreationDraftSkippedDimension[];
}

export interface SessionPlanCreationDraftReadinessValidation {
  valid: boolean;
  planningType: PlanningType;
  planningDepth: PlanningDepth;
  requiredDimensions: string[];
  optionalDimensions: string[];
  unknownDimensions: string[];
  missingDimensions: string[];
  skippedDimensions: string[];
  coveredDimensions: string[];
  blankSkippedDimensions: string[];
  acDiagnostics?: AcDiagnostic[];
  messages: string[];
}

export function validateSessionPlanCreationDraftReadiness(
  draft: SessionPlanCreationDraftReadinessInput,
): SessionPlanCreationDraftReadinessValidation {
  const spec = getSessionPlanDimensionSpec(draft.planningType, draft.planningDepth);
  const requiredIds = new Set(spec.required);
  const unknownDimensions = unique([
    ...draft.sections.map((section) => section.dimension).filter((dimension) => !requiredIds.has(dimension)),
    ...(draft.skippedDimensions ?? []).map((skipped) => skipped.dimension).filter((dimension) => !requiredIds.has(dimension)),
  ]);
  const blankSkippedDimensions = unique((draft.skippedDimensions ?? [])
    .filter((skipped) => requiredIds.has(skipped.dimension) && skipped.reason.trim().length === 0)
    .map((skipped) => skipped.dimension));

  let plan = createSessionPlan({
    session: draft.session,
    topic: draft.topic,
    planningType: draft.planningType,
    planningDepth: draft.planningDepth,
  });
  plan = setSessionPlanDimensions(plan, { planningType: draft.planningType, planningDepth: draft.planningDepth, overwrite: true });

  const acceptanceCriteriaSections = draft.sections.filter((section) => section.dimension === 'acceptance-criteria');
  const acDiagnostics = acceptanceCriteriaSections.flatMap((section) => {
    const result = analyzeAcceptanceCriteria(section.content);
    return result.valid ? [] : result.diagnostics;
  });

  for (const section of draft.sections) {
    if (requiredIds.has(section.dimension)) {
      plan = setSessionPlanSection(plan, section.dimension, section.content);
    }
  }
  for (const skipped of draft.skippedDimensions ?? []) {
    if (requiredIds.has(skipped.dimension) && skipped.reason.trim().length > 0) {
      plan = skipDimension(plan, skipped.dimension, skipped.reason);
    }
  }

  const readiness = getReadinessDetail(plan);
  const messages = buildValidationMessages({
    planningType: draft.planningType,
    planningDepth: draft.planningDepth,
    requiredDimensions: [...spec.required],
    unknownDimensions,
    missingDimensions: readiness.missingDimensions,
    blankSkippedDimensions,
    acDiagnostics: acDiagnostics.length > 0 ? acDiagnostics : readiness.acDiagnostics,
  });
  const valid = unknownDimensions.length === 0
    && readiness.missingDimensions.length === 0
    && blankSkippedDimensions.length === 0
    && acDiagnostics.length === 0
    && readiness.acDiagnostics === undefined;

  return {
    valid,
    planningType: draft.planningType,
    planningDepth: draft.planningDepth,
    requiredDimensions: [...spec.required],
    optionalDimensions: [...spec.optional],
    unknownDimensions,
    missingDimensions: readiness.missingDimensions,
    skippedDimensions: readiness.skippedDimensions,
    coveredDimensions: readiness.coveredDimensions,
    blankSkippedDimensions,
    ...(acDiagnostics.length > 0 ? { acDiagnostics } : readiness.acDiagnostics !== undefined ? { acDiagnostics: readiness.acDiagnostics } : {}),
    messages: valid ? [] : messages,
  };
}

function buildValidationMessages(input: {
  planningType: PlanningType;
  planningDepth: PlanningDepth;
  requiredDimensions: string[];
  unknownDimensions: string[];
  missingDimensions: string[];
  blankSkippedDimensions: string[];
  acDiagnostics?: AcDiagnostic[];
}): string[] {
  const messages = [
    `sessionPlanCreationDraft readiness failed for ${input.planningType}/${input.planningDepth}.`,
    `expected required dimension ids: ${input.requiredDimensions.join(', ')}`,
  ];
  if (input.unknownDimensions.length > 0) messages.push(`unknown dimension ids: ${input.unknownDimensions.join(', ')}`);
  if (input.missingDimensions.length > 0) messages.push(`missing required dimension ids: ${input.missingDimensions.join(', ')}`);
  if (input.blankSkippedDimensions.length > 0) messages.push(`${input.blankSkippedDimensions.join(', ')} has a blank skip reason; skipped required dimensions need non-empty reasons.`);
  if (input.acDiagnostics !== undefined) {
    messages.push(`acceptance criteria diagnostics: ${input.acDiagnostics.map(formatAcDiagnostic).join('; ')}`);
  }
  messages.push('Do not use display-heading aliases as dimension ids; use exact kebab-case ids, not Goal, Scope, or Validation.');
  return messages;
}

function formatAcDiagnostic(diagnostic: AcDiagnostic): string {
  return `${diagnostic.message} (${diagnostic.line}) ${diagnostic.suggestion}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
