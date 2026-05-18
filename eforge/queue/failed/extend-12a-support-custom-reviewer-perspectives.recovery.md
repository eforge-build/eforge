# Recovery Analysis: extend-12a-support-custom-reviewer-perspectives

**Generated:** 2026-05-18T14:41:12.025Z
**Set:** extend-12a-support-custom-reviewer-perspectives
**Feature Branch:** `eforge/extend-12a-support-custom-reviewer-perspectives`
**Base Branch:** `main`
**Failed At:** 2026-05-18T08:10:27.758Z

## Verdict

**SPLIT** (confidence: high)

## Rationale

plan-01 (perspective-contracts) completed and merged cleanly with a feat commit. plan-02 (runtime-catalog-and-review) left a WIP checkpoint commit ("continuation checkpoint (attempt 2)") on the feature branch — it started and made partial progress but failed before producing a clean merge commit. plan-03 (planning-ui-docs-examples) never ran because it depended on plan-02. The substantial diff (40 files, 3061 insertions) reflects work across both plan-01 and plan-02's partial run. The WIP checkpoint subject says "attempt 2," indicating plan-02 already retried once and failed again — this is not a transient issue. Splitting is appropriate: plan-01's foundation (SDK contracts, loader validation, wire schema changes, client types) is solid and worth preserving; the successor session picks up from plan-02's partial state through plan-03's remaining scope.

## Plans

| Plan | Status | Error |
|------|--------|-------|
| plan-03-planning-ui-docs-examples | failed | Blocked by failed dependency: plan-02-runtime-catalog-and-review |

## Failing Plan

**Plan ID:** plan-03-planning-ui-docs-examples
**Error:** Blocked by failed dependency: plan-02-runtime-catalog-and-review

## Landed Commits

| SHA | Subject | Author | Date |
|-----|---------|--------|------|
| `36ab1569` | wip(plan-02-runtime-catalog-and-review): continuation checkpoint (attempt 2) | Mark Schaake | 2026-05-18T01:02:19-07:00 |
| `4f9cba24` | feat(plan-01-perspective-contracts): Perspective Contracts and Loader Validation | Mark Schaake | 2026-05-18T00:45:54-07:00 |
| `5ebd2f37` | plan(extend-12a-support-custom-reviewer-perspectives): planning artifacts | Mark Schaake | 2026-05-17T23:59:16-07:00 |

## Models Used

- claude-sonnet-4-6
- gpt-5.5

## Completed Work

- plan-01-perspective-contracts: SDK contract updated — ReviewerPerspectiveSpec extended with description, applicability callback types, and bounded context shape (extension-sdk/src/api.ts, hooks.ts, index.ts)
- plan-01-perspective-contracts: Loader/recorder validation updated — accepts valid specs, rejects invalid specs, rejects duplicate extension keys, diagnoses collisions with built-in perspective keys (engine/src/extensions/recorder.ts, types.ts)
- plan-01-perspective-contracts: Wire schema and client types partially relaxed — ReviewPerspectiveKey string schema introduced; built-in constants preserved (client/src/events.schemas.ts, types.ts)
- plan-01-perspective-contracts: Extension projector updated to expose reviewer perspective registration detail beyond counts (engine/src/extensions/projector.ts)
- plan-01-perspective-contracts: Loader and schema tests updated/added (test/extension-loader.test.ts, test/extension-replay.test.ts, test/schemas.test.ts, test/config.test.ts)
- plan-02-runtime-catalog-and-review (partial/WIP): review-perspective-catalog.ts created (188 lines) — catalog builder combining built-ins and extension registrations
- plan-02-runtime-catalog-and-review (partial/WIP): review-perspective-keys.ts created (53 lines) — safe key pattern and constants
- plan-02-runtime-catalog-and-review (partial/WIP): reviewer-perspective-runtime.ts created (253 lines) — applicability evaluation and runtime support
- plan-02-runtime-catalog-and-review (partial/WIP): parallel-reviewer.ts partially updated (163 changed lines)
- plan-02-runtime-catalog-and-review (partial/WIP): build-stages.ts partially updated (210 changed lines)
- plan-02-runtime-catalog-and-review (partial/WIP): test files scaffolded for catalog, runtime, and parallel-reviewer custom perspective (reviewer-perspective-catalog.test.ts, reviewer-perspective-runtime.test.ts, parallel-reviewer-custom-perspective.test.ts)

