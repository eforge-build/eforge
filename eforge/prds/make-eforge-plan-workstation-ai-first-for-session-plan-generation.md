---
title: Make eforge-plan workstation AI-first for session-plan generation
created: 2026-06-08
profile: gpt-claude-combo
landing: pr
landing_auto_merge: true
---

# Make eforge-plan workstation AI-first for session-plan generation

## Problem / Motivation

Dogfooding after PR #174 started daemon task `task-a895a5a0-58b6-49b5-80a5-dcccc82b4d15`, which failed because the planning-draft agent did not call `submit_eforge_plan_planning_result`; no durable in-workstation recovery path produced a usable plan. Evidence was gathered from `.backlog/items/backlog-2026-06-07-make-eforge-plan-workstation-ai-first-for-session-plan-gener.md`.

`docs/roadmap.md` places rich planning workflow UX in extension-owned Console workstations while preserving daemon/client session-plan compatibility plumbing and keeping host integrations thin. This change belongs in the `eforge-plan` extension/workstation plus typed daemon/client task contracts, not in the build-engine kernel.

The eforge-plan workstation currently has two competing backlog-to-session-plan paths: a deterministic selected-item promotion path and a newer Plan with AI task path. The deterministic path still reliably creates a session plan, while Plan with AI can fail without giving the user a durable, recoverable workstation flow.

Confirmed failure evidence: `.eforge/storage/agent-tasks/task-a895a5a0-58b6-49b5-80a5-dcccc82b4d15.json` records a failed `eforge-plan.planning-draft` task with `errorMessage: "eforge-plan planning draft task did not call submit_eforge_plan_planning_result."` The backlog item records that this dogfooding attempt produced no visible durable progress/failure monitoring and no plan appeared.

Confirmed UI gap: `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/plan-with-ai-panel.tsx` stores the current task only in React state and only polls while the component is mounted. Reloading or navigating away loses the workstation's handle to the task unless the user manually preserved the task id.

Confirmed product gap: `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog-view.tsx` still presents `Promote as one plan` as the selected-items call to action, while the separate Plan with AI panel asks for a prompt/goal and can only apply recommendations, handoff drafts via deterministic promotion, or patches to an already-entered session id. There is no single selected-ready-items promotion control that starts AI session-plan creation directly.

Current implementation facts:

- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/plan-with-ai-panel.tsx` owns the visible Plan with AI panel. It stores the active `task` only in React component state, includes a free-form prompt/goal input whose purpose is unclear for backlog promotion, polls only while the component instance is mounted, shows failed status text, and has no retry button or durable task history after reload/navigation.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog-view.tsx` still renders a sticky selected-items action labeled `Promote as one plan`, backed by the deterministic `promote-selection` action, as the only selected-item session-plan creation control outside the AI panel. The desired single control is a selected-items **Promote to a build plan** action that starts AI session-plan creation without requiring a prompt input.
- `eforge/extensions/eforge-plan/agent-task-actions.ts` exposes `start-planning-agent-task`, `get-planning-agent-task`, `cancel-planning-agent-task`, and `apply-planning-agent-task-result`; task records are daemon-owned and persisted by `packages/monitor/src/routes/extensions/agent-task-store.ts` under `.eforge/storage/agent-tasks/<taskId>.json`.
- The failed dogfooding task record exists at `.eforge/storage/agent-tasks/task-a895a5a0-58b6-49b5-80a5-dcccc82b4d15.json` with `status: failed` and the sanitized error message, proving daemon persistence exists but the workstation lacks durable discovery/monitoring UX.
- `eforge/extensions/eforge-plan/planner-orchestration.ts` can apply completed task recommendations, handoff drafts, and session-plan section patches. Applying handoff drafts currently delegates to `promoteBacklogSelection`, so AI output can suggest a deterministic promotion selection but does not provide an explicit AI-authored create-session-plan flow.
- `eforge/extensions/eforge-plan/session-plan-actions.ts` already registers `create-session-plan`, `set-session-plan-section`, `select-session-plan-dimensions`, `check-session-plan-readiness`, and `set-session-plan-ready`, which are sufficient building blocks for an explicit apply/create-session-plan flow if AI output includes a session draft target and section content.
- `packages/client/src/extension-agent-tasks.ts` and `packages/engine/src/prompts/eforge-plan-planning-draft.md` define the current structured planning task schema and prompt. The schema supports `sessionPlanPatch` for existing sessions but not a full session-plan creation draft with topic/type/depth/profile/sections.
- Existing tests cover the foundation: `eforge/extensions/eforge-plan/__tests__/planner-agent-task-actions.test.ts`, `test/eforge-plan-agent-task-actions.test.ts`, `packages/monitor/src/__tests__/routes-extension-agent-tasks.test.ts`, and `test/eforge-plan-workstation.test.ts`.

Classification: this is a **feature / deep** change. It is user-facing and should add reliable AI-first session-plan creation behavior. Depth is deep because it crosses the workstation UI, extension actions, task result schema, task persistence/indexing, generated assets, docs, and tests, and because the current failure mode prevents the primary workflow from succeeding.

