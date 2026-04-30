---
id: plan-02-daemon-http-and-mcp-tool
name: Daemon HTTP routes, client helpers, and MCP tool registration
branch: eforge-playbooks/daemon-and-client
---

# Daemon HTTP routes, client helpers, and MCP tool registration

## Architecture Context

All consumer surfaces (CLI, skills, MCP, monitor UI) talk to the daemon over HTTP via the typed helpers in `packages/client/src/api/`. Routes are constants in `packages/client/src/routes.ts`; the daemon dispatches on `API_ROUTES` in `packages/monitor/src/server.ts`. Versioning is centralized in `packages/client/src/api-version.ts` (currently `DAEMON_API_VERSION = 12`). MCP tools are registered imperatively via `pi.registerTool({ name: 'eforge_<thing>', ... })` in `packages/pi-eforge/extensions/eforge/index.ts` and via the Claude Code plugin's MCP proxy.

This plan adds the playbook HTTP surface, the typed client helpers that wrap it, and the `eforge_playbook` MCP tool used by the slash-command skills in plan-04.

## Implementation

### Overview

1. **Routes** (`packages/client/src/routes.ts`) — add to `API_ROUTES`:
   - `playbookList`: `GET /api/playbook/list` — returns the merged list with source labels and shadow chains (delegates to `listPlaybooks`).
   - `playbookShow`: `GET /api/playbook/show?name=<name>` — returns frontmatter + body + source + shadow chain for a single playbook (delegates to `loadPlaybook`).
   - `playbookSave`: `POST /api/playbook/save` — body `{ scope, playbook: { frontmatter, body } }`. Validates via `validatePlaybook`, writes to the tier matching `scope` via `writePlaybook`. Used by the Create and Edit branches of the skill.
   - `playbookEnqueue`: `POST /api/playbook/enqueue` — body `{ name, afterQueueId?: string }`. Loads the playbook, calls `playbookToSessionPlan`, writes a PRD to the queue with `dependsOn: [afterQueueId]` set when provided. Returns the new queue id.
   - `playbookPromote`: `POST /api/playbook/promote` — body `{ name }`. Moves from `.eforge/playbooks/<name>.md` to `eforge/playbooks/<name>.md` via `movePlaybook` (uses `git mv` when applicable) and returns the new path so the caller can stage it.
   - `playbookDemote`: `POST /api/playbook/demote` — reverse of promote.
   - `playbookValidate`: `POST /api/playbook/validate` — body `{ raw: string }`. Returns `validatePlaybook` result. Used by skills before save and by `eforge playbook edit` round-trips.
2. **Bump `DAEMON_API_VERSION`** in `packages/client/src/api-version.ts` from `12` → `13`. Add a release note comment describing the new playbook routes (the file already documents version-bump rationale comments).
3. **Typed client helpers** in `packages/client/src/api/playbook.ts`:
   - `apiPlaybookList(opts: { cwd })`, `apiPlaybookShow(opts: { cwd, name })`, `apiPlaybookSave`, `apiPlaybookEnqueue`, `apiPlaybookPromote`, `apiPlaybookDemote`, `apiPlaybookValidate`.
   - Each uses `daemonRequest<T>(cwd, method, path, body)` consistent with `apiValidateConfig` (`packages/client/src/api/config.ts:17`).
   - Response types: `PlaybookListResponse`, `PlaybookShowResponse`, etc., mirroring the engine return shapes.
4. **Re-exports** from `packages/client/src/index.ts` so consumers import via `@eforge-build/client`.
5. **Daemon route handlers** in `packages/monitor/src/server.ts` — add handler blocks following the pattern at lines 1085, 1129, 1178, 1210 (the existing profile routes). Each handler:
   - Parses query string or JSON body.
   - Calls the appropriate engine API (`listPlaybooks`, `loadPlaybook`, `writePlaybook`, etc.).
   - On `apiPlaybookEnqueue`: writes the new PRD to the queue dir via the existing PRD-queue write path (mirrors `eforge enqueue` semantics) and returns the queue entry's id, including `dependsOn` when provided. The actual upstream-completion firing is plan-05; here we only persist `dependsOn`.
   - Returns JSON with consistent error shape (`{ error: string, details?: any }`) on failure; mirrors profile route error handling.
