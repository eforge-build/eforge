---
title: Handle stale stacked PR parent branches during git-spice landing
created: 2026-06-02
---

# Handle stale stacked PR parent branches during git-spice landing

## Problem / Motivation

Roadmap alignment: `docs/roadmap.md` includes a Stacked PRs goal to polish end-to-end stacked PR workflow. This change directly fits that roadmap item.

This is a feature/deep planning session because the work adds a new resilient stacked-landing capability, affects engine/provider behavior, may add wire/event metadata, and should update docs and tests.

A child stacked PRD can successfully build and push its artifact branch, then fail during git-spice PR submission when its recorded parent artifact branch has already been merged and deleted from the remote.

Concrete observed case:

- Child artifact branch: `eforge/add-read-only-session-plan-set-apis-and-console-browsing`.
- Recorded stacked base: `eforge/add-read-only-session-plan-set-artifacts-to-eforge-build-input`.
- Parent PR #89 was already merged into `main`, and the parent branch was no longer present on origin.
- git-spice refused `branch submit` because the base branch did not exist remotely.

Observed failure evidence from the failed build `add-read-only-session-plan-set-apis-and-console-browsing`:

- The implementation branch `eforge/add-read-only-session-plan-set-apis-and-console-browsing` was pushed to origin.
- git-spice submission failed because the recorded base branch `eforge/add-read-only-session-plan-set-artifacts-to-eforge-build-input` did not exist on the remote.
- `gh pr list --head eforge/add-read-only-session-plan-set-artifacts-to-eforge-build-input` showed PR #89 was already merged.
- `git merge-base --is-ancestor eforge/add-read-only-session-plan-set-artifacts-to-eforge-build-input origin/main` returned true in local inspection, so the parent artifact was already integrated into trunk.

User impact:

- eforge marks an otherwise valid build as failed even though implementation and validation completed successfully.
- The recovery path classifies the situation as manual rather than applying a safe deterministic repair.
- Users must understand and repair git-spice stack state manually, even when the correct fix is mechanically inferable: retarget/restack the child onto trunk because the parent artifact is already integrated.

Why it matters now:

- Stacked builds are an active workflow in this repo, and `docs/stacking.md` already describes a pre-landing reconciliation expectation.
- The failure mode appears whenever parent PRs are merged/deleted before dependent PRDs land, which is a normal stacked-PR lifecycle rather than an exceptional state.

Relevant implementation evidence:

- `packages/engine/src/stacking/base-resolver.ts` resolves child stack bases from the artifact registry first, then stack layer state. If the parent artifact branch does not resolve locally, it falls back to the recorded commit SHA when available. It does not currently normalize a parent that is already integrated into trunk back to trunk.
- `packages/engine/src/stacking/landing.ts` delegates stacked PR landing to `provider.trackBranch`, optional cleanup, `provider.restackBranch`, then `provider.submitBranch`. It passes `stackContext.baseBranch` directly to git-spice and records failures, but it does not preflight whether that base exists on the remote or repair stale local stack metadata.
- `packages/engine/src/stacking/git-spice.ts` exposes provider methods for `trackBranch`, `restackBranch`, `submitBranch`, `submitStack`, `syncRepo`, `restackStack`, and `upstackOnto`. It does not expose a branch-specific `onto` operation or remote-base diagnostic helpers.
- `packages/engine/src/stacking/sync.ts` implements daemon-owned stack sync via `git-spice repo sync` and `git-spice stack restack`. It is useful but currently separate from pre-landing repair.
- `docs/stacking.md` already documents “Pre-landing reconciliation” as an expectation, but the landing code does not yet implement remote-base collapse for a merged/deleted parent branch.
- `test/stack-base-resolver.test.ts`, `test/stack-runtime-landing.test.ts`, `test/git-spice-provider.test.ts`, `test/stack-events.test.ts`, and client event schema tests are the primary existing test areas for this change.

## Goal

Implement resilient stacked-landing behavior so a child PR can automatically collapse onto trunk when its recorded parent branch is missing from the remote and the parent artifact is provably already integrated into trunk.

The desired outcome is to prevent safe stacked PR landing failures while failing closed with actionable guidance when missing-parent repair cannot be proven safe.

Recommended profile: Excursion.

Rationale: The work is multi-file and cross-cutting across stack base resolution, stack landing, provider adapter methods, tests, and documentation, but it is cohesive enough for one planner/build pass. It does not require delegated module planning or independently planned subsystems, so Expedition would add overhead without clear benefit. Errand is too small for the provider/state/event/recovery surface area.

