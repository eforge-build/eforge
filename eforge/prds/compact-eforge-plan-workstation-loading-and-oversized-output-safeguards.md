---
title: Compact eforge-plan Workstation Loading and Oversized Output Safeguards
created: 2026-06-15
depends_on: ["fix-workstation-session-plan-duplication-and-console-synthetic-resume-lanes"]
stack_parent: fix-workstation-session-plan-duplication-and-console-synthetic-resume-lanes
---

# Compact eforge-plan Workstation Loading and Oversized Output Safeguards

## Problem / Motivation

First-party extension contribution outputs are still too rich for both the eforge-plan workstation initial load and coding-agent hosts.

The eforge-plan workstation currently refreshes by invoking the rich `list-board` action with an unbounded/default input. This loads board-wide rich data for visible records and grows with done/archive history. The same class of rich board payload previously caused agent-context compaction when invoked from Pi.

This work should make compact, bounded reads the default path for the workstation and add defensive validation and host behavior so broad contribution actions do not overwhelm coding-agent contexts.

## Goal

Shift eforge-plan from a rich-board read model to a compact query/detail model: compact board reads provide the shell, counts, and identifiers, while targeted detail actions provide bodies, sections, dependencies, and closed-record pages on demand.

Add validation and host-side safeguards so large contribution outputs are warned, summarized, truncated, or rendered readably instead of flooding coding-agent context.

## Approach

- Adopt a compact-first, lazy-detail invariant for the workstation.
- Use compact open-board contribution APIs as the default source for the initial workstation refresh.
- Include only the data needed for the visible board shell, counts, and identifiers for follow-up reads in the initial workstation load.
- Preserve visible lane rendering, lifecycle chips, recommendation indicators, selection behavior, and edit flows by extending compact projections only where necessary.
- Use a transitional adapter layer between compact projections and current workstation card components if needed.
- Fetch item drawer/detail content lazily through targeted item/epic detail APIs.
- Load done/archive records only through explicit user action, filtering, or paginated lane/detail reads.
- Remove rich `list-board` from the workstation hot path.
- Retain rich `list-board` only as a compatibility/debug API if still needed, or explicitly rename/deprecate it with migration tests.
- Add validation warnings, not hard failures at first, for broad contribution actions with poor agent ergonomics.
- Derive validation diagnostics from action names, input schema pagination/projection fields, output schema shape, and optional output-profile metadata.
- Add or document output-profile helpers only if needed for precise validation.
- Treat host safety nets as defense in depth, not as permission to keep unbounded contribution APIs in hot paths.
- Summarize oversized outputs semantically rather than only byte-slicing.
- Preserve root shape, key IDs, titles, statuses, array counts, omitted counts, and suggested narrower actions or pagination inputs in summaries.
- Preserve deliberate raw/rich modes where safe.
- Render common `{ markdown }` outputs readably in supported hosts instead of dumping escaped JSON.
- Keep rich/UI-oriented actions available through explicit invocation and clear warnings.
- Avoid expanding the engine into workflow UX; this work belongs in extension APIs, host integrations, and the eforge-plan workstation.
- Document the distinction between compact agent-safe reads and rich compatibility/debug reads.
- Document host behavior for truncated or summarized output.
- Mitigate missing compact projection fields with an adapter and targeted projection additions rather than falling back to rich board loads.
- Mitigate lazy detail latency or state consistency issues with caching, loading states, and focused tests around drawer/edit flows.
- Mitigate noisy validation warnings for legitimate rich UI actions with explicit output profiles and warning-only rollout.
- Mitigate host behavior drift across Pi, CLI/MCP, Console, and Claude plugin surfaces by sharing formatter logic where feasible and checking both consumer-facing integration packages for user-facing changes.

Likely impact areas:

- `eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-workstation-data.ts`: replace `list-board` initial refresh with compact board reads and lazy detail orchestration.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts`, fixtures, and workstation tests: introduce compact board/detail types or adapters and update expectations that currently assume rich board cards.
- `eforge/extensions/eforge-plan/backlog-query-actions.ts`: extend `list-board-compact`, `get-item`, `get-epic`, or search projections only for fields the workstation actually needs.
- `eforge/extensions/eforge-plan/index.ts` and README/tests: update allowed workstation actions and document rich-vs-compact action roles.
- `packages/engine/src/extensions/contribution-validation.ts` and manifest/registration projection paths: add warning diagnostics for unbounded list/search/board-style actions and large-output declarations.
- `packages/extension-sdk/src/bounded-contributions.ts` / contribution type helpers: add or document output-profile helpers only if needed for validation to be precise.
- Host invocation/rendering code such as `packages/pi-eforge/extensions/eforge/extension-contribution-ux.ts`, `packages/eforge/src/cli/extension-contributions.ts`, MCP/Claude plugin surfaces, and Console contribution preview helpers: add shared budget-aware formatting/summarization where appropriate.
- `@eforge-build/client` owns contribution wire types; if result warning/summary metadata changes the wire contract, update the client schemas/routes first and avoid local re-declarations.

## Scope

In scope:

- Replace the workstation initial board refresh with compact/open board data, using the shipped compact contribution APIs as the default source.
- Preserve visible lane rendering, lifecycle chips, recommendation indicators, selection behavior, and edit flows by extending compact projections only where necessary.
- Fetch item drawer/detail content lazily through targeted item/epic detail APIs instead of embedding rich details in every initial board card.
- Load done/archive records only through explicit user action, filtering, or paginated lane/detail reads.
- Show done/archive counts on initial load without loading every closed card.
- Remove rich `list-board` from the workstation hot path while retaining it only as compatibility/debug API if still needed.
- Add validation warnings for list/search/board-style actions that lack limit/cursor/projection controls or declare large outputs without an explicit output profile.
- Add host-side safeguards that summarize or truncate oversized outputs with clear warnings while preserving IDs, titles, top-level structure, and follow-up hints.
- Render common `{ markdown }` outputs readably in supported hosts instead of dumping escaped JSON.
- Run targeted eforge-plan workstation tests.
- Run contribution validation/host tests.
- Run `pnpm type-check`.
- Run `pnpm maintainability:check`.

Out of scope:

- New workflow scheduling/orchestration features.
- Replacing the eforge-plan storage model.
- Removing rich UI-oriented contributions entirely; they should remain deliberately invocable.

## Acceptance Criteria

- Initial workstation refresh does not invoke `list-board` with an unbounded/default payload.
- Backlog initial load fetches compact open-board data suitable for visible lanes.
- Backlog initial load shows done/archive counts without loading every done/archive card body/detail.
- Done items are loaded only through explicit user action, filtering, or paginated lane/detail reads.
- Archived items are loaded only through explicit user action, filtering, or paginated lane/detail reads.
- Item drawer/detail content is fetched lazily through targeted item detail APIs.
- Item drawer/detail content is not embedded in every initial board card.
- Lifecycle chips continue to work from compact data or documented compact projections.
- Recommendation indicators continue to work from compact data or documented compact projections.
- Selection behavior continues to work from compact data or documented compact projections.
- Edit flows continue to work from compact data or documented compact projections.
- Rich `list-board` is removed from the workstation hot path.
- Rich `list-board` is retained only as a compatibility/debug API or explicitly renamed/deprecated.
- Tests document the migration away from rich `list-board` in the workstation hot path.
- Extension validation warns when list/search/board-style actions lack limit controls.
- Extension validation warns when list/search/board-style actions lack cursor controls.
- Extension validation warns when list/search/board-style actions lack projection controls.
- Extension validation warns when list/search/board-style actions declare large outputs without an explicit output profile.
- Host contribution invocation detects oversized outputs.
- Host contribution invocation summarizes or truncates oversized outputs with clear size warnings.
- Host contribution invocation does not dump full oversized payloads into agent context.
- Host output summaries preserve top-level structure.
- Host output summaries preserve IDs.
- Host output summaries preserve titles.
- Host output summaries preserve counts.
- Host output summaries preserve continuation hints.
- Supported hosts render common `{ markdown }` outputs readably instead of escaped JSON.
- Large rich/UI-only contributions remain invocable deliberately.
- Large rich/UI-only contributions are clearly marked or warned before use from coding-agent hosts.
- Workstation compact loading tests exist.
- Lazy detail behavior tests exist.
- Validation warning tests exist.
- Host oversized-output behavior tests exist.
- Readable markdown output handling tests exist.
- A test proves the workstation refresh does not call `list-board` for initial load.
- A test proves compact lane rendering works.
- A test proves compact count rendering works.
- A test proves lazy `get-item` detail fetch behavior works.
- Registration/validation tests cover bounded contribution action examples.
- Registration/validation tests cover unbounded contribution action examples.
- Host-formatting tests cover oversized JSON outputs.
- Host-formatting tests cover arrays of objects with IDs and titles.
- Host-formatting tests cover continuation hints.
- Host-formatting tests cover `{ markdown }` output rendering.
- Targeted eforge-plan workstation tests exit 0.
- Contribution validation tests exit 0.
- Host tests exit 0.
- `pnpm type-check` exits 0.
- `pnpm maintainability:check` exits 0.

## Manual Verification Notes

- Manually smoke the workstation against a large board to confirm context-safe output.
- Manually smoke a Pi/agent-host contribution invocation against a large board to confirm context-safe output.