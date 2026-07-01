import type { MonitorContext } from '../context.js';
import type { RouteDefinition } from '../http/router.js';
import { createControlPlaneRoutes } from './control-plane.js';
import { createQueueControlRoutes } from './queue-control.js';
import { createQueueControlAdvancedRoutes } from './queue-control-advanced.js';
import { createQueueRecoveryRoutes } from './queue-recovery.js';
import { createRecoveryRoutes } from './recovery.js';
import { createRecoveryGuidanceRoutes } from './recovery-guidance.js';
import { createFailedEnqueueRoutes } from './failed-enqueue.js';
import { createSchedulerControlRoutes } from './scheduler-control.js';
import { createContinueRepairRoutes } from './continue-repair.js';
import { createMonitorDataRoutes } from './monitor-data.js';
import { createRunDetailRoutes } from './run-details.js';
import { createStreamAttachRoutes } from './stream-attach.js';
import type { ControlMonitorRuntime } from './control-runtime.js';

export const CONTROL_MONITOR_ROUTE_KEYS = [
  'keepAlive',
  'enqueue',
  'cancel',
  'daemonStop',
  'autoBuildGet',
  'autoBuildSet',
  'schedulerKick',
  'schedulerPause',
  'schedulerResume',
  'queuePriority',
  'queueDependencyOverride',
  'queueRemove',
  'queueHold',
  'queueUnhold',
  'queueCascadePreview',
  'queueCascadeApply',
  'recover',
  'readRecoverySidecar',
  'applyRecovery',
  'acceptRecoverySuccessPreview',
  'acceptRecoverySuccess',
  'continueRepair',
  'continueRepairEligibility',
  'recoveryGuidancePrepare',
  'queueRecoveryAnalyze',
  'queueRecoveryApply',
  'failedEnqueues',
  'failedEnqueueReenqueue',
  'failedEnqueueDismiss',
  'queue',
  'sessionMetadata',
  'runs',
  'spend',
  'efficiencyAnalytics',
  'runSummary',
  'runState',
  'plans',
  'diff',
  'events',
  'daemonEvents',
] as const;

export function createControlMonitorRoutes(context: MonitorContext, runtime?: ControlMonitorRuntime): RouteDefinition[] {
  return [
    ...createControlPlaneRoutes(context, runtime),
    ...createSchedulerControlRoutes(context),
    ...createQueueControlRoutes(context),
    ...createQueueControlAdvancedRoutes(context),
    ...createRecoveryRoutes(context),
    ...createContinueRepairRoutes(context),
    ...createRecoveryGuidanceRoutes(context),
    ...createQueueRecoveryRoutes(context),
    ...createFailedEnqueueRoutes(context),
    ...createMonitorDataRoutes(context),
    ...createRunDetailRoutes(context),
    ...createStreamAttachRoutes(context),
  ];
}
