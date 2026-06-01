---
title: Add Comprehensive Console Recovery Options
created: 2026-06-01
profile: gpt-claude-combo
---

# Add Comprehensive Console Recovery Options

## Problem / Motivation

Roadmap alignment: this supports `docs/roadmap.md` → Console Workbench → “Actionable build control” and “Thin integration strategy”. Console is intended to become the canonical local-first control surface for build steering, including retry/recovery.

Evidence from investigation:

- `packages/console-ui/src/components/now/queue-card.tsx` renders failed rows with verdict text and a single `Inspect cascade` action.
- `packages/console-ui/src/components/now/queue-recovery-dialog.tsx` calls `fetchQueueRecoveryAnalysis` and `applyQueueRecovery`, which hit `/api/queue/recovery/analyze` and `/api/queue/recovery/apply`.
- Console’s current “Apply recovery” applies queue-cascade retry/reactivation. It does not apply the sidecar verdict route `/api/recover/apply`.
- Legacy Monitor exposes sidecar report UX in `packages/monitor-ui/src/components/recovery/sidecar-sheet.tsx` and lazy-fetches the markdown sidecar via `/api/recovery/sidecar`.
- Daemon routes already exist for sidecar recovery and resume: `/api/recovery/sidecar`, `/api/recover`, `/api/recover/apply`, and `/api/recover/resume-build`.
- The `/eforge:recover` skill already presents compiled-build resume alongside verdict-based recovery actions.
- The concrete failed build `add-plan-set-mutation-workflows-and-safe-build-handoff` has a `manual / medium` sidecar, a feature branch, and compiled artifacts under `eforge/plans/...`, but Console only offers the queue-cascade dialog.

Problem statement:

Console currently exposes failed PRDs through a queue-centric action labelled `Inspect cascade`. For failed builds with recovery sidecars, this is misleading: the modal only presents queue cascade retry/reactivation, and its `Apply recovery` button calls the queue-cascade route rather than the sidecar verdict apply route.

User-visible impact:

- Users cannot inspect the full recovery markdown sidecar from Console.
- Users cannot tell what `Apply recovery` will do.
- Manual verdicts still present queue retry/reactivation as the primary path.
- Resumable builds do not show a resume option even when feature branch and compiled artifacts exist.
- Console lacks a comprehensive decision surface for failed-build recovery.

Confirmed constraints:

- Route constants and wire types should remain owned by `@eforge-build/client`; Console should not inline `/api/...` path literals.
- Console uses shadcn/ui components and is the active dashboard; `monitor-ui` is legacy reference material.
- No recovery mutation should happen without explicit user confirmation.

## Goal

Console should provide a comprehensive failed-build recovery surface that clearly separates sidecar verdict recovery, compiled-build resume, and advanced queue-cascade retry/reactivation.

Users should be able to inspect recovery reports, understand recommended actions, see resume eligibility, and explicitly confirm any mutation before it runs.

## Approach

### High-level implementation

- Replace the failed-row `Inspect cascade` entry point with a user-facing recovery entry point such as `Recover…` or `Review recovery options`.
- Add a Console recovery dialog/sheet that leads with failure summary, sidecar verdict, recovery report access, recommended action, and alternate actions.
- Fetch and render recovery sidecars in Console using the existing daemon sidecar route.
- Expose sidecar verdict actions distinctly from queue-cascade actions:
  - `retry` verdict re-queues the failed PRD via `/api/recover/apply`.
  - `split` verdict enqueues the suggested successor via `/api/recover/apply`.
  - `abandon` verdict archives/removes the failed PRD via `/api/recover/apply`.
  - `manual` verdict presents manual review guidance and does not make sidecar apply primary.
- Add a resumability affordance for failed PRDs when compiled-build resume is available.
- Add a read-only resume eligibility API or equivalent daemon/client projection so Console can show whether resume is available before starting a worker.
- Add a Console action for compiled-build resume that calls `/api/recover/resume-build` only after explicit user confirmation.
- Keep queue-cascade retry/reactivation available as an advanced action, clearly described as retrying the failed upstream and reactivating skipped descendants.
- Render recovery markdown safely.

### Design decisions

1. Make sidecar verdict recovery the primary recovery concept in Console.

   Rationale: Failed PRDs already carry `recoveryVerdict` in the queue payload, and the full sidecar is the authoritative human-readable recovery report. Queue cascade recovery is a lower-level queue repair/retry operation and should not be the only or primary failed-build action.

2. Keep queue-cascade retry/reactivation as an advanced option.

   Rationale: `/api/queue/recovery/analyze` and `/api/queue/recovery/apply` are useful for retrying a failed upstream and reactivating skipped descendants, but they can contradict a `manual` or low-confidence verdict. Advanced placement and explicit copy reduce accidental or misleading use.

3. Add read-only resume eligibility before exposing the Resume button as available.

   Rationale: Starting `/api/recover/resume-build` spawns a background worker. Console needs a preflight state so users understand whether resume is possible and why it may be unavailable.

