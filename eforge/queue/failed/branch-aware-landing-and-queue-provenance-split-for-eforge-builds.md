---
title: Branch-Aware Landing and Queue/Provenance Split for Eforge Builds
created: 2026-05-22
profile: gpt-claude-combo
---

# Branch-Aware Landing and Queue/Provenance Split for Eforge Builds

## Problem / Motivation

Eforge currently conflates three concerns that should be separate:

1. **Build dispatch / queue state** — the daemon needs durable runtime files to schedule pending, waiting, failed, and skipped PRDs.
2. **Build provenance** — the formatted PRD should be preserved in git history so reviewers can understand what was asked of eforge.
3. **Landing behavior** — after a successful build, eforge must decide whether to create a PR, merge locally, or leave a branch.

Today those concerns produce surprising workflows:

- Enqueue writes a formatted PRD to `prdQueue.dir` defaulting to `eforge/queue`, and commits it immediately on the user's current branch. If the user is on trunk and only wants eforge to create a PR, trunk still receives a queue/PRD commit.
- `issue-pr` pushes `eforge/{planSetName}` and opens a PR to the captured base branch. If the user starts from a local feature branch, the PR targets that feature branch rather than trunk.
- `merge-to-base-branch` can merge into the captured base branch, including trunk, unless a caller/UX happens to avoid that.

### Important current-behavior clarification

Current `issue-pr` does **not** mean “finish my current feature branch and PR it.” It means “push the eforge work branch and create a PR to the captured base branch.” This is surprising on non-trunk branches and is the main landing behavior being changed.

### Desired workflows

- **WF1 — starting from protected/team trunk**
  - The user can plan/build from trunk when they want a PR.
  - Eforge should make clear that the result will be a PR.
  - Local merge to trunk is not allowed by default.
  - The user can confirm, cancel, or create/switch to a local feature branch for local-merge workflow.

- **WF2 — starting from a local feature branch**
  - The user chooses PR or local merge.
  - Local merge integrates eforge output into the current branch.
  - PR integrates eforge output into the current branch first, then opens a PR from that branch to trunk.

- **WF3 — solo/unprotected trunk**
  - During `/eforge:init`, eforge detects and confirms the local trunk branch.
  - Eforge asks whether trunk should be protected or whether local merges to trunk are allowed.
  - A solo developer can opt into local trunk merge, preserving the low-friction early-stage workflow where eforge lands on local `main` and the developer pushes to `origin` when ready.

### Evidence from the codebase

- `packages/engine/src/config.ts` defaults `prdQueue.dir` to `eforge/queue`, which is a normal tracked path unless project config/gitignore changes it.
- `packages/engine/src/eforge.ts` calls `enqueuePrd(...)` and then `commitEnqueuedPrd(...)` during enqueue, so the formatted PRD/queue file is currently committed on the user's current branch.
- `packages/engine/src/prd-queue.ts` contains multiple helpers that commit queue-state mutations:
  - `commitEnqueuedPrd`
  - failed/skipped moves
  - routed profile changes
  - recovery sidecars
  - These must be reviewed because queue state is moving to gitignored runtime state.
- `.gitignore` already ignores `.eforge/`, and project instructions describe `.eforge/` as daemon runtime/developer-facing state.
- `packages/engine/src/landing.ts` shows `issue-pr` currently pushes `eforge/{planSetName}` and creates `gh pr create --base <baseBranch> --head <eforgeBranch> --fill`; it does not merge locally first.
- `packages/engine/src/landing.ts` invokes cleanup only in the `merge-to-base-branch` path. PR workflows currently do not run the plan/PRD cleanup path before push/PR creation.
- `packages/client/src/routes.ts`, `packages/monitor/src/server.ts`, CLI commands, and Pi/Claude skills already expose an `onSuccess` override, but the desired branch-aware behavior requires deeper engine/worktree changes, not only docs/UX.

### Roadmap alignment

