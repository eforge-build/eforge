---
title: Backend profile overhaul: init writes profiles, not config.yaml
created: 2026-04-17
depends_on: ["opus-4-7-support-planner-driven-per-plan-effort-thinking"]
---

# Backend profile overhaul: init writes profiles, not config.yaml

## Problem / Motivation

The recent split of backend config into two scopes - `eforge/config.yaml` (team-wide, committed) and `eforge/backends/*.yaml` (named profiles, selectable via `/eforge:backend`) - left the init flow in a broken halfway state. `eforge_init` still writes `backend: <kind>` directly into `config.yaml`, and `resolveActiveProfileName` still falls back to that field as a "team default profile." This is a type conflation: `backend:` in `config.yaml` is typed as the backend kind (`claude-sdk|pi`) but is then looked up as a profile filename, so the fallback only works when someone happens to name a profile `claude-sdk` or `pi`. The result is confusing behavior and a schema that mixes concerns.

Additionally, Pi extension users have no persistent visibility into which backend profile is active - there is no footer status indicator.

## Goal

Init should create a real named backend profile in `eforge/backends/` and activate it via marker instead of writing `backend:` into `config.yaml`. The `config.yaml` schema should stop accepting a top-level `backend:` field entirely. Pi extension should surface the active backend in its footer status.

## Approach

### 1. Schema changes (`packages/engine/src/config.ts`)

- Remove `backend: backendSchema` from `eforgeConfigBaseSchema` (line 129). It remains in the partial profile schema so profile files still require/accept it.
- Update `parseRawConfig` (around lines 462-468): drop the top-level `backend:` branch so it no longer hydrates `config.yaml` with a `backend` field. Keep profile-level parsing untouched.
- Update `resolveActiveProfileName` (lines 772-831): delete steps 2 and 4 (the `projectConfig.backend` / `userConfig.backend` fallbacks). Resolution becomes: project marker → user marker → none. Simplify the stale-marker fallback to only consider user-marker.
- Drop the `ActiveProfileSource` variants `team` and `user-team` (and any downstream UI referencing them, e.g. `/api/backend/show` response rendering).
- Keep the `backend:` read branch at lines 906-912 in `listBackendProfiles` that reads from profile files - only remove reads of the top-level `config.yaml` `backend:`.

### 2. Init handler rewrite

Two handlers share the same rewrite - one per consumer.

**Files:**
- `packages/eforge/src/cli/mcp-proxy.ts` - `eforge_init` tool (lines 740-877)
- `packages/pi-eforge/extensions/eforge/index.ts` - the Pi `eforge_init` tool (mirror of the MCP one)

**New behavior:**
- Accept a new `migrate: boolean` parameter (driven by `/eforge:init --migrate`).
- Elicit from the user: backend kind (`claude-sdk` | `pi`), provider (pi only), and the `max`-class model id. Reuse `/api/models/providers` and `/api/models/list` endpoints already consumed by `/eforge:backend:new` (see `packages/eforge/src/cli/mcp-proxy.ts:634` for the `eforge_models` tool and `eforge-plugin/skills/backend-new/backend-new.md:36-69` for the pattern).
- Compute the profile name deterministically: `[backend[-provider]]-[sanitized-max-model-id]`. Examples: `claude-sdk-opus-4-7`, `pi-anthropic-opus-4-7`, `pi-zai-glm-4-6`. Sanitization: lowercase, replace `.` with `-`, strip the `claude-` prefix to shorten, collapse repeated dashes. Put the sanitizer in `packages/engine/src/config.ts` next to `createBackendProfile` so Pi and MCP share it.
- Call `createBackendProfile(configDir, { name, backend, pi, agents: { models: { max, balanced: max, fast: max } }, scope: 'project', overwrite: migrate })` - reuses the existing code path at `packages/engine/src/config.ts:1006-1101`.
- Call `setActiveBackend(configDir, name, { scope: 'project' })` - reuses `packages/engine/src/config.ts:944-996`. Writes `eforge/.active-backend`.
- Write `config.yaml` containing only non-backend fields (`build.postMergeCommands`, etc.). **Never emit `backend:`.**
- Ensure `.gitignore` contains `.eforge/` and `eforge/.active-backend` (existing `ensureGitignoreEntries` call).

