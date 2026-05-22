---
title: Parameterize eforge On-Success Landing Actions
created: 2026-05-21
profile: claude-sdk-4-7
---

# Parameterize eforge On-Success Landing Actions

## Problem / Motivation

Metadata:
- Created: 2026-05-21
- Profile: `claude-sdk-4-7`

Current eforge builds always finalize successful work by merging the generated feature branch back into the captured base branch. This local merge model is inconvenient and potentially unsafe when multiple top-level eforge builds run in parallel against the same project/base branch, because finalization mutates `repoRoot` and requires a clean checkout on the exact base branch.

Evidence:
- `packages/engine/src/orchestrator/phases.ts` finalizes by calling `ctx.worktreeManager.mergeToBase(...)` and only marks the run completed when `ctx.featureBranchMerged` is true.
- `packages/engine/src/worktree-ops.ts` `mergeFeatureBranchToBase()` requires `repoRoot` to be on the expected base branch and clean before it merges.
- Init/build surfaces in `packages/pi-eforge` and `eforge-plugin` do not currently collect or pass any landing policy.
- Current config schema in `packages/engine/src/config.ts` has `build.postMergeCommands`, `postMergeCommandTimeoutMs`, `maxValidationRetries`, and cleanup settings, but no landing/on-success policy.
- Current finalization always attempts a final merge when all plans are merged and validation passes. Success is currently tied to `ctx.featureBranchMerged`; if the feature branch is not merged to base, final status becomes failed.
- `packages/pi-eforge/skills/eforge-init/SKILL.md` and `eforge-plugin/skills/init/init.md` currently prompt for runtime profile and post-merge validation commands, but not a landing policy.
- `packages/pi-eforge/skills/eforge-build/SKILL.md` and `eforge-plugin/skills/build/build.md` enqueue via `eforge_build` with only `source` today; per-build landing override requires tool/API/skill surface changes.

Users need a configurable on-success landing action so successful builds can open a PR or leave a ready branch, while preserving the existing direct-merge workflow for explicit local use.

## Goal

Add a project-level and per-build configurable on-success landing policy for eforge builds with supported actions: `merge-to-base-branch`, `issue-pr`, and `leave-branch`.

Successful builds should be considered complete when validation passes and the configured landing action completes, rather than only when the feature branch is merged into the base branch.

## Approach

### Recommended Profile

Recommended profile: **excursion**.

Rationale:
- This is a cohesive feature spanning config, engine finalization, queue/API plumbing, and the two consumer integrations.
- It is cross-package, but a single planner can enumerate the required changes and dependencies without delegated module planning.
- It is not an errand because it changes wire/API/user-facing behavior and requires tests across multiple layers.
- It is not an expedition because the work does not require independently planned subsystem modules; it should be implemented as a coordinated multi-plan excursion.

### Project Guidance and Architectural Constraints

- `AGENTS.md` says consumer-facing changes must keep `eforge-plugin/` and `packages/pi-eforge/` in sync.
- Daemon HTTP client and route contracts live in `@eforge-build/client`.
- Daemon/engine should own orchestration rather than wrapper apps.
- `docs/roadmap.md` emphasizes daemon orchestration, integration maturity, and extensibility.
- This work aligns with daemon-owned lifecycle controls rather than Pi/Claude-only UX.
- `packages/pi-eforge/extensions/eforge/index.ts` owns the Pi `eforge_init` and `eforge_build` tools plus native `/eforge:build` command. It can offer richer interactive selectors, but daemon/engine enforcement must not depend on Pi UI.
- `packages/eforge/src/cli/mcp-proxy.ts` mirrors plugin/MCP tool schemas and init persistence logic, so Claude plugin parity must include schema and skill updates.

### Design Decisions

1. **Config key**

   Use `build.onSuccess`.

   Supported values:
   - `issue-pr`
   - `merge-to-base-branch`
   - `leave-branch`

   Rationale:
   - Existing related team-wide build lifecycle settings already live under `build`.
   - This is easier for init/config docs to explain next to `postMergeCommands`.

