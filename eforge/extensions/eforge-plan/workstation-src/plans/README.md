# eforge-plan workstation developer contract

The planning workstation is an extension-owned Vite iframe. It talks to the host only through `window.eforge.invokeAction` and the manifest `allowedActions`; it does not read private extension storage, run local `git` commands, call `gh`, scan daemon routes, recompute the recommendation overlay, infer recommendation actionability, or infer recommendation freshness from the presence of a recommendation model.

## Server-authoritative curation preview

Backlog curation preview and apply data is server-authoritative. The iframe renders preview payloads from `preview-backlog-curation-task`, paginated compact task list metadata from `list-planning-agent-tasks`, and apply results from `apply-planning-agent-task-result`. If a task list row has `resultOmitted: true`, the drawer lazily calls `get-planning-agent-task` before rendering full generated output. Completed available unapplied ready single-output `sessionPlanCreationDraft` tasks are the only planning tasks the workstation auto-applies; it calls `apply-planning-agent-task-result` once with `applySessionPlanCreationDraft: {}`, persists the task summary as the created plan's `## Executive Summary`, refreshes data, opens the created plan in Plans focus, and leaves failed automatic apply attempts visible without retrying the same task automatically. Failures, collisions, needs-input, unavailable, curation, recommendation, handoff, patch, revision, and multi-output tasks stay visible for review.

Required preview payload fields for curation UI and fixtures are:

- `itemAuditConcurrency` — optional server-provided per-item audit concurrency metadata; the default is `4` and the maximum is `8`.
- `gitDelta` — baseline/head git-delta coverage, diagnostics, scanned commit counts, caps, and affected item candidates.
- `fullImplementationAudit` — analysis coverage, caps, concurrency settings, diagnostics, per-item outcomes, current-source citations, and historical navigation hints.
- `recommendationProjection` — the prospective overlay used by both preview and apply validation.
- `recommendationProjection.effectiveRecommendations` / `effectiveRecommendations` display counts and expandable details — the generated recommendations after closed targets are removed and active/planned targets are repositioned or excluded by the server.
- `recommendationFreshness` — server labels and fingerprint comparison state for `missing`, `fresh`, or `stale`.
- `recommendationActionability` — read-time server projection for recommendation entries and safe-parallel groups, including compatibility actionable/non-actionable state, disposition (`actionable`, `suppressed`, `de-actioned`, or `relocated`), lifecycle state, reason codes/messages, associated links, and group `actionableItemIds`/`suppressedItemIds`.
- `generatedRecommendationValidation` — validation issues for unknown, closed, empty, or `wrong-lane` references.
- Draft rows for item changes, epic changes, no-op rechecks, unresolved-exception rows, and needs-input rows.

Render `gitDelta.baseline`, `gitDelta.baseline.commit`, `gitDelta.baseline.time`, `gitDelta.baseline.source`, `gitDelta.currentHead`, `gitDelta.coverage.kind`, diagnostics, scan caps, `gitDelta.scannedCommitCount`, scanned commits, and affected candidates directly. Missing, invalid, unreachable, shallow, and no-git baselines are fallback or unavailable diagnostic coverage states, not complete git-delta coverage. Expected diagnostics include `baseline-missing`, `baseline-invalid-sidecar`, `baseline-unreachable`, `baseline-shallow`, `git-unavailable`, `git-command-failed`, `scan-cap-truncated`, and `pr-enrichment-unavailable`. Optional PR enrichment is represented by server diagnostics such as `pr-enrichment-unavailable`; the workstation must not call `gh` itself.

Analysis previews are server-authoritative as well. The recommendations rail should keep the trigger compact: a primary **Analyze backlog** button plus optional help, not persistent mode or implementation copy. Display coverage, caps, concurrency, diagnostics, per-item outcomes, current-source citations, historical navigation hints, evidence source, and confidence only from preview/source metadata. Current source remains the closure authority for shipped/superseded status; PR/git unavailable diagnostics remain navigation hints or warnings in the preview rather than closure evidence or reasons to hide the result. The browser must not run local git, PR, or source searches and must not replay evidence matching or recommendation overlays.

Render removed targets, repositioned targets, effective recommendation counts, and validation details from `recommendationProjection`. Do not locally replay backlog mutations or locally filter generated recommendations. Normal curation+recommendations apply writes the server-provided effective projection; curation-only apply remains visible as a path that applies backlog records, discards generated recommendations, and leaves those discarded recommendations unfresh.

Needs-input evidence labels must preserve the server wording, including `Ambiguous shipped candidate: needs input — ` and `Ambiguous superseded candidate: needs input — `. Current-source closure evidence labels likewise remain display-only until accepted by apply: `Shipped evidence: current source — ` and `Superseded evidence: current source — `. Historical labels such as `Shipped evidence: lifecycle trace — `, `Shipped evidence: inferred from git/PR history — `, `Superseded evidence: lifecycle trace — `, and `Superseded evidence: inferred from git/PR history — ` are navigation hints, not closure authority.

## Plan detail review

Flat session-plan detail renders the `## Executive Summary` first when present, then readiness diagnostics, open questions, and collapsed detailed sections. This gives reviewers a fast sign-off artifact while keeping readiness problems visible. Detailed sections start collapsed; expanding a section reveals rendered Markdown, edit controls, and annotation target-selection buttons.

Fenced `mermaid` code blocks render as diagrams in workstation Markdown views. Raw SVG and resource-loading HTML remain disallowed in normal Markdown and are stripped by the sanitizer.

## Freshness labels

Show `recommendationFreshness` labels exactly as returned: `missing`, `fresh`, or `stale`. A recommendation model being present is not enough to show fresh. Render `recommendationActionability` exactly as returned for recommendation enablement, disposition, suppression/de-action reasons, lifecycle evidence links, and mixed safe-parallel groups; do not derive suppression from local board lifecycle fields. Direct `start-planning-agent-task` calls remain guarded server-side for stale UIs or external invocation. After backlog mutation, curation preview, or curation-only apply, use the server's current/prospective fingerprint comparison and stale reasons. After normal curation+recommendations apply, reload server data and render the returned freshness and actionability state.

## Mock bridge and fixtures

Local Vite development uses the mock bridge in `src/bridge.ts` and fixtures in `src/fixtures/mock-data.ts`. Mock list responses include pagination metadata (`total`, `limit`, and `offset`) for planning artifacts, draft units, and planning tasks so the iframe contract matches the extension actions. Fixtures that exercise recommendation rendering and curation preview must include `gitDelta`, analysis coverage/caps/concurrency/diagnostics/per-item outcomes/current-source citations/historical navigation hints, `recommendationProjection`, `effectiveRecommendations`, `recommendationFreshness`, `recommendationActionability`, `generatedRecommendationValidation`, removed targets, repositioned targets, `wrong-lane` validation, and ambiguous shipped/superseded needs-input labels. Mock analyze-all behavior should keep active/reused curation tasks separated by analysis concurrency only. Mock behavior should model the server contract rather than adding local git scanning, `gh` enrichment, overlay recomputation, actionability inference, or freshness inference.

## Targeted checks

Useful focused commands while changing this area:

```bash
pnpm dev:eforge-plan-workstation          # mock bridge / fixture data
pnpm dev:eforge-plan-workstation:daemon   # live daemon data through the Vite proxy
pnpm build:eforge-plan-workstation
pnpm test -- eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts
pnpm --filter @eforge-build/eforge-plan-workstation test
pnpm --filter @eforge-build/eforge-plan-workstation build
pnpm type-check
```
