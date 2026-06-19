---
id: plan-03-engine-recovery-guidance
name: Idempotent root-only Recovery Guidance patching for compiled plan
  artifacts and continue/resume integration.
branch: improve-recovery-failed-enqueue-and-queue-control-ux/engine-recovery-guidance
---

# Engine Recovery Guidance

## Architecture Reference

This module implements the architecture sections **Recovery guidance**, **Recovery guidance integration**, **Root-only recovery guidance**, **Idempotent plan artifact mutation**, and **Git helper discipline**.

Key constraints from architecture:
- Recovery sidecars are the durable source of failure evidence for guidance patching.
- Read-only recovery analysis and eligibility routes remain mutation-free; only explicit prepare/apply paths mutate compiled plan artifacts.
- Only root failed plan artifacts from `boundedEvidence.failingPlans` (fallback `boundedEvidence.failingPlan`) are patched.
- Downstream blocked/skipped dependents are not patched.
- A single canonical `## Recovery Guidance` section is added or replaced idempotently.
- Tracked plan artifact changes are committed through `forgeCommit()` with path-limited commit discipline.
- Continue-and-repair preparation and `EforgeEngine.resumeBuild()` require current recovery guidance before compiled plan markdown is read by builders.
- This module consumes the `client-contracts` module types, especially `RecoveryGuidancePrepareResponse`, `RecoveryGuidancePatchedPlan`, and `RecoveryGuidancePatchStatus`.

No file owned by the architecture shared-file registry is modified by this module.

## Scope

### In Scope
- Add engine helpers that read and validate failed-PRD recovery sidecars.
- Resolve `prdId`, `setName`, feature branch, base branch, queue directory, failed sidecar path, and plan output directory with path/ref safety checks.
- Derive root failed plan ids from sidecar multi-root evidence with fallback to the single failing plan.
- Patch only root failed compiled plan markdown artifacts with a canonical `## Recovery Guidance` section.
- Render guidance containing failure summary, recommended action, remaining work, retry/resume guidance, sidecar timestamp, and source sidecar identity/path.
- Replace existing `## Recovery Guidance` content rather than appending duplicates.
- Return `patched`, `already-current`, `artifact-missing`, or `blocked` per root plan using client-owned response types.
- Materialize preserved compiled artifacts from feature-branch history back onto the feature branch/merge worktree when artifacts are otherwise only available from history.
- Commit changed tracked artifacts through `forgeCommit()` and return the commit SHA when a commit is created.
- Gate `prepareFailedPrdForQueuedCompiledResume()` and `EforgeEngine.resumeBuild()` on current recovery guidance before requeueing or reading compiled artifacts.
- Add engine tests for rendering, path safety, root-only targeting, idempotency, no-op behavior, commit behavior, continue-and-repair preparation, and resume integration.

### Out of Scope
- Client route constants, route request/response contracts, browser helpers, and API versioning; these are owned by `client-contracts`.
- Daemon HTTP route handlers, validation/security wrappers, and route response mapping; these are owned by `daemon-routes-projections`.
- Console failed-enqueue, queue controls, or recovery UI; these are owned by `console-ux`.
- Queue hold/unhold, cascade remove/cancel, scheduler pause/resume, and failed-enqueue projection.
- CLI/MCP/Pi/Claude command exposure. Existing continue-repair paths may receive guidance patching indirectly, but this module does not add new user-facing commands or tools.
- Patching retry-from-scratch queue mutations that do not consume compiled artifacts. The explicit guidance helper is available to callers, but automatic gating is limited to compiled-artifact continue/resume paths.

## Implementation Approach

### Overview

Add a focused recovery-guidance subsystem under `packages/engine/src/recovery/` with pure rendering/patching helpers separated from git/worktree artifact operations. The main helper, `prepareRecoveryGuidance()`, returns the client-owned `RecoveryGuidancePrepareResponse` shape so the daemon can expose the prepare route without redeclaring wire types.

The helper flow:

