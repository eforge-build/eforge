---
id: plan-02-accept-success-recovery-backend
name: Accept Build as Successful Backend Recovery Action
branch: fix-recovery-actions-ux-after-successor-enqueue-or-resume/plan-02-accept-success-recovery-backend
agents:
  builder:
    effort: xhigh
    rationale: This plan adds a new audited recovery API that coordinates sidecar
      idempotency, git cleanup, landing behavior, artifact/completion records,
      and skipped dependent moves.
  reviewer:
    effort: high
    rationale: The mutating route accepts user input and invokes
      filesystem/git/landing operations, so review must inspect validation,
      idempotency, and command-boundary safety.
---

# Accept Build as Successful Backend Recovery Action

## Architecture Context

The accepted-success action is a focused human recovery path for failed PRDs whose implementation and deterministic checks are acceptable but final PRD or acceptance validation failed because the generated criterion was bad, conflicting, or externally unverifiable. This is not a general recovery framework. It uses the durable sidecar applied metadata from plan-01 and exposes route contracts through `@eforge-build/client`.

The action must be audited, idempotent after the sidecar marker is written, and explicit about dependent unblocking. Failed PRD files and sidecars remain in `queue/failed/` as audit records.

## Implementation

### Overview

Add client route types/helpers, monitor routes, and engine recovery helpers for previewing and applying an `accepted-success` recovery action. The apply route requires a reason category, a freeform note, and selected dependent ids. It creates or no-ops the normal cleanup commit, applies the configured landing action, records artifact/completion metadata for dependency readiness, moves selected unblockable skipped dependents back to the queue root, and writes durable sidecar metadata.

### Key Decisions

1. Provide separate preview and apply contracts: preview lists effects and candidate dependents; apply mutates only after explicit user confirmation.
2. Reuse the plan-01 `applied` sidecar field with `action: 'accepted-success'` as the idempotency anchor.
3. Use existing landing policy values (`pr`, `merge`, `leave`) from project configuration and existing landing helpers where feasible.
4. Move only selected, direct skipped dependents whose remaining dependencies are satisfied; leave blocked or unselected dependents in `skipped/` and record both groups in the response.
5. Bump `DAEMON_API_VERSION` again because first-party Console will call new recovery routes.

## Scope

### In Scope

- Client-owned preview/apply route constants, request types, response types, and browser/node helpers.
- Engine helper for accepted-success eligibility, cleanup, landing, artifact/completion recording, sidecar metadata, and dependent unblocking.
- Monitor route/service wrappers with local mutation security and path-segment validation.
- Idempotent reapply behavior based on the durable sidecar marker.
- Tests for validation failures, preview candidates, first apply, reapply, cleanup no-op, landing result reporting, and dependent unblocking.

### Out of Scope

- Console UI for the action; plan-03 adds the form and completion rendering.
- General-purpose recovery workflow orchestration.
- Accepting a failed build without a reason category and non-empty note.
- Deleting the failed PRD or recovery sidecars as part of acceptance.
- Re-running validation or changing acceptance criteria extraction.

## Files

### Create

- `packages/engine/src/recovery/accept-success.ts` — accepted-success preview/apply helper, eligibility checks, cleanup/landing orchestration, artifact/completion upserts, and skipped dependent movement.
- `packages/monitor/src/routes/recovery-accept-success-service.ts` — monitor-facing validation and service functions for preview/apply route handlers.
- `packages/client/src/api/accept-recovery-success.ts` — Node-side typed daemon helpers for accepted-success preview/apply.

### Modify

