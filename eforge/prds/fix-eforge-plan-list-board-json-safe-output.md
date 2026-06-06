---
title: Fix eforge-plan list-board JSON-safe output
created: 2026-06-06
landing: pr
landing_auto_merge: true
---

# Fix eforge-plan list-board JSON-safe output

## Problem / Motivation

The `eforge-plan:list-board` extension action currently fails host invocation because its returned board object contains `undefined` values. Pi reports `invalid-output` before consumers receive the data, and the same daemon action path is used by Console workstations and other host integrations. This blocks structured board rendering and forces hosts to use the Markdown-only `render-board-markdown` action.

Roadmap alignment: this bug supports the Extension Platform roadmap and Console Observability/Control roadmap by making extension-authored actions reliable for Pi, Console workstations, and other host integrations while preserving the engine/runtime JSON-safe boundary.

Backlog context: `.backlog/items/backlog-2026-06-06-fix-eforge-plan-list-board-action-json-safe-output.md` is a high-priority candidate item in the eforge-plan extension thinking/workstation epic. Its claim and live reproduction match the current code behavior.

Relevant source files inspected:

- `eforge/extensions/eforge-plan/index.ts` owns the `list-board` and `render-board-markdown` action registrations plus `buildBoard`.
- `eforge/extensions/eforge-plan/backlog-domain.ts` normalizes backlog and epic records and exposes optional fields that can be `undefined`.
- `eforge/extensions/eforge-plan/kanban.ts` projects backlog items into lanes/cards and includes an optional `epic` property.
- `packages/engine/src/extensions/action-runtime.ts` validates raw action outputs before schema validation.
- `packages/engine/src/extensions/contribution-validation.ts` defines `undefined` as non-JSON-safe.
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` covers extension registration and is a natural place for a focused action regression test.

Evidence:

- Backlog item `.backlog/items/backlog-2026-06-06-fix-eforge-plan-list-board-action-json-safe-output.md` records the failing `list-board` invocation and successful Markdown fallback.
- Direct Pi invocation of `eforge_extension_contribution` for `eforge-plan:list-board` with `{ "includeArchive": false }` returned `ok: false`, `error.code: "invalid-output"`, and message `Action output is not JSON-safe: undefined values are not JSON-safe`.
- Direct Pi invocation of `eforge-plan:render-board-markdown` with the same input returned `ok: true` and Markdown board content.

## Goal

Make `eforge-plan:list-board` return JSON-safe structured board data through the extension action dispatch path. Preserve the engine/runtime JSON-safe boundary and keep `eforge-plan:render-board-markdown` working.

## Approach

Implement an extension-local JSON-safe projection helper for the board output. Prefer omitting absent optional fields, or convert intentionally absent values to `null` only where a stable key is required. Because existing output schemas use arrays of unknown objects for `epics`, `items`, `lanes`, and `traceSummaries`, omitting absent optional fields is the least disruptive representation.

Confirmed root cause by code inspection and live invocation:

- `eforge/extensions/eforge-plan/index.ts` registers `list-board` with `async handler(input, ctx) { return buildBoard(ctx.cwd, input); }`, so it returns the raw `buildBoard` object.
- `buildBoard` returns `epics`, `items`, `lanes`, `blockedReasons`, and `traceSummaries` directly from `listBacklogEpics`, `listBacklogItems`, `projectKanbanBoard`, and `summarizeTrace`.
- `eforge/extensions/eforge-plan/backlog-domain.ts` normalizers intentionally expose optional fields such as `priority`, `source`, `created`, `updated`, `last_checked`, `stale_after`, `epic`, and `eforge_plan` as properties whose values can be `undefined`.
- `eforge/extensions/eforge-plan/kanban.ts` returns `KanbanCard` objects with `epic: item.epic`, which can be `undefined`.
- `packages/engine/src/extensions/action-runtime.ts` rejects any action output whose raw value fails `validateJsonSafeValue` before cloning or schema validation.
- `packages/engine/src/extensions/contribution-validation.ts` treats `undefined` anywhere in arrays/objects as non-JSON-safe, producing the observed message.

Likely implementation targets:

- `eforge/extensions/eforge-plan/index.ts`: make `list-board` return a JSON-safe projection, and reuse that projection for any structured board output path if new helpers are added nearby.
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` or a new focused extension test: dispatch/invoke `list-board` against temp backlog data with missing optional fields and assert the dispatch succeeds with JSON-safe output.
- `eforge/extensions/eforge-plan/README.md`: update only if the output representation choice needs documentation beyond the existing statement that `list-board` returns JSON-safe data.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| The failing action id is `eforge-plan:list-board` and the failure is caused by non-JSON-safe output, not input validation or daemon unavailability. | Direct Pi invocation returned `ok: false`, `error.code: "invalid-output"`, and `Action output is not JSON-safe: undefined values are not JSON-safe`; the same action accepted `{ "includeArchive": false }` as input. | high | low | Re-run the same action after the fix and inspect the response. | Medium: if the failure moved to a different phase, the fix would target the wrong layer. |
| `render-board-markdown` succeeds because it returns only `{ markdown: string }`, while `list-board` exposes raw objects containing optional `undefined` fields. | Direct Pi invocation of `render-board-markdown` returned `ok: true`; code inspection shows it calls `renderBoard(await buildBoard(...))` and returns a string-only object. | high | low | Keep a regression assertion for `render-board-markdown` success. | Low: the main fix remains to make structured output JSON-safe. |
| Optional fields from backlog and kanban projections are the source of `undefined` values. | Code inspection found `normalizeBacklogItem`, `normalizeBacklogEpic`, `summarizeTrace`, and `projectCard` returning optional properties that can be `undefined`; `buildBoard` returns those raw objects. | high | low | Add a recursive undefined-path assertion in the list-board regression test if the test needs exact proof. | Medium: a partial sanitizer could miss nested optional fields if not recursive. |
| Omitting absent optional fields is compatible with current consumers. | `ListBoardOutput` uses `Type.Unknown()` arrays for most structured entries, README only promises JSON-safe board data, and no discovered typed consumer requires stable `null` keys for optional fields. | medium | low | Search for consumers of `list-board` before implementation and choose `null` only if a consumer needs stable keys. | Medium: choosing omission when a consumer expects `null` would require a follow-up adapter change. |
| The fix belongs in the eforge-plan extension rather than the shared action runtime. | Runtime tests intentionally reject `undefined` outputs, and docs require action handlers to return JSON-safe outputs. | high | low | Keep runtime tests unchanged and add extension-local regression coverage. | High: weakening runtime validation would reduce host safety across all extensions. |

