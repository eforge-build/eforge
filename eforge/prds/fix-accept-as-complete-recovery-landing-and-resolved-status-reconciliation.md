---
title: Fix accept-as-complete recovery landing and resolved status reconciliation
created: 2026-06-05
landing: pr
landing_auto_merge: true
---

# Fix accept-as-complete recovery landing and resolved status reconciliation

## Problem / Motivation

Accepting a failed build as complete from Console should mean the operator has resolved the build outcome: the accepted build should land through the same safety semantics as normal PR landing, inherit the original per-run landing intent, and stop presenting as an unresolved failure.

Roadmap alignment: this is aligned with `docs/roadmap.md` under **Kernel Resilience and Typed Recovery** and **Console Observability and Control**. It keeps the engine headless and uses daemon/client primitives rather than adding host-only workflow behavior.

User-reported defect evidence is captured in backlog item `backlog-2026-06-05-accept-as-complete-recovery-skips-normal-pr-preflight-and-le`: Console UI `accept-as-complete` created a PR but skipped the normal direct-PR origin-trunk rebase/freshness behavior, did not preserve the original build's auto-merge intent, and left resolved failures visible as `Needs attention` / failed Build health.

Observed behavior:

- Console UI `accept-as-complete` created a PR for `Design eforge-plan Extension MVP and Data Model`.
- The PR path did not perform the normal direct-PR rebase/freshness flow against `origin/<trunk>` before creating the PR.
- The PR did not preserve the original build's auto-merge setting (`landing_auto_merge`/`landingAutoMerge`) that was selected when `/eforge:build` was run.
- Console continued to show `Needs attention` for the failed PRD with `recovery applied: accepted-success`.
- Console Build health continued to count the accepted build as failed.

Why it matters: accepted-success is a typed recovery path for human-approved validation/acceptance false negatives. If it bypasses PR safety checks or leaves dashboards in a failed state, operators cannot trust recovery actions and may miss real unresolved failures among stale warning noise.

Relevant code evidence:

- `packages/engine/src/recovery/accept-success.ts` implements accepted-success cleanup, landing, artifact/completion recording, dependent unblocking, and sidecar marker writing.
- `landAcceptedSuccessBuild` in `accept-success.ts` handles PR landing with raw `git push origin <featureBranch>` and `gh pr create --base <baseBranch> --head <featureBranch> --fill`; it does not call `syncDirectPrBase`, does not run direct-PR freshness guards, and does not enable PR auto-merge.
- `packages/engine/src/direct-pr-base-sync.ts` owns normal direct non-stacked PR base synchronization and freshness checking: fetch `origin/<baseBranch>`, rebase the feature branch onto the fetched base before validation/PR, and check freshness before publishing.
- `packages/engine/src/landing.ts` and `packages/engine/src/worktree-manager.ts` show normal PR landing goes through `worktreeManager.issuePr(...)` and then `resolvePrAutoMergeIntent(prAutoMergePolicy, landingAutoMerge)` plus `enablePrAutoMerge` when requested.
- `packages/monitor/src/routes/recovery-accept-success-service.ts` resolves config landing action but does not pass per-run `landingAutoMerge` from the failed PRD/frontmatter into the engine helper.
- `packages/monitor/src/projections/queue-items.ts` projects failed queue entries with valid accepted-success sidecar metadata as status `failed` plus `recoveryApplied`; `packages/console-ui/src/lib/selectors/now.ts` then surfaces all failed queue items with recovery verdicts in Needs attention even when `recoveryApplied.action === 'accepted-success'`.
- `packages/console-ui/src/lib/selectors/metrics.ts` computes Build health from `RunInfo.status`; the original build run remains `failed` in `monitor.db`, so accepted-success is still counted as failed unless the accepted resolution updates run status or the projection layer has enough accepted-success context to override it.

Root cause 1 — accepted-success PR landing is a parallel implementation, not the normal direct-PR path.

- `packages/engine/src/recovery/accept-success.ts` implements `landAcceptedSuccessBuild` locally.
- For `landingAction === 'pr'`, it directly runs `git push origin <featureBranch>` and `gh pr create --base <baseBranch> --head <featureBranch> --fill`.
- Normal PR landing in `packages/engine/src/landing.ts` delegates to `worktreeManager.issuePr(...)`, which supports pre-push and pre-create freshness guards and auto-merge event behavior.
- Normal direct PR base sync lives in `packages/engine/src/direct-pr-base-sync.ts`; accepted-success does not use it.

Root cause 2 — accepted-success does not carry per-run `landingAutoMerge` intent.

