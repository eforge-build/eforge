---
title: Close Follow-Up Gaps in Git-Spice Stacked PR Support
created: 2026-05-24
profile: gpt-claude-combo
---

# Close Follow-Up Gaps in Git-Spice Stacked PR Support

## Problem / Motivation

A recently merged cross-cutting stacked PR implementation provides the core happy path, but a manual review against `.eforge/session-plans/2026-05-23-git-spice-stacking-support.md` found eight follow-up gaps:

1. Artifact semantics are stack-only.
2. Completed artifact dependencies are not accepted as dependency targets.
3. Legacy `onSuccess` remains central.
4. Stack layer status does not reflect landing completion/failure.
5. Stacked git-spice PR landing bypasses generic cleanup.
6. Docs/skills still mention `gs` and stale init guidance.
7. Docs use ASCII branch diagrams instead of Mermaid.
8. Sync/restack is adapter-only rather than clearly surfaced as a deferred lifecycle capability.

**Classification:** architecture / deep.  
**Confidence:** high.

### Evidence From Code Inspection

- Artifact-aware scheduling is currently gated on `config.stacking.enabled` in `packages/engine/src/queue/scheduler.ts` and the legacy queue path in `packages/engine/src/eforge.ts`.
- Artifact recording only occurs through `recordArtifact(ctx)` when `ctx.stackContext` exists in `packages/engine/src/orchestrator/phases.ts`.
- Completed dependencies cannot be referenced by `depends_on` unless they still exist in pending/running/waiting queue files.
- `validateDependsOnExists()` in `packages/engine/src/prd-queue.ts` checks root queue and `waiting/` only, not durable artifact state.
- `landing.action` exists in config, but runtime and integration boundaries still primarily pass `onSuccess`:
  - `packages/engine/src/events.ts`
  - `packages/engine/src/eforge.ts`
  - `packages/eforge/src/cli/*`
  - `packages/eforge/src/cli/mcp-proxy.ts`
  - `packages/pi-eforge/extensions/eforge/index.ts`
  - Claude/Pi skill docs
- Stack state is persisted in `.eforge/stacks/layers.json` through `packages/engine/src/stacking/state.ts`, but `updateStackLayerLanding()` updates only the `landing` field and `updatedAt`; it does not advance `StackLayer.status`.
- `markStackLayerFailed()` exists but is not used outside tests.
- For stacked PRs, `stackLanding(ctx)` submits with git-spice and sets `ctx.landingSucceeded`; `finalize(ctx)` then skips `executeLandingAction()`.
- Generic cleanup before PR creation lives in `packages/engine/src/landing.ts`, so stacked PRs do not run the same cleanup path.
- Stale `gs`/init guidance appears in:
  - `eforge/config.yaml`
  - `docs/stacking.md`
  - `web/content/docs/stacking.md`
  - `packages/pi-eforge/skills/eforge-init/SKILL.md`
  - `eforge-plugin/skills/init/init.md`
  - config skills
- A search accidentally invoked shell command substitution for backticked `gs`, confirming this should be corrected carefully with quoted search patterns during implementation.
- `docs/roadmap.md` already has a future **Stacked PRs** section for automated post-merge restack/sync and future providers. This work should preserve that future-facing roadmap item rather than implementing webhook/polling automation now.

### Baseline Validation Already Performed

- `pnpm type-check` passed.
- Targeted stack/landing tests passed:
  - 133 tests across stack config/state/provider/runtime/base/artifact/landing/event tests.

These checks validate current baseline health but do not validate the proposed follow-up changes.

## Goal

Finish the stacked PR architecture by making artifact metadata and dependency readiness universal for queued builds, correcting stack landing lifecycle state, sharing cleanup before git-spice PR submission, and completing the clean breaking migration from legacy `onSuccess` vocabulary to canonical landing vocabulary.

The final system should use `landing.action` / `landingAction` everywhere, record durable artifacts for every successful queued build, allow completed artifact dependencies, expose coherent monitor-visible stack state, and keep automated sync/restack clearly documented as future work.

## Approach