6. **MCP tool registration** in `packages/pi-eforge/extensions/eforge/index.ts`:
   - Register `eforge_playbook` via `pi.registerTool({ name: 'eforge_playbook', label: 'eforge playbook', description: '...', parameters: Type.Object({ action: StringEnum(['list','show','save','enqueue','promote','demote','validate']), ...action-specific fields }), handler })`.
   - Handler dispatches by `action` and calls the corresponding `apiPlaybook*` client helper. Mirrors `eforge_profile` (`index.ts:~601`).
7. **Claude Code plugin MCP proxy** — register `eforge_playbook` in the plugin's MCP server registration so the Claude Code slash-command skill (plan-04) can invoke it. Locate the existing registration site (where `eforge_config`, `eforge_profile` are wired) and add `eforge_playbook` alongside.

### Key Decisions

1. **Validate before save, always.** `apiPlaybookSave` calls `validatePlaybook` server-side regardless of what the client did, so any bypass (cURL, scripts) cannot persist invalid playbooks.
2. **Persist `dependsOn`, do not schedule yet.** This plan stores the relationship; plan-05 implements the dispatcher that fires downstream PRDs on upstream completion. Splitting the work this way keeps Phase 1 shippable on its own (the resulting playbook PRD just enqueues normally and runs when its turn comes up — only piggyback semantics are deferred).
3. **Bump `DAEMON_API_VERSION` to 13.** Per the AGENTS.md rule, any new HTTP surface bumps the version so older clients fail fast against newer daemons.
4. **Single MCP tool with `action` discriminator.** Matches the existing `eforge_profile` pattern; one tool per surface area, dispatched by `action`. Keeps the tool inventory tractable for both Pi and Claude Code MCP consumers.

## Scope

### In Scope
- Seven new HTTP routes (`list`, `show`, `save`, `enqueue`, `promote`, `demote`, `validate`).
- Typed client helpers for each route.
- Daemon route handlers wired to engine APIs from plan-01.
- `eforge_playbook` MCP tool registration in Pi and Claude Code plugin.
- `DAEMON_API_VERSION` bump from 12 → 13.
- Integration tests covering happy-path round trips for each route.

### Out of Scope
- Upstream-completion-driven scheduling of `dependsOn` (plan-05).
- CLI commands (plan-03).
- Skill files (plan-04).
- Queue-list UI nesting (plan-05).

## Files

### Create
- `packages/client/src/api/playbook.ts` — typed helpers `apiPlaybookList`, `apiPlaybookShow`, `apiPlaybookSave`, `apiPlaybookEnqueue`, `apiPlaybookPromote`, `apiPlaybookDemote`, `apiPlaybookValidate` with response types.
- `test/playbook-api.test.ts` — drives the daemon in-process (matches existing profile-route test pattern) and asserts each route's status code, response shape, and engine-side persistence (file written, queue entry created with correct `dependsOn`).

### Modify
- `packages/client/src/routes.ts` — add seven `playbook*` constants to `API_ROUTES`.
- `packages/client/src/api-version.ts` — bump to `13` with release note comment.
- `packages/client/src/index.ts` — re-export new helpers and types.
- `packages/monitor/src/server.ts` — add handler blocks for each playbook route, following the profile-route pattern.
- `packages/pi-eforge/extensions/eforge/index.ts` — register `eforge_playbook` MCP tool with handler that dispatches by `action`.
- Claude Code plugin MCP registration file (locate where `eforge_config` and `eforge_profile` are registered in `eforge-plugin/`) — add `eforge_playbook`.

## Verification

- [ ] `pnpm type-check` passes after route additions.
- [ ] `pnpm test` passes; `test/playbook-api.test.ts` exercises all seven routes.
- [ ] `apiPlaybookSave` rejects invalid playbooks (missing required frontmatter or `## Goal`) with HTTP 400 and an `errors` array.
- [ ] `apiPlaybookList` returns entries with `source` and `shadows` fields populated when the test creates files at multiple tiers.
- [ ] `apiPlaybookEnqueue` with `afterQueueId` set persists the resulting PRD frontmatter with `dependsOn: [<id>]`; the PRD is visible in `eforge queue list`.
- [ ] `apiPlaybookPromote` moves `.eforge/playbooks/<name>.md` to `eforge/playbooks/<name>.md` and returns the new path; `apiPlaybookDemote` reverses it.
- [ ] `DAEMON_API_VERSION` is `13`; older client versions fail their handshake against the new daemon.
- [ ] `eforge_playbook` MCP tool is callable via the Pi extension and the Claude Code plugin's MCP surface; each `action` value dispatches to the correct client helper.
