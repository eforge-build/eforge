---
title: Harden Queued Compiled-Resume Scheduler Policy Context
created: 2026-06-04
depends_on: ["fix-recovery-actions-ux-after-successor-enqueue-or-resume"]
landing: pr
landing_auto_merge: true
stack_parent: fix-recovery-actions-ux-after-successor-enqueue-or-resume
---

# Harden Queued Compiled-Resume Scheduler Policy Context

## Problem / Motivation

Queued compiled-resume PRDs are scheduled correctly today, but queue-dispatch policy-gate context does not expose compiled-resume metadata. This leaves a coverage and typed-recovery gap: policy gates cannot assert or consume `resume_*` frontmatter during scheduler-owned dispatch, even though roadmap goals emphasize Kernel Resilience, Typed Recovery paths, and honest gates without expanding engine scope.

Backlog source: `.backlog/items/backlog-2026-06-03-harden-queued-compiled-resume-scheduler-and-rollback-race-co.md`.

Confirmed findings:

- Roadmap alignment supports `docs/roadmap.md` Kernel Resilience and Typed Recovery goals, especially typed recovery paths and honest gates, without expanding engine scope.
- `test/queue-scheduler-policy.test.ts` currently verifies queue-dispatch policy behavior for normal PRDs and asserts context fields `gateKind`, `prdId`, `prdTitle`, `priority`, `profile`, and `dependsOn` for a normal frontmatter case.
- `test/queued-compiled-resume-scheduler.test.ts` currently verifies scheduler-owned dispatch of a compiled-resume PRD, preserved `resume_*` frontmatter, max-concurrency behavior, and profile source behavior, but it does not exercise policy-gate context.
- `packages/engine/src/queue/scheduler.ts` builds queue-dispatch policy-gate context from only `prdId`, `prdTitle`, `priority`, `profile`, and `dependsOn`; it does not pass `resume_mode`, `resume_from`, `resume_set_name`, `resume_feature_branch`, or `resume_base_branch`.
- `packages/engine/src/extensions/policy-gate-runtime.ts` and `packages/extension-sdk/src/context.ts` define `QueueDispatchPolicyGateContext` without compiled-resume metadata fields, so a focused compiled-resume policy-gate test requires a small API/context extension rather than a test-only change.
- `test/queue-recovery-cascade.test.ts` already covers already-queued matching resume roots, blocked non-matching roots, blocked rollback when a failed parent target exists, blocked rollback when a skipped descendant target exists, and non-clobbering of an existing queue-root descendant target during unblocking.
- A repository-wide search for `queue-dispatch`, `QueueDispatchPolicyGateContext`, and `resume_*` found no existing test that asserts compiled-resume metadata in queue-dispatch policy context.
- A repository-wide search found current SDK/docs policy-gate context docs list the same normal PRD fields and no compiled-resume fields, so user-facing type/docs updates are likely needed if the context is extended.

Classification: maintenance / focused, high confidence. This is coverage hardening with a small typed policy-context surface update.

## Goal

Add targeted coverage proving queued compiled-resume PRDs reach `beforeQueueDispatch` policy gates with the expected identity, routing context, dependencies, and compiled-resume metadata.

Expose compiled-resume metadata as optional typed queue-dispatch policy-gate context while preserving backward compatibility for normal PRDs and existing extension handlers.

## Approach

Implement a small typed extension to queue-dispatch policy-gate context and focused scheduler/runtime coverage.

Key implementation decisions:

- Add optional `compiledResume` metadata to queue-dispatch policy-gate context.
- Prefer reusing the existing `CompiledResumeFrontmatter` shape or a small mirrored camelCase shape with `mode`, `sourcePrdId`, `setName`, `featureBranch`, and `baseBranch`.
- Do not expose raw snake_case `resume_*` fields in the policy-gate context.
- Keep compiled-resume metadata optional so normal PRD policy-gate behavior and existing extension handlers remain backward compatible.
- Use existing validation helpers such as `getCompiledResumeFrontmatter` so partial malformed resume frontmatter follows existing behavior instead of silently creating partial context.
- Revalidate the existing queue-cascade rollback/collision tests before adding any additional race/collision assertion.
- Add a new rollback/collision assertion only if implementation-time inspection identifies an uncovered collision/race behavior.

Primary code targets:

- `test/queue-scheduler-policy.test.ts`: add the focused compiled-resume queue-dispatch policy-gate test. The test should construct a queued PRD with `profile`, `depends_on`, and complete `resume_*` frontmatter, capture the policy-gate context, and assert the context before profile routers or spawn behavior can obscure it.
- `packages/engine/src/extensions/policy-gate-runtime.ts`: extend `QueueDispatchPolicyGateContext` and `QueueDispatchPolicyGateTarget` with optional compiled-resume metadata.
- `packages/engine/src/queue/scheduler.ts`: derive compiled-resume metadata from `currentPrd.frontmatter` and pass it into `buildQueueDispatchPolicyGateContext`.
- `packages/extension-sdk/src/context.ts`: update the public extension SDK type so extension authors can type access the optional compiled-resume metadata.
- `test/extension-policy-gate-runtime.test.ts`: update context-builder coverage to prove the optional resume metadata is cloned/read-only and absent for normal PRDs.
- `web/content/docs/extensions-api.md` and generated docs artifacts, or the current docs generation source path used by this repo: document the new optional queue-dispatch context field and run the docs generator/check if docs drift is expected.

Secondary validation targets:

- `test/queue-recovery-cascade.test.ts`: inspect before editing. Existing assertions already cover matching already-queued roots, non-matching root blockers, rollback no-overwrite for failed parent and skipped descendants, and queue-root descendant non-clobbering during unblocking.
- `test/queued-compiled-resume-scheduler.test.ts`: leave unchanged unless sharing a small compiled-resume PRD fixture materially reduces duplication without weakening test clarity.

Validation commands:

- Run `pnpm vitest run test/queue-scheduler-policy.test.ts test/extension-policy-gate-runtime.test.ts test/queued-compiled-resume-scheduler.test.ts test/queue-recovery-cascade.test.ts`.
- Run `pnpm type-check` if the policy-gate context or extension SDK types change.
- Run `pnpm docs:check` or `pnpm docs:generate` followed by the relevant drift check if docs are updated or generated references change.

Recommended profile: Excursion.

Profile rationale: the work is small and cohesive, but it spans scheduler behavior, policy-gate runtime types, extension SDK types, and documentation drift. A single planner/build pass can cover the whole change without delegated subsystem planning, so Expedition would be unnecessary. Errand is too light because a test-only request revealed a small API/context update and typed docs consideration.

## Scope

In scope:

- Add a focused scheduler test proving a queued compiled-resume PRD reaches `beforeQueueDispatch` policy gates with the expected PRD identity, title, profile, dependencies, and compiled-resume metadata.
- Extend the queue-dispatch policy-gate context shape just enough to expose compiled-resume metadata to policy gates when a queue item has complete compiled-resume frontmatter.
- Keep the metadata optional so normal PRD policy-gate behavior and existing extension handlers remain backward compatible.
- Revalidate the existing queue-cascade rollback/collision tests before adding any additional race/collision assertion.
- Update engine runtime mirror types.
- Update the public extension SDK type.
- Update user-facing policy-gate context documentation if the context is extended.
- Run docs drift validation if docs updates or generated references change.

Out of scope:

- Changing compiled-resume product behavior.
- Changing queue transition semantics.
- Changing resume eligibility.
- Changing sidecar finalization.
- Changing scheduler concurrency policy.
- Reworking policy-gate execution.
- Reworking approval behavior.
- Reworking failure policy.
- Reworking profile-router behavior.
- Adding broad queue-cascade tests that duplicate already-covered no-overwrite/collision scenarios.

## Acceptance Criteria