### Core Design Decisions

1. **Clean-break landing vocabulary**
   - Remove legacy `onSuccess` / `build.onSuccess` instead of deprecating or aliasing it.
   - Old config fields, PRD frontmatter, request body keys, tool parameters, and CLI flags must fail validation with migration guidance.

2. **Use shorthand landing actions everywhere**
   - Canonical values are:
     - `pr`
     - `merge`
     - `leave`
   - Replace legacy full-string union types and conversion helpers with one canonical landing action type.

3. **Add a provider-neutral artifact registry**
   - Introduce an engine-owned artifact registry, e.g. `.eforge/artifacts/builds.json` or equivalent typed runtime projection.
   - Stack state remains topology/provider visibility state, not the source of truth for dependency readiness.

4. **Make artifact readiness universal for queued dependencies**
   - Every successful queued build records an artifact.
   - `depends_on` readiness is based on artifact availability, regardless of whether stacking is enabled.

5. **Permit dependencies on completed artifacts**
   - `validateDependsOnExists()` should accept dependencies that are active queue/waiting items or completed PRDs with durable artifact records.

6. **Update stack layer state as part of landing persistence**
   - `landing.status: complete` plus layer `status: built` is ambiguous.
   - Landing updates should also update layer status atomically.

7. **Treat stacked PR cleanup as pre-publication cleanup**
   - Cleanup should run once before `git-spice branch submit`.
   - Generic finalize must not create a duplicate PR after successful git-spice submission.

8. **Use canonical `git-spice` in docs and examples**
   - Use commands like:
     - `git-spice repo init`
     - `git-spice stack restack`
   - Mention `gs` only as an optional user alias, not configuration guidance.

9. **Leave automated sync/restack as roadmap future work**
   - Preserve adapter support and tests for sync/restack commands.
   - Do not implement daemon webhook/polling automation.

10. **Use Mermaid diagrams in docs**
    - Convert stack topology diagrams from ASCII to Mermaid.

### Artifact Model

Current state is stack-specific: stack layers carry artifact refs in `.eforge/stacks/layers.json`, and scheduler readiness consults those refs only when `stacking.enabled` is true.

Target state:

- Add an engine-owned artifact registry for queued build outputs.
- Record artifact metadata for every successful queued PRD build:
  - `prdId`
  - plan set / artifact branch, such as `eforge/<prd-id>` or explicit plan set name
  - resolved base branch/ref
  - commit SHA
  - landing action
  - optional PR URL / landing state if available
  - timestamps and status
- Treat stack layer state as stack topology/visibility state.
- For stacked builds, stack layer artifact data may be mirrored from the artifact registry to avoid breaking existing monitor UI.
- The dependency scheduler should depend on the artifact registry.

### Queue / Dependency Semantics

Target flow:

1. On successful queued build validation, eforge records an artifact before landing/publication.
2. A dependent PRD is ready only when all dependencies have available artifacts and none are failed/skipped/blocked.
3. Active in-queue dependencies still use in-memory state while they run.
4. Completed dependencies can be satisfied by durable artifact records even after their PRD file has left the queue.
5. Failed/skipped dependencies block dependents by default.

Dependency validation changes from:

> Must exist in active queue/waiting

to:

> Must exist in active queue/waiting OR have a durable artifact record.

### Landing Vocabulary — Clean Break

Target architecture removes old vocabulary from active surfaces:

- Config: use `landing.action: pr|merge|leave`; remove `build.onSuccess`.
- PRD frontmatter: use canonical landing vocabulary only.
- CLI: keep `--landing-action pr|merge|leave`; remove `--on-success`.
- Daemon/client/API/tool bodies: accept `landingAction`, not `onSuccess`.
- Engine internals: use canonical landing action values.
- Validation: old fields/flags fail with actionable migration errors, not silent mapping.

### Stack Landing Lifecycle

Stack state should reflect lifecycle transitions coherently:

