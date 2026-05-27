---
title: Fix Dependency-Update Playbook Acceptance Criteria and Playbook Run Validation
created: 2026-05-27
profile: gpt-claude-combo
landing: pr
landing_auto_merge: true
---

# Fix Dependency-Update Playbook Acceptance Criteria and Playbook Run Validation

## Problem / Motivation

The bundled autonomous `dependency-update` playbook can generate PRDs that pass deterministic validation commands but fail acceptance validation because the criteria require process evidence that is not durable in the implementation diff.

Roadmap alignment: this fix supports daemon/input safety and is adjacent to input-handling maturity. It is small enough to treat as a bugfix rather than new architecture.

Relevant evidence:
- `eforge/playbooks/dependency-update.md` is the bundled autonomous playbook that produced the failed PRD.
- `packages/input/src/playbook.ts` formats autonomous playbooks via `playbookToBuildSource()` and preserves the acceptance-criteria section verbatim.
- `packages/engine/src/eforge.ts` runs the AC quality gate for normal standalone enqueue.
- `packages/monitor/src/server.ts` handles `/api/playbook/run` and currently calls `enqueuePrd()` directly after `playbookToBuildSource()`, bypassing the normal enqueue gate.
- `test/acceptance-criteria-quality.test.ts` already covers analyzer behavior and normal engine enqueue rejection, so new implementation should add route-level and bundled-playbook regression coverage rather than duplicate analyzer unit tests.

Confirmed failure evidence:
- Failed queue item: `.eforge/queue/failed/update-workspace-dependencies-and-validate-the-repo.md`.
- Recovery sidecar: `.eforge/queue/failed/update-workspace-dependencies-and-validate-the-repo.recovery.md` reports manual recovery because validation was inconclusive rather than command failure.
- Monitor DB events for run `b65a4778-a625-4940-acb8-c02e82036b15` show `pnpm build`, `pnpm type-check`, and `pnpm test` all exited 0, then `acceptance_validation:complete` failed due to `unknown` criteria.
- The current playbook ACs in `eforge/playbooks/dependency-update.md` contain grouping bullets ending with `:` and bare command fragments, which are known invalid AC patterns.

Root cause:
- `eforge/playbooks/dependency-update.md` uses grouped/nested criteria and bare command fragments.
- The validator/extractor flattens nested bullets into separate acceptance criteria, so parent grouping labels and command-only children become criteria (`ac-004`, `ac-009`, `ac-010`-`ac-012`) instead of prose structure.
- The playbook asks for supply-chain checks and final summary, but does not require a durable evidence artifact.
- The builder's ephemeral agent response contained a summary, but the PRD validator validates against the implementation diff and deterministic command evidence, not prior chat text.
- `packages/engine/src/eforge.ts` has a normal standalone enqueue AC-quality gate after formatting with `analyzeAcceptanceCriteriaInBody(formattedBody)`.
- `packages/monitor/src/server.ts` handles `/api/playbook/run` by calling `playbookToBuildSource()` and direct `enqueuePrd()`, bypassing both formatter normalization and the AC-quality gate used by normal enqueue.
- `packages/input/src/playbook.ts` preserves the playbook AC markdown as-is when formatting an autonomous playbook.
- Passing `pnpm build`, `pnpm type-check`, and `pnpm test` was correctly recognized from deterministic evidence.
- Unknown verdicts for audit/diff/final-summary process criteria were reasonable because no tracked file in the diff proved those checks happened.

User impact:
- Recurring dependency-update builds can waste an eforge run and land in manual recovery despite successful build/type/test validation.

## Goal

Repair the bundled `dependency-update` playbook so it produces validator-friendly, durable acceptance criteria. Add daemon-side validation so autonomous playbooks cannot bypass acceptance-criteria quality checks during save or run.

## Approach

Recommended profile: **Excursion**.

Rationale: the implementation is cohesive and should fit in a single plan, but it touches a daemon route, bundled playbook content, and route-level regression tests. Review should verify that the route rejects before queue mutation and that the playbook's replacement criteria remain validator-friendly.

