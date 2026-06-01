---
id: plan-01-recovery-api
name: Recovery API Helpers and Resume Eligibility
branch: add-comprehensive-console-recovery-options/plan-01-recovery-api
agents:
  builder:
    effort: high
    rationale: This plan coordinates engine resume eligibility behavior, daemon
      routes, shared client contracts, browser helpers, and API-version tests.
---

# Recovery API Helpers and Resume Eligibility

## Architecture Context

Console must consume daemon APIs through `@eforge-build/client` route constants and browser-safe helpers. The existing sidecar read/apply and resume routes exist, but Console lacks browser helpers for them and has no read-only way to learn whether compiled-build resume is available before spawning a resume worker.

`packages/engine/src/resume/compiled-build.ts` is the source of truth for resume eligibility, but its current `checkResumeEligibility` path can recreate merge worktrees and materialize artifacts. A Console preflight route must be read-only: it can inspect git state, sidecar metadata, and the monitor DB, but it must not create worktrees, copy branch-history artifacts, delete files, or spawn workers.

## Implementation

### Overview

Add a typed read-only resume eligibility route and shared client helpers for all recovery requests Console needs. Extract a read-only resume eligibility projection in the engine so the daemon route reports eligibility without triggering resume-side artifact materialization. Keep the existing `checkResumeEligibility` behavior for the actual resume command.

### Key Decisions

1. Add a dedicated `GET /api/recover/resume-eligibility` route constant rather than overloading `POST /api/recover/resume-build`.
   - Rationale: resume-build spawns a worker. Console needs a preflight query that cannot start background work.
2. Keep the read-only projection separate from artifact materialization.
   - Rationale: UI polling must not create merge worktrees or `__resume_artifacts__` directories.
3. Put browser fetch helpers in `@eforge-build/client/browser`.
   - Rationale: Console source must not inline `/api/...` paths, and route/wire types are owned by the client package.
4. Bump `DAEMON_API_VERSION` because first-party Console code will require the new resume eligibility route.
   - Rationale: a stale daemon would otherwise return 404 for a required Console control.

## Scope

### In Scope

- Add `API_ROUTES.resumeEligibility` with request/response types in `packages/client/src/routes.ts`.
- Add Node helpers for the resume eligibility route under `packages/client/src/api/` and export them from `packages/client/src/index.ts`.
- Add browser-safe helpers exported from `packages/client/src/browser.ts` for:
  - reading recovery sidecars,
  - triggering recovery analysis,
  - applying sidecar verdict recovery,
  - starting compiled-build resume,
  - checking resume eligibility.
- Export `ResumeBuildRequest`, `ResumeBuildResponse`, and the new resume eligibility types from the browser entrypoint.
- Add an engine read-only resume eligibility projection in `packages/engine/src/resume/compiled-build.ts`.
- Share set-name resolution with resume code: read `summary.setName` from `.eforge/queue/failed/<prdId>.recovery.json` when present, otherwise fall back to `prdId`.
- Add a daemon read-only route that validates `prdId` and optional `setName`, resolves set name, computes worktree/output paths, calls the read-only projection, and returns the typed response.
- Add tests for the route, client helpers, version constant, and no-side-effect projection.

### Out of Scope

- Changing recovery verdict semantics.
- Changing the behavior of `POST /api/recover/resume-build`.
- Changing queue item wire shape.
- Adding Console UI components; plan-02 consumes the helpers from this plan.
- Changing Pi or Claude Code skills.

## Files

### Create

- `packages/client/src/api/resume-eligibility.ts` — Node daemon-client helpers `apiCheckResumeEligibility` and `apiCheckResumeEligibilityIfRunning`.
- `packages/client/src/browser-recovery.ts` — browser-safe fetch helpers for sidecar read, recovery analysis trigger, sidecar apply, resume start, and resume eligibility.
- `test/resume-eligibility-route.test.ts` — daemon route coverage for eligible, ineligible, validation, set-name resolution, and no worker-spawn behavior.
- `test/browser-recovery-helpers.test.ts` — route-selection tests for the browser-safe recovery helpers using a stubbed `fetch`.

### Modify

