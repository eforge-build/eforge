---
id: plan-01-monitor-ui-debt-cleanup
name: "Monitor UI debt cleanup: client-owned wire types, dead code removal, cast
  and frontmatter fixes"
branch: monitor-ui-technical-debt-cleanup-remove-dead-code-reduce-casts-and-move-wire-protocol-types-toward-eforge-build-client/cleanup
---

# Monitor UI debt cleanup: client-owned wire types, dead code removal, cast and frontmatter fixes

## Architecture Context

The monitor UI currently re-exports event wire types (`EforgeEvent`, `AgentRole`, `AgentResultData`, `EforgeResult`, `ClarificationQuestion`, `ReviewIssue`, `PlanFile`, `OrchestrationConfig`, `PlanState`, `EforgeState`, `ExpeditionModule`) from `@eforge-build/engine/events`, which forces the browser/UI package to declare a workspace dependency on `@eforge-build/engine` and a `tsconfig.json` path alias `@eforge-build/engine/*`. The engine is a Node-only orchestration package and was never meant to be consumed by a browser bundle.

The `@eforge-build/client` package is the existing browser-safe wire-protocol surface. It already owns route constants (`API_ROUTES`, `buildPath`), route response types (`QueueItem`, `RunInfo`, `ReadSidecarResponse`, `RecoveryVerdictSidecar`, etc.), and the structurally-typed `DaemonStreamEvent` placeholder used inside `subscribeToSession`. The roadmap explicitly calls out "Typed SSE events in client package," and the engine's `package.json` already depends on `@eforge-build/client` (workspace), so moving the canonical wire-event types into the client package and having engine re-export them keeps existing engine consumers working with no behavioral change.

A second issue is the recovery sidecar `verdict` cast. `RecoveryVerdictSidecar` (in `packages/client/src/routes.ts`) declares typed `summary` and `verdict` fields but also ends with `[key: string]: unknown`. The index signature widens any property access via the index signature, which is why callers cast `(sidecar.json.verdict as unknown as VerdictShape)`. Removing the `[key: string]: unknown` line restores the typed-property access and lets the casts go away cleanly.

Finally, `parseFrontmatterFields` in `packages/monitor-ui/src/lib/plan-content.ts` is a hand-written line-by-line YAML parser that returns a `migrations: Array<{ timestamp; description }>` field but never populates it. The `yaml` package is already a dependency of `@eforge-build/monitor-ui` and is suitable for this parsing.

## Implementation

### Overview

This plan does five things in one coordinated change:

1. **Define wire-event types in `@eforge-build/client`.** Add a new module `packages/client/src/events.ts` containing browser-safe versions of `EforgeEvent`, `AgentRole`, `AgentResultData`, `EforgeResult`, `ClarificationQuestion`, `ReviewIssue`, `PlanFile`, `OrchestrationConfig`, `PlanState`, `EforgeState`, `ExpeditionModule`, and the supporting types they reference (`PrdValidationGap`, `TestIssue`, `BuildFailureSummary`, `LandedCommit`, `PlanSummaryEntry`, `FailingPlanEntry`, `ReconciliationReport`, `EforgeStatus`, `QueueEvent`, `StalenessVerdict`, `RecoveryVerdict`, `ORCHESTRATION_MODES`, `SEVERITY_ORDER`, `isAlwaysYieldedAgentEvent`). These must compile with zero engine imports — anywhere the engine version uses `z.output<typeof someSchema>` the client version uses an equivalent plain TypeScript shape (the schemas in `packages/engine/src/schemas.ts` are inspected to capture the exact shape; the resulting types must structurally match the engine types so engine code that constructs them keeps type-checking). Supporting unions like `ReviewPerspective` and `AgentTerminalSubtype` are inlined or re-declared in the client module. Re-export the full set from `packages/client/src/index.ts`.