Implementation approach:
- Rewrite `eforge/playbooks/dependency-update.md` acceptance criteria into flat, standalone, objectively verifiable bullets.
- Replace grouped supply-chain criteria with explicit criteria requiring a tracked evidence artifact that records audit, diff review, package inspection, and npm-diff conclusions.
- Replace bare command bullets with outcome statements such as `` `pnpm build` exits 0. ``
- In `POST /api/playbook/save`, validate `acceptanceCriteria` with the existing AC-quality analyzer after assembling the playbook object and before `writePlaybook()`.
- Reject bad save-time AC content with HTTP 400 and diagnostic details.
- Format save-time errors with `formatAcDiagnostics()`.
- Do not write a playbook file on save-time AC rejection.
- Do not overwrite an existing playbook file on save-time AC rejection.
- In `POST /api/playbook/run`, run `analyzeAcceptanceCriteriaInBody(plan.source)` after `const plan = playbookToBuildSource(playbook)` and before dependency validation or `enqueuePrd()`.
- Reject invalid run-time AC content with HTTP 400.
- Format run-time errors with `formatAcDiagnostics()`.
- Do not write a queue file or call `notifyQueueMutation()` on run-time AC rejection.
- Prefer reusing the existing exported input-layer analyzer from monitor rather than duplicating validation logic.
- If a cleaner API is useful, add a small helper such as `analyzePlaybookAcceptanceCriteria(playbook)` that analyzes only the playbook's `acceptanceCriteria` field and returns the existing diagnostic shape.

Testing approach:
- Add or extend daemon playbook-save tests to prove invalid playbook ACs return 400 and do not create or overwrite a playbook file.
- Add or extend daemon playbook-run tests to prove invalid autonomous playbooks return 400 and do not create queue files.
- Add or extend bundled playbook tests so project-bundled playbooks pass AC-quality analysis.
- Do not duplicate analyzer unit tests already covered by `test/acceptance-criteria-quality.test.ts`.

Assumptions and validation:
| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| The failed build was caused by acceptance validation inconclusive verdicts, not failing repo validation commands. | Monitor DB events for run `b65a4778-a625-4940-acb8-c02e82036b15` show `pnpm build`, `pnpm type-check`, and `pnpm test` exit 0, followed by `acceptance_validation:complete` with `unknown` verdicts. Recovery sidecar also says manual due insufficient evidence. | high | low | Re-query `.eforge/monitor.db` for the same event IDs if needed. | If wrong, the plan would miss an actual dependency compatibility failure. |
| The bundled playbook ACs are invalid under the existing quality rules. | `eforge/playbooks/dependency-update.md` contains grouping-label bullets and bare command bullets; the existing analyzer reports those diagnostics for the generated PRD body. | high | low | Run `analyzeAcceptanceCriteriaInBody()` or `analyzeAcceptanceCriteria()` in a test against the playbook content. | If wrong, only route-level validation hardening would matter. |
| Normal standalone enqueue would catch this AC shape before queue write. | `packages/engine/src/eforge.ts` runs `analyzeAcceptanceCriteriaInBody(formattedBody)` and emits `enqueue:failed` before queue write when diagnostics exist. | high | low | Existing `test/acceptance-criteria-quality.test.ts` covers engine enqueue rejection; run targeted test. | If wrong, a broader enqueue validation bug would be needed. |
| `/api/playbook/run` bypasses the normal formatter/AC quality gate. | `packages/monitor/src/server.ts` loads playbook, calls `playbookToBuildSource()`, then directly calls `enqueuePrd()`; no AC-quality call is present in that route. | high | low | Add a route-level regression test with an invalid autonomous playbook. | If wrong, the route test would reveal another path doing validation. |
| `/api/playbook/save` currently validates schema and required goal but not AC quality. | `packages/monitor/src/server.ts` validates frontmatter and goal before `writePlaybook()`, but no `analyzeAcceptanceCriteria()`/`formatAcDiagnostics()` call appears in the save route. | high | low | Add save-route regression tests for invalid AC create and invalid AC overwrite. | If wrong, existing behavior may already reject invalid ACs and tests can be adjusted. |
| Adding route-level AC-quality validation in monitor is acceptable despite input/engine boundary constraints. | `packages/monitor/src/server.ts` already imports `@eforge-build/input` for playbook helpers. `@eforge-build/input` exports the AC-quality analyzer. Engine boundary only forbids engine importing input, not monitor importing input. | medium | low | Confirm TypeScript imports and run `pnpm type-check`. | If wrong, the fix should move/duplicate the validation helper or route through an engine API instead. |
| No daemon API version bump is required. | Request/response schemas do not change; save/run routes already return 400 errors for invalid requests. Behavior becomes stricter for invalid playbook content. | medium | low | Review API-version policy and route schema tests during implementation. | If wrong, older client/daemon compatibility diagnostics may be less explicit. |

## Scope

