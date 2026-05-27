---
title: Add Engine-Owned Daemon-Scoped On-Demand Stack Sync
created: 2026-05-26
profile: gpt-claude-combo
landing: pr
landing_auto_merge: true
---

# Add Engine-Owned Daemon-Scoped On-Demand Stack Sync

## Problem / Motivation

The desired long-term workflow is to rapidly enqueue many plans throughout the day and manage them from the console with confidence that stack branch hygiene is handled by eforge, not by manual shell commands or risky background mutation.

Today stack sync exists, but it is split across layers:

- The daemon route is relatively safe because it runs from project `options.cwd` and computes active-build exclusions.
- The CLI can fall back to local in-process sync when no daemon is found from the current cwd.
- A shell command such as `eforge stack sync` in `build.postMergeCommands` can execute from an agent merge worktree, miss the project daemon lockfile, and fall back to local mutation.

That means `eforge stack sync` is currently useful manually, but it is not yet the right primitive for automated workflow hooks. The branch-management foundation should instead expose stack sync as an engine/daemon-owned on-demand operation with clear safety rules, active-build awareness, durable status, and console visibility.

This is distinct from the pre-compile trunk sync gate: trunk freshness is a narrow fetch/base-selection operation for root builds; stack sync/restack is a git-spice global stack mutation that needs stronger coordination.

Evidence gathered:

- `packages/engine/src/stacking/sync.ts` already provides `performStackSync(config, { cwd, dryRun, excludedBranchPrefixes })`. It calls `git-spice repo sync`, then conditionally calls `git-spice stack restack` when there are stack candidates and no excluded active-build branches.
- `performStackSync()` currently delegates active-build exclusion discovery to callers. It reports `excludedCandidates`, `restackCandidates`, provider commands, trunk SHAs, `fastForward`, and `outcome`.
- `packages/monitor/src/server.ts` exposes `POST /api/stack/sync`. That route runs from daemon/project `options.cwd`, loads config there, derives active build prefixes from `db.getRunningRuns()`, calls `performStackSync()`, and reports `activeBuildSkips`.
- `packages/client/src/routes.ts` owns the wire shape for `StackSyncRequest` and `StackSyncResponse`; `packages/client/src/api/stack.ts` exposes `apiStackSync` and `apiStackSyncIfRunning`.
- `packages/eforge/src/cli/index.ts` currently implements `eforge stack sync` by preferring the daemon route when a daemon is visible from the current cwd, but it can fall back to local in-process `performStackSync()` if no daemon is found.
- Agent worktree daemon-client safety exists in `packages/client/src/daemon-client.ts` (`isAgentWorktreeCwd()` and `DaemonInWorktreeError`), but `daemonRequestIfRunning()` only checks the cwd's own lockfile and returns `null` when a daemon is not found. A command running from an agent worktree can therefore miss the project root daemon and fall back locally unless the CLI is hardened.
- Pi and Claude stack sync user surfaces already exist: `packages/pi-eforge/extensions/eforge/stack-sync-command.ts`, the `eforge_stack_sync` tool, and `eforge-plugin/skills/stack/stack.md`.
- `docs/stacking.md` currently documents manual sync and an opt-in `build.postMergeCommands: ["eforge stack sync"]` pattern. That pattern is now considered unsafe/too shell-command-oriented for the desired workflow and should be replaced with engine/daemon-owned on-demand sync guidance.
- Roadmap alignment: `docs/roadmap.md` says Daemon & MCP Server should be the single orchestration authority with richer controls and safety checks. Engine-owned daemon-scoped stack sync aligns with that direction.
- Stack provider boundary check: direct git-spice execution is centralized in `packages/engine/src/stacking/git-spice.ts` behind `StackProviderAdapter` in `packages/engine/src/stacking/provider.ts`. Some provider-specific details still leak into non-provider code: `packages/engine/src/stacking/sync.ts` hard-codes dry-run/error argv such as `repo sync` and `stack restack`, and `packages/engine/src/stacking/landing.ts` imports git-spice-specific PR URL parsing/redaction helpers. This follow-up should tighten that boundary.

Conclusion: the primitives are partially present, but sync needs a stronger safety boundary and lifecycle integration. The follow-up should centralize stack sync behind daemon/project-root execution, remove unsafe local fallback from agent worktrees, add durable/observable sync state, and expose safe triggers for manual and workflow-driven on-demand sync without periodic background restacking.

Recommended profile: **Excursion**.