2. **Have the engine re-export wire types from the client.** Edit `packages/engine/src/events.ts` so that engine-internal callers continue to import `EforgeEvent` etc. from `@eforge-build/engine/events`, but the type definitions are owned by client. The engine module re-exports the client-owned types and contributes only engine-internal pieces (e.g. `CompileOptions`, `BuildOptions`, `EnqueueOptions` — these stay in engine because no wire consumer needs them). All ~50 existing engine and test files that import `EforgeEvent` from `@eforge-build/engine/events` must continue to work without edit.

3. **Tighten `RecoveryVerdictSidecar` and remove sidecar verdict casts.** In `packages/client/src/routes.ts`, remove the `[key: string]: unknown` line at the bottom of the `RecoveryVerdictSidecar` interface so the typed `verdict` and `summary` fields are accessible without index-signature widening. Then in `packages/monitor-ui/src/components/recovery/sidecar-sheet.tsx`, `packages/monitor-ui/src/components/layout/queue-section.tsx`, and `packages/monitor-ui/src/components/layout/__tests__/queue-section-recovery.test.tsx`, drop the local `VerdictShape` aliases and `(sidecar.json.verdict as unknown as VerdictShape)` casts in favor of direct `sidecar.json.verdict` access. Verify by building and type-checking that no daemon-side code wrote unexpected fields onto `verdict` (the engine only writes the typed shape from `recoveryVerdictSchema`).

4. **Switch monitor UI off the engine dependency.** Edit `packages/monitor-ui/src/lib/types.ts` to import the wire types from `@eforge-build/client` instead of `@eforge-build/engine/events`. Remove `@eforge-build/engine` from `packages/monitor-ui/package.json` `dependencies`. Remove the `@eforge-build/engine/*` entry from the `paths` block in `packages/monitor-ui/tsconfig.json`. Remove the dead helpers `fetchRuns`, `fetchLatestRunId`, `fetchQueue`, `fetchPlanDiffs` from `packages/monitor-ui/src/lib/api.ts` (verified unreferenced anywhere in src/, only mentioned in PRD docs).

5. **Real YAML parsing for plan frontmatter.** Replace the hand-written field parser in `packages/monitor-ui/src/lib/plan-content.ts` with `yaml.parse()` from the `yaml` package (already in `package.json`). Map `depends_on` and `migrations` fields out of the parsed object. Tolerate missing/malformed fields the same way the existing parser does (return defaults — empty strings, empty arrays). Update `test/monitor-plan-preview.test.ts` to add coverage for migrations parsing.

Add one new test file: `packages/monitor-ui/src/__tests__/no-engine-imports.test.ts`. Mirroring the existing `api-routes-compliance.test.tsx` pattern, this scans `packages/monitor-ui/src/**/*.{ts,tsx}` (excluding `__tests__/`) and asserts that no source file contains `from '@eforge-build/engine` (substring match against import lines, with comments skipped). This guard test is the regression fence specified in acceptance criterion 1.

### Browser-safe entrypoint scope (acceptance criterion 2)

The Vite warning observed during `pnpm --filter @eforge-build/monitor-ui build` reports that the broad `@eforge-build/client` index pulls in `node:fs`, `node:path`, `node:crypto`, `node:http`, `node:child_process` because `daemon-client.ts`, `lockfile.ts`, and `session-stream.ts` use static `import` of those modules. Monitor UI only imports `API_ROUTES`, `buildPath`, route response types, `subscribeToSession`, and (after this plan) the new event wire types — none of which need the Node-only daemon helpers.

This plan adds a browser-safe subpath `@eforge-build/client/browser`. It does NOT add `daemon-client.ts`, `lockfile.ts`, or `node:http`-using internals. It exports:

