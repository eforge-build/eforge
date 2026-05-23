---
title: Complete First-Class Stacked PR and Git-Spice Support
created: 2026-05-23
profile: gpt-claude-combo
---

# Complete First-Class Stacked PR and Git-Spice Support

## Problem / Motivation

This plan is a follow-up to `.eforge/session-plans/2026-05-23-git-spice-stacking-support.md`, which was submitted and partially built through PR #19 (`ef57165a`). Evidence from `git show --stat ef57165a` and source inspection shows the merged work established a stack foundation rather than the full original feature.

### Landed foundation evidence

- `packages/engine/src/config.ts` and `eforge/config.yaml` now understand `stacking` and `landing` config. The checked-in project config currently has `stacking.enabled: false`, `stacking.provider: git-spice`, and `landing.action: pr`.
- `packages/engine/src/stacking/` now contains stack types, runtime state helpers, artifact recording, base resolution, and a git-spice adapter.
- `packages/engine/src/prd-queue.ts` supports `stack_id`, `stack_parent`, `stack_provider`, and `landing` PRD frontmatter.
- `packages/engine/src/queue/scheduler.ts` and `packages/engine/src/eforge.ts` include artifact-aware dependency checks, single-dependency `stack_parent` inference, multi-dependency ambiguity failure, and parent-artifact base resolution when `stacking.enabled` is true.
- `packages/client/src/events.schemas.ts` defines stack event schemas: `stack:layer:recorded`, `stack:provider:command`, and `stack:landing:update`.
- Tests landed for stack config, artifact-aware scheduling, stack base resolution, artifact recording, git-spice command construction, stack events, and state helpers.

### Remaining gaps / contradictions

- `packages/engine/src/landing.ts` still implements the old non-trunk `issue-pr` aggregation workflow: `feature-pr-after-local-merge`, `mergeIntoBaseFirst: true`, then PR from base branch to trunk. This directly contradicts the original design decision that stacked child PRs should be `artifactBranch -> parentArtifactBranch` without local aggregation.
- `packages/engine/src/worktree-manager.ts` still exposes `issuePr({ mergeIntoBaseFirst, trunkBranch })` behavior and tests in `test/landing-actions.test.ts` still expect aggregation.
- `packages/engine/src/stacking/provider.ts` and `git-spice.ts` exist, but `rg` shows provider operations (`createProvider`, `trackBranch`, `submitBranch`, `submitStack`, `syncRepo`, `restack*`) are not wired into runtime landing/build paths outside tests.
- Missing/unusable git-spice therefore does not fail early when stacking is enabled.
- Stack state currently records `status: built` before landing via `recordSuccessfulBuildArtifact()`, but no runtime path appears to emit or persist `stack:landing:update`, PR URL, or final landed/failed status.
- Monitor/UI visibility is schema-only/minimal: `packages/monitor-ui/src/lib/reducer/index.ts` lists stack events as ignored/exhaustiveness entries, and there is no observed daemon/API projection for stack layers.
- Consumer and documentation surfaces remain legacy. `packages/client/src/routes.ts`, CLI/MCP/Pi/Claude skill docs, `docs/architecture.md`, and public docs still emphasize `onSuccess` and the old non-trunk aggregation behavior. The Pi build skill explicitly says feature-branch `issue-pr` merges into the feature branch, then opens a PR to trunk.
- `docs/roadmap.md` does not list stacked PR completion, despite this being a future-facing Integration & Maturity / Daemon orchestration item.

### Classification

Architecture / deep. This is cross-cutting across engine landing semantics, stack provider lifecycle, runtime persistence, daemon/API/UI projection, integration packages, docs, and tests. Confidence: high.

### Early assumption

The user’s comment about `eforge/config.yaml` means the repo should dogfood stacking by enabling `stacking.enabled: true` only after the remaining runtime behavior is actually complete and validated. Default config for new projects should remain opt-in unless explicitly changed by acceptance criteria. Confidence: medium/high; low cost to adjust during implementation.

## Goal

Complete the remaining original stacked-PR/git-spice feature rather than adding another foundation-only slice. The desired outcome is direct branch-per-PR stacked publishing, with git-spice wired into runtime flow, durable stack landing state, daemon/API/UI visibility, updated consumer surfaces, documentation, and tests.

