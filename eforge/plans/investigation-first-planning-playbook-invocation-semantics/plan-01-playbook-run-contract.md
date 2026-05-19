---
id: plan-01-playbook-run-contract
name: Playbook Run Requires-Agent Contract
branch: investigation-first-planning-playbook-invocation-semantics/plan-01-playbook-run-contract
agents:
  builder:
    effort: high
    rationale: This plan changes a shared daemon response union and all first-party
      code consumers in one worktree, so the builder needs extra care around
      TypeScript exhaustiveness and route tests.
  reviewer:
    effort: high
    rationale: The review must verify API contract, client handling, and absence of
      static session-plan creation from the playbook run route.
---

# Playbook Run Requires-Agent Contract

## Architecture Context

Planning playbook execution belongs at the wrapper/client skill boundary, not inside the engine or daemon build pipeline. The daemon remains responsible for validating/loading playbooks, enqueueing autonomous playbooks, and serving typed HTTP responses. Planning-mode playbooks are valid artifacts, but `POST /api/playbook/run` is not their executor: it must return a typed `requires-agent` result so first-party clients can hand control to an interactive agent.

This plan updates the shared contract and all TypeScript consumers together so the repository type-checks after the route union changes.

## Implementation

### Overview

Replace the planning-mode `POST /api/playbook/run` behavior from static session-plan creation to a typed `requires-agent` response, expose playbook `mode` in list/show client surfaces, and update CLI, MCP, Pi tools, and route tests to handle the new response.

### Key Decisions

1. `POST /api/playbook/run` returns HTTP 200 with `{ kind: "requires-agent", mode: "planning", name, message }` for planning playbooks. The request is valid, so this is a typed non-error result rather than a 400.
2. `PlaybookRunResponse` becomes the discriminated union of `enqueued | requires-agent`. Remove `planning` from the route union unless an internal compatibility type is needed outside the union.
3. Keep `POST /api/session-plan/create-from-playbook` unchanged as a static seed/template route in this plan. First-party skills stop using it in plan 02.
4. Add `mode` to list entries and client show/save types so native clients can branch before calling `run`.
5. Bump `DAEMON_API_VERSION` and update the version assertion test because the daemon wire response union changes.

## Scope

### In Scope

- Change `POST /api/playbook/run` planning-mode branch to return `requires-agent` without writing `.eforge/session-plans/*.md` and without enqueueing.
- Preserve autonomous playbook enqueue behavior, including `afterQueueId` dependency validation and waiting queue behavior.
- Add `mode` to `PlaybookEntry`, `PlaybookListEntry`, `PlaybookData`, and `PlaybookFrontmatterFields` client-visible types.
- Update first-party TypeScript consumers of `PlaybookRunResponse` to handle `requires-agent` explicitly.
- Update Pi native `/eforge:playbook run` to delegate selected planning playbooks to `/skill:eforge-playbook run <name>` before queue dependency prompts.
- Update CLI/MCP/Pi tool descriptions and renderers for the new response.
- Update tests for route responses, no session-plan creation, list/show mode exposure, CLI output, and API version.

### Out of Scope

- Daemon-side exploration-agent orchestration.
- Removing `POST /api/session-plan/create-from-playbook`.
- Changing autonomous queue behavior, playbook storage scopes, or shadow precedence.
- Updating skill workflow prose and user documentation; plan 02 owns those changes.
- Bumping `packages/pi-eforge/package.json`.

## Files

### Create

None.

### Modify

- `packages/input/src/playbook.ts` — add `mode` to `PlaybookEntry`; populate it from valid frontmatter in `listPlaybooks`; keep unreadable/invalid entries resilient with a safe default only if needed to preserve existing listing behavior; update comments that describe planning-mode static seeding.
- `packages/client/src/routes.ts` — replace/add route response interface `PlaybookRunRequiresAgentResponse` with `kind`, `mode`, `name`, and `message`; update `PlaybookRunResponse` union.
- `packages/client/src/api/playbook.ts` — add `mode` to list/show/save client types via a shared `PlaybookMode` type; update request body types where needed.
- `packages/client/src/index.ts` — export `PlaybookRunRequiresAgentResponse` instead of the old planning response type.
- `packages/client/src/api-version.ts` — bump `DAEMON_API_VERSION` from 33 to 34 and prepend a v34 comment describing the `requires-agent` route union and list/show mode exposure.
- `packages/monitor/src/server.ts` — in `POST /api/playbook/run`, remove the planning branch that calls `createSessionPlanFromPlaybookSeed`, `resolveSessionPlanPath`, and `writeSessionPlan`; return the typed `requires-agent` payload. Leave `POST /api/session-plan/create-from-playbook` behavior in place.
- `packages/pi-eforge/extensions/eforge/playbook-commands.ts` — branch on selected playbook `mode`; for `planning`, send `/skill:eforge-playbook run <name>` and return before active-build dependency selection; add defensive `requires-agent` handling if the daemon route is still called.
- `packages/pi-eforge/extensions/eforge/index.ts` — update `eforge_playbook` tool description and renderer for `requires-agent`; reword `eforge_session_plan` `create-from-playbook` text as static template/scratch creation if retained.
- `packages/eforge/src/cli/playbook.ts` — render `requires-agent` with guidance to use an interactive agent command; update command descriptions; include/preserve `mode` in playbook raw reconstruction and save callers after client type changes.
- `packages/eforge/src/cli/mcp-proxy.ts` — update tool descriptions and return handling expectations for `requires-agent`; reword `create-from-playbook` as static template/scratch creation.
- `packages/eforge/src/cli/display.ts` — if playbook list output is adjusted, include mode without removing source/shadow information.
- `test/playbook.test.ts` — assert `listPlaybooks` entries include `mode` for autonomous and planning playbooks.
- `test/playbook-api.test.ts` — assert list/show mode exposure; assert autonomous run still returns `enqueued`; assert planning run returns `requires-agent`, does not write a session plan, and does not enqueue or wake auto-build.
- `test/daemon-session-plan-routes.test.ts` — keep static `create-from-playbook` tests passing and reword expectations/comments to describe it as static template seeding.
- `test/session-plan-from-playbook.test.ts` — keep mechanical seed helper coverage and update wording if assertions describe it as running a playbook.
- `test/cli-playbook.test.ts` — replace planning response output expectations with `requires-agent` guidance; update CLI save/edit scaffolding tests if `mode` is required in client save types.
- `test/daemon-recovery.test.ts` — update the API version assertion and version comment to 34.

## Verification

- [ ] `POST /api/playbook/run` with an autonomous playbook returns status 200 and JSON `{ kind: "enqueued", id: <non-empty string> }`.
- [ ] `POST /api/playbook/run` with a planning playbook returns status 200 and JSON `{ kind: "requires-agent", mode: "planning", name: <playbook name>, message: <non-empty string> }`.
- [ ] The planning-mode run route leaves `.eforge/session-plans/` absent or unchanged and does not create a queue PRD.
- [ ] `GET /api/playbook/list` entries contain `mode` for autonomous and planning playbooks.
- [ ] `GET /api/playbook/show` returns `playbook.mode`.
- [ ] Pi native run delegates a planning-mode selected playbook to `/skill:eforge-playbook run <name>` before offering wait-for-build choices.
- [ ] CLI and Pi/MCP tool renderers display `requires-agent` without saying a planning session file was created.
- [ ] `DAEMON_API_VERSION` is 34 and the version assertion test passes.
- [ ] `pnpm type-check` passes after all `PlaybookRunResponse` consumers handle the new union member.
