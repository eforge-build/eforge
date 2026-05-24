---
id: plan-02-artifact-registry-dependencies
name: Provider-Neutral Artifact Registry and Dependency Readiness
branch: close-follow-up-gaps-in-git-spice-stacked-pr-support/plan-02-artifact-registry-dependencies
agents:
  builder:
    effort: high
    rationale: Adds a new engine-owned runtime state file and changes queue
      dependency semantics across scheduler, queue validation, and stack base
      resolution.
---

# Provider-Neutral Artifact Registry and Dependency Readiness

## Architecture Context

Artifact readiness is currently represented by stack layers in `.eforge/stacks/layers.json`, and scheduler checks are gated by `stacking.enabled`. The target architecture requires provider-neutral artifacts for every successful queued build and dependency readiness based on those artifacts regardless of stacking.

## Implementation

### Overview

Introduce an engine-owned artifact registry at `.eforge/artifacts/builds.json`, record every successful queued build before landing/publication, make active and completed `depends_on` checks consult the registry, and keep stack state as a projection for stacked topology/provider visibility.

### Key Decisions

1. The artifact registry is the source of truth for dependency readiness; stack state remains a stack topology/provider projection.
2. Artifact recording happens after all plan merges/validation pass and before any landing/publication step.
3. For stacked builds, the artifact registry is written first, then the existing stack layer projection is upserted from the same data.
4. Completed dependencies are accepted only when a usable artifact record exists; failed/skipped/blocked dependencies block dependents.

## Scope

### In Scope
- Add artifact registry schema/load/save/upsert/lookup helpers with atomic writes and corruption handling.
- Record durable artifact metadata for every successful queued PRD build, including PRD id, artifact branch/ref, commit SHA, resolved base, landing action, status, and timestamps.
- Generalize `recordArtifact(ctx)` so non-stacked queued builds record artifacts and stacked builds also mirror to stack layer state.
- Make `validateDependsOnExists()` accept active root/waiting/running dependencies or completed dependencies with usable artifact records.
- Make `validateDependsOnExists()` distinguish unknown dependency ids from known terminal dependencies without artifacts.
- Make `unblockWaiting()` require usable artifacts by default for completed dependencies.
- Make `QueueScheduler` artifact readiness unconditional for queued dependencies and remove the `config.stacking.enabled` gate.
- Make stack base resolution read parent artifacts from the registry and verify branch/ref or commit SHA resolution before dispatch/build.

### Out of Scope
- Daemon/UI artifact registry routes unless required by implementation tests; stack UI remains stack-focused.
- Automated post-merge sync/restack.
- Compatibility for skipped-as-satisfied dependencies.

## Files

### Create
- `packages/engine/src/artifacts/registry.ts` — artifact registry path helpers, Zod schema, load/save/upsert/lookup, status helpers, and corruption fallback.
- `packages/engine/src/artifacts/index.ts` — public engine exports for artifact registry helpers if package export patterns require it.
- `test/artifact-registry.test.ts` — registry load/save/upsert/lookup/corruption tests.

### Modify
- `packages/engine/src/orchestrator/phases.ts` — record queued artifacts before landing for all queued PRD builds and fail the build when artifact recording fails.
- `packages/engine/src/orchestrator.ts` — ensure PRD id, artifact branch, resolved base, and landing action flow into phases.
- `packages/engine/src/eforge.ts` — pass canonical landing action and queue PRD metadata into build/orchestrator contexts for all queued builds.
- `packages/engine/src/prd-queue.ts` — update `validateDependsOnExists()` and `unblockWaiting()` to use artifact registry plus active/terminal queue state.
- `packages/engine/src/queue/scheduler.ts` — replace stack-gated readiness with registry-backed artifact readiness and in-memory blocking for failed/skipped/blocked upstreams.
- `packages/engine/src/stacking/artifacts.ts` — convert to a stack projection helper or delegate to the registry-first recorder.
- `packages/engine/src/stacking/base-resolver.ts` — resolve parent base from artifact registry and fall back to recorded commit SHA only after ref lookup fails.
- `packages/engine/src/stacking/state.ts` — keep stack artifact helper behavior as projection-only where needed.
- `test/queue-piggyback.test.ts`, `test/greedy-queue-scheduler.test.ts`, `test/stack-artifact-recording.test.ts`, `test/stack-base-resolver.test.ts` or equivalent existing stack/base tests — cover stacking disabled/enabled artifact readiness, completed dependencies, missing artifacts, failed/skipped dependencies, waiting unblocking, and parent ref verification.

## Verification

- [ ] Artifact registry load returns an empty registry for a missing file and a malformed JSON file.
- [ ] Registry upsert preserves a previous `recordedAt` for the same PRD id and updates `updatedAt`.
- [ ] A successful queued build with `stacking.enabled: false` writes an artifact record before `landing:start`.
- [ ] A successful stacked queued build writes an artifact record and a matching stack layer artifact branch/commit.
- [ ] `validateDependsOnExists()` accepts a dependency id present only in the artifact registry.
- [ ] `validateDependsOnExists()` rejects an unknown id with an error containing `unknown dependency` or `unknown queue item`.
- [ ] `validateDependsOnExists()` rejects a known terminal dependency without a usable artifact with an error containing `artifact`.
- [ ] Waiting PRDs unblock only after all dependencies have usable artifact records.
- [ ] Failed and skipped upstream PRDs move waiting dependents to `skipped/` or mark scheduler state blocked.
