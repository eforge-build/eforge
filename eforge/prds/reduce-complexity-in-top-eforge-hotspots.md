---
title: Reduce Complexity in Top eforge Hotspots
created: 2026-06-06
landing: pr
landing_auto_merge: true
---

# Reduce Complexity in Top eforge Hotspots

## Problem / Motivation

The current top cognitive-complexity hotspots reported by `pnpm complexity:scan` are high-churn, high-complexity functions that should be mechanically refactored to improve maintainability without changing behavior.

Confirmed evidence gathered during playbook investigation:

- `pnpm complexity:scan` ran successfully on 2026-06-05 and reported the top hotspots as:
  - `packages/engine/src/eforge.ts:990` — `EforgeEngine.buildSinglePrd`, CC 127, churn 103, churn × CC 13081.
  - `packages/pi-eforge/extensions/eforge/index.ts:443` — `eforge_status` tool `renderResult`, CC 136, churn 77, churn × CC 10472.
  - `packages/eforge/src/cli/display.ts:126` — `renderEvent`, CC 236, churn 28, churn × CC 6608.
- No hotspot has CC > 500, so the playbook's decision rule selects the multi-medium-hotspot path rather than focusing on a single huge function.
- `packages/eforge/src/cli/display.ts:126` is a single large `switch (event.type)` renderer with many event-domain groups and repeated spinner/status formatting patterns.
- `packages/pi-eforge/extensions/eforge/index.ts:443` is the `eforge_status` tool `renderResult` callback. It parses JSON, handles idle/no-build states, renders single-build details, renders multi-build summaries, supports `expanded` runs, and falls back to raw JSON on parse failure.
- `packages/engine/src/eforge.ts:990` is `async *buildSinglePrd(...)`, the queued PRD subprocess entry point. It performs claim/validation, stale assessment/revision, compiled-resume handling, recovery-continuation validation, stack/trunk-sync compile-base selection, compile, build, and terminal event emission.
- Searches found existing tests that directly or indirectly exercise `buildSinglePrd` and the Pi `eforge_status` tool, including queue/resume/recovery/session-id/status tests.
- There was no obvious direct `renderEvent` unit test in the quick search output.

## Goal

Reduce the cognitive complexity of the three selected hotspots to ≤30 per named function, with extracted helper functions also kept at ≤30. Preserve runtime behavior, public APIs, CLI/Pi output text, queue semantics, daemon/event wire shapes, event ordering, and build orchestration semantics.

## Approach

- Use the playbook's 2-3 medium-hotspot path because no selected hotspot has CC > 500.
- Refactor mechanically through helper extraction and dispatch decomposition rather than behavior or design changes.
- In `packages/eforge/src/cli/display.ts`, keep the existing public `renderEvent(event: EforgeEvent): void` export.
- In `packages/eforge/src/cli/display.ts`, split the large `switch (event.type)` into event-domain dispatch helpers.
- In `packages/eforge/src/cli/display.ts`, extract domain-specific render helpers for phase/planning, build/review/doc/test, orchestration/landing/stack, validation/agent/user/reconciliation, queue/PRD-validation/recovery/daemon/acceptance/fallback groups.
- In `packages/eforge/src/cli/display.ts`, extract repeated spinner update/status summary snippets where doing so lowers helper complexity without changing output.
- In `packages/eforge/src/cli/display.ts`, keep `renderStatus`, `renderQueueList`, and playbook listing behavior unchanged except for behavior-preserving shared private helper reuse.
- In `packages/pi-eforge/extensions/eforge/index.ts`, refactor only the `eforge_status` tool rendering block around `renderResult`.
- In `packages/pi-eforge/extensions/eforge/index.ts`, extract typed status-rendering helpers and table-driven status icon/color formatting.
- In `packages/pi-eforge/extensions/eforge/index.ts`, introduce local types/helpers for parsed status payloads and rendering lines.
- In `packages/pi-eforge/extensions/eforge/index.ts`, include helpers for status icon/color selection, active activity line, plans progress, event counts, expanded runs, single-build rendering, and multi-build rendering.
- In `packages/pi-eforge/extensions/eforge/index.ts`, leave tool registration, API route usage, daemon-not-running behavior, and version-mismatch metadata untouched.
- In `packages/pi-eforge/extensions/eforge/index.ts`, keep the registered tool name, parameter schema, JSON parsing fallback, and rendered text semantics unchanged.
- In `packages/engine/src/eforge.ts`, keep `EforgeEngine.buildSinglePrd` as the public method and subprocess entry point.
- In `packages/engine/src/eforge.ts`, extract phase-specific async-generator helpers for pre-build failure emission and before-build failure event generation.
- In `packages/engine/src/eforge.ts`, extract helpers for compiled-resume and acceptance-inventory validation.
- In `packages/engine/src/eforge.ts`, extract helpers for stale PRD assessment/revision/skip handling.
- In `packages/engine/src/eforge.ts`, extract helpers for compiled-resume execution.
- In `packages/engine/src/eforge.ts`, extract helpers for recovery-continuation and stack-context validation.
- In `packages/engine/src/eforge.ts`, extract helpers for trunk-sync compile base override resolution.
- In `packages/engine/src/eforge.ts`, extract helpers for compile phase execution and result collection.
- In `packages/engine/src/eforge.ts`, extract helpers for build phase execution and result collection.
- In `packages/engine/src/eforge.ts`, preserve event ordering, session-id semantics, PRD claim behavior, lock/cleanup ownership, landing precedence, and recovery/stacking/trunk-sync behavior.
- Use existing helpers including `withRunId`, `collectTrunkSyncEvents`, `forgeCommit`, `composeCommitMessage`, and state mutation event variants rather than duplicating contracts.
- Avoid adding new implementation files unless a helper group would make an existing file harder to maintain.
- If a new implementation file is added, keep it under the repository's ≤600-line new-file policy.
- If a new file grows beyond 300 lines, add balanced `// --- eforge:region ... ---` and `// --- eforge:endregion ... ---` markers.
- Add focused tests only if an extracted helper introduces behavior that is not already covered or if a regression is easy to capture without brittle console snapshot coupling.
- For `buildSinglePrd`, keep yield ordering identical because monitor DB/session consumers may depend on event sequencing.
- For CLI and Pi rendering, avoid user-facing text/color/icon changes unless unavoidable whitespace-only differences are explicitly justified in code review.