## Approach

### Current architecture state

The merged foundation already changed several contracts: config supports `stacking`/`landing`, queued PRDs can carry stack fields, stack state is stored in `.eforge/stacks/layers.json`, scheduler/base resolution can require artifacts, and client event schemas define stack events. The remaining work must connect these foundations into the actual build/landing lifecycle and consumer surfaces.

### Required architecture changes

1. **Landing semantics become direct artifact publication.**
   - `executeLandingAction()` should stop classifying non-trunk `issue-pr` as `feature-pr-after-local-merge`.
   - `WorktreeManager.issuePr()` should no longer merge into `baseBranch` before opening a PR to trunk.
   - PR creation should be consistently `head = feature/artifact branch`, `base = resolved base branch`.

2. **Stack provider lifecycle becomes part of the stacked runtime path.**
   - Add a stack lifecycle stage before expensive/mutating work when `stacking.enabled` is true: instantiate provider and call `requireAvailable()`.
   - After artifact branch exists and before/inside PR landing, track the branch with git-spice against `stackContext.baseBranch`.
   - For `landing.action: pr`, call git-spice submission primitives instead of/in addition to gh PR creation. The implementation should choose one source of truth for PR creation in stacked mode; v1 should prefer git-spice for stack topology/submit and use gh only for non-stacked legacy PRs unless git-spice cannot provide a URL.
   - Emit `stack:provider:command` events from actual provider calls, not only schemas/tests.

3. **Stack state becomes a real durable projection, not just pre-landing artifact record.**
   - Extend `StackLayer`/state helpers if needed to update `landingAction`, landing status, `prUrl`, and failure reason.
   - Emit and persist `stack:landing:update` around landing lifecycle.
   - Ensure crash/retry/reconciliation can reason from `.eforge/stacks/layers.json` plus git refs.

4. **Daemon/API/UI projection uses shared client-owned wire shapes.**
   - Add typed API/client helpers or extend existing status/queue/run responses to expose stack layers without local ad hoc shapes.
   - Monitor server should project stack events/state consistently with client types.
   - Monitor UI should render stack/layer metadata rather than ignoring stack events.

5. **Consumer surface vocabulary is reconciled.**
   - Existing `onSuccess` API may need to remain as a transitional alias, but user-facing docs/skills should prefer `landing.action` / `pr|merge|leave` and explain compatibility.
   - Pi extension and Claude plugin must stay in sync per `AGENTS.md`.

6. **Project config finalization is explicit.**
   - `DEFAULT_CONFIG.stacking.enabled` should remain `false` unless a deliberate product decision is made to require git-spice by default.
   - Checked-in `eforge/config.yaml` can enable stacking at the end for this repo if dogfooding is desired and git-spice availability expectations are documented.

### Design decisions

1. **Finish, do not restart.** Reuse the landed foundation (`stacking/*`, stack state, base resolver, queue validation, event schemas) and close gaps rather than replacing it wholesale.
2. **Direct PR publication replaces aggregation.** `issue-pr` must always open/update a PR from the build artifact branch to the resolved base branch. Non-trunk bases are not special aggregation targets; for stacks they are the parent artifact branch.
3. **Use git-spice as the stacked PR publisher.** In stacked mode, git-spice should be the authority for tracking branch relationships and submitting/updating PRs. Legacy gh PR creation remains for non-stacked `issue-pr` unless a later decision unifies all PR publication under git-spice.
4. **Fail early when stacking is enabled but provider is unavailable.** Call `requireAvailable()` before expensive planning/build mutation for queued stacked builds so users get actionable setup guidance (`git-spice` canonical command or `stacking.gitSpice.command`).
5. **Persist landing as an update to the same logical layer.** Artifact recording before landing remains useful, but landing completion must update the existing layer instead of creating separate disconnected metadata. Layer identity stays `prdId` + `stackId`, not commit SHA.
6. **Emit actual lifecycle events.** `stack:layer:recorded` should remain the artifact event. `stack:provider:command` should wrap real provider invocations. `stack:landing:update` should track started/complete/skipped/failed and include PR URL when known.
7. **Keep skipped-dependency semantics strict.** Do not reintroduce skipped-as-satisfied behavior. Artifact-aware dependents require a recorded artifact; skipped/failed upstreams block.
8. **Use compatibility aliases deliberately.** Keep legacy `onSuccess` request/frontmatter support only as a bridge, but update docs/skills/init/config surfaces toward `landing.action: pr|merge|leave`. Avoid adding new long-lived aliases.
9. **Dogfood only after correctness.** Enable `stacking.enabled: true` in checked-in `eforge/config.yaml` only after direct PR semantics, git-spice runtime calls, landing persistence, docs, and tests are complete. If not enabling it, leave an explicit comment/doc note explaining why it remains opt-in.
10. **No new providers.** Do not expose gh-stack, Graphite, native, or commit-per-PR providers as part of this completion plan.

