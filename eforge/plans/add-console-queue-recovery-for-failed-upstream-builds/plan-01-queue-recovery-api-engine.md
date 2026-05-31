---
id: plan-01-queue-recovery-api-engine
name: Queue Recovery API and Engine Cascade Repair
branch: add-console-queue-recovery-for-failed-upstream-builds/plan-01-queue-recovery-api-engine
agents:
  builder:
    effort: high
    rationale: This plan adds a public daemon/client API and guarded filesystem
      mutations across queue terminal directories; careful drift and path-safety
      handling is required.
  reviewer:
    effort: high
    rationale: Review needs extra attention on HTTP contract shape, path traversal
      guards, and queue mutation semantics.
---

# Queue Recovery API and Engine Cascade Repair

## Architecture Context

Queue state is runtime filesystem state under `.eforge/queue/`. The engine owns queue transitions, the monitor daemon owns HTTP access and scheduler wake-up, and `@eforge-build/client` owns route constants plus wire types. `GET /api/queue` intentionally filters terminal `dependsOn` edges, so cascade recovery analysis must read raw PRD frontmatter from queue root, `waiting/`, `failed/`, and `skipped/` rather than depending on the existing queue projection.

This plan implements the backend contract and mutation path only. Console consumption lands in the dependent UI plan.

## Implementation

### Overview

Add typed queue recovery analyze/apply routes, a focused engine cascade analysis/apply module, and thin daemon route branches that validate requests, delegate to the engine module, and wake the queue scheduler after successful mutations.

### Key Decisions

1. Define queue recovery wire shapes in a new client-owned module (`packages/client/src/queue-recovery.ts`) so Console and monitor code import shared request/response types instead of declaring structural duplicates.
2. Keep `packages/monitor/src/server.ts` changes bounded: parse JSON, validate route prerequisites, call engine helpers, send JSON, and invoke `notifyQueueMutation(..., 'apply-recovery')` only when at least one operation is applied.
3. Use `retry-and-reactivate-descendants` as the only required strategy for this slice. The request type may carry `strategy`, but unsupported strategy values must produce a blocker instead of mutating files.
4. Reactivate skipped descendants to `waiting/` unless dependency readiness is proven from active queue state plus the artifact registry. The selected failed parent always moves back to queue root for retry.
5. Make apply optimistic and guarded: callers submit the operations returned by analyze, apply re-reads queue state, compares expected source locations, and refuses the batch on drift before any rename.
6. Preserve existing `/api/queue` terminal dependency filtering; do not change `postProcessQueueDependsOn` semantics for live queue display.

## Scope

### In Scope

- Client route constants for queue recovery analysis and apply.
- Client-owned request/response types for strategies, locations, nodes, edges, operations, warnings, blockers, analyze responses, and apply responses.
- Node daemon client helpers plus browser-safe queue recovery helpers exported from `@eforge-build/client/browser` for the Console plan.
- Engine cascade analysis over raw queue PRD frontmatter in root, `waiting/`, `failed/`, and `skipped/`.
- Guarded apply that moves the failed parent to queue root, removes its recovery sidecars after the parent move, and moves skipped descendants to `waiting/` or queue root according to dependency readiness.
- Daemon analyze/apply routes using client route constants and engine helpers.
- Backend tests for client helpers, engine analysis/apply, daemon routes, drift refusal, and mutation notification.
- Generated API reference updates if `pnpm docs:generate` changes route listings.

### Out of Scope

- Console UI affordances and component state; those land in plan 02.
- Changes to `packages/monitor-ui/`.
- Queue reordering, priority editing, or arbitrary `depends_on` editing.
- Automatic retry without an explicit apply request.
- Compiled-artifact resume as part of cascade repair.
- Git branch, PR, or stack-provider repair beyond queue file moves.

## Files

### Create