## Approach

Implement all seven proposed improvements for stale stacked parent handling:

1. Add a stacked-landing preflight before git-spice submit.
2. Auto-collapse child stack bases onto trunk when the missing parent remote branch is provably already integrated into trunk.
3. Fail safely and actionably when missing-parent repair is not provably safe.
4. Keep the repair in the stack/base-resolution and landing path, not as a post-failure recovery-only workaround.
5. Persist/emit enough metadata to show the originally resolved base, effective landing base, and repair reason.
6. Improve failure classification/recovery messaging for this git-spice missing-base class.
7. Normalize parent bases before child builds when the parent artifact is already integrated into trunk.

### Primary engine targets

#### `packages/engine/src/stacking/base-resolver.ts`

- Add helper logic to detect when a parent artifact branch/ref resolves locally but is already integrated into trunk.
- For child PRDs, when parent artifact is an ancestor of `origin/<trunk>` or resolved trunk ref, return trunk as the effective base instead of the stale parent artifact branch/commit.
- Preserve existing behavior for unresolved parent artifacts that are not provably integrated: throw actionable errors.

#### `packages/engine/src/stacking/landing.ts`

- Add pre-submit remote-base preflight before `provider.trackBranch` or before `provider.submitBranch` after cleanup/restack; final placement should ensure cleanup commits are still included and git-spice is tracking the effective base.
- Detect missing remote base branches for child layers.
- If the missing base's recorded parent artifact commit is an ancestor of trunk, repair the checked-out branch's git-spice topology to the effective trunk base, then submit.
- Emit/persist repair metadata and use the effective base for PR metadata and auto-merge event base fields.
- Preserve existing failure handling paths and stack layer status transitions.

#### `packages/engine/src/stacking/git-spice.ts` and `packages/engine/src/stacking/provider.ts`

- Add provider methods for branch-scoped retargeting and/or diagnostics.
- Evidence from `git-spice branch onto --help` shows `git-spice branch onto <onto> --branch=<branch>` is available and non-interactive when the target is supplied.
- Keep provider-specific argv construction inside the adapter.

#### `packages/engine/src/stacking/types.ts`, `packages/engine/src/stacking/state.ts`, and `packages/client/src/events.schemas.ts`

- Add optional metadata fields if needed for observability, such as `resolvedBase`, `effectiveBase`, and `baseRepairReason` on landing records/events.
- Keep additions optional to avoid breaking existing persisted runtime state.

#### `packages/engine/src/recovery/*` and/or `packages/engine/src/terminal-failure.ts`

- Improve classification or recovery summary generation for git-spice missing-base failures that mention `base branch ... does not exist in the remote` or `base branch has not been submitted yet`.
- Prefer a stack-base-specific recommendation over a generic manual verdict when ancestry checks prove safe repair is available.

### Tests to update or add

#### `test/stack-base-resolver.test.ts`

- Parent artifact branch exists locally but parent artifact commit is ancestor of `origin/main`; child base resolves to `main`.
- Parent branch missing locally but commit SHA exists and is ancestor of trunk; child base resolves to `main` instead of raw commit SHA when trunk integration is proven.
- Parent artifact is not ancestor of trunk; existing fallback/error behavior remains safe.

#### `test/stack-runtime-landing.test.ts`

- Preflight skips repair when base branch exists remotely.
- Preflight repairs to trunk when remote parent branch is missing and parent commit is ancestor of trunk.
- Preflight fails actionably when remote parent branch is missing and parent commit is not ancestor of trunk.
- Provider retarget command emits `stack:provider:command` metadata.
- Landing complete persists effective-base repair metadata.

#### `test/git-spice-provider.test.ts`

- New provider method invokes the expected `git-spice branch onto <target> --branch=<branch>` argv, or equivalent chosen command.

#### `test/stack-events.test.ts` and client schema parity tests

- Cover any new optional event fields if the wire shape is extended.

### Design decisions

#### Use trunk-collapse only when ancestry proves the parent is integrated

When a child layer's recorded base branch is missing from origin, eforge should not assume the parent is safe to skip. It should check whether the parent artifact commit or branch tip is an ancestor of the configured trunk remote/local trunk.

Rationale:

- The observed failure was safe because the parent PR was merged into `main`.
- A missing remote parent branch could also mean a deleted-but-unmerged branch, a renamed branch, or corrupt stack metadata. Those cases must fail closed.

