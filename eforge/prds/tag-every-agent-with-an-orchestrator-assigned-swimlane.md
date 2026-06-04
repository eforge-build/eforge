---
title: Tag every agent with an orchestrator-assigned swimlane
created: 2026-06-04
profile: ui
landing: pr
landing_auto_merge: true
---

# Tag every agent with an orchestrator-assigned swimlane

## Problem / Motivation

In the build-flow visualization, after plans build, the PRD lane "lights up again" for final validation (Now dashboard, Image 1) and validation activity renders inside the PRD swim lane in the build detail (Image 2). This is conceptually confusing. The user wants validation agents in their own lane(s) below the plans, the way the dynamic "Gap Close" lane already works.

**Root cause (confirmed by code inspection):** Swimlanes are keyed by `thread.planId` — a plan-specific concept. Plan-less orchestrator-level agents (planning + validation) have NO lane identity, so they fall into the catch-all `thread.planId ?? '__global__'` bucket. That bucket also carries the PRD source pill, which is why validation visually "re-lights PRD". It was never about PRD; uncategorized orchestrator agents have nowhere else to go.

The correct abstraction is **lane ≡ orchestrator phase**, where a plan id is just one kind of lane value. `planId` on agent events is already a de-facto lane key — `gap-closer` runs with `planId: 'gap-close'` (`packages/engine/src/agents/gap-closer.ts:140`) and the UI appends it as a dynamic lane. The mechanism exists; it is under-populated (planning/validation agents never get a lane) and lane identity is scattered across files.

Plan-less orchestrator-level agents (planning and validation) have no swimlane identity, so they collapse into the catch-all `planId ?? '__global__'` bucket. That bucket also hosts the PRD source pill, so post-plan validation activity visually "re-lights" the PRD lane in both the Now dashboard active-build card and the run-detail pipeline. This misrepresents what is happening (validation is not PRD work) and confuses users watching a live build. Affected: anyone monitoring builds via console-ui (the active dashboard).

**Confirmed run order (`orchestrator.ts:266-274`):**
`executePlans → syncDirectPrBaseBeforeValidation → validate → prdValidate → [if gapClosePerformed: validate → prdValidate] → recordArtifact → stackLanding → finalize`

- `validate` (`orchestrator/phases.ts:595`) runs post-merge commands; on failure invokes the `validation-fixer` agent (plan-less).
- `prdValidate` (`phases.ts:734+`) runs the `prd-validator` agent (plan-less); on gaps invokes `gap-closer` (which already carries `planId: 'gap-close'` and sets `ctx.gapClosePerformed = true`).
- Both `validate` and `prdValidate` run a SECOND time only when gap-close happened. `ctx.gapClosePerformed` is false on the first pass, true on the second — so it cleanly discriminates pre- vs post-gap-close validation at agent-start time.

## Goal

Generalize the swimlane model from "lane = plan" to "lane = orchestrator phase", giving planning and validation agents their own first-class lanes (consistent with the existing dynamic Gap Close lane), so that validation activity no longer visually re-lights the PRD lane in the Now dashboard active-build card and the run-detail pipeline.

## Approach

**Target lane model:** Ordered lanes `planning` → `plan-NN` (existing) → `validation` → `gap-close` (conditional) → `final-validation` (conditional). Lanes are activity-gated: a lane only renders when it has agent threads (so no-gap builds show only Planning + plans + Validation). Lane id `final-validation` aligns with the existing `NowBuildLifecyclePhase` value of the same name (`lib/selectors/now.ts`); display label is **"Final Validation"**.

**Agent → lane mapping:**
- pipeline-composer, planner, plan-reviewer, module-planner, dependency-detector → `planning`
- builder/tester/reviewer/doc-author/etc. → `plan-NN` (unchanged)
- validation-fixer + prd-validator, pre-gap-close (`!ctx.gapClosePerformed`) → `validation`
- gap-closer → `gap-close` (unchanged)
- validation-fixer + prd-validator, post-gap-close (`ctx.gapClosePerformed`) → `final-validation`