- `packages/client/src/queue-recovery.ts` — shared queue recovery wire types and any small type guards/constants that are safe for Node and browser bundles.
- `packages/client/src/api/queue-recovery.ts` — Node daemon helpers: `apiAnalyzeQueueRecovery`, `apiAnalyzeQueueRecoveryIfRunning`, `apiApplyQueueRecovery`, and `apiApplyQueueRecoveryIfRunning`.
- `packages/client/src/browser-queue-recovery.ts` — browser-safe fetch helpers for Console, using `API_ROUTES` and exported queue recovery wire types with no Node imports.
- `packages/engine/src/queue/recovery-cascade.ts` — focused engine module for analysis, operation planning, drift checks, path-safe filesystem moves, sidecar removal, and apply result reporting. Keep this file under 600 lines; split helper files under `packages/engine/src/queue/` if needed.
- `packages/client/src/__tests__/queue-recovery.test.ts` — route constant, type export, and helper path tests.
- `test/queue-recovery-cascade.test.ts` — engine tests for cascade analysis, ineligible dependencies, guarded apply, and drift refusal.
- `test/queue-recovery-route.test.ts` — monitor route tests for analyze/apply responses and queue mutation wake notification.

### Modify

- `packages/client/src/routes.ts` — add `API_ROUTES.queueRecoveryAnalyze` and `API_ROUTES.queueRecoveryApply` (for example `/api/queue/recovery/analyze` and `/api/queue/recovery/apply`) without inlining these paths elsewhere.
- `packages/client/src/index.ts` — export queue recovery wire types and Node helper functions.
- `packages/client/src/browser.ts` — export queue recovery wire types and browser-safe helper functions.
- `packages/client/src/api-version-const.ts` — bump `DAEMON_API_VERSION` if the project treats new daemon route availability as a versioned API contract; record the queue recovery route/helper reason in the version comment.
- `packages/client/README.md` — mention the queue recovery helper module in the typed per-route helper list if docs sync determines the README is stale.
- `packages/monitor/src/server.ts` — import queue recovery types/helpers, add thin analyze/apply route branches, validate JSON object bodies, reject unsafe non-loopback mutation requests for apply, and call `notifyQueueMutation(options.daemonState, 'apply-recovery')` after at least one operation reports `applied`.
- `web/content/reference/api.md` — update if generated API route docs drift.
- `web/public/reference/api.md` — update if generated API route docs drift.
- `web/public/llms-full.txt` — update if generated reference aggregation drifts.

## Backend Contract Details

### Route and helper names

Use client-owned route keys and helper names consistently:

- `API_ROUTES.queueRecoveryAnalyze`
- `API_ROUTES.queueRecoveryApply`
- `apiAnalyzeQueueRecovery({ cwd, body })`
- `apiAnalyzeQueueRecoveryIfRunning({ cwd, body })`
- `apiApplyQueueRecovery({ cwd, body })`
- `apiApplyQueueRecoveryIfRunning({ cwd, body })`

Browser-safe helper names can differ from the Node helpers, but Console must import them from `@eforge-build/client/browser`, not redeclare fetch request/response shapes locally.

### Suggested wire fields

Keep the wire model explicit and serializable:

- `QueueRecoveryStrategy`: primary literal `retry-and-reactivate-descendants`.
- `QueueRecoveryLocation`: `queue | waiting | failed | skipped`.
- `QueueRecoveryNode`: PRD id, title, location/status, raw `dependsOn`, and role (`selected-failed-upstream`, `skipped-descendant`, `related-terminal`, etc.).
- `QueueRecoveryEdge`: dependent id and dependency id, preserving raw terminal edges.
- `QueueRecoveryOperation`: operation id, kind (`move-prd` or `remove-recovery-sidecars`), PRD id, expected source location, target location when applicable, and human-readable reason.
- `QueueRecoveryOperationResult`: operation plus status (`planned`, `applied`, `blocked`, `skipped`, `failed`) and optional message.
- `QueueRecoveryNotice`: code, message, optional PRD id, optional severity (`warning` or `blocker`).
- Analyze response: selected PRD id, strategy, `eligible`, nodes, edges, operations, warnings, blockers.
- Apply request: selected PRD id, strategy, and expected operations from analyze.
- Apply response: selected PRD id, strategy, `applied`, operation results, warnings, blockers.

