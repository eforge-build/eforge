import { Type, type Static } from '@sinclair/typebox';
import {
  EforgePlanPlanningBacklogSafeIdSchema,
  EforgePlanPlanningNonEmptyStringSchema,
  EforgePlanPlanningSha256HexSchema,
} from './common.js';

export const EforgePlanPlanningBacklogCurationRecordKindSchema = Type.Union([Type.Literal('item'), Type.Literal('epic')]);

const eforgePlanPlanningBacklogCurationPreconditionFields = {
  id: EforgePlanPlanningBacklogSafeIdSchema,
  origin: Type.Optional(Type.Union([Type.Literal('private'), Type.Literal('legacy')])),
  relativePath: Type.Optional(EforgePlanPlanningNonEmptyStringSchema),
  bodySha256: EforgePlanPlanningSha256HexSchema,
  sourceFingerprint: Type.Optional(EforgePlanPlanningSha256HexSchema),
  updated: Type.Optional(Type.String()),
  recordSha256: Type.Optional(EforgePlanPlanningSha256HexSchema),
} as const;

export const EforgePlanPlanningBacklogCurationPreconditionSchema = Type.Object({
  ...eforgePlanPlanningBacklogCurationPreconditionFields,
  kind: EforgePlanPlanningBacklogCurationRecordKindSchema,
}, { additionalProperties: false });

export const EforgePlanPlanningBacklogCurationItemPreconditionSchema = Type.Object({
  ...eforgePlanPlanningBacklogCurationPreconditionFields,
  kind: Type.Literal('item'),
}, { additionalProperties: false });

export const EforgePlanPlanningBacklogCurationEpicPreconditionSchema = Type.Object({
  ...eforgePlanPlanningBacklogCurationPreconditionFields,
  kind: Type.Literal('epic'),
}, { additionalProperties: false });

const EforgePlanPlanningBacklogStatusSchema = Type.Union([
  Type.Literal('candidate'),
  Type.Literal('planned'),
  Type.Literal('active'),
  Type.Literal('shipped'),
  Type.Literal('stale'),
  Type.Literal('superseded'),
]);

export const EforgePlanPlanningBacklogCurationMetadataPatchSchema = Type.Object({
  status: Type.Optional(EforgePlanPlanningBacklogStatusSchema),
  priority: Type.Optional(Type.String()),
  tags: Type.Optional(Type.Array(Type.String())),
  depends_on: Type.Optional(Type.Array(EforgePlanPlanningBacklogSafeIdSchema)),
  epic: Type.Optional(Type.Union([EforgePlanPlanningBacklogSafeIdSchema, Type.Null()])),
  last_checked: Type.Optional(Type.String()),
  stale_after: Type.Optional(Type.String()),
}, { additionalProperties: false });

export const EforgePlanPlanningBacklogCurationSectionOperationSchema = Type.Object({
  heading: EforgePlanPlanningNonEmptyStringSchema,
  action: Type.Union([Type.Literal('replace'), Type.Literal('append')]),
  content: Type.String(),
}, { additionalProperties: false });

const eforgePlanPlanningBacklogCurationRecordPatchFields = {
  id: EforgePlanPlanningBacklogSafeIdSchema,
  metadata: Type.Optional(EforgePlanPlanningBacklogCurationMetadataPatchSchema),
  sectionOperations: Type.Optional(Type.Array(EforgePlanPlanningBacklogCurationSectionOperationSchema)),
  rationale: EforgePlanPlanningNonEmptyStringSchema,
  evidence: Type.Optional(Type.Array(Type.String())),
} as const;

export const EforgePlanPlanningBacklogCurationItemRecordPatchSchema = Type.Object({
  ...eforgePlanPlanningBacklogCurationRecordPatchFields,
  kind: Type.Literal('item'),
  precondition: EforgePlanPlanningBacklogCurationItemPreconditionSchema,
}, { additionalProperties: false });

export const EforgePlanPlanningBacklogCurationEpicRecordPatchSchema = Type.Object({
  ...eforgePlanPlanningBacklogCurationRecordPatchFields,
  kind: Type.Literal('epic'),
  precondition: EforgePlanPlanningBacklogCurationEpicPreconditionSchema,
}, { additionalProperties: false });