2. **Defaults and guidance**

   - Existing configs with missing `build.onSuccess` must resolve to `merge-to-base-branch` for backward compatibility.
   - New `/eforge:init` should write `build.onSuccess: issue-pr` by default unless the user chooses otherwise.
   - `issue-pr` guidance:
     - Best for established/team projects and parallel top-level eforge builds.
     - Requires `gh` CLI.
   - `merge-to-base-branch` guidance:
     - Best for solo/local projects where PR overhead is undesirable.
     - Retains current behavior but should be explicit.
   - `leave-branch` guidance:
     - Best when the user wants manual control or uses a non-GitHub hosting/review workflow.

3. **`issue-pr` implementation**

   - `issue-pr` should use `gh pr create` rather than a direct GitHub API integration.
   - `issue-pr` should push automatically before creating/opening the PR.
   - Proposed command sequence:
     - Ensure merge worktree is on `featureBranch`.
     - Push `featureBranch` to `origin`.
     - Run `gh pr create --base <baseBranch> --head <featureBranch> --fill` or equivalent from a repo context.
   - If a PR already exists for the branch, implementation should avoid failing unnecessarily.
   - Acceptable behavior is to report the existing PR URL if `gh pr view` succeeds.
   - If `gh` CLI is not installed or unavailable during `/eforge:init`, warn that `issue-pr` requires `gh`; do not disallow the option outright.

4. **Event strategy**

   Introduce general landing/completion events while preserving compatibility for current merge events.

   Recommended new events:
   - `landing:start`
   - `landing:complete`
   - `landing:skipped`

   Event fields:
   - `action`
   - `featureBranch`
   - `baseBranch`
   - Action-specific result fields:
     - `commitSha` for merge
     - `prUrl` for PR

   Compatibility:
   - Continue emitting `merge:finalize:*` for the `merge-to-base-branch` action only.
   - Existing monitor/client code expecting merge events will keep working for direct-merge builds.
   - For `issue-pr` and `leave-branch`, use `landing:*` events rather than overloading `merge:finalize:*`, because no merge is happening and the old names would mislead users and downstream consumers.
   - This requires client schema/monitor updates, but produces a cleaner long-term wire protocol.

5. **Completion status**

   - A successful `issue-pr` or `leave-branch` action should mark the build completed even though the feature branch was not merged into the base branch.
   - Existing internal state such as `featureBranchMerged` should become a more general completion/landing success indicator, or final status should derive from the landing action result.

6. **Engine/daemon ownership**

   - Pi and Claude surfaces collect and display the choice.
   - Engine/daemon enforce it because queued/autobuild runs execute outside the interactive host.

### Code Impact

#### Engine/config

- `packages/engine/src/config.ts`
  - Add `build.onSuccess` schema.
  - Add default.
  - Add resolved config type.
  - Add config merging behavior.
  - Add docs/example display support.
  - Evidence: current `build` config schema/defaults are defined here.

- `packages/engine/src/events.ts`
  - Extend `BuildOptions` / `EnqueueOptions` if per-build/per-enqueue override is represented at engine option level.

- `packages/engine/src/orchestrator.ts` and `packages/engine/src/orchestrator/phases.ts`
  - Pass configured landing action into phase context.
  - Replace merge-only final status logic with landing action handling.

- `packages/engine/src/worktree-manager.ts` and/or `packages/engine/src/worktree-ops.ts`
  - Add helpers for `issue-pr`:
    - `git push`
    - `gh pr create`
    - `gh pr view`
  - Possibly add helper for `leave-branch`.
  - Keep direct merge helper intact.

- `packages/engine/src/eforge.ts`
  - Resolve effective `build.onSuccess` from config/options.
  - Pass it to the orchestrator for both direct build and queued PRD execution.

#### Client/API/wire protocol

- `packages/client/src/events.schemas.ts`
  - Add `landing:*` event schemas and tests.
  - Optionally add shared `BuildOnSuccess`/landing action type if client owns request shapes.

- `packages/client/src/api/queue.ts` and related route/request types
  - Carry optional enqueue/build override if the daemon API accepts it.

