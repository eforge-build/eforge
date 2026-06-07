---
id: plan-01-extension-planning-workstation
name: Extension-Owned Planning Workstation and Actions
branch: move-console-plans-into-the-eforge-plan-workstation/plan-01-extension-planning-workstation
agents:
  builder:
    effort: high
    rationale: This plan adds a new extension-owned action surface, JSON-safe
      projections, local session-plan mutations, and a sandboxed frame-bundle UI
      that must preserve the extension/Console boundary.
  reviewer:
    effort: high
    rationale: Review needs careful attention to iframe bridge allowlists, local
      file writes, JSON-safe outputs, and compatibility with the existing
      session-planning adapter.
---

# Extension-Owned Planning Workstation and Actions

## Architecture Context

The core Console must host extension workstations without owning planning product UX. The `eforge-plan` extension already owns backlog board and promotion actions, and `@eforge-build/input` already owns session-plan and plan-set artifact semantics through `createSessionPlanningWorkflowAdapter()`. This plan turns the current proof-of-concept board iframe into a real extension-owned planning workstation using the existing frame-bundle contract, with all reads and mutations routed through `window.eforge.invokeAction` and manifest-allowed extension actions.

Daemon/client session-plan and session plan-set routes remain compatibility plumbing for Pi, Claude, CLI, daemon clients, and other tools. Do not remove or rename those routes in this plan.

## Implementation

### Overview

Add focused `eforge-plan` action modules for planning artifact list/show/create/mutate/readiness/handoff operations, backed by the bundled session-planning workflow adapter. Replace the inline `srcDoc` board workstation registration with a `frameBundle` workstation under `eforge/extensions/eforge-plan/workstation-assets/plans/`. Keep the browser assets vanilla browser code that invokes extension actions through `window.eforge.invokeAction` only.

### Key Decisions

1. Use `createSessionPlanningWorkflowAdapter()` from `../../../packages/input/src/index.js` for flat session-plan and plan-set reads/mutations so readiness, acceptance-criteria diagnostics, path containment, and plan-set validation stay in the input package.
2. Implement the handoff action as the source-path fallback for this slice: it verifies readiness/status and returns a JSON-safe `.eforge/session-plans/<session>.md` source path plus compatibility command text. Do not call the daemon enqueue route from the extension action in this plan. If a future implementation adds direct queueing, that action must declare `build-queue` side effects and update tests.
3. Normalize all action outputs through a shared JSON-safe projection helper that strips `undefined`, rejects non-JSON values before return, preserves ordinary object keys, and never returns root `undefined`.
4. Keep workstation browser code inside `workstation-assets/` and avoid imports from `packages/console-ui/src`, `@/`, or any parent-Console module path.

## Scope

### In Scope

- Add extension actions for planning artifact list, flat session-plan show/create/section edit/dimension selection/readiness/set-ready/metadata update/handoff, and session plan-set show.
- Keep existing backlog board, capture, update, promotion, render, integration command, deep-link, and lifecycle-hook behavior available.
- Replace `board-workstation` `srcDoc` registration with a planning workstation `frameBundle` registration and a complete `allowedActions` list.
- Add workstation browser assets that browse board/artifact data, show selected flat plans and plan sets, create/edit session plans, run readiness checks, set ready status, and perform source-path handoff after confirmation.
- Add extension tests for registration, JSON-safe action output, session-plan adapter-backed mutations, plan-set detail projections, handoff fallback, and workstation asset boundary checks.
- Update `eforge/extensions/eforge-plan/README.md` so the full workstation UX is no longer described as deferred.

### Out of Scope

- No daemon/client route deletion or wire-contract change.
- No raw extension-owned HTTP routes.
- No direct parent-Console React/component/CSS imports.
- No extension-owned AI planning/chat runtime.
- No direct enqueue call from the handoff action in this slice.

## Files

### Create

- `eforge/extensions/eforge-plan/json-safe.ts` — shared projection/assertion helper for JSON-safe extension action outputs, replacing the local helper currently embedded in `index.ts`.
- `eforge/extensions/eforge-plan/board-actions.ts` — move/export board build, projection, and markdown rendering helpers so board actions and planning actions can share board view data without keeping those helpers in `index.ts`.
- `eforge/extensions/eforge-plan/session-plan-view-model.ts` — map adapter flat session-plan entries and plan-set entries into stable workstation artifact keys (`plan:<session>`, `plan-set:<planSetId>`) and detail view models with no `Map`, `undefined`, or raw parser internals.
- `eforge/extensions/eforge-plan/session-plan-metadata.ts` — small helper for metadata the adapter does not expose, such as updating `profile`, `agent_profile`, and `open_questions` through `loadSessionPlan()` / `writeSessionPlan()` from `@eforge-build/input`.
- `eforge/extensions/eforge-plan/session-plan-actions.ts` — define and export the new extension action specs and their handlers.
- `eforge/extensions/eforge-plan/workstation-assets/plans/index.js` — vanilla browser module for the planning workstation iframe; use `window.eforge.invokeAction` and no parent Console imports.
- `eforge/extensions/eforge-plan/workstation-assets/plans/style.css` — extension-owned workstation styles served through the frame-bundle asset route.
- `eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts` — action tests with temp projects containing backlog items, flat session plans, acceptance-criteria diagnostics, and session plan sets.
- `eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts` — static asset boundary tests for no private Console imports, bridge-only action invocation, and handoff confirmation.

