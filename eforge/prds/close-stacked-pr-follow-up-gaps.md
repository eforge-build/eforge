---
title: Close Stacked PR Follow-up Gaps
created: 2026-05-24
profile: gpt-claude-combo
landing: pr
---

# Close Stacked PR Follow-up Gaps

## Problem / Motivation

This work closes residual gaps found after comparing `.eforge/session-plans/2026-05-23-stack-support-follow-ups.md` against the current codebase.

**Classification:** architecture / deep. The remaining work is smaller than the original stacked-PR follow-up, but still crosses engine artifact semantics, generated docs, Pi/Claude integration text, and user-facing vocabulary. Confidence: high.

### Validated current state

- The follow-up implementation landed substantial core behavior:
  - Provider-neutral artifact registry: `packages/engine/src/artifacts/registry.ts`
  - Artifact-aware queue scheduling: `packages/engine/src/queue/scheduler.ts`, `packages/engine/src/eforge.ts`
  - Dependency validation through artifact lookup: `packages/engine/src/prd-queue.ts`
  - Stack layer landing status transitions: `packages/engine/src/stacking/state.ts`, `packages/engine/src/stacking/landing.ts`
  - Cleanup-before-git-spice-submit via shared `runCleanup()`: `packages/engine/src/landing.ts`
- Targeted validation passed locally:

  ```bash
  pnpm vitest run test/artifact-registry.test.ts test/artifact-aware-scheduler.test.ts test/stack-artifact-recording.test.ts test/stack-runtime-landing.test.ts test/stack-landing-cleanup.test.ts test/stack-base-resolver.test.ts test/onsuccess-config.test.ts test/prd-frontmatter-onsuccess.test.ts test/playbook-api.test.ts
  ```

  Passed 131 tests.

- `pnpm docs:check` passed, but that only proves generated docs match the generator; the generator itself still contains stale compatibility claims.
- `docs/roadmap.md` preserves future stacked-PR work for automated post-merge restack/sync and additional providers. This gap-close should not implement that roadmap item.

### Remaining gaps with evidence

1. **Generated/reference docs still claim old `build.onSuccess` compatibility.**
   - `packages/docs-gen/src/generators/config.ts` says legacy `build.onSuccess` is kept for backward compatibility and emits deprecation warnings.
   - Generated copies repeat this in:
     - `web/content/reference/config.md`
     - `web/public/reference/config.md`
     - `web/public/llms-full.txt`
   - Runtime contradicts this: `packages/engine/src/config.ts` rejects `build.onSuccess` with migration guidance.

2. **Init skills still say init cannot persist stacking config.**
   - `packages/pi-eforge/skills/eforge-init/SKILL.md` and `eforge-plugin/skills/init/init.md` tell users the init tool does not persist stacking config and that stacking must be set separately via config.
   - Tool implementations contradict this:
     - `packages/eforge/src/cli/mcp-proxy.ts`
     - `packages/pi-eforge/extensions/eforge/index.ts`
   - These implementations accept `stackingEnabled` / `gitSpiceCommand` and write `configData.stacking`.

3. **Legacy landing vocabulary remains in user-facing text and some type names.**
   - `packages/eforge/src/cli/interactive.ts` prints `merge-to-base-branch` and `issue-pr` in the trunk landing prompt.
   - `packages/pi-eforge/extensions/eforge/landing-policy.ts` descriptions and comments mention `issue-pr`, `merge-to-base-branch`, and `leave-branch`.
   - `packages/pi-eforge/extensions/eforge/trunk-landing.ts` names the canonical `pr|merge|leave` type `BuildOnSuccess`.
   - `packages/eforge/src/cli/mcp-proxy.ts`, `packages/pi-eforge/extensions/eforge/index.ts`, Pi skills, Claude plugin skills, and docs/config samples still include old-value wording in descriptions/comments.

