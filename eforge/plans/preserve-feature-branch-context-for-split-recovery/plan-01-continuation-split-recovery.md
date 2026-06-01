---
id: plan-01-continuation-split-recovery
name: Continuation-aware split recovery
branch: preserve-feature-branch-context-for-split-recovery/plan-01-continuation-split-recovery
agents:
  builder:
    effort: high
    rationale: The change coordinates recovery sidecar parsing, queue frontmatter,
      git ref validation, queued compile base selection, daemon route behavior,
      and user-facing recovery guidance.
  reviewer:
    effort: high
    rationale: Review must examine branch/ref safety and ensure logical base and
      worktree base remain separate.
  tester:
    effort: high
    rationale: Regression coverage needs real git fixtures for recovery apply and
      queued compile base propagation.
---

# Continuation-aware Split Recovery

## Architecture Context

Split recovery currently writes the analyst-suggested successor PRD as an ordinary queue item. Queue workers are process-isolated, so any decision to continue from the failed build's feature branch must be serialized into the queued PRD itself. The engine already has the lower-level primitive required for this: `compile()` accepts `baseBranchOverride` for logical landing base and `worktreeBaseRefOverride` for the ref used to create the successor merge worktree.

This plan preserves split recovery semantics: a split verdict still enqueues a successor PRD, but when the recovery sidecar proves partial landed or merged work, the successor becomes a continuation PRD whose worktree starts from the preserved failed feature branch while its logical base remains the original base branch.

## Implementation

### Overview

Implement a trusted recovery-continuation metadata path from recovery sidecar summary → queue frontmatter → queued compile options. Keep response shapes stable and keep compiled-artifact resume as a separate action.

### Key Decisions

1. **Use flat `recovery_*` queue frontmatter fields.** Add `recovery_from`, `recovery_set_name`, `recovery_feature_branch`, and `recovery_base_branch`. These are simple for the existing queue frontmatter parser and capture all acceptance criteria without nesting.
2. **Derive continuation metadata only from recovery sidecar summary.** Continue stripping all agent-emitted YAML frontmatter from `suggestedSuccessorPrd`; any `recovery_*` fields in the suggestion body/frontmatter are ignored.
3. **Fail closed only when partial-work evidence exists.** A split sidecar with no `landedCommits` and no `plans[].mergedAt` keeps the existing fresh-successor behavior. A sidecar with partial landed or merged evidence requires valid, resolvable feature/base refs before writing the successor.
4. **Do not merge trunk during continuation apply.** The successor worktree starts from the preserved feature branch. Landing and orchestration keep the original base branch.
5. **Guard stacked PRDs.** Recovery continuation metadata must not override `stackContext`; reject a stacked queued PRD that also carries recovery continuation metadata unless a future change adds explicit stacked-continuation tests.
6. **Keep daemon apply response shape unchanged.** `POST /api/recover/apply` continues returning `{ verdict, commitSha, successorPrdId, noAction }`; no daemon API version bump is needed unless implementation adds response fields.

### Detailed Steps

#### 1. Extend queue frontmatter

Modify `packages/engine/src/prd-queue.ts`:

- Extend `prdFrontmatterSchema` with optional non-empty strings:
  - `recovery_from`
  - `recovery_set_name`
  - `recovery_feature_branch`
  - `recovery_base_branch`
- Extend `PrdFrontmatter` consumers through the inferred type.
- Extend `EnqueuePrdOptions` with matching optional fields, or with a small typed `recoveryContinuation` option that serializes to those flat fields.
- Add these fields to the `frontmatter` object built in `enqueuePrd()`.
- Serialize the fields into YAML frontmatter after stack/landing fields or in a nearby recovery section. Use exact field names above.
- Add a small exported helper if useful, for example `getRecoveryContinuationFrontmatter(frontmatter)`, that returns all four fields only when the field set is complete and returns `undefined` when none are present. Partial field sets must produce a clear error before compile.

#### 2. Add trusted continuation derivation and validation

Create `packages/engine/src/recovery/continuation.ts`:

- Export a `RecoveryContinuationMetadata` type with:
  - `sourcePrdId`
  - `setName`
  - `featureBranch`
  - `baseBranch`
