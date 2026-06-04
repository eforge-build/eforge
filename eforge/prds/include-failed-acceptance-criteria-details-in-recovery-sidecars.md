---
title: Include Failed Acceptance Criteria Details in Recovery Sidecars
created: 2026-06-04
landing: pr
landing_auto_merge: true
---

# Include Failed Acceptance Criteria Details in Recovery Sidecars

## Problem / Motivation

Builds that fail at the acceptance-validation gate can generate a recovery sidecar that reports only the generic terminal message `Acceptance criteria validation failed`, even though the run emitted `acceptance_validation:complete` verdicts with per-criterion fail/unknown evidence.

Affected users are developers using recovery sidecars or Console recovery dialogs to decide whether to retry, split, abandon, or manually inspect a failed build.

The impact is that the recovery report becomes non-actionable when deterministic validation commands pass but acceptance validation rejects the build. Users cannot tell which acceptance criteria failed or were inconclusive, why the validator made that determination, or what evidence to inspect next.

Classification: bugfix / focused, high confidence. This is a defect in recovery evidence synthesis and rendering, not a new workflow feature.

Roadmap alignment: `docs/roadmap.md` prioritizes typed recovery paths, honest gates, and console observability. This bug is aligned with the Kernel Resilience and Console Observability roadmap goals because recovery reports should expose typed acceptance-validation evidence instead of hiding it behind a generic terminal message.

Validated evidence:

- The recovery sidecar renderer already emits an `## Acceptance Validation` section when `summary.acceptanceValidation` is populated. Evidence: `packages/engine/src/recovery/sidecar.ts` renders result counts, per-criterion verdicts/evidence, waivers, and conflicts.
- The non-authoritative/legacy acceptance-validation fallback already knows how to reconstruct `summary.acceptanceValidation` from an adjacent `acceptance_validation:complete` event. Evidence: `packages/engine/src/recovery/event-history.ts` fallback path queries `acceptance_validation:complete`, filters verdicts, counts pass/fail/unknown, extracts validation commands, and returns `acceptanceValidation`.
- The authoritative terminal-failure path returns before that fallback. Evidence: `packages/engine/src/recovery/event-history.ts` calls `findAuthoritativeTerminalEvent(...)`, then immediately returns `buildAuthoritativeFragment(...)` when an authoritative `build:terminal-failure` exists.
- `buildAuthoritativeFragment(...)` currently omits `acceptanceValidation`. Evidence: `packages/engine/src/recovery/terminal-failure-history.ts` includes terminal failure metadata, validation commands, landing, and review failure, but no acceptance verdict extraction or `acceptanceValidation` field.
- The build terminal failure tracker records only generic acceptance-validation failure metadata for the authoritative event. Evidence: `packages/engine/src/terminal-failure.ts` observes failed `acceptance_validation:complete` and emits `failure.scope = 'acceptance-validation'`, `message = 'Acceptance criteria validation failed'`, `sourceEventType`, `sourceEventTimestamp`, and `acceptanceValidationPassed = false`, but not the criterion verdicts.
- Tests already prove rendering works when `summary.acceptanceValidation` is present and prove legacy fallback extraction works. Evidence: `test/recovery-sidecars.test.ts` and `test/recovery-failure-summary.test.ts`. Existing terminal-failure tests only assert the authoritative acceptance-validation scope, not verdict enrichment.

Validated static reproduction path:

1. A build run emits `prd_validation:complete` with `passed: true` and no gaps.
2. The same run emits `acceptance_validation:complete` with `passed: false` and one or more `verdicts` entries whose `verdict` is `fail` or `unknown`.
3. The build terminal failure tracker observes that event and later emits an authoritative `build:terminal-failure` with `failure.scope = 'acceptance-validation'`, `failure.message = 'Acceptance criteria validation failed'`, `failure.sourceEventType = 'acceptance_validation:complete'`, and `failure.acceptanceValidationPassed = false`.
4. Recovery synthesis sees the failed `phase:end`, finds the authoritative terminal failure, and immediately returns `buildAuthoritativeFragment(...)`.
5. Because `buildAuthoritativeFragment(...)` does not extract the adjacent `acceptance_validation:complete` row, the resulting `BuildFailureSummary` lacks `acceptanceValidation`.
6. `writeRecoverySidecar(...)` only renders the `## Acceptance Validation` table when `summary.acceptanceValidation` exists, so the sidecar shows the generic terminal failure without the failed/unknown criteria.

Known observed case from backlog: failed build `tag-every-agent-with-an-orchestrator-assigned-swimlane`; terminal failure was `acceptance_validation:complete`, deterministic checks passed, and the recovery sidecar lacked the specific failed/unknown criteria.

Confirmed root cause:

- `packages/engine/src/recovery/event-history.ts` gives authoritative `build:terminal-failure` rows precedence and returns `buildAuthoritativeFragment(...)` immediately.
- `packages/engine/src/recovery/terminal-failure-history.ts` parses only generic acceptance-validation terminal metadata from the authoritative event (`scope`, `message`, `sourceEventType`, `acceptanceValidationPassed`) and does not extract or attach the prior `acceptance_validation:complete` verdicts.
- The legacy fallback in `packages/engine/src/recovery/event-history.ts` can populate `acceptanceValidation`, but that code is unreachable whenever an authoritative terminal failure exists, which is the normal modern path.
- `packages/engine/src/recovery/sidecar.ts` cannot render criterion-level details unless `summary.acceptanceValidation` is present.

