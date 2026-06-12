---
title: Add Interactive AI Plan Revision Sessions for Existing Session Plans
created: 2026-06-12
depends_on: ["make-eforge-plan-backlog-curation-resilient-to-closed-dependency-references"]
stack_parent: make-eforge-plan-backlog-curation-resilient-to-closed-dependency-references
---

# Add Interactive AI Plan Revision Sessions for Existing Session Plans

## Problem / Motivation

Backlog item `backlog-2026-06-10-add-interactive-ai-plan-revision-sessions-for-existing-eforg` asks for a multi-turn way to start from an existing eforge-plan session plan, ask questions, request changes, resolve missing details, and apply accepted revisions back to the plan.

Users can now generate session plans with AI and manually edit existing session-plan sections, but once a plan exists there is no first-class interactive loop for asking the AI about that plan, requesting focused changes, resolving missing details, previewing proposed edits, and applying only accepted revisions.

The current `sessionPlanPatch` path can represent a one-shot patch, but it does not model a natural revision turn. A useful revision session needs both conversational output and optional structured edits: a turn may answer a question without changing the plan, request clarification, or propose section-level changes. Treating every turn as a patch either forces fake mutations or loses the user's ability to discuss the plan before applying changes.

The desired experience belongs in the `eforge-plan` workstation because the workstation already owns backlog, session-plan, readiness, lifecycle, and explicit apply/handoff UX. It should not become a generic daemon chat runtime. The daemon should continue to own read-only agent task execution and validated task records; eforge-plan should own the revision-session transcript/index, target session linkage, preview/apply semantics, and UI.

Current implementation facts:

- `packages/client/src/extension-agent-tasks.ts` owns the persisted planning task input/result schemas. It already has `existingSessionPlan`, `sessionPlanPatch`, `sessionPlanCreationDraft`, `needs-input`, and sanitized section-progress metadata, but no answer-plus-patch plan-revision turn shape.
- `packages/engine/src/agents/extension-planning-task.ts` runs the eforge-plan planning draft task with read-only tools, a structured submit tool, and a telemetry progress tool. It passes `existingSessionPlan` into the prompt template, but current eforge-plan start actions do not yet build a revision conversation around that field.
- `eforge/extensions/eforge-plan/agent-task-actions.ts` persists a durable planning task workflow index and supports start/list/get/cancel/retry/redraft for backlog/recommendation/curation tasks. The preserved context is selection-oriented, not existing-plan-revision-oriented.
- `eforge/extensions/eforge-plan/session-plan-actions.ts` already exposes adapter-backed flat session-plan reads, section writes, metadata updates, readiness checks, ready marking, and handoff. These are the safe mutation paths plan revisions should reuse.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-detail.tsx` renders a flat plan detail view with readiness, metadata, lifecycle evidence, sections, and handoff, but no AI revision panel.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/plan-with-ai-panel.tsx` and related backlog components provide durable AI task monitoring for backlog planning, not contextual revision sessions from the Plans tab.
- `eforge/extensions/eforge-plan/README.md` says the AI planning flow is durable but bounded and explicitly does not provide an open-ended multi-turn chat UI, daemon-owned chat state, or general extension-owned AI chat runtime.
- `docs/extensions.md` states the MVP task runner is intentionally narrow and does not expose generic multi-turn chat.

## Goal

Add a bounded, first-party **Revise with AI** experience for existing flat eforge-plan session plans that lets users ask questions, request plan changes, preview structured edits, and explicitly apply accepted revisions without turning the daemon into a generic chat runtime.

## Approach

### High-level design

- Keep revision-session state extension-owned.
  - eforge-plan stores the revision thread/index and links each turn to daemon task ids.
  - The daemon task record remains authoritative for task status/result/error.
  - The daemon does not own a chat transcript.
  - This satisfies the interactive UX request while preserving the documented daemon boundary and avoiding generic chat infrastructure.

