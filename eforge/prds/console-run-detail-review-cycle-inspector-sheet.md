---
title: Console Run Detail Review-Cycle Inspector Sheet
created: 2026-06-02
depends_on: []
profile: ui
landing: pr
landing_auto_merge: true
---

# Console Run Detail Review-Cycle Inspector Sheet

## Problem / Motivation

The run detail pipeline shows that a plan entered `review-cycle`, and individual reviewer/fixer/evaluator agent bars can be opened one at a time, but there is no stage-level view that explains what happened across the whole cycle.

This makes review-cycle behavior hard to inspect:

- Reviewer discoveries are split across raw event log entries, tooltips, and agent bars.
- Review-fixer contributions are visible only as an individual agent detail or file activity, not connected to the cycle context.
- Evaluator decisions and cycle termination rationale are visible as timeline markers/log events, not summarized with the related reviewers and fixers.
- Users cannot click the `review-cycle` pill above a plan to answer: "What did each agent contribute in this review cycle?"

### Context

This session promotes backlog item `backlog-2026-06-02-console-run-detail-review-cycle-inspector-sheet`, which depends on `backlog-2026-06-02-review-cycle-inspector-foundation-round-metadata-and-review-`.

Evidence gathered on current `main`:

- `packages/console-ui/src/components/pipeline/stage-overview.tsx` renders `StagePill` as a hover-only `span`. Stage pills are not clickable controls today.
- `packages/console-ui/src/components/pipeline/thread-pipeline.tsx` owns pipeline-level selection state for `hoveredStage` and `selectedAgentId`, groups threads by plan, computes per-plan build stages, and renders one `AgentDetailSheet` for selected agent bars.
- `packages/console-ui/src/components/pipeline/plan-row.tsx` renders `BuildStageProgress`, per-agent timeline bars, reviewer issue summaries in tooltips, perspective error markers, validation lanes, and `DecisionTimeline` markers. It receives `eventsByAgent`, raw `threads`, `decisions`, `issuesByPerspective`, and `perspectiveErrors` for a plan.
- `packages/console-ui/src/components/pipeline/agent-detail-sheet.tsx` already provides a right-side `SheetPanel` pattern for agent-level detail, including usage, warnings, retries, deterministic file activity, tool calls, messages, and final result text.
- `packages/console-ui/src/components/pipeline/decision-timeline.tsx` already opens a right-side `SheetPanel` for decision details.
- `packages/console-ui/src/components/ui/sheet-panel.tsx` is the reusable sheet wrapper to use for a review-cycle inspector.
- Raw run events contain the durable details needed for a review-cycle inspector: review/perspective complete events with issues, review-fix lifecycle events and continuations, evaluator complete events with accepted/rejected counts and verdict summaries, build decision events with strategy/strictness/termination rationale, and agent lifecycle/activity records.

Assumed starting point:

- The foundation build is enqueued as queue item `add-review-cycle-round-metadata-and-review-fix-stage-mapping` and should land first so `review-fix` is part of console stage modeling and review/fix/evaluate lifecycle events can carry optional `round` metadata.
- When enqueueing this inspector plan through eforge, use `afterQueueId: add-review-cycle-round-metadata-and-review-fix-stage-mapping` so it stacks/waits behind the foundation build.
- This plan still requires a fallback path for old logs or builds whose events do not carry `round`.

Roadmap alignment:

- Aligns with `docs/roadmap.md` under Console Observability and Control by making the console run detail a richer build observability surface.
- Respects engine boundary discipline by rendering already-emitted typed events rather than moving workflow orchestration into the UI.

Classification: this is a **feature / focused** change with high confidence. It is UI-focused but crosses component state, selectors, and tests.

## Goal

Provide a visual stage-level inspector opened from the `review-cycle` pill, showing rounds, participating agents, reviewer issues, fixer activity, evaluator verdicts, and the cycle summary, so users can understand what each agent contributed across the whole review cycle.

## Approach

### Design Decisions

- Build the sheet from a normalized data model rather than filtering raw events directly in JSX. This keeps the UI component focused and makes round grouping testable.
- Prefer explicit `round` fields when present. Fall back to inference for old logs by using `perspectives-respawned` decision timestamps as round boundaries, and then a single synthetic round when neither explicit rounds nor round-start decisions exist.
- Use raw stored events, not reducer summary maps, for round-specific details. Reducer maps such as `reviewIssuesByPerspective` can overwrite repeated perspectives across rounds.
- Treat the `review-cycle` pill as the only selectable stage for this iteration. The plumbing may support a generic `onStageSelect`, but non-review-cycle stages should not open empty panels.
- Render the inspector as a right-side `SheetPanel` to match existing agent and decision detail behavior.
- Keep the review-cycle sheet open/close state in `ThreadPipeline`. When an agent card inside the sheet is opened, close the review-cycle sheet and set `selectedAgentId` so the existing `AgentDetailSheet` opens. This avoids two competing right-side sheets.
- Present causal relationships honestly. Place reviewer issues, fixer activity, and evaluator verdicts in the same round, but do not claim an exact issue-to-file-to-verdict mapping unless the data explicitly supports it.
- Show summaries first, then detail. The sheet should start with counts and final cycle summary, then show round cards with three visual lanes: reviewers, review-fixer, evaluator.
- Keep cards compact and scannable: severity/category/file for issues, file/diffstat for fixer activity, action/outcome/file/reason for evaluator verdicts.
- Include empty and partial states. If no issues, no fixer ran, or no evaluator ran, render explicit "none recorded" text rather than omitting the lane.
- Preserve accessibility: selectable stage pills should be real buttons with `type="button"`, focus styles, and an `aria-label` that names the plan and stage.

