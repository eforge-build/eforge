import { API_ROUTES, type SchedulerPauseResponse, type SchedulerResumeResponse } from '@eforge-build/client';
import type { MonitorContext } from '../context.js';
import { defineRoute, type RouteDefinition } from '../http/router.js';
import { sendJson, sendJsonError } from '../http/response.js';
import { localMutation } from '../http/security.js';
import { projectAutoBuildForContext } from '../projections/monitor-state.js';

export function createSchedulerControlRoutes(context: MonitorContext): RouteDefinition[] {
  const security = [localMutation('Scheduler control mutations')];
  return [
    defineRoute({ routeKey: 'schedulerPause', method: 'POST', pattern: API_ROUTES.schedulerPause, security, handler(ctx) {
      const controller = context.options.daemonState?.autoBuildController;
      if (!controller) return sendJsonError(ctx.res, 503, 'Daemon mode not active');
      if (controller.getSnapshot().desired !== 'enabled') return sendJsonError(ctx.res, 409, 'Auto-build must be enabled before pausing the scheduler');
      controller.pauseScheduler('operator pause');
      sendJson(ctx.res, projectAutoBuildForContext(context) satisfies SchedulerPauseResponse);
    } }),
    defineRoute({ routeKey: 'schedulerResume', method: 'POST', pattern: API_ROUTES.schedulerResume, security, handler(ctx) {
      const controller = context.options.daemonState?.autoBuildController;
      if (!controller) return sendJsonError(ctx.res, 503, 'Daemon mode not active');
      if (controller.getSnapshot().desired !== 'enabled') return sendJsonError(ctx.res, 409, 'Auto-build must be enabled before resuming the scheduler');
      controller.resumeScheduler('operator resume');
      sendJson(ctx.res, projectAutoBuildForContext(context) satisfies SchedulerResumeResponse);
    } }),
  ];
}
