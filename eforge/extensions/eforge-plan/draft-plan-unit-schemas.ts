import { Type, type Static } from '@eforge-build/extension-sdk';
import { PlanningProfileSchema, PromotionSelectionOutputSchema } from './schema.js';

// A draft plan unit is the editable convergence layer between an AI
// recommendation lane and a session plan. Forked from a lane (or authored from
// scratch) it holds a curated grouping + intent that the user shapes directly,
// then promotes plan-first into the existing session-plan flow. It deliberately
// carries grouping/intent only - scope, acceptance criteria, and readiness still
// belong to the session plan it promotes into.

// Where the unit as a whole came from: descended from a recommendation lane, or
// authored by the user from scratch.
export const DraftPlanUnitProvenanceSchema = Type.Union([
  Type.Literal('recommendation'),
  Type.Literal('user'),
]);
export type DraftPlanUnitProvenance = Static<typeof DraftPlanUnitProvenanceSchema>;

// Where a single item in the unit came from: grouped by the AI in the forked
// lane, or added by the user after the fork.
export const DraftPlanUnitItemOriginSchema = Type.Union([
  Type.Literal('recommendation'),
  Type.Literal('user'),
]);
export type DraftPlanUnitItemOrigin = Static<typeof DraftPlanUnitItemOriginSchema>;

export const DraftPlanUnitItemSchema = Type.Object({
  itemId: Type.String({ minLength: 1 }),
  origin: DraftPlanUnitItemOriginSchema,
}, { additionalProperties: false });
export type DraftPlanUnitItem = Static<typeof DraftPlanUnitItemSchema>;

export const DraftPlanUnitStatusSchema = Type.Union([
  Type.Literal('draft'),
  Type.Literal('promoted'),
]);
export type DraftPlanUnitStatus = Static<typeof DraftPlanUnitStatusSchema>;

export const DraftPlanUnitSchema = Type.Object({
  unitId: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 1 }),
  intent: Type.Optional(Type.String()),
  provenance: DraftPlanUnitProvenanceSchema,
  sourceRecommendationRef: Type.Optional(Type.String()),
  profile: Type.Optional(PlanningProfileSchema),
  items: Type.Array(DraftPlanUnitItemSchema),
  status: DraftPlanUnitStatusSchema,
  promotedSession: Type.Optional(Type.String()),
  promotedAt: Type.Optional(Type.String()),
  createdAt: Type.String(),
  updatedAt: Type.String(),
}, { additionalProperties: false });
export type DraftPlanUnit = Static<typeof DraftPlanUnitSchema>;

export const DraftPlanUnitIndexSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  units: Type.Array(DraftPlanUnitSchema),
}, { additionalProperties: false });
export type DraftPlanUnitIndex = Static<typeof DraftPlanUnitIndexSchema>;

// --- action wire shapes ---

export const ForkRecommendationToDraftUnitInputSchema = Type.Object({
  recommendationRef: Type.String({ minLength: 1 }),
  title: Type.Optional(Type.String({ minLength: 1 })),
}, { additionalProperties: false });

export const CreateDraftUnitInputSchema = Type.Object({
  title: Type.String({ minLength: 1 }),
  intent: Type.Optional(Type.String()),
  profile: Type.Optional(PlanningProfileSchema),
  itemIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true })),
}, { additionalProperties: false });

export const ListDraftUnitsInputSchema = Type.Object({}, { additionalProperties: false });

export const DraftUnitIdInputSchema = Type.Object({
  unitId: Type.String({ minLength: 1 }),
}, { additionalProperties: false });

export const UpdateDraftUnitInputSchema = Type.Object({
  unitId: Type.String({ minLength: 1 }),
  title: Type.Optional(Type.String({ minLength: 1 })),
  intent: Type.Optional(Type.String()),
  // Empty string clears the profile back to unset.
  profile: Type.Optional(Type.Union([PlanningProfileSchema, Type.Literal('')])),
  addItemIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true })),
  removeItemIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true })),
  // Explicit ordering of the surviving item set; ids not present are appended in
  // their existing order.
  itemOrder: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true })),
}, { additionalProperties: false });

export const DraftUnitOutputSchema = Type.Object({
  unit: DraftPlanUnitSchema,
}, { additionalProperties: false });

export const ListDraftUnitsOutputSchema = Type.Object({
  units: Type.Array(DraftPlanUnitSchema),
}, { additionalProperties: false });