Rationale: this is cross-cutting across engine, daemon, client wire types, CLI/Pi surfaces, docs, and possibly console UI, but the work is cohesive and can be planned as one feature without delegated module planning. It should not be an Errand because the safety boundary and concurrency behavior are central to correctness.

## Goal

Add an engine/daemon-owned on-demand stack sync workflow that runs from the project root daemon context, coordinates active-build-aware stack mutations safely, exposes durable status and diagnostics to clients, and replaces unsafe shell-command automation guidance.

## Approach

Treat stack sync as a daemon-owned operation, not a validation or `postMerge` shell command.

- Daemon execution has access to project root cwd, monitor DB active runs, queue/build state, and can coordinate mutations.
- Shell execution from a merge worktree cannot reliably provide those guarantees.

Keep sync on-demand rather than periodic by default.

- `git-spice stack restack` is global and can conflict.
- Explicit triggers such as manual console action, after-build request, or before-submit request are easier to reason about and debug.
- Periodic background restacking would introduce surprising branch mutation and more conflict states.

Support deferred sync as a first-class outcome.

- When active builds overlap restack candidates, the safe behavior is to record that sync is needed/deferred, not to run a global restack anyway.
- The console can show the deferred state and let the user retry when builds finish.

Add a daemon-level mutex around sync.

- Manual CLI, console, MCP, after-build, and retry-deferred triggers may arrive concurrently.
- Only one provider sync/restack should mutate git-spice state at a time.

Harden CLI fallback behavior.

- If a project daemon is reachable, use it.
- If cwd is an agent worktree, never run local wet fallback. Either discover the project root daemon or fail with guidance.
- If no daemon exists and cwd is a normal project root, wet local fallback can be removed entirely or kept only behind a deliberate option. If kept, it must not be used by automation paths.
- Dry-run fallback may be safer, but should still be clear about lack of daemon active-build knowledge.

Use shared report and event shapes.

- CLI, Pi, MCP, and console should all show the same outcome vocabulary: complete, skipped, deferred, failed, conflict.
- If `deferred` is added, route types, docs, and UI rendering must all understand it.

Persist enough sync state for queue/workflow management.

- Queue management features need confidence signals.
- The console should be able to show last sync result, deferred reason, conflicting command, and active-build skips without relying on a transient HTTP response.

Do not auto-pause global auto-build for ordinary defer/skip outcomes.

- A defer due to active builds is expected and should not stop unrelated work.
- Conflict or corrupted sync state may warrant visible failure and possibly optional pause policy, but ordinary overlap should simply remain retryable.

Enforce the stack provider boundary while adding daemon-owned sync.

- Engine orchestration should depend on provider-neutral methods such as `syncRepo`, `restackStack`, `submitBranch`, command previews, PR URL parsing, and redaction.
- Engine orchestration should not depend on git-spice argv or output conventions.
- This prevents the new sync service from deepening git-spice coupling and keeps future provider support viable.

Likely files/modules to change:

