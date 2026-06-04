---
title: Improve Test-Thinning Playbooks with Temporary Plan-Dir Evidence
created: 2026-06-04
landing: pr
landing_auto_merge: true
---

# Improve Test-Thinning Playbooks with Temporary Plan-Dir Evidence

## Problem / Motivation

Backlog source: `.eforge/backlog/items/backlog-2026-06-04-improve-test-thinning-playbooks-to-use-temporary-plan-dir-ev.md`.

Generated test-thinning PRDs currently risk requiring permanent committed documentation or vague "implementation summary" evidence for deleted or consolidated tests. The desired guidance is to require concrete, validator-visible temporary validation evidence under the active eforge plan directory, for example `eforge/plans/<plan-set>/deleted-test-coverage.md`, and allow that evidence to be removed in the final cleanup commit with other PRD/plan artifacts.

Validated evidence:

- Current resolved test-thinning playbooks are user-scope files:
  - `/Users/markschaake/.config/eforge/playbooks/test-thinning-audit.md`
  - `/Users/markschaake/.config/eforge/playbooks/test-thinning-conservative.md`
- `eforge_playbook { action: "list" }` shows no project-team test-thinning playbooks today.
- The two current test-thinning playbooks resolve from `user` scope with no shadows.
- The current user-scope playbooks do not mention deleted-test coverage evidence, temporary plan-directory artifacts, `eforge/plans/<plan-set>/deleted-test-coverage.md`, or cleanup-friendly evidence files.
- The recent generated session plan `.eforge/session-plans/2026-06-04-test-thinning-audit.md` includes the acceptance criterion: `Each deleted test is mentioned in the implementation summary with the adjacent test or lower-level contract that still covers the behavior.`
- The backlog identifies that wording as ambiguous and too permanent-sounding.
- `web/content/docs/concepts.md`, `docs/config.md`, and `packages/engine/src/cleanup.ts` confirm compiled plan files live under `eforge/plans/{planSet}/`.
- `cleanupPlanFiles` removes `eforge/plans/{planSet}/` from `HEAD` during successful `pr` or `merge` cleanup.
- Playbook scope precedence is project-local > project-team > user.
- `web/content/docs/playbooks.md` and `docs/config.md` confirm project-team playbooks in `eforge/playbooks/` are committed and shadow user playbooks with the same name.

Roadmap alignment:

- This is maintenance on reusable input artifacts.
- This supports the roadmap's honest-gates direction by making acceptance evidence concrete and validator-visible without forcing permanent documentation artifacts into the final tree.
- This does not move playbooks behind extensions.
- This is a small quality improvement to current playbook guidance while future extraction remains deferred.

## Goal

Update the repository-owned test-thinning playbook guidance so future test-thinning plans require concrete temporary evidence for deleted or consolidated tests, instead of vague implementation-summary prose or permanent documentation artifacts.

Deleted or consolidated tests should be justified through temporary validation evidence under the active build plan directory, and the playbooks should remain conservative when retained coverage cannot be identified.

## Approach

Add committed project-team playbooks in `eforge/playbooks/` so repository-specific guidance shadows the current user-scope copies without editing files outside the repository.

Primary implementation targets:

- `eforge/playbooks/test-thinning-audit.md`
  - Add a committed project-team planning-mode playbook.
  - Base it on the existing user-scope playbook.
  - Include explicit plan-dir evidence guidance for any generated implementation plan that deletes or consolidates tests.
- `eforge/playbooks/test-thinning-conservative.md`
  - Add a committed project-team autonomous playbook.
  - Base it on the existing user-scope playbook.
  - Include explicit requirements for temporary deleted-test coverage evidence in the active plan directory when tests are removed or consolidated.

Key design notes:

- Use project-team scope because this is repository-specific guidance and is commit-able.
- Project-team playbooks shadow the current user-scope copies without requiring edits outside the repo.
- Preserve the existing playbook modes.
- `test-thinning-audit` remains `mode: planning`.
- `test-thinning-conservative` remains `mode: autonomous`.
- Use a temporary evidence path like `eforge/plans/<plan-set>/deleted-test-coverage.md`.
- The evidence file should be created only when tests are deleted or consolidated.
- The evidence file should live under the current plan set directory.
- The evidence file should list each deleted or consolidated test.
- The evidence file should list the retained adjacent test or lower-level contract that still covers the behavior.
- The evidence file should list the validation command or evidence used to confirm coverage.
- The evidence file should be removed by normal cleanup rather than preserved in the final tree.
- Keep the wording in playbook acceptance criteria objectively validatable.
- Avoid grouping-label bullets that could fail playbook acceptance-criteria quality checks.
- For the planning playbook, instruct the host-agent planning workflow to carry this evidence requirement into generated implementation session plans when deletion or consolidation is in scope.
- For the autonomous playbook, instruct the build directly to create the temporary evidence file if it deletes or consolidates tests.
- Keep the playbooks conservative: if retained coverage cannot be identified, leave the test in place or record it as a future review candidate.