1. Validate `prdId`, resolve the queue failed directory, and read `<prdId>.recovery.json` through the existing v3 sidecar parser/projection.
2. Resolve and validate `setName`, `featureBranch`, and `baseBranch` from the sidecar plus optional caller overrides.
3. Normalize `outputDir` as a repo-relative path and reject absolute/traversing output directories.
4. Derive root failed plan ids from `sidecar.boundedEvidence.failingPlans` when present, otherwise from `sidecar.boundedEvidence.failingPlan`.
5. Reject unsafe root plan ids before constructing paths.
6. Ensure a merge worktree exists for the feature branch and locate compiled artifacts in this order: existing merge worktree, feature branch tip, feature branch history.
7. Preflight every root target before writing. If any root target is missing, unsafe, blocked, skipped, or has pre-existing uncommitted target changes, return non-mutating `artifact-missing`/`blocked` results.
8. Render deterministic guidance once per run and patch every root target by adding/replacing exactly one `## Recovery Guidance` section.
9. Commit changed artifacts with `forgeCommit(mergeWorktreePath, message, { paths })`; include full restored plan-set paths when history materialization was required and root plan paths otherwise.
10. Return response metadata (`prdId`, `setName`, `featureBranch`, `baseBranch`, `outputDir`, `sidecarPath`, `sidecarGeneratedAt`, `plans`, and optional `commitSha`).

### Helper API

Create the engine-facing API in `packages/engine/src/recovery/guidance.ts`:

- `PrepareRecoveryGuidanceOptions`: `cwd`, `prdId`, optional `setName`, optional `featureBranch`, optional `baseBranch`, optional `queueDir`, optional `outputDir`, optional `dbPath`, optional `trunkBranch`.
- `prepareRecoveryGuidance(options): Promise<RecoveryGuidancePrepareResponse>`.
- `recoveryGuidanceResumeBlocker(response): string | undefined`, returning `undefined` only when at least one root plan exists and every root result is `patched` or `already-current`.
- `RecoveryGuidanceError` for invalid input, missing sidecar, malformed sidecar, unsafe metadata, and dirty-target preflight failures that cannot be represented as per-plan statuses.

`dbPath` and `trunkBranch` remain in the options because continue/resume callers already pass them and the helper may reuse `resolveQueuedCompiledResumeMetadata()` for compatibility. The guidance content itself comes from the sidecar projection, not from mutable daemon state.

### Guidance Rendering and Idempotency

Create pure functions in `packages/engine/src/recovery/guidance-render.ts`:

- `renderRecoveryGuidanceSection(...)` returns a section whose first line is exactly `## Recovery Guidance`.
- `patchRecoveryGuidanceSection(rawMarkdown, section)` returns `{ content, changed }`.
- `countRecoveryGuidanceSections(rawMarkdown)` supports tests and duplicate cleanup.

Rendering rules:

- The failure summary comes from `sidecar.report.operatorSummary`, plus root failure fields when present.
- The recommended action comes from `sidecar.report.recommendedAction`.
- Remaining work comes from `sidecar.report.remainingWork`; an empty list renders a deterministic fallback bullet.
- Retry/resume guidance mentions the root plan id, the failed PRD id, and continuing from preserved compiled artifacts without restarting dependency-satisfied work.
- Sidecar timestamp is `sidecar.generatedAt`.
- Source identity includes repo-relative sidecar path, `prdId`, `setName`, `featureBranch`, and `baseBranch`.

Patch rules:

- If no canonical heading exists, append the section at EOF with exactly one blank line before it.
- If one or more canonical headings exist, keep the first location, replace the whole first section through the next same-or-higher-level heading, and remove later duplicate `## Recovery Guidance` sections.
- The final file ends with a single newline.
- If the resulting content is byte-identical to the original content, report `already-current` and do not write.

### Artifact Resolution and Materialization

Create git/worktree helpers in `packages/engine/src/recovery/guidance-artifacts.ts`:

- `ensureGuidanceMergeWorktree({ cwd, mergeWorktreePath, featureBranch })` validates the feature ref, verifies it exists with `git rev-parse --verify --end-of-options`, and creates the worktree with `git worktree add <path> <featureBranch>` only when the path is absent.
- `locateGuidanceArtifacts({ cwd, mergeWorktreePath, featureBranch, outputDir, setName })` checks for `orchestration.yaml` in the merge worktree, then at the feature branch tip, then in branch history.
- `materializeGuidanceArtifactsFromHistory(...)` restores the full plan-set directory from the selected artifact commit into the merge worktree with `git checkout <artifactCommit> -- <planSetRelPath>`.
- `listGuidanceArtifactPathsAtCommit(...)` returns restored repo-relative paths for the path-limited commit.
- `assertNoPreexistingGuidanceTargetDiff(...)` blocks patching when target root plan files have uncommitted or untracked changes before guidance is applied.

If artifacts are only available from branch history, restore the full plan set, then patch root plan markdown files, then commit all restored plan-set paths plus the patched root paths. This prevents `resumeBuild()` from reading stale `__resume_artifacts__` copies that lack guidance.