- `packages/engine/src/stacking/sync.ts`: refactor the existing helper into a stronger service-style primitive, or add a wrapper that owns trigger metadata, active-build policy, mutex coordination inputs, and report normalization. Remove git-spice-specific argv construction from this module; command previews and provider-specific command records should come from the provider adapter.
- `packages/monitor/src/server.ts`: keep `POST /api/stack/sync` as the daemon entry point, but move active-build exclusion collection/report shaping into a shared daemon/engine service to avoid parallel logic. Add support for trigger/active-build policy and durable status updates.
- `packages/client/src/routes.ts` and `packages/client/src/api/stack.ts`: extend `StackSyncRequest`/`StackSyncResponse` with trigger, active-build policy, deferred state, sync id, started/completed timestamps, and possibly last status route types.
- `packages/client/src/events.schemas.ts`: add stack sync lifecycle events if the UI should observe sync starts/completions through SSE, e.g. `stack:sync:start`, `stack:sync:complete`, `stack:sync:deferred`, `stack:sync:failed`, `stack:sync:conflict`.
- `packages/engine/src/stacking/provider.ts` and `packages/engine/src/stacking/git-spice.ts`: extend the provider adapter if needed so provider-specific command previews, output parsing, and message redaction are encapsulated behind the provider boundary.
- `packages/engine/src/stacking/landing.ts`: stop importing git-spice-specific parsing/redaction helpers directly; call provider-level operations/helpers instead.
- `packages/monitor/src/server.ts` daemon event streaming/snapshot code: include last/deferred stack sync state if console needs durable visibility beyond one HTTP response.
- `packages/eforge/src/cli/index.ts`: harden `eforge stack sync` so it routes to the project daemon/root or fails safely. It must not perform local fallback mutation from agent worktrees. Consider removing wet-run local fallback entirely, or allowing only `--dry-run` fallback outside agent worktrees.
- `packages/client/src/daemon-client.ts`: add helper logic to discover the project root daemon from an agent worktree cwd, or return a specific safe error so callers do not silently fall back locally.
- `packages/pi-eforge/extensions/eforge/stack-sync-command.ts` and the `eforge_stack_sync` tool: surface new report fields and deferred/conflict states.
- `eforge-plugin/skills/stack/stack.md` and matching Pi skill/docs: update user guidance around manual sync, deferred sync, and conflict recovery.
- `docs/stacking.md`, `docs/config.md`, `web/content/docs/configuration.md`, and generated docs: replace the `build.postMergeCommands` automation recommendation with daemon-owned on-demand sync guidance.
- Console UI packages (`packages/console-ui` and/or `packages/monitor-ui` depending current migration state): add or prepare stack sync status display and manual trigger controls if this scope includes UI wiring.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|---|---|---:|---:|---|---|
| Existing daemon route is safer than CLI local fallback because it runs from project root and derives active-build exclusions from running DB runs. | Read `packages/monitor/src/server.ts` stack sync route; it uses `options.cwd`, `db.getRunningRuns()`, and `excludedBranchPrefixes`. | high | low | Add route-level tests that active runs produce excluded candidates and skips. | Sync could mutate active build branches if active-build detection is incomplete. |
| CLI local fallback can be unsafe from agent worktrees. | Read `packages/eforge/src/cli/index.ts` and `packages/client/src/daemon-client.ts`; `apiStackSyncIfRunning` returns null when cwd lacks a daemon lockfile, then CLI falls back to local `performStackSync()`. | high | low | Add a test invoking stack sync from a fake agent worktree cwd with no local lockfile and assert no wet fallback runs. | Automation may still mutate stack branches from the wrong cwd. |
| On-demand triggers are sufficient for near-term correctness; periodic sync is not required. | Current desired triggers are manual console/CLI, after-build, and before-submit. Stack restack is global and active-build overlap already requires skip/defer. | medium | medium | Observe workflow after pre-compile trunk sync lands; add console-visible deferred sync status and see if manual/after-build triggers suffice. | If sync is needed while no trigger occurs, stale local stack branches may persist longer than desired. |
| A daemon-level mutex is needed. | Multiple surfaces already exist: CLI, MCP/Pi tool, and future console/manual/after-build triggers. | high | low | Add concurrent request tests and ensure one request runs while the other returns busy/deferred or waits. | Concurrent provider commands could corrupt git-spice/rebase state. |
| Durable sync state should live with daemon/runtime state, not committed config. | Stack state already lives under `.eforge/stacks/layers.json`; daemon DB records runtime events. | high | medium | Decide whether state belongs in monitor DB, `.eforge/stacks`, or both; test restart visibility. | Console may lose context after daemon restart. |
| Adding `deferred` as a new outcome is better than overloading `skipped`. | Desired workflow distinguishes harmless active-build defer from disabled stacking or no-op skipped. Existing route currently uses `skipped`/reason patterns. | medium | low | Update response type and rendering tests; alternatively keep outcome `skipped` with structured `deferred: true`. | UI/CLI may not clearly communicate retryable pending sync state. |
| Git-spice command details should not leak outside the provider layer. | `provider.ts` defines `StackProviderAdapter`, but `stacking/sync.ts` currently constructs `repo sync` / `stack restack` command records and `stacking/landing.ts` imports git-spice parsing/redaction helpers. | high | low | Add grep/unit tests for forbidden imports/argv outside provider modules; move preview/parsing/redaction helpers behind the adapter. | New sync code could make future provider support harder and duplicate provider-specific behavior. |

## Scope

In scope:

- Add an engine/daemon-owned on-demand stack sync workflow that runs from the project root daemon context, not from arbitrary shell command cwd.
- Harden `eforge stack sync` so it cannot perform local fallback stack mutation from an agent worktree.
- Reuse or refactor `performStackSync()` so manual CLI/tool/UI sync and workflow-triggered sync share the same active-build-aware code path.
- Clean up the stack provider boundary so non-provider engine modules do not hard-code git-spice argv, parse git-spice output, or call git-spice-specific helper functions directly.
- Add a daemon-level stack-sync mutex/lock so only one stack sync can run at a time.
- Add trigger metadata to sync requests/reports, e.g. `trigger: manual | after-build | before-submit | retry-deferred`.
- Add a safe active-build policy, e.g. `skip` or `defer`, where global `git-spice stack restack` is not run when active builds overlap the stack.
- Persist or otherwise expose last sync status, deferred sync state, conflict/failure state, active-build skips, and provider command history sufficiently for console UI and CLI diagnostics.
- Add safe manual trigger surfaces for CLI/MCP/Pi/console to request dry-run or wet-run sync through the daemon route.
- Optionally schedule an after-build/after-landing sync request from engine/daemon code, but only as a daemon-owned deferred operation with active-build safeguards.
- Update docs to remove or strongly discourage `build.postMergeCommands: ["eforge stack sync"]` as an automation pattern.