### Code impact

#### Engine landing and worktree behavior

- `packages/engine/src/landing.ts`
  - Remove `feature-pr-after-local-merge` workflow or rename/redefine it so it no longer aggregates.
  - For `issue-pr`, always call PR publication with `baseBranch` and current `featureBranch` directly.
  - Add stack-aware landing update/provider hooks or delegate to a stack landing helper.
- `packages/engine/src/worktree-manager.ts`
  - Remove or deprecate `mergeIntoBaseFirst`/`trunkBranch` branch in `issuePr()`.
  - Ensure existing PR lookup checks the artifact/feature branch head, not the parent/base branch.
- `packages/engine/src/worktree-ops.ts`
  - Validate push/PR helpers support direct `head -> base` for non-trunk base branches.

#### Stack provider and state

- `packages/engine/src/stacking/git-spice.ts`
  - Add event-emitting wrapper or return command result metadata so runtime can emit `stack:provider:command`.
  - If needed, add output parsing for PR URLs or a follow-up `gh pr view`/git-spice status lookup strategy.
- `packages/engine/src/stacking/provider.ts`
  - May need a runtime-facing provider interface that reports command events/results instead of only `Promise<void>`.
- `packages/engine/src/stacking/state.ts`
  - Add helper(s) such as `updateStackLayerLanding()` / `markStackLayerFailed()` and maybe reconciliation helpers.
- `packages/engine/src/stacking/artifacts.ts`
  - Preserve artifact recording, but coordinate with landing updates and final status.
- Potential new file: `packages/engine/src/stacking/landing.ts`
  - Isolate git-spice track/submit/update logic from generic landing.

#### Build/orchestrator path

- `packages/engine/src/eforge.ts`
  - Fail early for provider availability when `stacking.enabled` and a queued stack context is involved.
  - Pass stack provider/config context into orchestrator/finalize.
- `packages/engine/src/orchestrator.ts` and `packages/engine/src/orchestrator/phases.ts`
  - Add stack provider lifecycle around `recordArtifact()`/`finalize()`.
  - Persist stack landing updates from landing result.

#### Scheduler/queue

- `packages/engine/src/queue/scheduler.ts`
  - Existing artifact-aware dispatch may be sufficient, but tests should verify provider-missing failures and multi-dependency explicit parent behavior through daemon-style scheduling.
- `packages/engine/src/prd-queue.ts`
  - May need serialization/docs polish for `landing` and stack fields.

#### Client/daemon/monitor

- `packages/client/src/events.schemas.ts`, `packages/client/src/event-registry.ts`, `packages/client/src/routes.ts`, `packages/client/src/types.ts`, API helpers under `packages/client/src/api/*`
  - Add/adjust stack response/request shapes and summaries.
- `packages/monitor/src/db.ts`, `packages/monitor/src/server.ts`, related projection helpers
  - Persist/project stack state/events without ad hoc wire shapes.
- `packages/monitor-ui/src/lib/reducer/*`, `packages/monitor-ui/src/components/*`
  - Render stack/layer details; stop treating stack events as ignored-only.

#### Integration packages

- `packages/eforge/src/cli/index.ts`, `packages/eforge/src/cli/mcp-proxy.ts`, `packages/eforge/src/cli/display.ts`, `packages/eforge/src/cli/run-or-delegate.ts`
  - Expose stack/landing options consistently; display stack events and warnings.