## Scope

In scope:

- Refactor the current top cognitive-complexity hotspots reported by `pnpm complexity:scan`.
- Touch `packages/eforge/src/cli/display.ts`.
- Touch `packages/pi-eforge/extensions/eforge/index.ts`.
- Touch `packages/engine/src/eforge.ts`.
- Inspect and keep passing `test/queued-compiled-resume-engine.test.ts`.
- Inspect and keep passing `test/engine-enqueue-after-queue-id.test.ts`.
- Inspect and keep passing `test/recovery-continuation-queue.test.ts`.
- Inspect and keep passing `test/greedy-queue-scheduler.test.ts`.
- Inspect and keep passing `test/onsuccess-override-precedence.test.ts`.
- Inspect and keep passing `test/with-run-id.test.ts`.
- Inspect and keep passing `test/pi-ambient-status-no-start.test.ts`.

Out of scope:

- Do not change runtime behavior.
- Do not change public APIs.
- Do not change CLI/Pi output text.
- Do not change queue semantics.
- Do not change daemon/event wire shapes.
- Do not change event schemas.
- Do not change route constants.
- Do not change daemon wire shapes.
- Do not change CLI/Pi user-facing behavior.
- Do not change queue directory layout.
- Do not change build orchestration semantics.
- Do not move provider SDK imports.
- Do not introduce new dependencies.
- Do not redesign the queue lifecycle.
- Do not perform anything beyond a mechanical complexity-reduction refactor.

## Acceptance Criteria