- The failed PRD frontmatter can contain `landing_auto_merge`, and enqueue/build code maps per-run `landingAutoMerge` to queue frontmatter/engine options.
- `AcceptSuccessHelperOptions` has `landingAction` but no `landingAutoMerge` or `prAutoMergePolicy` field.
- `resolveHelperOptions` reads `config.landing.action` but not failed PRD frontmatter and not `config.landing.pr.autoMerge`.
- `landAcceptedSuccessBuild` has no `resolvePrAutoMergeIntent` call and no `gh pr merge --auto --merge` equivalent.

Root cause 3 — accepted-success writes durable sidecar/completion metadata but does not reconcile operator-facing failed status.

- `applyAcceptSuccess` writes artifact/completion registries and an accepted-success sidecar marker, but it does not update monitor run status or emit a run upsert.
- `packages/monitor/src/projections/queue-items.ts` projects a failed-directory PRD with `recoveryApplied.action === 'accepted-success'` as a queue item whose status is still `failed`.
- `packages/console-ui/src/lib/selectors/now.ts` intentionally surfaces failed queue items with recovery verdicts in Needs attention; it only changes detail text when `recoveryApplied` exists and does not suppress accepted-success as resolved.
- Build health uses run statuses via `selectNowMetricsPanel`, so a build run stored as `failed` remains a failed health datum.

## Goal

Accepted-success recovery should reuse normal direct-PR landing safety behavior, preserve the original build’s auto-merge intent, and reconcile resolved status so accepted builds no longer appear as unresolved failures in Console or monitor projections.

## Approach

Keep the fix DRY: accepted-success must reuse shared landing/direct-PR workflow components instead of growing a second hand-rolled PR landing implementation.

Prefer factoring the existing normal direct-PR base sync, freshness guard, PR creation, and auto-merge behavior behind a reusable helper/adapter that both normal landing and accepted-success can call.

Accepted-success should not continue to own raw `git push origin <featureBranch>` / `gh pr create` / auto-merge command sequencing when the normal landing path already owns that policy.

Reuse or factor the normal direct PR base-sync/freshness helper for accepted-success PR landing before PR creation. The feature branch should be rebased onto fetched `origin/<baseBranch>` when needed and should fail closed if the rebase/freshness check cannot be completed.

Preserve original per-run auto-merge intent by reading `landing_auto_merge` from the failed PRD frontmatter and passing it through accepted-success helper options. Also pass project `landing.pr.autoMerge` policy so accepted-success can decide auto-merge the same way normal PR landing does.

Ensure accepted-success PR landing enables GitHub auto-merge when normal landing would have done so. The durable `accepted-success` applied marker should include enough landing information to audit auto-merge completion/skipping/failure, either by extending the landing result shape or by recording a clear reason.

Reconcile resolved status so accepted-success no longer appears as unresolved attention and no longer counts as a failed Build health outcome. Prefer a canonical monitor-side projection/update over UI-only filtering so REST, stream snapshots, and UI agree. If retaining failed queue files for audit remains intentional, project them as resolved/accepted for dashboard purposes or suppress them from attention once `recoveryApplied.action === 'accepted-success'` and landing status is complete.

Add regression tests for shared landing reuse, PR base sync, auto-merge preservation, attention suppression, and Build health classification.

Implementation targets:

- `packages/engine/src/recovery/accept-success.ts`
- `packages/monitor/src/routes/recovery-accept-success-service.ts`
- `packages/monitor/src/projections/queue-items.ts` and/or `packages/console-ui/src/lib/selectors/now.ts`
- `packages/console-ui/src/lib/selectors/metrics.ts` or the monitor run/status projection if accepted-success should update canonical run status
- Tests in `test/apply-recovery-route.test.ts`, `test/direct-pr-base-sync.test.ts` or a focused accepted-success test, `packages/monitor/src/__tests__/projections-queue-items.test.ts`, `packages/console-ui/src/__tests__/metrics-selectors.test.ts`, and `packages/console-ui/src/__tests__/now-selectors.test.ts` as applicable.

Recommended profile: **Excursion**.

