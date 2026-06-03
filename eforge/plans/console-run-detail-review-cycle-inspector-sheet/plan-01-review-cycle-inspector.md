---
id: plan-01-review-cycle-inspector
name: Console Run Detail Review-Cycle Inspector Sheet
branch: console-run-detail-review-cycle-inspector-sheet/plan-01-review-cycle-inspector
agents:
  builder:
    effort: high
    rationale: Breadth of ~30 acceptance criteria plus a normalization selector with
      explicit-round grouping and a multi-stage inference fallback
      (respawn-boundary then single synthetic round), across one new selector,
      one new sheet component, and narrow edits to three existing files.
---

# Console Run Detail Review-Cycle Inspector Sheet

## Architecture Context

The console run detail pipeline (`packages/console-ui/src/components/pipeline/`) renders per-plan build stages, per-agent timeline bars, and decision markers. Selection state for hovered stages and the selected agent already lives in `ThreadPipeline`, which renders one right-side `AgentDetailSheet` and (via `DecisionTimeline`) one right-side decision `SheetPanel`. This plan adds a third right-side sheet: a review-cycle inspector opened from the `review-cycle` build-stage pill.

The engine boundary is respected: the inspector renders already-emitted typed events and decisions, it does not move orchestration into the UI.

The dependency foundation (round metadata on review-cycle lifecycle events, and `review-fix` stage mapping) has already landed on this branch and is verified present:
- `packages/client/src/events.schemas.ts` defines `ReviewCycleRoundField = { round: Type.Optional(Type.Integer(...)) }` and spreads it onto `plan:build:review:start/complete`, `plan:build:review:parallel:start`, `plan:build:review:parallel:perspective:start/complete/error`, `plan:build:review:fix:start/complete/continuation`, and `plan:build:evaluate:start/continuation/complete`.
- `BuildDecisionSchema` includes `review-strategy`, `cycle-terminated` (with `round`, `reason`, `issuesRemaining`, and optional final-evaluation counts), `perspectives-respawned` (with `round`), and `evaluator-strictness`.
- `agent-stage-map.ts` maps `review-fixer -> review-fix` and defines `COMPOSITE_STAGES['review-cycle'] = ['review', 'review-fix', 'evaluate']`.

No schema/engine changes are in scope here.

## Implementation

### Overview

Introduce a normalized data model derived from raw stored events, then render it in a new `ReviewCycleDetailSheet`. Make the `review-cycle` build-stage pill a selectable accessible button that opens the sheet for that plan. Coordinate sheet open/close state in `ThreadPipeline` so only one right-side sheet is open at a time.

### Key Decisions

1. Build the sheet from a normalized model (`buildReviewCycleDetail`) rather than filtering raw events in JSX. This keeps the component focused and makes round grouping unit-testable.
2. Read round-specific details from raw `StoredEvent[]`, not from reducer summary maps (`reviewIssuesByPerspective`), because reducer maps overwrite repeated perspectives across rounds.
3. Group by explicit `round` when present on the relevant events. Fall back, in order, to (a) `perspectives-respawned` decision timestamps as round boundaries, then (b) a single synthetic round 0 when neither explicit rounds nor respawn decisions exist. Expose a boolean on the model indicating grouping was inferred so the UI can label uncertain grouping as inferred rather than exact.
4. Only the `review-cycle` pill is selectable in this iteration. The plumbing carries a generic `onStageSelect(stage)` callback, but `ThreadPipeline` only opens the inspector when the selected stage is `review-cycle`; other stages do not open an empty panel.
5. Keep review-cycle sheet open/close state in `ThreadPipeline`. When an agent card inside the sheet is opened, close the review-cycle sheet and set `selectedAgentId` so the existing `AgentDetailSheet` opens. Avoids two competing right-side sheets.
6. Present causal relationships honestly: reviewer issues, fixer activity, and evaluator verdicts are placed in the same round, but the UI does not label a file change as fixing a specific reviewer issue (no issue IDs exist).
7. Reuse `SheetPanel`, matching `AgentDetailSheet` and `DecisionTimeline`.
8. Associate `AgentThread`s with rounds by perspective and start/end timestamps relative to round event windows; when association is inferred, label it as inferred.

### Data model (shape derived in the new selector)