- Add a revision-turn output shape instead of overloading `sessionPlanPatch`.
  - Model a turn as assistant narrative plus optional structured patch data.
  - A turn can answer a question, ask for clarification, or propose edits.
  - Users need to ask questions about the current plan without forcing a fake patch.

- Start with flat session plans only.
  - The V1 UI appears on flat plan detail cards and does not revise session plan sets.
  - Flat plans already have adapter-backed section, metadata, readiness, and handoff flows.
  - Plan sets introduce child-plan coordination that should be designed separately.

- Treat every user message as a bounded single-shot agent task.
  - The workstation starts a new linked task per turn with current plan context and bounded prior-turn context.
  - This gives multi-turn interaction from the user's perspective without daemon-owned conversation state or mutation-capable agent sessions.

- Apply only explicit, previewed mutations.
  - Answer-only turns never mutate.
  - Patch-bearing turns render a diff and require explicit section-level apply confirmation.
  - Current eforge-plan AI flows use preview-before-apply; plan revisions should keep that safety model.

- Validate against stale base-plan fingerprints.
  - A proposed patch records the base plan fingerprint and/or per-section hashes.
  - Apply validates the current plan before writing.
  - Plans can be edited manually while a task runs; applying a stale AI patch must not silently overwrite newer user edits.

- Keep readiness and handoff separate.
  - After apply, the workstation refreshes readiness diagnostics but does not mark ready or enqueue.
  - The existing ready/handoff controls remain explicit.
  - A revision may improve a plan without proving it is ready to build.

- Reuse current task monitoring patterns where practical.
  - Revision turns should share task status, progress, cancel, retry, and redraft behaviors with the existing Plan with AI monitor.
  - Revision turns render in the Plans tab with target-session context.
  - This avoids a second task UX model and keeps failure/recovery behavior consistent.

### Proposed control flow

1. User opens a flat session plan in the Plans tab and chooses **Revise with AI**.
2. Workstation invokes an eforge-plan action to create or resume a revision session for `plan.session`.
3. User submits a question or change request.
4. The action loads the current session plan through `createSessionPlanningWorkflowAdapter()`, computes a base fingerprint, gathers readiness/source/lifecycle summaries, loads bounded thread context, and starts a daemon-owned read-only task.
5. The daemon runs the planner role with read-only tools and a structured submit tool. The agent submits a revision-turn result or a `needs-input` decision.
6. The revision store links the task result to the thread. The workstation polls or reloads task state through extension actions and renders the assistant message plus optional patch preview.
7. User applies selected sections. The apply action validates the base fingerprint, writes selected sections through adapter-backed mutations, updates thread applied metadata, refreshes readiness, and returns the updated plan projection.
8. User can continue the thread with another message; the next turn includes bounded history and the latest plan state.

### Implementation targets

- `packages/client/src/extension-agent-tasks.ts`
  - Add the shared wire schema for a revision-turn result if persisted in `ExtensionAgentTaskRecord.result`.
  - Recommended shape is a first-class output such as `planRevisionTurn` with `targetSession`, `assistantMessage`, `basePlanFingerprint`, optional `proposedPatch.sections`, optional metadata/open-question changes, citations/evidence, and apply guidance.
  - Add the requested-output-section literal and exported browser/node types.

- `packages/engine/src/agents/extension-planning-task.ts`
  - Extend the structured submit tool schema and parsing path for the revision-turn output.
  - If a new task kind is chosen, add a narrow runner dispatch that still uses read-only tools and the same progress tool discipline.

- `packages/engine/src/prompts/eforge-plan-planning-draft.md`
  - Teach the prompt how to handle existing-session-plan revision turns, including answer-only responses, patch-bearing responses, clarification, base-plan constraints, and explicit non-mutation rules.
  - If using a new prompt, add a focused `eforge-plan-plan-revision-turn` prompt instead.

- `eforge/extensions/eforge-plan/planning-agent-task-schemas.ts`
  - Add action schemas for plan revision sessions, revision turn start/list/get/apply inputs, and output projections.
  - Keep JSON-safe additional-properties discipline aligned with existing schemas.

