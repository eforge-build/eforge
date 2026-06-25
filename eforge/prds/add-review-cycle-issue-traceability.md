---
title: Add Review-Cycle Issue Traceability
created: 2026-06-25
---

# Add Review-Cycle Issue Traceability

## Problem / Motivation

Current review-cycle observability can show reviewer issues, review-fixer activity, and evaluator verdicts by round, but it cannot reliably trace one reviewer issue through the rest of the cycle.

Current source evidence points to this gap across the stack:
- `ReviewIssueSchema` has no stable issue identifier.
- Reviewer parsing and prompt contracts do not carry issue IDs.
- Review-fixer events record only coarse activity such as issue count and completion.
- Evaluator verdicts are tied to file, hunk, action, and outcome rather than reviewer issue identity.
- Console review-cycle detail views render side-by-side lanes rather than causal issue traces.

The user-facing problem is ambiguity. When a reviewer reports multiple issues, a fixer changes files, and the evaluator accepts or rejects hunks, the inspector cannot prove which issue was addressed, deferred, obsolete, unresolved, or accepted as non-blocking.

## Goal

Add optional reviewer issue traceability across `@eforge-build/client`, engine review/fix/evaluate contracts, and the Console inspector.

New traces should make reviewer → fixer → evaluator relationships explicit while older event logs without IDs continue to render correctly.

## Approach

Implement this schema-first and additively:
- Introduce optional review issue IDs.
- Introduce optional fixer issue-reference fields.
- Introduce optional evaluator issue-reference fields.
- Have the engine assign and propagate IDs for new review-cycle events.
- Derive linked and unlinked issue traces in Console while preserving older logs.

Design decisions:
- Use `issueId` rather than a generic `id` on `ReviewIssue` to avoid ambiguity with event IDs or stored-event IDs.
- Treat issue IDs as optional in the wire schema but engine-assigned for current build reviewer outputs before events are emitted.
- Parse agent-supplied IDs only as optional input.
- Do not rely on the model to create canonical IDs.
- Generate IDs deterministically from review-cycle context such as round, perspective/lane, and issue ordinal.
- Include collision handling for generated IDs.
- Treat issue IDs as stable traceability within the emitted review cycle, not semantic matching across independent reruns.
- Model relationships as many-to-many.
- Allow a fixer summary entry to reference one issue ID with status `addressed`, `deferred`, or `obsolete`.
- Allow evaluator verdicts to reference an array of reviewer issue IDs because one diff hunk can address multiple issues and one issue can require multiple hunks.
- Keep invalid or missing optional references non-fatal.
- Preserve or surface unknown referenced IDs as dangling/unmatched metadata in Console rather than breaking event parsing or the build.
- Prefer structured tool/submission output for fixer/evaluator references when feasible.
- If fallback XML/prose parsing is required, make it best-effort and tested with legacy no-reference output.
- In Console, render linked traces first.
- In Console, keep separate unlinked reviewer/fixer/evaluator lanes for older traces or incomplete references.
- Regenerate or update event/schema reference artifacts if client event docs are generated from TypeBox schemas.
- Update prompt examples so agents see the optional issue-reference contract.

Primary code surfaces:
- `packages/client/src/events/shared/schemas.ts`: add optional `issueId` to `ReviewIssueSchema`; add reusable issue-reference schema(s); update review failure/evaluation shared shapes if they mirror build evaluator verdicts.
- `packages/client/src/events/variants/build.ts`: add optional issue references to `plan:build:review:fix:complete` and evaluator verdict entries under `plan:build:evaluate:complete`.
- `packages/client/src/events/root.ts`, event utility exports, and generated/reference docs as needed so downstream packages consume the new typed fields from the client.
- `packages/engine/src/schemas.ts`: update review issue YAML schemas shown to reviewers and optional issue-reference schemas shown to fixer/evaluator agents.
- `packages/engine/src/agents/reviewer.ts` and `packages/engine/src/agents/parallel-reviewer.ts`: parse optional issue IDs if supplied, assign deterministic IDs when missing, and ensure emitted reviewer issues carry unique IDs for new build review-cycle events.
- `packages/engine/src/agents/review-fixer.ts` and `packages/engine/src/prompts/review-fixer.md`: ask for/collect structured issue-reference status output and emit it on fix completion when available.
- `packages/engine/src/evaluation-schemas.ts`, evaluator prompt/tool/XML parsing, and build-stage evaluator emission: allow evaluator verdicts to include optional reviewer issue ID references.
- `packages/console-ui/src/components/pipeline/review-cycle-detail-model.ts` and `review-cycle-detail-sheet.tsx`: build and render reviewer → fixer → evaluator traces plus legacy unlinked lanes.
- Tests under existing logical units, especially client event schema tests, reviewer parser/propagation tests using `StubHarness`, evaluation schema/application tests, and Console review-cycle detail model/sheet tests.

Implementation constraints:
- Keep changes bounded because some touched files are already sizable.
- Prefer small exact edits.
- Use balanced region markers where required.
- Do not add local wire-shape re-declarations outside the shared client package.

