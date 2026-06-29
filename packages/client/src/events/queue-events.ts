import { Type, type Static } from '@sinclair/typebox';
import { StalenessVerdictSchema } from './shared/schemas.js';

export const QueueDispatchFailureStageSchema = Type.Union([
  Type.Literal('stacking-validation'),
  Type.Literal('policy-gate'),
  Type.Literal('profile-routing'),
  Type.Literal('dispatch'),
]);
export type QueueDispatchFailureStage = Static<typeof QueueDispatchFailureStageSchema>;

export const queueEventVariants = [
  Type.Object({ type: Type.Literal('queue:start'), prdCount: Type.Number(), dir: Type.String() }),
  Type.Object({
    type: Type.Literal('queue:prd:start'),
    prdId: Type.String(),
    title: Type.String(),
  }),
  Type.Object({
    type: Type.Literal('queue:prd:discovered'),
    prdId: Type.String(),
    title: Type.String(),
    dependsOn: Type.Optional(Type.Array(Type.String())),
  }),
  Type.Object({
    type: Type.Literal('queue:prd:dependency-overridden'),
    prdId: Type.String(),
    title: Type.String(),
    removedDependency: Type.String(),
    previousDependsOn: Type.Array(Type.String()),
    currentDependsOn: Type.Array(Type.String()),
    reason: Type.Optional(Type.String()),
  }),
  // --- eforge:region plan-01-queue-removal-signal ---
  Type.Object({
    type: Type.Literal('queue:prd:removed'),
    prdId: Type.String(),
    previousStatus: Type.Union([
      Type.Literal('pending'),
      Type.Literal('waiting'),
      Type.Literal('failed'),
      Type.Literal('skipped'),
    ]),
    removedSidecars: Type.Optional(Type.Array(Type.String())),
  }),
  // --- eforge:endregion plan-01-queue-removal-signal ---
  Type.Object({
    type: Type.Literal('queue:prd:stale'),
    prdId: Type.String(),
    title: Type.String(),
    verdict: StalenessVerdictSchema,
    justification: Type.String(),
    revision: Type.Optional(Type.String()),
  }),
  Type.Object({
    type: Type.Literal('queue:prd:skip'),
    prdId: Type.String(),
    reason: Type.String(),
  }),
  Type.Object({
    type: Type.Literal('queue:prd:dispatch-failed'),
    prdId: Type.String(),
    title: Type.String(),
    reason: Type.String(),
    stage: QueueDispatchFailureStageSchema,
  }),
  Type.Object({
    type: Type.Literal('queue:prd:commit-failed'),
    prdId: Type.String(),
    title: Type.String(),
    error: Type.String(),
  }),
  Type.Object({
    type: Type.Literal('queue:prd:complete'),
    prdId: Type.String(),
    status: Type.Union([
      Type.Literal('completed'),
      Type.Literal('failed'),
      Type.Literal('skipped'),
    ]),
  }),
  Type.Object({
    type: Type.Literal('queue:complete'),
    processed: Type.Number(),
    skipped: Type.Number(),
  }),
] as const;

export const QueueEventSchema = Type.Union([...queueEventVariants]);

export type QueueEvent = Static<typeof QueueEventSchema>;
