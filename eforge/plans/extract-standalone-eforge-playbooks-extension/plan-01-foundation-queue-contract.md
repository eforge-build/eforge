---
id: plan-01-foundation-queue-contract
name: Add any producer-agnostic generic queue handoff fields needed by
  extension-owned playbook runs, with tests for ctx.buildQueue.enqueue behavior.
branch: extract-standalone-eforge-playbooks-extension/foundation-queue-contract
---

# Foundation Queue Contract

## Architecture Reference

This module implements the producer-agnostic queue handoff portion of the architecture, especially:

- **Shared data model and contracts > Autonomous queue handoff**
- **Integration contracts by subsystem > Client and daemon boundary**
- **Technical decisions and rationale > Use generic queue handoff even when it needs a small generic extension**

Key constraints from architecture:
- Extension-owned playbook runs must call `ctx.buildQueue.enqueue(...)`, not monitor playbook route/service internals.
- Any extra queue fields needed for autonomous playbook runs must be producer-agnostic; no playbook-specific queue fields or route literals.
- Existing `profile`, `landingAction`, `landingAutoMerge`, and `afterQueueId` behavior must remain intact.
- The build engine remains input-agnostic: it consumes normalized source and queue metadata, not playbook concepts.
- No direct `/api/playbook/*` compatibility surface is introduced or retained by this module.

## Scope

### In Scope
- Add a generic queue handoff field for per-enqueue post-merge commands when needed by autonomous playbook runs.
- Expose the field through the public `EnqueueRequest` type consumed by `ctx.buildQueue.enqueue(...)`.
- Validate and forward the field through daemon enqueue preparation and extension action build-queue dispatch.
- Add CLI enqueue support so daemon worker handoff can carry the field through `spawnWorker('enqueue', args)`.
- Persist the field into queued PRD frontmatter using generic queue/PRD naming.
- Parse queued PRD frontmatter for the field so queued builds can receive the same per-PRD validation commands.
- Add tests for `ctx.buildQueue.enqueue(...)` forwarding and daemon/engine queue behavior.

### Out of Scope
- Creating `eforge-playbooks` actions or schemas.
- Moving playbook artifact utilities or workflow adapters.
- Migrating CLI/MCP/Pi/Claude playbook commands.
- Removing direct playbook daemon/client routes.
- Updating public docs or generated reference artifacts; the docs/regression module owns those updates.
- Adding playbook-specific queue fields, route keys, daemon services, or wire types.

## Implementation Approach

### Overview

Treat autonomous playbook `postMerge` commands as a generic per-enqueue PRD metadata field named `postMerge`. The field flows through the existing queue handoff path:

```text
extension action -> ctx.buildQueue.enqueue({ source, postMerge, ... })
  -> monitor extension contribution service
  -> prepareEnqueueRequest()
  -> spawnWorker('enqueue', args)
  -> eforge enqueue --post-merge <command>
  -> EforgeEngine.enqueue(..., { postMerge })
  -> enqueuePrd({ postMerge })
  -> queued PRD frontmatter
  -> loadQueue()/runQueuedPrdBuild()
  -> EforgeEngine.build(..., { postMergeCommands })
  -> Orchestrator post-merge validation command list
```

The field remains producer-agnostic: any trusted extension action or local daemon enqueue caller can use it to attach per-queued-PRD post-merge validation commands. No playbook identifiers, direct playbook route constants, or playbook wire types are added.

### Key Decisions

1. **Use `postMerge?: string[]` on `EnqueueRequest`.**
   - Rationale: `postMerge` is already the queued PRD/playbook frontmatter name and `enqueuePrd()` option name. Reusing it avoids introducing a playbook-only translation layer.

2. **Use repeated CLI flag `--post-merge <command>`.**
   - Rationale: daemon queue handoff currently spawns `eforge enqueue` with argv. A repeatable flag preserves command strings as argv entries without shell quoting and avoids encoding commands into the generic `flags` escape hatch.

3. **Validate commands before spawning and before queue serialization.**
   - Rationale: post-merge commands later run as project commands. The daemon must reject non-array values, non-string values, blank strings, and control/newline-containing strings before they can corrupt frontmatter or worker argv.

4. **Store and parse `postMerge` as PRD frontmatter, then append it to build-time post-merge commands.**
   - Rationale: autonomous playbook runs already compile to ordinary build source. Per-producer validation commands belong to queue metadata, not to engine playbook semantics. Configured `build.postMergeCommands` run first, followed by queued PRD `postMerge` commands, then planner-generated validate commands through the existing orchestrator path.

5. **Keep `flags` behavior unchanged.**
   - Rationale: existing daemon enqueue callers may use `flags`; this module adds a first-class generic field without changing the ordering or filtering semantics for pre-existing flags except for deterministic insertion of `--post-merge` args after caller-supplied `flags`.

## Files

### Create
- `test/extension-build-queue-enqueue-contract.test.ts` — focused tests for extension action `ctx.buildQueue.enqueue(...)` forwarding generic queue fields, including `postMerge`, to the daemon worker args.
- `test/engine-enqueue-post-merge.test.ts` — engine/queue tests proving `postMerge` persists into queued PRD frontmatter, round-trips through `loadQueue()`, and is passed to queued build execution as per-PRD `postMergeCommands`.