### Continue/Resume Integration

Modify `packages/engine/src/resume/queued-resume.ts`:

- After existing read-only eligibility passes and before `requeueFailedPrdForCompiledResume()`, call `prepareRecoveryGuidance()`.
- If `recoveryGuidanceResumeBlocker()` returns a reason, return a `blocked` requeue result with that reason and leave queue files unmoved.
- Attach the guidance response to successful `PrepareQueuedCompiledResumeResult` values as an optional `recoveryGuidance` property so apply helpers can surface the guidance commit SHA.
- Preserve existing `queued`, `already-queued`, and `blocked` status strings.

Modify `packages/engine/src/recovery/apply.ts`:

- Update the file-level comment because continue-repair can now create a tracked plan-artifact commit through the resume preparation helper.
- In `applyRecoveryContinueRepair()`, set `commitSha` to `result.recoveryGuidance?.commitSha ?? ''`.
- Include a deterministic `detail` suffix when guidance was `patched` or `already-current` so existing consumers still receive a human-facing outcome.

Modify `packages/engine/src/eforge.ts` with bounded exact edits only:

- In `resumeBuild()`, after the first successful `checkResumeEligibility()` and before `build:resume:start`, call `prepareRecoveryGuidance()`.
- If guidance is blocked or missing, emit `build:resume:ineligible` with the blocker reason and return before parsing `orchestration.yaml` or plan markdown.
- After a guidance commit is created, run `checkResumeEligibility()` again and use the second result. This ensures branch-history materialization causes resume to read the patched merge-worktree artifacts instead of the pre-guidance `__resume_artifacts__` copy.
- Keep the existing `phase:start`, `phase:end`, rollback, and terminal failure behavior.
- Do not add new event variants in this module.

### Key Decisions

1. **Sidecar evidence is required for compiled-artifact resume guidance.** The helper does not infer guidance from only monitor DB summaries because the canonical section must include sidecar timestamp and source identity.
2. **Use stable heading plus deterministic replacement.** The heading `## Recovery Guidance` is human-visible and sufficient as the canonical anchor; internal markers are unnecessary for idempotency.
3. **Preflight all root targets before writing.** The helper returns `artifact-missing`/`blocked` without partial root writes when any root target cannot receive guidance.
4. **Commit on the feature branch merge worktree.** Builders already read compiled artifacts from that branch/worktree, so guidance must be durable there before resume reads plan markdown.
5. **Recompute resume eligibility after a guidance commit.** This prevents branch-history resumes from using unpatched temporary artifact copies.
6. **Keep read-only projections untouched.** `projectResumeEligibility()` and recovery analysis remain side-effect-free; only `prepareRecoveryGuidance()` mutates artifacts.
7. **No retry-from-scratch gating.** Retry verdicts requeue the original PRD for a fresh build and do not consume compiled plan artifacts, so automatic guidance gating is limited to continue-and-repair and resume paths.

## Files

### Create
- `packages/engine/src/recovery/guidance-render.ts` — pure deterministic rendering and canonical-section replacement helpers.
- `packages/engine/src/recovery/guidance-artifacts.ts` — safe merge-worktree creation, artifact lookup, branch-history restoration, target-diff preflight, and git path helpers for guidance patching.
- `packages/engine/src/recovery/guidance.ts` — typed `prepareRecoveryGuidance()` orchestration, root-failing-plan resolution, response construction, blocker derivation, and `forgeCommit()` integration.
- `test/recovery-guidance-render.test.ts` — focused tests for guidance rendering, duplicate section replacement, and idempotent no-op patching.
- `test/recovery-guidance.test.ts` — real-git tests for sidecar parsing, path safety, root-only targeting, artifact-missing behavior, idempotency, branch-history materialization, and commit behavior.

### Modify
- `packages/engine/src/resume/queued-resume.ts` — invoke recovery guidance preparation after read-only eligibility and before requeueing; attach optional `recoveryGuidance` metadata to the prepare result.
- `packages/engine/src/recovery/apply.ts` — propagate guidance commit SHA from continue-repair preparation and update comments/detail text.
- `packages/engine/src/eforge.ts` — bounded exact edit in `resumeBuild()` to require guidance before compiled artifacts are parsed; rerun eligibility after guidance commits. This file is over 1,000 lines, so do not rewrite it.
- `test/apply-recovery.test.ts` — update continue-repair expectations for guidance patching and commit SHA when compiled artifacts are present.
- `test/resume-compiled-build-engine.test.ts` — seed recovery sidecars in compiled-resume fixtures and assert `build:resume:artifacts.plans[].body` contains exactly one `## Recovery Guidance` section for root failed plans.
- `test/resume-eligibility.test.ts` — add or adjust read-only eligibility assertions showing `projectResumeEligibility()` does not create worktrees, patch plan files, or commit guidance.
- `test/queued-compiled-resume-engine.test.ts` — assert scheduler-owned compiled resumes read guidance-patched plan artifacts when a failed sidecar is present.