- `packages/client/src/api-version.ts`
  - Bump `DAEMON_API_VERSION` if request/response/event surface changes are breaking or require daemon/client lockstep.

#### Daemon/monitor/queue

- `packages/monitor/src/server.ts` or route handlers using `API_ROUTES.enqueue`
  - Accept and validate the optional on-success override in enqueue requests.

- Queue metadata/frontmatter handling:
  - `packages/engine/src/prd-queue.ts`
  - Enqueue/formatter path
  - Persist the selected per-PRD override so child `queue exec` processes can enforce it.
  - Current PRD frontmatter supports fields such as `profile`; it likely needs an additional landing field or queue-side metadata.

- `packages/engine/src/queue/scheduler.ts`
  - Preserve/pass the override when spawning child processes if stored outside plain PRD frontmatter.

- `packages/monitor-ui/`
  - Update reducers/rendering to display `landing:*` events and PR URL/branch-ready result.

#### Consumer integrations

- `packages/pi-eforge/extensions/eforge/index.ts`
  - Update `eforge_init` and `eforge_build` tool schemas.
  - Update init persistence logic.
  - Update native `/eforge:build` argument/selector handling.
  - Update status/rendering if landing results are surfaced.

- `packages/pi-eforge/skills/eforge-init/SKILL.md`
  - Add landing-policy prompts and build override docs.

- `packages/pi-eforge/skills/eforge-build/SKILL.md`
  - Add landing-policy prompts and build override docs.

- `eforge-plugin/skills/init/init.md`
  - Add the same behavior for Claude plugin parity.

- `eforge-plugin/skills/build/build.md`
  - Add the same behavior for Claude plugin parity.

- `packages/eforge/src/cli/mcp-proxy.ts`
  - Mirror MCP tool schema/persistence changes for `eforge_init` and `eforge_build`.

- `eforge-plugin/.claude-plugin/plugin.json`
  - Bump plugin version if plugin files change.

#### Tests

- Config parse/default/merge tests for `build.onSuccess`.
- Engine/orchestrator finalization tests for all three actions.
- Event schema wire parity tests for new landing events.
- Queue/enqueue persistence tests for per-build override.
- Pi/plugin skill parity and possibly snapshot/docs drift tests.

### Architecture Impact

- This changes the build lifecycle boundary from “successful build means merged into base” to “successful build means validation passed and configured landing action completed.”
- The engine should represent this explicitly rather than coupling success to `featureBranchMerged`.
- The daemon remains the orchestration authority.
- Interactive integrations (`packages/pi-eforge`, `eforge-plugin`) only gather preferences and send/persist them; they must not implement landing behavior themselves.
- Wire protocol gains a more general landing concept.
- Recommendation is to introduce `landing:*` events for all landing actions and preserve `merge:finalize:*` only for direct-merge compatibility.
- Queue/build request shape needs to carry a durable override because queued PRDs run in child processes after enqueue.
- The selected action cannot live only in an interactive tool call’s local memory.
- `issue-pr` introduces an external tool dependency, `gh`, into successful finalization.
- Init can warn about missing `gh`, but runtime must still fail clearly if the selected action cannot run.

### Documentation Impact

Update documentation and user-facing text in:

- `packages/pi-eforge/skills/eforge-init/SKILL.md`
  - Add landing-policy selection after `postMergeCommands`.
  - Add default/guidance text.
  - Add `gh` warning behavior.

- `eforge-plugin/skills/init/init.md`
  - Same selection and guidance for plugin parity.

- `packages/pi-eforge/skills/eforge-build/SKILL.md`
  - Document optional per-build on-success override.
  - Explain how it interacts with project default.

- `eforge-plugin/skills/build/build.md`
  - Same behavior for plugin parity.

- `packages/pi-eforge/skills/eforge-config/SKILL.md`
  - Document `build.onSuccess` as a build setting.

- `eforge-plugin/skills/config/config.md`
  - Document `build.onSuccess` as a build setting.

- `README.md` and/or public docs if they describe build finalization as always merging to base.

- Generated reference docs may need regeneration if tool schemas, config reference, or event schema reference docs are generated from code.