**Safety verdict (confirmed):** Agent-event `planId` is display-only. `events.schemas.ts:713` types it as a free-form optional string (no enum/pattern). `mutateState`/`transitionPlan` drive plan accounting from dedicated lifecycle events (`plan:status:change`, `merge:worktree:*`), never from agent-event planId. Console-ui, monitor, monitor-ui all consume agent-event planId for display grouping only. So populating synthetic lane ids on planning/validation agent events cannot corrupt plan state, worktrees, or completion accounting.

### Engine (lane assignment)

The harness `run(options, agentRole, planId?)` already passes the 3rd `planId` arg onto every emitted agent event (`harnesses/common.ts:71`, `claude-sdk.ts:212`, `pi.ts:452`). Each agent run-fn must accept an optional `lane` and forward it as that 3rd arg. Pattern mirrors `agents/gap-closer.ts:140`.

- `agents/pipeline-composer.ts:133`, `agents/planner.ts:284`, `agents/plan-reviewer.ts:109`, `agents/module-planner.ts:51`, `agents/dependency-detector.ts:78` — add `lane?: string` to each options interface; pass `'planning'` as the harness.run 3rd arg. Wire `'planning'` at each invocation site (planner/composer/reviewer are invoked from `eforge.ts` / pipeline-composition wiring; dependency-detector at `eforge.ts:567`).
- `agents/validation-fixer.ts:42-51` — add `lane?: string`; pass to `harness.run(..., 'validation-fixer', options.lane)`.
- `validation/prd-validation-wiring.ts:158-185` (`runPrdValidator` invocation) — thread a `lane` through `runPrdValidator` to its harness.run 3rd arg.
- **Pre/post discrimination** at the call sites where `ctx.gapClosePerformed` is in scope:
  - `orchestrator/phases.ts:697` (validationFixer closure call inside `validate`) — pass `ctx.gapClosePerformed ? 'final-validation' : 'validation'`. Extend the `ValidationFixer` closure signature (`eforge.ts:765`, `orchestrator.ts`/`phases.ts` type) to carry the lane.
  - `orchestrator/phases.ts` `prdValidate` (`:722+`, calls `ctx.prdValidator`) — pass the same lane into the `prdValidator` closure; `createPrdValidationWiring` (`eforge.ts:80`) forwards it to `runPrdValidator`.
  - First pass (`orchestrator.ts:268-269`) runs with `gapClosePerformed === false` → `validation`; second pass (`:273-274`, guarded by `ctx.gapClosePerformed`) → `final-validation`. Confirmed correct against `orchestrator.ts:266-274`.

### console-ui (lane registry + consumers)

- **New** `packages/console-ui/src/lib/run-state/lane-registry.ts` (or co-locate in `pipeline-colors.ts`): export an ordered registry `{ id, label, order, kind: 'phase' | 'plan' }` for `planning` (order 0), plans (order 1, `kind: 'plan'`), `validation` (2), `gap-close` (3), `final-validation` (4). Helpers `laneLabel(id)` and `laneOrder(id)` with a plan-id fallback (`plan-NN` → "Plan NN", order 1, sub-sorted by existing plan order).
- `lib/run-state/selectors/plan-progress.ts:192` — replace `LIFECYCLE_LANE_NAMES` with `laneLabel`; `:251` — order extras via `laneOrder` instead of `.sort()`, and **exclude `planning`** from the generic extras so it is not duplicated (it is rendered by the dedicated planning row); `:262-265` `selectPlanningLane` — **re-scope from `!t.planId` to `t.planId === 'planning'`**. This is the coupled change that keeps the Now card's dedicated "PRD planning" block populated (with planning agents only) while validation no longer appears there. Net effect on the Now card: a Planning row (dedicated, PRD-badged), then plan rows, then `validation` / `gap-close` / `final-validation` as generic appended lanes in registry order.
- `components/pipeline/pipeline-colors.ts:63-68` — `abbreviatePlanId` delegates to `laneLabel`; add a color entry for `planning`/`validation`/`final-validation` near `:28`, consistent with the existing `gap-close` styling.
- `components/pipeline/thread-pipeline.tsx:107-121` — `orderedPlanIds` must also include `threadsByPlan.keys()` (excluding `__global__`) so thread-only lanes render, then sort by `laneOrder`. `:222-257` — the global/Compile row: planning agents no longer land in `__global__`, so this row shrinks to truly-uncategorized threads; move the PRD pill onto the `planning` lane (or render a dedicated planning header). Confirm no regression when there are zero global threads.
- Lane label/badge rendering in `components/pipeline/plan-row.tsx` (uses `abbreviatePlanId`/`prdPillClass`) — verify phase lanes (no build-stage sequence) render cleanly, as the Compile row already does.

