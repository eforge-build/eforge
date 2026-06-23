---
id: plan-03-backlog-query-projections
name: eforge-plan Backlog Query Projection Controls
branch: agent-first-backlog-discovery-and-session-plan-auto-creation/plan-03-backlog-query-projections
---

# eforge-plan Backlog Query Projection Controls

## Architecture Context

`eforge-plan` already has compact agent-facing actions for backlog reads. This plan adds projection controls so agents can narrow optional epics, lane counts, sections, lifecycle rows, dependencies, and body text without growing default compact payloads. Direct backlog workflows remain action-oriented through `search-items`, `get-item`, `get-epic`, `capture-item`, and `update-item`.

## Implementation

### Overview

Extend eforge-plan compact backlog action input/output schemas and projections, mark direct write/read actions with agent-friendly output profiles where useful, and update docs/tests that guide agents toward direct compact backlog operations.

### Key Decisions

1. Add projection flags to existing actions instead of adding parallel aliases or new broad manifest browsing paths.
2. Preserve current default payload shape unless a flag asks to omit or include optional data.
3. Keep raw Markdown body output opt-in through existing or new explicit body flags.
4. Keep the workstation using compact actions and update it only if type changes require new optional fields.

## Scope

### In Scope

- Projection controls on `get-item`, `get-epic`, `search-items`, and `list-board-compact` where each control maps to existing output data.
- Optional suppression/inclusion for epics, lane counts, sections, lifecycle rows, dependencies/dependents, and body/body text.
- Output schema updates that make projected fields optional when a flag omits them.
- Agent workflow docs that direct backlog discovery and mutation to `search-items`, `get-item`, `get-epic`, `capture-item`, and `update-item`.
- Registration tests for descriptions and output profiles.
- Query action tests for projection switches and unchanged compact defaults.

### Out of Scope

- New backlog storage formats.
- New deterministic promotion behavior.
- Contribution host list/show implementation.
- Workstation auto-apply behavior.

## Files

### Create

- None expected.

### Modify

- `eforge/extensions/eforge-plan/backlog-query-actions.ts` — Add projection input fields, optional output schema fields, and projection-aware compact item/epic/detail helpers.
- `eforge/extensions/eforge-plan/index.ts` — Update action descriptions and add `CONTRIBUTION_OUTPUT_PROFILES.agentCompact` to small direct write actions such as `capture-item` and `update-item` if their outputs remain compact.
- `eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts` — Add tests for each new projection switch and default payload size expectations.
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` — Assert direct backlog actions have agent-oriented descriptions/output profiles and remain registered.
- `eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts` — Assert README agent workflow guidance mentions the five direct backlog operations.
- `eforge/extensions/eforge-plan/README.md` — Document direct agent backlog workflow and projection flags.
- `web/content/docs/eforge-plan.md` — Sync public docs summary if the docs page needs direct backlog workflow wording.
- `web/public/docs/eforge-plan.md` — Regenerate public docs output if docs generation updates this file.

## Implementation Notes

- Suggested `get-item` flags: `includeEpic`, `includeSections`, `includeLifecycleRows`, `includeDependencies`, `includeDependents`, and existing `includeBody`.
- Suggested `get-epic` flags: existing `includeBody`/`includeItems`, plus `includeSections` and any useful item summary projection flags.
- Suggested `search-items` flags: `includeEpics`, `includeDependencies`, and existing `searchBody` for search scope; do not return body text unless an explicit output flag is added.
- Suggested `list-board-compact` flags: `includeEpics`, `includeLaneCounts`, and `includeDependencies`; keep `limit`/`offset` behavior unchanged.
- If a projected field can be omitted, make it `Type.Optional(...)` in the output schema.
- Avoid returning full board payloads or raw private trace storage in any compact action.

## Verification

- [ ] `get-item` with section/lifecycle/dependency/epic flags disabled omits `sections`, lifecycle row arrays, dependency arrays, and `epic` from the response.
- [ ] `get-item` with `includeBody: true` returns the selected item body and still does not return dependency item bodies.
- [ ] `get-epic` with `includeSections: false` omits epic sections.
- [ ] `get-epic` with `includeItems: false` returns an empty `items` array and `totalItems: 0`.
- [ ] `search-items` with `includeEpics: true` returns compact epics for matched items.
- [ ] `search-items` and `list-board-compact` with dependency projection disabled omit dependency id arrays from item summaries.
- [ ] `list-board-compact` with epic and lane-count projection disabled omits `epics`, `lanes`, and aggregate lane/count fields selected by the flag design.
- [ ] Default `search-items`, `get-item`, `get-epic`, and `list-board-compact` fixture outputs do not contain additional raw body text compared with current tests.
- [ ] README contract test finds guidance for `search-items`, `get-item`, `get-epic`, `capture-item`, and `update-item`.
- [ ] Registration test confirms agent compact/paginated output profiles on direct backlog operations.