`docs/roadmap.md` does not currently mention landing/queue workflow changes. This plan is a near-term integration/architecture correction to make existing landing actions safe and predictable, rather than a new roadmap category.

## Goal

Rework eforge's successful-build landing workflow so it is branch-aware, safe by default, and does not pollute trunk with queue/provenance commits.

The desired model is:

- From trunk, eforge should drive PR-producing builds without committing queue files and should block local merge by default.
- Solo developers should be able to explicitly opt into local merge to trunk for unprotected/early-stage projects.
- From a local feature branch, eforge should let the user choose either local merge into that branch or “finish this branch and open a PR from it.”
- PRD provenance should still exist in git history, but as a temporary artifact on the eforge work branch/feature branch, not as queue state committed to trunk.
- Runtime queue state belongs in `.eforge/queue` and should not be committed.
- Branch policy should be explicit project configuration captured by `/eforge:init`, not only inferred at each build.

## Approach

### Key design decisions

#### 1. Separate runtime queue state from committed PRD provenance

Runtime queue files are scheduler/daemon state, not product artifacts. They should live under `.eforge/queue` and should not be committed. The formatted PRD remains important provenance, but it should be committed on the eforge work branch as a temporary build artifact.

Decision:

- Default `prdQueue.dir` becomes `.eforge/queue`.
- Enqueue writes runtime queue files only; it does not commit to the user's current branch.
- Build materializes `eforge/prds/{prdId}.md` on the eforge work branch and commits it.
- Cleanup removes `eforge/prds/{prdId}.md` before landing, preserving history without cluttering the final tree.

#### 2. Treat trunk local merge as explicit opt-in

Local merge into trunk should not be the default team-safe eforge landing path. If the user starts from trunk, the default workflow is PR creation. However, solo developers working on unprotected `main` should be able to choose a low-friction local-main workflow explicitly.

Decision:

- `/eforge:init` detects trunk via `origin/HEAD`, falls back to `main`, and asks the user to confirm or correct the local trunk branch.
- Persist the confirmed trunk branch in config, proposed as `build.trunkBranch`.
- Runtime code uses this configured value when present and falls back to detection only for older/minimal configs.
- `/eforge:init` asks whether trunk should be protected/team-safe or whether local trunk merges are allowed for solo/unprotected projects.
- Persist an explicit config opt-in for trunk local merge, proposed as `build.allowLocalMergeToTrunk: true`, default `false`.
- Reject `merge-to-base-branch` at engine landing time when base branch is trunk and the opt-in is not enabled.
- If the opt-in is enabled, `merge-to-base-branch` on trunk lands on local trunk after validation and does not push automatically.
- UX should surface the decision before enqueue/build using the configured branch policy:
  - confirm PR workflow
  - cancel
  - switch/create a feature branch
  - explain how to enable solo-dev local trunk merge

#### 3. Redefine non-trunk PR workflow around the user's feature branch

The user's mental model for choosing PR while on a local feature branch is: “finish my local feature branch, then open a PR from it.” Current behavior instead opens `eforge/{planSetName} -> feature/my-work`.

Decision:

- On non-trunk branches, `issue-pr` first integrates the eforge work branch into the user's local branch.
- Then eforge pushes the user's local branch and opens a PR from that branch to trunk.
- On trunk branches, `issue-pr` remains direct: eforge work branch -> trunk.

#### 4. Preserve `onSuccess` as a default preference, not an unsafe command

`build.onSuccess` remains useful as a default, but the configured branch policy, `trunkBranch` plus trunk-local-merge opt-in, determines which landing choices are valid.

Decision:

- If config/default says `merge-to-base-branch` while on trunk and `allowLocalMergeToTrunk` is false, engine rejects it with a clear remediation message.
- If config/default says `merge-to-base-branch` while on trunk and `allowLocalMergeToTrunk` is true, engine allows local trunk landing and does not push.
- If config/default says `issue-pr` while on non-trunk, UX should still ask because both PR and local merge are valid and materially different.
- Per-build overrides still exist, but they are validated against branch safety and trunk opt-in policy.