### Modify

- `eforge/extensions/eforge-plan/index.ts` — register board actions from the extracted module, register all new planning actions, and replace the inline `srcDoc` workstation with the frame-bundle planning workstation.
- `eforge/extensions/eforge-plan/schema.ts` — add TypeBox schemas and static types for planning artifact list/show/create/update/readiness/handoff action inputs and outputs.
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` — update action counts/side effects, JSON-safe output assertions, allowed-action expectations, and workstation registration assertions.
- `test/eforge-plan-workstation.test.ts` — update the dogfood smoke test to assert a frame-bundle planning workstation instead of a board-only `srcDoc` workstation.
- `eforge/extensions/eforge-plan/README.md` — document the planning workstation capabilities, action list, trust model, frame-bundle asset model, source-path handoff, and compatibility-route boundary.

## Implementation Notes

- For flat plan show output, omit `sections` from the raw `SessionPlan` object or convert it into a plain `Record<string, string>`. The output must include frontmatter metadata, `body`, `readiness`, and `path`.
- For plan-set show output, mirror the existing monitor projection shape: `{ planSet: validation.summary, validation, dir, manifestPath, anchorContent? }`.
- For create/action input naming, map workstation-friendly fields to adapter fields: `planningType` → `planningType`, `planningDepth` → `planningDepth`, `agentProfile` → `agentProfile`. Do not use daemon wire snake_case inside extension action handlers unless the schema explicitly documents it.
- For readiness failures, return a structured JSON-safe result such as `{ kind: 'not-ready', session, readiness, message }` and leave the file unmodified. Tests must verify the file status remains unchanged. Avoid handler exceptions for expected not-ready outcomes because the action runtime hides handler error details from the iframe.
- For handoff fallback, return `{ kind: 'source-path', session, sourcePath, absolutePath, command, readiness }` after verifying readiness and `status: ready`. Use a relative source path with forward slashes for the command. Do not mark the plan `submitted` in this fallback flow.
- The workstation asset can use simple DOM rendering. It does not need React, a bundler, or private Console styles.
- Add a visible confirmation step before invoking `handoff-session-plan`; `window.confirm()` is sufficient for this slice.

## Database Migration

None.

## Verification

- [ ] `eforge-plan` registers a single Console workstation with `frameBundle.root === 'workstation-assets/plans'`, `entrypoint === 'index.js'`, and no `srcDoc` field.
- [ ] The workstation `allowedActions` array contains `list-planning-artifacts`, `show-session-plan`, `show-session-plan-set`, `create-session-plan`, `set-session-plan-section`, `check-session-plan-readiness`, `set-session-plan-ready`, and `handoff-session-plan`.
- [ ] Dispatching `eforge-plan:list-board` for a fixture with backlog epics/items/traces returns `kind: success` and `collectUndefinedPaths(output)` returns `[]`.
- [ ] Dispatching `eforge-plan:list-planning-artifacts` for a fixture with backlog items, one flat session plan, and one plan set returns artifact keys `plan:<session>` and `plan-set:<planSetId>` with no `undefined` values.
- [ ] `show-session-plan` output contains the fixture plan `body`, frontmatter fields, readiness detail, and absolute `path`.
- [ ] `show-session-plan-set` output contains manifest summary, validation detail, anchor summary/content when present, and child summary metadata.
- [ ] `create-session-plan` writes `.eforge/session-plans/<session>.md` using the existing session-plan format.
- [ ] `set-session-plan-section` leaves exactly one `## <Dimension>` section in the target file after replacing duplicate headings.
- [ ] Readiness tests cover acceptance-criteria grouping labels, bare command fragments, vague criteria, and manual-only criteria.
- [ ] `set-session-plan-ready` leaves status unchanged and returns `kind: 'not-ready'` for a non-ready fixture.
- [ ] `set-session-plan-ready` writes `status: ready` for a fixture whose required dimensions are covered and whose acceptance criteria pass diagnostics.
- [ ] `handoff-session-plan` leaves a non-ready fixture unchanged and returns a not-ready result.
- [ ] `handoff-session-plan` returns `kind: 'source-path'`, a `.eforge/session-plans/<session>.md` source path, and JSON-safe output for a ready fixture.
- [ ] `workstation-assets/plans/index.js` contains no `packages/console-ui/src`, `@/`, or private Console module alias import.
- [ ] `workstation-assets/plans/index.js` invokes actions through `window.eforge.invokeAction` and contains an explicit confirmation before handoff.
- [ ] `pnpm test -- eforge/extensions/eforge-plan/__tests__/registration.test.ts eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts test/eforge-plan-workstation.test.ts` exits 0.