- Artifact recorded: `status: built`
- PR landing started: landing status `started`; layer status may remain `built` or become a clear transitional state if schema supports it.
- PR landing complete: layer `status: landed` and landing `status: complete`
- Direct merge landing complete: layer `status: merged` or `landed` with landing `status: complete`
- Leave landing complete: layer `status: landed` with landing `status: complete`
- Provider/build/landing failure: layer `status: failed` with landing failure reason where applicable

Any schema changes must be reflected in:

- `packages/client/src/events.schemas.ts`
- monitor UI reducer/types
- stack state validation
- tests

### Cleanup / Landing Phase Ordering

To keep cleanup behavior consistent without duplicate publication:

- Extract cleanup into a reusable helper or phase.
- Run cleanup before both generic PR creation and git-spice submission.
- Run cleanup before `git-spice branch submit` when `cleanupPlanFiles` is enabled.
- Preserve duplicate-PR guard:
  - Do not run `gh pr create` after git-spice successfully submitted the PR.

### Code Impact

#### Landing vocabulary clean break

- `packages/engine/src/config.ts`
  - Remove `build.onSuccess` from accepted schema/resolved config.
  - Keep `landing.action` only.
  - Replace or remove mapping helpers:
    - `landingActionToOnSuccess`
    - `onSuccessToLandingAction`
  - Add migration/validation errors for old `build.onSuccess`.

- `packages/engine/src/events.ts`
- `packages/engine/src/eforge.ts`
- `packages/engine/src/orchestrator.ts`
- `packages/engine/src/orchestrator/phases.ts`
- `packages/engine/src/landing.ts`
  - Replace legacy full-string `LandingAction` with canonical `pr|merge|leave` in build options and phase context.
  - Update landing event payloads if necessary.
  - Prefer canonical action values.

- `packages/engine/src/prd-queue.ts`
  - Remove PRD frontmatter `onSuccess`.
  - Keep or rename canonical landing frontmatter.
  - Enqueue serialization should write canonical landing only.

- CLI/API/tools:
  - `packages/eforge/src/cli/index.ts`
  - `packages/eforge/src/cli/run-or-delegate.ts`
  - `packages/eforge/src/cli/landing-options.ts`
  - `packages/eforge/src/cli/mcp-proxy.ts`
    - Remove `--on-success` and `onSuccess` params.
    - Keep `--landing-action` / `landingAction`.

  - `packages/client/src/api/*`
  - `packages/client/src/routes.ts`
  - `packages/monitor/src/server.ts`
    - Change request/response bodies from `onSuccess` to `landingAction` where applicable.

  - `packages/pi-eforge/extensions/eforge/index.ts`
  - `packages/pi-eforge/extensions/eforge/landing-gate.ts`
  - `packages/pi-eforge/extensions/eforge/playbook-commands.ts`
    - Use `landingAction` throughout tool schemas and request bodies.

  - `eforge-plugin/skills/*`
  - `packages/pi-eforge/skills/*`
    - Update skill instructions.
    - Bump `eforge-plugin/.claude-plugin/plugin.json` version.

#### Engine artifact/dependency core

- New module: `packages/engine/src/artifacts/` or similar
  - Artifact registry schema/load/save/upsert/lookup helpers.
  - Tests analogous to `test/stack-state.test.ts`.

- `packages/engine/src/orchestrator/phases.ts`
  - Generalize artifact recording so successful queued builds record provider-neutral artifacts, not only `ctx.stackContext` builds.
  - Preserve stack layer event/projection for stacked builds.

- `packages/engine/src/orchestrator.ts`
- `packages/engine/src/eforge.ts`
  - Ensure `prdId`, artifact branch, base branch, and landing action are available to artifact recording for all queued PRD builds.

- `packages/engine/src/prd-queue.ts`
  - Update `validateDependsOnExists()` to accept active queue/waiting items OR durable artifact records.
  - Update `unblockWaiting()` to use artifact registry rather than stack state.

- `packages/engine/src/queue/scheduler.ts`
- Legacy queue path in `packages/engine/src/eforge.ts`
  - Replace `artifactAwareDependencies() => config.stacking.enabled` with unconditional artifact readiness for queued dependencies where durable artifact metadata is expected.
  - Add tests for stacking disabled and enabled.