- New `eforge/extensions/eforge-plan/plan-revision-store.ts`
  - Persist extension-owned revision-session index/thread data atomically, newest-first.
  - Include stale/malformed storage fallback behavior similar to `planning-task-workflow-store.ts`.

- New `eforge/extensions/eforge-plan/plan-revision-actions.ts`
  - Register actions such as `start-plan-revision-session`, `list-plan-revision-sessions`, `get-plan-revision-session`, `start-plan-revision-turn`, `retry-plan-revision-turn`, `cancel-plan-revision-turn`, `apply-plan-revision-turn`, and optional `dismiss-plan-revision-session`.

- `eforge/extensions/eforge-plan/planner-orchestration.ts`
  - Add helpers to prepare bounded existing-plan context.
  - Validate revision-turn task results.
  - Validate base plan fingerprints before apply.
  - Compose safe mutations through the session-plan adapter.

- `eforge/extensions/eforge-plan/session-plan-actions.ts`
  - Prefer reusing existing `set-session-plan-section`, `update-session-plan-metadata`, and readiness logic.
  - Add a dedicated skipped-dimension action only if revision patches need to modify skipped dimensions in V1.

- `eforge/extensions/eforge-plan/index.ts`
  - Register new revision actions and add them to the planning workstation `allowedActions`.

- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-detail.tsx`
  - Add the AI revision entry point and wire it to the currently loaded plan.

- New workstation UI modules such as:
  - `views/plans/plan-revision-panel.tsx`
  - `views/plans/plan-revision-thread.tsx`
  - `views/plans/use-plan-revision-session.ts`

- New workstation UI modules should render messages, task state, progress, clarification forms, patch previews, stale warnings, and apply controls.

- `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts`, `bridge.ts`, and `fixtures/mock-data.ts`
  - Add frontend types and mocks for revision sessions, turns, answer-only results, patch results, stale apply, and clarification redraft.

- `eforge/extensions/eforge-plan/README.md` and `docs/extensions.md`
  - Update boundary docs to distinguish first-party bounded eforge-plan revision sessions from unsupported generic daemon chat.

- `eforge/extensions/eforge-plan/workstation-assets/plans/*`
  - Regenerate with `pnpm build:eforge-plan-workstation` after source UI changes.

### Boundary constraints

- Shared daemon/client task wire shapes stay in `@eforge-build/client`; do not duplicate task result interfaces in monitor/workstation code.
- Extension action code must not import provider SDKs or `AgentHarness` directly.
- The agent task uses read-only tools and cannot write session-plan files itself.
- Workstation iframe code continues to use `window.eforge.invokeAction` and registered `allowedActions`; no private Console imports or raw extension-owned HTTP routes.
- AI output is parsed against typed schemas and mapped to safe adapter-backed mutations.
- Existing backlog Plan with AI, recommendation refresh, and backlog curation task flows must continue to work while revision-session actions are added.

### Documentation updates

- Update `eforge/extensions/eforge-plan/README.md` to describe **Revise with AI** on existing session plans, revision-session storage, answer-only turns, patch preview, explicit apply, stale-plan conflict handling, retry/redraft, and the fact that handoff remains separate.
- Update the `eforge/extensions/eforge-plan/README.md` action table to add revision-session actions and side effects.
- Update the `eforge/extensions/eforge-plan/README.md` storage section to add the new extension-private revision-session storage path.
- Update the `eforge/extensions/eforge-plan/README.md` planning boundary section to replace the blanket unsupported multi-turn chat language with a narrower statement that generic daemon chat remains unsupported, while eforge-plan provides bounded first-party revision sessions by chaining read-only tasks.
- Update `docs/extensions.md` if the shared task contract gains a new task kind or result variant, and document that first-party eforge-plan revision sessions are an application-level pattern, not a general extension-supplied chat runtime.
- Update generated API/reference docs if client schemas exported to docs change.
- Update workstation mock/dev docs if new local fixture states or dev controls are added.
- No Pi or Claude plugin documentation should change unless new user-facing CLI/MCP commands or skills are added.
- Still check `eforge-plugin/` and `packages/pi-eforge/` before implementation sign-off because repository policy requires keeping consumer-facing integration packages aligned when capabilities are exposed there.

### Risks and mitigations

- Chat scope creep: a revision panel can drift into a generic chat product. Mitigation: call it plan revision, target exactly one session, store only bounded eforge-plan thread context, and keep daemon task turns single-shot.
- Schema drift: task records are parsed through `@eforge-build/client`. Mitigation: define any persisted revision-turn result in `packages/client/src/extension-agent-tasks.ts` and add round-trip tests.
- Stale overwrite: users can edit a plan while an AI turn is running. Mitigation: require base plan fingerprints or per-section hashes and block stale applies.
- Context growth: long revision sessions can exceed useful task context. Mitigation: store full local history if needed, but send bounded recent turns plus a generated summary to each task.
- Answer-versus-patch ambiguity: the agent may propose prose edits without structured patches. Mitigation: require patch-bearing turns to include machine-readable section edits; answer-only turns are displayed but not applicable.
- Readiness regression: applying AI acceptance criteria can create vague or manual-only criteria. Mitigation: run existing readiness and acceptance-criteria diagnostics after apply and surface failures immediately.
- Concurrent turns: multiple running turns for one plan can conflict. Mitigation: disable concurrent turn submission per revision session for V1 or require separate branches with explicit stale handling.
- UX overload: Plans detail already has readiness, metadata, lifecycle, sections, and handoff. Mitigation: make the revision panel collapsible and focus on the latest turn plus history.
- Generated asset drift: source UI changes do not affect production workstation assets unless rebuilt. Mitigation: include `pnpm build:eforge-plan-workstation` and asset tests.
- Boundary regression: adding true daemon chat state would conflict with docs and architecture. Mitigation: keep transcript storage/action semantics in eforge-plan extension code.

### Assumptions and validation

| Assumption | Evidence | Confidence | Validation path | Impact if wrong |
| --- | --- | --- | --- | --- |
| Existing session-plan adapter actions are sufficient for safe section and metadata apply. | `session-plan-actions.ts` exposes create/read/set-section/metadata/readiness/handoff through `createSessionPlanningWorkflowAdapter()`. | High | Implement revision apply by composing adapter-backed mutations and add file/readiness tests. | New adapter APIs may be needed before revision apply is safe. |
| A new answer-plus-optional-patch result shape is needed. | Current client schema has `sessionPlanPatch`, but answer-only turns need a valid output section without mutation. | High | Add schema tests for answer-only and patch-bearing revision turns. | Overloading `sessionPlanPatch` would force fake patches or invalid task results. |
| Extension-owned revision thread storage fits the architecture. | README says daemon owns task records while eforge-plan owns planning state/apply semantics; docs reject generic daemon chat. | High | Add `plan-revision-store.ts` tests for malformed/missing storage and ordering. | If state must be daemon-owned, the design would require a broader platform chat feature. |
| Flat-plan-only V1 is acceptable. | The current Plans tab already has a flat `PlanDetailCard`; plan sets have separate validation semantics. | Medium | Confirm with product review before implementation; keep plan-set controls absent in tests. | Users may expect plan-set revision and need a follow-up. |
| Current task progress tooling can be reused. | `extension-planning-task.ts` already exposes sanitized section progress via a telemetry-only tool. | High | Verify running revision turns surface progress in task metadata and workstation tests. | A separate progress channel would add avoidable daemon/client complexity. |
| Generated profile/agent metadata is not central to revision sessions. | Revisions target existing plans whose metadata already exists; `update-session-plan-metadata` can handle explicit metadata changes. | Medium | Keep V1 patch metadata minimal and test open-question metadata updates only if implemented. | Metadata edits might be deferred to manual plan metadata UI. |

## Scope

### In scope

- Add a **Revise with AI** panel or drawer to the flat session-plan detail view in the Plans tab.
- Let the user start or resume a revision session for an existing flat `.eforge/session-plans/<session>.md` plan.
- Persist eforge-plan-owned revision-session records under extension-private storage, including target session, thread id, messages or bounded summaries, linked task ids, base plan fingerprints, applied turn markers, and timestamps.
- For each user message, start a daemon-owned read-only agent task with bounded context containing the current plan detail, readiness diagnostics, source refs/lifecycle summary, the recent revision-session context, and the user's message.
- Support answer-only turns, clarification-needed turns, and turns that include proposed structured plan edits.
- Preview proposed edits as per-dimension diffs or before/after cards before any mutation occurs.
- Apply accepted section changes through adapter-backed session-plan mutation helpers, then refresh readiness and the loaded plan detail.
- Track the base plan fingerprint or per-section hashes used by each proposed patch and block stale applies when the plan changed after the AI generated the revision.
- Reuse or adapt existing task monitoring affordances for queued/running/failed/cancelled/completed revision turns, including cancel, retry with preserved context, and redraft after clarification.
- Keep generated output read-only until explicit user confirmation.
- Update first-party docs and workstation fixtures so local development covers answer-only, patch, stale-apply, clarification, retry, and applied-turn states.
- Add client schema tests for the revision-turn result and task record round trip.
- Add engine prompt/runner tests using `StubHarness` for answer-only, patch, and needs-input outputs.
- Add extension action tests for revision-session persistence, starting linked tasks, stale apply blocking, section apply, retry, and redraft.
- Add workstation component/hook tests for the Plans tab revision panel and preview/apply behavior.
- Add README/contract tests if action tables or boundary text are updated.
- Run root `pnpm type-check`, `pnpm test`, and `pnpm maintainability:check` before handoff.

### Out of scope for V1

- Generic extension marketplace AI chat or arbitrary extension-supplied prompt templates.
- Daemon-owned long-lived chat transcripts or conversation memory.
- Mutation-capable agent tools during revision tasks.
- Session plan-set revision UX.
- Automatic `set-session-plan-ready`, `handoff-session-plan`, queue enqueueing, backlog shipping, or build execution from a revision turn.
- Backlog curation, recommendation refresh, or auto-mode backlog draining changes beyond preserving compatibility with the shared task monitor.
- Editing code from the revision session; this feature revises the planning artifact only.

## Acceptance Criteria

- `packages/client/src/extension-agent-tasks.ts` exports a typed revision-turn result schema.
- Client schema tests parse completed task records containing answer-only revision turns.
- Client schema tests parse completed task records containing patch-bearing revision turns.
- Client schema tests verify revision-turn results round trip through `ExtensionAgentTaskRecord.result`.
- `packages/engine/src/agents/extension-planning-task.ts` accepts the revision-turn submission shape.
- Revision-turn agent tasks invoke the planner with `tools: 'read-only'`.
- Engine tests reject invalid revision-turn payloads.
- Engine prompt/runner tests using `StubHarness` validate answer-only revision-turn outputs.
- Engine prompt/runner tests using `StubHarness` validate patch-bearing revision-turn outputs.
- Engine prompt/runner tests using `StubHarness` validate `needs-input` revision-turn outputs.
- `eforge/extensions/eforge-plan` registers revision-session actions.
- `start-plan-revision-session` is registered as an eforge-plan action.
- `list-plan-revision-sessions` is registered as an eforge-plan action.
- `get-plan-revision-session` is registered as an eforge-plan action.
- `start-plan-revision-turn` is registered as an eforge-plan action.
- `retry-plan-revision-turn` is registered as an eforge-plan action.
- `cancel-plan-revision-turn` is registered as an eforge-plan action.
- `apply-plan-revision-turn` is registered as an eforge-plan action.
- The planning workstation `allowedActions` includes every implemented revision-session action.
- An extension action test starts a revision session for an existing `session`.
- An extension action test starts a linked turn for an existing `session`.
- An extension action test lists persisted thread state after reload.
- An extension action test cancels a running revision turn.
- An extension action test retries a revision turn with preserved context.
- An extension action test verifies revision-session persistence after storage reload.
- `plan-revision-store.ts` tests verify malformed storage fallback behavior.
- `plan-revision-store.ts` tests verify missing storage fallback behavior.
- `plan-revision-store.ts` tests verify newest-first ordering.
- An extension action test verifies stale apply blocking.
- An extension action test verifies section apply through adapter-backed mutation.
- An extension action test verifies redraft after clarification.
- A workstation test opens `views/plans/plan-detail.tsx` and submits an answer-only question through **Revise with AI**.
- A workstation test renders the assistant message for an answer-only revision turn.
- A workstation test confirms no `set-session-plan-section` action is invoked for an answer-only revision turn.
- A workstation test submits a change request and renders a proposed `scope` revision.
- A workstation test submits a change request and renders a proposed `acceptance-criteria` revision.
- A workstation test applies only the selected dimension from a proposed revision patch.
- A workstation test verifies the plan detail view refreshes readiness after applying a selected revision dimension.
- Applying a revision turn with a stale `basePlanFingerprint` returns a blocked apply result.
- The stale apply result names the target `session`.
- Tests verify no section write occurs when applying a stale revision turn.
- A `needs-input` revision turn renders structured clarification questions.
- The clarification flow accepts user answers.
- The clarification flow starts a linked redraft task.
- The linked redraft task records the prior task id in extension-private thread state.
- Revision-apply tests assert `handoff-session-plan` is not invoked.
- Revision-apply tests assert the session is not marked `ready`.
- Revision-apply tests assert a build is not enqueued.
- `eforge/extensions/eforge-plan/README.md` describes bounded eforge-plan revision sessions.
- `eforge/extensions/eforge-plan/README.md` preserves the statement that generic daemon-owned chat runtime support remains unsupported.
- `eforge/extensions/eforge-plan/README.md` describes **Revise with AI** on existing session plans.
- `eforge/extensions/eforge-plan/README.md` describes revision-session storage.
- `eforge/extensions/eforge-plan/README.md` describes answer-only turns.
- `eforge/extensions/eforge-plan/README.md` describes patch preview.
- `eforge/extensions/eforge-plan/README.md` describes explicit apply.
- `eforge/extensions/eforge-plan/README.md` describes stale-plan conflict handling.
- `eforge/extensions/eforge-plan/README.md` describes retry and redraft behavior.
- `eforge/extensions/eforge-plan/README.md` states that handoff remains separate.
- `eforge/extensions/eforge-plan/README.md` action table includes revision-session actions and side effects.
- `eforge/extensions/eforge-plan/README.md` storage section documents the new extension-private revision-session storage path.
- `docs/extensions.md` describes first-party eforge-plan revision sessions as an application-level pattern when the shared task contract gains a new task kind or result variant.
- `docs/extensions.md` preserves the statement that generic daemon-owned chat runtime support remains unsupported.
- Workstation fixtures include answer-only revision-session state.
- Workstation fixtures include patch revision-session state.
- Workstation fixtures include stale-apply revision-session state.
- Workstation fixtures include clarification revision-session state.
- Workstation fixtures include retry revision-session state.
- Workstation fixtures include applied-turn revision-session state.
- README/contract tests pass after action tables or boundary text are updated.
- `pnpm build:eforge-plan-workstation` completes without errors.
- `pnpm build:eforge-plan-workstation` regenerates `eforge/extensions/eforge-plan/workstation-assets/plans/*`.
- Root `pnpm type-check` exits 0.
- Root `pnpm test` exits 0.
- Root `pnpm maintainability:check` exits 0.

## Manual Verification Notes

- Confirm with product review before implementation that flat-plan-only V1 is acceptable; if this assumption is wrong, users may expect plan-set revision and need a follow-up.
- Check `eforge-plugin/` and `packages/pi-eforge/` before implementation sign-off because repository policy requires keeping consumer-facing integration packages aligned when capabilities are exposed there.
- Do not change Pi or Claude plugin documentation unless new user-facing CLI/MCP commands or skills are added.