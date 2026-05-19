---
id: plan-02-wire-surface-and-mode-dispatch
name: Daemon route rename, mode dispatch, MCP/Pi/CLI surface, and api-version bump
branch: add-mode-autonomous-planning-to-playbooks-bundle-first-planning-mode-playbook-complexity-hotspot-reduction/plan-02-wire-surface-and-mode-dispatch
agents:
  builder:
    effort: high
    rationale: "Discriminated union response wired through six surfaces (HTTP route,
      client helper, MCP tool, Pi tool, CLI subcommand, tests) in one atomic
      change. Each surface must agree on the same `kind: 'enqueued' |
      'planning'` shape, the new `'run'` action enum, the renamed route literal,
      and the new `create-from-playbook` action. High effort buys careful
      coordination."
  reviewer:
    effort: high
    rationale: Wire-version breaking change; reviewer needs to confirm route
      literal, MCP action enum, Pi parity, CLI text output, version bump, and
      that the old `enqueue` literal is gone from all consumer surfaces.
---

# Daemon route rename, mode dispatch, MCP/Pi/CLI surface, and api-version bump

## Architecture Context

plan-01 added the `mode` field and the seed helpers. This plan rewires the daemon HTTP surface, every typed client, the two MCP tool surfaces (`packages/eforge/src/cli/mcp-proxy.ts` and the Pi mirror at `packages/pi-eforge/extensions/eforge/index.ts`), and the `eforge playbook run` / `eforge play` CLI to:

1. Rename `POST /api/playbook/enqueue` → `POST /api/playbook/run`. The handler now dispatches by `playbook.mode`: `'autonomous'` keeps the existing enqueue path; `'planning'` calls `createSessionPlanFromPlaybookSeed` and writes the file to `.eforge/session-plans/<session>.md`.
2. Add `POST /api/session-plan/create-from-playbook` that takes a `playbook_name` (plus optional `session`/`topic`/`scope`) and runs the same planning-mode seed flow as a standalone action — useful when the plan skill wants to seed without going through `playbook/run`.
3. Return a discriminated union from `playbook/run`: `{ kind: 'enqueued'; id: string } | { kind: 'planning'; session: string; path: string }`. The old route returns 404 (no alias).
4. Rename the MCP `eforge_playbook.action` enum value `'enqueue'` → `'run'`. Add `mode` to the nested `playbook.frontmatter` schema. Add `'create-from-playbook'` as a tenth action on `eforge_session_plan`. Mirror across the Pi extension.
5. Update the CLI's `runAction` (in `packages/eforge/src/cli/playbook.ts`) to branch on the discriminator and print mode-specific next-step text.
6. Bump `DAEMON_API_VERSION` and update the version-history comment.

Per the source's `no-backward-compat` rule, no aliases are kept. The version bump triggers the standard version-mismatch UX for any stale plugin client.

## Implementation

### Overview

1. **Routes & wire types** (`packages/client/src/routes.ts`):
   - Rename `API_ROUTES.playbookEnqueue` → `API_ROUTES.playbookRun`. Path: `'/api/playbook/run'`.
   - Add `API_ROUTES.sessionPlanCreateFromPlaybook` = `'/api/session-plan/create-from-playbook'`.
   - Add `PlaybookRunRequest` (`{ name: string; afterQueueId?: string; session?: string; topic?: string }`) and `PlaybookRunResponse` (discriminated union).
   - Add `SessionPlanCreateFromPlaybookRequest` / `SessionPlanCreateFromPlaybookResponse`.
2. **API version** (`packages/client/src/api-version.ts`): increment `DAEMON_API_VERSION` and prepend a new version-history entry to the comment block summarizing the breaking changes.
3. **Client helpers** (`packages/client/src/api/playbook.ts`, `packages/client/src/api/session-plan.ts`):
   - Rename `apiPlaybookEnqueue` → `apiPlaybookRun` and `apiPlaybookEnqueueIfRunning` → `apiPlaybookRunIfRunning`. Return type changes to `PlaybookRunResponse`.
   - Delete the old `PlaybookEnqueueResponse` interface.
   - Add `apiSessionPlanCreateFromPlaybook` and the `*IfRunning` variant.