#### 5. Cleanup before all successful landings

Current cleanup is tied to the `merge-to-base-branch` path. With PRD artifacts and PR workflows, cleanup must happen before any final branch is pushed/merged.

Decision:

- Run cleanup after successful validation and before final landing for both PR and local merge workflows.
- Cleanup removes plan artifacts and temporary PRD artifacts.
- If cleanup fails, preserve current non-fatal cleanup behavior unless the failure would cause PRD/plan clutter in a PR.
- Implementation should decide whether PR workflows need stricter cleanup failure handling and test that choice.

#### 6. Avoid new user-facing target/base configuration for now

Explicit landing target selection and `persistBuildPrds` may be useful later, but they are not needed for the simplified workflow.

Decision:

- No explicit `--base`/landing-target option in this change.
- No `persistBuildPrds` configuration in this change.
- Use `eforge/prds/` as the temporary committed PRD artifact path.

### Core queue/runtime state changes

- `packages/engine/src/config.ts`
  - Change default `prdQueue.dir` from `eforge/queue` to `.eforge/queue`.
  - Add configured trunk branch, proposed name: `build.trunkBranch`, default detected/fallback `main`.
  - Add an explicit opt-in config for solo/unprotected trunk local merge, proposed name: `build.allowLocalMergeToTrunk`, default `false`.
  - Update config schema/default tests and generated config schema docs.

- `packages/engine/src/prd-queue.ts`
  - Keep queue read/write helpers for runtime files.
  - Remove or narrow git-commit behavior for queue files now that queue state is gitignored runtime state.
  - Review helpers that currently `git mv`/commit failed, skipped, waiting, recovery, routed profile, and cleanup transitions.
  - These should become filesystem/runtime-state transitions unless they are explicitly writing build provenance.

- `packages/engine/src/eforge.ts`
  - Stop calling `commitEnqueuedPrd(...)` during enqueue.
  - Carry queued PRD identity/content into build so the build can commit a temporary PRD artifact on the eforge work branch.
  - Ensure recovery/successor PRD creation writes runtime queue state without committing it to the user's current branch.

- `packages/engine/src/queue/scheduler.ts`
  - Continue loading pending/waiting queue items from the new default `.eforge/queue` path and forwarding PRD metadata to child workers.

- `packages/monitor/src/server.ts` and monitor UI queue projections
  - Update default queue path assumptions and queue scanning to `.eforge/queue`.

### PRD provenance artifact changes

- Add a helper to materialize a formatted PRD artifact under `eforge/prds/{prdId}.md` in the eforge merge worktree/work branch and commit it via `forgeCommit(...)`.
- Thread the materialized artifact path into cleanup.
- `cleanupPlanFiles` already accepts a PRD path.
- Ensure PRD artifacts are committed early enough to appear in history for PR/local-merge workflows but removed before the final branch tree is presented.

### Landing policy and branch operation changes

- Add a trunk detection/config resolution helper in engine git/worktree utilities:
  - Prefer configured `build.trunkBranch` when set.
  - For init/defaulting/migration, detect from `origin/HEAD`, for example `refs/remotes/origin/main` -> `main`.
  - Fallback to `main` when unavailable.

- Extend landing execution/worktree manager behavior:
  - Reject `merge-to-base-branch` when base branch is trunk unless explicit trunk-local-merge opt-in config is enabled.
  - For trunk + `issue-pr`: keep direct PR from eforge work branch to trunk.
  - For trunk + `merge-to-base-branch` + opt-in enabled: merge eforge work branch into local trunk and do not push automatically.
  - For non-trunk + `merge-to-base-branch`: merge eforge work branch into the local base branch.
  - For non-trunk + `issue-pr`: merge eforge work branch into the local base branch, push that base branch, and create PR from base branch to trunk.

