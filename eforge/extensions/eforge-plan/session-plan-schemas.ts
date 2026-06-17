import { Type, type Static } from '@eforge-build/extension-sdk';
import {
  ItemLifecycleProjectionSchema,
  JsonValueSchema,
  LifecycleLinkRowSchema,
  LifecycleStateSchema,
  ListBoardOutputSchema,
  PlanSourceRefsSchema,
  PlanningProfileSchema,
  SessionPlanLifecycleProjectionSchema,
} from './schema.js';

// --- eforge:region session-plan-schemas ---
export const PlanningTypeSchema = Type.Union([
  Type.Literal('bugfix'),
  Type.Literal('feature'),
  Type.Literal('refactor'),
  Type.Literal('architecture'),
  Type.Literal('docs'),
  Type.Literal('maintenance'),
  Type.Literal('unknown'),
]);
export const PlanningDepthSchema = Type.Union([
  Type.Literal('quick'),
  Type.Literal('focused'),
  Type.Literal('deep'),
]);
const JsonObjectAdditionalProperties = { additionalProperties: JsonValueSchema } as const;
// Mirrors AcDiagnostic from @eforge-build/input/acceptance-criteria-quality.
export const AcDiagnosticSchema = Type.Object({
  kind: Type.Union([
    Type.Literal('grouping-label'),
    Type.Literal('bare-command'),
    Type.Literal('manual-only'),
    Type.Literal('vague'),
  ]),
  line: Type.String(),
  message: Type.String(),
  suggestion: Type.String(),
});
export const SessionPlanReadinessDetailSchema = Type.Object({
  ready: Type.Boolean(),
  missingDimensions: Type.Array(Type.String()),
  coveredDimensions: Type.Array(Type.String()),
  skippedDimensions: Type.Array(Type.String()),
  acDiagnostics: Type.Optional(Type.Array(AcDiagnosticSchema)),
}, JsonObjectAdditionalProperties);
export const SessionPlanProjectionSchema = Type.Object({
  session: Type.String(),
  topic: Type.String(),
  status: Type.String(),
  body: Type.String(),
}, JsonObjectAdditionalProperties);
export const SessionPlanDetailOutputSchema = Type.Object({
  plan: SessionPlanProjectionSchema,
  readiness: SessionPlanReadinessDetailSchema,
  path: Type.String(),
  sourceRefs: Type.Optional(PlanSourceRefsSchema),
  lifecycle: Type.Optional(SessionPlanLifecycleProjectionSchema),
}, JsonObjectAdditionalProperties);
export const PlanningArtifactSchema = Type.Object({
  kind: Type.Union([Type.Literal('plan'), Type.Literal('plan-set')]),
  key: Type.String(),
  sourceRefs: Type.Optional(PlanSourceRefsSchema),
  lifecycleState: Type.Optional(LifecycleStateSchema),
  itemRows: Type.Optional(Type.Array(ItemLifecycleProjectionSchema)),
  linkRows: Type.Optional(Type.Array(LifecycleLinkRowSchema)),
  failureEvidence: Type.Optional(Type.Array(LifecycleLinkRowSchema)),
}, JsonObjectAdditionalProperties);
export const ListPlanningArtifactsInputSchema = Type.Object({
  includeSubmitted: Type.Optional(Type.Boolean()),
  includeArchive: Type.Optional(Type.Boolean()),
  epic: Type.Optional(Type.String()),
});
export const ListPlanningArtifactsOutputSchema = Type.Object({
  artifacts: Type.Array(PlanningArtifactSchema),
  plans: Type.Array(PlanningArtifactSchema),
  planSets: Type.Array(PlanningArtifactSchema),
  board: Type.Optional(ListBoardOutputSchema),
}, JsonObjectAdditionalProperties);
export const ShowSessionPlanInputSchema = Type.Object({ session: Type.String() });
export const ShowSessionPlanOutputSchema = SessionPlanDetailOutputSchema;
export const ShowSessionPlanSetInputSchema = Type.Object({ planSetId: Type.String() });
export const ShowSessionPlanSetOutputSchema = Type.Object({
  planSet: Type.Record(Type.String(), JsonValueSchema),
  validation: Type.Record(Type.String(), JsonValueSchema),
  dir: Type.String(),
  manifestPath: Type.String(),
  anchorContent: Type.Optional(Type.String()),
}, JsonObjectAdditionalProperties);
export const CreateSessionPlanInputSchema = Type.Object({
  session: Type.String(),
  topic: Type.String(),
  planningType: Type.Optional(PlanningTypeSchema),
  planningDepth: Type.Optional(PlanningDepthSchema),
  profile: Type.Optional(Type.Union([PlanningProfileSchema, Type.Null()])),
  agentProfile: Type.Optional(Type.String()),
});
export const CreateSessionPlanOutputSchema = Type.Object({
  session: Type.String(),
  path: Type.String(),
  plan: SessionPlanProjectionSchema,
  readiness: SessionPlanReadinessDetailSchema,
}, JsonObjectAdditionalProperties);
export const SetSessionPlanSectionInputSchema = Type.Object({
  session: Type.String(),
  dimension: Type.String(),
  content: Type.String(),
});
export const SetSessionPlanSectionOutputSchema = Type.Object({
  session: Type.String(),
  path: Type.String(),
  readiness: SessionPlanReadinessDetailSchema,
  plan: SessionPlanProjectionSchema,
}, JsonObjectAdditionalProperties);
export const SelectSessionPlanDimensionsInputSchema = Type.Object({
  session: Type.String(),
  planningType: Type.Optional(PlanningTypeSchema),
  planningDepth: Type.Optional(PlanningDepthSchema),
  overwrite: Type.Optional(Type.Boolean()),
});
export const SelectSessionPlanDimensionsOutputSchema = Type.Object({
  session: Type.String(),
  path: Type.String(),
  required_dimensions: Type.Array(Type.String()),
  optional_dimensions: Type.Array(Type.String()),
  readiness: SessionPlanReadinessDetailSchema,
  plan: SessionPlanProjectionSchema,
}, JsonObjectAdditionalProperties);
export const CheckSessionPlanReadinessInputSchema = Type.Object({ session: Type.String() });
export const CheckSessionPlanReadinessOutputSchema = Type.Object({
  session: Type.String(),
  readiness: SessionPlanReadinessDetailSchema,
}, JsonObjectAdditionalProperties);
export const SetSessionPlanReadyInputSchema = Type.Object({ session: Type.String() });
export const SetSessionPlanReadyOutputSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('not-ready'),
    session: Type.String(),
    readiness: SessionPlanReadinessDetailSchema,
    message: Type.String(),
  }, JsonObjectAdditionalProperties),
  Type.Object({
    kind: Type.Literal('ready'),
    session: Type.String(),
    status: Type.String(),
    readiness: SessionPlanReadinessDetailSchema,
    plan: SessionPlanProjectionSchema,
  }, JsonObjectAdditionalProperties),
]);
export const DeleteSessionPlanInputSchema = Type.Object({ session: Type.String() });
export const DeleteSessionPlanOutputSchema = Type.Object({
  kind: Type.Literal('deleted'),
  session: Type.String(),
  status: Type.Literal('abandoned'),
  message: Type.String(),
  plan: SessionPlanProjectionSchema,
}, JsonObjectAdditionalProperties);
export const UpdateSessionPlanMetadataInputSchema = Type.Object({
  session: Type.String(),
  profile: Type.Optional(Type.Union([PlanningProfileSchema, Type.Null()])),
  agentProfile: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  openQuestions: Type.Optional(Type.Array(Type.String())),
});
export const UpdateSessionPlanMetadataOutputSchema = SessionPlanDetailOutputSchema;
export const HandoffSessionPlanInputSchema = Type.Object({ session: Type.String() });
export const HandoffSessionPlanOutputSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('not-ready'),
    session: Type.String(),
    readiness: SessionPlanReadinessDetailSchema,
    message: Type.String(),
  }, JsonObjectAdditionalProperties),
  Type.Object({
    kind: Type.Literal('enqueued'), session: Type.String(), sourcePath: Type.String(), absolutePath: Type.String(),
    queueSessionId: Type.String(), pid: Type.Number(), autoBuild: Type.Boolean(), message: Type.String(),
    readiness: SessionPlanReadinessDetailSchema,
  }, JsonObjectAdditionalProperties),
  Type.Object({
    kind: Type.Literal('enqueue-failed'), session: Type.String(), sourcePath: Type.String(), absolutePath: Type.String(),
    command: Type.String(), message: Type.String(), readiness: SessionPlanReadinessDetailSchema,
  }, JsonObjectAdditionalProperties),
]);
// --- eforge:endregion session-plan-schemas ---

