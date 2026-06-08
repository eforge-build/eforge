---
id: plan-01-task-contracts-progress
name: Extend Planning Task Contracts and Progress Telemetry
branch: make-eforge-plan-workstation-ai-first-for-session-plan-generation/plan-01-task-contracts-progress
agents:
  builder:
    effort: xhigh
    rationale: This plan changes persisted daemon/client task result schemas, engine
      custom tools, and monitor sanitization; careful compatibility handling is
      required.
  reviewer:
    effort: high
    rationale: Review must check wire contract compatibility, sanitized telemetry,
      and prompt/tool non-submission behavior.
---

# Extend Planning Task Contracts and Progress Telemetry

## Architecture Context

The daemon-owned extension agent task record is the authoritative persisted status/result/error object, and `packages/client/src/extension-agent-tasks.ts` owns its wire schema. The eforge-plan workstation needs a new creation-oriented result shape and section-level progress without adding mutation-capable tools or daemon-owned chat state.

This plan only extends shared contracts, engine task execution, monitor persistence, and shared docs/tests. It does not add eforge-plan workflow indexing or workstation UI.

## Implementation

### Overview

Add shared support for AI planning decisions, session-plan creation drafts, and sanitized section progress for `eforge-plan.planning-draft` tasks. Keep existing result variants valid so current callers that submit recommendations, handoff drafts, plan drafts, playbook drafts, or `sessionPlanPatch` records continue to parse.

### Key Decisions

1. Keep result schema changes additive: preserve existing result variants and add new variants for `decision: 'ready'` with `sessionPlanCreationDraft`, and `decision: 'needs-input'` with structured clarification questions and rationale.
2. Treat section progress as telemetry only. Store bounded `sectionProgress` in task metadata and progress events; do not use it for final readiness or apply eligibility.
3. Add a read-only progress custom tool beside the existing submit tool. The progress tool updates metadata through a monitor callback; only the submit tool returns the final result.
4. Sanitize all progress strings and cap array lengths/string lengths before persisting or emitting them.

## Scope

### In Scope

- Extend shared requested-output-section values with `sessionPlanCreationDraft`.
- Add shared schemas/types for session-plan creation drafts, clarification questions, planning decisions, and section progress metadata.
- Update `hasEforgePlanPlanningDraftOutputSection` so ready creation drafts and needs-input decisions satisfy the result contract.
- Update the engine planning task submit tool schema and prompt to describe ready versus needs-input results and session-plan creation drafts.
- Add a progress reporting custom tool and pass a progress callback from monitor service to the engine task runner.
- Persist sanitized progress metadata on running daemon task records and emit sanitized progress events.
- Update shared daemon/client task contract tests and monitor service tests.
- Update first-party extension task docs only where the shared task contract or sanitized metadata semantics are described.

### Out of Scope

- eforge-plan workflow indexing, retry/redraft actions, and apply/create-session-plan logic.
- Workstation UI changes or generated workstation assets.
- Daemon task list routes.
- Auto-enqueueing builds or marking session plans submitted.

## Files

### Create

- `packages/client/src/__tests__/extension-agent-task-creation-draft.test.ts` — focused contract tests for ready creation drafts, needs-input decisions, and section-progress metadata if the existing contract test becomes too dense.

### Modify

- `packages/client/src/extension-agent-tasks.ts` — add `sessionPlanCreationDraft` requested output section, creation-draft schemas, clarification-question schemas, decision/result variants, section-progress metadata schema, exports, parser coverage, and output-section detection.
- `packages/client/src/__tests__/extension-agent-tasks.test.ts` — cover valid start payloads with `sessionPlanCreationDraft`, completed records with ready creation drafts, completed records with needs-input decisions, invalid creation draft payloads, and section-progress metadata validation.
- `packages/client/src/__tests__/events-schema-test-helpers.ts` and `packages/client/src/__tests__/events-schemas-extension-agent-tasks.test.ts` — include section-progress metadata in at least one task progress event fixture and verify event round trips.
- `packages/engine/src/agents/extension-planning-task.ts` — extend the submit tool schema, add `report_eforge_plan_planning_progress`, call an optional progress callback with sanitized/validated progress payloads, pass both effective tool names to the prompt, and keep the fail-closed no-submit error.
- `packages/engine/src/prompts/eforge-plan-planning-draft.md` — instruct the agent to call the progress tool before or after major session-plan sections, to submit exactly once, to return a ready creation draft when requested, and to return a needs-input decision with structured questions when a ready draft cannot be produced.
- `packages/monitor/src/routes/extensions/agent-task-events.ts` — sanitize `sectionProgress` metadata and include it in emitted task events without raw agent output.
- `packages/monitor/src/routes/extensions/agent-task-service.ts` — wire the engine progress callback, persist current/covered/remaining section metadata while a task is running, update output-section counting for creation drafts and needs-input decisions, and keep final completion based on the submitted result.
- `packages/monitor/src/__tests__/routes-extension-agent-tasks.test.ts` — cover progress tool reports persisting to the task record and daemon events, plus completed records containing a ready session-plan creation draft.
- `docs/extensions.md` and `web/content/docs/extensions.md` — update daemon-owned agent task documentation to mention sanitized section-progress metadata and ready/needs-input planning-draft results if the shared public contract prose references result semantics.
- `docs/extensions-api.md` and `web/content/docs/extensions-api.md` — update generated/reference snippets only if the docs generator exposes the changed task result or metadata shape.

## Verification

- [ ] `safeParseExtensionAgentTaskStartRequest` accepts `requestedOutputSections: ['sessionPlanCreationDraft']`.
- [ ] `parseExtensionAgentTaskRecord` accepts a completed ready result containing `sessionPlanCreationDraft.session`, `topic`, `planningType`, `planningDepth`, and one generated section.
- [ ] `parseExtensionAgentTaskRecord` accepts a completed needs-input result containing one clarification question and a rationale with no session-plan file output.
- [ ] A harness that calls the progress tool before submission produces a running record whose metadata includes `sectionProgress.currentSection`, `coveredSections`, and `remainingSections`.
- [ ] Progress event payloads validate through the client event schema and contain sanitized strings only.
- [ ] A harness that never calls `submit_eforge_plan_planning_result` still records a failed task with the sanitized non-submission error.
- [ ] `pnpm vitest run packages/client/src/__tests__/extension-agent-tasks.test.ts packages/monitor/src/__tests__/routes-extension-agent-tasks.test.ts` exits 0.
