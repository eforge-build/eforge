---
id: plan-02-console-recovery-ui
name: Console Recovery Dialog and Actions
branch: add-comprehensive-console-recovery-options/plan-02-console-recovery-ui
agents:
  builder:
    effort: high
    rationale: This plan refactors a central Console dialog into a multi-action
      recovery surface with confirmation flows, safe markdown rendering, and
      component tests.
---

# Console Recovery Dialog and Actions

## Architecture Context

Plan-01 adds the client/daemon contract needed by Console. This plan replaces the current queue-cascade-first Console UI with a comprehensive failed-build recovery surface. Sidecar verdict recovery becomes the primary concept, compiled-build resume becomes a distinct alternate action, and queue cascade retry/reactivation remains available only as an advanced action.

Console uses shadcn/ui components and `@eforge-build/client/browser` helpers. Console source must not inline `/api/...` paths or locally redeclare daemon wire shapes.

## Implementation

### Overview

Replace the failed-row `Inspect cascade` entry point with `Recover…`. Refactor `QueueRecoveryDialog` into a broader failed-build recovery dialog that fetches sidecar reports, renders sanitized markdown, shows sidecar verdict actions with confirmation, checks resume eligibility, starts resume with confirmation, and exposes queue-cascade retry/reactivation as an advanced section.

### Key Decisions

1. Keep the component filename `queue-recovery-dialog.tsx` unless the implementation benefits from a new wrapper name.
   - Rationale: existing queue-card wiring and tests already point at this component; the behavior can broaden without forcing a rename.
2. Fetch queue-cascade analysis lazily from the advanced section.
   - Rationale: opening recovery options must lead with sidecar verdicts and resume, not the lower-level cascade repair operation.
3. Use `AlertDialog` confirmations for all mutating or worker-spawning actions.
   - Rationale: no recovery mutation or background resume/analysis worker starts without an explicit user confirmation.
4. Use `marked` plus `DOMPurify` for report markdown rendering.
   - Rationale: legacy Monitor already uses this pattern, and Console already depends on `marked`; `dompurify` must be added to Console dependencies.

## Scope

### In Scope

- Rename the failed-row action from `Inspect cascade` to `Recover…`.
- Display PRD title and PRD id in the recovery dialog header/summary.
- Display sidecar verdict and confidence using `RecoveryVerdictChip` when available.
- Fetch and render recovery sidecar markdown via the browser-safe sidecar helper from plan-01.
- Show recovery report status: loading, loaded, missing/pending, and error.
- Show recovery pending state when no sidecar exists.
- Offer a confirmed recovery-analysis trigger when no sidecar exists.
- For `retry`, show a confirmed primary action that calls sidecar apply and labels the result as re-queueing the PRD.
- For `split`, show a confirmed primary action that calls sidecar apply and labels the result as enqueuing the successor PRD.
- For `abandon`, show a confirmed primary action that calls sidecar apply and labels the result as archiving/removing the failed PRD.
- For `manual`, show manual-review guidance and no primary sidecar apply mutation.
- Check resume eligibility through the plan-01 browser helper and display eligible/ineligible states.
- For eligible resume, show a confirmed action that calls the resume-build helper and then displays returned `sessionId` and `pid`.
- Display daemon error text for sidecar apply, recovery analysis trigger, resume start, sidecar read, and queue-cascade apply failures.
- Keep queue-cascade retry/reactivation as an advanced action with copy that states it moves the failed upstream back to the queue and may reactivate skipped descendants.
- Warn in the advanced section when the sidecar verdict is `manual` or confidence is `low`.
- Preserve queue refresh after successful sidecar apply and successful queue-cascade apply.
- Add component tests for visible copy, route/action selection, confirmations, and resume states.
- Update Console README recovery data-flow documentation.

### Out of Scope

- Changing daemon recovery verdicts.
- Changing compiled-build resume execution.
- Removing legacy Monitor recovery UI.
- Adding recovery controls for non-failed queue rows.
- Adding Pi or Claude Code skill changes.

## Files

### Create

- `packages/console-ui/src/components/recovery/safe-markdown.tsx` — renders markdown with `marked` and `DOMPurify.sanitize`, wrapped in `plan-prose` styling.
- `packages/console-ui/src/components/recovery/__tests__/safe-markdown.test.tsx` — verifies that script tags and event-handler attributes are removed from rendered report HTML.
- Optional small components under `packages/console-ui/src/components/recovery/` if needed to keep `queue-recovery-dialog.tsx` below the project file-size target, such as recovery action cards or confirmation helpers.

### Modify