The affected user is the operator using Console as the planning workstation. The current behavior undermines the roadmap direction that planning workflow UX should live in extension-owned workstations and makes dogfooding AI-first planning unreliable.

## Goal

Make the Backlog tab AI-first for session-plan generation by replacing competing deterministic and prompt-driven paths with one selected-items **Promote to a build plan** action that starts AI session-plan creation from selected ready backlog items.

The workstation should provide durable task discovery, live progress, failure recovery, bounded clarification/re-draft, and explicit preview/apply of AI-authored session-plan creation drafts without expanding the build-engine kernel or auto-enqueueing builds.

## Approach

### High-level implementation

- Replace the confusing Plan with AI prompt box plus deterministic promotion split with one selected-items action labeled **Promote to a build plan**.
- Enable the promotion action when at least one ready backlog item is selected and derive the AI planning goal/context from the selected backlog items rather than requiring a free-form prompt input.
- Add durable workstation task monitoring so running, completed, failed, and cancelled planning tasks are discoverable after refresh/navigation.
- Show live planning-agent progress by planning section/dimension, including covered sections and sections remaining, while the AI promotion task is running.
- Persist or index eforge-plan planning task references outside React component state while keeping daemon task records authoritative for status/result/error data.
- Show visible failed-task recovery actions, including retry with the same selected backlog context and derived planning request when enough request context is available.
- Extend the eforge-plan planning task result contract to support AI-authored session-plan creation drafts, not only patches to an existing session plan.
- Add a bounded planning decision result: AI output can be `ready` with session-plan creation content or `needs-input` with structured clarification questions and rationale.
- Let the user answer clarification questions or provide steering, then start a follow-up re-draft task that includes the previous task result plus the user's answers/steering as context.
- Add an explicit preview/apply flow that creates a new session plan from selected AI output via existing `create-session-plan`, `set-session-plan-section`, `select-session-plan-dimensions`, metadata, and readiness actions.
- Keep application explicit: generated AI output must remain read-only until the user previews and confirms the pieces to apply.
- Remove the deterministic implementation behind the backlog-item(s)-to-session-plan workstation path; the retained selected-items promotion control must start AI-driven generation instead of invoking deterministic promotion.
- Keep the lower-level `promote-selection` action contract only for compatibility with existing integrations/deep links unless a separate deprecation/removal plan is created; it must not remain a user-facing workstation planning path.
- Update the built workstation bundle under `eforge/extensions/eforge-plan/workstation-assets/plans` after changing `workstation-src/plans`.
- Update first-party eforge-plan documentation and mock workstation fixtures to describe the AI-first flow.

### Design decisions

1. Make **Promote to a build plan** the only workstation selected-backlog session-plan generation control.
   - Decision: selected ready backlog items in the workstation should expose one clear action: **Promote to a build plan**. That action starts AI-driven session-plan generation using selected item context. The separate prompt-input Plan with AI start box should be removed or reduced to task monitoring/results only. Deterministic `promote-selection` must not power the Backlog-tab planning UI.
   - Rationale: the user likes the selected-items promotion affordance but wants it to use AI generation. Two controls (`Plan with AI` and `Promote as one plan`) are confusing, and a prompt input is unnecessary when the selected backlog items already define the planning context.

2. Keep daemon task records authoritative and add eforge-plan-owned task workflow indexing.
   - Decision: use persisted daemon task records for status, result, cancellation, and error truth; add an eforge-plan task index or equivalent extension-owned metadata that remembers task ids, original request context, selected item ids/recommendation ref, derived planning request, and timestamps for workstation discovery and retry.
   - Rationale: daemon persistence already exists and the failed task record proves it survives failure. The current UX gap is discoverability and recovery after the React component is gone. A product-specific task index avoids widening daemon APIs unless owner-scoped task listing becomes necessary.

3. Retry should reuse preserved request context rather than asking the user to reconstruct it.
   - Decision: failed task cards should offer a retry action when the workstation has enough indexed context to re-run the same `start-planning-agent-task` input. If context is incomplete, the UI should show the missing input and let the user reselect backlog items rather than type a generic prompt.
   - Rationale: the dogfooding failure was actionable but not recoverable from the workstation. Retrying from preserved context makes failures visible and cheap to recover.

4. Add a first-class AI planning decision and session-plan creation draft shape.
   - Decision: extend the planning result model with a decision discriminant. `ready` results include a creation-oriented draft containing at least `session`, `topic`, `planningType`, `planningDepth`, optional `profile`/`agentProfile`, sections, optional skipped dimensions, and open questions. `needs-input` results include structured clarification questions, rationale, and optional suggested steering.
   - Rationale: `sessionPlanPatch` is useful for existing sessions but forces the user to pre-enter a session id. AI-first backlog planning should be able to either generate a new session plan explicitly from selected backlog evidence or honestly ask for missing information before pretending a plan is ready.

5. Model clarification as bounded stateless re-drafting, not daemon chat.
   - Decision: when a task result is `needs-input`, the workstation collects user answers or steering and starts a new planning-draft task whose bounded source context includes the original request, previous task summary/questions, and user-provided answers. The eforge-plan task index links the task chain for UX continuity; the daemon does not own a chat transcript.
   - Rationale: this gives the user decision-making and steering without expanding the scope into multi-turn chat infrastructure.

