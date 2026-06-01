/**
 * Read-only daemon route handler for session plan sets.
 *
 * Keeps the daemon thin: it delegates manifest parsing, safe path resolution,
 * loading, and validation to `@eforge-build/input` (`listSessionPlanSets`,
 * `loadSessionPlanSet`, `validateSessionPlanSet`) and only shapes the JSON-safe
 * wire response. `server.ts` wires this handler before the flat session-plan
 * handler.
 *
 * Routes (all GET):
 *  - `API_ROUTES.sessionPlanSetList`     → `{ planSets }`
 *  - `API_ROUTES.sessionPlanSetShow`     → `{ planSet, validation, dir, manifestPath, anchorContent? }`
 *  - `API_ROUTES.sessionPlanSetValidate` → `{ ok, diagnostics, summary }`
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { API_ROUTES } from '@eforge-build/client';
import type {
  SessionPlanSetListEntryWire,
  SessionPlanSetListResponse,
  SessionPlanSetShowResponse,
  SessionPlanSetSummaryWire,
  SessionPlanSetValidateResponse,
  SessionPlanSetValidationResultWire,
} from '@eforge-build/client';
import {
  listSessionPlanSets,
  loadSessionPlanSet,
  validateLoadedSessionPlanSet,
  validateSessionPlanSet,
} from '@eforge-build/input';

export interface SessionPlanSetRouteOptions {
  /** Daemon working directory (project root). */
  cwd?: string;
  /**
   * Reject non-loopback / cross-origin requests. Returns `true` when it has
   * written a 403 response (caller should stop dispatching). These routes
   * expose project metadata, absolute filesystem paths, and raw anchor content,
   * so they are gated with the same loopback Host/Origin checks the daemon uses
   * for sensitive operations rather than left openly CORS-readable.
   */
  rejectNonLocalRequest?: (
    req: IncomingMessage,
    res: ServerResponse,
    operationLabel?: string,
  ) => boolean;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

/**
 * Reject plan-set ids that could escape the session-plans directory before they
 * reach the input layer. Mirrors the path-resolution guards in
 * `@eforge-build/input`, surfacing them as HTTP 400 deterministically.
 */
function isUnsafePlanSetId(id: string): boolean {
  return (
    id.length === 0 ||
    id.includes('/') ||
    id.includes('\\') ||
    id.includes('..') ||
    id.includes('\0')
  );
}

/**
 * Try to handle a read-only session plan-set route.
 *
 * Returns `true` when the request matched one of the plan-set routes (and a
 * response was written), or `false` to let the caller continue dispatching.
 */
export async function handleSessionPlanSetRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  options: SessionPlanSetRouteOptions,
): Promise<boolean> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname;

  const isPlanSetRoute =
    pathname === API_ROUTES.sessionPlanSetList ||
    pathname === API_ROUTES.sessionPlanSetShow ||
    pathname === API_ROUTES.sessionPlanSetValidate;
  if (!isPlanSetRoute) return false;
  if (method !== 'GET') return false;

  // These file-backed reads expose project paths and raw anchor content, so
  // require them to originate from the local machine and reject cross-origin
  // browser requests before doing any filesystem work.
  if (options.rejectNonLocalRequest?.(req, res, 'Session plan-set reads')) {
    return true;
  }

  const cwd = options.cwd;
  if (!cwd) {
    sendError(res, 500, 'Daemon has no working directory configured');
    return true;
  }

  try {
    if (pathname === API_ROUTES.sessionPlanSetList) {
      const includeSubmittedRaw = url.searchParams.get('includeSubmitted');
      const includeSubmitted = includeSubmittedRaw === 'true' || includeSubmittedRaw === '1';
      const entries = await listSessionPlanSets({ cwd });
      const planSets: SessionPlanSetListEntryWire[] = entries
        .filter((e) => e.status !== 'abandoned')
        .filter((e) => includeSubmitted || e.status !== 'submitted')
        .map((e) => ({
          id: e.id,
          planSetId: e.planSetId,
          title: e.title,
          status: e.status,
          strategy: e.strategy,
          dir: e.dir,
          manifestPath: e.manifestPath,
          childCount: e.childCount,
        }));
      const body: SessionPlanSetListResponse = { planSets };
      sendJson(res, 200, body);
      return true;
    }

    // show + validate both require a planSetId query parameter.
    const planSetId = url.searchParams.get('planSetId');
    if (planSetId === null || planSetId.length === 0) {
      sendError(res, 400, 'Missing required query parameter: planSetId');
      return true;
    }
    if (isUnsafePlanSetId(planSetId)) {
      sendError(res, 400, `Unsafe plan-set id: ${planSetId}`);
      return true;
    }

    if (pathname === API_ROUTES.sessionPlanSetValidate) {
      const validation = await validateSessionPlanSet({ cwd, planSetId });
      const body: SessionPlanSetValidateResponse =
        validation as unknown as SessionPlanSetValidateResponse;
      sendJson(res, 200, body);
      return true;
    }

    // sessionPlanSetShow — load once, then validate from the loaded result so
    // the manifest/children are not read from disk a second time (which would
    // both double filesystem work and risk inconsistent data if files change
    // between reads).
    const load = await loadSessionPlanSet({ cwd, planSetId });
    const validation = validateLoadedSessionPlanSet(load);
    const body: SessionPlanSetShowResponse = {
      planSet: validation.summary as unknown as SessionPlanSetSummaryWire,
      validation: validation as unknown as SessionPlanSetValidationResultWire,
      dir: load.dir,
      manifestPath: load.manifestPath,
      ...(load.anchor?.exists === true && load.anchor.content !== undefined
        ? { anchorContent: load.anchor.content }
        : {}),
    };
    sendJson(res, 200, body);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    const message = err instanceof Error ? err.message : String(err);
    if (
      code === 'ENOENT' ||
      /no such file|does not exist|not found/i.test(message)
    ) {
      sendError(res, 404, message);
      return true;
    }
    if (
      /unsafe|invalid .*path|escape|outside|traversal/i.test(message) ||
      /invalid session plan-set id/i.test(message)
    ) {
      sendError(res, 400, message);
      return true;
    }
    sendError(res, 500, message);
    return true;
  }
}