### Design Decisions

1. **Lane ≡ orchestrator phase; plan id is one lane value.** The core reframing. Generalizes the existing implicit model (gap-close already uses `planId` as a non-plan lane key). Plan-less agents are genuinely orchestrator-level work, not "global" noise — they deserve named lanes.
2. **Reuse the `planId` carrier; do NOT rename to `lane`.** It already carries non-plan lane values (`gap-close`); a wire rename touches every agent event variant + handlers + monitor persistence for marginal clarity. Trade-off: the field name under-describes its role; mitigated by the lane registry making lane identity explicit and a doc note.
3. **Pre/post-gap-close split via `ctx.gapClosePerformed`.** Discriminate `validation` vs `final-validation` at agent-start using the orchestrator flag, not by reconstructing temporal position from event timestamps in the UI. The engine already tracks this authoritatively. Confirmed the flag is false on first validate/prdValidate pass and true on the second.
4. **Single lane registry as source of truth.** One ordered `{id,label,order,kind}` table replaces `LIFECYCLE_LANE_NAMES`, `abbreviatePlanId` special-cases, and alphabetical extras sorting. The alphabetical sort is an active ordering bug (`final-check` would sort before `gap-close`). Centralizing prevents drift and fixes ordering by construction.
5. **Activity-gated lanes (no status entries for phase lanes).** Phase lanes appear only when they have agent threads; do not synthesize `planStatuses` entries for `planning`/`validation`/`final-validation`. Consequence: `thread-pipeline.orderedPlanIds` must include thread-only keys (it currently does not).
6. **Planning keeps a dedicated row; its data source is re-scoped (not removed).** The Now card already has a dedicated PRD-badged planning row (`PrdLaneRow`/`MiniPlanSwimlane`) and the build-detail has the global/Compile row carrying the PRD pill. Both are retained, but their data source changes from "all plan-less threads" to "threads with `planId === 'planning'`". The `planning` lane is rendered by the dedicated row, NOT as a generic appended lane — so it must be excluded from `selectPlanLanes` extras to avoid duplication. The legacy "Source" row (resume case, no global threads) keeps the PRD pill as today. Validation/gap-close/final-validation render as generic appended lanes below the plans. Open sub-choice (cosmetic, non-blocker): keep the planning row's yellow **PRD** badge, or relabel it a plain **"Planning"** lane — leaning toward keeping the PRD badge since the PRD source artifact lives in this phase; builder may pick either.
7. **Stepper untouched.** Leave `active-build-card.tsx` lifecycle stepper as-is. It is a separate event-derived phase indicator, already correct, and not the source of confusion.

### Architecture Impact

Operates within existing boundaries — no new module boundaries or contracts.

- **No wire contract change.** `planId` stays a free-form optional string (`packages/client/src/events.schemas.ts:713`); `DAEMON_API_VERSION` does not bump. Existing recorded event logs remain valid (old events simply have `planId: undefined` for planning/validation agents and continue to render in the global lane — graceful degradation for historical runs).
- **Conceptual model shift only:** agent-event `planId` is formally acknowledged as a lane key. A clarification of existing behavior, not a new interface.
- **Engine emits / consumers render boundary preserved:** the engine only sets an additional field value on events it already emits; the console-ui consumer does the lane layout. No stdout, no new event types.
- New console-ui `lane-registry` module is an internal frontend utility, not a cross-package contract. Lane labels/order are a presentation concern owned by console-ui; the engine only emits opaque lane ids.

