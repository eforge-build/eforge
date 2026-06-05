---
id: plan-01-compiled-resume-policy-context
name: Expose Compiled Resume Metadata in Queue Dispatch Policy Context
branch: harden-queued-compiled-resume-scheduler-policy-context/plan-01-compiled-resume-policy-context
---

# Expose Compiled Resume Metadata in Queue Dispatch Policy Context

## Architecture Context

`QueueScheduler` invokes `beforeQueueDispatch` policy gates before profile routers, session start, semaphore acquisition, and child spawning. The policy-gate runtime builds deep-frozen context snapshots, while `@eforge-build/extension-sdk` mirrors the public context types for extension authors. Compiled-resume PRDs already preserve `resume_*` frontmatter and the engine already parses that frontmatter through `getCompiledResumeFrontmatter`; the gap is that scheduler-owned queue-dispatch policy context does not surface that parsed metadata.

This plan adds a backward-compatible optional `compiledResume` object to queue-dispatch policy context only. It does not change queue transition semantics, resume eligibility, profile routing, policy decisions, or extension diagnostic event wire shapes.

## Implementation

### Overview

Add an optional camelCase compiled-resume metadata object to the engine runtime target/context and the public extension SDK context. Have the queue scheduler derive the object from the current PRD frontmatter with `getCompiledResumeFrontmatter` and pass it into `buildQueueDispatchPolicyGateContext`. Add focused scheduler and runtime tests, then update extension API docs and generated docs mirrors.

### Key Decisions

1. Use `compiledResume?: { mode: 'compiled'; sourcePrdId: string; setName: string; featureBranch: string; baseBranch: string }` on queue-dispatch context. Do not expose raw `resume_*` snake_case fields.
2. Keep `compiledResume` optional and omit the property for normal PRDs, preserving existing extension handlers.
3. Use `getCompiledResumeFrontmatter(currentPrd.frontmatter)` in the scheduler before building the queue-dispatch context. Complete compiled-resume frontmatter produces metadata; partial malformed frontmatter follows the existing helper behavior instead of creating partial context.
4. Clone the metadata in the policy-gate context builder and rely on the existing `deepFreeze` path so handlers receive a read-only snapshot.
5. Do not add compiled-resume metadata to `extension:policy:*` diagnostic events; this scope is policy-gate handler context only.

## Scope

### In Scope

- Add an optional typed `compiledResume` metadata shape to `QueueDispatchPolicyGateContext` and `QueueDispatchPolicyGateTarget` in the engine runtime.
- Add the same optional typed metadata shape to `QueueDispatchPolicyGateContext` in `@eforge-build/extension-sdk`.
- Export any newly named metadata type from the engine extension barrel and extension SDK barrel when a named type is introduced.
- Update `QueueScheduler` to parse complete compiled-resume frontmatter and pass the parsed metadata into queue-dispatch policy-gate context.
- Add a compiled-resume scheduler policy-gate test that captures `beforeQueueDispatch` context and asserts identity, title, profile, dependencies, and all `compiledResume` fields.
- Extend policy-gate runtime tests to assert cloned/frozen metadata when present and no `compiledResume` property for normal PRDs.
- Reconfirm the existing queue recovery cascade collision/no-clobber tests remain present and pass; add no new rollback/collision test unless implementation inspection finds an uncovered collision path.
- Update extension API docs in the root docs and web content source, then regenerate public docs mirrors.

### Out of Scope

- Changing compiled-resume product behavior.
- Changing queue transition or concurrency semantics.
- Changing resume eligibility, sidecar finalization, rollback behavior, approvals, or failure policy.
- Changing profile-router execution.
- Adding broad queue-cascade tests that duplicate existing no-overwrite cases.
- Adding compiled-resume fields to policy diagnostic event schemas.

## Files

### Create

- None.

### Modify

- `packages/engine/src/extensions/policy-gate-runtime.ts` — add the optional compiled-resume metadata type/field to queue-dispatch target/context and clone it in `buildQueueDispatchPolicyGateContext`.
- `packages/engine/src/extensions/index.ts` — export the new metadata type if a named runtime type is added.
- `packages/engine/src/queue/scheduler.ts` — import `getCompiledResumeFrontmatter`, derive metadata from `currentPrd.frontmatter`, and include it in queue-dispatch policy-gate target only when present.
- `packages/extension-sdk/src/context.ts` — add the public SDK metadata type/field with comments explaining that normal PRDs omit it.
- `packages/extension-sdk/src/index.ts` — export the new SDK metadata type if a named SDK type is added.
- `test/queue-scheduler-policy.test.ts` — add the focused compiled-resume `beforeQueueDispatch` context test and, where practical, assert the existing normal PRD context lacks `compiledResume`.
- `test/extension-policy-gate-runtime.test.ts` — extend context-builder coverage for cloned/frozen compiled-resume metadata and absence on normal PRDs.
- `docs/extensions-api.md` — document the optional queue-dispatch `compiledResume` context field and its camelCase shape.
- `web/content/docs/extensions-api.md` — mirror the extension API docs update for the web docs source.
- `web/public/docs/extensions-api.md` — generated mirror updated by `pnpm docs:generate` after editing `web/content/docs/extensions-api.md`.