- `packages/pi-eforge/extensions/eforge/*`
  - Update tool schemas, landing gate text, build/playbook/init/config flows.
- `eforge-plugin/*`
  - Mirror user-facing capabilities and docs; bump `eforge-plugin/.claude-plugin/plugin.json` version if plugin files change.

#### Tests

- Update `test/landing-actions.test.ts` to reject aggregation and expect `--base parent --head eforge/child` for non-trunk PRs.
- Add runtime tests that provider calls happen in stacked mode and do not happen in non-stacked mode.
- Add landing state persistence tests for PR URL/status/failure.
- Add daemon/API/UI projection tests for stack layer visibility.
- Existing stack tests (`test/stack-*.test.ts`, `test/artifact-aware-scheduler.test.ts`, `test/git-spice-provider.test.ts`) should be extended rather than replaced.

### Documentation impact

Specific stale docs/surfaces found by search:

- `docs/architecture.md` — Branch-Aware Landing section still states feature-branch `issue-pr` merges the build branch into the feature branch, then opens a PR from feature branch to trunk. This must change to direct `head -> base` publication and explain stacked child bases.
- `docs/config.md` and `web/content/docs/configuration.md` — still centered on `build.onSuccess`; should document `landing.action`, compatibility with `onSuccess`, stack config, and git-spice setup.
- `web/content/reference/config.md`, `web/public/reference/config.md`, schema artifacts — generated reference currently lists `stacking`/`landing` without meaningful descriptions; run docs generation after schema descriptions improve.
- `web/content/docs/concepts.md`, `README.md` — should describe artifact branches and branch-per-PR stacks at a conceptual level.
- Add or update a focused stacking doc, likely `docs/stacking.md` and public web content equivalent, covering:
  - artifact branches;
  - dependency semantics;
  - `stack_id` / `stack_parent` frontmatter;
  - single-dependency inference and multi-dependency ambiguity;
  - canonical `git-spice` vs `gs` alias;
  - branch-per-PR model;
  - restack/sync expectations;
  - GitHub force-push stale-comment limitations.
- `packages/pi-eforge/skills/eforge-build/SKILL.md` and `eforge-plugin/skills/build/build.md` — explicitly stale: both say feature-branch `issue-pr` aggregates into the feature branch.
- `packages/pi-eforge/skills/eforge-config/SKILL.md` and `eforge-plugin/skills/config/config.md` — update config guidance from `build.onSuccess` to `landing.action` and stack settings.
- `packages/pi-eforge/skills/eforge-init/SKILL.md` and `eforge-plugin/skills/init/init.md` — update initialization prompts/outputs if init supports `landing.action` and stacking choices.
- Playbook skills and docs (`packages/pi-eforge/skills/eforge-playbook/SKILL.md`, `eforge-plugin/skills/playbook/playbook.md`, `web/content/docs/playbooks.md`) — update landing action vocabulary and behavior.
- `docs/roadmap.md` — add a future-focused roadmap item if any stack UI polish, CI optimization, or automated post-merge restack work remains after this completion slice.

### Risks

- **Semantic regression risk:** removing aggregation changes existing feature-branch `issue-pr` behavior. This is intended per original plan, but tests/docs must make the break explicit.
- **Double PR creation risk:** if stacked mode calls both git-spice submit and gh PR creation independently, it may create duplicate/conflicting PRs. Choose one authority for stacked PR submission.
- **PR URL discovery risk:** git-spice command output/metadata may not expose PR URL in a stable way. Need either robust parsing, a follow-up provider query, or a documented `prUrl` best-effort behavior.
- **State split-brain risk:** git refs, git-spice metadata, GitHub PR state, and `.eforge/stacks/layers.json` can diverge after crashes or manual commands. Add reconciliation/repair behavior or at least clear failure messages.
- **Provider availability risk:** enabling stacking in checked-in config can make local builds fail for contributors without git-spice. Mitigate with early actionable failure and explicit docs; decide whether this repo should dogfood by default.
- **Compatibility alias drift:** keeping `onSuccess` while introducing `landing.action` can confuse users and code paths. Make precedence explicit and add tests.
- **Consumer drift:** project policy requires Pi and Claude plugin sync; update both packages when changing tool schemas/skills.
- **Monitor/API shape drift:** `AGENTS.md` requires daemon wire shapes to be owned by `@eforge-build/client`; avoid monitor-local interfaces or duplicate route shapes.
- **CI/test realism risk:** git-spice integration tests may rely on external CLI/GitHub auth. Keep unit tests with stub command construction; mark real git-spice/GitHub flows as opt-in integration tests if needed.
- **Unsafe local merge risk:** `merge-to-base-branch` with a parent artifact base can still aggregate stack layers locally if misused. Add safety checks/tests so PR-style stacked workflows do not accidentally collapse layers.