export const EforgePlanPlanningBacklogCurationRecordPatchSchema = Type.Union([
  EforgePlanPlanningBacklogCurationItemRecordPatchSchema,
  EforgePlanPlanningBacklogCurationEpicRecordPatchSchema,
]);

const eforgePlanPlanningBacklogCurationRecheckFields = {
  id: EforgePlanPlanningBacklogSafeIdSchema,
  last_checked: Type.String(),
  stale_after: Type.String(),
  rationale: Type.Optional(Type.String()),
} as const;

export const EforgePlanPlanningBacklogCurationItemRecheckSchema = Type.Object({
  ...eforgePlanPlanningBacklogCurationRecheckFields,
  kind: Type.Literal('item'),
  precondition: EforgePlanPlanningBacklogCurationItemPreconditionSchema,
}, { additionalProperties: false });

export const EforgePlanPlanningBacklogCurationEpicRecheckSchema = Type.Object({
  ...eforgePlanPlanningBacklogCurationRecheckFields,
  kind: Type.Literal('epic'),
  precondition: EforgePlanPlanningBacklogCurationEpicPreconditionSchema,
}, { additionalProperties: false });

export const EforgePlanPlanningBacklogCurationRecheckSchema = Type.Union([
  EforgePlanPlanningBacklogCurationItemRecheckSchema,
  EforgePlanPlanningBacklogCurationEpicRecheckSchema,
]);

export const EforgePlanPlanningBacklogCurationSkippedSchema = Type.Object({
  id: Type.Optional(EforgePlanPlanningBacklogSafeIdSchema),
  kind: Type.Optional(EforgePlanPlanningBacklogCurationRecordKindSchema),
  reason: EforgePlanPlanningNonEmptyStringSchema,
}, { additionalProperties: false });

export const EforgePlanPlanningBacklogCurationNeedsInputSchema = Type.Object({
  id: Type.Optional(EforgePlanPlanningBacklogSafeIdSchema),
  kind: Type.Optional(EforgePlanPlanningBacklogCurationRecordKindSchema),
  question: EforgePlanPlanningNonEmptyStringSchema,
  reason: Type.Optional(EforgePlanPlanningNonEmptyStringSchema),
}, { additionalProperties: false });

export const EforgePlanPlanningBacklogCurationDraftSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  sourceFingerprint: EforgePlanPlanningSha256HexSchema,
  generatedAt: Type.Optional(Type.String()),
  summary: Type.Array(Type.String()),
  itemChanges: Type.Array(EforgePlanPlanningBacklogCurationItemRecordPatchSchema),
  epicChanges: Type.Array(EforgePlanPlanningBacklogCurationEpicRecordPatchSchema),
  noOpRechecks: Type.Array(EforgePlanPlanningBacklogCurationRecheckSchema),
  skipped: Type.Array(EforgePlanPlanningBacklogCurationSkippedSchema),
  needsInput: Type.Array(EforgePlanPlanningBacklogCurationNeedsInputSchema),
}, { additionalProperties: false });

export type EforgePlanPlanningBacklogCurationRecordKind = Static<typeof EforgePlanPlanningBacklogCurationRecordKindSchema>;
export type EforgePlanPlanningBacklogCurationPrecondition = Static<typeof EforgePlanPlanningBacklogCurationPreconditionSchema>;
export type EforgePlanPlanningBacklogCurationMetadataPatch = Static<typeof EforgePlanPlanningBacklogCurationMetadataPatchSchema>;
export type EforgePlanPlanningBacklogCurationSectionOperation = Static<typeof EforgePlanPlanningBacklogCurationSectionOperationSchema>;
export type EforgePlanPlanningBacklogCurationRecordPatch = Static<typeof EforgePlanPlanningBacklogCurationRecordPatchSchema>;
export type EforgePlanPlanningBacklogCurationRecheck = Static<typeof EforgePlanPlanningBacklogCurationRecheckSchema>;
export type EforgePlanPlanningBacklogCurationSkipped = Static<typeof EforgePlanPlanningBacklogCurationSkippedSchema>;
export type EforgePlanPlanningBacklogCurationNeedsInput = Static<typeof EforgePlanPlanningBacklogCurationNeedsInputSchema>;
export type EforgePlanPlanningBacklogCurationDraft = Static<typeof EforgePlanPlanningBacklogCurationDraftSchema>;