4. Reuse shared client helpers rather than inlining `/api/...` paths in Console.

   Rationale: Project conventions require daemon route constants and wire shapes to live in `@eforge-build/client`. Console should import browser-safe helpers and route types from the client package.

5. Manual verdicts should not show sidecar `Apply recovery` as a primary mutation.

   Rationale: `manual` apply is a no-op for `/api/recover/apply`, while queue-cascade apply would requeue/delete sidecars despite the report recommending manual review. The primary UI should say manual review is required and list safe alternatives.

6. Resume is an alternate recovery path, not a replacement for verdict actions.

   Rationale: The `/eforge:recover` skill already presents compiled-build resume alongside verdict-recommended actions. Console should mirror that model: users choose between following the verdict, resuming preserved compiled work, re-running analysis, or advanced retry/cascade.

7. Render recovery markdown safely.

   Rationale: Legacy Monitor uses `marked` plus `DOMPurify`. Console should use the same safe rendering approach or an equivalent existing markdown renderer/sanitizer pattern.

### Expected implementation targets

Console UI:

- `packages/console-ui/src/components/now/queue-card.tsx`: rename/replace the failed-row action and wire it to the new recovery surface.
- `packages/console-ui/src/components/now/queue-recovery-dialog.tsx`: replace or refactor into a broader failed-build recovery dialog. Preserve queue-cascade analysis as an advanced subsection rather than the primary modal.
- `packages/console-ui/src/components/recovery/verdict-chip.tsx`: reuse existing Console verdict chip for summary/action cards.
- New Console recovery components may be appropriate under `packages/console-ui/src/components/recovery/` or `packages/console-ui/src/components/now/` to keep the dialog readable and maintainable.
- Console tests under `packages/console-ui/src/components/now/__tests__/` and/or `packages/console-ui/src/components/recovery/__tests__/` should cover route/action selection and visible decision copy.

Client/daemon API:

- `packages/client/src/routes.ts`: add resume eligibility request/response route types if a new endpoint is chosen.
- `packages/client/src/api/*` and `packages/client/src/browser*.ts`: add shared typed helpers for reading sidecars, triggering recovery analysis, applying sidecar verdicts, starting resume, and checking resume eligibility.
- Browser-safe helpers should prevent Console from inlining fetch paths.
- `packages/client/src/browser.ts` and `packages/client/src/index.ts`: export new helper types/functions.
- `packages/monitor/src/server.ts` or a focused route module: add read-only resume eligibility route and reuse existing resume eligibility logic from `packages/engine/src/resume/compiled-build.ts`.

Engine:

- `packages/engine/src/resume/compiled-build.ts`: existing `checkResumeEligibility` is the likely source of truth for read-only eligibility.
- If `checkResumeEligibility` currently has side effects such as recreating merge worktrees, add a safe projection or document/contain those side effects before using it from a GET-like UI route.

Legacy reference:

- `packages/monitor-ui/src/components/recovery/sidecar-sheet.tsx` provides prior art for markdown sidecar rendering and verdict-specific buttons.
- `packages/monitor-ui/src/lib/api.ts` and `packages/monitor-ui/src/lib/swr-fetcher.ts` show existing local fetch wrappers, but new Console work should prefer shared client helpers.

Validation targets:

- Unit/component tests for Console dialog states.
- Client route/helper tests if new routes/helpers are added.
- Monitor route tests for resume eligibility if a new daemon endpoint is added.
- Existing full checks: `pnpm type-check`, `pnpm test`, and targeted Console tests.

### Assumptions and validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| Console can add browser-safe helpers for sidecar/apply/recover/resume through `@eforge-build/client/browser`. | `packages/client/src/browser.ts` already exports route types and queue recovery browser helpers; no Console `src/lib/api.ts` exists. | high | low | Implement helpers and run type-check. | Console may duplicate fetch logic if helpers are not added, violating route ownership conventions. |
| A new read-only resume eligibility endpoint is needed for good UX. | Existing `/api/recover/resume-build` spawns a worker, and queue payload only exposes `recoveryVerdict`. | high | medium | Add route test that checks eligible and ineligible shapes without spawning a worker. | Without preflight, Console either hides resume or starts workers speculatively. |
| `checkResumeEligibility` can be reused or adapted for eligibility projection. | `packages/engine/src/resume/compiled-build.ts` owns feature-branch/artifact/failure-evidence checks. | medium | medium | Inspect and, if necessary, extract a no-surprise eligibility projection that avoids unexpected mutation. | A GET-like route might create worktrees or perform heavier git operations than expected. |
| The legacy sidecar rendering pattern is suitable for Console. | Legacy Monitor successfully renders markdown sidecars using `marked` and `DOMPurify`. | high | low | Port or reuse the pattern and add component tests. | If Console has different styling/security constraints, UI work may need adjustment. |
| Queue-cascade recovery should remain available. | Existing Console tests cover `QueueRecoveryDialog`; daemon has dedicated queue recovery route module. | high | low | Preserve advanced action tests and update labels/copy. | Removing it would regress skipped-descendant reactivation workflows. |
| No plugin/Pi command changes are required. | This is a Console/daemon/client UI feature; Pi/Claude skills already expose recover/resume workflows. | medium | low | Re-check `packages/pi-eforge/skills/eforge-recover` and `eforge-plugin/skills/recover` after implementation. | Consumer-facing workflow drift could remain if Console introduces new semantics not represented in skills. |

