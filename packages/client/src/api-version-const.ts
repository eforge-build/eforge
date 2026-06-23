/**
 * Browser-safe DAEMON_API_VERSION constant.
 *
 * Kept in its own module so the browser entrypoint (browser.ts) can export
 * the version number without pulling in the Node-only lockfile/fs dependencies
 * that live in api-version.ts.
 *
 * Bump `DAEMON_API_VERSION` in either of these cases:
 *
 * 1. **Breaking change** to the daemon HTTP API surface:
 *      - Renaming a route path
 *      - Removing a required request or response field
 *      - Changing the type of an existing request or response field
 *
 * 2. **First-party feature gate** — an additive change (e.g. a new optional
 *    response field) that a first-party client (Console) relies on, such that a
 *    stale daemon lacking it would produce a broken UX. Bump so clients reject
 *    stale daemons even though the contract change is technically additive.
 *
 * Adding a new **optional** response field that no first-party client gates on
 * is NOT breaking and must NOT bump the version. Removing a field, renaming a
 * route, or changing a response's required fields IS breaking and must bump.
 * (v54 is a case 2 bump: the optional recovery applied metadata is additive,
 * but Console depends on it, so stale daemons must fail version verification.)
 * (v69 is a case 2 bump: extension contribution manifests expose dependency,
 * capability, and availability metadata, and action invocation can return an
 * unavailable failure response.)
 * (v70 is a case 2 bump: extension update requests can carry npm registry
 * version specifiers that stale daemons would otherwise ignore.)
 * (v71 is a case 1 bump: config show responses and config/profile
 * validation no longer include or accept the removed project/team extension
 * trust compatibility field.)
 * (v72 is a case 2 bump: Console gates on client-owned queue controls,
 * failed-enqueue projections, scheduler pause/resume, and recovery guidance.)
 * (v73 is a case 1 bump: failed-enqueue re-enqueue reports spawnedSessionId
 * instead of a misleading run-id-shaped worker-tracker id.)
 * (v74 is a case 2 bump: Console depends on the failed-enqueue dismiss action
 * to clear stale attention rows without re-enqueuing work.)
 * (v75 is a case 1 bump: enqueue requests can carry postMerge commands that
 * stale daemons would silently drop.)
 * (v76 is a case 1 bump: removes direct daemon APIs for playbooks and related session-plan derivation.)
 */
export const DAEMON_API_VERSION = 76; // v76: removes direct daemon APIs for playbooks and related session-plan derivation.