## Implementation Notes

### Engine runtime

- Prefer a named interface such as `QueueDispatchCompiledResumeMetadata` in `policy-gate-runtime.ts` with the exact fields `mode`, `sourcePrdId`, `setName`, `featureBranch`, and `baseBranch`.
- Add `compiledResume?: QueueDispatchCompiledResumeMetadata` to both `QueueDispatchPolicyGateContext` and `QueueDispatchPolicyGateTarget`.
- In `buildQueueDispatchPolicyGateContext`, include `compiledResume: { ...target.compiledResume }` only when `target.compiledResume !== undefined`.
- Keep `dependsOn: [...(target.dependsOn ?? [])]` unchanged.

### Scheduler

- Add `getCompiledResumeFrontmatter` to the existing `prd-queue` import in `packages/engine/src/queue/scheduler.ts`.
- Inside the queue-dispatch policy-gate block, derive `const compiledResume = getCompiledResumeFrontmatter(currentPrd.frontmatter);` before calling `buildQueueDispatchPolicyGateContext`.
- Pass `...(compiledResume !== undefined && { compiledResume })` in the target object.
- Let helper exceptions propagate to the existing scheduler `catch` block; do not create a partial context from incomplete frontmatter.

### Tests

- In `test/queue-scheduler-policy.test.ts`, create a queued PRD with `title`, `profile`, `depends_on`, and complete `resume_*` frontmatter:
  - `resume_mode: compiled`
  - `resume_from: failed-prd`
  - `resume_set_name: failed-set`
  - `resume_feature_branch: eforge/failed-set`
  - `resume_base_branch: main`
- Ensure any dependency in `depends_on` is satisfied before dispatch, following the existing `upsertArtifact` pattern in the normal context test.
- Capture the policy-gate handler context before returning a blocking or allowing decision, then assert:
  - `gateKind === 'queue-dispatch'`
  - `prdId` matches the queued PRD id
  - `prdTitle` matches the queued PRD title
  - `profile` matches frontmatter before profile routers
  - `dependsOn` matches frontmatter dependencies
  - `compiledResume.mode === 'compiled'`
  - `compiledResume.sourcePrdId`, `setName`, `featureBranch`, and `baseBranch` match frontmatter values
- In `test/extension-policy-gate-runtime.test.ts`, mutate the source metadata object after building the context and assert the context retains the original values; assert `Object.isFrozen(queueContext.compiledResume)` is `true` when present.
- Assert `buildQueueDispatchPolicyGateContext({ prdId: 'normal' })` or the existing `buildPolicyGateContext({ gateKind: 'queue-dispatch', prdId: ... })` result has no own `compiledResume` property.
- Inspect `test/queue-recovery-cascade.test.ts` before editing. Existing tests already cover matching already-queued roots, failed-parent target collision, skipped-descendant target collision, and queue-root descendant non-clobbering; leave them unchanged unless code inspection finds a missing collision path.

### Docs

- Update both `docs/extensions-api.md` and `web/content/docs/extensions-api.md` in the Policy gate contexts section.
- Add a small `QueueDispatchCompiledResumeMetadata` interface (or equivalent inline field shape) to the TypeScript snippet and describe that `compiledResume` appears only for complete compiled-resume queue items.
- Run `pnpm docs:generate` so `web/public/docs/extensions-api.md` mirrors the web content source, then run `pnpm docs:check`.

## Verification

- [ ] `test/queue-scheduler-policy.test.ts` includes a compiled-resume queue-dispatch policy-gate test.
- [ ] The compiled-resume scheduler test asserts `gateKind`, `prdId`, `prdTitle`, `profile`, `dependsOn`, and every `compiledResume` field listed in this plan.
- [ ] Normal queue-dispatch context omits the `compiledResume` property in runtime builder coverage.
- [ ] Runtime builder coverage proves `compiledResume` is cloned by mutating the input object after context construction.
- [ ] Runtime builder coverage proves the nested `compiledResume` object is frozen when present.
- [ ] Existing queue-cascade tests for matching already-queued roots, failed-parent target collision, skipped-descendant target collision, and queue-root descendant non-clobbering remain in `test/queue-recovery-cascade.test.ts`.
- [ ] `pnpm vitest run test/queue-scheduler-policy.test.ts test/extension-policy-gate-runtime.test.ts test/queued-compiled-resume-scheduler.test.ts test/queue-recovery-cascade.test.ts` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm docs:check` exits 0 after docs generation or mirror updates.
- [ ] `pnpm maintainability:check` exits 0.