**`--migrate` mode:**
- Require `eforge/config.yaml` to already exist; error otherwise with "nothing to migrate, run init without --migrate".
- Parse existing config with the old (pre-change) parser leniency - introduce a `parseRawConfigLegacy` in `config.ts` that tolerates a top-level `backend:` field and top-level `pi:` / `agents.models:` blocks.
- Derive the profile name from the extracted `backend`, the first provider seen in `agents.models.*.provider`, and the extracted `agents.models.max.id` (fall back to `agents.model.id`). Fail with a clear error if no max model is set.
- Run the same `createBackendProfile` + `setActiveBackend` calls.
- Rewrite `config.yaml` with the stripped content (drop `backend:`, drop `pi:` block entirely, drop `agents.models`, drop `agents.model`, drop `agents.effort`, drop `agents.thinking` - anything that belongs in a profile). Preserve everything else (`build`, `prdQueue`, `daemon`, `monitor`, `hooks`, `plan`, `plugins`, `maxConcurrentBuilds`, `langfuse`). Use YAML round-trip through the existing `parseYaml`/stringify path.
- Emit a summary of what moved into the profile.

### 3. Update init skills (wording + new flag)

**Files:**
- `eforge-plugin/skills/init/init.md`
- `packages/pi-eforge/skills/eforge-init/SKILL.md`

Changes:
- Replace "creates `eforge/config.yaml` with `backend:`" language with "creates a backend profile under `eforge/backends/` and activates it, plus writes `eforge/config.yaml` for team-wide settings".
- Add Step 1.5 between "postMergeCommands" and "call the tool": pick backend kind → pick provider (if pi) → pick `max` model. Mirror the pattern in `backend-new.md:36-69`.
- Document `--migrate`: when the project already has a pre-overhaul `config.yaml` with `backend:`, invoke with `migrate: true`. Describe what it does in two sentences.
- Update the closing message to mention the created profile name.

### 4. Pi extension footer status

**File:** `packages/pi-eforge/extensions/eforge/index.ts`

Pi's extension API exposes `ctx.ui.setStatus(key, text)` for persistent footer status (`node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/types.d.ts:67`). Example pattern: `node_modules/@mariozechner/pi-coding-agent/examples/extensions/status-line.ts`.

Implementation:
- Add `pi.on("session_start", async (_ev, ctx) => { await refreshStatus(ctx); })`.
- `refreshStatus(ctx)` calls `daemonRequest(ctx.cwd, 'GET', '/api/backend/show')` (already in `@eforge-build/client`), reads `{ name, source, backend }`, and calls `ctx.ui.setStatus("eforge", formatted)`. Format like `eforge: <name> (<backend>)`; when unresolved, `eforge: no active backend`.
- After the existing `eforge_backend` tool handler runs `action: "use"` or `action: "create"`, call `refreshStatus` against the last-known `ctx`. Stash the latest `ExtensionContext` from `session_start` in module scope and reuse it; if `ctx` is stale, the next `session_start` will correct.
- Swallow errors from `/api/backend/show` - footer status is best-effort; fall back to `ctx.ui.setStatus("eforge", undefined)` to clear.
- No dependency on daemon being up: `daemonRequest` auto-starts the daemon via the existing client flow; if that fails, clear the status.

### 5. Daemon HTTP types

**File:** `packages/client/src/types.ts` (and wherever `/api/backend/show` response is typed)

- Drop `team` and `user-team` from the `ActiveProfileSource` union.
- Bump `DAEMON_API_VERSION` in `packages/client/src/api-version.ts` - the response shape narrowed.

### 6. Tests

**File:** `test/config.test.ts` (or the nearest existing config-test file - scan `test/` for `resolveActiveProfileName` coverage).

- Remove tests that asserted `team` / `user-team` resolution.
- Add a test for the schema rejecting `backend:` at the top level of `config.yaml`.
- Add a test for the profile-name sanitizer.
- Add a test for `parseRawConfigLegacy` driving the migrate flow (input: a pre-overhaul config.yaml; assert the profile written + marker + remaining config.yaml).

### 7. Version bumps

- `eforge-plugin/.claude-plugin/plugin.json` - bump (already at 0.5.28).
- Do **not** bump `packages/pi-eforge/package.json` per AGENTS.md.

### Migration approach