#### Stack state / landing lifecycle

- `packages/engine/src/stacking/state.ts`
  - Add an atomic helper that updates landing and layer status together.
  - Use or remove currently-unused `markStackLayerFailed()`.

- `packages/engine/src/stacking/landing.ts`
  - Mark layer landed/failed appropriately after provider submit.
  - Run shared cleanup before `provider.trackBranch` / `provider.submitBranch` or at least before submit.

- `packages/engine/src/landing.ts`
  - Extract reusable cleanup helper from local `runCleanup()` so stacked landing can share it.
  - Preserve generic PR/merge/leave behavior using canonical action values.

- `packages/client/src/events.schemas.ts`
  - Update stack/artifact event schemas if new artifact events/API are introduced or stack layer statuses change.

#### API / daemon / monitor

- `packages/client/src/routes.ts`
- `packages/client/src/api/*`
  - If artifact registry is exposed, add route/types/helpers using `API_ROUTES`.
  - Use preferred `landingAction` in enqueue/playbook/init route bodies.

- `packages/monitor/src/server.ts`
  - Use shared artifact/stack projection helpers if adding artifact snapshots.
  - Update body parsing/validation for preferred landing vocabulary only.

- `packages/monitor-ui/*`
  - Adjust stack card/reducer tests for layer `status` transitions.
  - Add artifact visibility only if required by acceptance criteria.
  - Otherwise stack UI can remain focused on stack layers.

#### Docs / generated artifacts

Update:

- `docs/stacking.md`
- `docs/architecture.md`
- `docs/roadmap.md` if wording needs adjustment
- `README.md` if behavior summary changes
- `web/content/docs/stacking.md`
- `web/content/docs/configuration.md`
- generated reference docs
- `eforge/config.yaml`

Run:

```bash
pnpm docs:generate
```

or the relevant docs check after docs/reference changes.

### Tests to Add / Update

- Old `onSuccess` / `build.onSuccess` / `--on-success` inputs fail with migration guidance.
- Canonical `landing.action` / `landingAction` works through:
  - config
  - CLI
  - daemon
  - MCP
  - Pi
  - Claude plugin skills/playbook/init/build surfaces
- Artifact registry load/save/upsert/lookup and corruption behavior.
- Every successful queued build records artifact metadata with stacking disabled.
- Scheduler/waiting unblocks only when dependency artifact exists.
- `validateDependsOnExists()` accepts completed artifact dependencies and rejects unknown/no-artifact dependencies clearly.
- Stack layer status transitions for:
  - PR success
  - provider failure
  - merge actions
  - leave actions
- Stacked PR cleanup happens before git-spice submit.
- Docs/reference drift checks after generated docs updates.

### Documentation Impact

Update documentation as part of the same work.

Primary docs:

- `docs/stacking.md`
  - Replace ASCII diagram with Mermaid.
  - Use canonical `git-spice` commands in examples.
  - Explain artifact registry/dependency semantics.
  - Explain clean landing vocabulary break: `landing.action` / `landingAction` only.
  - Keep automated sync/restack documented as manual/deferred.

- `docs/architecture.md`
  - Update landing lifecycle and artifact dependency model.
  - Remove legacy `build.onSuccess` table/text.

- `docs/roadmap.md`
  - Keep future automated restack/sync item.
  - Use canonical `git-spice` wording instead of `gs`-first wording.

- `README.md`
  - Update any build/landing examples if they reference old vocabulary.

- `eforge/config.yaml`
  - Update comments to canonical `git-spice` and clean landing vocabulary.

Public web docs / generated docs:

- `web/content/docs/stacking.md`
- `web/content/docs/configuration.md`
- `web/content/docs/concepts.md`
- `web/content/docs/getting-started.md`
- `web/content/docs/integrations.md`
- `web/content/reference/config.md`
- `web/content/reference/cli.md`
- Any generated LLMS/reference artifacts from `pnpm docs:generate`.

Integration docs / skills:

