import { Type, type Static } from '../../../packages/extension-sdk/src/index.js';
import { EforgePlanPlanningRequestedOutputSectionSchema, ExtensionAgentTaskIdSchema, ExtensionAgentTaskRecordSchema } from '../../../packages/client/src/extension-agent-tasks.js';
import { RecommendationDerivedStatusSchema, RecommendationSummarySchema, BacklogRecommendationModelSchema } from './schema.js';

export const AnalyzeAllBacklogInputSchema = Type.Object({}, { additionalProperties: false });

const SourceFingerprintSchema = Type.String({ minLength: 64, maxLength: 64, pattern: '^[A-Fa-f0-9]{64}$' });

const AnalyzeAllBacklogWorkflowEntrySchema = Type.Object({
  taskId: ExtensionAgentTaskIdSchema,
  parentTaskId: Type.Optional(ExtensionAgentTaskIdSchema),
  originalRequest: Type.String(),
  derivedRequest: Type.String(),
  selection: Type.Object({
    itemIds: Type.Optional(Type.Array(Type.String())),
    epicId: Type.Optional(Type.String()),
    recommendationRef: Type.Optional(Type.String()),
  }, { additionalProperties: false }),
  requestedOutputSections: Type.Array(EforgePlanPlanningRequestedOutputSectionSchema),
  session: Type.Optional(Type.String()),
  planningType: Type.Optional(Type.String()),
  planningDepth: Type.Optional(Type.String()),
  includeRoadmap: Type.Optional(Type.Boolean()),
  purpose: Type.Literal('backlog-curation'),
  sourceFingerprint: SourceFingerprintSchema,
  appliedAt: Type.Optional(Type.String()),
  createdAt: Type.String(),
}, { additionalProperties: false });

export const AnalyzeAllBacklogOutputSchema = Type.Object({
  task: ExtensionAgentTaskRecordSchema,
  entry: AnalyzeAllBacklogWorkflowEntrySchema,
  sourceFingerprint: SourceFingerprintSchema,
  reused: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

export const BacklogCurationApplyDetailsSchema = Type.Object({
  itemChanges: Type.Number(),
  epicChanges: Type.Number(),
  noOpRechecks: Type.Number(),
  changedItemIds: Type.Array(Type.String()),
  changedEpicIds: Type.Array(Type.String()),
  recheckedItemIds: Type.Array(Type.String()),
  recheckedEpicIds: Type.Array(Type.String()),
  skipped: Type.Array(Type.Object({}, { additionalProperties: true })),
  needsInput: Type.Array(Type.Object({}, { additionalProperties: true })),
  recommendations: Type.Optional(Type.Object({
    recommendations: BacklogRecommendationModelSchema,
    recommendationSummary: RecommendationSummarySchema,
    path: Type.String(),
    status: RecommendationDerivedStatusSchema,
  }, { additionalProperties: false })),
  recommendationStatus: Type.Optional(RecommendationDerivedStatusSchema),
}, { additionalProperties: false });

export type AnalyzeAllBacklogInput = Static<typeof AnalyzeAllBacklogInputSchema>;
export type AnalyzeAllBacklogOutput = Static<typeof AnalyzeAllBacklogOutputSchema>;
export type BacklogCurationApplyDetails = Static<typeof BacklogCurationApplyDetailsSchema>;
