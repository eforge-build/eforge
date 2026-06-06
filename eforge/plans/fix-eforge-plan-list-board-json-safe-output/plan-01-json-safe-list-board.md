---
id: plan-01-json-safe-list-board
name: JSON-safe eforge-plan list-board output
branch: fix-eforge-plan-list-board-json-safe-output/plan-01-json-safe-list-board
---

# JSON-safe eforge-plan list-board output

## Architecture Context

The extension action runtime validates raw handler output with `validateJsonSafeValue` before output schema validation. `eforge-plan:list-board` currently returns the raw `buildBoard` result, which includes normalized backlog, kanban, and trace objects with optional properties set to `undefined`. The fix belongs in the eforge-plan extension output projection layer; the shared action runtime must keep rejecting non-JSON-safe handler output.

## Implementation

### Overview

Add an extension-local JSON-safe board projection and return that projection from `list-board`. The projection retains the top-level board shape (`epics`, `items`, `lanes`, `blockedReasons`, `traceSummaries`) and recursively omits absent optional object properties whose value is `undefined`. `render-board-markdown` continues rendering from `buildBoard` and returning `{ markdown: string }`.

### Key Decisions

1. Keep the daemon/action-runtime JSON-safe boundary unchanged. Do not edit `packages/engine/src/extensions/action-runtime.ts` or `packages/engine/src/extensions/contribution-validation.ts` for this bug.
2. Omit absent optional fields instead of emitting `null`. The current `ListBoardOutput` schema uses unknown-object arrays for structured entries, and the README already describes `list-board` as JSON-safe data without guaranteeing stable optional keys.
3. Add regression coverage through `dispatchExtensionAction` rather than calling the action handler directly. This verifies raw-output JSON-safe validation and output schema validation in the same path used by Pi, Console workstations, and host integrations.

## Scope

### In Scope

- Sanitize the structured board data returned by `eforge-plan:list-board`.
- Ensure `epics`, `items`, `lanes`, `blockedReasons`, and `traceSummaries` remain present at the top level.
- Add a regression test that dispatches `eforge-plan:list-board` against temp backlog/trace records with omitted optional fields.
- Assert the dispatched output contains zero recursive `undefined` values.
- Assert `eforge-plan:render-board-markdown` still dispatches successfully with a string `markdown` field.

### Out of Scope

- Changes to shared runtime JSON-safe validation semantics.
- Changes to backlog-domain normalizers, kanban projection rules, or trace summarization semantics.
- Daemon route, client contract, Console UI, Pi integration, or Claude plugin changes.
- README updates; the existing action table already states that `list-board` returns JSON-safe data.

## Files

### Create

- None.

### Modify

- `eforge/extensions/eforge-plan/index.ts` — update the `list-board` handler to return a projected JSON-safe board object; add a small local recursive helper near `buildBoard` that omits `undefined` properties from objects and traverses arrays/objects without mutating the raw board.
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` — add dispatch-boundary regression coverage for `list-board` and `render-board-markdown`; add local test helpers for building a minimal registry from the recorder state and collecting recursive `undefined` paths.

## Implementation Notes

- Keep `buildBoard` as the source of raw board data so `renderBoard` and existing internal logic do not change.
- The `listBoard` handler can become `return projectBoardOutput(await buildBoard(ctx.cwd, input));` or an equivalent local helper call.
- The projection helper must preserve JSON primitives, recurse into arrays, recurse into plain objects, and omit object entries whose projected value is `undefined`.
- For array entries, the helper may either filter `undefined` entries or convert them to `null`; no current board path creates undefined array entries. Object-field omission is the required behavior for optional backlog/card/trace fields.
- The regression fixture must include at least:
  - one backlog epic written without optional frontmatter fields,
  - one backlog item written without optional fields such as `priority` and `epic`,
  - one trace sidecar without `epicId` and `lastEvent`,
  - a `list-board` dispatch with `{ includeArchive: false }`.
- Use action id `eforge-plan:list-board` for `dispatchExtensionAction`; the recorder stores local action specs under `entry.value.id` but runtime dispatch uses fully-qualified `entry.id`.
- Leave existing `test/extension-contribution-registry-runtime.test.ts` invalid-output expectations unchanged.

## Verification

- [ ] Dispatching `eforge-plan:list-board` with `{ includeArchive: false }` returns `{ kind: 'success' }` in the regression test.
- [ ] The dispatched `list-board` output has top-level `epics`, `items`, `lanes`, `blockedReasons`, and `traceSummaries` array fields.
- [ ] A recursive test helper finds `[]` undefined paths for the dispatched `list-board` output.
- [ ] Known omitted optional fields such as item/card `epic` and trace `lastEvent` are absent from the projected output.
- [ ] Dispatching `eforge-plan:render-board-markdown` with `{ includeArchive: false }` returns `{ kind: 'success' }` and an output object with `typeof markdown === 'string'`.
- [ ] `test/extension-contribution-registry-runtime.test.ts` still reports `invalid-output` for handlers that return `undefined` or nested non-JSON-safe values.
- [ ] `pnpm vitest run --config vitest.main.config.ts eforge/extensions/eforge-plan/__tests__/registration.test.ts test/extension-contribution-registry-runtime.test.ts` exits 0.
- [ ] `pnpm type-check` exits 0.