## Remaining Work

- plan-02 completion: Audit WIP state of parallel-reviewer.ts — verify catalog-aware resolver fully replaces hard-coded built-in maps; confirm custom perspectives execute with generic prompt/schema plus provenance-wrapped promptFragment
- plan-02 completion: Audit WIP state of build-stages.ts — verify extension registry/catalog is passed into review execution and adaptive review-cycle selection; verify no closed isReviewPerspective checks drop custom perspective metadata
- plan-02 completion: Review cycle perspectives (review-cycle-perspectives.ts) — separate built-in heuristic perspectives from arbitrary perspective keys; merge applicable extension perspectives in auto mode; trigger parallel review when extension perspectives apply even below size thresholds
- plan-02 completion: Review heuristics (review-heuristics.ts) — keep built-in category inference closed; extension keys flow through without rejection
- plan-02 completion: Config runtime validation — unregistered custom keys fail clearly at runtime with a diagnostic; registered keys succeed when extension is loaded and trusted
- plan-02 completion: Applicability evaluation discipline — bounded read-only frozen context (planId, changedFiles, fileCategories, diffStats, reviewStrategy, configuredPerspectives, cwd, provenance); no exec/mutable handles; timeout per extensions.reviewerPerspectiveTimeoutMs; fail-open for auto applicability errors; fail-clearly for explicitly requested perspectives that cannot be evaluated
- plan-02 completion: Custom perspective keys flowing cleanly through plan:build:review:parallel:start, perspective:start, perspective:complete, perspective:error events; agent metadata; review issue grouping
- plan-02 completion: Diagnostics for applicability errors, timeouts, invalid applicability data, built-in collisions, and unavailable explicit perspective keys
- plan-02 completion: Ensure all new test files (reviewer-perspective-catalog.test.ts, reviewer-perspective-runtime.test.ts, parallel-reviewer-custom-perspective.test.ts) pass with full coverage of applicability skip/error/timeout and stub harness runs
- plan-02 completion: eforge.ts and orchestrator wiring — reviewerPerspectives available to build stages; nativeExtensionRegistry data flows to review execution path not just policy-gate path
- plan-03: Planner/module-planner/pipeline-composer guidance — inject registered custom perspective keys/descriptions into validPerspectives context so planners can select them; update planner.md, module-planner.md, pipeline-composer.md prompts to not assert only six built-ins are possible
- plan-03: planning:complete planConfigs — surface custom perspective keys/descriptions in diagnostics output
- plan-03: Monitor UI reducers — remove closed built-in type imports; handle custom perspective string keys in handle-plan-build.ts, handle-agent.ts, handle-decisions.ts
- plan-03: Monitor UI components — pipeline rows, plan detail sheets, build-config.tsx render custom perspective activity/issues without bespoke UI branches (string-key compatible rendering)
- plan-03: event-registry.ts and event-to-progress.ts — ensure custom keys render in CLI/event summaries
- plan-03: monitor/server.ts extension tooling routes — expose reviewer perspective registration detail in list/show outputs (beyond counts)
- plan-03: Docs updates — docs/extensions-api.md (runtime-supported, spec fields, applicability context, timeout/failure, explicit-vs-auto, limitations); docs/extensions.md (runtime support table, capability summary, reviewer perspectives supported vs validation providers deferred); packages/extension-sdk/README.md (support table, API summary)
- plan-03: New example — examples/extensions/accessibility-reviewer.ts (or design-system-reviewer.ts) showing description, promptFragment, and applicability rule; examples/extensions/README.md updated
- plan-03: Monitor-reducer tests for custom perspective key rendering; schema parity tests; planner visibility diagnostic test