- Ensure cleanup runs before push/PR creation as well as before local merge landing.

### UX, docs, and integration package changes

- `packages/eforge/src/cli/index.ts` and `packages/eforge/src/cli/run-or-delegate.ts`
  - Expose branch-aware confirmation/landing-choice behavior.

- `packages/pi-eforge/skills/eforge-init/SKILL.md` and `eforge-plugin/skills/init/init.md`
  - Detect/confirm trunk branch and ask whether local trunk merge is allowed.
  - Pass the new config fields through init tooling.

- `packages/pi-eforge/skills/eforge-build/SKILL.md` and `eforge-plugin/skills/build/build.md`
  - Update build workflow guidance in sync.
  - Filter landing choices from configured trunk policy.

- `packages/pi-eforge/extensions/eforge/index.ts`, `packages/eforge/src/cli/mcp-proxy.ts`, and `eforge_init` tool schema/client wiring
  - Update tool descriptions and request shapes to persist trunk policy.

- `eforge-plugin/.claude-plugin/plugin.json`
  - Bump version if plugin files change.

- `docs/config.md`, `web/content/docs/configuration.md`, `web/content/docs/concepts.md`, reference docs/schemas
  - Document:
    - new queue/provenance split
    - branch-aware landing semantics
    - explicit solo-dev trunk-local-merge opt-in

### Tests to add or update

- Queue default and no-enqueue-commit tests.
- Runtime queue state transition tests for pending/waiting/failed/skipped/recovery paths under `.eforge/queue`.
- PRD artifact commit+cleanup tests.
- Landing policy tests for:
  - configured trunk detection
  - default trunk rejection
  - trunk PR
  - opt-in trunk local merge
  - non-trunk local merge
  - non-trunk PR-after-local-merge
- CLI/skill/docs parity and generated docs drift checks as applicable.

### Assumptions and validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| Enqueue currently commits PRD queue files to the current branch. | Verified `packages/engine/src/eforge.ts` calls `commitEnqueuedPrd(...)` after `enqueuePrd(...)`; `packages/engine/src/prd-queue.ts` stages and commits the file path. | high | low | Add an integration test that enqueues in a temp git repo and checks history/status. | high — this is the core reason for separating runtime queue state from PRD provenance. |
| `.eforge/queue` is the right default for runtime queue state. | `.gitignore` already ignores `.eforge/`; project instructions identify `.eforge/` as daemon runtime/developer-facing state. | high | low | Config/default tests plus monitor/scheduler queue-load tests. | medium — wrong path could break queue visibility or migration expectations. |
| PRD artifacts should exist in history but not final trees. | User explicitly requested temporary PRDs; `cleanupPlanFiles(...)` already supports removing a PRD file when provided. | high | low | Build integration test: artifact commit exists in history, final tree omits artifact. | high — wrong behavior either loses provenance or clutters PRs/repos. |
| Cleanup currently does not run for `issue-pr`. | Verified `packages/engine/src/landing.ts` cleanup is inside `merge-to-base-branch`; `issue-pr` only calls `worktreeManager.issuePr(...)`. | high | low | Landing-action tests with cleanup events and final tree assertions. | high — PR workflow would otherwise retain temporary artifacts. |
| Trunk should be captured in config during init rather than only inferred at build time. | User identified that downstream UX should filter options consistently; current init flow already captures other build defaults like `onSuccess`. | high | low | Init skill/tool tests for `origin/HEAD` detection, user override, config persistence, and runtime use of configured trunk. | high — without persisted trunk policy, build-time inference may be surprising and option filtering inconsistent. |
| Non-trunk `issue-pr` should merge locally first, then PR from the user's feature branch to trunk. | User clarified this desired mental model. | high | medium | Git integration test with stubbed `gh` and/or local bare remote verifying merge, push branch, and PR args. | high — this deliberately changes current non-trunk PR semantics. |
| Engine-level trunk local-merge policy is required and should be initialized interactively. | Skills/CLI can be bypassed by direct API/tool calls; user identified both team-protected and solo-unprotected trunk workflows. | high | low | Engine/landing tests for trunk local merge rejected by default and allowed only when explicit opt-in config is enabled; init tests for protected-vs-unprotected persistence. | high — otherwise accidental direct trunk merges remain possible, solo-dev workflow remains unsupported, or UX cannot filter options correctly. |
| Full migration for historical tracked `eforge/queue` files can be limited. | User asked to correct model; not all legacy cleanup needs to be solved in this plan. | medium | medium | Search docs/tests for assumptions; include compatibility notes for configured queue paths. | medium — existing projects with tracked queue files may need clear docs. |
| No explicit target/base option or `persistBuildPrds` is needed now. | User explicitly deferred both; solo-dev need is addressed by a narrow trunk-local-merge opt-in rather than target selection or PRD persistence. | high | low | Keep implementation and docs scoped; list future extension only if necessary. | low/medium — future configurability can be added without blocking this model. |