Conclusion: the backlog claim is valid. The bug is not in the sidecar renderer's ability to render acceptance validation details; it is primarily in the authoritative recovery event-history path failing to enrich the failure summary with adjacent acceptance-verdict evidence. A small renderer enhancement is also needed so non-pass criteria include deterministic next-step guidance in the markdown report.

## Goal

Recovery sidecars for authoritative acceptance-validation terminal failures should include the failed and unknown acceptance criteria, their evidence, verdict counts, and actionable next-step guidance.

If verdict extraction fails, the sidecar should explicitly say which `monitor.db` lookup failed, in which run/window, and what a human should inspect next.

## Approach

Implement engine-side recovery evidence synthesis plus markdown rendering.

- Add a shared helper in `packages/engine/src/recovery/terminal-failure-history.ts` that extracts acceptance-validation evidence for an authoritative acceptance-validation terminal failure.
- The helper should query the latest `acceptance_validation:complete` event at or before the authoritative `build:terminal-failure` event id, preferably constrained by `sourceEventType === 'acceptance_validation:complete'` and/or `acceptanceValidationPassed === false`.
- The helper should parse the same fields as the existing fallback path: `passed`, `verdicts`, pass/fail/unknown counts, optional `waivers`, and optional `acceptanceConflicts`.
- Refactor duplicated parsing/counting logic if practical so fallback and authoritative extraction use the same parser.
- If no matching event exists or the row is malformed, still populate `summary.acceptanceValidation` with a schema-valid `passed: false` unknown placeholder verdict whose `criterion` and `evidence` explicitly identify the failed lookup location, such as the run id, terminal event id, source event type/timestamp if available, and SQL/event window that was checked.
- Pass the enriched `acceptanceValidation` into `buildAuthoritativeFragment(...)` from `event-history.ts` when the authoritative scope is `acceptance-validation`.
- Update `packages/engine/src/recovery/sidecar.ts` to include deterministic actionable next-step guidance for non-pass verdicts in the Acceptance Validation section.
- The next-step guidance can be a `Next Step` column or a follow-up list.
- The next-step guidance does not require changing the sidecar JSON schema.
- Do not change the `acceptance_validation:complete` event schema unless implementation discovers the existing schema cannot represent the fallback evidence.
- Current evidence indicates the existing `acceptance_validation:complete` schema can represent the fallback evidence.
- Do not move recovery analysis workflow into Console or Pi.
- Do not alter acceptance-validation pass/fail semantics.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| The authoritative terminal-failure path is the path causing missing acceptance details. | Read `packages/engine/src/recovery/event-history.ts`; it returns `buildAuthoritativeFragment(...)` before the fallback acceptance-validation extraction. Read `packages/engine/src/recovery/terminal-failure-history.ts`; `buildAuthoritativeFragment(...)` does not attach `acceptanceValidation`. | high | low | Add a focused monitor.db fixture with authoritative `build:terminal-failure` plus preceding `acceptance_validation:complete` and assert `buildFailureSummary(...)`. | If wrong, implementation may target the wrong path and leave the observed sidecar unchanged. |
| The latest `acceptance_validation:complete` event at or before the authoritative `build:terminal-failure` event id is the correct verdict source for modern runs. | Read `packages/engine/src/terminal-failure.ts`; the tracker observes `acceptance_validation:complete` before emitting the final `build:terminal-failure`. The source event timestamp is also stored on the authoritative event. | high | low | In the new test fixture, insert both events in realistic order and assert the exact preceding verdicts are selected. Include at least one unrelated older acceptance event if needed to prove latest-before-terminal ordering. | If wrong, the sidecar could report stale or unrelated criteria. |
| The existing `BuildFailureSummary.acceptanceValidation.verdicts` schema can represent missing lookup evidence without adding a schema field. | Read `packages/client/src/events.schemas.ts`; `acceptanceValidation.verdicts` is an array of `AcceptanceCriterionVerdict` with criterion/verdict/evidence strings and verdict can be `unknown`. | high | low | Add a test where the matching event is missing or malformed and assert a placeholder `unknown` verdict with explicit lookup-failure evidence validates through sidecar JSON parsing. | If wrong, a client schema change would be needed and more packages/tests would be affected. |
| Adding markdown-only next-step guidance is sufficient for the requested actionable sidecar behavior. | Read `packages/engine/src/recovery/sidecar.ts`; the markdown renderer owns human-readable sidecar content and can derive deterministic next-step text from verdict type without changing JSON. | medium | low | Update `test/recovery-sidecars.test.ts` or add a focused sidecar test asserting non-pass verdicts render next-step guidance. | If wrong, next-step data may need to become a typed JSON field consumed by recovery analyst/Console. |
| Console does not need separate data-model work for this fix. | `packages/console-ui/README.md` states the recovery dialog renders sidecar markdown via `SafeMarkdown`; enriching the markdown and JSON summary in engine should surface through existing UI. | medium | low | Optionally run existing console recovery-dialog tests after engine-side changes if UI rendering behavior is touched. | If wrong, the sidecar will be fixed on disk/API but Console may still hide the details. |