Profile signal:

- Recommended profile: **Excursion**.
- Rationale: this is a small, cohesive maintenance change to committed playbook artifacts with clear scope and validation.
- Rationale: this is more than an Errand because it needs scope-resolution care and acceptance-evidence wording.
- Rationale: this does not require delegated subsystem planning or architecture review.

## Scope

In scope:

- Add project-team playbook files in `eforge/playbooks/` for `test-thinning-audit` and `test-thinning-conservative`, or otherwise make the same guidance available in committed project-team playbooks.
- Preserve `test-thinning-audit` as `mode: planning`.
- Preserve `test-thinning-conservative` as `mode: autonomous`.
- Update the guidance so deleted or consolidated tests require validator-visible evidence under the active build plan directory, using a path like `eforge/plans/<plan-set>/deleted-test-coverage.md`.
- Make the evidence file content concrete.
- Require the evidence file to list each deleted or consolidated test.
- Require the evidence file to list the retained adjacent test or lower-level contract that still covers the behavior.
- Require the evidence file to list the validation command or evidence used to confirm coverage.
- State that this evidence is a temporary build artifact.
- State that this evidence may be removed by normal `cleanupPlanFiles` cleanup with other `eforge/plans/<plan-set>/` artifacts.
- Avoid requiring permanent committed docs.
- Avoid requiring final-tree summaries.
- Avoid vague "implementation summary" wording for deleted-test coverage.
- Keep the playbooks conservative.
- If retained coverage cannot be identified, leave the test in place or record it as a future review candidate.

Out of scope:

- Do not edit user-scope files under `/Users/markschaake/.config/eforge/playbooks/` from the build.
- Do not edit files outside the repository that cannot be committed as project work.
- Do not change eforge engine cleanup behavior.
- Do not change acceptance criteria extraction or validation semantics.
- Do not run another broad test-thinning audit.
- Do not remove or consolidate tests as part of this playbook-guidance change.
- Do not add permanent documentation requirements for test deletion coverage.

## Acceptance Criteria

- `eforge/playbooks/test-thinning-audit.md` exists.
- `eforge/playbooks/test-thinning-audit.md` declares `scope: project-team`.
- `eforge/playbooks/test-thinning-audit.md` declares `mode: planning`.
- `eforge/playbooks/test-thinning-conservative.md` exists.
- `eforge/playbooks/test-thinning-conservative.md` declares `scope: project-team`.
- `eforge/playbooks/test-thinning-conservative.md` declares `mode: autonomous`.
- The `test-thinning-audit` playbook tells planners to require temporary deleted-test coverage evidence under `eforge/plans/<plan-set>/deleted-test-coverage.md` when a generated plan deletes tests.
- The `test-thinning-audit` playbook tells planners to require temporary deleted-test coverage evidence under `eforge/plans/<plan-set>/deleted-test-coverage.md` when a generated plan consolidates tests.
- The `test-thinning-conservative` playbook tells builders to create temporary deleted-test coverage evidence under `eforge/plans/<plan-set>/deleted-test-coverage.md` when tests are deleted.
- The `test-thinning-conservative` playbook tells builders to create temporary deleted-test coverage evidence under `eforge/plans/<plan-set>/deleted-test-coverage.md` when tests are consolidated.
- The `test-thinning-audit` playbook states that deleted-test coverage evidence must list each deleted test.
- The `test-thinning-audit` playbook states that deleted-test coverage evidence must list each consolidated test.
- The `test-thinning-audit` playbook states that deleted-test coverage evidence must list the retained adjacent test or lower-level contract that still covers the behavior.
- The `test-thinning-audit` playbook states that deleted-test coverage evidence must list the validation command or evidence used to confirm coverage.
- The `test-thinning-conservative` playbook states that deleted-test coverage evidence must list each deleted test.
- The `test-thinning-conservative` playbook states that deleted-test coverage evidence must list each consolidated test.
- The `test-thinning-conservative` playbook states that deleted-test coverage evidence must list the retained adjacent test or lower-level contract that still covers the behavior.
- The `test-thinning-conservative` playbook states that deleted-test coverage evidence must list the validation command or evidence used to confirm coverage.
- The `test-thinning-audit` playbook states that deleted-test coverage evidence is a temporary plan artifact.
- The `test-thinning-conservative` playbook states that deleted-test coverage evidence is a temporary plan artifact.
- The `test-thinning-audit` playbook states that deleted-test coverage evidence may be removed by normal `cleanupPlanFiles` cleanup.
- The `test-thinning-conservative` playbook states that deleted-test coverage evidence may be removed by normal `cleanupPlanFiles` cleanup.
- The `test-thinning-audit` playbook states that deleted-test coverage evidence must not require permanent committed documentation in the final tree.
- The `test-thinning-conservative` playbook states that deleted-test coverage evidence must not require permanent committed documentation in the final tree.
- The `test-thinning-audit` playbook does not require deleted tests to be documented only in a vague "implementation summary".
- The `test-thinning-conservative` playbook does not require deleted tests to be documented only in a vague "implementation summary".
- The `test-thinning-audit` playbook does not require permanent final-tree documentation solely to justify deleted or consolidated tests.
- The `test-thinning-conservative` playbook does not require permanent final-tree documentation solely to justify deleted or consolidated tests.
- `eforge_playbook { action: "show", name: "test-thinning-audit" }` returns the project-team playbook with the temporary plan-dir evidence guidance.
- `eforge_playbook { action: "show", name: "test-thinning-conservative" }` returns the project-team playbook with the temporary plan-dir evidence guidance.
- `eforge_playbook { action: "list" }` shows `test-thinning-audit` resolving from `project-team` in this project.
- `eforge_playbook { action: "list" }` shows `test-thinning-conservative` resolving from `project-team` in this project.
- `pnpm vitest run test/playbook.test.ts --reporter verbose` exits 0.