### Profile signal

Recommended profile: **excursion**.

Rationale: this is a cross-cutting architecture change touching engine queue semantics, landing behavior, daemon/monitor queue paths, CLI/skill UX, docs, and tests. However, it is still a cohesive workflow refactor with clear sequential dependencies. A single planner should be able to enumerate the required plan slices without delegated module planning, so Expedition is not necessary unless implementation reveals deeper queue/monitor coupling than expected.

## Scope

### In scope

#### Branch-aware landing workflows

- Add project config for branch policy:
  - `build.trunkBranch` or equivalent is detected from `origin/HEAD`, falls back to `main`, and is confirmed during `/eforge:init`.
  - `build.allowLocalMergeToTrunk` or equivalent captures whether trunk is protected/team-safe, `false` by default, or solo/unprotected local-merge allowed, `true`.
- At runtime, use configured trunk branch when present.
- Fall back to detection for older configs.

##### WF1 — user starts from trunk with the default protected/team policy

- `/eforge:build`/CLI warns that the build will produce a PR because local merge to trunk is not allowed by default.
- User can confirm, cancel, or create/switch to a local feature branch for a local-merge workflow where the integration supports that interaction.
- Successful `issue-pr` creates a PR from the eforge work branch, `eforge/{planSetName}`, to trunk.
- `merge-to-base-branch` is rejected by engine-level policy when the captured base branch is trunk and trunk-local-merge opt-in is not enabled.

##### WF2 — user starts from a non-trunk local feature branch

- User is asked to choose `merge-to-base-branch` or `issue-pr`.
- `merge-to-base-branch` merges the eforge work branch into the local feature branch and stops.
- `issue-pr` first merges the eforge work branch into the local feature branch, then pushes that feature branch and opens a PR from it to trunk.

##### WF3 — solo developer starts from unprotected trunk with explicit opt-in config

- `/eforge:init` captures the trunk branch and whether local trunk merge is allowed.
- A config flag, for example `build.allowLocalMergeToTrunk: true`, allows `merge-to-base-branch` on trunk.
- With `build.onSuccess: merge-to-base-branch`, eforge can land directly on local trunk after validation.
- The developer remains responsible for pushing local trunk to `origin` when desired.
- This opt-in should be documented as a solo/unprotected-branch workflow, not the team-safe default.

#### Queue/provenance split

- Move runtime queue state to `.eforge/queue` by default, using the existing gitignored `.eforge/` runtime area.
- Stop committing runtime queue files during enqueue.
- Preserve PRD provenance by materializing the formatted PRD onto the eforge work branch at `eforge/prds/{prdId}.md` during build.
- Clean up the committed PRD artifact and plan files before landing for both PR and local-merge workflows, so artifacts remain in history but not in the final tree/PR diff.

#### Integration surface