### Assumptions and validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|---|---|---:|---:|---|---|
| The prior PR intentionally/accidentally delivered only foundation + artifact-aware base resolution, not full stacked PR support. | Read original session plan; inspected PR #19 commit/stat; searched runtime for stack/provider usage; found provider not wired and aggregation still present. | High | Low | None needed beyond implementation review. | Scope would be too broad/narrow if hidden follow-up exists, but current code evidence is strong. |
| Old non-trunk aggregation must be removed, not preserved behind another option. | Original plan explicitly says remove current non-trunk `issue-pr` aggregation; current docs/tests still encode it. | High | Low | Reconfirm only if user wants a separate aggregate action later. | Preserving it would conflict with stacked PR correctness. |
| git-spice should be the stacked-mode PR submitter/source of topology truth. | Original plan says git-spice only v1 provider; current adapter already implements track/submit/sync/restack commands. | High | Medium | During implementation, verify exact `git-spice branch submit`/`stack submit` behavior with local stub tests and optional real CLI smoke test. | Duplicate PRs or missing PR URLs if gh and git-spice both attempt publication. |
| PR URL can be recovered from git-spice or a follow-up provider query. | Not validated. Current adapter returns stdout but does not parse PR URLs; git-spice behavior may vary. | Medium | Medium | Inspect `git-spice branch submit --help` and output; if needed, query GitHub with `gh pr view --head <branch> --json url` after git-spice submit. | Stack state/UI may lack PR URL or need best-effort fallback. |
| This repo should enable `stacking.enabled: true` after completion for dogfooding. | User noted config was updated but not enabled and expected it might be enabled at the end. This is user-suggested but not a hard requirement. | Medium/High | Low | Before final config edit, decide whether requiring git-spice for this repo is acceptable; can leave default false globally. | Contributors/builds without git-spice may fail if enabled. |
| Existing artifact-aware dependency/base-resolution implementation is mostly reusable. | Tests exist and pass; code paths are already in `eforge.ts`, scheduler, base resolver, artifact recording. | Medium/High | Medium | Extend tests through full stacked landing/provider flow; verify no hidden race with queue/waiting paths. | May need deeper scheduler refactor if runtime semantics are inconsistent. |
| Monitor stack visibility can be added through events/API without a new DB table. | Current events are persisted generally, but stack state file is separate and current UI ignores stack events. | Medium | Medium | Inspect monitor DB/projector patterns during implementation; choose event projection vs explicit stack endpoint. | UI/API work may require more infrastructure than expected. |
| `landing.action` can coexist with legacy `onSuccess` during transition. | Config already maps between them and emits deprecation warnings for `build.onSuccess`. | High | Low | Add precedence tests and update docs. | Confusing precedence could cause wrong landing behavior. |

No low-confidence/high-impact assumption is accepted without a validation path. The highest-impact unresolved validation is git-spice PR URL/submission behavior; it should be resolved before marking the implementation complete, but it does not block planning.

### Profile signal

**Recommended profile:** Excursion.

**Rationale:** The remaining work is broad but cohesive: one planner can sequence the changes as landing semantics → git-spice runtime integration → stack state/API/UI projection → integrations/docs/tests. It does not require independently delegated subsystem planning in the Expedition sense. The implementation should likely be split into ordered plan files with dependencies, but the module boundaries and acceptance criteria are now concrete enough for a single Excursion planner to produce a high-quality orchestration.

**Escalate to Expedition only if:** implementation discovery shows monitor/API stack projection or git-spice PR URL recovery requires a substantially separate subsystem design that cannot be planned accurately in the main orchestration.