- `packages/pi-eforge/skills/eforge-build/SKILL.md`
- `packages/pi-eforge/skills/eforge-init/SKILL.md`
- `packages/pi-eforge/skills/eforge-config/SKILL.md`
- `packages/pi-eforge/skills/eforge-playbook/SKILL.md`
- Matching Claude plugin skills in `eforge-plugin/skills/*`

Required skill/doc updates:

- Replace `onSuccess` with `landingAction`.
- Remove instructions to pass `onSuccess`.
- Correct stale statement that init cannot persist stacking config if the final tool supports it.
- Use Mermaid diagrams, not ASCII branch diagrams.

### Risks

- **Breaking change fallout:** removing `onSuccess` will break stale configs/scripts/tool callers.
  - Mitigation: fail fast with actionable migration messages and update all checked-in docs/skills/tool schemas in the same change.

- **Partial vocabulary migration:** leaving one integration on `onSuccess` would create confusing drift.
  - Mitigation: grep gates/tests for `onSuccess`, `build.onSuccess`, and `--on-success` in active code/docs, with only intentional migration-error text allowed.

- **Artifact registry/source-of-truth confusion:** stack state and artifact registry could diverge.
  - Mitigation: single artifact-recording helper updates artifact registry first and stack projection second; tests cover consistency.

- **Queue deadlocks:** universal artifact readiness could block dependencies if artifact recording happens too late or fails after successful build work.
  - Mitigation: record artifact before landing and fail the PRD if artifact recording fails; tests for waiting/unblocking paths.

- **Completed dependency ambiguity:** accepting completed artifact IDs may collide with active queue IDs or stale artifact records.
  - Mitigation: define precedence and verify artifact ref still resolves when dispatching/building.

- **Cleanup ordering bugs:** moving cleanup into shared pre-publication code could accidentally run twice or omit PRD provenance cleanup.
  - Mitigation: tests assert cleanup runs once before `git-spice branch submit` and once before generic PR creation.

- **Stack status regression:** changing layer statuses may break monitor UI assumptions.
  - Mitigation: update client schema, reducer, UI tests, and snapshot seed tests together.

- **Generated docs drift:** manual docs updates can get overwritten or fail drift gates.
  - Mitigation: run `pnpm docs:generate` and `pnpm docs:check`.

- **Large PR scope:** this combines architecture cleanup with breaking surface changes.
  - Mitigation: implement in ordered slices:
    1. canonical landing types
    2. artifact registry
    3. scheduler/deps
    4. stack landing/status/cleanup
    5. surfaces/docs/tests

### Assumptions and Validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|---|---|---:|---:|---|---|
| A clean breaking-change landing vocabulary is desired. | User explicitly said: “I don't want deprecation, I want clean break.” | High | Low | No further validation needed unless user changes direction. | If wrong, old configs/scripts would fail unnecessarily. |
| Artifact metadata should become universal for queued builds, not stack-only. | Original session plan acceptance criteria said every successful queued build records an artifact and dependencies are artifact-based. Current implementation only gates artifact behavior on `stacking.enabled`, which was identified as a gap. | High | Low | Implement tests for stacking disabled and enabled. | If wrong, this expands behavior beyond intended stack-only semantics. |
| A separate artifact registry is cleaner than reusing `.eforge/stacks/layers.json` for non-stacked artifacts. | Stack state schema has provider `git-spice` and stack topology fields; non-stacked builds should not pretend to be stack layers. | High | Medium | Design minimal artifact schema and test non-stacked + stacked update flows. | If wrong, more runtime files/projections than necessary. |
| Completed dependencies should be valid when a durable artifact exists. | This follows from artifact dependency semantics and fixes current `validateDependsOnExists()` active-queue-only limitation. | High | Low | Add tests for completed artifact references during enqueue/dispatch. | If wrong, users could depend on stale artifacts unexpectedly; ref existence checks mitigate. |
| Old `onSuccess` inputs should fail instead of map silently. | User requested clean break; migration errors preserve clarity without runtime compatibility. | High | Low | Add validation tests for config, PRD frontmatter, CLI, daemon/tool bodies. | If wrong, compatibility break is harsher than desired; user explicitly accepts. |
| Cleanup can be safely shared between generic PR landing and git-spice PR landing. | Existing cleanup helper is local to `landing.ts`; stacked path bypasses it. It is pre-publication behavior independent of PR provider. | Medium/High | Medium | Extract helper and test invocation ordering with stub provider. | If wrong, cleanup could run twice or alter branch state before provider commands. |
| Automated sync/restack remains out of scope. | `docs/roadmap.md` lists automated post-merge restack/sync as future work requiring webhook/polling. | High | Low | Preserve roadmap item and docs wording. | If wrong, this follow-up would leave a workflow gap users expected to be automatic. |
| Docs and generated refs can be updated in the same implementation PRD. | Existing docs generation workflow supports `pnpm docs:generate` and docs drift checks. | High | Low | Run `pnpm docs:generate` and `pnpm docs:check`. | If wrong, docs drift could remain after code changes. |