- Export `hasPartialLandedOrMergedWork(summary: BuildFailureSummary): boolean` using machine evidence:
  - `summary.landedCommits.length > 0`, or
  - any `summary.plans[]` entry has a non-empty `mergedAt` value.
- Export `deriveSplitRecoveryContinuation({ cwd, prdId, summary })`:
  - Return `undefined` when `summary` is absent or has no partial landed/merged evidence.
  - When partial evidence exists, require non-empty `summary.setName`, `summary.featureBranch`, and `summary.baseBranch`.
  - Validate `featureBranch` and `baseBranch` before returning metadata.
- Ref validation requirements:
  - Reject empty refs, refs beginning with `-`, refs containing NUL/control characters/whitespace, `..`, `@{`, or Git revision metacharacters such as `~`, `^`, `:`, `?`, `*`, `[`, `\`, `{`, `}`.
  - Run `git check-ref-format --branch <ref>` for branch-name validation.
  - Run `git rev-parse --verify --end-of-options <ref>^{commit}` to require that the ref resolves in the repository.
  - Error messages must include the bad/missing ref and the failed PRD id.

Keep this helper focused on recovery continuation; do not move compiled-build resume logic into it.

#### 3. Apply split verdicts with continuation metadata

Modify `packages/engine/src/recovery/apply.ts`:

- Extend `applyRecoverySplit()` to accept an optional `{ summary?: BuildFailureSummary }` context.
- Continue throwing when `suggestedSuccessorPrd` is missing.
- Continue stripping all agent-emitted YAML frontmatter from `suggestedSuccessorPrd` before inferring the title.
- Call `deriveSplitRecoveryContinuation()` with the sidecar summary.
- Pass the resulting trusted metadata into `enqueuePrd()` using the `recovery_*` fields.
- Preserve current split side effects: write a successor PRD to the queue root and leave the failed PRD plus both recovery sidecars in `failed/`.
- Add tests proving an agent-suggested frontmatter block containing conflicting `recovery_*` values is stripped and does not override sidecar-derived values.

Modify `packages/engine/src/eforge.ts` in `EforgeEngine.applyRecovery()`:

- Parse the sidecar JSON as an object containing `summary` and `verdict`.
- Keep `recoveryVerdictSchema` validation for `verdict`.
- Pass `parsed.summary` to `applyRecoverySplit()`.
- Keep existing decision emission and result shape.

Modify `packages/monitor/src/server.ts` in the `POST /api/recover/apply` route:

- Retain the existing request/response contract and status-code behavior for existing cases.
- Preserve the parsed sidecar summary while validating the verdict.
- Pass the sidecar summary to `applyRecoverySplit()` so daemon route behavior matches `EforgeEngine.applyRecovery()`.
- Do not add route-local wire interfaces for runs/queue/session metadata. If any response type change becomes unavoidable, update `packages/client/src/routes.ts` and bump `DAEMON_API_VERSION`; otherwise leave both unchanged.

#### 4. Honor continuation during queued compile

Modify `packages/engine/src/eforge.ts` in `buildSinglePrd()`:

- Resolve recovery continuation metadata from `prd.frontmatter` before trunk-sync decision logic.
- If recovery continuation metadata is present and `stackContext !== undefined`, emit plan failure events with an error such as `Recovery continuation PRD cannot also use stack metadata`, set `prdResult` to failed, and return before compile.
- If continuation metadata is present and the PRD is non-stacked:
  - Skip non-stacked trunk-sync base override for this PRD.
  - Pass `baseBranchOverride: recovery_base_branch` to `compile()`.
  - Pass `worktreeBaseRefOverride: recovery_feature_branch` to `compile()`.
  - Optionally emit a `planning:progress` event naming the preserved feature branch and logical base branch.
- Preserve existing behavior for:
  - Non-continuation queued PRDs.
  - Stacked root/child PRDs without recovery continuation metadata.
  - Trunk sync for ordinary non-stacked PRDs.

This is the point that makes `createMergeWorktree()` start the successor branch from the failed feature branch while orchestration and landing keep `base_branch` as the original base branch.

#### 5. Update recovery guidance and Console copy

Modify first-party recovery wording without changing response shapes:

- `packages/console-ui/src/components/now/queue-recovery-dialog.tsx`
  - Change split action description/result text so it says split may enqueue a continuation successor from the preserved feature branch when the recovery report shows landed partial work.
- `packages/console-ui/src/components/now/__tests__/queue-recovery-dialog.test.tsx`
  - Update assertions for the new split wording.
- `packages/pi-eforge/skills/eforge-recover/SKILL.md`
  - Clarify that `eforge_apply_recovery` for split enqueues a successor PRD and, when landed partial work is recorded in the sidecar, the successor starts from the preserved feature branch while targeting the original base branch.
  - Keep resume described as the separate path for running the original compiled artifacts.
- `eforge-plugin/skills/recover/recover.md`
  - Make the same wording change as the Pi skill, using MCP tool names.
- `eforge-plugin/.claude-plugin/plugin.json`
  - Bump the plugin version patch number because plugin skill text changed.
- Do not bump `packages/pi-eforge/package.json`.

#### 6. Tests

Add or update focused tests:

- `test/apply-recovery.test.ts`
  - Split with `landedCommits` and an existing `eforge/<set>` branch writes `recovery_from`, `recovery_set_name`, `recovery_feature_branch`, and `recovery_base_branch` in the successor frontmatter.
  - Split with `plans[].mergedAt` and an existing feature branch writes the same continuation frontmatter even when `landedCommits` is empty.
  - Agent-emitted frontmatter in `suggestedSuccessorPrd` is stripped and cannot supply or override `recovery_*` fields.
  - Split with partial evidence and a missing preserved feature branch rejects before writing a successor PRD.
  - Split with partial evidence and an unsafe preserved feature branch rejects before writing a successor PRD.
  - Split with no partial evidence keeps existing fresh-successor behavior and omits all `recovery_*` fields.
  - Successful split keeps the failed PRD, recovery markdown sidecar, and recovery JSON sidecar in `failed/`.
- `test/apply-recovery-route.test.ts`
  - Add a daemon-route split case with partial evidence and an existing branch, asserting the queued successor contains the same continuation frontmatter as the engine path.
  - Add a route case for partial evidence plus missing branch, asserting non-2xx response and no successor file.
- Create `test/recovery-continuation-queue.test.ts` or an equivalent focused queue/build test:
  - Construct a real git repo with `main`, a preserved feature branch containing a sentinel commit/file, and a queued PRD carrying `recovery_*` frontmatter.
  - Exercise the queued compile path enough to assert `compile()` receives `baseBranchOverride === 'main'` and `worktreeBaseRefOverride === 'eforge/<failed-set>'`.
  - Include an integration assertion when feasible: the successor merge worktree or successor branch contains the sentinel commit/file before successor planning artifacts are added, and the generated `orchestration.yaml` records `base_branch: main` rather than the preserved feature branch.
  - Add a non-continuation queued PRD case proving the previous base-ref behavior remains unchanged.
  - Add a stacked PRD with recovery continuation metadata case proving the build fails before continuation overrides are applied.
- `packages/console-ui/src/components/now/__tests__/queue-recovery-dialog.test.tsx`
  - Update split text expectations.

## Scope

### In Scope

- Typed queue frontmatter for split continuation metadata.
- Trusted derivation from recovery sidecar summary.
- Fail-closed branch/base validation when partial landed or merged work exists.
- Continuation-aware compile options for non-stacked queued PRDs.
- Daemon route parity with `EforgeEngine.applyRecovery()`.
- Console, Pi, and Claude Code recovery wording updates.
- Regression tests for apply behavior, daemon route behavior, and queued compile base selection.

### Out of Scope

- Converting split recovery into compiled-artifact resume.
- Merging trunk into the preserved failed feature branch.
- Letting LLM-emitted YAML control branch/base behavior.
- Redesigning stacked PRD semantics.
- Changing `POST /api/recover/apply` response shape unless implementation discovers an unavoidable client need.
- Bumping the Pi package version.

## Files

### Create

- `packages/engine/src/recovery/continuation.ts` — Trusted recovery-continuation derivation, partial-work detection, and branch/base ref validation.
- `test/recovery-continuation-queue.test.ts` — Focused regression coverage for queued continuation compile base selection and stack guard behavior.

### Modify

- `packages/engine/src/prd-queue.ts` — Add `recovery_*` frontmatter schema, enqueue options, serialization, and helper for complete metadata extraction.
- `packages/engine/src/recovery/apply.ts` — Accept sidecar summary context, derive trusted continuation metadata, and pass it to `enqueuePrd()` while stripping agent frontmatter.
- `packages/engine/src/eforge.ts` — Pass sidecar summary into split apply and honor continuation frontmatter during non-stacked queued compile.
- `packages/monitor/src/server.ts` — Pass sidecar summary into the split apply helper in `POST /api/recover/apply`.
- `packages/console-ui/src/components/now/queue-recovery-dialog.tsx` — Clarify split successor continuation behavior.
- `packages/console-ui/src/components/now/__tests__/queue-recovery-dialog.test.tsx` — Update split copy assertions.
- `packages/pi-eforge/skills/eforge-recover/SKILL.md` — Clarify split vs resume guidance for Pi.
- `eforge-plugin/skills/recover/recover.md` — Clarify split vs resume guidance for Claude Code.
- `eforge-plugin/.claude-plugin/plugin.json` — Bump plugin patch version.
- `test/apply-recovery.test.ts` — Add engine split-continuation apply tests and preserve existing fresh split tests.
- `test/apply-recovery-route.test.ts` — Add daemon route parity tests for continuation split.
- Queue/frontmatter tests such as `test/per-build-profile-override.test.ts` or a new focused test — Assert `validatePrdFrontmatter()`, `loadQueue()`, and `enqueuePrd()` accept and round-trip `recovery_*` fields.

## Database Migration

No database migration is required.

## Verification

- [ ] A split sidecar with `landedCommits` writes `recovery_from`, `recovery_set_name`, `recovery_feature_branch`, and `recovery_base_branch` into the queued successor PRD.
- [ ] A split sidecar with `plans[].mergedAt` and no `landedCommits` writes the same continuation fields.
- [ ] A split sidecar with no landed/merged evidence omits all `recovery_*` fields and still enqueues a successor PRD.
- [ ] Agent-emitted YAML frontmatter in `suggestedSuccessorPrd` is absent from the successor body and cannot set `recovery_*` fields.
- [ ] Partial-work split apply rejects a missing preserved feature branch before any successor PRD file exists.
- [ ] Partial-work split apply rejects an unsafe preserved feature branch ref before any successor PRD file exists.
- [ ] Successful split apply leaves `<prdId>.md`, `<prdId>.recovery.md`, and `<prdId>.recovery.json` under `.eforge/queue/failed/`.
- [ ] A continuation queued PRD calls `compile()` with `worktreeBaseRefOverride` equal to the preserved feature branch.
- [ ] A continuation queued PRD calls `compile()` with `baseBranchOverride` equal to the original logical base branch.
- [ ] A continuation successor worktree or branch contains a sentinel commit/file from the preserved feature branch before successor planning artifacts are added.
- [ ] Generated orchestration for a continuation successor records `base_branch: <original base>` and not the preserved feature branch.
- [ ] Non-continuation queued PRDs keep the existing base-ref behavior.
- [ ] Stacked queued PRDs with recovery continuation metadata fail before stack base resolution can be overridden by continuation metadata.
- [ ] `POST /api/recover/apply` split writes the same continuation frontmatter as `EforgeEngine.applyRecovery()` for the same sidecar summary.
- [ ] Console split copy mentions continuation from the preserved feature branch when landed partial work is recorded.
- [ ] Pi and Claude Code recovery skills describe split continuation and compiled-build resume as separate actions.
- [ ] `pnpm vitest run test/apply-recovery.test.ts test/apply-recovery-route.test.ts test/recovery-continuation-queue.test.ts packages/console-ui/src/components/now/__tests__/queue-recovery-dialog.test.tsx` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test` exits 0.
