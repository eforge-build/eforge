import { readLockfile, isServerAlive } from './lockfile.js';
import { API_ROUTES } from './routes.js';
import type { VersionResponse } from './routes.js';

/**
 * Bump `DAEMON_API_VERSION` when making a **breaking** change to the daemon
 * HTTP API surface:
 *
 *   - Renaming a route path
 *   - Removing a required request or response field
 *   - Changing the type of an existing request or response field
 *
 * Adding a new **optional** response field is NOT breaking and must NOT bump
 * the version. Removing a field, renaming a route, or changing a response's
 * required fields IS breaking and must bump the version.
 */
export const DAEMON_API_VERSION = 41; // v41: `landing:auto-merge:start`, `landing:auto-merge:complete`, `landing:auto-merge:skipped` event variants added; `landingAutoMerge` (boolean) optional field added to `EnqueueRequest`, `PlaybookRunRequest`, `BuildOptions`, `EnqueueOptions`, and PRD frontmatter (`landing_auto_merge`); `landing.pr.autoMerge` config field added (`ask|always|never`, default `ask`). v40: `gap_close:complete.passed` is now a required field on the wire event; older clients/daemons that treated it as optional will disagree on the event schema. v39: landing action vocabulary changed from full strings (merge-to-base-branch|issue-pr|leave-branch) to canonical shorthands (pr|merge|leave) in EnqueueRequest.landingAction and PlaybookRunRequest.landingAction (replacing onSuccess); daemon rejects onSuccess in request bodies with a migration error; CLI workers spawned with --landing-action instead of --on-success. v38: `landing:start` wire event removes `feature-pr-after-local-merge` workflow literal and replaces it with `feature-pr`; older clients that validated the event against the previous schema union will reject events emitted by the new daemon. v37: optional `onSuccess` field added to `PlaybookRunRequest` (per-playbook-run landing action override: 'merge-to-base-branch' | 'issue-pr' | 'leave-branch'); daemon `/api/playbook/run` validates and passes `onSuccess` to `enqueuePrd(...)` for autonomous playbooks; older daemons would silently ignore the field. v36: optional `onSuccess` field added to `EnqueueRequest` (per-build landing action override: 'merge-to-base-branch' | 'issue-pr' | 'leave-branch'); `onSuccess` persisted in PRD frontmatter so override survives queue scheduler child-process boundaries; new `landing:start`, `landing:complete`, `landing:skipped` event variants added in plan-01. v35: optional `profile` field added to playbook frontmatter wire shapes (`PlaybookListEntry`, `PlaybookData`, `PlaybookFrontmatterFields`); optional `agent_profile` field added to `SessionPlanDataWire` and `SessionPlanCreateRequest`; `/api/playbook/run` for autonomous playbooks with `profile` persists profile in queued PRD frontmatter; `/api/session-plan/create` and `/api/session-plan/create-from-playbook` propagate `agent_profile`; `/api/enqueue` validates and propagates inherited session-plan `agent_profile` to worker `--profile` arg. v34: `POST /api/playbook/run` for planning-mode playbooks now returns `{ kind: 'requires-agent'; mode: 'planning'; name; message }` (HTTP 200) instead of creating a session-plan file; `PlaybookRunResponse` discriminated union becomes `enqueued | requires-agent` (removing `planning`); `mode` field added to `GET /api/playbook/list` entries and `GET /api/playbook/show` playbook object. v33: renames route `POST /api/playbook/enqueue` → `POST /api/playbook/run` (old route returns 404); adds new route `POST /api/session-plan/create-from-playbook`; `POST /api/playbook/run` now returns a discriminated union `{ kind: 'enqueued'; id }` or `{ kind: 'planning'; session; path }` based on playbook.mode; MCP/Pi action `'enqueue'` renamed to `'run'` on eforge_playbook tool; new MCP/Pi action `'create-from-playbook'` added to eforge_session_plan tool; playbook frontmatter now requires `mode` field. v32: adds input-source/enricher provenance events (`extension:input-source:fetched`, `extension:input-source:failed`, `extension:prd-enricher:applied`, `extension:prd-enricher:failed`). v31: adds persisted `daemon:auto-build:transition` event plus optional auto-build lifecycle detail fields (`desired`, `mode`, `scheduler`, `lastTransition`, `reason`) on auto-build snapshots and heartbeat payloads. v30: adds `error_transient_transport` to the closed `AgentTerminalSubtype` union used by `plan:build:failed.terminalSubtype` and `agent:retry.subtype`. v29: adds 'pending' to RunSummary.plans[].status; /api/run-summary/:id now seeds plans from the latest planning:complete event before overlaying plan:build:start/complete/failed (falls back to build events when planning:complete is absent). v28: per-build profile override (EnqueueRequest.profile, session:profile source 'override'). v27: adds `planning:decision` event variant with `PlanningDecisionSchema` (inner discriminated union over four planning-phase decision kinds: scope-selected, build-pipeline-chosen, review-profile-chosen, plan-set-shape); introduces `emitPlanningDecision` helper in engine; extends planner to emit decisions at planning:complete; adds planning decision rendering to monitor-ui. v26: adds `plan:build:decision` event variant with `BuildDecisionSchema` (inner discriminated union over seven decision kinds); introduces `emitBuildDecision` helper in engine; adds `decisions` slice to monitor-ui reducer. v25: adds `daemon:run:upsert` daemon-scoped persisted event as authoritative source of `DaemonState.runs`; removes run synthesis from `session:start` projector; removes run termination from `session:end` projector; drops `project` functions from `enqueue:start`/`enqueue:complete`/`enqueue:failed` (replaced by `daemon:run:upsert`); enriches `queue:prd:stale` with required `prdId`+`title` fields; enriches `queue:prd:commit-failed` with required `title` field; adds `project` functions for `queue:prd:stale` and `queue:prd:commit-failed` for live queue parity. v24: rowToRunInfo now maps nullable SQL columns (session_id, completed_at, pid) to undefined rather than null — wire shape conforms to DaemonRunRecordSchema (.optional(), not .nullable()); `enqueue:complete` event gains required `planSet` field (plan-set name, currently mirrors `title`). v23: stream:hello SSE handshake primitive; removal of the v18 resync-marker mechanism on initial daemon-events connect; removal of on-connect heartbeat write; snapshot envelope added to stream:hello for both daemon-events and per-session streams.