Assumptions:
- The plan can remain additive/optional.
- No migration or breaking event contract is required.
- Engine-assigned IDs are acceptable as the canonical IDs for future review-cycle events.
- Traceability is informational/observability metadata.
- Traceability metadata should not change build success/failure semantics by itself.

Build confidence is medium-high because the changes are additive and the current round/detail projection already exists. The main risks are fixer/evaluator structured-output compliance and many-to-many mappings, covered by schema compatibility, propagation, and Console legacy tests.

Key risks to watch during validation:
- False precision from weak references.
- Prompt non-compliance.
- Many-to-many issue/hunk mappings.
- Accidental breakage of legacy event consumers.

## Scope

In scope:
- Add an optional stable reviewer issue identifier to the shared `ReviewIssue` wire/schema shape in `@eforge-build/client` and the engine prompt/schema helpers.
- Ensure current build-review events can emit issue IDs for reviewer issues, including parallel perspective reviews.
- Add optional fixer output references that classify known reviewer issue IDs as intentionally addressed, deferred, or obsolete when the fixer completes.
- Add optional evaluator verdict references that connect pass/fail/review outcomes back to one or more reviewer issue IDs.
- Update Console review-cycle detail projection and sheet rendering so linked traces are visible when IDs exist, and unlinked/legacy lanes remain readable when they do not.
- Add tests for schema compatibility, parser/ID assignment, engine propagation, evaluator/fixer reference handling, and Console linked/unlinked rendering.

Out of scope:
- Backfilling historical event logs.
- Requiring IDs on old traces.
- Changing review-cycle scheduling.
- Changing retry policy.
- Changing recovery decisions.
- Changing acceptance-validation gates.
- Changing evaluator strictness semantics.
- Making issue IDs a global issue tracker.
- Making issue IDs a cross-run semantic identity system.
- Blocking a build solely because optional traceability metadata is missing, unless an existing required reviewer/evaluator contract is otherwise violated.

## Acceptance Criteria

- Shared event schemas accept older review events without issue IDs.
- Shared event schemas accept older evaluator events without issue IDs.
- Shared event schemas accept new events with optional reviewer issue IDs.
- Shared event schemas accept new events with optional reviewer issue references.
- `ReviewIssueSchema` exposes an optional `issueId` field.
- New build review-cycle reviewer issue events include unique `issueId` values for emitted issues whenever the engine has enough round/lane context to assign them.
- Reviewer parsers accept optional issue ID attributes or fields.
- Reviewer parsers do not reject legacy reviewer output that omits issue IDs.
- Reviewer ID assignment generates IDs when reviewer output has no ID.
- Reviewer ID assignment preserves valid supplied IDs when reviewer output includes them.
- Reviewer ID assignment handles duplicate supplied IDs without emitting duplicate issue IDs.
- Reviewer ID assignment handles generated-ID collisions without emitting duplicate issue IDs.
- Strict reviewer parser behavior remains valid with optional issue ID input.
- Synthetic contract issues receive valid issue IDs when emitted.
- Review-fixer completion can record optional per-issue references for reviewer issue IDs.
- Review-fixer completion can classify referenced issue IDs as `addressed`.
- Review-fixer completion can classify referenced issue IDs as `deferred`.
- Review-fixer completion can classify referenced issue IDs as `obsolete`.
- Missing fixer references remain valid legacy behavior.
- Evaluator verdicts can record optional reviewer issue ID references.
- Evaluator verdicts can reference multiple reviewer issue IDs in one verdict.
- Unknown referenced issue IDs do not break event parsing.
- Unknown referenced issue IDs do not break the build.
- Console preserves or surfaces unknown referenced issue IDs as dangling or unmatched metadata.
- Console review-cycle detail views show an end-to-end reviewer → fixer → evaluator trace when IDs and references exist.
- Console review-cycle detail views still render old side-by-side reviewer/fixer/evaluator lanes when IDs and references do not exist.
- Console renders linked traces before separate unlinked reviewer/fixer/evaluator lanes.
- `safeParseEforgeEvent` validates old events without issue IDs.
- `safeParseEforgeEvent` validates new events with optional issue IDs and references.
- Engine propagation with `StubHarness` passes reviewer issue IDs to the fixer prompt.
- Engine propagation with `StubHarness` emits fixer references when available.
- Engine propagation with `StubHarness` emits evaluator verdict references when available.
- Engine propagation with `StubHarness` keeps missing references non-fatal.
- Console model tests include one fully linked issue.
- Console model tests include one dangling evaluator reference.
- Console model tests include one legacy unlinked round.
- Console sheet or rendering tests verify linked trace labels.
- Console sheet or rendering tests verify linked trace statuses.
- Console sheet or rendering tests verify old traces without IDs remain visible.
- `pnpm type-check` exits 0.
- `pnpm test` exits 0.
- `pnpm docs:check` exits 0 if generated docs are regenerated.
- `pnpm maintainability:check` exits 0.