## Scope

### In scope

- Complete the remaining original stacked-PR/git-spice feature rather than adding another foundation-only slice.
- Remove the old non-trunk `issue-pr` aggregation workflow. `issue-pr` must publish the artifact/feature branch directly to the resolved base branch (`featureBranch -> baseBranch`) for both trunk and non-trunk bases.
- For stacked child builds, make PR targets the parent artifact branch/ref, producing branch-per-PR stacks such as `eforge/A -> main`, `eforge/B -> eforge/A`.
- Wire the existing git-spice provider into runtime flow when `stacking.enabled` is true:
  - fail early/actionably if the configured git-spice command is missing or unusable;
  - track artifact branches against resolved bases;
  - submit/update branch or stack PRs as appropriate;
  - emit provider command events for observability.
- Persist stack landing state after landing: landing start/complete/skipped/failed, PR URL, final status, timestamps, and artifact branch/SHA.
- Surface stack metadata through daemon/client contracts and monitor UI/API sufficiently to answer: stack id, PRD/layer, artifact branch/ref, parent PRD/branch, provider/command, landing state, and PR URL when available.
- Update CLI/MCP/Pi/Claude plugin surfaces consistently for stack options and new landing vocabulary where feasible, while preserving short transitional aliases only if needed for compatibility.
- Update docs and skills that currently describe old aggregation semantics.
- Add/update tests so old aggregation behavior is rejected and the new stacked PR behavior is enforced.
- After runtime and docs are complete, decide/finalize dogfooding in this repo: set `eforge/config.yaml` `stacking.enabled: true` if we accept requiring git-spice for this repo’s eforge builds; otherwise leave it false and document the reason.

### Out of scope

- Adding gh-stack, Graphite, native stack provider, jj/Sapling, or commit-per-PR providers.
- Implementing a native squash-aware restack engine; git-spice remains responsible for sync/restack in v1.
- Solving GitHub stale inline comments after force-push beyond documentation.
- Server/team stack coordination beyond project-local eforge runtime state plus git-spice metadata.
- Optional/ignorable dependency semantics for skipped upstream PRDs; skipped continues to block dependents by default in artifact-aware mode.

## Acceptance Criteria

- Non-trunk `issue-pr` no longer performs local aggregation into the base branch and no longer opens `base -> trunk`; it opens/updates PR `feature/artifact branch -> resolved base branch`.
- Tests explicitly fail if `mergeIntoBaseFirst`/`feature-pr-after-local-merge` aggregation behavior is used for `issue-pr`.
- Stacked child PRs target the parent artifact branch/ref, producing branch-per-PR topology.
- When `stacking.enabled` is true, missing/unusable git-spice fails before expensive/mutating stack work with guidance mentioning canonical `git-spice` and `stacking.gitSpice.command`.
- Runtime stacked builds call git-spice provider tracking/submission primitives with expected argv and cwd, and emit `stack:provider:command` events.
- Stack layer state is updated after landing with final status and PR URL when available; failures/skips are also persisted with enough diagnostic context.
- `stack:landing:update` is emitted by real runtime paths and validated by wire-event tests.
- Daemon/API/client expose stack layer metadata using shared `@eforge-build/client` types/routes; monitor server/UI do not define parallel ad hoc wire shapes.
- Monitor UI renders stack id, PRD/layer, artifact branch/ref, parent branch, provider, landing state, and PR URL when available.
- CLI/MCP/Pi/Claude plugin surfaces expose or document stack options and new `landing.action` vocabulary consistently; plugin version is bumped if plugin files change.
- Docs explain artifact branches, dependency semantics, stack config, git-spice command setup, branch-per-PR model, restack/sync expectations, stale GitHub comment limitation, and migration from old aggregation behavior.
- Generated docs/schema artifacts are regenerated and `pnpm docs:check` passes.
- `pnpm build`, `pnpm type-check`, and `pnpm test` pass.
- `eforge/config.yaml` final state is intentional: either `stacking.enabled: true` for repo dogfooding after all above pass, or left false with documented rationale. If enabled, tests/docs account for the git-spice requirement.
