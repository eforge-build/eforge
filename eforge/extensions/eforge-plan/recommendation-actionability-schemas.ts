import { Type, type Static } from '@eforge-build/extension-sdk';

export const RecommendationActionabilityStateSchema = Type.Union([Type.Literal('actionable'), Type.Literal('non-actionable')]);
export const RecommendationGroupActionabilityStateSchema = Type.Union([Type.Literal('actionable'), Type.Literal('partially-actionable'), Type.Literal('non-actionable')]);
export const RecommendationActionabilityReasonCodeSchema = Type.Union([
  Type.Literal('planned-session-plan'),
  Type.Literal('submitted-session-plan'),
  Type.Literal('active-planning-task'),
  Type.Literal('queued-trace'),
  Type.Literal('building-trace'),
  Type.Literal('active-build-session-trace'),
  Type.Literal('open-pr-trace'),
  Type.Literal('queued-build'),
  Type.Literal('running-build'),
  Type.Literal('active-build-session'),
  Type.Literal('open-pr'),
  Type.Literal('merged-result'),
  Type.Literal('shipped-result'),
  Type.Literal('failed-result'),
  Type.Literal('partial-plan'),
]);
export const RecommendationActionabilityLinkSchema = Type.Object({
  kind: Type.String(), label: Type.Optional(Type.String()), id: Type.Optional(Type.String()), itemIds: Type.Array(Type.String()), affectedItemIds: Type.Optional(Type.Array(Type.String())), status: Type.Optional(Type.String()), session: Type.Optional(Type.String()), taskId: Type.Optional(Type.String()), prdId: Type.Optional(Type.String()), runId: Type.Optional(Type.String()), sessionId: Type.Optional(Type.String()), buildSessionId: Type.Optional(Type.String()), featureBranch: Type.Optional(Type.String()), commitSha: Type.Optional(Type.String()), prUrl: Type.Optional(Type.String()), url: Type.Optional(Type.String()), path: Type.Optional(Type.String()), timestamp: Type.Optional(Type.String()), reasonCode: Type.Optional(Type.String()), missing: Type.Optional(Type.Boolean()), metadata: Type.Optional(Type.Unknown()),
}, { additionalProperties: false });
export const RecommendationActionabilityLifecycleStateSchema = Type.Union([
  Type.Literal('none'), Type.Literal('planned'), Type.Literal('active'), Type.Literal('queue'), Type.Literal('queued'), Type.Literal('submitted'), Type.Literal('build'), Type.Literal('pr-open'), Type.Literal('merged'), Type.Literal('shipped'), Type.Literal('failed'), Type.Literal('partial'),
]);
export const RecommendationItemActionabilitySchema = Type.Object({
  itemId: Type.String(), state: RecommendationActionabilityStateSchema, disposition: Type.Optional(Type.Union([Type.Literal('actionable'), Type.Literal('suppressed'), Type.Literal('de-actioned'), Type.Literal('relocated')])), lifecycleState: RecommendationActionabilityLifecycleStateSchema, reasonCode: Type.Optional(RecommendationActionabilityReasonCodeSchema), reasonMessage: Type.Optional(Type.String()), associatedLinks: Type.Array(RecommendationActionabilityLinkSchema),
}, { additionalProperties: false });
export const RecommendationEntryActionabilitySchema = Type.Object({
  lane: Type.String(), ref: Type.Optional(Type.String()), itemId: Type.String(), actionability: RecommendationItemActionabilitySchema,
}, { additionalProperties: false });
export const RecommendationGroupActionabilitySchema = Type.Object({
  ref: Type.String(), state: RecommendationGroupActionabilityStateSchema, itemIds: Type.Array(Type.String()), actionableItemIds: Type.Array(Type.String()), suppressedItemIds: Type.Array(Type.String()), items: Type.Array(RecommendationItemActionabilitySchema),
}, { additionalProperties: false });
export const RecommendationActionabilityProjectionSchema = Type.Object({
  schemaVersion: Type.Literal(1), activeWork: Type.Array(RecommendationEntryActionabilitySchema), readyCandidates: Type.Array(RecommendationEntryActionabilitySchema), recommendedNextSequence: Type.Array(RecommendationEntryActionabilitySchema), safeParallelizableGroups: Type.Array(RecommendationGroupActionabilitySchema),
}, { additionalProperties: false });

export type RecommendationActionabilityState = Static<typeof RecommendationActionabilityStateSchema>;
export type RecommendationGroupActionabilityState = Static<typeof RecommendationGroupActionabilityStateSchema>;
export type RecommendationActionabilityReasonCode = Static<typeof RecommendationActionabilityReasonCodeSchema>;
export type RecommendationActionabilityLifecycleState = Static<typeof RecommendationActionabilityLifecycleStateSchema>;
export type RecommendationActionabilityLink = Static<typeof RecommendationActionabilityLinkSchema>;
export type RecommendationItemActionability = Static<typeof RecommendationItemActionabilitySchema>;
export type RecommendationEntryActionability = Static<typeof RecommendationEntryActionabilitySchema>;
export type RecommendationGroupActionability = Static<typeof RecommendationGroupActionabilitySchema>;
export type RecommendationActionabilityProjection = Static<typeof RecommendationActionabilityProjectionSchema>;