### Code Impact

Expected implementation targets:

- `packages/console-ui/src/components/pipeline/stage-overview.tsx`: make `StagePill` optionally selectable, preserve hover callbacks, add accessible button behavior for selectable stages, and pass selection through `BuildStageProgress`.
- `packages/console-ui/src/components/pipeline/thread-pipeline.tsx`: add selected stage/review-cycle state, pass stage selection handlers to plan rows, compute review-cycle detail data for the selected plan, render `ReviewCycleDetailSheet`, and coordinate opening agent detail from the sheet.
- `packages/console-ui/src/components/pipeline/plan-row.tsx`: accept an optional stage selection callback and pass it to `BuildStageProgress` for plan build stages.
- New selector/model file, likely `packages/console-ui/src/components/pipeline/review-cycle-detail-model.ts` or `packages/console-ui/src/lib/run-state/selectors/review-cycle-details.ts`: derive a normalized `ReviewCycleDetail` from `StoredEvent[]`, `AgentThread[]`, plan id, and plan decisions.
- New UI component file, likely `packages/console-ui/src/components/pipeline/review-cycle-detail-sheet.tsx`: render summary metrics, per-round reviewer/fixer/evaluator lanes, issue cards, file activity, evaluator verdicts, and raw-event fallback affordances.
- `packages/console-ui/src/components/pipeline/pipeline-colors.ts` only if additional status/severity color helpers are needed; prefer local component classes first.
- Tests under `packages/console-ui/src/components/pipeline/__tests__/`: add selector tests and component interaction/rendering tests. Existing tests in this directory use Vitest and Testing Library patterns.

Data sources to use:

- Raw `StoredEvent[]` for all per-round lifecycle details so repeated rounds do not overwrite each other.
- `DecisionPoint[]` for review strategy, perspective respawn, evaluator strictness, and cycle termination summary.
- `AgentThread[]` for agent identity, perspective, model, duration, token/cost usage, result text, and deterministic file activity.
- Existing `AgentDetailSheet` for deep per-agent inspection rather than duplicating all agent detail content in the review-cycle sheet.

Important existing patterns:

- `AgentDetailSheet` and `DecisionTimeline` already use `SheetPanel`; reuse that pattern.
- `ThreadPipeline` already holds `selectedAgentId`; extending it with selected review-cycle state avoids pushing global state into lower components.
- `BuildStageProgress` already receives `buildStages`, `currentStage`, `hoveredStage`, and `threads`; adding an optional stage click callback is a narrow change.
- Files over 300 lines should use durable region markers if new large components exceed the threshold; new implementation files must stay under 600 lines.

### Profile Signal

Recommended profile: **Excursion**.

Rationale:

- The implementation is a cohesive console-ui feature with known component boundaries and test targets.
- It crosses a few files and introduces a selector plus a sheet component, so it is more than an Errand.
- It does not require architecture decomposition or delegated module planning because engine/schema changes are explicitly handled by the prerequisite foundation plan.
- Enqueue this after the foundation plan has landed, or chain it with `afterQueueId: add-review-cycle-round-metadata-and-review-fix-stage-mapping` if building through eforge.

### Assumptions And Validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| The foundation plan will land before this inspector plan is built. | This backlog item depends on `backlog-2026-06-02-review-cycle-inspector-foundation-round-metadata-and-review-`; the foundation build is currently enqueued/running as queue item `add-review-cycle-round-metadata-and-review-fix-stage-mapping`. | high | low | Enqueue this plan with `afterQueueId: add-review-cycle-round-metadata-and-review-fix-stage-mapping` or wait until that queue item lands before enqueueing. | If wrong, the inspector can still use fallback inference, but explicit round grouping and `review-fix` stage selection may require additional implementation in this plan. |
| Raw `StoredEvent[]` contains enough detail to render repeated rounds without relying on reducer maps. | Inspected event schemas and console handlers; reducer maps store latest perspective issues, but raw events preserve individual complete events. | high | low | Build selector tests with repeated perspectives across two rounds. | If wrong, the sheet could merge or lose per-round reviewer details. |
| Agent threads can be associated with rounds by explicit event windows and timestamps. | `AgentThread` records `startedAt`, `endedAt`, `agent`, `planId`, and `perspective`; lifecycle events provide round start/complete timestamps after the foundation. | medium | medium | Add selector tests with multiple reviewer/fixer/evaluator threads across rounds. | If wrong, agent cards may appear under the wrong round; the UI should label uncertain grouping as inferred rather than exact. |
| Closing the review-cycle sheet before opening `AgentDetailSheet` is acceptable UX. | Existing UI uses one right-side sheet pattern; overlapping Radix sheets would likely be confusing. | high | low | Component test can assert review sheet closes and agent detail opens after clicking an agent detail action. | If wrong, users may prefer keeping review context visible while inspecting an agent, requiring a different split-panel or nested-detail design. |
| The selector and sheet can stay within maintainability limits if split into separate model and component files. | New implementation files can each stay under the 600-line limit; existing components can receive narrow prop additions. | high | low | Run `pnpm maintainability:check` if implementation grows. | If wrong, the implementation may violate file-size or complexity guardrails and require further decomposition. |
| No exact issue-to-fix-to-verdict traceability should be claimed in this UI. | Current `ReviewIssue` lacks stable issue IDs, review-fixer activity is file-level, and evaluator verdicts are file/hunk based. | high | low | Keep copy and data model labels at round/lane level; do not label a file change as fixing a specific reviewer issue. | If wrong, the UI could mislead users about causal attribution. |