export type PlanningTypeInput = Static<typeof PlanningTypeSchema>;
export type PlanningDepthInput = Static<typeof PlanningDepthSchema>;
export type ListPlanningArtifactsInput = Static<typeof ListPlanningArtifactsInputSchema>;
export type ShowSessionPlanInput = Static<typeof ShowSessionPlanInputSchema>;
export type ShowSessionPlanSetInput = Static<typeof ShowSessionPlanSetInputSchema>;
export type CreateSessionPlanInput = Static<typeof CreateSessionPlanInputSchema>;
export type SetSessionPlanSectionInput = Static<typeof SetSessionPlanSectionInputSchema>;
export type SelectSessionPlanDimensionsInput = Static<typeof SelectSessionPlanDimensionsInputSchema>;
export type CheckSessionPlanReadinessInput = Static<typeof CheckSessionPlanReadinessInputSchema>;
export type SetSessionPlanReadyInput = Static<typeof SetSessionPlanReadyInputSchema>;
export type DeleteSessionPlanInput = Static<typeof DeleteSessionPlanInputSchema>;
export type UpdateSessionPlanMetadataInput = Static<typeof UpdateSessionPlanMetadataInputSchema>;
export type HandoffSessionPlanInput = Static<typeof HandoffSessionPlanInputSchema>;