- Update engine queue, scheduler, recovery, monitor, daemon, CLI, Pi extension, Claude plugin, docs, generated schemas/reference artifacts, and tests as needed.
- Keep `build.onSuccess` as a default preference.
- Branch-safety rules override unsafe defaults unless the project explicitly opts into local trunk merge.
- Downstream UX should filter landing options using the configured trunk branch and trunk-local-merge policy.

### Out of scope

- User-facing explicit landing target/base branch selection.
- `persistBuildPrds` or configurable PRD artifact persistence.
- Removing PRD artifacts from history entirely.
- Full migration tooling for historical tracked `eforge/queue` files beyond a safe compatibility/deprecation path.
- Changing unrelated plan artifact generation, validation, model tracking, or review behavior.

## Acceptance Criteria

### Queue/runtime state

- Default queue path is `.eforge/queue`.
- Enqueueing from trunk or a feature branch writes runtime queue state but creates no git commit on the user's current branch.
- Queue load/scheduler/monitor/recovery flows continue to support:
  - pending
  - waiting
  - failed
  - skipped
  - priority
  - dependencies
  - `profile`
  - `onSuccess` metadata
  - all from `.eforge/queue`
- Existing configured `prdQueue.dir` values continue to work.
- Docs recommend `.eforge/queue` for runtime state.

### PRD provenance and cleanup

- A successful build commits the formatted PRD artifact to `eforge/prds/{prdId}.md` on the eforge work branch.
- The committed PRD artifact is removed by cleanup before final landing.
- Plan files and PRD artifacts appear in relevant branch history but are absent from the final tree/PR diff after cleanup.
- Cleanup runs for PR landing workflows as well as local-merge workflows.

### Branch-aware landing

- `/eforge:init` detects trunk from `origin/HEAD`, falls back to `main`, asks the user to confirm/correct it, and persists the result in config.
- `/eforge:init` asks whether the configured trunk is protected/team-safe or whether local trunk merge is allowed for solo/unprotected projects, and persists that policy.
- Runtime branch classification uses configured trunk branch when present, with detection fallback for older/minimal configs.

#### On trunk with default config

- `issue-pr` opens a PR from `eforge/{planSetName}` to trunk.
- `merge-to-base-branch` is rejected by the engine with a clear message and no merge into trunk.
- Build UX communicates the PR-only result and allows confirm/cancel/create-or-switch-branch where feasible.

#### On trunk with explicit solo-dev opt-in config

- `merge-to-base-branch` merges `eforge/{planSetName}` into local trunk and does not push automatically.
- PRD/plan artifacts are still committed temporarily and cleaned before landing, so they exist in history but not the final tree.
- Docs clearly frame this as appropriate for unprotected solo/early-stage projects.

#### On non-trunk

- User/build UX asks for PR vs local merge when no explicit safe choice has already been made.
- `merge-to-base-branch` merges `eforge/{planSetName}` into the local feature branch and does not create a PR.
- `issue-pr` merges `eforge/{planSetName}` into the local feature branch, pushes that feature branch, and opens a PR from it to trunk.

### Integration and docs

- Pi and Claude Code init skills capture trunk branch and trunk-local-merge policy consistently.
- Pi and Claude Code build skills describe and apply the branch-aware workflow consistently.
- Claude plugin version is bumped if plugin files change.
- Config/docs/concepts/reference material explain:
  - `.eforge/queue`
  - temporary `eforge/prds/` artifacts
  - configured trunk branch
  - branch-aware PR/local-merge behavior
  - default no-local-merge-to-trunk safety
  - solo-dev opt-in

### Tests

- Tests cover init trunk detection/persistence.
- Tests cover queue default/no enqueue commit.
- Tests cover queue state transitions.
- Tests cover PRD artifact commit+cleanup.
- Tests cover default trunk local-merge rejection.
- Tests cover opt-in trunk local merge.
- Tests cover trunk PR.
- Tests cover non-trunk local merge.
- Tests cover non-trunk PR-after-local-merge.
- Tests cover docs/schema drift where applicable.