- `packages/engine/src/resume/compiled-build.ts` — extract read-only eligibility projection helpers; keep materializing artifact recovery on the actual resume path only.
- `packages/engine/src/eforge.ts` — reuse shared set-name resolution if it is extracted from the resume helper module.
- `packages/client/src/routes.ts` — add `ResumeEligibilityRequest`, `ResumeEligibilityResponse`, and `API_ROUTES.resumeEligibility`.
- `packages/client/src/browser.ts` — export the new browser helpers and route types.
- `packages/client/src/index.ts` — export the new Node helper and route types.
- `packages/client/src/api-version.ts` — bump `DAEMON_API_VERSION` to the next value and update the history comment.
- `packages/monitor/src/server.ts` — register the resume eligibility route, or delegate to a focused route module if one is created.
- `test/daemon-recovery.test.ts` — update the API version expectation and route-export assertions.
- `test/resume-compiled-build-engine.test.ts` — add no-side-effect projection coverage without regressing existing materializing resume tests.

## Route and Response Contract

Use a GET route with query parameters:

- `prdId` is required.
- `setName` is optional.
- When `setName` is absent, the daemon reads failed sidecar metadata for `summary.setName`; if no valid sidecar exists, it falls back to `prdId`.

Suggested response discriminated by `eligible`:

```ts
export interface ResumeEligibilityRequest {
  prdId: string;
  setName?: string;
}

export type ResumeArtifactAvailability = 'merge-worktree' | 'feature-branch' | 'branch-history';

export type ResumeEligibilityResponse =
  | {
      eligible: true;
      prdId: string;
      setName: string;
      featureBranch: string;
      artifactAvailability: ResumeArtifactAvailability;
      artifactCommit?: string;
      landedCommitCount: number;
      diffStat: string;
      failingPlanId?: string;
      partial?: boolean;
    }
  | {
      eligible: false;
      prdId: string;
      setName: string;
      featureBranch: string;
      reason: string;
      checkedPath?: string;
    };
```

Implementation notes:

- The read-only engine projection may inspect `git rev-parse`, `git cat-file`, `git rev-list`, existing filesystem paths, and monitor DB/git failure evidence.
- The projection must not call the existing artifact-copy path that writes `__resume_artifacts__`.
- The projection must not call the existing worktree creation helper.
- The actual `checkResumeEligibility` used by `EforgeEngine.resumeBuild` must continue to create/recover artifacts when needed.
- The daemon route must not require `workerTracker` and must not call `spawnWorker`.
- Browser helpers must throw an `Error` whose message includes the daemon response text for non-2xx responses.

## Verification

- [ ] `API_ROUTES.resumeEligibility` equals `/api/recover/resume-eligibility`.
- [ ] `DAEMON_API_VERSION` increments from the current value and the version test expects the new value.
- [ ] The browser helper for sidecar read builds a URL from `API_ROUTES.readRecoverySidecar` and `URLSearchParams`.
- [ ] The browser helper for resume eligibility builds a URL from `API_ROUTES.resumeEligibility` and `URLSearchParams`.
- [ ] The browser helper for sidecar apply POSTs `ApplyRecoveryRequest` to `API_ROUTES.applyRecovery`.
- [ ] The browser helper for resume start POSTs `ResumeBuildRequest` to `API_ROUTES.resumeBuild`.
- [ ] The browser helper for recovery analysis trigger POSTs `RecoverRequest` to `API_ROUTES.recover`.
- [ ] `GET /api/recover/resume-eligibility?prdId=<id>` returns `400` for missing or unsafe `prdId`.
- [ ] The resume eligibility route returns `eligible: false` with a `reason` when the feature branch is missing.
- [ ] The resume eligibility route returns `eligible: true`, `sessionId` absent, and `pid` absent when feature branch, artifacts, and failure evidence exist.
- [ ] The resume eligibility route resolves `setName` from sidecar `summary.setName` when the query omits `setName`.
- [ ] A server started without `workerTracker` still serves the read-only resume eligibility route.
- [ ] Read-only eligibility projection leaves the merge worktree path absent when it was absent before the call.
- [ ] Read-only eligibility projection leaves `__resume_artifacts__` absent when branch-history artifacts are detected.
- [ ] Existing `checkResumeEligibility` tests that recreate worktrees and recover branch-history artifacts still pass.