Rationale: this is a cross-package bugfix touching engine recovery landing, monitor route/projection state, client route contracts, and Console selectors/tests. It is not an Expedition because the implementation is cohesive and can be planned as one direct fix rather than delegated module subplanning. It is not an Errand because it changes safety-sensitive PR landing behavior and dashboard recovery semantics.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
| --- | --- | --- | --- | --- | --- |
| The failed PRD file is the right source for the original per-run `landing_auto_merge` intent. | Queue frontmatter carries build enqueue options; the observed failed PRD had `landing_auto_merge: true`; `packages/monitor/src/projections/queue-items.ts` already parses failed queue frontmatter for queue projection. | high | low | Add a test failed PRD with `landing_auto_merge: true` and assert accepted-success preview/apply sees it. | Auto-merge preservation could still fail for builds whose intent was stored elsewhere. |
| Accepted-success PR landing should follow the normal direct non-stacked PR base sync/freshness semantics. | User explicitly reported the skipped rebase as incorrect; `packages/engine/src/direct-pr-base-sync.ts`, `packages/engine/src/orchestrator/phases.ts`, and `packages/engine/src/landing.ts` establish this as the normal direct-PR safety path. | high | medium | Add an integration-style git test with origin/main advanced and assert accepted-success rebases before PR creation. | PRs created by recovery could be stale or conflict-prone. |
| Updating canonical monitor run status or an equivalent monitor-side projection is preferable to UI-only filtering for Build health. | `selectNowMetricsPanel` only receives `NowRecentRunItem` values derived from REST/stream `RunInfo`; REST `/api/runs` and stream snapshot parity are documented project constraints in AGENTS.md. | medium | medium | Inspect monitor DB/event model during implementation and add REST-vs-stream tests for the chosen projection/update. | UI could look fixed while API and stream consumers still see the build as failed. |
| Retaining failed PRD/sidecar files as audit records may remain intentional. | `packages/engine/src/recovery/accept-success.ts` explicitly documents that failed PRD and sidecars remain in `queue/failed/` as audit records. | medium | low | Decide in implementation whether to keep files and project resolved state, or move/delete files with audit-preserving replacement metadata. | Deleting files could break recovery audit/idempotency; retaining files without projection could preserve stale warnings. |
| Adding optional auto-merge fields to accepted-success route responses is backward-compatible. | Existing client route contracts are TypeScript interfaces and TypeBox snapshot schemas allow additive optional fields when updated consistently; no current consumer requires exact response key sets. | medium | low | Update client route types/schema tests and console tests; run type-check. | A strict consumer could reject the response if schemas are not updated consistently. |

No low-confidence/high-impact assumptions remain unresolved. The highest-risk design choice is how to represent resolved run/queue status canonically; the acceptance criteria require REST/stream/UI parity while leaving the exact implementation mechanism to the builder after inspecting monitor projection constraints.

## Scope

In scope:

- Reusing or factoring normal direct-PR landing/base-sync/freshness behavior for accepted-success PR landing.
- Removing accepted-success dependence on a parallel raw `git push origin <featureBranch>` plus raw `gh pr create` command sequence.
- Reading `landing_auto_merge` from failed PRD frontmatter.
- Passing per-run `landingAutoMerge` through accepted-success helper options.
- Passing project `landing.pr.autoMerge` policy through accepted-success helper options.
- Enabling GitHub auto-merge for accepted-success PRs when normal landing would have done so.
- Recording accepted-success auto-merge completion, skip reason, or failure reason in the applied response and durable marker/audit information.
- Reconciling accepted-success-resolved queue/run status so dashboards, REST responses, and stream snapshots agree.
- Keeping failed PRD/sidecar files as audit records if the implementation projects resolved state correctly.
- Adding regression coverage for engine recovery landing, monitor projections, Console selectors, and REST/stream parity.

Out of scope:

- Adding host-only workflow behavior.
- Moving scheduling, triggers, approvals, notifications, or richer workflow orchestration into the engine.
- UI-only filtering as the preferred final fix when monitor-side canonical projection/update is feasible.

## Acceptance Criteria