## Scope

### In scope

- Add click handling for build stage pills so the `review-cycle` stage pill can open a stage-level inspector.
- Keep hover highlighting behavior intact when converting selectable stage pills to buttons.
- Add a normalized review-cycle detail selector/model that derives per-plan review-cycle details from raw stored events, decisions, and agent threads.
- Render a `ReviewCycleDetailSheet` using `SheetPanel` with visual round-oriented sections for reviewers, review-fixers, evaluators, perspective errors, continuations/retries, file activity, verdicts, and cycle summary.
- Surface the best available phase/cycle summary, especially `cycle-terminated` decision rationale and final evaluator counts.
- Provide links/buttons from agent cards inside the sheet to open existing `AgentDetailSheet` for the selected agent.
- Support multiple rounds and parallel perspectives.
- Support old or partial logs by falling back to inferred grouping when explicit round metadata is unavailable.
- Add focused selector and component tests.

### Out of scope

- Do not add or change engine event schemas in this change; that belongs to the dependency foundation plan.
- Do not add stable reviewer issue IDs or exact issue-to-fix-to-verdict causal mapping.
- Do not change reviewer, review-fixer, or evaluator prompts.
- Do not add new daemon routes or REST APIs.
- Do not redesign the entire run detail pipeline, timeline, or agent detail sheet.
- Do not add inspectors for non-review-cycle stages except generic plumbing that makes future stage inspectors possible.

## Acceptance Criteria

- Clicking a plan row `review-cycle` stage pill opens a right-side sheet titled with the plan id and `review-cycle`.
- Non-`review-cycle` stage pills do not open the review-cycle inspector.
- Hovering a selectable stage pill still highlights and dims timeline bars using the existing hover behavior.
- The review-cycle sheet displays the cycle termination rationale when a `cycle-terminated` build decision exists for the plan.
- The review-cycle sheet displays review strategy information when a `review-strategy` build decision exists for the plan.
- The review-cycle sheet displays evaluator strictness information when an `evaluator-strictness` build decision exists for the plan.
- The review-cycle sheet renders separate round sections when review-cycle events contain different `round` values.
- The review-cycle detail selector groups reviewer perspective issues under the matching explicit round when `round` is present on perspective complete events.
- The review-cycle detail selector groups evaluator verdicts under the matching explicit round when `round` is present on evaluate complete events.
- The review-cycle detail selector groups review-fixer lifecycle and continuation events under the matching explicit round when `round` is present on review-fix events.
- The review-cycle detail selector falls back to inferred round grouping for logs that do not contain explicit `round` fields.
- The review-cycle sheet displays reviewer cards for parallel perspectives and shows each perspective's issue count.
- The review-cycle sheet displays issue severity, category, file, line when present, description, and suggested fix when present.
- The review-cycle sheet displays perspective errors with the perspective key and error message.
- The review-cycle sheet displays review-fixer file activity from the matching `AgentThread.activity` when activity is available.
- The review-cycle sheet displays review-fixer continuation attempts when `plan:build:review:fix:continuation` events exist.
- The review-cycle sheet displays evaluator accepted and rejected counts from `plan:build:evaluate:complete`.
- The review-cycle sheet displays evaluator verdict file, hunk when present, action, issue outcome when present, reason, and retry guidance when present.
- Clicking an agent detail action inside the review-cycle sheet closes the review-cycle sheet and opens the existing `AgentDetailSheet` for that agent.
- The review-cycle sheet renders an explicit empty-state message for a round with no reviewer issues.
- The review-cycle sheet renders an explicit empty-state message for a round with no review-fixer activity.
- The review-cycle sheet renders an explicit empty-state message for a round with no evaluator verdicts.
- A selector unit test covers a two-round review cycle with reviewer issues, fixer activity, evaluator verdicts, and a termination summary.
- A selector unit test covers fallback grouping for legacy events without explicit `round` fields.
- A component test covers opening the sheet by clicking the `review-cycle` pill.
- A component test covers opening an agent detail from inside the review-cycle sheet.
- `pnpm type-check` exits 0.
- `pnpm test` exits 0.