- All route constants and route types from `routes.ts` (the file has no Node imports).
- All response types from `types.ts` (no Node imports).
- `DAEMON_API_VERSION` and `verifyApiVersion` (api-version.ts has no Node imports — verify by reading the file at implementation time).
- `parseSseChunk` from `session-stream.ts` (parse-only helper).
- The new wire event types from `events.ts`.
- `eventToProgress`, `FollowCounters`, `ProgressUpdate` (event-to-progress only imports a type).

Notably `subscribeToSession` itself does need to be re-exported through the browser subpath because monitor UI uses it. `session-stream.ts` currently has `import http from 'node:http'` at the top of the module, which Vite externalizes. Refactor `session-stream.ts` to lazy-load the Node branch with a dynamic `await import('node:http')` inside `connectViaNodeHttp`, so the static module graph is browser-safe and Vite's externalization warning disappears. The browser fetch/EventSource branch is unaffected.

If during implementation it turns out the dynamic-import refactor is non-trivial (e.g. it forces async-ifying `subscribeToSession`'s public signature in a breaking way), the builder may instead introduce a thin browser-only `subscribeToSessionBrowser` in a separate browser-safe module that contains only the `fetch`+`ReadableStream` path, export it through the browser subpath, and document the deferred unification as a follow-up note in the plan body. Either path satisfies acceptance criterion 2; the bundle warning must go away or the deferral must be explicit.

Update `packages/client/package.json` to add the `./browser` export entry alongside `.`. Update `packages/monitor-ui/src/lib/types.ts`, `packages/monitor-ui/src/lib/api.ts`, `packages/monitor-ui/src/hooks/use-eforge-events.ts`, `packages/monitor-ui/src/hooks/use-auto-build.ts`, `packages/monitor-ui/src/components/recovery/sidecar-sheet.tsx`, `packages/monitor-ui/src/components/layout/queue-section.tsx`, `packages/monitor-ui/src/components/layout/shutdown-banner.tsx`, `packages/monitor-ui/src/components/layout/sidebar.tsx`, `packages/monitor-ui/src/components/preview/plan-preview-panel.tsx`, `packages/monitor-ui/src/components/plans/plan-cards.tsx`, and `packages/monitor-ui/src/components/layout/__tests__/queue-section-recovery.test.tsx` to import from `@eforge-build/client/browser` instead of `@eforge-build/client`.

### Key Decisions

1. **Single owner: client.** The wire types live in `@eforge-build/client`. The engine module re-exports them so that ~50 existing engine and test files keep working unchanged. Decision rationale: a one-way dependency (engine imports from client) is simpler than splitting ownership across packages, and it matches the roadmap direction ("typed SSE events in client package").

2. **No zod dependency in client.** The client package does not depend on zod and must stay that way. The new `events.ts` defines plain TypeScript types matching the structure that engine's `z.output<typeof schema>` produces. The engine continues to own and use the zod schemas; the client owns only the inferred-shape types.

3. **Drop `[key: string]: unknown` from `RecoveryVerdictSidecar`.** This was the root cause of the monitor UI verdict casts. The sidecar JSON shape is fully typed by `recoveryVerdictSchema` plus the surrounding summary fields; there is no real need for arbitrary additional keys. Removing the index signature is a strict tightening — no engine code should write extra keys onto this struct, and if it does, type errors will surface them.

4. **Browser subpath via dynamic-import refactor of session-stream.** Adds `@eforge-build/client/browser` as a tree-shake-friendly entrypoint and lazy-loads `node:http` so static analysis sees no Node imports from the browser path. Falls back to a dedicated browser-only subscribe helper if dynamic import causes API breakage; either way the Vite externalization warning is resolved or explicitly deferred with a note.

5. **Use the `yaml` package for frontmatter.** Already a dependency. Replaces a 30-line hand parser with one `yaml.parse()` call plus simple field projection. Populates the previously ignored `migrations` array.

6. **Guard test mirrors the existing `api-routes-compliance` test.** Same scanning pattern, same failure-message style. Easy to maintain.

## Scope

### In Scope

- New `packages/client/src/events.ts` defining all monitor-UI-required wire event types in plain TypeScript.
- `packages/client/src/index.ts` re-exports the new types from the root entrypoint.
- New `packages/client/src/browser.ts` browser-safe entrypoint exporting routes, types, events, `subscribeToSession` (or a browser-only equivalent), `parseSseChunk`, `eventToProgress`, `verifyApiVersion`, and `DAEMON_API_VERSION`.
- `packages/client/package.json` adds the `./browser` export entry.
- `packages/client/src/session-stream.ts` refactor: replace static `import http from 'node:http'` with a dynamic import inside the Node branch (or factor the browser path into a separate module if dynamic import would break the public signature; document the chosen approach in the plan-completion comments).
- `packages/client/src/routes.ts` removes `[key: string]: unknown` from `RecoveryVerdictSidecar`.
- `packages/engine/src/events.ts` re-exports the wire types from `@eforge-build/client` so engine-internal callers and the ~50 test/engine files continue to work unchanged. Engine-only types (`CompileOptions`, `BuildOptions`, `EnqueueOptions`) stay in the engine module.
- `packages/monitor-ui/src/lib/types.ts` switches to `@eforge-build/client/browser` for wire types; engine path alias references gone.
- `packages/monitor-ui/package.json` removes `@eforge-build/engine` from `dependencies`.
- `packages/monitor-ui/tsconfig.json` removes the `@eforge-build/engine/*` paths entry.
- `packages/monitor-ui/src/lib/api.ts` removes `fetchRuns`, `fetchLatestRunId`, `fetchQueue`, `fetchPlanDiffs`; switches the `@eforge-build/client` import to `@eforge-build/client/browser`.
- All other monitor-ui files that import from `@eforge-build/client` switch to `@eforge-build/client/browser` (full list in Files / Modify below).
- `packages/monitor-ui/src/lib/plan-content.ts` replaces the hand-written field parser with `yaml.parse` and populates `migrations` from a `migrations:` block when present.
- `packages/monitor-ui/src/components/recovery/sidecar-sheet.tsx`, `packages/monitor-ui/src/components/layout/queue-section.tsx`, and `packages/monitor-ui/src/components/layout/__tests__/queue-section-recovery.test.tsx` drop the `as unknown as VerdictShape` casts now that `RecoveryVerdictSidecar.verdict` is directly typed.
- New guard test `packages/monitor-ui/src/__tests__/no-engine-imports.test.ts` asserting no source file under `packages/monitor-ui/src/` (excluding `__tests__/` and `node_modules/`) imports from `@eforge-build/engine`.
- `test/monitor-plan-preview.test.ts` adds a test case asserting `parseFrontmatterFields` populates `migrations` correctly when a `migrations:` block is present, plus passes the existing dependencies/branch tests.

### Out of Scope

- Any change to runtime daemon event payloads (engine and daemon emit unchanged events).
- Behavioral changes to reducer handler files in `packages/monitor-ui/src/lib/reducer/` beyond import-path adjustments. The `as unknown as Extract<EforgeEvent, ...>` casts in reducer handler tests stay as-is — they are test-fixture casts, not production code.
- Behavioral changes to refactored pipeline components (`plan-row.tsx`, `stage-overview.tsx`, `activity-overlay.tsx`, etc.) beyond import-path adjustments.
- Removal of additional API helpers beyond the four explicitly listed (`fetchLatestSessionId`, `fetchOrchestration`, `fetchAutoBuild`, `fetchProjectContext`, `fetchFileDiff`, `fetchRecoverySidecar` are out of scope — they have active callers).
- `as unknown as DagNodeData` / `as unknown as DagEdgeData` casts in `packages/monitor-ui/src/components/graph/dag-node.tsx` and `dag-edge.tsx`. These cross the `@xyflow/react` type boundary and are not part of the recovery sidecar / wire-type cleanup.
- Queue reordering, new monitor screens, styling redesign.

## Files

### Create

- `packages/client/src/events.ts` — Browser-safe wire event types: `EforgeEvent`, `AgentRole`, `AgentResultData`, `EforgeResult`, `ClarificationQuestion`, `ReviewIssue`, `PlanFile`, `OrchestrationConfig`, `PlanState`, `EforgeState`, `ExpeditionModule`, `PrdValidationGap`, `TestIssue`, `BuildFailureSummary`, `LandedCommit`, `PlanSummaryEntry`, `FailingPlanEntry`, `ReconciliationReport`, `EforgeStatus`, `QueueEvent`, `StalenessVerdict`, `RecoveryVerdict`, `ORCHESTRATION_MODES`, `SEVERITY_ORDER`, `isAlwaysYieldedAgentEvent`, plus inlined supporting unions (`ReviewPerspective`, `AgentTerminalSubtype`, `ShardScope`, `PipelineComposition`). Pure TypeScript, zero engine or zod imports.
- `packages/client/src/browser.ts` — Browser-safe entrypoint: re-exports the subset of client APIs that monitor UI needs (`API_ROUTES`, `buildPath`, all `routes.ts` types, all `types.ts` response shapes, all `events.ts` types, `subscribeToSession` (or browser-only equivalent), `parseSseChunk`, `eventToProgress`, `verifyApiVersion`, `DAEMON_API_VERSION`).
- `packages/monitor-ui/src/__tests__/no-engine-imports.test.ts` — Guard test asserting `packages/monitor-ui/src/` has no `@eforge-build/engine` imports. Pattern mirrors `api-routes-compliance.test.tsx`.

### Modify

- `packages/client/src/index.ts` — Re-export the new wire-event types and `eventToProgress` symbols from `events.ts`. Keep the existing `.` entrypoint unchanged for non-browser callers.
- `packages/client/src/routes.ts` — Remove `[key: string]: unknown` from `RecoveryVerdictSidecar`.
- `packages/client/src/session-stream.ts` — Refactor so `node:http` is only loaded inside the Node branch via dynamic import (or split into separate browser/node modules). Confirm the public `subscribeToSession` signature stays compatible with current callers (CLI, Pi extension, monitor UI). Document the chosen refactor approach in a leading code comment.
- `packages/client/package.json` — Add `"./browser": { "types": "./dist/browser.d.ts", "import": "./dist/browser.js" }` to the exports map.
- `packages/engine/src/events.ts` — Replace the in-file definitions of the moved types with `export type { ... } from '@eforge-build/client/events'` (or the index). Keep engine-only types (`CompileOptions`, `BuildOptions`, `EnqueueOptions`). Verify all ~50 existing engine and test files that `import type { EforgeEvent } from '@eforge-build/engine/events'` continue to compile.
- `packages/monitor-ui/package.json` — Remove `@eforge-build/engine` from `dependencies`.
- `packages/monitor-ui/tsconfig.json` — Remove the `@eforge-build/engine/*` entry from `paths`.
- `packages/monitor-ui/src/lib/types.ts` — Switch event type imports from `@eforge-build/engine/events` to `@eforge-build/client/browser`. Update the `BuildStageSpec, ReviewProfileConfig` import to `@eforge-build/client/browser`.
- `packages/monitor-ui/src/lib/api.ts` — Switch import to `@eforge-build/client/browser`. Remove `fetchRuns`, `fetchLatestRunId`, `fetchQueue`, `fetchPlanDiffs` (verified zero callers in `src/`).
- `packages/monitor-ui/src/lib/plan-content.ts` — Replace `parseFrontmatterFields` body with `yaml.parse()` from the `yaml` package. Populate `migrations` from a `migrations:` block when present (`Array<{ timestamp: string; description: string }>`). Preserve return-shape contract (empty defaults for missing fields, never throws on malformed YAML — wrap in try/catch and return defaults).
- `packages/monitor-ui/src/components/recovery/sidecar-sheet.tsx` — Drop the `VerdictShape` local type and `as unknown as VerdictShape` cast; access `sidecar.json.verdict.verdict` directly.
- `packages/monitor-ui/src/components/layout/queue-section.tsx` — Drop the local `VerdictShape` type and `as unknown as VerdictShape` cast; access `sidecar.json.verdict` directly. Switch `@eforge-build/client` imports to `@eforge-build/client/browser`.
- `packages/monitor-ui/src/components/layout/__tests__/queue-section-recovery.test.tsx` — Drop the local `VerdictShape` type and `as unknown as VerdictShape` cast.
- `packages/monitor-ui/src/hooks/use-eforge-events.ts` — Switch `@eforge-build/client` import to `@eforge-build/client/browser`.
- `packages/monitor-ui/src/hooks/use-auto-build.ts` — Switch `@eforge-build/client` import to `@eforge-build/client/browser`.
- `packages/monitor-ui/src/components/layout/shutdown-banner.tsx` — Switch import to `@eforge-build/client/browser`.
- `packages/monitor-ui/src/components/layout/sidebar.tsx` — Switch import to `@eforge-build/client/browser`.
- `packages/monitor-ui/src/components/preview/plan-preview-panel.tsx` — Switch import to `@eforge-build/client/browser`.
- `packages/monitor-ui/src/components/plans/plan-cards.tsx` — Switch import to `@eforge-build/client/browser`.
- `test/monitor-plan-preview.test.ts` — Add a test case verifying `migrations` is populated from a `migrations:` YAML block (with timestamp/description entries). Confirm existing tests for id/name/depends_on/branch still pass.

## Verification

- [ ] `pnpm --filter @eforge-build/client build` succeeds with the new `events.ts` module and `browser.ts` entrypoint compiled.
- [ ] `pnpm --filter @eforge-build/engine type-check` passes with `events.ts` re-exporting wire types from `@eforge-build/client`.
- [ ] `pnpm --filter @eforge-build/monitor-ui type-check` passes after the engine alias and dependency are removed.
- [ ] `pnpm --filter @eforge-build/monitor-ui test` passes, including the new `no-engine-imports.test.ts` guard test, the existing `api-routes-compliance.test.tsx`, and the existing `queue-section-recovery.test.tsx` (cast removed).
- [ ] `pnpm --filter @eforge-build/monitor-ui build` produces a Vite build whose output does not list `node:fs`, `node:path`, `node:crypto`, `node:http`, or `node:child_process` in the externalized-modules warning. If the warning persists, the plan body must include a written note pointing at a follow-up issue describing the remaining work; the warning may not be silently ignored.
- [ ] `pnpm test` (root, runs vitest across the repo) passes, including `test/monitor-plan-preview.test.ts` (extended for migrations) and all engine/test files that import `@eforge-build/engine/events`.
- [ ] `grep -rn "@eforge-build/engine" packages/monitor-ui/src` returns zero matches.
- [ ] `grep -rn "@eforge-build/engine" packages/monitor-ui/package.json packages/monitor-ui/tsconfig.json` returns zero matches.
- [ ] `grep -rn "\bfetchRuns\b\|\bfetchLatestRunId\b\|\bfetchQueue\b\|\bfetchPlanDiffs\b" packages/monitor-ui/src` returns zero matches.
- [ ] `grep -rn "as unknown as VerdictShape" packages/monitor-ui/src` returns zero matches.
- [ ] `grep -rn "\[key: string\]: unknown" packages/client/src/routes.ts` returns zero matches inside the `RecoveryVerdictSidecar` declaration.
- [ ] A sample plan YAML containing `migrations:\n  - timestamp: "20260101120000"\n    description: "add foo table"` parsed by `parseFrontmatterFields` returns `migrations: [{ timestamp: "20260101120000", description: "add foo table" }]`.
