---
id: plan-02-landing-preflight-and-observability
name: Landing Preflight Repair and Observability Metadata
branch: handle-stale-stacked-pr-parent-branches-during-git-spice-landing/plan-02-landing-preflight-and-observability
agents:
  builder:
    effort: high
    rationale: Coordinates landing workflow ordering, optional wire metadata, PR
      metadata base selection, and state projection across large existing files.
  reviewer:
    effort: high
    rationale: Landing failure paths, event compatibility, and subprocess/ref
      handling need careful review.
---

# Landing Preflight Repair and Observability Metadata

## Architecture Context

After dispatch-time normalization, a parent PR can still merge and delete its branch while a child build is running. Stacked landing currently passes `stackContext.baseBranch` directly to git-spice and only reports the provider failure after `branch submit` fails. This plan adds landing-time remote-base preflight and repair using the provider retarget method from plan 01, and makes the original/effective base visible through optional landing metadata.

## Implementation

### Overview

Add a child-layer landing preflight that checks whether the stack base branch exists on the remote before git-spice submit. If the remote parent branch is missing and the recorded parent artifact commit is an ancestor of trunk, retarget the child branch onto trunk and submit against trunk. If the ancestry proof fails or the remote cannot be queried, emit/persist a failed stack landing with an actionable reason and do not submit.

### Key Decisions

1. Run a preflight before tracking/restacking so stale bases are not handed to git-spice, and run a final pre-submit check after cleanup/restack so a race during the landing window is still caught.
2. Repair only child layers with parent artifact evidence; root stack layers and non-PR landing actions keep the existing flow.
3. Emit and persist optional `originalBaseBranch`, `effectiveBaseBranch`, and `baseRepairReason` fields only when the landing decision has enough metadata to report.
4. Generate PR metadata from the effective base after preflight so PR bodies and auto-merge events do not reference a stale parent branch in repaired landings.

## Scope

### In Scope

- Landing-time remote-base preflight for child stacked PRs.
- Automatic branch-scoped retarget to trunk when the missing parent remote branch is provably integrated.
- Fail-closed landing update when missing-parent repair cannot be proven.
- Optional landing metadata in engine state and client event schemas.
- PR metadata and auto-merge base fields updated to use the effective landing base.
- Tests for repaired, skipped-repair, and unsafe missing-parent landing paths.

### Out of Scope

- Dispatch-time base normalization and provider method creation from plan 01.
- Recovery recommendation wording and `docs/stacking.md` updates from plan 03.
- UI component changes beyond reducer/projection support for optional fields.
- Whole-stack sync or automatic parent branch submission.

## Files

### Modify

- `packages/engine/src/stacking/landing.ts` — Add landing base decision/preflight logic and use the effective base throughout tracking, retarget, restack, submit, PR metadata, landing persistence, and auto-merge events.
- `packages/engine/src/orchestrator/phases.ts` — Pass a metadata factory that accepts the effective base context and renders PR metadata with that base. Keep provenance collection behavior for cleanup builds.
- `packages/engine/src/stacking/types.ts` — Add optional `originalBaseBranch`, `effectiveBaseBranch`, and `baseRepairReason` fields to `StackLayerLanding`.
- `packages/engine/src/stacking/state.ts` — Add the same optional fields to `stackLayerLandingSchema`; existing `.eforge/stacks/layers.json` files without the fields must continue loading.
- `packages/client/src/events.schemas.ts` — Add optional fields to `StackLayerLandingWireSchema` and `stack:landing:update` schema. Keep all additions optional.
- `packages/client/src/event-registry.ts` — Project optional landing metadata into `state.stackLayers[].landing` and include the repair in the event summary when present.
- `test/stack-runtime-landing.test.ts` — Add landing preflight/repair tests with real temporary git repositories and stub providers.
- `test/stack-events.test.ts` — Cover parsing of `stack:landing:update` with the optional repair metadata.
- `packages/client/src/__tests__/events-wire-parity.test.ts` — Add the optional fields to an existing stack landing sample or add a compact sample without exceeding the file's no-growth ceiling.

## Detailed Requirements

### Landing base decision

- For non-child stack contexts, keep the current track → cleanup → restack → submit flow.
- For child stack contexts:
  - Treat `stackContext.originalBaseBranch ?? stackContext.baseBranch` as the originally resolved base.
  - Treat `stackContext.baseBranch` as the initial effective base, which may already be trunk from dispatch-time normalization.
  - Check the remote branch for the effective base before git-spice submit. For a parent artifact base, use the configured/recorded remote or default to `origin`.
  - If the remote branch exists, do not repair.
  - If the remote branch is missing, use parent artifact commit evidence from `StackBaseContext` or by reloading the artifact registry/stack state.
  - If that commit is an ancestor of the trunk integration ref, set the effective base to trunk, set `baseRepairReason: 'parent-artifact-already-integrated'`, and run `provider.retargetBranch(mergeWorktreePath, branch, trunk)`.
  - If ancestry fails, the commit is unavailable, or the remote query fails for reasons other than not-found, mark landing failed with a reason naming the missing base and the proof that was unavailable.

### Workflow ordering

- Emit the existing `stack:landing:update` started event and persist `status: 'started'` as before.
- Use the effective base for `provider.trackBranch`.
- Emit `stack:provider:command` for the retarget command when repair runs.
- Preserve cleanup before final restack so cleanup commits remain in the submitted branch.
- Run a final pre-submit remote-base check after cleanup/restack. If that check repairs the base, retarget and restack again before submit.
- Do not call `provider.submitBranch` after an unsafe missing-base failure.

### Metadata

- Add optional landing metadata to completed and failed `stack:landing:update` events when a base decision was made:
  - `originalBaseBranch`: the first resolved/recorded parent base.
  - `effectiveBaseBranch`: the base passed to git-spice submit.
  - `baseRepairReason`: `parent-artifact-already-integrated` when trunk collapse occurred.
- Persist the same fields in `StackLayerLanding` on complete and failed landing records.
- Existing stack landing events without the fields must continue to parse and project.
- Auto-merge events must use the effective base branch.
- PR metadata rendered after preflight must show the effective base branch.

## Verification

- [ ] Child stacked landing with an existing remote parent base calls `trackBranch` with the parent base and never calls `retargetBranch`.
- [ ] Child stacked landing with a missing remote parent base and parent commit ancestor of `origin/main` calls `retargetBranch` with `branch onto main --branch=<child-branch>` before submit.
- [ ] The repaired landing path emits a `stack:provider:command` event for the retarget command with the provider's command metadata.
- [ ] The repaired landing path persists `originalBaseBranch`, `effectiveBaseBranch: 'main'`, and `baseRepairReason: 'parent-artifact-already-integrated'` in `.eforge/stacks/layers.json`.
- [ ] The repaired landing path emits a complete `stack:landing:update` event containing the same optional metadata.
- [ ] Child stacked landing with a missing remote parent base and parent commit not ancestor of trunk emits a failed `stack:landing:update` event, records landing status `failed`, and does not call `submitBranch`.
- [ ] Repaired PR metadata contains `Base branch: \`main\`` and does not contain the stale parent branch in the base-branch metadata line.
- [ ] Repaired auto-merge start/complete/skipped events use `baseBranch: 'main'`.
- [ ] Old `stack:landing:update` payloads without repair fields still pass `safeParseEforgeEvent`.
- [ ] Targeted tests pass: `pnpm vitest run test/stack-runtime-landing.test.ts test/stack-events.test.ts packages/client/src/__tests__/events-wire-parity.test.ts`.