## Manual Verification Notes

Likely validation and tool checks from the input:

- `pnpm vitest run test/playbook.test.ts --reporter verbose` or a narrower playbook parsing/listing test command should exit 0 after adding the project-team playbooks.
- `eforge_playbook { action: "list" }` should show `test-thinning-audit` and `test-thinning-conservative` resolving from `project-team` in this project after the change.
- In this developer environment, the user-scope copies may appear as shadows.
- `eforge_playbook { action: "show", name: "test-thinning-audit" }` should return the updated project-team guidance.
- `eforge_playbook { action: "show", name: "test-thinning-conservative" }` should return the updated project-team guidance.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| The current test-thinning playbooks that need improvement are `test-thinning-audit` and `test-thinning-conservative`. | `eforge_playbook list` shows exactly two resolved test-thinning playbooks. `find` found the same two user-scope files. | high | low | Re-run `eforge_playbook list` after implementation and confirm only these names are relevant. | If another playbook exists under an unsearched scope, guidance could remain inconsistent. |
| Repository build work should not edit `/Users/markschaake/.config/eforge/playbooks/*.md` directly. | Those files are user-scope and outside the repository. `web/content/docs/playbooks.md` says user-scope playbooks are not committed; project-team playbooks live under `eforge/playbooks/` and are committed. | high | low | Add project-team playbooks and verify resolution/shadowing with `eforge_playbook list/show`. | Editing user-scope files would not produce a reviewable PR and would not help other project users. |
| Adding project-team playbooks with the same names will shadow the user-scope copies for this project. | `web/content/docs/playbooks.md` states project-local shadows project-team, which shadows user. `docs/config.md` describes named-set resolution with higher-precedence entries winning. | high | low | After implementation, run `eforge_playbook list` and confirm `source: project-team` for both names. | If precedence behaved differently, the committed files might not affect local runs. |
| `eforge/plans/<plan-set>/deleted-test-coverage.md` is an appropriate temporary evidence path. | Docs and code show plan artifacts are written under `eforge/plans/{planSet}/` and `cleanupPlanFiles` removes that directory from `HEAD` during successful landing cleanup. | high | low | Optionally inspect a live build's plan directory or run cleanup tests, but existing docs/code are sufficient for planning. | If the path were not cleaned up, the playbook could still create unwanted final-tree artifacts. |
| Validator-visible evidence in the plan directory is preferable to final-tree documentation for this case. | User explicitly requested temporary plan-directory evidence and identified the prior "implementation summary" criterion as problematic. Roadmap supports honest gates without permanent clutter. | high | low | No further validation needed unless user changes product preference. | If wrong, generated PRDs could fail acceptance validation or clutter final PRs. |
| A targeted playbook parsing/test command is enough validation for this guidance-only change. | The likely changed files are Markdown playbooks; no engine behavior changes are in scope. Existing playbook tests cover parsing/validation behavior. | medium | low | Run `pnpm vitest run test/playbook.test.ts --reporter verbose` or the current focused equivalent. | If too narrow, formatting or route listing issues might slip through; `eforge_playbook show/list` checks mitigate this. |

No low-confidence/high-impact assumptions remain.

The only medium-confidence validation choice is command breadth, and the plan includes concrete route/tool checks plus a targeted test command.