6. Apply creation drafts by composing existing safe session-plan actions.
   - Decision: applying an AI session-plan creation draft should call or reuse the same adapter-backed logic as `create-session-plan`, `select-session-plan-dimensions`, `set-session-plan-section`, `update-session-plan-metadata`, and readiness checks. It must not write raw Markdown directly from arbitrary AI output.
   - Rationale: `session-plan-actions.ts` already centralizes path containment, format compatibility, dimension selection, and readiness validation. Reusing it reduces schema drift and keeps AI output constrained.

7. Surface live section-level progress without exposing raw agent output.
   - Decision: planning tasks should report bounded progress for the sections/dimensions they intend to cover, including current section, covered sections, and remaining sections. The workstation renders this as progress while the task is running. Prefer a structured progress-reporting custom tool and sanitized task metadata/events over parsing agent prose.
   - Rationale: the user wants workstation progress similar to the section-by-section feel of `/eforge:plan`/Pi skill flows. Structured progress keeps the daemon-owned task observable without adding mutation capability or relying on raw transcript parsing.

8. Preserve preview-before-apply semantics.
   - Decision: the workstation should preview generated recommendations, handoff drafts, session-plan patches, and session-plan creation drafts and require explicit confirmation for each applied category.
   - Rationale: existing `PlanWithAiPanel` already follows preview/apply for recommendations and patches. Session-plan creation should keep that safety model rather than turning AI generation into automatic mutation.

9. Treat prompt/tool non-submission as a visible task failure plus prompt/schema hardening issue.
   - Decision: keep the daemon failure behavior fail-closed, but improve the prompt/submission guidance and tests so a stub/noncompliant harness failure is visible in the workstation and a compliant harness returns a parseable draft.
   - Rationale: the daemon correctly persisted the failed state; the missing behavior was UI recovery and a reliable one-shot prompt contract.

10. Keep generated output non-queueing.
   - Decision: applying AI output may create or update session plans and recommendations, but it must not call enqueue or mark a session `submitted`.
   - Rationale: the existing workstation handoff flow intentionally returns source-path commands and preserves explicit user handoff/build boundaries.

### Architecture impact

This change operates within existing extension-owned workstation and daemon-owned agent task boundaries.

No build-engine kernel expansion is required. The engine remains responsible for the structured planning-draft prompt and read-only harness invocation; the eforge-plan extension remains responsible for product-specific planning state and applying generated output; the daemon remains responsible for authoritative task records.

Potential shared contract impact:

- If a full AI session-plan creation draft is persisted as part of `ExtensionAgentTaskRecord.result`, `packages/client/src/extension-agent-tasks.ts` must own that schema and exported type. The monitor store validates projected task records with `parseExtensionAgentTaskRecord`, so incompatible local-only additions will fail unless added to the client schema.
- If task monitoring is implemented entirely as eforge-plan-owned task index metadata, no daemon route expansion is required. The index stores task ids and request context; status/result still comes from `ctx.agentTasks.get(taskId)`.
- If a daemon list route is added instead, route constants, request/response schemas, typed helpers, monitor routes, and owner-scoped access checks must all live in the shared client/monitor agent-task API rather than raw workstation code.

Data flow after the change:

1. User selects backlog items or accepts a recommendation in the Backlog tab.
2. Workstation enables a single **Promote to a build plan** action for selected ready backlog items and calls `start-planning-agent-task` with derived selected-item context and requested output sections that include a session-plan creation draft.
3. The eforge-plan action prepares bounded planner context, starts the daemon-owned task, and records task workflow metadata in extension-owned storage.
4. The workstation loads indexed tasks on refresh, polls current running tasks, and displays completed/failed/cancelled task cards.
5. While a task runs, the agent reports bounded section-level progress; the daemon sanitizes/persists it; the workstation shows covered sections and remaining sections.
6. If the task result is `needs-input`, the workstation renders structured questions, collects user answers or steering, and starts a linked re-draft task with that added context.
7. If the task result is `ready`, the user previews a generated session-plan creation draft and confirms apply.
8. The extension creates the session plan through adapter-backed session-plan actions, writes selected sections/metadata, checks readiness, refreshes the Plans tab data, and leaves enqueue/handoff as an explicit later step.

Boundary constraints to preserve:

- Workstation iframe code uses `window.eforge.invokeAction` and registered allowed actions only.
- No private Console imports, parent React imports, or raw extension-owned HTTP routes are introduced.
- AI output is parsed against typed schemas and mapped to safe mutations; it is never treated as arbitrary Markdown to write to project paths.
- Deterministic promotion may remain as an action-level compatibility path for existing integrations, but it is not a workstation backlog-to-plan path.

### Code impact

Primary targets verified by code search and file reads:

- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/plan-with-ai-panel.tsx`: remove or refactor the prompt-input Plan with AI box into a task monitor/result panel that has no required free-form prompt input; render durable task list/current task state; display live section/dimension progress with covered and remaining sections; add retry for failed tasks; render `ready` versus `needs-input` task decisions; collect clarification answers/steering for bounded re-draft tasks; preview AI session-plan creation drafts; and apply selected drafts through explicit confirmation.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog-view.tsx`: keep a single selected-items promotion control, labeled **Promote to a build plan**, and wire it to AI-driven session-plan generation. Do not expose a separate Plan with AI start button or any selected-item deterministic promotion button.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts`: add frontend types for task index/list responses, AI task decision states, clarification questions, section-level planning progress, and AI session-plan creation drafts.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/fixtures/mock-data.ts` and `eforge/extensions/eforge-plan/workstation-src/plans/src/bridge.ts`: update mock AI promotion behavior to include failed/retry states, `needs-input` clarification states, re-draft behavior, and AI session-plan creation draft application for local UI development.
- `eforge/extensions/eforge-plan/agent-task-actions.ts`: store or update eforge-plan task references when starting tasks from selected ready backlog items and expose list/forget/retry-related action behavior if implemented at the extension-action layer.
- `eforge/extensions/eforge-plan/planner-orchestration.ts`: validate and apply selected AI session-plan creation drafts by composing existing session-plan adapter operations, without calling deterministic `promoteBacklogSelection`, enqueueing builds, or shipping backlog items.
- `eforge/extensions/eforge-plan/schema.ts`: extend TypeBox schemas for task index/list outputs, re-draft inputs, apply selections, planning decision states, clarification questions, section-level planning progress projections, and AI session-plan creation drafts. Keep schemas JSON-safe and additionalProperties discipline consistent with existing action contracts.
- `eforge/extensions/eforge-plan/planner-actions.ts` and `eforge/extensions/eforge-plan/index.ts`: register new task monitoring/application actions and add them to workstation `allowedActions`.
- `packages/client/src/extension-agent-tasks.ts`: extend the shared planning-draft result schema if the AI session-plan creation draft becomes a daemon/client wire contract rather than extension-local projection. Extend task metadata or progress-event schemas with a bounded section-progress shape if live section progress is persisted or broadcast. This file owns event/task result wire shapes, so do not duplicate incompatible frontend-only result shapes.
- `packages/engine/src/prompts/eforge-plan-planning-draft.md`: teach the planning-draft prompt to produce full session-plan creation drafts when requested, reinforce that the submit tool must be called exactly once, and instruct the agent to report progress as it begins/completes planned sections.
- `packages/engine/src/agents/extension-planning-task.ts`: update the structured submission tool schema if shared client schemas gain a new session-plan creation draft section; add a bounded progress-reporting custom tool if live section progress cannot be derived from existing harness events.
- `packages/monitor/src/routes/extensions/agent-task-store.ts` and `packages/monitor/src/routes/extensions/agent-task-service.ts`: current daemon task records are persisted and gettable by task id, but no list API was found. Prefer an eforge-plan-owned task index for product workflow state unless implementation proves a daemon owner-scoped task-list route is needed. Persist/update sanitized section progress on running task records when progress reports arrive.
- `packages/monitor/src/routes/extensions/agent-task-events.ts`: extend sanitized metadata/progress emission if needed so section-level progress is visible through task records and daemon timeline events without exposing raw agent output.
- `eforge/extensions/eforge-plan/README.md`: document the **Promote to a build plan** AI-first flow, durable task monitoring, retry, explicit apply/create-session-plan behavior, absence of a prompt-input Plan with AI box, and removal of the deterministic workstation backlog-to-plan implementation.
- `web/content/docs/extensions.md` and any generated docs touched by extension agent task schemas: update only if shared daemon/client task result semantics change.
- `eforge/extensions/eforge-plan/workstation-assets/plans/index.js`, `index.html`, and `style.css`: regenerate with `pnpm build:eforge-plan-workstation` after frontend changes.

Test targets:

- Add or update extension action tests near `eforge/extensions/eforge-plan/__tests__/planner-agent-task-actions.test.ts` for task indexing/listing, retry payload preservation, and AI session-plan creation draft application.
- Add or update root tests near `test/eforge-plan-agent-task-actions.test.ts` for schema/application edge cases.
- Add or update workstation tests for registration/allowed actions and static asset expectations if action registration changes.
- Run targeted workstation package type-check/build plus root `pnpm type-check`, `pnpm test`, and `pnpm maintainability:check` before handoff completion.

### Documentation impact

Documentation to update:

- `eforge/extensions/eforge-plan/README.md`: revise usage/action examples for **Promote to a build plan**, task monitoring, live section-level progress, retry, `ready`/`needs-input` decisions, clarification answer re-drafting, AI session-plan creation draft preview, explicit apply/create-session-plan behavior, absence of a prompt-input Plan with AI box, and removal of deterministic backlog-to-plan promotion from the workstation workflow.
- `eforge/extensions/eforge-plan/README.md` Planning workstation boundary section: update the current MVP description that says the workstation can start/poll/cancel/preview one planning task so it reflects durable task monitoring and AI-first session-plan creation.
- `docs/extensions.md` and generated web content only if the shared extension agent task result schema or daemon task routes gain a new public contract. If the change stays extension-local with existing task start/get/cancel, note that no broad extension platform capability was added.
- `packages/client/README.md` only if new client route helpers or exported schemas are added for task listing or session-plan creation drafts.
- Local development docs in `eforge/extensions/eforge-plan/README.md` should continue to mention `pnpm dev:eforge-plan-workstation`, `pnpm dev:eforge-plan-workstation:daemon`, and `pnpm build:eforge-plan-workstation` after fixture behavior changes.