4. **Artifact records can become stale after cleanup/landing.**
   - `recordArtifact()` in `packages/engine/src/orchestrator/phases.ts` writes `commitSha` before `finalize()` / `executeStackLanding()` cleanup runs.
   - `runCleanup()` commits cleanup changes on the artifact branch, so `.eforge/artifacts/builds.json` can record a pre-cleanup SHA while the artifact branch points at a later cleanup commit.
   - The registry schema currently has no landing/PR URL fields and is not updated after landing completion/failure.

5. **Completed-without-artifact dependency errors are not fully distinguishable.**
   - `validateDependsOnExists()` distinguishes active queue items, failed/skipped terminal files, and durable artifacts.
   - Completed PRD files are removed by `cleanupCompletedPrd()` rather than retained in a completed directory or durable completion index.
   - Therefore a previously completed PRD with no artifact is usually indistinguishable from an unknown dependency.
   - The original acceptance criterion wanted unknown dependencies and known dependencies without usable artifacts to produce distinct errors.

### Main Refresh Check, 2026-05-24

Main was rechecked after the latest updates, `b90830fc`, including the hardening/validation-gates work. The plan remains valid, but implementation should account for these refreshed facts:

- **Committed-state invariant is now stronger.**
  - `recordArtifact()` rejects dirty merge worktrees before writing `.eforge/artifacts/builds.json`.
  - Docs now state validation / PRD validation / artifact recording operate on committed `HEAD`.
  - Artifact post-landing finalization must preserve this invariant: refresh `commitSha` only from a clean, committed artifact branch/merge worktree after cleanup commits have landed.

- **PRD provenance artifacts were added, but are not a substitute completion index.**
  - `materializePrdArtifact()` writes `eforge/prds/{prdId}.md`.
  - Cleanup is currently wired with `cleanupPrdFilePath`.
  - Completion diagnostics should not rely on `eforge/prds/` as durable terminal-state truth unless retention semantics are intentionally changed.
  - Prefer the planned minimal completion index for completed-without-artifact diagnostics.

- **Dependency diagnostics were partially hardened.**
  - `validateDependsOnExists()` already distinguishes `failed/` and `skipped/` terminal items from unknown ids and gives terminal-without-artifact precedence over stale artifacts.
  - The remaining gap is specifically known **completed** ids without usable artifacts, because completed queue files are still removed.

- **Generated docs and integration guidance remain stale.**
  - The `build.onSuccess` compatibility text in `packages/docs-gen/src/generators/config.ts` and generated references is still present.
  - Pi/Claude init guidance still says stacking config cannot be persisted by init.

No scope expansion is needed beyond preserving these newer invariants and not using the new PRD provenance file as the completion index by accident.

### Risks

- **Accidentally reintroducing compatibility aliases:** broad search/replace could weaken clean-break behavior.
  - Mitigation: keep old strings only in migration tests/messages and API-version history; tests should still assert rejection.
- **Artifact registry race/staleness:** post-landing registry updates must not erase the pre-landing usable record or corrupt concurrent queue reads.
  - Mitigation: reuse registry lock/upsert patterns and write targeted tests.
- **Dependency completion index ambiguity:** a known terminal id with an old artifact from a previous run must not incorrectly satisfy dependencies if the current terminal state is failed/skipped.
  - Mitigation: define precedence explicitly; failed/skipped terminal states block, usable artifact only satisfies when not superseded by terminal failure state.
- **Docs drift:** generated references can pass drift checks while containing stale generator text.
  - Mitigation: update generator source and inspect generated output for the corrected language.
- **Consumer drift:** Pi and Claude plugin docs can diverge.
  - Mitigation: update both directories in the same change and bump plugin version.
- **Over-cleaning old strings:** some old literals are still valid historical/migration test data or wire history comments.
  - Mitigation: audit occurrences rather than enforce zero hits.

## Goal

Close the shipped stacked-PR workflow gaps by aligning generated/user-facing documentation with runtime behavior, cleaning legacy landing vocabulary, ensuring artifact registry metadata converges after cleanup/landing, and distinguishing completed-without-artifact dependencies from unknown dependencies.

Preserve existing runtime clean-break behavior for `build.onSuccess` and old landing values, keep artifact readiness available before landing/publication, and do not implement future automated post-merge restack/sync or additional providers.