/** Per-process cache: maps `${port}:${pid}` to the verified daemon version. */
const verifiedDaemons = new Map<string, number>();

/**
 * Reset the per-process version cache. For test use only.
 */
export function clearApiVersionCache(): void {
  verifiedDaemons.clear();
}

/**
 * Verify that the running daemon's API version matches `DAEMON_API_VERSION`.
 *
 * - If no lockfile exists, silently returns (the daemon is down; the caller
 *   will surface a clearer `daemon-down` error shortly via `ensureDaemon`).
 * - If the daemon reports a different version, throws an `Error` whose message
 *   contains `version mismatch` so `classifyDaemonError` routes it to
 *   `kind: 'version-mismatch'`.
 * - Results are cached per `${port}:${pid}` key for the lifetime of this
 *   process, so the check is only ever issued once per daemon instance.
 */
export async function verifyApiVersion(cwd: string): Promise<void> {
  const lock = readLockfile(cwd);
  if (!lock) return;

  // Stale lockfile: daemon process exited or port was reused. Bail out silently
  // so `ensureDaemon` downstream can detect the dead lockfile and auto-start a
  // fresh daemon instead of surfacing a misleading `daemon-down` error here.
  if (!(await isServerAlive(lock))) return;

  const cacheKey = `${lock.port}:${lock.pid}`;
  if (verifiedDaemons.has(cacheKey)) return;

  const url = `http://127.0.0.1:${lock.port}${API_ROUTES.version}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Failed to fetch daemon version: ${res.status} ${text}`);
  }

  const data = JSON.parse(text) as VersionResponse;
  if (data.version !== DAEMON_API_VERSION) {
    throw new Error(
      `eforge daemon API version-mismatch: client expects v${DAEMON_API_VERSION}, daemon reports v${data.version}. Restart the daemon with the matching version.`,
    );
  }

  verifiedDaemons.set(cacheKey, data.version);
}