No public CLI or Pi skill documentation needs to change unless the extension action contribution surface gains new integration commands or the user-facing `/eforge:plan` behavior is changed, which is out of scope.

### Risks

- Schema drift risk: task results are persisted and validated through `packages/client/src/extension-agent-tasks.ts`; adding a draft shape only in extension/frontend code can cause daemon completion records to fail validation. Mitigation: put persisted task result shapes in the client schema and test round trips.
- UX availability risk: removing deterministic promotion from the workstation can strand users if AI planning is unavailable or disabled. Mitigation: keep failures visible/retryable, keep lower-level compatibility actions/integration commands available outside the workstation, and make AI session-plan creation reliable before removing the UI path.
- Duplicate plan creation risk: retrying or re-applying a completed AI task can create duplicate session ids or overwrite user edits. Mitigation: preview target session id, validate uniqueness before apply, surface conflicts, and make repeated apply idempotent or explicitly blocked.
- Hidden stale task risk: an extension-owned task index can reference daemon task records that were manually deleted or belong to an old daemon state. Mitigation: task list action should show missing records as stale/unavailable and allow clearing them.
- Prompt reliability risk: the observed failure proves the agent may still fail to call the submit tool. Mitigation: keep failure visible/retryable and strengthen prompt/schema tests, but do not make apply paths depend on parsing prose.
- Progress-reporting noise risk: an agent may over-report, skip sections, or report sections it later changes. Mitigation: treat live section progress as best-effort task telemetry, keep final readiness based on the submitted structured result and session-plan readiness checks, and sanitize/persist only bounded section names/statuses.
- Large-context risk: planning selected epics/open backlog can exceed useful task context. Mitigation: keep current bounded context behavior in `agent-task-actions.ts` and clearly show truncated/selected context in task metadata or preview when practical.
- Clarification-loop scope creep risk: `needs-input` could turn into full chat if each answer mutates daemon conversation state. Mitigation: keep re-drafting as explicit new daemon tasks linked by eforge-plan workflow metadata, with bounded previous-result and user-answer context.
- Partial-application risk: applying recommendations but failing session-plan creation could leave user-visible state inconsistent. Mitigation: validate all selected apply targets before writing where possible, matching the existing `validatePlanningAgentTaskApplyTargets` pattern.
- Generated asset drift risk: source UI changes under `workstation-src/plans` will not affect production Console unless `workstation-assets/plans` is rebuilt. Mitigation: include asset build and tests in acceptance criteria.
- Manual visual QA temptation: UI behavior should be covered with component/action tests and fixture state where possible; manual browser inspection can be informational but should not be the only hard gate.