## Approach

### Early assumptions / unknowns

- Assumption: fixing generated/reference docs and skill text is in scope even though it is not runtime behavior.
  - Evidence: the prior session explicitly included docs/skills/generated references as acceptance criteria.
  - Confidence: high.
- Assumption: artifact registry should be updated after cleanup/landing rather than moving artifact recording later.
  - Evidence: the prior architecture required artifact records before landing/publication so dependents do not rely on PR creation/merge side effects.
  - Confidence: high.
- Assumption: a minimal completed-build index is preferable to preserving completed PRD queue files.
  - Evidence: current queue cleanup removes completed PRD files by design; changing that would alter runtime queue hygiene.
  - Confidence: medium/high.

### Architecture impact

The remaining runtime architecture impact is focused on **artifact metadata finalization** and **dependency provenance**.

#### Artifact registry lifecycle

Current lifecycle:

1. Build validates.
2. `recordArtifact()` writes `.eforge/artifacts/builds.json` with current `HEAD`.
3. Stack/generic landing runs.
4. Cleanup may commit on the artifact branch.
5. PR submission/merge/leave completes or fails.

Problem: step 4 can make the stored `commitSha` stale, and step 5 is not reflected in the provider-neutral registry.

Target lifecycle:

1. Build validates.
2. `recordArtifact()` writes a usable pre-landing artifact record before publication begins.
3. Cleanup/landing runs.
4. A finalization/update helper refreshes the registry with the branch's final `HEAD` and optional landing metadata.

The registry remains the dependency-readiness source of truth. A dependent can become ready as soon as the pre-landing artifact exists, but the record should converge to the final branch metadata once cleanup/landing completes.

#### Completed dependency diagnostics

Current validation can only identify completed dependencies when a usable artifact exists. It needs a durable way to know that an id is known but lacks a usable artifact.

Target design options:

- Preferred: add a small `.eforge/artifacts/completions.json` or equivalent completion index keyed by PRD id. Record terminal outcomes for queued builds with fields like `prdId`, `status`, `completedAt`, and optional `artifactAvailable` / `artifactBranch`.
- Alternative: extend `builds.json` with non-usable statuses. This is less clean because the current schema intentionally records only successful usable artifacts.

The preferred approach keeps `.eforge/artifacts/builds.json` as the usable artifact registry and uses a separate completion index only for diagnostics/provenance.

#### Public/API impact

No new public daemon API is required unless artifact metadata is exposed. Existing request bodies and CLI flags should remain canonical `landingAction` / `--landing-action` only.

The docs generator and skills are user-facing integration surfaces and must be kept in sync with actual runtime behavior.

### Design decisions

1. **Do not restore `onSuccess` compatibility.**
   - Keep runtime clean-break behavior.
   - Stale docs should be corrected to match runtime, not vice versa.

2. **Keep artifact readiness pre-landing, but finalize registry metadata after cleanup/landing.**
   - This preserves early downstream readiness while avoiding stale commit metadata.
   - Registry writes should be idempotent and safe on landing failure.

3. **Separate usable artifacts from completion diagnostics.**
   - `builds.json` remains a registry of usable build artifacts.
   - A minimal completion index or equivalent durable marker records known terminal ids that lack usable artifacts.
   - This avoids making failed/skipped/no-artifact builds look like dependency-ready artifacts.

4. **Treat legacy landing vocabulary as migration-only.**
   - Allowed remaining occurrences: migration error messages, tests that assert rejection, API-version changelog/history, and generated schemas that intentionally preserve historical event literals if still valid.
   - Active prompts/descriptions should use only `pr`, `merge`, `leave`.

5. **Update both Pi and Claude integration packages.**
   - Per `AGENTS.md`, consumer-facing changes must keep `packages/pi-eforge/` and `eforge-plugin/` in sync.
   - Bump `eforge-plugin/.claude-plugin/plugin.json` if plugin files change.

6. **Use generated docs as source-driven artifacts.**
   - Fix generator source first, then run docs generation/checks.
   - Do not hand-edit generated reference copies without updating the generator.