#### Normalize child base at both dispatch-time and landing-time

Implement two complementary checks:

1. `resolveStackBaseContext` should prefer trunk as the child build base when the parent artifact is already integrated into trunk.
2. `executeStackLanding` should still preflight and repair before submission because stack state can change after dispatch/build but before landing.

Rationale:

- Dispatch-time normalization avoids building on stale branch topology when the parent has already landed.
- Landing-time preflight handles races where the parent merges while the child build is running.

#### Keep git-spice commands behind the provider adapter

Add provider interface methods rather than invoking `git-spice` directly from landing/base resolver code.

Rationale:

- Existing provider boundary already centralizes argv construction and command redaction in `packages/engine/src/stacking/git-spice.ts`.
- Future stack providers should not inherit direct git-spice assumptions scattered through engine orchestration.

#### Repair branch topology with branch-scoped retargeting, not whole-stack sync

Use a branch-specific operation such as `git-spice branch onto <target> --branch=<artifactBranch>` for the current child branch when the missing parent is provably integrated.

Rationale:

- `git-spice stack restack` is global and cannot be scoped, as documented in `packages/engine/src/stacking/sync.ts` and `docs/stacking.md`.
- Landing repair should avoid mutating unrelated active build branches.

#### Expose repair metadata as optional observability fields

Persist/emit optional metadata such as:

- `originalBaseBranch` or `resolvedBase` — the base first recorded by stack context.
- `effectiveBaseBranch` — the base used for final submit.
- `baseRepairReason` — e.g. `parent-artifact-already-integrated`.

Rationale:

- Users need to understand why a child PR targets trunk rather than the originally recorded parent branch.
- Optional fields preserve compatibility with existing state files and event consumers.

#### Do not auto-submit missing parents

If the parent branch is missing remotely but parent artifact is not integrated into trunk, fail with remediation guidance rather than submitting the parent branch automatically.

Rationale:

- Auto-submitting the parent may create unintended PRs, target the wrong base, or conflict with human branch lifecycle decisions.
- The safe deterministic repair only applies when the parent is already landed.

#### Recovery classification remains secondary

Recovery should recognize this failure signature and give better guidance, but the primary fix belongs in stack base resolution and landing preflight.

Rationale:

- Preventing the failure is better than asking recovery to repair after the build has already been marked failed.
- The recovery path is still valuable for existing failed builds or unexpected provider failures.

### Architecture impact

This change stays within the existing engine-owned stacked PR architecture.

Boundary changes:

- The stack provider interface gains one or more branch-topology operations, likely a branch-scoped `onto` operation and possibly remote branch/ref preflight helpers if they are provider-specific.
- Generic git checks for ancestry and ref existence can live in engine stack helpers when they are not git-spice-specific.
- No daemon route changes are required unless the implementation chooses to expose new stack repair controls, which is not part of this plan.

Data-flow changes:

- Current flow: queued PRD frontmatter → `resolveStackBaseContext` → artifact branch base → build → `executeStackLanding` → git-spice submit.
- New flow: queued PRD frontmatter → `resolveStackBaseContext` may normalize integrated parent to trunk → build → `executeStackLanding` validates remote base again → optional branch retarget to effective base → git-spice submit.

Wire/state impact:

- Stack layer landing metadata may gain optional fields for original/effective base and repair reason.
- `stack:landing:update` may gain optional fields if real-time rendering should show the repair. Optional additions are preferred; avoid changing required fields or existing literals.

Compatibility:

- Existing `.eforge/stacks/layers.json` and `.eforge/artifacts/builds.json` files must continue to load.
- Existing event consumers must continue to accept old `stack:landing:update` events.
- Existing non-stacked and non-PR landing paths should be unaffected.

### Documentation impact

Update `docs/stacking.md`:

- Expand the “Pre-landing reconciliation” section with the new automatic behavior.
- Document that eforge checks whether a stacked base branch exists on the remote before PR submission.
- Document that if the missing parent branch's artifact commit is already integrated into trunk, eforge safely retargets/restacks the child onto trunk and submits the child PR against trunk.
- Document that if eforge cannot prove the parent artifact is integrated, landing fails closed with an actionable error.
- Clarify that users should still run `eforge stack sync` for normal whole-stack maintenance, but stale-parent landing repair is branch-scoped and automatic.

Generated docs impact:

- If `stack:landing:update` wire schema or stack layer wire schema gets optional fields, run `pnpm docs:generate` or `pnpm docs:check` as appropriate so generated reference docs remain current.