### Engine behavior

- Load queue root, `waiting/`, `failed/`, and `skipped/` with raw `depends_on` retained.
- Return `eligible: false` plus at least one blocker when the selected PRD is unknown, unsafe, or not in `failed/`.
- Include the selected failed upstream node and all transitive skipped descendants reached through raw `depends_on` edges.
- Include raw dependency edges where failed/skipped PRDs depend on failed/skipped PRDs in the analyzed terminal graph.
- Treat skipped descendants with dependencies outside the selected cascade as blocked when those dependencies are failed, skipped, missing, or completed without a usable artifact.
- Read recovery sidecar verdict metadata for warnings only; `manual` or low-confidence sidecars must not block a user-directed queue repair.
- Plan parent move from `failed` to `queue`, parent sidecar removal, and descendant moves from `skipped` to `waiting` by default.
- Move a skipped descendant to queue root only when every dependency is inactive and `hasUsableArtifact(loadArtifactRegistry(cwd), dep)` is true, and no terminal failed/skipped queue item masks the artifact.
- Preflight all requested operations before any mutation: source file exists in the expected location, target file does not exist, operation set matches current analysis, and resolved paths stay under the queue directory.
- Remove `<prdId>.recovery.md` and `<prdId>.recovery.json` only after the parent PRD rename from `failed/` to queue root succeeds.

### Daemon behavior

- Analyze route is read-only and always leaves queue filesystem state unchanged.
- Apply route rejects malformed JSON with 400, but can return a typed `applied: false` response for domain blockers or drift so Console can display blocker messages.
- Apply route re-reads queue state through the engine helper immediately before mutation.
- Apply route invokes the existing queue mutation notification path only after one or more operations are applied.

## Verification

- [ ] `API_ROUTES.queueRecoveryAnalyze` and `API_ROUTES.queueRecoveryApply` are exported from `@eforge-build/client` and appear in generated API reference output after docs generation.
- [ ] `@eforge-build/client` exports queue recovery request/response and helper types from the main entrypoint.
- [ ] `@eforge-build/client/browser` exports queue recovery wire types and browser-safe helper functions with no Node-only imports.
- [ ] Client helper tests assert the analyze/apply helpers call the new route constants.
- [ ] An engine test seeds failed parent, skipped child, and skipped grandchild files; analysis includes all three PRD ids and terminal raw dependency edges.
- [ ] The same analysis test snapshots file locations before and after analyze and observes no file moves.
- [ ] An engine test for an unknown selected PRD returns `eligible: false` and a non-empty blocker message.
- [ ] An engine test with an outside failed or missing dependency returns `eligible: false` and leaves all PRD files in their original directories.
- [ ] An engine apply test moves the selected failed parent from `failed/` to queue root and removes both parent recovery sidecars.
- [ ] An engine apply test moves skipped descendants to `waiting/` when at least one dependency remains active or lacks a usable artifact.
- [ ] An engine apply drift test submits preview operations after a skipped descendant leaves `skipped/`; apply reports blocked operation results and leaves the failed parent in `failed/`.
- [ ] A daemon route test asserts analyze returns planned operations and leaves filesystem paths unchanged.
- [ ] A daemon route test asserts apply returns per-operation statuses and records `apply-recovery` through the auto-build notification spy after a successful mutation.
- [ ] `pnpm type-check` exits 0 after plan 01 merges.
- [ ] `pnpm maintainability:check` exits 0 after plan 01 merges.
- [ ] Relevant backend and client tests exit 0 before plan handoff.
