import { Type, type Static } from '@sinclair/typebox';
import { EforgePlanPlanningNonEmptyStringSchema, EforgePlanPlanningSha256HexSchema } from './common.js';

export const EforgePlanPlanningPlanRevisionBaseSectionHashSchema = Type.Object({
  dimension: Type.String(),
  sha256: EforgePlanPlanningSha256HexSchema,
}, { additionalProperties: false });

export const EforgePlanPlanningPlanRevisionProposedSectionEditSchema = Type.Object({
  dimension: Type.String(),
  content: EforgePlanPlanningNonEmptyStringSchema,
  rationale: Type.Optional(Type.String()),
}, { additionalProperties: false });

export const EforgePlanPlanningPlanRevisionMetadataGuidanceSchema = Type.Object({
  openQuestions: Type.Optional(Type.Array(EforgePlanPlanningNonEmptyStringSchema)),
}, { additionalProperties: false });

export const EforgePlanPlanningPlanRevisionSkippedDimensionGuidanceSchema = Type.Object({
  dimension: Type.String(),
  reason: EforgePlanPlanningNonEmptyStringSchema,
}, { additionalProperties: false });

export const EforgePlanPlanningPlanRevisionProposedPatchSchema = Type.Object({
  sections: Type.Optional(Type.Array(EforgePlanPlanningPlanRevisionProposedSectionEditSchema, { minItems: 1 })),
  metadata: Type.Optional(EforgePlanPlanningPlanRevisionMetadataGuidanceSchema),
  skippedDimensions: Type.Optional(Type.Array(EforgePlanPlanningPlanRevisionSkippedDimensionGuidanceSchema)),
}, { additionalProperties: false });

export const EforgePlanPlanningPlanRevisionCitationSchema = Type.Object({
  label: EforgePlanPlanningNonEmptyStringSchema,
  excerpt: Type.Optional(Type.String()),
  path: Type.Optional(Type.String()),
  url: Type.Optional(Type.String()),
}, { additionalProperties: false });

export const EforgePlanPlanningPlanRevisionTurnSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  targetSession: EforgePlanPlanningNonEmptyStringSchema,
  assistantMessage: EforgePlanPlanningNonEmptyStringSchema,
  basePlanFingerprint: EforgePlanPlanningSha256HexSchema,
  baseSectionHashes: Type.Optional(Type.Array(EforgePlanPlanningPlanRevisionBaseSectionHashSchema)),
  proposedPatch: Type.Optional(EforgePlanPlanningPlanRevisionProposedPatchSchema),
  citations: Type.Optional(Type.Array(EforgePlanPlanningPlanRevisionCitationSchema)),
  applyGuidance: Type.Optional(Type.String()),
  noPatchReason: Type.Optional(Type.String()),
}, { additionalProperties: false });

export type EforgePlanPlanningPlanRevisionBaseSectionHash = Static<typeof EforgePlanPlanningPlanRevisionBaseSectionHashSchema>;
export type EforgePlanPlanningPlanRevisionProposedSectionEdit = Static<typeof EforgePlanPlanningPlanRevisionProposedSectionEditSchema>;
export type EforgePlanPlanningPlanRevisionMetadataGuidance = Static<typeof EforgePlanPlanningPlanRevisionMetadataGuidanceSchema>;
export type EforgePlanPlanningPlanRevisionSkippedDimensionGuidance = Static<typeof EforgePlanPlanningPlanRevisionSkippedDimensionGuidanceSchema>;
export type EforgePlanPlanningPlanRevisionProposedPatch = Static<typeof EforgePlanPlanningPlanRevisionProposedPatchSchema>;
export type EforgePlanPlanningPlanRevisionCitation = Static<typeof EforgePlanPlanningPlanRevisionCitationSchema>;
export type EforgePlanPlanningPlanRevisionTurn = Static<typeof EforgePlanPlanningPlanRevisionTurnSchema>;
