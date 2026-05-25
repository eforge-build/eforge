---
title: Complete and Verify AC Quality Gate (continuation)
created: 2026-05-25
---

# Complete and Verify AC Quality Gate (continuation)

## Overview

This PRD continues the partially implemented acceptance-criteria quality gate from a prior build session that exhausted its turn budget. The core implementation files already exist on the feature branch `eforge/prevent-invalid-acceptance-criteria-from-being-enqueued`. The task is to audit the WIP state, fix any broken code, and drive all targeted validation commands to green.

## Context: What Was Built

The following files were modified or created in the prior session (all on branch `eforge/prevent-invalid-acceptance-criteria-from-being-enqueued`):

- **`packages/engine/src/validation/acceptance-criteria.ts`** — ~328 lines added: structural AC quality analysis helpers, grouping-bullet detection (trailing `:`), incomplete command-fragment detection, vague-criteria detection, atomic-validatability checks.
- **`test/acceptance-criteria-quality.test.ts`** — ~299 lines: new test file covering quality gate scenarios.
- **`packages/engine/src/eforge.ts`** — ~14 lines: enqueue gate called after formatter output and before dependency detection / `enqueuePrd()`.
- **`packages/engine/src/prompts/formatter.md`** — ~10 lines: flat AC list instruction, prohibition on grouping bullets, observable pass condition requirement.

Additional user-requested scope before rerun:

- **`packages/pi-eforge/skills/eforge-plan/SKILL.md`** — update the `/eforge:plan` acceptance-criteria dimension guidance so planned ACs must be flat, standalone, atomic, and objectively validatable. Include explicit valid/invalid examples that match the engine quality gate.
- **Pi session-plan workflow / daemon session-plan readiness** — ensure invalid `acceptance-criteria` content authored during planning is surfaced before the session can be marked ready. Prefer reusing the shared acceptance-criteria quality analyzer rather than duplicating Pi-only heuristics.

The max-turns infrastructure fix has since been merged to `main`; this continuation should still audit the WIP checkpoint first, but the prior max-turns failure should not be treated as a reason to avoid rerun.

The last commit is a **WIP continuation checkpoint** — the code may have failing tests, type errors, or incomplete edits. The first task is to audit and repair the existing state before adding anything new.

## Goal

Drive the existing partial implementation to a complete, passing state. All targeted validation commands must pass. All acceptance criteria from the original PRD must be satisfied.

## Problem Background

Acceptance criteria that are not standalone and validatable can be enqueued today. The extractor treats every bullet under `## Acceptance Criteria` as a criterion. Grouping labels (`Tests cover:`) and incomplete fragments (`` `pnpm type-check`. ``) enter the expected inventory and produce synthetic `unknown` verdicts that fail otherwise-successful builds.

The quality gate implemented in the prior session should reject or normalize these before queue write.

## Approach

1. **Audit the WIP state.** Read the current content of each modified file. Identify type errors, broken imports, incomplete function bodies, or half-applied changes.
2. **Fix and complete the implementation.** Repair any issues found. Do not rewrite from scratch unless a file is fundamentally broken.
3. **Update planning-time AC constraints.** Extend `/eforge:plan` skill guidance and session-plan readiness diagnostics so acceptance criteria created in Pi planning sessions conform to the same validatable shape enforced at enqueue time.
4. **Run targeted validation commands** and fix failures until all pass.
5. **Keep scope tight.** Do not add unrelated product changes; the only added scope is the user-requested Pi planning workflow constraint for acceptance criteria.

## Acceptance Criteria

- Enqueue rejects a formatted PRD before queue write when `## Acceptance Criteria` contains a grouping/header bullet such as `Tests cover:` or `Targeted validation passes:`. Validation: unit/integration test asserts `enqueue:failed` is emitted and no `.eforge/queue/*.md` file is created.
- Enqueue rejects incomplete command-fragment ACs such as `` `pnpm type-check`. `` that do not state an expected result. Validation: focused AC quality test reports an actionable diagnostic; the corresponding enqueue test confirms no queue file is written.
- Complete command-based ACs such as `` `pnpm type-check` exits 0. `` are accepted. Validation: focused AC quality test marks the item valid.
- Nested or grouped AC structures do not cause parent grouping bullets to enter the expected acceptance inventory. Validation: extractor/quality tests cover a parent bullet ending in `:` with child bullets and assert only valid leaf criteria are accepted, or the grouped structure is rejected with guidance to flatten it.
- Each accepted AC is atomic enough for final validation: it must contain a concrete observable condition, validation method, command expectation, file/event/API expectation, or test expectation. Validation: quality-gate tests cover valid event/test/file/command criteria and invalid vague criteria like `Works correctly.` / `Improves reliability.`
- Formatter prompt instructs agents to emit flat, standalone, validatable AC bullets and to avoid grouping labels in the AC list. Validation: prompt text test or snapshot/string assertion verifies the instruction is present.
- `/eforge:plan` skill guidance constrains planned acceptance criteria to the valid AC shape: flat, standalone, atomic, observable, and no grouping labels or bare command fragments. Validation: skill text test or snapshot/string assertion verifies the instruction and examples are present.
- Pi session-plan readiness surfaces invalid `acceptance-criteria` content before the plan is marked ready. Validation: session-plan helper/daemon route tests show criteria like `Tests cover:` and `` `pnpm type-check`. `` produce actionable diagnostics and prevent readiness, while `` `pnpm type-check` exits 0. `` remains ready when other required dimensions are covered.
- Final PRD validation behavior remains fail-closed for real expected criteria. Validation: existing PRD validator fail-closed tests continue to pass.
- `pnpm vitest run test/acceptance-criteria-quality.test.ts test/acceptance-criteria-extractor.test.ts test/prd-validator-fail-closed.test.ts` exits 0.
- Session-plan / Pi-planning targeted tests covering acceptance-criteria readiness diagnostics and `/eforge:plan` skill guidance exit 0.
- `pnpm type-check` exits 0.

## Out of Scope

- Rewriting the quality gate logic from scratch (audit and repair the existing implementation).
- Client wire schema changes.
- Claude Code plugin workflow changes, unless shared docs/skill text or parity obligations require them.
- Broad Pi UI redesign beyond planning-time AC guidance/readiness diagnostics.
- Duplicating full formatter/preprocessing behavior in daemon API prevalidation.
- Any changes not already started in the prior session.