- `packages/console-ui/package.json` — add `dompurify` as a dependency using the version range already present in the legacy Monitor package.
- `pnpm-lock.yaml` — update the `@eforge-build/console-ui` importer dependency list for `dompurify`.
- `packages/console-ui/src/components/now/queue-card.tsx` — replace the failed-row action label, pass the selected failed item and verdict to the recovery dialog, and keep render/expand interactions fetch-free.
- `packages/console-ui/src/components/now/queue-recovery-dialog.tsx` — broaden the dialog into the full recovery surface; keep queue-cascade analysis/apply in an advanced subsection.
- `packages/console-ui/src/components/now/__tests__/queue-card.test.tsx` — update label assertions and no-fetch expectations.
- `packages/console-ui/src/components/now/__tests__/queue-recovery-dialog.test.tsx` — replace queue-cascade-only tests with sidecar verdict, resume, pending, and advanced queue-cascade tests.
- `packages/console-ui/README.md` — document the comprehensive recovery data flow and advanced queue-cascade placement.

## UI Behavior Details

### Dialog load flow

On open for a failed queue item:

1. Reset previous sidecar/action/resume/advanced state.
2. Fetch sidecar report with `fetchRecoverySidecar({ prdId })`.
   - Treat a 404 as `reportStatus: 'missing'`, not as a fatal dialog error.
   - For other failures, show the daemon error message.
3. Fetch resume eligibility with `fetchResumeEligibility({ prdId })`.
4. Do not fetch queue-cascade analysis until the advanced section is opened or its load button is clicked.

### Sidecar action labels

- `retry`: button label `Re-queue PRD`; confirmation text states the sidecar apply route will move the failed PRD back to the queue.
- `split`: button label `Enqueue successor PRD`; confirmation text states the sidecar apply route will enqueue the suggested successor PRD.
- `abandon`: button label `Archive failed PRD`; confirmation text states the sidecar apply route will archive or remove the failed PRD.
- `manual`: show `Manual review required`; do not render the primary sidecar apply button.

### Resume labels

- Eligible: show `Resume compiled build`; confirmation text includes PRD id and set name.
- Ineligible: show the daemon-provided `reason` text.
- Success: show `Resume started`, `Session: <sessionId>`, and `PID: <pid>`.
- Failure: show the thrown helper error message.

### Advanced queue-cascade copy

The advanced subsection must include both of these strings in visible text:

- `moves the failed upstream back to the queue`
- `may reactivate skipped descendants`

When the sidecar verdict is `manual`, show a warning that queue-cascade retry/reactivation can contradict manual review guidance. When confidence is `low`, show a warning that the recovery verdict has low confidence.

## Verification

- [ ] Failed queue rows render `Recover…` and do not render `Inspect cascade`.
- [ ] Rendering or expanding queue rows does not call `fetch` before the recovery action is clicked.
- [ ] Opening the dialog displays the PRD title and PRD id.
- [ ] Opening the dialog displays the sidecar verdict and confidence when a sidecar exists.
- [ ] Sidecar markdown from the helper appears in a `plan-prose` container.
- [ ] Script tags and inline event attributes from sidecar markdown are absent from rendered HTML.
- [ ] A missing sidecar displays `recovery pending` and a confirmed `Run recovery analysis` action.
- [ ] The recovery-analysis action calls the browser recovery trigger helper only after confirmation.
- [ ] A `retry` verdict primary action calls sidecar apply only after confirmation and does not call queue-cascade apply.
- [ ] A `retry` verdict result text includes `re-queueing the PRD`.
- [ ] A `split` verdict primary action calls sidecar apply only after confirmation and does not call queue-cascade apply.
- [ ] A `split` verdict result text includes `enqueuing the successor PRD`.
- [ ] An `abandon` verdict primary action calls sidecar apply only after confirmation and does not call queue-cascade apply.
- [ ] An `abandon` verdict result text includes `archiving or removing the failed PRD`.
- [ ] A `manual` verdict renders `Manual review required` and does not render the primary sidecar apply button.
- [ ] Resume eligible state renders `Resume compiled build`.
- [ ] Clicking resume opens a confirmation before the resume helper is called.
- [ ] Resume success displays the returned session id and process id.
- [ ] Resume ineligible state displays the daemon-provided reason.
- [ ] Resume daemon failure displays the helper error message.
- [ ] The advanced queue-cascade section contains the required upstream/descendant copy.
- [ ] The advanced section calls `fetchQueueRecoveryAnalysis` only after the advanced section is opened or loaded.
- [ ] The advanced queue-cascade action calls `applyQueueRecovery` only after confirmation.
- [ ] The advanced queue-cascade action calls `applyQueueRecovery`, not sidecar apply.
- [ ] The advanced queue-cascade action warns for `manual` verdicts.
- [ ] The advanced queue-cascade action warns for `low` confidence verdicts.
- [ ] Console source guard still reports zero hardcoded `/api/` literal strings.