- `packages/client/src/routes/route-map.ts` — add `acceptRecoverySuccessPreview` and `acceptRecoverySuccess` route keys.
- `packages/client/src/routes/recovery.ts` — add reason category union, preview/apply request and response interfaces, cleanup/landing/dependent result shapes, and accepted-success applied metadata fields.
- `packages/client/src/routes.ts` — re-export accepted-success route contracts.
- `packages/client/src/browser-recovery.ts` — add `fetchAcceptSuccessPreview()` and `acceptRecoverySuccess()` using `API_ROUTES`.
- `packages/client/src/browser.ts` and `packages/client/src/index.ts` — export accepted-success helpers and types.
- `packages/client/src/api-version-const.ts` — bump the daemon API version and document the new accepted-success routes.
- `packages/engine/src/recovery/applied-sidecar.ts` — extend validation/writer helpers for `accepted-success` applied metadata.
- `packages/engine/src/artifacts/index.ts` — export any artifact/completion helpers needed by tests only if existing exports are insufficient.
- `packages/monitor/src/routes/recovery.ts` — register preview/apply accepted-success route handlers or delegate to the new service.
- `packages/monitor/src/routes/control-monitor.ts` — add route keys to `CONTROL_MONITOR_ROUTE_KEYS`.
- `packages/monitor/src/__tests__/routes-control-registration.test.ts` — add the new route keys to the sensitive route list.
- `packages/monitor/src/__tests__/routes-recovery.test.ts` or a new colocated route test — cover preview/apply validation and successful accepted-success responses.
- `test/apply-recovery.test.ts` — add engine-level accepted-success helper tests if the helper is exported from `@eforge-build/engine/recovery/accept-success`.
- `test/apply-recovery-route.test.ts` — add route-level accepted-success tests, keeping them under the existing `apply-recovery` Vitest filter.

## Implementation Notes

- Suggested reason categories are the exact values `bad_acceptance_criterion`, `manual_verification_passed`, `external_or_inconclusive_criterion_waived`, and `other`.
- Preview response should expose `status: 'eligible' | 'ineligible' | 'already-applied'`, the effective landing action, cleanup effects, durable audit fields that will be written, and direct skipped dependent candidates.
- Apply request should include `prdId`, `reasonCategory`, `reason`, and `unblockDependentIds`.
- Eligibility must require a sidecar summary that indicates PRD or acceptance validation failure and evidence of acceptable implementation: non-empty landed commits plus deterministic validation command evidence whose exit codes are all `0` when commands are present.
- Cleanup should run against the feature branch worktree for `summary.setName`, compare `HEAD` before/after, and report `cleanup.status` as `committed` with `commitSha` or `noop` when artifacts are absent.
- Landing should return a typed result with action, status, PR URL, merge commit SHA, branch name, or failure/skipped reason when available.
- Artifact/completion records should be upserted for the accepted PRD after cleanup so selected dependents can treat the accepted build as satisfied after their accepted dependency is removed.
- Dependent movement must remove only the accepted PRD id from `depends_on`; if no dependencies remain, remove the `depends_on` frontmatter line instead of writing an empty array when practical.
- Reapply after an `accepted-success` marker must return `status: 'already-applied'` and the recorded cleanup, landing, reason, and dependent results without running cleanup, landing, or moves again.
- If the sidecar already has an applied action other than `accepted-success`, apply must return a conflict or ineligible response rather than overwriting that audit state.

## Verification

- [ ] Preview returns `status: 'eligible'` for an acceptance-validation or PRD-validation failure sidecar with landed commits and passing validation command evidence.
- [ ] Apply returns HTTP 400 when `reasonCategory` is missing, invalid, or `reason` trims to an empty string.
- [ ] First accepted-success apply writes `json.applied.action === 'accepted-success'`, a non-empty accepted timestamp, reason category, freeform reason, cleanup result, landing result, and dependent unblock result.
- [ ] First accepted-success apply creates a cleanup commit when plan/PRD artifacts exist, or returns `cleanup.status === 'noop'` when those artifacts are absent.
- [ ] Accepted-success apply returns a PR URL for `landing.action === 'pr'`, a merge commit SHA for `landing.action === 'merge'`, or branch status for `landing.action === 'leave'` when the underlying landing helper reports those values.
- [ ] Reapplying accepted-success returns `status: 'already-applied'` and does not create a new cleanup commit, PR, merge commit, or dependent move.
- [ ] A selected skipped dependent that directly depends on the accepted PRD moves to the queue root with that dependency removed.
- [ ] A selected skipped dependent with another unresolved blocker remains in `skipped/` and appears in the response `remainedBlocked` list.
- [ ] `pnpm test -- apply-recovery` exits 0.
- [ ] `pnpm type-check` exits 0.
