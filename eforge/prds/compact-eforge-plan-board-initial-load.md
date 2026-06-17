---
title: Compact eforge-plan Board Initial Load
created: 2026-06-17
---

# Compact eforge-plan Board Initial Load

## Problem / Motivation

The eforge-plan workstation should not hydrate its Backlog view by pulling the full rich `list-board` payload. That rich payload includes UI-oriented board records, lifecycle/recommendation data, item details, and closed done/archive records, so initial load cost grows with backlog history.

The current backlog context already includes dozens of done items and archived items, making the default rich-board refresh a high-priority payload-size and performance hot path.

Compact contribution APIs are now shipped, so this work should migrate or verify the workstation hot path to load bounded open board summaries first, expose done/archive counts without loading every closed card, and fetch detail only when users explicitly ask for it.

## Goal

Use `list-board-compact` as the bounded initial Backlog data source for the workstation, while preserving the existing board UX. Closed lanes and item details should load lazily through explicit user actions or targeted reads.

## Approach

- Use `list-board-compact` as the sole board data source for the workstation hot path.
- Do not call `list-board` and then trim it client-side.
- Keep a local adapter from compact responses to the existing `Board`/`BoardItem` view model to minimize UI churn and isolate projection differences.
- Make the first refresh open-first and bounded.
- Use compact item summaries plus lane/count metadata for the initial board.
- Treat done/archive cards as lazy/paginated resources.
- Show done/archive counts immediately without loading closed card rows.
- Show closed card rows only after an explicit closed-lane request.
- Treat drawer content as detail data.
- Keep initial cards limited to identifiers, status, tags, blockers, lifecycle state, and recommendation markers.
- Load sections, evidence, dependency/dependent display titles, and lifecycle evidence rows from `get-item`.
- Keep recommendation data loaded independently.
- Overlay recommendation rank/group/unblock markers client-side rather than requiring rich board summaries.
- Preserve partial-failure behavior.
- Optional recommendation/roadmap failures should not blank the board.
- Board failures should surface clear errors.
- Leave rich `list-board` registered only for compatibility/debug reads, with an output profile and tests that make its non-hot-path role explicit.
- If compact projection/schema gaps remain, update `eforge/extensions/eforge-plan/backlog-query-actions.ts`, `schema.ts`, and `board-actions.ts`.

Likely primary files:

- `eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-workstation-data.ts` — initial refresh, open pagination, closed-lane loading, and error isolation.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/lib/compact-board-adapter.ts` — compact-to-board projection, pagination merges, detail merges, recommendation overlays.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/board.tsx`, `backlog-view.tsx`, `item-card.tsx`, and `item-drawer.tsx` — visible board controls, closed-lane affordances, selection, and lazy drawer behavior.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts`, fixtures, and mock bridge data — compact response and detail typing/test fixtures.
- `eforge/extensions/eforge-plan/index.ts` and registration tests — workstation allowed action list and debug-rich action registration.
- `eforge/extensions/eforge-plan/backlog-query-actions.ts`, `schema.ts`, and `board-actions.ts` — only if compact projection/schema gaps remain.
- `eforge/extensions/eforge-plan/README.md` and relevant tests under `eforge/extensions/eforge-plan/__tests__/` plus `test/eforge-plan-workstation.test.ts` — behavior and documentation drift.

Assumptions:

- Compact board APIs already provide lane counts, pagination metadata, open/closed counts, compact epics, lifecycle state, and enough item summary fields to render the board.
- `get-item` provides all dropped detail needed by the drawer, including Markdown sections, dependency/dependent summaries, link rows, lifecycle evidence, and failure evidence.
- Keeping the existing board view model behind an adapter is lower risk than rewriting all Backlog components at once.

## Scope

### In scope

- Replace any workstation initial-refresh dependency on `list-board` with bounded `list-board-compact` reads.
- Preserve the existing Backlog board UX by adapting compact summaries into the workstation's board view model.
- Support open-board pagination/load-more behavior through compact page requests.
- Load closed `done` and `archive` lanes only through explicit user action, filter/rail expansion, or paginated closed-lane reads.
- Fetch item drawer/detail content lazily with targeted `get-item` calls and merge the detail into the summary card model.
- Keep lifecycle chips, recommendation rank/group indicators, selection behavior, and edit flows working from compact projections or document/add any missing compact fields.
- Remove `list-board` from the workstation iframe allowlist and hot path while retaining it only as a compatibility/debug action if still needed.
- Add or update tests and README/reference notes for the compact-load behavior.

### Out of scope

- Redesigning the compact API family from scratch.
- General SDK/host ergonomics work beyond what this workstation migration needs.
- Unrelated planning-workstation UX changes.

## Acceptance Criteria

- Initial workstation refresh does not invoke `list-board`.
- Initial workstation refresh does not request an unbounded/default rich board payload.
- Initial Backlog load invokes a bounded compact board read suitable for visible open lanes.
- Initial Backlog load exposes total/open/closed counts without hydrating all closed cards.
- Initial Backlog load exposes done/archive lane counts without hydrating all closed cards.
- Additional open records are loaded through compact pagination.
- Additional open records are not loaded by switching back to rich board reads.
- Done cards are loaded only after explicit user action or closed-lane pagination.
- Archived cards are loaded only after explicit user action or closed-lane pagination.
- Repeated done/archive page loads merge without duplicating cards.
- Opening an item drawer triggers a targeted `get-item` detail read.
- Initial cards do not embed card bodies.
- Initial cards do not embed Markdown sections.
- Initial cards do not embed dependency detail.
- Initial cards do not embed lifecycle evidence rows.
- Lifecycle chips continue to work from compact projections or documented compact-projection replacements.
- Recommendation rank/group indicators continue to work from compact projections, recommendation overlays, or documented compact-projection replacements.
- Selection behavior continues to work from compact projections.
- Item edit flows continue to work from compact projections and lazy detail loading.
- `list-board` is absent from the workstation hot path.
- `list-board` is absent from the workstation iframe allowlist.
- `list-board` is covered as compatibility/debug-only or explicitly deprecated in tests/docs.
- Tests pass for compact initial load behavior.
- Tests pass for closed-lane pagination behavior.
- Tests pass for lazy item detail behavior.
- Tests pass for adapter merging behavior.
- Tests pass for action registration behavior.
- Targeted tests for `use-workstation-data` pass.
- Targeted tests for `compact-board-adapter` pass.
- Targeted tests for `item-drawer` pass.
- Targeted tests for workstation registration/allowlist pass.
- Targeted tests for compact query actions pass.
- README/reference notes document the compact-load behavior.
- A search for workstation hot-path `list-board` calls confirms none remain outside mocks/debug compatibility paths.
- `pnpm type-check` exits 0.

## Manual Verification Notes

- Run broader `pnpm test` when scope allows.
- Manually smoke test the workstation initial Backlog load.
- Manually smoke test recommendation indicators.
- Manually smoke test selection.
- Manually smoke test item drawer open.
- Manually smoke test item edit/save.
- Manually smoke test open-board load more.
- Manually smoke test done lane load.
- Manually smoke test archive lane load.
- Manually smoke test refresh after failures.
- If implementation was already partially present on the branch, verify tests/docs/backlog evidence rather than reworking stable code.