4. **Daemon handler** (`packages/monitor/src/server.ts`):
   - Replace the existing block matching `API_ROUTES.playbookEnqueue` (starts around line 3323) with a block matching `API_ROUTES.playbookRun`. Dispatch on `playbook.mode`:
     - `'autonomous'`: existing flow — `playbookToBuildSource` → `enqueuePrd` → `commitEnqueuedPrd` → emit `notifyQueueMutation` → respond `{ kind: 'enqueued', id }`.
     - `'planning'`: call `createSessionPlanFromPlaybookSeed` (with the request body's optional `session`/`topic` overrides, or generated defaults), then `writeSessionPlan({ cwd, plan, session })`. Respond `{ kind: 'planning', session, path }`. Do NOT call `notifyQueueMutation`.
   - Add a handler block for `API_ROUTES.sessionPlanCreateFromPlaybook`. It loads the named playbook, rejects 400 if `mode !== 'planning'` with a message pointing to `playbook/run` for the autonomous flow, rejects 409 if the resolved session id already exists on disk, and writes the seeded session plan atomically.
5. **MCP tool** (`packages/eforge/src/cli/mcp-proxy.ts`, lines 1066-1140):
   - In `eforge_playbook`: change the `action` enum element `'enqueue'` → `'run'`; add `mode: z.enum(['autonomous','planning'])` to the nested `playbook.frontmatter` schema (line 1078-1085); update the tool description string accordingly; rename the `if (action === 'enqueue')` branch and switch to `API_ROUTES.playbookRun`.
   - In `eforge_session_plan`: add `'create-from-playbook'` to the `action` enum; add `playbook_name: z.string().optional()` parameter; route the new action to `API_ROUTES.sessionPlanCreateFromPlaybook` via `daemonRequest`.
6. **Pi extension** (`packages/pi-eforge/extensions/eforge/index.ts`, lines 2095-2247 and the `eforge_session_plan` block immediately following):
   - Mirror every MCP change: TypeBox enum updates, `mode` field on the frontmatter sub-schema, `playbook_name` parameter, new `create-from-playbook` action handler, updated description strings.
   - Update the existing `renderResult` block to recognize the `{ kind: 'enqueued' | 'planning' }` discriminated response and print mode-specific result lines.
7. **CLI** (`packages/eforge/src/cli/playbook.ts`):
   - Update imports: drop `apiPlaybookEnqueue` / `PlaybookData`-unrelated bits, add `apiPlaybookRun`.
   - `runAction(name, options)`: replace the body so it calls `apiPlaybookRun`, switches on `data.kind`:
     - `'enqueued'`: print `console.log(chalk.green('✔') + ` Enqueued: ${data.id}`)`.
     - `'planning'`: print `console.log(chalk.green('✔') + ` Planning session ready: ${data.path}`)` and on the next line `console.log(chalk.dim(`  Open with /eforge:plan to continue.`))`.
   - The command registration for `playbook run <name>` and the `play <name>` alias do not change.
8. **Tests**:
   - `test/playbook-api.test.ts`: add cases for both branches of the discriminated response; confirm the old `/api/playbook/enqueue` path returns 404; confirm `apiPlaybookRun` returns `{ kind: 'enqueued', id }` for an autonomous playbook and `{ kind: 'planning', session, path }` for a planning playbook (write a temp playbook with `mode: planning` via the daemon's filesystem-fixture pattern already used in this file).
   - `test/daemon-session-plan-routes.test.ts`: add cases for `POST /api/session-plan/create-from-playbook` — success path populates `seeded_from_playbook` and the expected headings; 400 when the named playbook is autonomous; 409 when the target session id already exists; rejects path-traversal in `session` per the existing `resolveSessionPlanPath` guard.
   - `test/cli-playbook.test.ts`: extend to assert mode-specific stdout for both branches. Follow the existing test pattern (the file currently invokes the CLI binary against a temporary daemon fixture).

### Key Decisions

1. **Atomic surface swap.** All six surfaces (route, client, MCP, Pi, CLI, tests) ship in one plan because removing the alias / renaming the action would leave any single missed surface failing to compile or to find the route.
2. **Discriminated response shape.** `{ kind: 'enqueued'; id } | { kind: 'planning'; session; path }`. Every consumer must branch on `kind`. No flat shape with optional fields — the discriminator forces handling per source D3.
3. **Planning-mode response is filesystem-only.** No queue mutation, no engine event. The plan file is the artifact. The plan skill picks it up via `eforge_session_plan { action: 'show' }` afterward.
4. **`session` and `topic` are optional in the request body.** When omitted, the handler generates them deterministically: `session = '${YYYY-MM-DD}-${playbook.name}'`; `topic = playbook.description`. Conflict (409) on session collision so we never overwrite an existing planning conversation.
5. **`create-from-playbook` is a separate route, not an action overload.** Keeps `playbook/run` shape clean (always loads the playbook, branches on its mode) and lets the plan skill seed without implying a build will be enqueued.
6. **Wire-version bump captures everything.** A single `DAEMON_API_VERSION` increment covers the route rename, the new route, the discriminated response, and the new MCP/Pi actions. Any stale client triggers the existing version-mismatch UX.

## Scope

### In Scope
- All changes listed above across `packages/client/`, `packages/monitor/`, `packages/eforge/`, `packages/pi-eforge/`.
- API-level and CLI-level tests for both mode branches and the new seed route.
- `DAEMON_API_VERSION` bump and version-history comment.

### Out of Scope
- Skill markdown (`eforge-plugin/skills/playbook/playbook.md`, `eforge-plugin/skills/plan/plan.md`) — moves in plan-03.
- Plugin version bump (`eforge-plugin/.claude-plugin/plugin.json`) — plan-03.
- New complexity playbook and measurement tooling — plan-03.
- Migration tooling for out-of-tree playbooks lacking `mode` — explicitly not provided.
- Surfacing `agentRuntime` divergence — pre-existing, out of scope.
- Per-route deprecation period for `playbook/enqueue` — explicitly not provided.

## Files

### Modify
- `packages/client/src/routes.ts` — rename `playbookEnqueue` → `playbookRun` (line 168), add `sessionPlanCreateFromPlaybook` entry near the existing session-plan routes (line 173-181), add `PlaybookRunRequest`, `PlaybookRunResponse` (discriminated union), `SessionPlanCreateFromPlaybookRequest`, `SessionPlanCreateFromPlaybookResponse` interfaces. Delete the now-unused `PlaybookEnqueueResponse` interface if it migrates here from `api/playbook.ts`.
- `packages/client/src/api-version.ts` — increment `DAEMON_API_VERSION`. Prepend a new version-history entry to the inline comment summarizing: route rename `playbookEnqueue` → `playbookRun`; new route `sessionPlanCreateFromPlaybook`; discriminated `PlaybookRunResponse`; new playbook-frontmatter required field `mode`; new MCP action `'run'` (replaces `'enqueue'`); new MCP action `'create-from-playbook'` on session-plan tool.
- `packages/client/src/api/playbook.ts` — rename `apiPlaybookEnqueue` → `apiPlaybookRun`, return `PlaybookRunResponse`. Rename `apiPlaybookEnqueueIfRunning` → `apiPlaybookRunIfRunning`. Delete the `PlaybookEnqueueResponse` interface (the route file owns the new union type).
- `packages/client/src/api/session-plan.ts` — add `apiSessionPlanCreateFromPlaybook` and `apiSessionPlanCreateFromPlaybookIfRunning`. Re-export `SessionPlanCreateFromPlaybookRequest`/`SessionPlanCreateFromPlaybookResponse` per the existing pattern.
- `packages/monitor/src/server.ts` — replace the handler block at line 3323 (`API_ROUTES.playbookEnqueue`) with a block matching `API_ROUTES.playbookRun` that dispatches on `playbook.mode`. Add a new handler block immediately after for `API_ROUTES.sessionPlanCreateFromPlaybook`. The new handler validates the playbook name regex (the existing `PLAYBOOK_NAME_RE`), loads the playbook, rejects 400 on autonomous mode, generates or validates the session id, calls `createSessionPlanFromPlaybookSeed` + `writeSessionPlan`, and responds `{ session, path }`. Handle the 409 collision case by checking for an existing file via `resolveSessionPlanPath` + `fs.access` before writing.
- `packages/eforge/src/cli/mcp-proxy.ts` — line 1066-1140: action enum, schema, description, and handler updates as described above. Line 1146-1247: extend `eforge_session_plan` with `create-from-playbook` action, the `playbook_name` parameter, and the handler branch.
- `packages/pi-eforge/extensions/eforge/index.ts` — lines 2095-2247 and the session-plan tool block immediately following: TypeBox-equivalent updates that match the MCP tool exactly. Update the existing playbook tool's `renderResult` to recognize and pretty-print both `{ kind: 'enqueued' }` and `{ kind: 'planning' }` discriminated responses.
- `packages/eforge/src/cli/playbook.ts` — rewrite the `runAction` function (lines ~104-121) per the discriminated-response branch logic. Update imports on line 11-21 (`apiPlaybookEnqueue` → `apiPlaybookRun`).
- `test/playbook-api.test.ts` — extend with the autonomous-vs-planning discriminated-response cases and the old-route-404 case. The file already uses fs-mkdtemp-style daemon fixtures; follow the same pattern (per source R7).
- `test/daemon-session-plan-routes.test.ts` — extend with `create-from-playbook` cases (success, 400 on autonomous, 409 on duplicate, 400 on traversal).
- `test/cli-playbook.test.ts` — extend with mode-specific stdout assertions.

## Verification

- [ ] `pnpm type-check` passes across all workspaces. Verifies the discriminated union flows through every consumer.
- [ ] `pnpm test` passes; the new tests in `test/playbook-api.test.ts`, `test/daemon-session-plan-routes.test.ts`, and `test/cli-playbook.test.ts` are present and green.
- [ ] `grep -rn 'playbookEnqueue\|/api/playbook/enqueue\|apiPlaybookEnqueue\|PlaybookEnqueueResponse' packages/ test/` returns zero hits.
- [ ] `grep -rn "'enqueue'" packages/eforge/src/cli/mcp-proxy.ts packages/pi-eforge/extensions/eforge/index.ts` returns zero hits within the playbook tool's action enum (other unrelated uses of the word are fine).
- [ ] The `DAEMON_API_VERSION` constant increments by exactly one and the version-history comment block grows by exactly one new entry whose body mentions the route rename, the new route, the new MCP action `'run'`, and the new MCP action `'create-from-playbook'`.
- [ ] An integration test boots the daemon, posts to `/api/playbook/enqueue`, and asserts the response is HTTP 404.
- [ ] An integration test boots the daemon, posts to `/api/playbook/run` with a planning-mode playbook in the fixture, and asserts the response body has `kind === 'planning'`, `session` is a non-empty string, and the file at `data.path` exists on disk and contains `seeded_from_playbook:` in its frontmatter.
- [ ] An integration test posts to `/api/playbook/run` with the bundled `docs-implementation-sync` playbook and asserts `kind === 'enqueued'`, `id` is a non-empty string, and the queue gains a new PRD file.
- [ ] A CLI test invokes `eforge playbook run <autonomous-playbook>` against the fixture daemon and asserts stdout contains `Enqueued:` and the queue id.
- [ ] A CLI test invokes `eforge playbook run <planning-playbook>` and asserts stdout contains `Planning session ready:` followed by a session-plan file path under `.eforge/session-plans/`.
- [ ] An integration test posts to `/api/session-plan/create-from-playbook` with `playbook_name` of an autonomous playbook and asserts the response is HTTP 400 with a body whose error message mentions `playbook/run`.