Recommended profile: **Excursion**.

Rationale: the implementation is localized but should be planned and tested through the extension action dispatch boundary. A single cohesive plan can cover the sanitizer/projection change, focused regression test, and targeted validation. Expedition is unnecessary because no delegated module planning is needed; Errand is slightly too light because the bug crosses the extension output contract and host consumption path.

## Scope

In scope:

- Fix the localized `eforge-plan:list-board` structured output path.
- Sanitize or project returned board data before returning it from the action handler.
- Ensure `epics`, `items`, `lanes`, `blockedReasons`, and `traceSummaries` are JSON-safe.
- Add regression coverage through the real action dispatch boundary.
- Validate with targeted eforge-plan tests and type checking.
- Preserve `eforge-plan:render-board-markdown` behavior.

Out of scope:

- Do not weaken the daemon action runtime’s JSON-safe validation.
- Do not change the intentional runtime behavior that rejects `undefined` handler outputs.
- Do not make broad daemon/runtime changes when an extension-local projection is sufficient.

## Acceptance Criteria

- Invoking `eforge-plan:list-board` with `{ "includeArchive": false }` returns `ok: true` through the extension action dispatch path.
- The successful `eforge-plan:list-board` output contains a top-level `epics` field.
- The successful `eforge-plan:list-board` output contains a top-level `items` field.
- The successful `eforge-plan:list-board` output contains a top-level `lanes` field.
- The successful `eforge-plan:list-board` output contains a top-level `blockedReasons` field.
- The successful `eforge-plan:list-board` output contains a top-level `traceSummaries` field.
- A recursive validation over the `eforge-plan:list-board` output finds zero `undefined` values in objects or arrays.
- The `eforge-plan:list-board` output schema validation succeeds after the JSON-safe validation step.
- Invoking `eforge-plan:render-board-markdown` with `{ "includeArchive": false }` returns `ok: true`.
- The `eforge-plan:render-board-markdown` output contains a string `markdown` field.
- Existing extension action runtime tests continue to reject non-JSON-safe handler outputs that include `undefined` values.
- A regression test invokes `list-board` against backlog records with omitted optional frontmatter fields and asserts the action succeeds.
- `pnpm test -- eforge-plan` exits 0, or the equivalent targeted Vitest command for the touched eforge-plan tests exits 0.
- `pnpm type-check` exits 0.

## Manual Verification Notes

Reproduce from the repository root with the extension trusted/loaded in the daemon:

1. Invoke `eforge_extension_contribution` action `eforge-plan:list-board` with input `{ "includeArchive": false }`.
2. Observe the failure response before the fix: `ok: false`, `error.code: "invalid-output"`, and `error.message: "Action output is not JSON-safe: undefined values are not JSON-safe"`.
3. Invoke `eforge_extension_contribution` action `eforge-plan:render-board-markdown` with the same input.
4. Observe the success response: `ok: true` with an output object containing a `markdown` string.

Expected behavior:

- `eforge-plan:list-board` returns `ok: true` with JSON-safe structured board data containing `epics`, `items`, `lanes`, `blockedReasons`, and `traceSummaries`.
- No object or array reachable from `list-board` output contains `undefined` values.

Actual behavior before the fix:

- `list-board` is rejected by the action runtime before output schema validation because the raw handler output is not JSON-safe.
- `render-board-markdown` succeeds because it renders the board into `{ markdown: string }` and does not return the raw backlog/kanban objects.