### Code impact

Likely changes:

#### Generated docs / docs source

- `packages/docs-gen/src/generators/config.ts`
  - Replace backward-compatibility/deprecation language with clean-break migration language.
  - Avoid suggesting `command: gs` as normal guidance; mention aliases only as optional and non-default if retained.
- Regenerated:
  - `web/content/reference/config.md`
  - `web/public/reference/config.md`
  - `web/public/llms-full.txt`
  - Any other artifacts touched by `pnpm docs:generate`.
- Hand-authored docs to audit/update:
  - `docs/config.md`
  - `docs/stacking.md`
  - `web/content/docs/configuration.md`
  - `web/content/docs/stacking.md`

#### Pi / Claude integration text

- `packages/pi-eforge/skills/eforge-init/SKILL.md`
- `eforge-plugin/skills/init/init.md`
  - Remove false “tool does not persist stacking config” instructions.
  - Include `stackingEnabled` and `gitSpiceCommand` in tool-call examples when the user opts into stacking.
- `packages/pi-eforge/skills/eforge-config/SKILL.md`
- `eforge-plugin/skills/config/config.md`
  - Clean old landing wording in comments.
- `eforge-plugin/.claude-plugin/plugin.json`
  - Bump version if plugin docs are edited.

#### CLI / Pi prompt vocabulary

- `packages/eforge/src/cli/interactive.ts`
  - Replace prompt text with canonical `merge` / `pr` wording.
- `packages/pi-eforge/extensions/eforge/landing-policy.ts`
  - Replace descriptions/comments with canonical terms.
- `packages/pi-eforge/extensions/eforge/trunk-landing.ts`
  - Rename `BuildOnSuccess` type to `LandingAction` or `LandingActionValue` and update imports in:
    - `packages/pi-eforge/extensions/eforge/index.ts`
    - `packages/pi-eforge/extensions/eforge/landing-gate.ts`
    - `packages/pi-eforge/extensions/eforge/landing-policy.ts`
    - `packages/pi-eforge/extensions/eforge/playbook-commands.ts`
- `packages/eforge/src/cli/mcp-proxy.ts`
- `packages/pi-eforge/extensions/eforge/index.ts`
  - Clean descriptions for `landingAction`, `allowLocalMergeToTrunk`, and stacking options.

#### Artifact registry finalization

- `packages/engine/src/artifacts/registry.ts`
  - Add update helper(s), e.g. `updateArtifactLanding()` / `refreshArtifactCommitSha()`.
  - Consider optional fields: `landingStatus`, `prUrl`, `landingCompletedAt`, `landingFailureReason`.
- `packages/engine/src/orchestrator/phases.ts`
  - After generic landing or stack landing, refresh artifact metadata when `ctx.prdId` exists.
  - Ensure cleanup-induced commits are reflected in `commitSha`.
  - On landing failure, record non-ready landing metadata without removing the usable artifact record.
- `packages/engine/src/stacking/landing.ts` / `packages/engine/src/landing.ts`
  - Return or surface enough metadata for registry finalization: PR URL, commit SHA, failure reason.

#### Completed/no-artifact diagnostics

- New module or extension near `packages/engine/src/artifacts/`, e.g. `completion-registry.ts`.
- `packages/engine/src/eforge.ts` and/or `packages/engine/src/queue/scheduler.ts`
  - Record terminal queued PRD outcomes in the completion index.
- `packages/engine/src/prd-queue.ts`
  - Update `validateDependsOnExists()` to use the completion index for known completed/no-artifact diagnostics.

#### Tests

- Artifact registry tests for post-cleanup SHA refresh and landing metadata.
- Queue dependency validation tests for known completed/no-artifact vs unknown.
- CLI/Pi vocabulary tests where existing tests cover menu models or prompts.
- Docs generator test or snapshot if available; otherwise `pnpm docs:check` after regeneration.

### Documentation impact

Update or regenerate:

