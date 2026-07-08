---
title: Direct PR base-sync recovery UX
created: 2026-07-08
---

# Direct PR base-sync recovery UX

## Problem / Motivation

Direct non-stacked PR builds run a base sync before validation so the feature branch is current with the target base before PR publication. The core helper already has a default conflict-resolution budget and a per-call `conflictAttempts` option, but the budget is not exposed through project config and orchestration does not pass a configured value.

When base sync hits repeated rebase conflicts, resolver agents can be actively resolving multiple waves while the user sees little or no meaningful progress. Current surfaced messages are mostly generic `planning:progress`, landing skip output, or merge-resolver events attributed to `conflict.branch`; for direct PR base-sync this may be the feature branch rather than a normal `plan-NN` id. The result is a long run that appears idle until it fails, and the exhausted-budget failure does not give enough recovery guidance.

## Goal

Improve direct PR base-sync observability and recovery by wiring a validated `landing.directPrBaseSync.conflictAttempts` config through orchestration, adding typed base-sync lifecycle events, and rendering those events clearly in the CLI and Console even when resolver activity is attributed to the feature branch rather than a normal plan id.

Keep the default bounded behavior, avoid branch-size-derived auto-scaling or broader landing workflow changes, and make exhausted-budget failures actionable. Confidence should come from config, event-schema, engine flow, CLI display, Console lane, and regression tests plus workspace type-check/test/maintainability gates.

## Approach

### Implementation approach

- Add a project config surface for `landing.directPrBaseSync.conflictAttempts` with validation, documented defaults, and clamping.
- Wire the resolved config through the non-stacked direct PR base-sync orchestration path before validation.
- Emit typed base-sync lifecycle events for start, conflict attempt N/M, resolver start/complete, `rebase --continue`, success/no-op success, and exhausted-budget failure.
- Improve the exhausted-budget failure message so it includes the configured attempt count and concrete next steps: increase config within documented bounds or resolve/rebase manually.
- Update CLI output and Console run-state/lane rendering so base-sync and merge-resolver activity is visible and clearly labeled even when the raw `planId` is the feature branch.
- Add tests for config defaults/overrides/clamping, event emission, orchestration wiring, exhausted-budget guidance, and CLI/Console rendering.
- Document the new config key and regenerate/check docs if config reference artifacts are generated.

### Code impact

Likely touched areas:

- `packages/engine/src/config.ts`: add the config schema, resolved `LandingConfig` shape, defaults, merge behavior, validation/clamping constants, and any config warning behavior consistent with existing patterns.
- `packages/engine/src/direct-pr-base-sync.ts`: preserve the default, apply sanitized attempt values, emit or expose lifecycle progress, and improve exhausted-budget messaging.
- `packages/engine/src/orchestrator/phases.ts`: pass the resolved config into direct PR base sync and yield progress events in real time rather than only after completion/failure.
- `packages/engine/src/recovery/accept-success-landing.ts`: audit the existing direct base-sync callsite so default/config behavior and improved failure messaging remain consistent where this helper is reused.
- `packages/client/src/events/variants/build.ts` and related client exports/tests: add the typed additive base-sync event family and validate through shared event parsing.
- `packages/eforge/src/cli/display.ts`: render base-sync lifecycle and resolver progress with clear branch/base/attempt context.
- `packages/console-ui/src/lib/run-state/lane-registry.ts`, `packages/console-ui/src/lib/run-state/selectors/plan-progress.ts`, and possibly `handlers/handle-agent.ts`: add a stable synthetic lane/label or normalization path for direct PR base-sync and feature-branch resolver attribution.
- Tests under `test/` and `packages/console-ui/src/lib/run-state/__tests__/`: add engine/config/event tests and Console selector/lane tests; add or extend CLI display tests if that package already has a rendering test harness.

Architecture impact is additive: the engine emits typed lifecycle events, `@eforge-build/client` owns the wire contract, and CLI/Console render without new daemon routes or workflow orchestration.

### Design decisions