### Assumptions and validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| Daemon task records are already persisted after failure and can be read by task id. | Read `.eforge/storage/agent-tasks/task-a895a5a0-58b6-49b5-80a5-dcccc82b4d15.json`; read `packages/monitor/src/routes/extensions/agent-task-store.ts`, which writes records under `.eforge/storage/agent-tasks/<taskId>.json`; read `agent-task-service.ts`, which exposes `get(taskId)`. | high | low | Add an action test that starts/indexes a task, reloads the workstation data model, and fetches status by task id. | Without durable daemon records, workstation recovery would need a daemon storage feature first. |
| The workstation currently loses active task monitoring on reload/navigation. | Read `plan-with-ai-panel.tsx`; task state is held in `React.useState`, and polling depends on the mounted component's `task` value. No local storage, task index, or list action was found in the files read. | high | low | Add a component/model test that simulates remount and confirms indexed tasks reload. | If monitoring is already durable elsewhere, this plan may duplicate work; no evidence of that was found. |
| A full AI session-plan creation draft requires a shared task result schema change if it is stored in task records. | Read `packages/client/src/extension-agent-tasks.ts`; `ExtensionAgentTaskRecordSchema` validates `result` against `EforgePlanPlanningDraftResultSchema`, which currently supports `sessionPlanPatch` but not a full create-session-plan draft. | high | low | Add client schema tests for completed task records containing the new draft shape. | If skipped, completed tasks with new output may fail schema validation and be recorded as failures. |
| Existing session-plan actions are sufficient to safely apply AI-created session plans without raw Markdown writes. | Read `session-plan-actions.ts`; it exposes adapter-backed create, set-section, select-dimensions, metadata update, readiness, ready, and handoff actions. | high | low | Implement the apply helper using these adapter-backed operations and test generated files/readiness. | If insufficient, additional adapter APIs may be needed before AI-created plans can be safe. |
| Deterministic `promote-selection` should be removed from the workstation workflow but not necessarily deleted as an action API in this change. | Read `README.md` and `index.ts`; promotion actions are documented and registered as integration commands/deep links. User clarified the deterministic backlog-item(s)-to-plan path should be removed from the plan. | high | low | Remove Backlog-tab controls and AI apply flows that call deterministic promotion; search external docs/tests before deleting action registration itself. | Leaving the UI path in place would preserve the old primary workflow; deleting the action API outright could break existing host integrations and tests. |
| A product-owned task index is preferable to adding a daemon list route for this slice. | Validated that daemon storage/get exists but no list function was found in `agent-task-store.ts` or `agent-task-service.ts`. The required UX needs selection/user-goal retry context, which is product-specific and not present in daemon records. | medium | medium | During implementation, prototype eforge-plan task index; switch to owner-scoped daemon list only if extension-owned indexing cannot handle reload discovery cleanly. | If wrong, implementation may need additional client/monitor route work. |
| A selected-items **Promote to a build plan** AI workflow can replace the prompt-input Plan with AI box while preserving safe explicit apply semantics. | Existing `PlanWithAiPanel` already previews generated output and requires confirmation before applying recommendations/handoff/session-plan patches; selected item context is already available in `backlog-view.tsx`. | high | low | Extend tests to ensure selected ready items can start AI creation without a prompt input and create-session-plan drafts require confirmation and do not enqueue builds. | If wrong, AI-first UX could accidentally mutate too much state or remain confusing. |
| A `needs-input` decision can be supported without implementing full multi-turn chat. | The existing task model is single-shot and already accepts bounded `sourceText`; eforge-plan-owned task workflow metadata can link task ids and preserve prior request context. This is inferred from current task start/indexing design rather than an existing implementation. | medium | low | Implement re-draft as a new `start-planning-agent-task` call with prior task summary/questions and user answers included in bounded source context; test that no daemon transcript API is introduced. | If wrong, clarification support should be split into a follow-on chat/session feature rather than blocking AI-first creation. |
| Live section-level progress requires structured task telemetry rather than final-result-only polling. | Read `packages/monitor/src/routes/extensions/agent-task-service.ts`; it currently updates only a generic `progressMessage` when the planner starts running. Read `agent-task-events.ts`; progress events carry a sanitized message and metadata. | medium | low | Add a structured progress-reporting custom tool or equivalent typed progress callback; test that running task records expose current, covered, and remaining sections. | If wrong, the workstation can still show coarse running/completed status, but it will not meet the requested section-by-section visibility. |
| The current task prompt non-submission failure can be mitigated but not eliminated solely by UI work. | Read failed task record and `packages/engine/src/prompts/eforge-plan-planning-draft.md`; prompt already says the submit tool is mandatory, yet dogfooding failed. | high | medium | Add/adjust harness tests for compliant submission and non-submission failure; consider prompt wording and max-turn behavior in implementation. | If ignored, AI promotion may remain unreliable even with better monitoring. |

No low-confidence/high-impact assumption remains unresolved. The medium-confidence task-index and clarification-loop design choices are explicitly bounded: use eforge-plan-owned indexing and stateless re-draft tasks first, and escalate to a daemon list route or full chat/session feature only if implementation evidence shows it is necessary.

### Profile signal

Recommended profile: **Excursion**.

Rationale: this is cross-cutting and user-facing, but the work is cohesive: one planner can cover the workstation UI, eforge-plan actions/schemas, shared task result schema, prompt adjustment, docs, and tests without needing delegated module planners. Expedition is not warranted unless implementation discovers that durable task monitoring requires a broader daemon task-list architecture or worker isolation redesign.

## Scope

In scope:

- Replace the confusing Plan with AI prompt box plus deterministic promotion split with one selected-items action labeled **Promote to a build plan**.
- Enable the promotion action when at least one ready backlog item is selected and derive the AI planning goal/context from the selected backlog items rather than requiring a free-form prompt input.
- Add durable workstation task monitoring so running, completed, failed, and cancelled planning tasks are discoverable after refresh/navigation.
- Show live planning-agent progress by planning section/dimension, including covered sections and sections remaining, while the AI promotion task is running.
- Persist or index eforge-plan planning task references outside React component state while keeping daemon task records authoritative for status/result/error data.
- Show visible failed-task recovery actions, including retry with the same selected backlog context and derived planning request when enough request context is available.
- Extend the eforge-plan planning task result contract to support AI-authored session-plan creation drafts, not only patches to an existing session plan.
- Add a bounded planning decision result: AI output can be `ready` with session-plan creation content or `needs-input` with structured clarification questions and rationale.
- Let the user answer clarification questions or provide steering, then start a follow-up re-draft task that includes the previous task result plus the user's answers/steering as context.
- Add an explicit preview/apply flow that creates a new session plan from selected AI output via existing `create-session-plan`, `set-session-plan-section`, `select-session-plan-dimensions`, metadata, and readiness actions.
- Keep application explicit: generated AI output must remain read-only until the user previews and confirms the pieces to apply.
- Remove the deterministic implementation behind the backlog-item(s)-to-session-plan workstation path; the retained selected-items promotion control must start AI-driven generation instead of invoking deterministic promotion.
- Keep the lower-level `promote-selection` action contract only for compatibility with existing integrations/deep links unless a separate deprecation/removal plan is created; it must not remain a user-facing workstation planning path.
- Update the built workstation bundle under `eforge/extensions/eforge-plan/workstation-assets/plans` after changing `workstation-src/plans`.
- Update first-party eforge-plan documentation and mock workstation fixtures to describe the AI-first flow.