- `packages/eforge/src/cli/display.ts` continues to export `renderEvent(event: EforgeEvent): void`.
- `renderEvent` in `packages/eforge/src/cli/display.ts` has cognitive complexity ≤30.
- Each helper extracted from `renderEvent` has cognitive complexity ≤30.
- `renderEvent` preserves existing observable console output behavior.
- `renderEvent` uses split-by-event-domain dispatch.
- `packages/pi-eforge/extensions/eforge/index.ts` keeps the registered `eforge_status` tool name unchanged.
- `packages/pi-eforge/extensions/eforge/index.ts` keeps the `eforge_status` parameter schema unchanged.
- `packages/pi-eforge/extensions/eforge/index.ts` keeps the `eforge_status` JSON parsing fallback unchanged.
- `packages/pi-eforge/extensions/eforge/index.ts` keeps the `eforge_status` rendered text semantics unchanged.
- `renderResult` for the `eforge_status` tool has cognitive complexity ≤30.
- Each helper extracted from `renderResult` has cognitive complexity ≤30.
- The `eforge_status` idle render output structure is unchanged.
- The `eforge_status` single-build render output structure is unchanged.
- The `eforge_status` multi-build render output structure is unchanged.
- The `eforge_status` expanded-runs render output structure is unchanged.
- The `eforge_status` event-count render output structure is unchanged.
- The `eforge_status` JSON-parse-fallback render output structure is unchanged.
- The `eforge_status` API route usage is unchanged.
- The `eforge_status` daemon-not-running behavior is unchanged.
- The `eforge_status` version-mismatch metadata is unchanged.
- `EforgeEngine.buildSinglePrd` remains the public method in `packages/engine/src/eforge.ts`.
- `EforgeEngine.buildSinglePrd` remains the queued PRD subprocess entry point.
- `EforgeEngine.buildSinglePrd` has cognitive complexity ≤30.
- Each helper extracted from `EforgeEngine.buildSinglePrd` has cognitive complexity ≤30.
- `EforgeEngine.buildSinglePrd` preserves event ordering for success paths.
- `EforgeEngine.buildSinglePrd` preserves terminal `session:end` and `queue:prd:complete` behavior for success paths.
- `EforgeEngine.buildSinglePrd` preserves event ordering for failure paths.
- `EforgeEngine.buildSinglePrd` preserves terminal `session:end` and `queue:prd:complete` behavior for failure paths.
- `EforgeEngine.buildSinglePrd` preserves event ordering for skipped paths.
- `EforgeEngine.buildSinglePrd` preserves terminal `session:end` and `queue:prd:complete` behavior for skipped paths.
- `EforgeEngine.buildSinglePrd` preserves event ordering for stale paths.
- `EforgeEngine.buildSinglePrd` preserves terminal `session:end` and `queue:prd:complete` behavior for stale paths.
- `EforgeEngine.buildSinglePrd` preserves event ordering for compiled-resume paths.
- `EforgeEngine.buildSinglePrd` preserves terminal `session:end` and `queue:prd:complete` behavior for compiled-resume paths.
- `EforgeEngine.buildSinglePrd` preserves event ordering for recovery-continuation paths.
- `EforgeEngine.buildSinglePrd` preserves terminal `session:end` and `queue:prd:complete` behavior for recovery-continuation paths.
- `EforgeEngine.buildSinglePrd` preserves event ordering for stack paths.
- `EforgeEngine.buildSinglePrd` preserves terminal `session:end` and `queue:prd:complete` behavior for stack paths.
- `EforgeEngine.buildSinglePrd` preserves event ordering for trunk-sync paths.
- `EforgeEngine.buildSinglePrd` preserves terminal `session:end` and `queue:prd:complete` behavior for trunk-sync paths.
- `EforgeEngine.buildSinglePrd` preserves session-id semantics.
- `EforgeEngine.buildSinglePrd` preserves PRD claim behavior.
- `EforgeEngine.buildSinglePrd` preserves lock/cleanup ownership.
- `EforgeEngine.buildSinglePrd` preserves landing precedence.
- `EforgeEngine.buildSinglePrd` preserves recovery behavior.
- `EforgeEngine.buildSinglePrd` preserves stacking behavior.
- `EforgeEngine.buildSinglePrd` preserves trunk-sync behavior.
- Event schemas are unchanged.
- Route constants are unchanged.
- Daemon wire shapes are unchanged.
- CLI user-facing behavior is unchanged.
- Pi user-facing behavior is unchanged.
- Queue directory layout is unchanged.
- Build orchestration semantics are unchanged.
- No raw daemon route literals are introduced.
- No duplicate daemon wire-shape interfaces are introduced.
- No raw engine `git commit` calls are introduced.
- No direct state mutation outside the existing event-driven state mutation path is introduced.
- Provider SDK imports are not moved.
- No new dependencies are introduced.
- `test/queued-compiled-resume-engine.test.ts` passes as part of `pnpm test`.
- `test/engine-enqueue-after-queue-id.test.ts` passes as part of `pnpm test`.
- `test/recovery-continuation-queue.test.ts` passes as part of `pnpm test`.
- `test/greedy-queue-scheduler.test.ts` passes as part of `pnpm test`.
- `test/onsuccess-override-precedence.test.ts` passes as part of `pnpm test`.
- `test/with-run-id.test.ts` passes as part of `pnpm test`.
- `test/pi-ambient-status-no-start.test.ts` passes as part of `pnpm test`.
- `pnpm type-check` exits 0.
- `pnpm test` exits 0.
- `pnpm maintainability:check` exits 0.
- A final `pnpm complexity:scan` run no longer reports the original high-CC entry for `packages/eforge/src/cli/display.ts:126` `renderEvent`.
- A final `pnpm complexity:scan` run no longer reports the original high-CC entry for `packages/pi-eforge/extensions/eforge/index.ts:443` `eforge_status` `renderResult`.
- A final `pnpm complexity:scan` run no longer reports the original high-CC entry for `packages/engine/src/eforge.ts:990` `EforgeEngine.buildSinglePrd`.

## Manual Verification Notes

- Final `pnpm complexity:scan` verification should focus on the named functions/helper structure, not on requiring a specific total scan-table rank.
- Run `pnpm type-check` after refactoring to catch type narrowing regressions from extracted event/status helpers.
- Run `pnpm test` to verify queue, resume, recovery, session-id, and Pi status behavior.
- Run `pnpm maintainability:check` to enforce file-size ratchets and region marker balance.
- Run `pnpm complexity:scan` at the end to confirm the three selected functions no longer exceed the stated CC targets.
- If unavoidable whitespace-only CLI/Pi rendering differences occur, explicitly justify them in code review.