In scope:
- Update `eforge/playbooks/dependency-update.md`.
- Add daemon validation to `packages/monitor/src/server.ts` for `POST /api/playbook/save`.
- Add daemon validation to `packages/monitor/src/server.ts` for `POST /api/playbook/run`.
- Reuse `packages/input/src/acceptance-criteria-quality.ts` analyzer behavior where possible.
- Optionally add a small helper in `packages/input/src/playbook.ts` or `packages/input/src/acceptance-criteria-quality.ts` if it keeps the API cleaner.
- Add route-level regression tests for playbook save validation.
- Add route-level regression tests for playbook run validation.
- Add bundled-playbook regression tests.

Out of scope:
- Do not redesign the formatter or PRD validator.
- Do not change acceptance validation semantics for `unknown` verdicts.
- Do not add a new evidence-artifact subsystem.
- Do not duplicate analyzer unit tests already covered by `test/acceptance-criteria-quality.test.ts`.

## Acceptance Criteria

- `eforge/playbooks/dependency-update.md` acceptance criteria contain no grouping-label bullets according to the existing AC-quality analyzer.
- `eforge/playbooks/dependency-update.md` acceptance criteria contain no bare command bullets according to the existing AC-quality analyzer.
- `eforge/playbooks/dependency-update.md` acceptance criteria contain no vague criteria according to the existing AC-quality analyzer.
- The dependency-update playbook requires a tracked dependency-update evidence artifact.
- The dependency-update playbook requires the tracked dependency-update evidence artifact to record `pnpm audit` exit status.
- The dependency-update playbook requires the tracked dependency-update evidence artifact to record `pnpm audit` findings.
- The dependency-update playbook requires the tracked dependency-update evidence artifact to record manifest diff-review conclusions.
- The dependency-update playbook requires the tracked dependency-update evidence artifact to record lockfile diff-review conclusions.
- The dependency-update playbook requires the tracked dependency-update evidence artifact to record whether unexpected new packages were found.
- The dependency-update playbook requires the tracked dependency-update evidence artifact to record lifecycle-script inspection for newly introduced, major-version, or suspicious package changes.
- The dependency-update playbook requires the tracked dependency-update evidence artifact to record repository inspection for newly introduced, major-version, or suspicious package changes.
- The dependency-update playbook requires the tracked dependency-update evidence artifact to record maintainer inspection for newly introduced, major-version, or suspicious package changes.
- The dependency-update playbook requires the tracked dependency-update evidence artifact to record native/build-behavior inspection for newly introduced, major-version, or suspicious package changes.
- The dependency-update playbook requires the tracked dependency-update evidence artifact to record `npm diff` review conclusions for risky or high-impact package changes.
- The dependency-update playbook requires the tracked dependency-update evidence artifact to state that no package changes required `npm diff` when no risky or high-impact package changes are present.
- The dependency-update playbook requires `pnpm build` to exit 0.
- The dependency-update playbook requires `pnpm type-check` to exit 0.
- The dependency-update playbook requires `pnpm test` to exit 0.
- The daemon `POST /api/playbook/save` route returns HTTP 400 when a playbook payload contains invalid acceptance criteria.
- The daemon `POST /api/playbook/save` route response includes AC diagnostic text when a playbook payload contains invalid acceptance criteria.
- The daemon `POST /api/playbook/save` route response names grouping labels in AC diagnostic text when grouping-label acceptance criteria are present.
- The daemon `POST /api/playbook/save` route response names bare commands in AC diagnostic text when bare-command acceptance criteria are present.
- The daemon `POST /api/playbook/save` route response names vague criteria in AC diagnostic text when vague acceptance criteria are present.
- The daemon `POST /api/playbook/save` route creates zero new playbook files when it rejects invalid acceptance criteria.
- The daemon `POST /api/playbook/save` route does not overwrite an existing playbook file when it rejects invalid acceptance criteria.
- The daemon `POST /api/playbook/run` route returns HTTP 400 when an autonomous playbook's generated source contains invalid acceptance criteria.
- The daemon `POST /api/playbook/run` route response includes AC diagnostic text when an autonomous playbook's generated source contains invalid acceptance criteria.
- The daemon `POST /api/playbook/run` route creates zero queue markdown files when it rejects an autonomous playbook for invalid acceptance criteria.
- The daemon `POST /api/playbook/run` route does not call `notifyQueueMutation()` when it rejects an autonomous playbook for invalid acceptance criteria.
- A regression test proves all bundled playbooks with an acceptance-criteria section pass AC-quality analysis.
- `pnpm type-check` exits 0.
- `pnpm test` exits 0.