## Testing Strategy

### Unit Tests
- `renderRecoveryGuidanceSection()` output contains failure summary, recommended action, remaining work, retry/resume guidance, sidecar timestamp, and source sidecar identity/path.
- `patchRecoveryGuidanceSection()` appends one section when none exists.
- `patchRecoveryGuidanceSection()` replaces an existing section and leaves later non-guidance sections intact.
- `patchRecoveryGuidanceSection()` collapses duplicate `## Recovery Guidance` sections to one section.
- `patchRecoveryGuidanceSection()` returns `changed: false` for byte-identical guidance.
- Root id resolution prefers `boundedEvidence.failingPlans` over `boundedEvidence.failingPlan`.
- Root id resolution falls back to `boundedEvidence.failingPlan` when `failingPlans` is absent or empty.
- Unsafe `prdId`, `setName`, `featureBranch`, `baseBranch`, `outputDir`, and root plan id values are rejected before filesystem or git commands run.
- Blocked/skipped plan statuses in sidecar evidence are not patched.
- `recoveryGuidanceResumeBlocker()` returns no blocker only for non-empty all-`patched`/`already-current` plan results.

### Integration Tests
- A real git fixture with compiled artifacts at the feature branch tip patches only root failed plan markdown and leaves downstream blocked/skipped dependent markdown unchanged.
- A multi-root sidecar patches each root failed plan exactly once.
- A missing root plan artifact returns `artifact-missing`, leaves files unchanged, and creates no commit.
- Running `prepareRecoveryGuidance()` twice with unchanged sidecar data leaves the feature branch HEAD unchanged on the second run and returns `already-current`.
- A guidance patch commit contains the `Co-Authored-By: forged-by-eforge` trailer and includes only the expected path-limited artifact paths when artifacts were already present at the branch tip.
- A branch-history-only artifact fixture restores the full plan set, patches root guidance, commits restored artifacts, and causes subsequent resume eligibility to use the merge worktree artifact source.
- `prepareFailedPrdForQueuedCompiledResume()` returns `blocked` and leaves queue files unmoved when guidance cannot be applied.
- `prepareFailedPrdForQueuedCompiledResume()` queues the failed PRD after guidance is patched or already current.
- `EforgeEngine.resumeBuild()` emits `build:resume:ineligible` before `build:resume:artifacts` when guidance is blocked.
- `EforgeEngine.resumeBuild()` emits `build:resume:artifacts` with root plan bodies containing one `## Recovery Guidance` section before any builder prompt is produced.
- `projectResumeEligibility()` remains side-effect-free by checking that no guidance section, merge-worktree mutation, or commit appears after calling it.

## Verification

- [ ] `prepareRecoveryGuidance()` reads `.eforge/queue/failed/<prdId>.recovery.json` through the existing v3 sidecar parser.
- [ ] `prepareRecoveryGuidance()` returns `RecoveryGuidancePrepareResponse` without declaring a local daemon/client wire shape.
- [ ] Invalid `prdId`, `setName`, branch names, output directories, and root plan ids are rejected before path construction or git invocation.
- [ ] The helper derives root ids from `boundedEvidence.failingPlans` before using `boundedEvidence.failingPlan`.
- [ ] The helper patches zero downstream blocked/skipped dependents in a fixture where dependents have plan markdown files.
- [ ] Each patched root plan contains exactly one line equal to `## Recovery Guidance`.
- [ ] The guidance section contains the sidecar `generatedAt` value.
- [ ] The guidance section contains the repo-relative sidecar path.
- [ ] A second unchanged helper run returns `already-current` for every root plan and creates no commit.
- [ ] Guidance commits are created with `forgeCommit()` and include the eforge co-author trailer.
- [ ] `prepareFailedPrdForQueuedCompiledResume()` returns `blocked` without moving queue files when guidance is `artifact-missing` or `blocked`.
- [ ] `EforgeEngine.resumeBuild()` parses compiled plan markdown only after guidance preparation returns all `patched`/`already-current` statuses.
- [ ] `projectResumeEligibility()` creates no guidance section and no commit.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