## Risks

- plan-02's WIP checkpoint landed on "attempt 2" — the partial state in parallel-reviewer.ts and build-stages.ts may be internally inconsistent; the successor session must audit these files carefully before building on them rather than assuming they are correct starting points
- Type errors may be latent in the WIP state — pnpm build and pnpm type-check should be run first to establish a clean baseline before any new changes are made
- Closed schema drift risk — perspective keys are duplicated across client TypeBox schemas, engine Zod config, engine TypeBox schemas, planner prompts, runtime maps, and UI types; any location missed will cause custom key validation failures at runtime
- Config runtime validation gap — static schema was relaxed in plan-01 but dynamic catalog validation (unregistered keys fail at runtime) must be confirmed working in plan-02's WIP; if not in place, invalid perspective names will slip through silently
- Adaptive review cycle typing — second-round selection may still use closed ReviewPerspective types and silently drop custom perspective errors/issues; must be verified in the WIP state of review-cycle-perspectives.ts
- Test file scaffolding vs completion — the three large test files were created in the WIP commit but may contain incomplete or skipped test cases; they should be treated as drafts requiring completion rather than passing coverage

## Suggested Successor PRD

```markdown
# EXTEND_12A Continuation: Runtime Catalog, Review Execution, Planning Guidance, UI, Docs, and Examples

## Overview

This is a continuation of EXTEND_12A (Support Custom Reviewer Perspectives). The SDK contract, loader validation, wire schema relaxation, and client type changes from plan-01 are complete and merged. plan-02 (runtime catalog and review execution) left a WIP checkpoint with substantial partial work. This session completes plan-02 and implements plan-03 (planning guidance, monitor/UI, docs, and examples).

## Starting Point

Branch: `eforge/extend-12a-support-custom-reviewer-perspectives`

The following is already in place and merged cleanly (plan-01):

- `packages/extension-sdk/src/api.ts`, `hooks.ts`, `index.ts` — `ReviewerPerspectiveSpec` updated with `description`, applicability callback/result types, and bounded context shape; runtime support documented
- `packages/engine/src/extensions/recorder.ts`, `types.ts` — loader/recorder validation: accepts valid specs, rejects invalid specs, rejects duplicate extension keys, diagnoses built-in perspective key collisions
- `packages/engine/src/extensions/projector.ts` — reviewer perspective detail exposed beyond counts
- `packages/client/src/events.schemas.ts`, `types.ts` — `ReviewPerspectiveKey` safe string schema introduced; built-in constants preserved; `BUILT_IN_REVIEW_PERSPECTIVES` / `BuiltInReviewPerspective` retained for heuristic code
- `packages/client/src/event-registry.ts`, `events.ts`, `browser.ts`, `index.ts` — related exports updated
- `packages/engine/src/config.ts`, `schemas.ts` — config perspective validation relaxed to safe non-empty key pattern; static built-in enum constraint removed
- Test coverage in: `test/extension-loader.test.ts`, `test/extension-replay.test.ts`, `test/schemas.test.ts`, `test/config.test.ts`, `test/extension-sdk-example.test.ts`, `test/extension-tooling-routes.test.ts`, `test/per-plan-build-config.test.ts`

The following is partially in place as a WIP checkpoint (plan-02 - DO NOT assume correctness, audit before building on it):

- `packages/engine/src/review-perspective-catalog.ts` (188 lines) — catalog builder combining built-ins and extension registrations
- `packages/engine/src/review-perspective-keys.ts` (53 lines) — safe key pattern and constants
- `packages/engine/src/extensions/reviewer-perspective-runtime.ts` (253 lines) — applicability evaluation and runtime support
- `packages/engine/src/agents/parallel-reviewer.ts` — partially updated (catalog-aware resolver may be incomplete)
- `packages/engine/src/pipeline/stages/build-stages.ts` — partially updated (extension registry wiring may be incomplete)
- `packages/engine/src/review-cycle-perspectives.ts` — partially updated
- `packages/engine/src/review-heuristics.ts` — partially updated
- `packages/engine/src/eforge.ts` — partially updated
- Test scaffolds (may be drafts with incomplete or skipped cases): `test/reviewer-perspective-catalog.test.ts`, `test/reviewer-perspective-runtime.test.ts`, `test/parallel-reviewer-custom-perspective.test.ts`, `test/parallel-reviewer-perspective-validation.test.ts`

**First action**: run `pnpm build && pnpm type-check && pnpm test` to establish the current baseline. Diagnose and fix any pre-existing failures from the WIP state before making new changes.

## Goal

Complete the runtime extension point for `registerReviewerPerspective` so that custom reviewer perspectives:

1. Are built into a catalog per review run (built-ins + loaded extension registrations)
2. Execute as bounded reviewer-agent prompt lenses in the parallel review path
3. Flow through review config, events, agent metadata, monitor/UI, and CLI summaries with custom string keys
4. Are surfaced in planner guidance so planners can select them when appropriate
5. Are documented and demonstrated in a working example

## Remaining Acceptance Criteria

All of the following remain unimplemented or unverified. Items marked [plan-02] are from the partially-complete plan; items marked [plan-03] are entirely new.

### [plan-02] Runtime Catalog

- The build-time review runtime builds a catalog from built-in and extension perspectives for each review run
- Built-ins have prompt file + perspective-specific schema YAML
- Custom perspectives use a generic reviewer prompt/schema with a provenance-wrapped section appending label, description, and promptFragment
- Catalog ordering: built-in inferred/configured first, extension perspectives in loader registration order, de-duplicated by key
- Extensions cannot override built-in perspective keys (collision produces a diagnostic and skips the registration at runtime)

### [plan-02] Custom Perspective Execution

- The parallel reviewer executes applicable custom perspectives as reviewer-agent runs using the existing harness abstraction and generic review-issue parsing
- Custom perspective keys flow through the following without schema validation failures:
  - `plan:build:review:parallel:start`
  - `plan:build:review:parallel:perspective:start`
  - `plan:build:review:parallel:perspective:complete`
  - `plan:build:review:parallel:perspective:error`
  - agent metadata
  - review issue grouping
  - monitor/CLI/event summaries
- A failing reviewer agent for a custom perspective emits `plan:build:review:parallel:perspective:error` and continues other perspectives (same behavior as built-in perspective failures)

### [plan-02] Applicability Evaluation

- Applicability evaluation receives only a bounded read-only frozen context containing: planId, plan name/body or summary, changedFiles, fileCategories, diffStats, reviewStrategy, configuredPerspectives, cwd (metadata only), extension provenance
- No `ctx.exec`, no mutable engine objects, no direct state handles
- Applicability evaluation can influence only whether that perspective participates (no engine state mutation)
- Missing `appliesTo` means the perspective is selectable by config/planner but not auto-added during heuristic inference (config/explicit-only)
- Applicability timeout uses `extensions.reviewerPerspectiveTimeoutMs` (defaulting to `extensions.eventHookTimeoutMs`)
- Applicability errors/timeouts fail open (skip that extension perspective, emit a diagnostic), do not fail the build, do not mutate engine state
- Explicitly requested perspectives (via review config) that cannot be evaluated fail with a clear diagnostic rather than silently skipping

### [plan-02] Selection Behavior

- In `auto` mode: built-in threshold/category logic remains intact; applicable extension perspectives are merged into inferred perspectives; if one or more extension perspectives apply, parallel review runs even when size thresholds alone would choose single (rationale emitted naming extension applicability)
- In `single` mode: extension perspectives do not run
- Explicit `review.perspectives` keys must resolve in the catalog; unknown explicit keys fail with a clear diagnostic/build error
- Explicit config references to unavailable perspective keys fail clearly rather than silently skipping

### [plan-02] Diagnostics

- Coherent diagnostics/events emitted when: applicability evaluation fails, applicability evaluation times out, applicability returns invalid data, a perspective collides with a built-in key, review config references an unavailable perspective

### [plan-02] Engine Wiring

- `nativeExtensionRegistry` reviewer perspective data passes into build stage review execution (not just policy-gate path)
- `reviewerPerspectives` available to build stages via pipeline/types.ts
- Adaptive review-cycle second-round selection handles custom perspective string keys without dropping errors/issues (no closed `ReviewPerspective` type assertions that would break custom keys)
- No closed `isReviewPerspective` checks in build-stages.ts that would silently drop custom perspective metadata

### [plan-02] Config Validation

- Runtime validation: unregistered custom perspective keys in review config fail at runtime with a clear diagnostic when extension is not loaded
- Registered keys succeed when the extension is loaded and trusted
- Existing six built-in keys (`code`, `security`, `api`, `docs`, `test`, `verify`) remain backward compatible

### [plan-02] Tests

- `test/reviewer-perspective-catalog.test.ts` — fully passing: catalog construction, ordering, duplicate handling, built-in collision diagnostics
- `test/reviewer-perspective-runtime.test.ts` — fully passing: applicability evaluation, bounded context enforcement, timeout/error/skip behavior
- `test/parallel-reviewer-custom-perspective.test.ts` — fully passing: end-to-end custom perspective execution with StubHarness, event flow, issue grouping
- `test/parallel-reviewer-perspective-validation.test.ts` — updated to reflect new behavior (custom registered keys accepted, unregistered keys diagnosed)
- `test/schemas.test.ts` — wire schema acceptance of custom keys verified

### [plan-03] Planning Guidance

- `packages/engine/src/agents/planner.ts`, `module-planner.ts`, `pipeline-composer.ts` — registered custom perspective keys and descriptions injected into `validPerspectives` / planning guidance context
- `packages/engine/src/prompts/planner.md`, `module-planner.md`, `pipeline-composer.md` — updated to not assert only six built-ins are possible when extension perspectives are registered
- `planning:complete.planConfigs` — custom perspective keys/descriptions surfaced in diagnostics output
- If planner visibility is not achievable in this slice: an explicit diagnostic documents why, and acceptance notes the limitation clearly

### [plan-03] Monitor/UI and Event Summaries

- `packages/client/src/event-registry.ts`, `event-to-progress.ts` — custom perspective string keys render correctly in CLI/event summaries (no closed type switches that would silently miss custom keys)
- `packages/monitor-ui/src/lib/reducer/handle-plan-build.ts`, `handle-agent.ts`, `handle-decisions.ts` — closed built-in type imports removed or replaced with string-key-compatible handling; custom perspective keys stored and rendered correctly
- `packages/monitor-ui/src/components/pipeline/plan-row.tsx` and related pipeline components — custom perspective activity/issues render without bespoke UI branches (string-key compatible)
- `packages/monitor-ui/src/components/plans/build-config.tsx` — custom perspectives display correctly
- `packages/monitor/src/server.ts` extension tooling routes — reviewer perspective registration detail exposed in list/show outputs (not just counts)

### [plan-03] Docs

- `docs/extensions-api.md` — `registerReviewerPerspective` changed from deferred to runtime-supported; spec fields documented (key, label, description, promptFragment, appliesTo); applicability context documented; timeout/failure behavior documented; explicit-vs-auto selection documented; limitations documented
- `docs/extensions.md` — runtime support table updated; capability summary updated; reviewer perspectives marked supported, validation providers remain deferred
- `packages/extension-sdk/README.md` — support table and API summary updated
- `examples/extensions/README.md` — reviewer perspective example added to supported examples list

### [plan-03] Example

- New file: `examples/extensions/accessibility-reviewer.ts` (or `design-system-reviewer.ts`) demonstrating: description, promptFragment, and an applicability rule using changedFiles

### [plan-03] Tests

- Monitor reducer tests for custom perspective key rendering
- Planner visibility diagnostic test (confirms custom perspective keys appear in planning context or documents why not)

## Out of Scope

- Validation providers (EXTEND_12B)
- Arbitrary compile/build stage registration
- Extension mutation of plans, review config, issue lists, or engine state outside explicit return contracts
- Approval workflows or blocking policy decisions from reviewer perspectives
- Custom review issue schemas (custom perspectives use existing review-issue XML contract with string categories)
- Full event replay execution for reviewer perspectives
- Packaging/install semantics or changes to the native extension trust model
- SDK contract changes (already completed in plan-01)
- Loader/recorder validation changes (already completed in plan-01)
- Wire schema relaxation (already completed in plan-01)
- CHANGELOG.md edits (owned by the release process)
```