### Documentation Impact

- `packages/console-ui/README.md` — if it documents the pipeline/swimlane data flow or lane derivation, add the lane model (lane ≡ phase) and the lane registry as the source of truth for labels/order. Verify whether the route/data-flow table references lane grouping.
- Inline: document on the lane registry module that `planId` on agent events is the lane key (planning/validation/gap-close are phase lanes, not plans), so future readers don't re-derive the overloaded-field surprise.
- No public/API docs, no `docs/` reference artifacts, and no `web/` content expected to change. Confirm `pnpm docs:check` stays green (should be unaffected).
- Do NOT touch CHANGELOG.md (release-managed).

### Risks

- **Planning row vs. existing planning UI (Now card).** `selectPlanningLane` filters `!t.planId` to build the Now card's "PRD planning" row. Once planning agents carry `planId: 'planning'`, they leave that filter and the row would go empty. Decided mitigation (two coupled edits, both required): (1) re-scope `selectPlanningLane` to `t.planId === 'planning'`; (2) exclude `planning` from `selectPlanLanes` extras so it is not also rendered as a generic lane. Residual risk is only visual — must be eyeballed on the Now card.
- **Global/Compile row emptiness.** After the change, the `__global__` bucket may be empty in normal runs. `thread-pipeline.tsx:222-240` only renders the Compile row when `hasGlobalThreads`. Ensure removing planning agents from global doesn't blank the PRD pill region — the pill must move to the Planning lane. Edge case: resume runs with no global threads already use the `Source` row (`:241-257`); keep that path intact.
- **Ordering regression.** Current extras sort is alphabetical (`plan-progress.ts:251`). Registry-based ordering must place `validation` after the last plan and `final-validation` after `gap-close`. Test with and without gap-close present.
- **Historical/in-flight runs.** Events recorded before this change have `planId: undefined` for planning/validation agents and will still render in the global lane. Acceptable graceful degradation; note it so it is not mistaken for a regression.
- **monitor-ui parity drift (legacy).** monitor-ui has a parallel thread-pipeline. If left unchanged it keeps the old behavior; acceptable (legacy) but call it out so the divergence is intentional and recorded.
- **Multiple threads sharing one lane id.** `validation` may hold both validation-fixer and prd-validator across retries; they pack into sub-lanes via existing `packIntoLanes`. Include a multi-thread-per-lane case in tests.
- **Lane assignment plumbing surface.** Threading `lane` through 5+ planning agents plus the two validation closures touches several signatures; risk is a missed call site leaving an agent unlabeled (falls back to global — visible, not silent). The engine wiring test enumerating expected lanes per agent guards this.

### Assumptions And Validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|---|---|---|---|---|---|
| Agent-event `planId` is display-only; nothing structural keys off it | `events.schemas.ts:713` (free-form optional string, no enum); `mutateState`/`transitionPlan` (`state.ts`) drive plan state from `plan:status:change`/`merge:worktree:*`, never agent events; console-ui/monitor/monitor-ui consume it for grouping only; gap-close already uses synthetic `planId` safely | high | low | (done) | Would corrupt plan accounting/worktrees — but ruled out |
| `ctx.gapClosePerformed` is false on first validate/prdValidate and true on second | Read `orchestrator.ts:266-274`: second pass guarded by `if (...gapClosePerformed)`; flag set inside gap-close path (`phases.ts:846`) | high | low | (done) | validation/final-validation lanes swapped or merged |
| harness `run(opts, role, planId?)` forwards the 3rd arg onto all agent events | Confirmed `harnesses/common.ts:71`, `claude-sdk.ts:212`, `pi.ts:452`; gap-closer relies on it | high | low | (done) | Lane ids would not reach the UI |
| `thread-pipeline.orderedPlanIds` currently excludes thread-only lane keys | Read `thread-pipeline.tsx:107-121`: only orchestration.plans + planArtifacts + planStatuses keys | high | low | (done) | Validation lanes would silently vanish from run-detail if not fixed |
| Now card "PRD planning" group sources from `selectPlanningLane` (`!t.planId`) | Read `plan-progress.ts:262-265` | high | low | (done) | Planning summary disappears from Now card unless redirected |
| Lane registry centralization fully replaces `LIFECYCLE_LANE_NAMES` + `abbreviatePlanId` with no other consumers | Grepped both symbols; consumers are plan-progress + pipeline-colors + plan-row | medium | low | grep `LIFECYCLE_LANE_NAMES`/`abbreviatePlanId` again during impl; update all hits | Missed consumer renders raw lane id (visible, not silent) |
| Phase lanes (no build-stage sequence) render cleanly in `plan-row.tsx` | The existing Compile/global row already renders plan-less threads this way | high | low | visual check during impl + run skill | Layout glitch in a phase lane |
| Visual outcome (lanes appear in order, PRD no longer re-lights, planning summary intact) matches intent | Not yet validated — requires running the dashboard against a live/recorded build | medium | medium | Run console-ui dev or `run`/`verify` skill against a real or recorded multi-plan build with gap-close; inspect Now card + run-detail | Functional but wrong-looking; needs a follow-up tweak |