Out of scope:

- Always-on periodic stack sync polling.
- Running `git-spice stack restack` in the background without an explicit trigger or lifecycle event.
- Auto-resolving restack conflicts.
- Force-resetting, rebasing, or force-pushing trunk outside git-spice's normal provider behavior.
- Adding new stack providers beyond git-spice. Provider-boundary cleanup should make future providers easier, but this slice still supports only git-spice.
- Queue priority/back-burner UI itself; this work only provides a safe sync primitive for later queue-management workflows.
- Replacing the pre-compile trunk sync gate; that remains a separate root-build freshness feature.

## Acceptance Criteria

- Wet stack sync requested from an agent worktree does not execute local in-process `performStackSync()` fallback.
- Wet stack sync requested from an agent worktree either routes to the project daemon/root or returns a clear safe error.
- Manual CLI stack sync uses the same daemon-owned stack sync path when the daemon is running.
- MCP stack sync uses the same daemon-owned stack sync path when the daemon is running.
- Pi stack sync uses the same daemon-owned stack sync path when the daemon is running.
- The daemon-owned stack sync path runs provider commands from the project root cwd.
- A daemon-level stack sync mutex prevents two wet stack sync operations from running provider commands concurrently.
- A dry-run stack sync reports provider commands without executing provider commands.
- A wet stack sync with active-build overlap does not invoke the provider's full-stack restack operation.
- A wet stack sync with active-build overlap records a retryable skipped or deferred state with active-build skip details.
- A wet stack sync with no active-build overlap invokes the provider's repo sync operation before any full-stack restack operation.
- A wet stack sync with eligible restack candidates and no active-build overlap invokes the provider's full-stack restack operation.
- Non-provider engine modules do not hard-code git-spice argv for sync, restack, submit, or tracking operations.
- Non-provider engine modules do not import `packages/engine/src/stacking/git-spice.ts` directly, except the provider factory/index surface as needed.
- Provider-specific PR URL parsing is accessed through provider-level helpers rather than direct git-spice imports from orchestration modules.
- Provider-specific output redaction is accessed through provider-level helpers rather than direct git-spice imports from orchestration modules.
- Stack sync conflict outcomes are represented distinctly from ordinary active-build deferrals.
- Stack sync failure outcomes include the failed provider command.
- Stack sync failure outcomes include sanitized error output.
- Last stack sync status is available to daemon clients after the sync HTTP response has completed.
- Last stack sync status survives daemon restart if durable state is implemented in this slice.
- Console or monitor UI can render last sync outcome from shared wire data.
- Console or monitor UI can render active-build skips from shared wire data.
- Console or monitor UI can render provider commands from shared wire data.
- Console or monitor UI can render conflict or failure reason from shared wire data.
- Documentation no longer recommends `build.postMergeCommands: ["eforge stack sync"]` as the automatic sync mechanism.
- Documentation explains manual stack sync triggers.
- Documentation explains after-build stack sync triggers.
- Documentation explains deferred/retry stack sync triggers.
- Unit tests verify active-build overlap behavior.
- Unit tests verify defer or skip policy behavior.
- Tests verify that wet stack sync invoked from an agent worktree cannot fall back to local mutation.
- Tests verify that the daemon route uses project root cwd.
- Tests verify that the daemon route reports active-build skips.
- Tests verify the new stack sync route request shapes.
- Tests verify the new stack sync route response shapes.
- Tests verify the new stack sync client helpers.
- Tests verify stack sync lifecycle events if new event types are added.
- Docs tests verify that `build.postMergeCommands: ["eforge stack sync"]` is no longer presented as the recommended automatic sync mechanism.
- A grep-style or unit regression test fails if non-provider engine modules hard-code git-spice argv such as `repo sync`, `stack restack`, or `branch submit`.
- A grep-style or unit regression test fails if non-provider engine modules import `stacking/git-spice` directly, except for the provider factory and provider tests.
- `pnpm type-check` exits 0.
- `pnpm test` exits 0.