- Monitor UI text should stop implying every successful build is merged when `issue-pr` or `leave-branch` is used.

### Risks and Edge Cases

- Event compatibility:
  - Replacing `merge:finalize:*` outright could break monitor/client consumers.
  - Mitigation: add `landing:*` while keeping merge events for direct-merge action.

- Queue durability:
  - A per-build override can be lost if it is not persisted in PRD frontmatter or daemon-owned metadata before child process execution.
  - Mitigation: persist override as part of enqueue/queue item representation.

- Branch cleanup:
  - Current orchestrator deletes `featureBranch` after successful direct merge.
  - For `issue-pr` and `leave-branch`, the branch must remain available.
  - Cleanup behavior must become action-specific.

- Worktree cleanup versus branch preservation:
  - Removing worktrees is fine.
  - Deleting feature branches is not fine for PR/manual actions.

- `gh` failure modes:
  - Missing CLI.
  - Not authenticated.
  - No GitHub remote.
  - Existing PR.
  - Fork/remotes named other than `origin`.
  - Network errors.
  - Runtime errors should clearly explain recovery steps.

- Direct merge concurrency:
  - `merge-to-base-branch` remains unsafe if multiple builds target the same base without serialization.
  - If not solved in this slice, documentation should say it is best for solo/local use.
  - A later improvement could add per-base landing locks.

- Init UX drift:
  - Pi extension has richer UI and plugin uses conversational docs.
  - Both must expose the same capabilities.

- Status semantics:
  - Monitor/reporting must distinguish “completed and PR opened” from “completed and merged” so users do not misinterpret build state.

### Assumptions and Validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| `issue-pr` should use `gh` CLI rather than direct GitHub API. | User explicitly said we can assume `gh` is installed and init should warn if not. | high | low | Check `gh --version` / `gh auth status` in init/runtime. | If wrong, implementation would need a different PR backend/API abstraction. |
| `build.onSuccess` is the right config key. | User explicitly chose `build.onSuccess`; config evidence shows build lifecycle settings already under `build`. | high | low | Validate config schema/docs after implementation. | Low; naming can be migrated before release if needed. |
| Existing configs without `build.onSuccess` should resolve to `merge-to-base-branch`. | User explicitly confirmed; this preserves pre-feature behavior for upgrades. | high | low | Add config resolution tests for missing value. | High; changing existing projects to PR creation would be surprising and could push/open PRs unexpectedly. |
| New init should default to `issue-pr`. | User explicitly approved defaulting to `issue-pr`; guidance differentiates team vs solo workflows. | high | low | Confirm final init copy in both integrations. | Medium; wrong default could surprise solo users, mitigated by guidance and selector. |
| For `issue-pr`, eforge should push the feature branch automatically. | User explicitly confirmed. | high | low | Test command sequence with `git push` and `gh pr create`. | High; without push, PR creation fails or requires manual work. |
| Existing event consumers should not lose direct-merge events. | Evidence from client schema/monitor tests shows `merge:finalize:*` is part of the wire protocol. | medium | medium | Inspect monitor reducers and event registry during implementation; add compatibility tests. | High; breaking monitor/client projections would degrade UX. |
| `landing:*` events are preferable for non-merge actions. | Design reasoning: `merge:finalize:*` would be misleading for PR/manual branch outcomes. | medium | medium | Validate against monitor/UI implementation complexity before coding. | Medium; if too invasive, fallback is optional `action` fields on existing events. |
| Queue override can be persisted in PRD frontmatter or equivalent daemon metadata. | Current PRD frontmatter already stores fields like `profile`; exact best location not fully validated. | medium | medium | Inspect enqueue formatter/session-plan conversion and queue exec path during implementation. | High; losing overrides would produce wrong landing behavior. |
| `origin` is an acceptable default remote for pushing PR branches. | Common git/GitHub convention; not yet validated for all projects. | medium | low | Use `git remote`/`gh repo view` at runtime; emit clear errors. | Medium; non-standard remotes need a clear failure or future config. |
| Direct merge concurrency can be documented rather than fully serialized in this slice. | Scope discussion focuses on adding landing actions; `issue-pr` reduces need for local merge concurrency. | medium | medium | Decide during implementation whether per-base landing locks are cheap enough to include. | Medium/high if users choose direct merge with parallel builds. |