- `packages/docs-gen/src/generators/config.ts`
- `web/content/reference/config.md`
- `web/public/reference/config.md`
- `web/public/llms-full.txt`
- `docs/config.md`
- `docs/stacking.md`
- `web/content/docs/configuration.md`
- `web/content/docs/stacking.md`
- `packages/pi-eforge/skills/eforge-init/SKILL.md`
- `packages/pi-eforge/skills/eforge-config/SKILL.md`
- `eforge-plugin/skills/init/init.md`
- `eforge-plugin/skills/config/config.md`

Docs should state:

- `landing.action` / `landingAction` are the only active landing vocabulary.
- `build.onSuccess`, PRD `onSuccess`, and old full-string landing values are rejected with migration guidance.
- `eforge_init` can persist stacking settings through `stackingEnabled` and `gitSpiceCommand`.
- `git-spice` is the canonical command; `gs` is only an optional user alias if explicitly configured.
- Automated restack/sync remains deferred roadmap work.

### Assumptions and validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|---|---|---:|---:|---|---|
| Runtime should remain a clean break; do not restore `onSuccess` aliases. | Prior session recorded explicit user decision; current runtime and tests reject old fields. | High | Low | Keep existing rejection tests passing. | If wrong, users with old configs would need compatibility, but user explicitly rejected deprecation. |
| Docs generator is the source of stale generated reference text. | `packages/docs-gen/src/generators/config.ts` contains the stale backward-compatibility text; `pnpm docs:check` passes because generated files match it. | High | Low | Update generator, regenerate, inspect output. | If wrong, stale text could reappear from another source. |
| Init tools now persist stacking config. | Verified code in `packages/eforge/src/cli/mcp-proxy.ts` and `packages/pi-eforge/extensions/eforge/index.ts` writes `configData.stacking`. | High | Low | Add/update tests or run init dry-path if available. | If wrong, skill docs would instruct users to rely on unsupported fields. |
| Cleanup can change artifact branch HEAD after `recordArtifact()`. | `recordArtifact()` runs before stack/generic landing; `runCleanup()` commits cleanup changes later. | High | Medium | Write an integration/unit test with cleanup enabled and assert registry SHA equals final HEAD. | If wrong, registry finalization work may be unnecessary, but current ordering strongly suggests staleness. |
| A separate completion index is better than retaining completed PRD files. | Current queue cleanup removes completed PRD files; artifact registry intentionally records usable artifacts only. | Medium/High | Medium | Implement minimal index and test diagnostics; compare complexity with retaining files. | If wrong, added runtime state may be unnecessary or complicate queue recovery. |
| Automated restack/sync remains out of scope. | `docs/roadmap.md` lists it as future work requiring webhook/polling. | High | Low | Preserve roadmap text and avoid daemon automation changes. | If wrong, this plan would leave a larger workflow gap. |

No low-confidence/high-impact assumptions remain unresolved. The main design choice with medium confidence — separate completion index vs queue file retention — has a low-risk validation path during implementation.

### Profile signal

**Recommended profile:** Excursion.

**Rationale:** The work is cross-cutting, but it is cohesive and bounded: docs/source cleanup, integration vocabulary cleanup, artifact registry finalization, and dependency diagnostics. A single planner can enumerate the implementation sequence and tests. Expedition is not needed because there are not multiple independently planned subsystems requiring delegated module plans.

## Scope

### In scope

1. **Fix stale generated/reference documentation**
   - Update `packages/docs-gen/src/generators/config.ts` to say `build.onSuccess` is removed and rejected, not deprecated/backward-compatible.
   - Regenerate docs so `web/content/reference/config.md`, `web/public/reference/config.md`, `web/public/llms-full.txt`, and related generated artifacts match.

2. **Fix stale Pi and Claude init skill guidance**
   - Update `packages/pi-eforge/skills/eforge-init/SKILL.md` and `eforge-plugin/skills/init/init.md` to say `eforge_init` can persist `stackingEnabled` and `gitSpiceCommand`.
   - Ensure examples pass those fields when the user opts into stacking.