No Pi/Claude skill docs are expected to require changes unless the user-facing status text or stack sync command guidance changes.

### Risks and mitigations

- Incorrect safe-collapse detection could make a child PR target trunk even though its parent changes are not actually available on trunk. Mitigation: require `merge-base --is-ancestor <parentArtifactCommit> <trunkRef>` to pass before repair.
- Branch-scoped `git-spice branch onto` may behave differently than expected when run from a merge worktree or when git-spice local state is stale. Mitigation: add provider/integration-style tests with real git repos where possible and fail closed on non-zero provider results.
- Running global stack sync during landing could mutate unrelated active-build branches. Mitigation: use branch-scoped retargeting for landing repair rather than `stack restack`.
- Adding required event fields would break existing clients. Mitigation: make new observability fields optional and update client schemas/tests.
- Recovery classification based only on error text could be brittle. Mitigation: treat it as diagnostic guidance only; the safe behavior should come from explicit preflight checks in landing/base resolution.
- Remote branch existence checks require remote state to be available locally or via `git ls-remote`. Mitigation: handle unavailable remotes as an actionable preflight failure rather than guessing.

### Assumptions and validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| The observed failure was caused by a merged/deleted parent branch rather than invalid child code. | Recovery sidecar showed build/type/test/docs validation commands exited 0; `gh pr list --head eforge/add-read-only-session-plan-set-artifacts-to-eforge-build-input` showed PR #89 merged; `git ls-remote --heads origin` showed only the child branch; `git merge-base --is-ancestor parent origin/main` succeeded during inspection. | high | low | Re-run the same git/gh checks on the affected repo. | If wrong, automatic repair could hide a real provider or code failure. |
| `git-spice branch onto <target> --branch=<branch>` is available and suitable for branch-scoped retargeting. | `git-spice branch onto --help` in this repo documents `[<onto>]` and `--branch=NAME`; `git-spice upstack onto --help` confirms an upstack variant also exists. | medium | medium | Add tests using a real temporary git repo and the adapter command wrapper; if git-spice is unavailable in CI, keep adapter argv tests and unit-test landing behavior with a stub provider. | If wrong, the chosen repair command may fail at runtime and landing must fail safely. |
| Trunk ancestry is the correct safety predicate for parent collapse. | The parent branch in the observed failure was already an ancestor of `origin/main`; git merge semantics make ancestry a deterministic proof that parent commits are included. | high | low | Unit-test with parent ancestor and non-ancestor commit graphs. | If wrong, child PRs could target trunk without required parent changes. |
| Adding optional stack landing metadata fields is compatible with existing clients and persisted state. | Existing stack state schema uses optional landing fields; client event schemas already model optional fields for several stack shapes. This has not been fully validated against all UI projections. | medium | low | Run type-check and event schema tests; inspect console/monitor projections if TypeScript errors surface. | If wrong, clients may reject or ignore useful repair metadata. |
| Base normalization should occur both before child build and before landing. | `base-resolver.ts` currently only runs at dispatch, while the parent can merge during a child build; `landing.ts` currently passes the resolved base directly into git-spice. | high | low | Add separate tests for dispatch-time normalization and landing-time race repair. | If omitted in one place, the failure can recur in either pre-existing-stale or race-during-build cases. |
| Recovery classification can use git-spice error text as a fallback diagnostic. | The terminal error contains stable phrases: `base branch ... does not exist in the remote` and `base branch has not been submitted yet`; recovery already reads landing failure messages. | medium | low | Add recovery tests with this error string; keep classification advisory rather than mutating branch state. | If brittle, recovery guidance could be less precise, but landing preflight still prevents the main failure. |

No low-confidence/high-impact assumptions remain unresolved. The highest-impact behavior, trunk collapse, is gated by explicit ancestry checks and must fail closed when those checks do not prove safety.

## Scope

In scope:

- Engine stack-base resolution and stack landing behavior for the git-spice provider.
- Provider adapter methods needed to repair branch topology non-interactively, likely a branch-scoped `branch onto --branch <branch> <target>` or equivalent wrapper.
- Local/remote git checks that are cheap and deterministic: ref existence, remote branch existence, merge-base ancestry, and trunk resolution.
- Event/state metadata updates for observability, if they can be added compatibly as optional fields.
- Tests for safe repair, unsafe missing-parent failures, event/state metadata, and regression coverage for the observed failure signature.
- Documentation updates in `docs/stacking.md` for automatic stale-parent collapse and manual fallback.