Out of scope:

- Open-ended multi-turn AI chat or daemon-owned conversation state beyond bounded stateless re-draft tasks linked by eforge-plan workflow metadata.
- Auto-mode backlog draining, scheduling, or automatic queue enqueueing.
- Removing `/eforge:plan`, the session-plan compatibility routes, or the `promote-selection` extension action contract.
- Allowing mutation-capable tools during the planning-draft agent task.
- Making task output automatically mark backlog items shipped or session plans submitted.
- Redesigning the general extension agent task runtime beyond additions needed for eforge-plan session-plan draft creation and task monitoring.

## Acceptance Criteria

- The Backlog view exposes exactly one selected-items session-plan generation action when one or more ready backlog items are selected.
- The selected-items session-plan generation action is labeled `Promote to a build plan`.
- The selected-items `Promote to a build plan` action is enabled only when at least one ready backlog item is selected.
- The selected-items `Promote to a build plan` action starts AI-driven session-plan generation without requiring the user to type a prompt or goal.
- The Backlog view does not render a separate `Plan with AI` start box with a required free-form prompt input.
- No Backlog-tab selected-item control invokes deterministic `promote-selection` to create a session plan.
- The workstation does not expose deterministic backlog-item(s)-to-session-plan promotion as an advanced or fallback planning affordance.
- The lower-level `promote-selection` action contract remains registered only for compatibility unless a separate deprecation/removal plan removes it.
- Starting an AI promotion task records the task id in durable eforge-plan-owned workflow metadata.
- Starting an AI promotion task records the derived planning request in durable eforge-plan-owned workflow metadata.
- Starting an AI promotion task records selected item ids or recommendation ref in durable eforge-plan-owned workflow metadata.
- Starting an AI promotion task records requested output sections in durable eforge-plan-owned workflow metadata.
- Starting an AI promotion task records the creation timestamp in durable eforge-plan-owned workflow metadata.
- Reloading the Backlog view after an AI promotion task starts displays the persisted task in the workstation task monitor without requiring the user to re-enter the task id.
- The workstation task monitor displays running planning task statuses from daemon task records fetched by task id.
- The workstation task monitor displays completed planning task statuses from daemon task records fetched by task id.
- The workstation task monitor displays failed planning task statuses from daemon task records fetched by task id.
- The workstation task monitor displays cancelled planning task statuses from daemon task records fetched by task id.
- A running AI promotion task record exposes section-level progress with a current section when the agent reports progress.
- A running AI promotion task record exposes covered sections when the agent reports progress.
- A running AI promotion task record exposes remaining sections when the agent reports progress.
- The workstation task monitor renders covered sections for a running AI promotion task when section-level progress is available.
- The workstation task monitor renders remaining sections for a running AI promotion task when section-level progress is available.
- The planning-draft agent prompt instructs the agent to report progress before or after each major generated session-plan section.
- The planning-draft task runtime accepts bounded structured section-progress reports without treating them as final output.
- Section-progress reports are sanitized before being persisted in task metadata or emitted in daemon progress events.
- Final readiness is based on the submitted planning result and session-plan readiness checks, not solely on progress reports.
- Apply eligibility is based on the submitted planning result and session-plan readiness checks, not solely on progress reports.
- A failed planning task displays its sanitized daemon error message in the workstation task monitor.
- A failed planning task with preserved request context exposes a retry action that starts a new planning task with the same derived planning request.
- A failed planning task retry reuses the same selection when preserved request context is available.
- A failed planning task retry reuses the same roadmap inclusion setting when preserved request context is available.
- A failed planning task retry reuses the same session input when present and preserved request context is available.
- A failed planning task retry reuses the same planning type when present and preserved request context is available.
- A failed planning task retry reuses the same planning depth when present and preserved request context is available.
- A failed planning task retry reuses the same requested output sections when preserved request context is available.
- Retrying a failed planning task records the new task id in durable eforge-plan-owned workflow metadata.
- The planning-draft result schema accepts a `ready` decision with an AI session-plan creation draft.
- The planning-draft result schema accepts a `ready` AI session-plan creation draft containing a session id.
- The planning-draft result schema accepts a `ready` AI session-plan creation draft containing a topic.
- The planning-draft result schema accepts a `ready` AI session-plan creation draft containing a planning type.
- The planning-draft result schema accepts a `ready` AI session-plan creation draft containing a planning depth.
- The planning-draft result schema accepts a `ready` AI session-plan creation draft containing optional profile when present.
- The planning-draft result schema accepts a `ready` AI session-plan creation draft containing optional agent profile when present.
- The planning-draft result schema accepts a `ready` AI session-plan creation draft containing optional open questions when present.
- The planning-draft result schema accepts a `ready` AI session-plan creation draft containing one or more dimension sections.
- The planning-draft result schema accepts a `needs-input` decision with one or more structured clarification questions.
- The planning-draft result schema accepts a `needs-input` decision with a rationale explaining why a ready plan was not produced.
- Completed daemon task records containing an AI session-plan creation draft pass `parseExtensionAgentTaskRecord` validation.
- The planning-draft prompt requests a `ready` session-plan creation draft when the workstation asks for session-plan generation from backlog selections.
- The planning-draft prompt requests a `needs-input` clarification result when the workstation asks for session-plan generation from backlog selections and a ready draft cannot be produced.
- The workstation renders `needs-input` clarification questions from a completed planning task without creating a session plan.
- The workstation renders `needs-input` clarification questions from a completed planning task without updating a session plan.
- The workstation lets the user answer `needs-input` questions and start a linked re-draft planning task.
- The workstation lets the user provide steering and start a linked re-draft planning task.
- A linked re-draft planning task includes the original request context in bounded planner context.
- A linked re-draft planning task includes the previous task summary or questions in bounded planner context.
- A linked re-draft planning task includes the user's answers or steering in bounded planner context.
- Starting a linked re-draft planning task records the parent task id in durable eforge-plan-owned workflow metadata.
- Starting a linked re-draft planning task records the new task id in durable eforge-plan-owned workflow metadata.
- Applying an AI session-plan creation draft requires an explicit user confirmation in the workstation before any session-plan file is written.
- Applying an AI session-plan creation draft creates `.eforge/session-plans/<session>.md` through adapter-backed session-plan operations.
- Applying an AI session-plan creation draft writes each selected generated dimension section into the created session plan.
- Applying an AI session-plan creation draft applies generated planning type metadata to the created session plan.
- Applying an AI session-plan creation draft applies generated planning depth metadata to the created session plan.
- Applying an AI session-plan creation draft applies generated profile metadata when that field is present in the draft.
- Applying an AI session-plan creation draft applies generated agent profile metadata when that field is present in the draft.
- Applying an AI session-plan creation draft applies generated open questions metadata when that field is present in the draft.
- Applying an AI session-plan creation draft returns a structured success result containing the created session id.
- Applying an AI session-plan creation draft returns a structured success result containing the relative session-plan path.
- Applying an AI session-plan creation draft returns a structured success result containing readiness detail.
- Applying an AI session-plan creation draft refuses to overwrite an existing session plan with the same explicit session id.
- Applying an AI session-plan creation draft surfaces a user-visible conflict message when the target explicit session id already exists.
- Applying generated AI promotion session-plan creation output does not call deterministic `promoteBacklogSelection`.
- Applying generated AI promotion session-plan creation output does not call the `promote-selection` action.
- Applying generated AI promotion output does not enqueue a build.
- Applying generated AI promotion output does not mark any backlog item `shipped`.
- Applying generated AI promotion output does not mark any session plan `submitted`.
- The Plans tab artifact list includes a newly created AI session plan after the apply action completes and the workstation refreshes.
- The mock workstation bridge supports at least one running AI promotion task fixture with section-level progress showing covered sections.
- The mock workstation bridge supports at least one running AI promotion task fixture with section-level progress showing remaining sections.
- The mock workstation bridge supports at least one failed AI promotion task fixture with retry behavior.
- The mock workstation bridge supports at least one completed AI promotion task fixture containing a `needs-input` clarification result.
- The mock workstation bridge supports at least one completed AI promotion task fixture containing a `ready` AI session-plan creation draft.
- Tests cover eforge-plan task workflow metadata persistence.
- Tests cover eforge-plan task workflow metadata reload projection.
- Tests cover section-level progress persistence for running AI promotion tasks.
- Tests cover section-level progress projection for running AI promotion tasks.
- Tests cover retrying a failed AI promotion task from preserved request context.
- Tests cover starting a linked re-draft task from a `needs-input` result and user-provided answers.
- Tests cover applying an AI session-plan creation draft through adapter-backed session-plan operations.
- Tests cover rejection of an AI session-plan creation draft that targets an existing explicit session id.
- Tests cover that applying AI generated output does not call enqueue.
- Tests cover that applying AI generated output does not change backlog items to `shipped`.
- Tests cover that the Backlog view selected-item UI presents the single `Promote to a build plan` action for selected ready items.
- Tests cover that the Backlog view selected-item UI does not render a separate prompt-input Plan with AI start box.
- Tests cover that deterministic promotion is absent from selected-item planning actions in the Backlog view.
- `pnpm --filter @eforge-build/eforge-plan-workstation type-check` exits 0.
- `pnpm build:eforge-plan-workstation` exits 0.
- `pnpm build:eforge-plan-workstation` updates the checked-in workstation assets.
- `pnpm type-check` exits 0.
- `pnpm test` exits 0.
- `pnpm maintainability:check` exits 0.

## Manual Verification Notes

- Manual browser inspection can be informational for UI behavior.
- Manual browser inspection should not be the only hard gate.
- UI behavior should be covered with component/action tests and fixture state where possible.