- Accepted-success PR landing reuses shared direct-PR landing/base-sync components instead of maintaining an independent hand-rolled PR landing command sequence.
- A static discipline test or equivalent regression test fails if `packages/engine/src/recovery/accept-success.ts` directly constructs both raw `git push origin <featureBranch>` and raw `gh pr create` commands for accepted-success PR landing.
- A regression test for accepted-success PR landing creates a local git remote where `origin/main` advances beyond the accepted feature branch and asserts the accepted feature branch HEAD contains the advanced `origin/main` commit before PR creation.
- A regression test for accepted-success PR landing records command order and asserts the remote base fetch occurs before the fake `gh pr create` command.
- A regression test for accepted-success PR landing simulates a direct PR base-sync failure and asserts the fake `gh pr create` command is not invoked.
- A regression test for accepted-success PR landing simulates a final freshness failure after base sync and asserts the fake `gh pr create` command is not invoked.
- A regression test seeds a failed PRD with `landing_auto_merge: true`, project `landing.action: pr`, and project `landing.pr.autoMerge: ask`, applies accepted-success, and asserts the fake `gh pr merge --auto --merge` command is invoked for the created PR.
- A regression test seeds a failed PRD with `landing_auto_merge: false` and project `landing.pr.autoMerge: always`, applies accepted-success, and asserts the fake `gh pr merge --auto --merge` command is not invoked.
- A regression test seeds a failed PRD without `landing_auto_merge` and project `landing.pr.autoMerge: always`, applies accepted-success, and asserts the fake `gh pr merge --auto --merge` command is invoked according to the project policy default.
- A regression test seeds a failed PRD without `landing_auto_merge` and project `landing.pr.autoMerge: ask`, applies accepted-success, and asserts the fake `gh pr merge --auto --merge` command is not invoked according to the project policy default.
- The accepted-success preview response includes `landingAutoMerge: true` when the failed PRD frontmatter contains `landing_auto_merge: true`.
- The accepted-success preview response includes `landingAutoMerge: false` when the failed PRD frontmatter contains `landing_auto_merge: false`.
- The accepted-success preview response omits `landingAutoMerge` when the failed PRD frontmatter omits `landing_auto_merge`.
- The accepted-success apply response includes `applied.landing.autoMerge.status: "complete"` when auto-merge is enabled successfully.
- The accepted-success apply response includes `applied.landing.autoMerge.status: "skipped"` with a non-empty `reason` when auto-merge is not requested by the effective policy and per-run intent.
- The accepted-success apply response includes `applied.landing.autoMerge.status: "failed"` with a non-empty `reason` when the fake `gh pr merge --auto --merge` command fails.
- A monitor queue projection test asserts a failed queue item with `recoveryApplied.action === "accepted-success"` and `recoveryApplied.landing.status === "complete"` is projected so it is not actionable as an unresolved failed PRD.
- A Now dashboard selector test asserts a failed queue item with `recoveryApplied.action === "accepted-success"` and `recoveryApplied.landing.status === "complete"` is absent from the Needs attention list.
- A Now dashboard selector test asserts a failed queue item with `recoveryApplied.action === "accepted-success"` and `recoveryApplied.landing.status === "failed"` remains present in the Needs attention list with the landing failure reason.
- A Build health selector or projection test asserts an accepted-success-resolved build contributes to the landed/completed count and does not contribute to the failed count.
- A Build history selector or projection test asserts an accepted-success-resolved build is classified as completed.
- A monitor REST/stream parity test asserts `/api/runs` and the daemon stream snapshot expose the same resolved run status for an accepted-success-resolved build.
- A monitor REST/stream parity test asserts `/api/queue` and the daemon stream snapshot expose the same resolved accepted-success queue projection.
- `pnpm type-check` exits 0.
- `pnpm test -- test/apply-recovery-route.test.ts packages/monitor/src/__tests__/projections-queue-items.test.ts packages/console-ui/src/__tests__/now-selectors.test.ts packages/console-ui/src/__tests__/metrics-selectors.test.ts` exits 0.
- `pnpm test` exits 0.

## Manual Verification Notes

Confirmed reproduction evidence from user observation and screenshot:

1. Run an eforge build with effective landing action `pr` and PR auto-merge explicitly enabled via `/eforge:build` / `landingAutoMerge: true`.
2. Let the build fail only at PRD/acceptance validation after deterministic checks and implementation work are acceptable.
3. Open Console UI recovery for the failed PRD.
4. Use the accepted-success / accept-as-complete recovery option.
5. Observe that a GitHub PR is created.
6. Observe that the accepted-success PR path does not perform the normal direct-PR origin trunk/base rebase/freshness behavior before PR creation.
7. Observe that the created PR does not enable/preserve the original build's auto-merge intent.
8. Observe the Now dashboard after the mutation/refresh: `Needs attention` still contains the failed build with detail `recovery applied: accepted-success`.
9. Observe Build health still counts the accepted build as failed.

Local static/code reproduction evidence:

- `landAcceptedSuccessBuild` in `packages/engine/src/recovery/accept-success.ts` uses raw `git push origin featureBranch` and `gh pr create`; there is no call to `syncDirectPrBase`, no `checkDirectPrBaseFreshness`, no `WorktreeManager.issuePr`, and no `enablePrAutoMerge` path.
- `resolveHelperOptions` in `packages/monitor/src/routes/recovery-accept-success-service.ts` resolves config landing fields only; it does not read failed PRD frontmatter to carry forward `landing_auto_merge`.
- `selectNowAttentionItems` in `packages/console-ui/src/lib/selectors/now.ts` includes failed queue items even when `item.recoveryApplied` exists.
- `selectNowMetricsPanel` in `packages/console-ui/src/lib/selectors/metrics.ts` classifies any build/resume run whose status contains `failed` as failed; accepted-success state is not part of the input model.