No low-confidence/high-impact assumptions are being accepted. The main high-impact choice — clean break vs deprecation — is user-stated and recorded.

### Profile Signal

**Recommended profile:** Excursion.

**Rationale:** This is cross-cutting and architecture-heavy, but the shape is now concrete and cohesive: canonical landing vocabulary, provider-neutral artifact registry, queue dependency semantics, stack landing cleanup/status fixes, and synchronized docs/surfaces. A single planner can produce an ordered implementation sequence without delegated module planning. Use Expedition only if implementation discovery shows artifact registry, daemon API migration, and integration surface rewrites each require independent subsystem plans beyond this session.

## Scope

### In Scope

1. **Universal artifact registry and artifact-based queue dependencies**
   - Record a durable artifact branch/ref for every successful queued build, not only stacked builds.
   - Make queue readiness and waiting unblocking use durable artifact availability for `depends_on` by default once the dependency represents a completed queued build.
   - Keep failed/skipped dependencies blocking by default.
   - Do not reintroduce skipped-as-satisfied behavior.

2. **Completed artifact dependency targets**
   - Allow `depends_on` to reference a previously completed PRD when a durable artifact record exists.
   - Keep rejecting unknown dependencies with no active queue item and no artifact record.
   - Ensure user-facing errors distinguish “unknown dependency” from “known dependency without artifact”.

3. **Clean landing vocabulary break**
   - Remove legacy `onSuccess` and `build.onSuccess` from:
     - active config schema
     - engine option names
     - daemon/client request bodies
     - CLI flags
     - MCP/Pi/Claude tool schemas
     - PRD frontmatter
     - playbooks/session-plan enqueue flows
     - docs
   - Use `landing.action` (`pr|merge|leave`) in config and PRD frontmatter.
   - Use `landingAction` (`pr|merge|leave`) for CLI/API/tool one-off overrides.
   - Remove `--on-success`.
   - Keep only `--landing-action` for CLI.
   - Fail fast with clear validation errors if old fields are encountered.
   - Do not silently map old fields.
   - Migration helper/docs may explain the replacement, but runtime should not preserve the old behavior as an alias.

4. **Correct stack layer lifecycle state**
   - Update stack layer `status` when landing starts/completes/fails.
   - Ensure successful git-spice PR landing does not leave the layer as only `built`.
   - Ensure provider failure marks the layer failed or otherwise visibly non-successful.

5. **Cleanup before git-spice PR submission**
   - Reuse generic cleanup behavior for stacked PR landing before `git-spice branch submit`.
   - Avoid duplicate PR publication or duplicate cleanup.

6. **Docs and skill corrections**
   - Replace stale `gs`-first guidance with canonical `git-spice` command guidance.
   - Correct init/config skill text to match the final init tool behavior.
   - Convert ASCII stack diagrams to Mermaid.
   - Regenerate public docs/reference artifacts where applicable.

7. **Sync/restack clarity**
   - Preserve adapter support and tests for git-spice sync/restack commands.
   - Document runtime automation as explicitly deferred, aligned with `docs/roadmap.md`.
   - Do not implement daemon webhook/polling restack automation in this follow-up.