No low-confidence/high-impact assumptions remain. The highest-impact data-source assumption is validated by code inspection and should be locked with targeted tests before implementation is considered complete.

Recommended profile: Excursion.

Rationale: this is a focused bugfix, but it crosses recovery event-history synthesis, sidecar markdown rendering, and regression tests. A single cohesive implementation plan can enumerate the data extraction helper, renderer enhancement, and targeted monitor.db fixtures without delegated module planning. Errand is too small because the authoritative-vs-fallback recovery path needs careful tests. Expedition is unnecessary because no new architecture boundary or independently planned subsystem work is required.

## Scope

In scope:

- Enrich authoritative `build:terminal-failure` recovery summaries scoped to `acceptance-validation` with adjacent `acceptance_validation:complete` verdict evidence.
- Preserve failed and unknown acceptance criterion strings and evidence text in `summary.acceptanceValidation`.
- Report correct `total`, `pass`, `fail`, and `unknown` counts.
- Add a schema-valid unknown placeholder verdict when the matching acceptance-validation event is missing or malformed.
- Include lookup-failure details in placeholder evidence, including run id, authoritative terminal event id, source event type/timestamp if available, and the SQL/event window checked.
- Add deterministic actionable next-step guidance for non-pass verdicts in `packages/engine/src/recovery/sidecar.ts`.
- Add focused tests for authoritative acceptance-validation enrichment and sidecar rendering.
- Preserve existing legacy fallback behavior and tests.

Out of scope:

- Changing the `acceptance_validation:complete` event schema unless implementation discovers the existing schema cannot represent the fallback evidence.
- Moving recovery analysis workflow into Console or Pi.
- Altering acceptance-validation pass/fail semantics.
- New workflow features.
- New architecture boundaries or independently planned subsystem work.

## Acceptance Criteria

- `buildFailureSummary(...)` returns `summary.acceptanceValidation` when `monitor.db` contains an authoritative `build:terminal-failure` scoped to `acceptance-validation` and a preceding failed `acceptance_validation:complete` event in the same run.
- The authoritative acceptance-validation summary preserves each failed criterion string from the source `acceptance_validation:complete` event.
- The authoritative acceptance-validation summary preserves each unknown criterion string from the source `acceptance_validation:complete` event.
- The authoritative acceptance-validation summary preserves each failed criterion evidence text from the source `acceptance_validation:complete` event.
- The authoritative acceptance-validation summary preserves each unknown criterion evidence text from the source `acceptance_validation:complete` event.
- The authoritative acceptance-validation summary reports the correct `total` count for the preserved verdicts.
- The authoritative acceptance-validation summary reports the correct `pass` count for the preserved verdicts.
- The authoritative acceptance-validation summary reports the correct `fail` count for the preserved verdicts.
- The authoritative acceptance-validation summary reports the correct `unknown` count for the preserved verdicts.
- `buildFailureSummary(...)` returns a schema-valid `summary.acceptanceValidation` with one `unknown` placeholder verdict when the authoritative acceptance-validation terminal failure has no readable matching `acceptance_validation:complete` event.
- The placeholder unknown verdict evidence names the run id.
- The placeholder unknown verdict evidence names the authoritative terminal event id.
- The placeholder unknown verdict evidence names the `acceptance_validation:complete` lookup window that failed.
- Recovery sidecar markdown generated from an authoritative acceptance-validation failure contains an `## Acceptance Validation` section.
- Recovery sidecar markdown generated from an authoritative acceptance-validation failure contains each non-pass criterion.
- Recovery sidecar markdown generated from an authoritative acceptance-validation failure contains each non-pass verdict.
- Recovery sidecar markdown generated from an authoritative acceptance-validation failure contains each non-pass evidence text.
- Recovery sidecar markdown generated from an authoritative acceptance-validation failure contains deterministic next-step guidance for each non-pass criterion.
- Recovery sidecar markdown generated when verdict extraction is unavailable states why the verdict lookup failed.
- Recovery sidecar markdown generated when verdict extraction is unavailable states where the lookup was attempted.
- Existing legacy fallback acceptance-validation recovery summary tests continue to pass with the same criterion verdict counts.
- A targeted recovery test file covering authoritative acceptance-validation enrichment exits 0 under `pnpm test`.
- `pnpm type-check` exits 0.

## Manual Verification Notes

- Expected behavior from the observed backlog case: the sidecar for failed build `tag-every-agent-with-an-orchestrator-assigned-swimlane` includes non-pass acceptance criteria, each criterion's evidence, and an actionable next step.
- If verdict extraction fails, inspect the sidecar for the specific `monitor.db` lookup failure, run/window details, and the human inspection guidance.
- Optionally run existing Console recovery-dialog tests after engine-side changes if UI rendering behavior is touched.