3. **Clean remaining user-facing landing vocabulary**
   - Replace old-value wording, `issue-pr`, `merge-to-base-branch`, and `leave-branch`, in active prompts, descriptions, skills, and config comments with `pr`, `merge`, and `leave`.
   - Rename misleading internal integration type aliases such as `BuildOnSuccess` to `LandingAction` or `LandingActionValue` where practical.
   - Keep old strings only in intentional migration-error messages, API-version history, and tests that assert rejection of old values.

4. **Make artifact registry metadata coherent after cleanup/landing**
   - Add registry support for post-record updates, at minimum updating `commitSha` after cleanup if cleanup changed the branch.
   - Add optional landing metadata fields if useful:
     - `landingStatus`
     - `prUrl`
     - `landingCompletedAt`
     - `landingFailureReason`
   - Preserve the invariant that a usable artifact record exists before landing/publication starts.

5. **Improve completed-without-artifact dependency diagnostics**
   - Add a minimal durable completed-build/completion index, or extend artifact registry semantics to record known terminal completions without usable artifacts.
   - Update `validateDependsOnExists()` to distinguish:
     - Unknown dependency id
     - Known completed dependency without usable artifact
     - Failed/skipped terminal dependency
     - Completed dependency with usable artifact
   - Avoid changing queue behavior to retain completed PRD files unless clearly necessary.

6. **Validation and tests**
   - Add or update tests for:
     - Docs generator wording
     - Init skill/tool guidance where testable
     - Artifact registry post-cleanup/landing update behavior
     - Dependency diagnostic distinction
   - Run:
     - `pnpm docs:generate`
     - `pnpm docs:check`
     - `pnpm type-check`
     - Targeted tests

### Out of scope

- Implementing automated post-merge restack/sync. This remains future roadmap work.
- Adding gh-stack, Graphite, native stack providers, or provider abstractions beyond the existing git-spice provider.
- Reintroducing compatibility aliases for `onSuccess` or old full-string landing values.
- Large monitor UI redesign. Only update UI/types if new artifact metadata is exposed there.
- Reworking queue storage to keep all completed PRD files unless the minimal completion index proves inadequate.

### Roadmap relation

This is polish/completion work for the shipped stacked PR workflow. Preserve `docs/roadmap.md` future items for automated post-merge restack/sync and additional providers.

## Acceptance Criteria

### Docs and skills

- Generated config reference no longer says `build.onSuccess` is backward-compatible or deprecated.
- Generated and hand-authored docs say old landing fields/values are rejected with migration guidance.
- Pi and Claude init skills correctly state that init can persist `stackingEnabled` and `gitSpiceCommand`.
- Active prompts/descriptions use `pr`, `merge`, and `leave`, not `issue-pr`, `merge-to-base-branch`, or `leave-branch`.
- `git-spice` remains the canonical documented command; `gs` appears only as an optional explicitly configured alias if mentioned.
- Plugin version is bumped if any `eforge-plugin/` file changes.

### Artifact registry

- Successful queued builds still create a usable artifact record before landing/publication begins.
- After cleanup/landing, the artifact registry's `commitSha` matches the final artifact branch `HEAD`.
- PR landing records PR URL and terminal landing status when available, or at minimum does not leave stale pre-cleanup metadata.
- Landing failure can be represented without making the artifact unusable for dependency readiness unless the build/artifact itself failed.
- Tests cover non-stacked and stacked builds with cleanup enabled.

### Dependency diagnostics

- `validateDependsOnExists()` accepts active queue/waiting dependencies and completed dependencies with usable artifacts.
- It rejects unknown dependency ids with an “unknown” message.
- It rejects known completed/no-artifact ids with an “artifact” message distinct from unknown ids.
- Failed/skipped terminal dependencies still block, even if an old artifact record exists.

### Validation

- `pnpm docs:generate` run after doc generator/source changes.
- `pnpm docs:check` passes.
- `pnpm type-check` passes.
- Targeted tests for artifact registry, scheduler/dependency validation, landing vocabulary, stack landing cleanup/status, and docs/plugin surfaces pass.