## Scope

### In Scope

- Add a project-level default on-success landing policy with supported actions:
  - `merge-to-base-branch`
  - `issue-pr`
  - `leave-branch`

- Make engine finalization execute the selected action after all plans merge and validation/PRD validation pass.

- Preserve current behavior via `merge-to-base-branch` for users who explicitly want local direct merge.

- Add per-build/per-enqueue override plumbing where appropriate so `/eforge:build` can override the project default.

- Update config/schema/client/API/daemon surfaces so queued/autobuild runs enforce the policy outside interactive Pi/Claude sessions.

- Update `packages/pi-eforge` and `eforge-plugin` init/build skills/tools in parity.

- In `/eforge:init`, if user selects `issue-pr`, warn when `gh` is missing/unavailable; do not forbid choosing `issue-pr` because user expects `gh` to be generally available.

- Pi may provide richer selector UI for landing policy where the native extension supports it.

### Out of Scope

- Hosted GitHub API integration that bypasses `gh`.
- Full auto-merge/branch-protection orchestration beyond creating/opening a PR.
- Multi-project overseer functionality.
- A generalized arbitrary command hook system for completion actions.
- Changing per-plan internal parallelism/merge semantics except as needed to keep final landing safe.

## Acceptance Criteria

### 1. Config/defaults

- `eforge/config.yaml` accepts `build.onSuccess` with exactly:
  - `issue-pr`
  - `merge-to-base-branch`
  - `leave-branch`

- Missing `build.onSuccess` in existing configs resolves to `merge-to-base-branch` to preserve current behavior.

- New `/eforge:init` writes `build.onSuccess: issue-pr` by default unless the user chooses otherwise.

- `eforge_config { action: "validate" }` reports invalid landing actions clearly.

### 2. Engine finalization

- With `build.onSuccess: merge-to-base-branch`, current direct-merge behavior is preserved:
  - Successful validated builds merge `eforge/<plan-set>` into the captured base branch.
  - The merge commit is reported.

- With `build.onSuccess: issue-pr`:
  - Successful validated builds push the feature branch.
  - A PR is created or reported against the captured base branch using `gh`.
  - The build is marked completed.
  - The PR URL is emitted/stored in events.

- With `build.onSuccess: leave-branch`:
  - Successful validated builds leave the feature branch available.
  - They do not merge or create a PR.
  - The branch name is emitted.
  - The build is marked completed.

- Failed validation/PRD validation does not run the landing action.

- Branch deletion/cleanup is action-safe:
  - Branches needed for PR/manual review are not deleted.

### 3. API/queue overrides

- `/eforge:build` / `eforge_build` can optionally override the project default on a per-build basis.

- The override is persisted across queued/autobuild child execution.

- The override is visible enough for debugging/status.

- If no override is provided, the resolved project config default is used.

### 4. User-facing init/build UX

- `/eforge:init` in both Pi and Claude plugin asks for an on-success landing action and includes guidance:

  - `issue-pr`
    - Recommended for established/team projects and parallel top-level builds.
    - Requires `gh`.

  - `merge-to-base-branch`
    - Recommended for solo/local projects where PR overhead is undesirable.

  - `leave-branch`
    - Manual review/landing or non-GitHub workflows.

- When `issue-pr` is selected and `gh` appears unavailable during init, the user gets a warning but can continue.

- Pi surfaces may use a selector/overlay.

- Claude plugin parity can be conversational.

### 5. Observability and docs

- Monitor/status output distinguishes:
  - Merged outcomes.
  - PR-created outcomes.
  - Branch-left outcomes.

- Client event schemas and wire parity tests include the landing events/results.

- Relevant Pi/plugin/config/build docs are updated in sync.

### 6. Tests/checks

- Unit/integration tests cover all three landing actions and invalid config.

- Existing direct-merge behavior tests continue to pass.

- `pnpm type-check` and relevant tests pass.