### Out of Scope

- Adding gh-stack, Graphite, native stack providers, or commit-per-PR providers.
- Implementing automatic post-merge restack/sync via webhook or polling.
- Changing git-spice local metadata format.
- Trying to own squash-aware restack logic inside eforge.
- Preserving legacy `onSuccess` compatibility aliases.
- Redesigning monitor persistence beyond the stack/artifact projections needed for the acceptance criteria.

### Roadmap Relation

This work directly polishes the shipped Stacked PR workflow.

It should not remove the roadmap item for automated post-merge restack/sync; that remains future work.

## Acceptance Criteria

### Landing Vocabulary Clean Break

- `eforge/config.yaml` accepts `landing.action: pr|merge|leave`.
- `eforge/config.yaml` no longer accepts `build.onSuccess` as a working compatibility field.
- PRD frontmatter uses canonical landing vocabulary only.
- `onSuccess` frontmatter is rejected with migration guidance.
- CLI exposes `--landing-action pr|merge|leave`.
- CLI no longer exposes or accepts `--on-success`.
- Daemon/client/API/MCP/Pi/Claude tool request bodies use `landingAction`.
- `onSuccess` is not accepted as an active alias.
- Engine internals use canonical landing action values (`pr|merge|leave`) rather than legacy full strings.
- Tests verify old `onSuccess`, `build.onSuccess`, and `--on-success` inputs fail clearly.
- Grep/audit confirms remaining `onSuccess` references are limited to intentional migration-error tests/messages or historical docs if any are deliberately kept.

### Artifact / Dependency Semantics

- Every successful queued build records a durable artifact record containing:
  - PRD id
  - artifact branch/ref
  - commit SHA
  - resolved base
  - landing action
  - status
  - timestamps
- Artifact records are written before landing/publication so dependents do not rely on PR creation/merge side effects.
- Queue readiness for `depends_on` requires durable artifact availability, regardless of whether stacking is enabled.
- Failed/skipped/blocked upstream PRDs block dependents by default.
- `validateDependsOnExists()` accepts dependencies that are either active queue/waiting items or completed PRDs with durable artifact records.
- Unknown dependencies produce actionable errors.
- Known dependencies without usable artifacts produce actionable errors.
- Tests cover:
  - pending dependencies
  - running dependencies
  - completed artifact dependencies
  - missing artifact dependencies
  - failed dependencies
  - skipped dependencies
  - waiting unblocking

### Stack Base / Landing / Status

- Stacked child builds resolve base from the parent artifact registry/stack projection.
- Stacked child builds verify the ref resolves before build.
- Stack layer records transition out of `built` after landing success/failure:
  - PR success records `landing.status: complete` and layer `status: landed`.
  - Provider failure records `landing.status: failed` and layer `status: failed`.
  - Merge actions produce coherent landing/layer statuses.
  - Leave actions produce coherent landing/layer statuses.
- Monitor UI/API shows:
  - stack id
  - PRD/layer
  - artifact branch/ref
  - parent branch
  - provider command
  - landing state
  - layer status
  - PR URL when available

### Cleanup and Git-Spice

- Stacked `landing.action: pr` runs eforge cleanup before `git-spice branch submit` when cleanup is enabled.
- Cleanup runs once.
- PR publication runs once.
- No fallback duplicate `gh pr create` occurs after successful git-spice submission.
- Missing/unusable `git-spice` fails early with actionable guidance before expensive/mutating stack work.
- git-spice adapter remains the only stack provider.
- No gh-stack/native/Graphite provider is exposed.

### Docs / Surfaces / Tests

- Pi extension and Claude plugin are updated consistently.
- Plugin version is bumped if plugin files change.
- Docs and skills use canonical `git-spice` examples.
- `gs` appears only as an optional user alias if mentioned at all.
- Init/config skill guidance matches actual tool behavior for stacking settings.
- Stack diagrams are Mermaid, not ASCII.
- Generated docs are refreshed.
- `pnpm docs:check` passes.
- `pnpm type-check` passes.
- Relevant unit/integration tests pass.