## Diff Stat

```
.../orchestration.yaml                             | 135 +++++++
 .../plan-01-perspective-contracts.md               |  99 +++++
 .../plan-02-runtime-catalog-and-review.md          | 102 ++++++
 .../plan-03-planning-ui-docs-examples.md           | 105 ++++++
 packages/client/src/browser.ts                     |  19 +-
 packages/client/src/event-registry.ts              |  23 ++
 packages/client/src/events.schemas.ts              |  86 ++++-
 packages/client/src/events.ts                      |   8 +
 packages/client/src/index.ts                       |  25 +-
 packages/client/src/types.ts                       |  17 +-
 packages/eforge/src/cli/index.ts                   |   8 +
 packages/engine/src/agents/parallel-reviewer.ts    | 163 ++++++---
 packages/engine/src/config.ts                      |  23 +-
 packages/engine/src/eforge.ts                      |   6 +
 packages/engine/src/extensions/projector.ts        |   8 +
 packages/engine/src/extensions/recorder.ts         |  25 +-
 .../src/extensions/reviewer-perspective-runtime.ts | 253 +++++++++++++
 packages/engine/src/extensions/types.ts            |   2 +-
 .../engine/src/pipeline/stages/build-stages.ts     | 210 +++++++++--
 packages/engine/src/pipeline/types.ts              |  11 +
 packages/engine/src/review-cycle-perspectives.ts   |  36 +-
 packages/engine/src/review-heuristics.ts           |   3 +
 packages/engine/src/review-perspective-catalog.ts  | 188 ++++++++++
 packages/engine/src/review-perspective-keys.ts     |  53 +++
 packages/engine/src/schemas.ts                     |   7 +-
 packages/extension-sdk/src/api.ts                  |  12 +-
 packages/extension-sdk/src/hooks.ts                |  40 ++-
 packages/extension-sdk/src/index.ts                |   4 +
 packages/monitor/src/server.ts                     |   5 +
 test/config.test.ts                                |  26 +-
 test/extension-loader.test.ts                      | 147 +++++++-
 test/extension-replay.test.ts                      |   2 +-
 test/extension-sdk-example.test.ts                 |  24 ++
 test/extension-tooling-routes.test.ts              |  36 ++
 test/parallel-reviewer-custom-perspective.test.ts  | 328 +++++++++++++++++
 ...arallel-reviewer-perspective-validation.test.ts | 106 +++++-
 test/per-plan-build-config.test.ts                 |   2 +-
 test/reviewer-perspective-catalog.test.ts          | 287 +++++++++++++++
 test/reviewer-perspective-runtime.test.ts          | 399 +++++++++++++++++++++
 test/schemas.test.ts                               | 165 ++++++++-
 40 files changed, 3061 insertions(+), 137 deletions(-)
```