Input: `events: StoredEvent[]` (full run event log), `threads: AgentThread[]` (threads for the plan), `planId: string`, `decisions: DecisionPoint[]` (the plan's decisions).

Output `ReviewCycleDetail`:
- `planId: string`
- `roundsInferred: boolean` — true when grouping fell back to respawn-boundary or single-synthetic inference
- `summary`: `{ terminated?: cycle-terminated decision; reviewStrategy?: review-strategy decision; evaluatorStrictness?: evaluator-strictness decision; finalAccepted?: number; finalRejected?: number }`
- `rounds: ReviewCycleRound[]`, each:
  - `round: number` and `roundLabel: string`
  - `reviewers: Array<{ perspective: string | null; issues: ReviewIssue[]; threadAgentId?: string }>` (single-strategy review has `perspective: null`; parallel perspectives each get an entry from `plan:build:review:parallel:perspective:complete`)
  - `perspectiveErrors: Array<{ perspective: string; error: string }>` (from `plan:build:review:parallel:perspective:error`)
  - `reviewFix`: `{ ran: boolean; issueCount?: number; continuations: Array<{ attempt: number; maxContinuations: number }>; threadAgentId?: string }` (from `plan:build:review:fix:start/continuation/complete` plus the matching review-fixer `AgentThread`)
  - `evaluator`: `{ ran: boolean; accepted?: number; rejected?: number; verdicts: Array<{ file: string; hunk?: number; action: 'accept'|'reject'|'review'; issueOutcome?: string; reason: string; retryGuidance?: string }>; threadAgentId?: string }` (from `plan:build:evaluate:complete`)

## Scope

### In Scope
- Make the `review-cycle` build-stage pill a selectable accessible button that opens a stage-level inspector; preserve existing hover highlight/dim behavior on the pill and timeline bars.
- New `buildReviewCycleDetail` selector that derives `ReviewCycleDetail` from raw stored events, plan decisions, and agent threads, with explicit-round grouping and inferred fallback.
- New `ReviewCycleDetailSheet` rendered via `SheetPanel` with: summary metrics first (final accepted/rejected, termination rationale, review strategy, evaluator strictness), then per-round cards with three lanes (reviewers, review-fixer, evaluator), reviewer issue cards, perspective errors, review-fix continuations, evaluator verdicts, and per-round empty-state text.
- Agent-detail action buttons inside the sheet that close the review-cycle sheet and open the existing `AgentDetailSheet` for the selected agent.
- Support multiple rounds and parallel perspectives; support legacy/partial logs via inferred grouping.
- Selector unit tests and component interaction/rendering tests.

### Out of Scope
- No engine/event schema changes (handled by the landed foundation).
- No stable reviewer issue IDs and no exact issue-to-fix-to-verdict causal mapping.
- No reviewer/review-fixer/evaluator prompt changes.
- No new daemon routes or REST APIs.
- No redesign of the pipeline, timeline, or agent detail sheet.
- No inspectors for non-review-cycle stages beyond the generic `onStageSelect` plumbing.

## Files

### Create
- `packages/console-ui/src/components/pipeline/review-cycle-detail-model.ts` — exports `ReviewCycleDetail`, `ReviewCycleRound` types and `buildReviewCycleDetail(events, threads, planId, decisions)`. Pure, no React/DOM. Groups by explicit `round` when present; otherwise infers rounds from `perspectives-respawned` decision timestamps, otherwise a single synthetic round 0; sets `roundsInferred` accordingly. Reads issues from `plan:build:review:complete` (single) and `plan:build:review:parallel:perspective:complete` (parallel) raw events so repeated perspectives across rounds are not merged. Keep under 600 lines; add durable `// --- eforge:region <slug> ---` markers if it exceeds 300 lines.
- `packages/console-ui/src/components/pipeline/review-cycle-detail-sheet.tsx` — `ReviewCycleDetailSheet` component using `SheetPanel`. Props: `{ detail: ReviewCycleDetail | null; open: boolean; onClose: () => void; onOpenAgent: (agentId: string) => void }`. Renders summary then round cards with the three lanes, issue cards (severity/category/file/line/description/fix), perspective errors, review-fix continuations and file activity (from the matching thread's `activity`), evaluator verdicts (file/hunk/action/issueOutcome/reason/retryGuidance), and explicit per-lane empty-state messages. Keep under 600 lines; add region markers if it exceeds 300 lines.
- `packages/console-ui/src/components/pipeline/__tests__/review-cycle-detail-model.test.ts` — selector unit tests.
- `packages/console-ui/src/components/pipeline/__tests__/review-cycle-detail-sheet.test.tsx` — component tests (Vitest + Testing Library, `// @vitest-environment jsdom`, following `agent-detail-sheet.test.tsx`).

### Modify
- `packages/console-ui/src/components/pipeline/stage-overview.tsx` — extend `StagePill` to optionally render as a real `<button type="button">` when a select handler is provided: add `selectable?`, `onSelect?`, and `ariaLabel?` props; preserve `onMouseEnter`/`onMouseLeave` hover behavior and the existing highlight/dim classes; add visible focus styles. Extend `BuildStageProgress` with optional `onStageSelect?: (stage: string) => void` and `planId?: string`; mark only the `review-cycle` pill (a stage whose name is `review-cycle`) selectable, with `aria-label` naming the plan and stage.
- `packages/console-ui/src/components/pipeline/plan-row.tsx` — add optional `onStageSelect?: (stage: string) => void` to `PlanRowProps` and pass it (plus `planId`) through to `BuildStageProgress`.
- `packages/console-ui/src/components/pipeline/thread-pipeline.tsx` — add `selectedReviewCyclePlanId` state; pass an `onStageSelect` to plan rows that sets it only when `stage === 'review-cycle'`; compute `ReviewCycleDetail` for the selected plan via `buildReviewCycleDetail` (memoized over `events`, plan threads, decisions); render `ReviewCycleDetailSheet`; implement the agent-open handler so opening an agent from the inspector clears `selectedReviewCyclePlanId` and sets `selectedAgentId`.

## Verification

- [ ] Clicking a plan row's `review-cycle` stage pill opens a right-side sheet whose title contains the plan id and the text `review-cycle`.
- [ ] Clicking a non-`review-cycle` stage pill (e.g. `implement`) does not open the review-cycle inspector sheet.
- [ ] The selectable stage pill is a `<button type="button">` with an `aria-label` containing both the plan id and `review-cycle`.
- [ ] Hovering the selectable `review-cycle` pill still calls the stage-hover handler so timeline bars highlight/dim (existing hover behavior unchanged).
- [ ] When a `cycle-terminated` build decision exists for the plan, the sheet renders its termination rationale text.
- [ ] When a `review-strategy` build decision exists for the plan, the sheet renders the review strategy.
- [ ] When an `evaluator-strictness` build decision exists for the plan, the sheet renders the strictness value.
- [ ] When review-cycle events carry differing `round` values, the sheet renders one round section per distinct round.
- [ ] `buildReviewCycleDetail` groups reviewer perspective issues under the matching `round` from `plan:build:review:parallel:perspective:complete` events when `round` is present.
- [ ] `buildReviewCycleDetail` groups evaluator verdicts under the matching `round` from `plan:build:evaluate:complete` events when `round` is present.
- [ ] `buildReviewCycleDetail` groups review-fix lifecycle and `plan:build:review:fix:continuation` events under the matching `round` when `round` is present.
- [ ] `buildReviewCycleDetail` returns `roundsInferred: true` and a non-empty `rounds` array for an event set with no explicit `round` fields (fallback grouping).
- [ ] The sheet renders one reviewer card per parallel perspective, each showing that perspective's issue count.
- [ ] An issue card renders severity, category, file, line (when present), description, and fix (when present).
- [ ] A perspective error renders the perspective key and the error message.
- [ ] Review-fixer file activity from the matching `AgentThread.activity` renders when activity is available.
- [ ] `plan:build:review:fix:continuation` events render as continuation attempts (attempt/maxContinuations).
- [ ] Evaluator accepted and rejected counts from `plan:build:evaluate:complete` render in the evaluator lane.
- [ ] An evaluator verdict renders file, hunk (when present), action, issue outcome (when present), reason, and retry guidance (when present).
- [ ] Clicking an agent-detail action inside the review-cycle sheet sets the review-cycle plan id to null (sheet closes) and sets the selected agent id (AgentDetailSheet opens).
- [ ] A round with no reviewer issues renders an explicit empty-state message in the reviewers lane.
- [ ] A round with no review-fixer activity renders an explicit empty-state message in the review-fixer lane.
- [ ] A round with no evaluator verdicts renders an explicit empty-state message in the evaluator lane.
- [ ] A selector unit test covers a two-round cycle with reviewer issues, fixer activity, evaluator verdicts, and a termination summary, asserting two rounds and correct per-round contents.
- [ ] A selector unit test covers fallback grouping for legacy events lacking `round`, asserting `roundsInferred` is true.
- [ ] A component test covers opening the sheet by clicking the `review-cycle` pill.
- [ ] A component test covers opening an agent detail from inside the review-cycle sheet.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test` exits 0.
