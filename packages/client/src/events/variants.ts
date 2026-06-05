import { Type } from '@sinclair/typebox';
import { BuildDecisionSchema, PlanningDecisionEventSchema } from './decisions.js';
import { queueEventVariants } from './queue-events.js';
import { agentEventVariants } from './variants/agents.js';
import { buildEventVariants, buildResumeEventVariants } from './variants/build.js';
import { daemonEventVariants } from './variants/daemon.js';
import { extensionEventVariants } from './variants/extensions.js';
import { sessionLifecycleEventVariants, planningEventVariants, expeditionEventVariants } from './variants/session-planning.js';
import { stackEventVariants } from './variants/stack.js';
import { validationRecoveryEventVariants } from './variants/validation-recovery.js';

export const eforgeEventVariantEntries = [
  ...sessionLifecycleEventVariants,
  ...extensionEventVariants,
  ...planningEventVariants,
  ...buildEventVariants,
  ...expeditionEventVariants,
  ...agentEventVariants,
  ...validationRecoveryEventVariants,
  ...daemonEventVariants,
  ...queueEventVariants,
  Type.Object({
    type: Type.Literal('plan:build:decision'),
    planId: Type.String(),
    decision: BuildDecisionSchema,
  }),
  PlanningDecisionEventSchema,
  ...stackEventVariants,
  ...buildResumeEventVariants,
] as const;

export const EforgeEventVariantsSchema = Type.Union([...eforgeEventVariantEntries]);