Out of scope:

- Supporting stack providers other than git-spice.
- Automatically submitting an unmerged/missing parent branch. If the parent artifact is not already integrated into trunk, eforge should not guess.
- Changing GitHub branch-deletion behavior or requiring teams to keep parent branches alive after merge.
- Rebuilding implementation branches solely to repair stack metadata.
- Moving stack orchestration into Console or Pi integration packages; this is engine/provider behavior.

Likely no required changes:

- `packages/pi-eforge/` and `eforge-plugin/` should not need command changes unless user-facing stack sync/recovery text is changed.
- This work is engine behavior, but consumer-facing docs or status rendering may need small updates if new event fields should be displayed.

## Acceptance Criteria

- `resolveStackBaseContext` returns the configured trunk branch for a child PRD when the parent artifact commit is an ancestor of the resolved trunk ref.
- `resolveStackBaseContext` preserves existing parent artifact branch behavior when the parent artifact branch exists and is not already integrated into trunk.
- `resolveStackBaseContext` throws an actionable error when the parent artifact branch is missing and the parent artifact commit is not an ancestor of trunk.
- Stacked PR landing checks whether the effective base branch exists on the remote before invoking git-spice PR submission.
- Stacked PR landing retargets the child artifact branch to trunk when the remote parent base branch is missing and the parent artifact commit is an ancestor of trunk.
- Stacked PR landing does not retarget the child artifact branch when the remote parent base branch is missing and the parent artifact commit is not an ancestor of trunk.
- Stacked PR landing emits a failed `stack:landing:update` event with an actionable reason when missing-parent repair is not provably safe.
- Stacked PR landing emits provider command metadata for any git-spice branch-retarget command it runs.
- Stacked PR landing records the original base branch, effective base branch, and repair reason in stack landing state when automatic stale-parent repair occurs.
- `stack:landing:update` events include optional original-base, effective-base, and repair-reason metadata when automatic stale-parent repair occurs, if the implementation extends the event schema.
- Recovery analysis identifies git-spice missing-base submission failures as stack-base failures and recommends stack/base repair rather than treating them as generic code/build failures.
- `docs/stacking.md` documents automatic stale-parent collapse and fail-closed behavior for missing parent branches.
- `test/stack-base-resolver.test.ts` covers the integrated-parent-to-trunk normalization path.
- `test/stack-base-resolver.test.ts` covers the case where the parent artifact branch exists locally and the parent artifact commit is an ancestor of `origin/main`.
- `test/stack-base-resolver.test.ts` covers the case where the parent branch is missing locally but the commit SHA exists and is an ancestor of trunk.
- `test/stack-base-resolver.test.ts` covers the case where the parent artifact is not an ancestor of trunk and existing fallback/error behavior remains safe.
- `test/stack-runtime-landing.test.ts` covers the safe repair landing path.
- `test/stack-runtime-landing.test.ts` covers the unsafe failure landing path.
- `test/stack-runtime-landing.test.ts` verifies that preflight skips repair when the base branch exists remotely.
- `test/stack-runtime-landing.test.ts` verifies that preflight repairs to trunk when the remote parent branch is missing and the parent commit is an ancestor of trunk.
- `test/stack-runtime-landing.test.ts` verifies that preflight fails actionably when the remote parent branch is missing and the parent commit is not an ancestor of trunk.
- `test/stack-runtime-landing.test.ts` verifies that provider retarget command emits `stack:provider:command` metadata.
- `test/stack-runtime-landing.test.ts` verifies that landing complete persists effective-base repair metadata.
- `test/git-spice-provider.test.ts` covers any new git-spice provider method added for branch retargeting.
- `test/git-spice-provider.test.ts` verifies that the new provider method invokes the expected `git-spice branch onto <target> --branch=<branch>` argv, or equivalent chosen command.
- `test/stack-events.test.ts` covers any new optional event fields if the wire shape is extended.
- Client schema parity tests cover any new optional event fields if the wire shape is extended.
- Client event schema tests pass when optional stack landing metadata fields are added.
- Existing `.eforge/stacks/layers.json` files continue to load.
- Existing `.eforge/artifacts/builds.json` files continue to load.
- Existing event consumers continue to accept old `stack:landing:update` events.
- Existing non-stacked landing paths are unaffected.
- Existing non-PR landing paths are unaffected.
- `pnpm type-check` exits 0.
- `pnpm test` exits 0.
- `pnpm docs:check` exits 0.
- `pnpm maintainability:check` exits 0.