No low-confidence/high-impact assumptions remain unaddressed. The only medium-confidence item (final visual outcome) is inherently runtime/observation-dependent and is gated by an acceptance criterion requiring dashboard verification.

### Profile Signal

**Recommended: Excursion.** Cross-package (engine + console-ui) but cohesive: a single planner session can enumerate every change — the lane-assignment plumbing through ~7 engine call sites, the new lane registry, and the two console-ui consumers — plus their dependencies. One shared conceptual change (lane ≡ phase) applied consistently; no subsystem needs independent module planning. The pre/post-gap-close split is a sequential dependency, not parallel module work. Not Expedition: no delegated module planning or subplan cohesion review is needed. Not Errand: more than a mechanical one-file fix; it touches multiple agents, adds tests, and has a visual-verification follow-up.

### Key Evidence Sources

- `packages/engine/src/orchestrator.ts:266-280` — phase sequence
- `packages/engine/src/orchestrator/phases.ts:595` (validate), `:697` (validationFixer invocation), `:734+` (prdValidate)
- `packages/engine/src/eforge.ts:765-791` (validationFixer closure), `agents/validation-fixer.ts`, `validation/prd-validation-wiring.ts:158-180` (prd-validator), `agents/gap-closer.ts:140`
- `packages/engine/src/harnesses/common.ts:71`, `claude-sdk.ts:212`, `pi.ts:452` — harness passes `planId` param onto events
- `packages/console-ui/src/lib/run-state/selectors/plan-progress.ts:192` (LIFECYCLE_LANE_NAMES), `:208-256` (selectPlanLanes extras), `:262-265` (selectPlanningLane filters `!t.planId`)
- `packages/console-ui/src/components/pipeline/thread-pipeline.tsx:81-93` (threadsByPlan), `:107-121` (orderedPlanIds — does NOT include thread-only lane keys), `:222-257` (global/Compile row carries PRD pill)
- `packages/console-ui/src/components/pipeline/pipeline-colors.ts:63-68` (abbreviatePlanId), `:28` (gap-closer color)
- `packages/console-ui/src/components/now/active-build-card.tsx:36-84` (stepper, unaffected — separate event-derived derivation)

## Scope

### In scope

