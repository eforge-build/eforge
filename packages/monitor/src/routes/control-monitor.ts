import type { MonitorContext } from '../context.js';
import type { RouteDefinition } from '../http/router.js';
import { createControlPlaneRoutes } from './control-plane.js';
import { createQueueControlRoutes } from './queue-control.js';
import { createQueueRecoveryRoutes } from './queue-recovery.js';
import { createRecoveryRoutes } from './recovery.js';
import { createResumeRoutes } from './resume.js';
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
  'queuePriority',
  'queueRemove',
  'recover',
  'readRecoverySidecar',
  'applyRecovery',
  'acceptRecoverySuccessPreview',
  'acceptRecoverySuccess',
  'resumeBuild',
  'resumeEligibility',
  'queueRecoveryAnalyze',
  'queueRecoveryApply',
  'queue',
  'sessionMetadata',
  'runs',
  'spend',
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
    ...createQueueControlRoutes(context),
    ...createRecoveryRoutes(context),
    ...createResumeRoutes(context),
    ...createQueueRecoveryRoutes(context),
    ...createMonitorDataRoutes(context),
    ...createRunDetailRoutes(context),
    ...createStreamAttachRoutes(context),
  ];
}