export const DeleteDraftUnitOutputSchema = Type.Object({
  unitId: Type.String({ minLength: 1 }),
  deleted: Type.Boolean(),
}, { additionalProperties: false });

export const PromoteDraftUnitInputSchema = Type.Object({
  unitId: Type.String({ minLength: 1 }),
  status: Type.Optional(Type.Union([Type.Literal('active'), Type.Literal('planned')])),
  session: Type.Optional(Type.String()),
}, { additionalProperties: false });

export const PromoteDraftUnitOutputSchema = Type.Object({
  unit: DraftPlanUnitSchema,
  promotion: PromotionSelectionOutputSchema,
}, { additionalProperties: false });

// --- merge / split + dependency advisory ---

// Non-blocking advice from the dependency-graph advisor. 'caution' means the
// proposed reshape works against the dependency structure (a split separating a
// dependency, or a merge serializing independent work); 'ok' confirms it is
// consistent. The user always decides - the advisory never gates the operation.
export const DraftUnitAdvisorySeveritySchema = Type.Union([
  Type.Literal('ok'),
  Type.Literal('caution'),
]);
export type DraftUnitAdvisorySeverity = Static<typeof DraftUnitAdvisorySeveritySchema>;

export const DraftUnitAdvisoryFindingCodeSchema = Type.Union([
  Type.Literal('split-crosses-dependency'),
  Type.Literal('split-respects-dependencies'),
  Type.Literal('merge-justified-by-dependency'),
  Type.Literal('merge-independent-units'),
]);
export type DraftUnitAdvisoryFindingCode = Static<typeof DraftUnitAdvisoryFindingCodeSchema>;

export const DraftUnitAdvisoryFindingSchema = Type.Object({
  code: DraftUnitAdvisoryFindingCodeSchema,
  message: Type.String(),
  itemIds: Type.Array(Type.String()),
}, { additionalProperties: false });
export type DraftUnitAdvisoryFinding = Static<typeof DraftUnitAdvisoryFindingSchema>;

export const DraftUnitAdvisorySchema = Type.Object({
  severity: DraftUnitAdvisorySeveritySchema,
  findings: Type.Array(DraftUnitAdvisoryFindingSchema),
}, { additionalProperties: false });
export type DraftUnitAdvisory = Static<typeof DraftUnitAdvisorySchema>;

export const MergeDraftUnitsInputSchema = Type.Object({
  // At least two distinct draft units to combine, in the order their items
  // should be concatenated (first occurrence of a shared item wins its origin).
  unitIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 2, uniqueItems: true }),
  // Optional overrides for the merged unit; default to the first unit's values.
  title: Type.Optional(Type.String({ minLength: 1 })),
  intent: Type.Optional(Type.String()),
  profile: Type.Optional(PlanningProfileSchema),
}, { additionalProperties: false });

export const MergeDraftUnitsOutputSchema = Type.Object({
  unit: DraftPlanUnitSchema,
  removedUnitIds: Type.Array(Type.String()),
  advisory: DraftUnitAdvisorySchema,
}, { additionalProperties: false });

export const SplitDraftUnitInputSchema = Type.Object({
  unitId: Type.String({ minLength: 1 }),
  // The subset of the unit's items to peel off into a new unit. Must be a
  // non-empty strict subset so both the original and the new unit keep items.
  itemIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, uniqueItems: true }),
  title: Type.String({ minLength: 1 }),
  intent: Type.Optional(Type.String()),
  profile: Type.Optional(PlanningProfileSchema),
}, { additionalProperties: false });

export const SplitDraftUnitOutputSchema = Type.Object({
  original: DraftPlanUnitSchema,
  created: DraftPlanUnitSchema,
  advisory: DraftUnitAdvisorySchema,
}, { additionalProperties: false });

export const AdviseMergeDraftUnitsInputSchema = Type.Object({
  unitIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 2, uniqueItems: true }),
}, { additionalProperties: false });

export const AdviseSplitDraftUnitInputSchema = Type.Object({
  unitId: Type.String({ minLength: 1 }),
  itemIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, uniqueItems: true }),
}, { additionalProperties: false });

export const AdvisoryOutputSchema = Type.Object({
  advisory: DraftUnitAdvisorySchema,
}, { additionalProperties: false });