1. **Engine: assign a lane to every plan-less agent.** Populate the existing `planId` carrier on agent events for: planning agents (pipeline-composer, planner, plan-reviewer, module-planner, dependency-detector) → `planning`; prd-validator + validation-fixer pre-gap-close → `validation`; prd-validator + validation-fixer post-gap-close → `final-validation`; gap-closer already → `gap-close` (no change). Discriminate pre/post via `ctx.gapClosePerformed` at the validate/prdValidate call sites.
2. **console-ui: a single lane registry** (id → label, order, kind) as the source of truth for lane label + ordering, replacing the scattered `LIFECYCLE_LANE_NAMES` map and `abbreviatePlanId` special-cases.
3. **console-ui: consume the registry** in both lane consumers — `selectPlanLanes` (Now dashboard mini-swimlane) order extras by registry, not alphabetically; `thread-pipeline` `orderedPlanIds` (run-detail pipeline) include thread-only lane keys (currently dropped) and order by registry.
4. **console-ui: the Planning lane replaces the global/Compile bucket.** Planning agents render in a named "Planning" lane; the PRD source pill moves onto that lane (or its own header slot) instead of a nameless global row.
5. Friendly labels + a lane color for `planning`, `validation`, `final-validation` consistent with the existing `gap-close` styling.

### Out of scope (non-goals)

- The Now dashboard lifecycle **stepper** (PRD / Plans / PRD check / Gap close / Final check / Land in `active-build-card.tsx`). Derived independently from lifecycle events, already distinguishes these phases, and is not the source of the confusion. No changes.
- Renaming the wire field `planId` → `lane`. The field already functions as a lane key (gap-close precedent); a rename touches every agent event variant + handlers for marginal gain. Treat `planId` as the lane carrier; defer any rename.
- Changing validation/gap-close **engine behavior, ordering, or retry logic**. Display-only change.
- `packages/monitor-ui/` (legacy). Optional parity only; console-ui is the active dashboard per CLAUDE.md. Apply the same change if low-cost, otherwise leave a follow-up note.

### Boundary

Frontend/visualization plus a thin engine wire-population change. No daemon API/route changes, no schema changes (planId is already a free-form optional string).

## Acceptance Criteria

- `pnpm type-check` exits 0.
- `pnpm build` completes without errors.
- `pnpm test` exits 0.
- `pnpm maintainability:check` exits 0.
- An engine test asserts the `agent:start` events for pipeline-composer, planner, and plan-reviewer carry `planId: 'planning'`.
- An engine test asserts the prd-validator and validation-fixer `agent:start` events carry `planId: 'validation'` when `gapClosePerformed` is false at invocation.
- An engine test asserts the prd-validator and validation-fixer `agent:start` events carry `planId: 'final-validation'` when `gapClosePerformed` is true at invocation.
- The gap-closer `agent:start` event still carries `planId: 'gap-close'`.
- A console-ui test asserts `selectPlanLanes` returns lanes ordered plans, then validation, then gap-close, then final-validation, when threads for all those lane kinds are present.
- A console-ui test asserts `selectPlanLanes` omits the gap-close and final-validation lanes when no threads carry those lane ids.
- A console-ui test asserts the run-detail pipeline's ordered lane ids include a `validation` lane key when only validation threads (no planStatus entry) exist for it.
- A console-ui test asserts no planning or validation thread is grouped under the `__global__` / PRD bucket once lane ids are assigned.
- The lane label for `planning` resolves to "Planning" via the single lane registry.
- The lane label for `validation` resolves to "Validation" via the single lane registry.
- The lane label for `gap-close` resolves to "Gap Close" via the single lane registry.
- The lane label for `final-validation` resolves to "Final Validation" via the single lane registry.
- `grep` for `LIFECYCLE_LANE_NAMES` in `packages/console-ui/src` returns zero matches.
- A console-ui test asserts the PRD source pill renders on the planning lane (or a planning header) and that the global/Compile row is not the pill host when planning threads exist.
- A console-ui test asserts `selectPlanningLane` includes the planning agents (planId `'planning'`) and excludes validation-fixer/prd-validator threads (planId `'validation'`/`'final-validation'`).
- A console-ui test asserts `selectPlanLanes` does NOT emit a `planning` lane.
- A console-ui test asserts `selectPlanLanes` DOES emit `validation`, `gap-close`, and `final-validation` lanes when their threads exist.
- The console-ui dashboard is run against a real or recorded multi-plan build with gap-close, and the Now card shows the planning row populated with planning agents only, validation rendered as its own lane, no duplicate Planning row, and the PRD lane not re-lighting during validation.