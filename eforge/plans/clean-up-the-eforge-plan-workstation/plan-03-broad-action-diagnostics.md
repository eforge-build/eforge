---
id: plan-03-broad-action-diagnostics
name: Structured Broad Action Diagnostics
branch: clean-up-the-eforge-plan-workstation/plan-03-broad-action-diagnostics
---

# Structured Broad Action Diagnostics

## Architecture Context

Contribution validation currently detects broad actions by scanning ids, titles, and descriptions for free-text words like `list`, `search`, and `board`. That produces false positives for single-record reads and write actions whose descriptions mention board or list concepts. The validator must instead classify broad large-output reads from structured contribution characteristics.

## Implementation

### Overview

Refine broad-action warning heuristics so they use ids/effective ids, side effects, output schemas, output profiles, and pagination controls. Stop treating free-text title or description words as classification evidence. Keep warnings for intentionally unbounded large-output read actions.

### Key Decisions

1. Treat an action as broad only when its local/effective id has a broad list/search/board shape and the output schema contains array-shaped data.
2. Skip broad-read warnings for single-record id prefixes such as `get-` and `preview-`, for `remove-` actions, and for actions with write, daemon, network, or build-queue side effects.
3. Treat declared `agent-paginated` plus limit/cursor controls as sufficient bounded-agent metadata; do not require free-text projection words for every compact list action.

## Scope

### In Scope

- Refactor `collectActionSpecWarnings()` broad-action detection in `packages/engine/src/extensions/contribution-validation.ts`.
- Add tests for false positives named in the source: `get-item`, `preview-backlog-curation-task`, `remove-planning-agent-task`, and write-like actions whose title/description mention list/search/board words.
- Keep a regression test for a deliberately unbounded broad list read.
- Update extension SDK contribution guidance if warning semantics are documented.

### Out of Scope

- Changing action registration validity rules.
- Removing support for `debug-rich` outputs.
- Rewriting host contribution discovery or invocation.

## Files

### Modify

- `packages/engine/src/extensions/contribution-validation.ts` — replace free-text broad detection with structured id/side-effect/output/profile/pagination checks.
- `test/extension-contribution-validation.test.ts` — add false-positive and true-positive diagnostics coverage.
- `packages/extension-sdk/README.md` — update bounded contribution guidance if the documented warning semantics mention free-text classification or projection-control requirements that no longer apply.

## Verification

- [ ] `get-item` with title or description text containing list/search/board terms emits zero broad-action warnings.
- [ ] `preview-backlog-curation-task` with title or description text containing list/search/board terms emits zero broad-action warnings.
- [ ] `remove-planning-agent-task` with title or description text containing list/search/board terms emits zero broad-action warnings.
- [ ] A write-like action with local-write side effects and broad words in title or description emits zero broad-action warnings.
- [ ] A deliberately unbounded `list-board`-style read with array output, no `outputProfile`, no `limit`, and no `offset` still emits broad-action warnings.
- [ ] `pnpm vitest run test/extension-contribution-validation.test.ts` passes.