### Modify
- `packages/client/src/routes/core.ts` — add optional `postMerge?: string[]` to `EnqueueRequest` with a producer-agnostic comment. This type is already re-exported through the client and extension SDK surfaces.
- `packages/engine/src/events.ts` — add `postMerge?: string[]` to `EnqueueOptions` and `postMergeCommands?: string[]` to `BuildOptions` for the engine handoff from queue metadata into build orchestration.
- `packages/engine/src/eforge.ts` — pass `options.postMerge` into `enqueuePrd()`; combine `config.build.postMergeCommands` with `options.postMergeCommands` before creating the `Orchestrator`.
- `packages/engine/src/prd-queue.ts` — validate/sanitize `postMerge` commands in `enqueuePrd()`, serialize them as queued PRD frontmatter, and parse the block-list frontmatter back into `PrdFrontmatter.postMerge` in `loadQueue()`.
- `packages/engine/src/queue/build-single-prd.ts` — pass `prd.frontmatter.postMerge` to `ctx.build(...)` as `postMergeCommands` for normal queued PRD builds.
- `packages/monitor/src/routes/enqueue-service.ts` — validate `body.postMerge` and append repeatable `--post-merge <command>` argv entries in `prepareEnqueueRequest()`.
- `packages/monitor/src/__tests__/route-test-harness.ts` — allow `startContentRouteHarness({ serverOptions })` so extension contribution route tests can provide a fake `workerTracker`.
- `packages/monitor/src/__tests__/routes-control-plane-acceptance.test.ts` — add validation/status coverage for invalid `postMerge` bodies and spawn-argv coverage for valid `postMerge` arrays.
- `packages/monitor/src/__tests__/routes-extension-contributions.test.ts` — add a build-queue action fixture that calls `ctx.buildQueue.enqueue({ source, postMerge, landingAction })` and assert the worker receives generic enqueue args.
- `packages/eforge/src/cli/index.ts` — add the repeatable `--post-merge <command>` option to `eforge enqueue`, collect values into `options.postMerge`, and pass the array to `engine.enqueue()`. Use bounded exact edits; this is an oversized legacy file.
- `test/extension-tooling-wiring-cli.test.ts` — update existing source-shape assertions to include the new optional `postMerge` queue contract and CLI forwarding points if the string-based tests fail after implementation.

No architecture-declared shared file from the Shared File Registry is modified by this module. If implementation discovers that another module also edits `packages/eforge/src/cli/index.ts` or `packages/engine/src/prd-queue.ts`, add non-overlapping `[region: foundation-queue-contract, ...]` annotations to the downstream plan before building.

## Testing Strategy

### Unit Tests
- `test/engine-enqueue-post-merge.test.ts`
  - Create a temp project and enqueue with `EforgeEngine.enqueue(source, { postMerge: ['pnpm build', 'pnpm test'] })` using `StubHarness` formatter and acceptance-criteria responses.
  - Assert the queued Markdown contains a `postMerge:` frontmatter block with both commands.
  - Assert `loadQueue()` returns `frontmatter.postMerge` equal to the original array.
  - Assert an invalid command containing `\n` produces an `enqueue:failed` event and writes no queued Markdown file.
- `packages/monitor/src/__tests__/routes-control-plane-acceptance.test.ts`
  - Assert invalid `postMerge` request bodies return 400.
  - Assert valid `postMerge` commands are emitted as repeated `--post-merge` argv pairs while existing `flags`, `landingAction`, `landingAutoMerge`, and `afterQueueId` args remain in deterministic order.

### Integration Tests
- `test/extension-build-queue-enqueue-contract.test.ts` or `routes-extension-contributions.test.ts`
  - Seed a temporary extension action that calls `ctx.buildQueue.enqueue({ source: 'prd.md', postMerge: ['pnpm build'], landingAction: 'leave' })`.
  - Start extension contribution routes with a fake `workerTracker`.
  - Invoke the action through `API_ROUTES.extensionActionInvoke`.
  - Assert the action response contains the fake enqueue `sessionId`, `pid`, and `autoBuild` value.
  - Assert the fake worker saw command `enqueue` and args `['prd.md', '--post-merge', 'pnpm build', '--landing-action', 'leave']`.
- Queued build handoff test
  - Load a queued PRD with `postMerge` frontmatter and run `runQueuedPrdBuild()` with a stub `build` function.
  - Assert the stub receives `options.postMergeCommands` equal to the frontmatter commands.

## Verification

- [ ] `EnqueueRequest` includes optional `postMerge?: string[]` and contains no playbook-specific field names.
- [ ] `ctx.buildQueue.enqueue({ source, postMerge })` invokes `workerTracker.spawnWorker('enqueue', args)` with repeated `--post-merge` argv pairs.
- [ ] `POST /api/enqueue` returns 400 for `postMerge` values that are not string arrays, contain blank strings, or contain control/newline characters.
- [ ] `EforgeEngine.enqueue(..., { postMerge })` writes one queued Markdown file whose frontmatter contains every supplied command in order.
- [ ] `loadQueue()` returns `frontmatter.postMerge` for queued PRDs written with the new field.
- [ ] Queued PRD execution passes `frontmatter.postMerge` into `EforgeEngine.build()` as `postMergeCommands`.
- [ ] Existing `profile`, `landingAction`, `landingAutoMerge`, and `afterQueueId` tests continue to pass.
- [ ] `rg -n "playbook|/api/playbook|apiPlaybook" packages/client/src/routes/core.ts packages/monitor/src/routes/enqueue-service.ts packages/engine/src/eforge.ts packages/engine/src/prd-queue.ts packages/engine/src/queue/build-single-prd.ts` shows no new playbook-specific queue contract code.
- [ ] Targeted tests pass: `pnpm vitest run test/engine-enqueue-post-merge.test.ts packages/monitor/src/__tests__/routes-control-plane-acceptance.test.ts packages/monitor/src/__tests__/routes-extension-contributions.test.ts`.
- [ ] `pnpm type-check` exits 0.

<build-config>
{
  "build": ["implement", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["api", "security"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