### Profile signal

Recommended profile: Excursion.

Rationale: This is a cohesive cross-package feature touching Console UI, shared client helpers, and a daemon read-only eligibility route. A single planner can enumerate the implementation targets and dependencies without delegated module planning. It is broader than an errand because it changes user-facing recovery workflows and daemon/client contracts, but it does not require Expedition-level module decomposition.

## Scope

### In scope

- Replace the failed-row `Inspect cascade` entry point with a user-facing recovery entry point such as `Recover…` or `Review recovery options`.
- Add a Console recovery dialog/sheet that leads with failure summary, sidecar verdict, recovery report access, recommended action, and alternate actions.
- Fetch and render recovery sidecars in Console using the existing daemon sidecar route.
- Expose sidecar verdict actions distinctly from queue-cascade actions.
- Use `/api/recover/apply` to re-queue the failed PRD for a `retry` verdict.
- Use `/api/recover/apply` to enqueue the suggested successor for a `split` verdict.
- Use `/api/recover/apply` to archive/remove the failed PRD for an `abandon` verdict.
- Present manual review guidance for a `manual` verdict.
- Ensure a `manual` verdict does not make sidecar apply primary.
- Add a resumability affordance for failed PRDs when compiled-build resume is available.
- Add a read-only resume eligibility API or equivalent daemon/client projection so Console can show whether resume is available before starting a worker.
- Add a Console action for compiled-build resume that calls `/api/recover/resume-build` only after explicit user confirmation.
- Keep queue-cascade retry/reactivation available as an advanced action.
- Clearly describe queue-cascade retry/reactivation as retrying the failed upstream and reactivating skipped descendants.
- Add tests for the new recovery option rendering.
- Add tests for action routing.
- Add tests for warning/confirmation behavior.
- Add tests for resume eligibility states.

### Out of scope

- Changing engine recovery verdict semantics.
- Changing compiled-build resume execution semantics.
- Removing legacy Monitor recovery UX.
- Building a full recovery wizard for non-failed queue items.
- Automatically applying any recovery action without user confirmation.
- Solving ambiguous recovery analysis quality beyond exposing report, re-run analysis, and manual guidance.

## Acceptance Criteria

- Failed PRD rows in Console show a recovery entry point labelled `Recover…` or `Review recovery options` instead of `Inspect cascade`.
- Opening the recovery entry point displays the PRD title.
- Opening the recovery entry point displays the PRD id.
- Opening the recovery entry point displays the sidecar verdict.
- Opening the recovery entry point displays the sidecar confidence.
- Opening the recovery entry point displays the recovery report status.
- Console renders markdown from `GET /api/recovery/sidecar?prdId=...` for a failed PRD with a sidecar.
- Console shows a clear “recovery pending” state when a failed PRD has no sidecar.
- Console offers to run recovery analysis when a failed PRD has no sidecar.
- A `retry` verdict presents a confirmed action that calls the sidecar verdict apply route.
- A `retry` verdict labels the sidecar verdict apply result as re-queueing the PRD.
- A `split` verdict presents a confirmed action that calls the sidecar verdict apply route.
- A `split` verdict labels the sidecar verdict apply result as enqueuing the successor PRD.
- An `abandon` verdict presents a confirmed action that calls the sidecar verdict apply route.
- An `abandon` verdict labels the sidecar verdict apply result as archiving or removing the failed PRD.
- A `manual` verdict does not present sidecar verdict apply as a primary mutation.
- The queue-cascade retry/reactivation action is visible only as an advanced option.
- The queue-cascade retry/reactivation action includes copy that states it moves the failed upstream back to the queue.
- The queue-cascade retry/reactivation action includes copy that states it may reactivate skipped descendants.
- The advanced queue-cascade action warns when the recovery sidecar verdict is `manual`.
- The advanced queue-cascade action warns when the recovery sidecar verdict has low confidence.
- Console displays a resume option when the daemon reports that compiled-build resume is eligible for the failed PRD.
- Console displays the daemon-provided ineligibility reason when compiled-build resume is not eligible for the failed PRD.
- Clicking the resume action requires explicit confirmation before calling `/api/recover/resume-build`.
- Starting resume shows the returned session id.
- Starting resume shows the returned process id.
- Starting resume shows a clear daemon error message when the daemon returns an error.
- Browser-safe client helpers are used for new Console recovery requests instead of inlining route literals in Console code.
- Tests cover `retry` verdict action routing.
- Tests cover `split` verdict action routing.
- Tests cover `abandon` verdict action routing.
- Tests cover `manual` verdict action routing.
- Tests cover the resume eligible UI state.
- Tests cover the resume ineligible UI state.
- Tests cover the advanced queue-cascade path separately from sidecar verdict apply.
- `pnpm type-check` exits 0.
- `pnpm test` exits 0.