- Keep event ownership in `@eforge-build/client`: add typed event variants once and consume them from engine, CLI, and Console.
- Prefer a dedicated lifecycle family over overloading `planning:progress`; generic progress can remain as compatibility/noise-reduction only if existing consumers need it.
- Keep the engine headless: engine emits events, consumers render; no direct stdout writes from engine code.
- Use explicit config bounds rather than deriving attempts from branch size or conflict count. This keeps runs predictable and costs bounded while still letting users opt into a larger budget.
- Convert direct base-sync progress into live yielded events. If the helper cannot yield events directly in its current Promise shape, refactor toward a small step/generator or progress callback that the orchestration phase can translate into `EforgeEvent`s without buffering until the end.
- Use branch/base metadata on lifecycle events, and use a stable display lane such as direct PR base sync for product surfaces. Avoid treating an arbitrary feature-branch string as an ordinary plan lane unless the UI label makes that explicit.
- Preserve existing merge-conflict-resolver decision emission discipline; do not introduce direct `plan:build:decision` yields outside the helper utilities.

### Assumptions

- The selected behavior is additive and backward-compatible for existing event consumers.
- The configured attempt value is resolved at build startup with the rest of project config and is not changed mid-run.
- Temporary git repositories are acceptable for direct base-sync tests so behavior is exercised against real git rather than mocks.

### Validation plan and gates

- Add config tests for unset default, valid override, invalid type/value handling, min/max clamping, and global/project merge behavior if nested landing config is affected.
- Add engine tests for direct base-sync event order across clean/no-op sync, conflict resolver success, repeated conflict attempts, and exhausted budget.
- Validate new events with `safeParseEforgeEvent` and ensure TypeScript consumers compile against the shared schema.
- Add CLI rendering tests or focused display assertions for start, attempt, resolver complete, success, and exhausted messages.
- Add Console lane-registry/selector tests for the synthetic base-sync lane and merge-conflict-resolver feature-branch attribution.
- Check docs/config reference output if schema-derived docs change.
- Run targeted vitest tests, then `pnpm type-check`, `pnpm test`, `pnpm maintainability:check`, and docs generation/checks if config reference artifacts change.

Key risks to validate: progress must not be buffered until after sync completion; event names must stay consistent across client, engine, CLI, and Console; attempt bounds must prevent runaway resolver cost; and feature-branch lane normalization must not relabel unrelated agent activity.

## Scope

### In scope

- Add a project config surface for `landing.directPrBaseSync.conflictAttempts` with validation, documented defaults, and clamping.
- Wire the resolved config through the non-stacked direct PR base-sync orchestration path before validation.
- Emit typed base-sync lifecycle events for start, conflict attempt N/M, resolver start/complete, `rebase --continue`, success/no-op success, and exhausted-budget failure.
- Improve the exhausted-budget failure message so it includes the configured attempt count and concrete next steps: increase config within documented bounds or resolve/rebase manually.
- Update CLI output and Console run-state/lane rendering so base-sync and merge-resolver activity is visible and clearly labeled even when the raw `planId` is the feature branch.
- Add tests for config defaults/overrides/clamping, event emission, orchestration wiring, exhausted-budget guidance, and CLI/Console rendering.
- Document the new config key and regenerate/check docs if config reference artifacts are generated.

### Out of scope

- No branch-size-derived auto-scaling of conflict attempts.
- No change to direct PR landing semantics, PR creation, auto-merge policy, stack landing, queue scheduling, or daemon route design.
- No broad redesign of merge-conflict-resolver prompts beyond attribution/progress needed for this path.

## Acceptance Criteria

- Unset config preserves the current default direct PR base-sync conflict budget of 12 attempts.
- `landing.directPrBaseSync.conflictAttempts` can override the budget for direct non-stacked PR base sync.
- Invalid, non-integer, too-low, or too-high config values are validated and clamped or rejected with clear config feedback according to the existing config style; the chosen bounds are centralized and documented.
- Orchestration passes the resolved budget into `syncDirectPrBase`; no branch-size-derived auto-scaling is introduced.
- The base-sync lifecycle emits typed events for start, conflict attempt N/M, resolver start, resolver complete, rebase continue, success, and exhausted budget.
- Exhausted-budget messages include the configured attempt count and suggest increasing the config or completing the rebase manually.
- CLI output shows base-sync progress and resolver activity without making the run look idle.
- Console lanes/selectors label direct base-sync and associated merge-resolver activity clearly, including feature-branch `planId` cases.
- Event schemas remain owned by `@eforge-build/client`, and consumers import/use the shared event types rather than redeclaring wire shapes.
- Tests cover config override/default/clamping, lifecycle event validation, engine progress ordering, exhausted-budget message text, CLI rendering, and Console lane behavior.