**Hard break** - the schema stops accepting `backend:` at the top level of `config.yaml`. Existing projects run `/eforge:init --migrate` to convert.

### Critical files

- `packages/engine/src/config.ts` - schema, `resolveActiveProfileName`, `createBackendProfile`, `setActiveBackend`; add profile-name sanitizer and `parseRawConfigLegacy`.
- `packages/eforge/src/cli/mcp-proxy.ts` - `eforge_init` handler (lines 740-877).
- `packages/pi-eforge/extensions/eforge/index.ts` - Pi `eforge_init` handler + new `session_start` footer hook.
- `eforge-plugin/skills/init/init.md` and `packages/pi-eforge/skills/eforge-init/SKILL.md` - skill instructions.
- `packages/client/src/types.ts`, `packages/client/src/api-version.ts` - response types + version bump.
- `eforge-plugin/.claude-plugin/plugin.json` - version bump.
- `test/` - config + migrate coverage.

## Scope

**In scope:**
- Remove `backend:` field from the `config.yaml` schema entirely (hard break).
- Rewrite `eforge_init` in both MCP proxy and Pi extension to create a named backend profile and activate it instead of writing `backend:` into `config.yaml`.
- Add `--migrate` mode to `eforge_init` for converting pre-overhaul projects.
- Add `parseRawConfigLegacy` for tolerant parsing of old config format during migration.
- Add a deterministic profile-name sanitizer in `packages/engine/src/config.ts`.
- Simplify `resolveActiveProfileName` to only project marker → user marker → none.
- Drop `team` and `user-team` from `ActiveProfileSource` variants and bump `DAEMON_API_VERSION`.
- Pi extension footer status showing the active backend profile.
- Update init skill docs for both Claude Code plugin and Pi extension.
- Tests for schema rejection, sanitizer, and migrate flow.
- Plugin version bump in `eforge-plugin/.claude-plugin/plugin.json`.

**Out of scope:**
- Claude Code status-line integration. Plugins cannot contribute a `statusLine` directly; the only path is a `SessionStart` hook that mutates `~/.claude/settings.json`, which is intrusive. Deferred separately.
- Bumping `packages/pi-eforge/package.json` version (per AGENTS.md, versioned at publish time).

## Acceptance Criteria

1. `pnpm type-check && pnpm test` passes - schema, resolver, and migrate tests all green.
2. **Fresh init, Claude Code:** In a scratch dir with no `eforge/`, run `/eforge:init`. Assert `eforge/backends/<name>.yaml` exists, `eforge/.active-backend` contains `<name>`, `eforge/config.yaml` contains no `backend:` field. Run `/eforge:backend` and confirm it shows the new profile as active with source `local`.
3. **Fresh init, Pi:** Same flow via the Pi extension. After init, confirm the Pi footer shows `eforge: <name> (<backend>)` via `ctx.ui.setStatus`. Switch backends with `/eforge:backend:use` and confirm the footer updates.
4. **Migrate:** In a copy of a real eforge-using project with the old `backend: claude-sdk` in `config.yaml`, run `/eforge:init --migrate`. Confirm the profile was created from the existing values, marker set, `config.yaml` no longer has `backend:`/`pi:`/`agents.models:`/`agents.model:`.
5. **Break path:** Put a `backend:` field into a fresh `config.yaml` and run any MCP tool. Confirm validation fails with a clear error pointing to migrate.
6. Run `pnpm dev -- build <scratch.md>` end-to-end against a test project to confirm the active profile resolves and the build completes.
7. Schema rejects `backend:` at the top level of `config.yaml`.
8. Profile-name sanitizer produces expected outputs (lowercase, `.` → `-`, strip `claude-` prefix, collapse repeated dashes). Examples: `claude-sdk-opus-4-7`, `pi-anthropic-opus-4-7`, `pi-zai-glm-4-6`.
9. `resolveActiveProfileName` no longer falls back to `projectConfig.backend` or `userConfig.backend`; resolution is project marker → user marker → none.
10. `ActiveProfileSource` no longer includes `team` or `user-team` variants.
11. `DAEMON_API_VERSION` is bumped.
12. `eforge-plugin/.claude-plugin/plugin.json` version is bumped.
13. Pi extension footer clears gracefully when the daemon is unavailable or no backend is configured.