- `test/queue-scheduler-policy.test.ts` contains a queue-dispatch policy-gate test for a compiled-resume PRD.
- The compiled-resume policy-gate test asserts `gateKind` is `queue-dispatch`.
- The compiled-resume policy-gate test asserts the context `prdId` matches the queued PRD id.
- The compiled-resume policy-gate test asserts the context `prdTitle` matches the queued PRD title.
- The compiled-resume policy-gate test asserts the context `profile` matches the queued PRD frontmatter profile before profile routing.
- The compiled-resume policy-gate test asserts the context `dependsOn` matches the queued PRD frontmatter dependencies.
- The compiled-resume policy-gate test asserts the context `compiledResume.mode` is `compiled`.
- The compiled-resume policy-gate test asserts the context `compiledResume.sourcePrdId` matches the queued PRD `resume_from` frontmatter value.
- The compiled-resume policy-gate test asserts the context `compiledResume.setName` matches the queued PRD `resume_set_name` frontmatter value.
- The compiled-resume policy-gate test asserts the context `compiledResume.featureBranch` matches the queued PRD `resume_feature_branch` frontmatter value.
- The compiled-resume policy-gate test asserts the context `compiledResume.baseBranch` matches the queued PRD `resume_base_branch` frontmatter value.
- Queue-dispatch policy-gate context for a normal PRD omits `compiledResume`.
- `QueueDispatchPolicyGateContext` in the engine runtime exposes optional typed compiled-resume metadata.
- `QueueDispatchPolicyGateContext` in the extension SDK exposes optional typed compiled-resume metadata.
- `test/extension-policy-gate-runtime.test.ts` proves optional resume metadata is cloned/read-only.
- `test/extension-policy-gate-runtime.test.ts` proves optional resume metadata is absent for normal PRDs.
- Existing queue-cascade tests for rollback failed-parent target collision remain present and pass.
- Existing queue-cascade tests for rollback skipped-descendant target collision remain present and pass.
- Existing queue-cascade tests for matching already-queued compiled-resume root safety remain present and pass.
- Existing queue-cascade tests for queue-root descendant non-clobbering remain present and pass.
- `pnpm vitest run test/queue-scheduler-policy.test.ts test/extension-policy-gate-runtime.test.ts test/queued-compiled-resume-scheduler.test.ts test/queue-recovery-cascade.test.ts` exits 0.
- `pnpm type-check` exits 0.
- If docs are updated or generated references change, `pnpm docs:check` exits 0 or `pnpm docs:generate` followed by the relevant drift check exits 0.

## Manual Verification Notes

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| The remaining coverage gap is compiled-resume queue-dispatch policy context, not scheduler dispatch or rollback collision behavior. | Read the backlog item; inspected `test/queue-scheduler-policy.test.ts`, `test/queued-compiled-resume-scheduler.test.ts`, and `test/queue-recovery-cascade.test.ts`; searched for `queue-dispatch`, `QueueDispatchPolicyGateContext`, and `resume_*`. | high | low | Re-run the same source search before implementation if main changes. | The build might add duplicate tests or miss a newly introduced gap. |
| Exposing compiled-resume metadata as optional `compiledResume` with `mode`, `sourcePrdId`, `setName`, `featureBranch`, and `baseBranch` is the right context shape. | `packages/engine/src/prd-queue.ts` already defines `CompiledResumeFrontmatter` with that camelCase shape via `getCompiledResumeFrontmatter`; existing policy context fields are camelCase (`prdTitle`, `dependsOn`). | high | low | Confirm with TypeScript imports and existing SDK naming before editing. | A different field shape would require updating acceptance criteria and docs. |
| Extending queue-dispatch policy context requires updating both engine runtime mirror types and the public extension SDK type. | `packages/engine/src/extensions/policy-gate-runtime.ts` and `packages/extension-sdk/src/context.ts` both define queue-dispatch context; docs show the SDK shape without resume metadata. | high | low | Run `pnpm type-check` after edits. | Extension authors would lack type access or runtime/docs could drift. |
| Docs may need regeneration after SDK/context docs changes. | `docs/extensions-api.md`, `web/content/docs/extensions-api.md`, and generated public docs contain the current queue-dispatch context shape; repo troubleshooting says generated docs drift is checked. | medium | low | Run `pnpm docs:check` or `pnpm docs:generate` if docs edits are made. | CI could fail on documentation drift. |
| No additional rollback race assertion is currently missing beyond the already-covered collision cases. | `test/queue-recovery-cascade.test.ts` includes tests for already-queued compiled-resume root safety, blocked rollback when failed/skipped targets already exist, and non-clobbering during descendant unblocking. | medium | low | Re-inspect `rollbackQueuedResume`, `requeueFailedPrdForCompiledResume`, and queue-cascade tests immediately before deciding not to add another collision test. | A subtle no-overwrite race could remain unguarded. |

No low-confidence/high-impact assumptions remain. The only medium-confidence assumptions have low-cost validation paths and are bounded to docs drift or possible extra test coverage, not product behavior.