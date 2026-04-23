/**
 * Central API route map for the eforge daemon HTTP API.
 *
 * Single source of truth for all `/api/...` path patterns. Consumers import
 * these constants instead of embedding literal strings, so a route rename
 * surfaces as a compile-time error everywhere.
 *
 * Patterns with `:param` placeholders are resolved at call-time with
 * `buildPath(pattern, params)`.
 */

export const API_ROUTES = {
  keepAlive: '/api/keep-alive',
  enqueue: '/api/enqueue',
  cancel: '/api/cancel/:sessionId',
  daemonStop: '/api/daemon/stop',
  autoBuildGet: '/api/auto-build',
  autoBuildSet: '/api/auto-build',
  backendList: '/api/backend/list',
  backendShow: '/api/backend/show',
  backendUse: '/api/backend/use',
  backendCreate: '/api/backend/create',
  backendDelete: '/api/backend/:name',
  modelProviders: '/api/models/providers',
  modelList: '/api/models/list',
  projectContext: '/api/project-context',
  health: '/api/health',
  configShow: '/api/config/show',
  configValidate: '/api/config/validate',
  queue: '/api/queue',
  sessionMetadata: '/api/session-metadata',
  runs: '/api/runs',
  latestRun: '/api/latest-run',
  events: '/api/events/:runId',
  orchestration: '/api/orchestration/:runId',
  runSummary: '/api/run-summary/:id',
  runState: '/api/run-state/:id',
  plans: '/api/plans/:runId',
  diff: '/api/diff/:sessionId/:planId',
} as const;

export type ApiRoute = (typeof API_ROUTES)[keyof typeof API_ROUTES];

/**
 * Resolve a route pattern with `:param` placeholders into a concrete path.
 *
 * @example
 * buildPath(API_ROUTES.cancel, { sessionId: 'abc-123' })
 * // => '/api/cancel/abc-123'
 */
export function buildPath(pattern: string, params: Record<string, string>): string {
  return Object.entries(params).reduce(
    (path, [key, value]) => path.replace(`:${key}`, encodeURIComponent(value)),
    pattern,
  );
}
