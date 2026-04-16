---
title: Backend profiles: arbitrary named profiles + smart creator
created: 2026-04-16
---

# Backend profiles: arbitrary named profiles + smart creator

## Problem / Motivation

Today, `eforge/config.yaml` holds everything including `backend:` and backend-specific settings (`pi:`, model refs with `provider:`). Flipping between backend configurations means hand-editing YAML and is error-prone because schema `superRefine` (`config.ts:179`) enforces pi needs `provider` in model refs and claude-sdk forbids it — a single flip can cascade into several dependent edits.

Config is loaded fresh per-build (`loadConfig` inside each `EforgeEngine.create()`; daemon holds no config), so any file-based switch takes effect on the next build — no daemon restart.

**User goals:**
1. Arbitrary named profiles — not just `claude-sdk` and `pi`. Users name them freely: `pi-anthropic`, `pi-glm`, `pi-openrouter-haiku`, `claude-sdk-opus`, whatever fits.
2. Flip profiles fast from the harness.
3. A "smart" creator that walks the user through defining a new profile — pick backend, pick provider (for pi), query available models, default to the latest.

## Goal

Enable arbitrary named backend profiles stored in `eforge/backends/*.yaml`, selectable via a gitignored `eforge/.active-backend` marker, with fast flipping and an LLM-guided creator skill that uses pi-ai's existing model registry to walk users through defining new profiles.

## Approach

Profiles live in `eforge/backends/*.yaml` (any name). A gitignored `eforge/.active-backend` marker picks one. `config.yaml` is untouched by swapping. A new interactive skill + MCP tools drive creation using pi-ai's existing model registry (`@mariozechner/pi-ai`'s `getModel` + `ModelRegistry`).

### File layout

```
eforge/
  config.yaml             # UNTOUCHED by swap. Still holds non-backend defaults
                          # and a `backend:` field that acts as the team fallback.
  backends/               # committed. Profile files, arbitrary names.
    pi-anthropic.yaml     # e.g. { backend: pi, pi: {...}, agents: { model: { provider: anthropic, id: ... } } }
    pi-glm.yaml           # { backend: pi, agents: { model: { provider: zai, id: glm-4.6 } } }
    claude-sdk-opus.yaml  # { backend: claude-sdk, agents: { model: { id: claude-opus-4-7 } } }
  .active-backend         # GITIGNORED. Single line = profile name. Dev-local override.
```

Profile files share the same partial-config schema as `config.yaml`. Typical contents: `backend`, `pi`, `agents.model*`. Anything the user wants to vary per-profile (thinking level, extensions, role overrides) is fair game.

### Resolution (inside `loadConfig`)

One new merge layer between project config and env:

1. User global (`~/.config/eforge/config.yaml`) — existing
2. Project base (`eforge/config.yaml`) — existing, untouched by any eforge tool
3. **NEW:** active backend profile (`eforge/backends/<name>.yaml`)
4. Env vars via `resolveConfig` — existing

Active-profile name resolution:
1. If `eforge/.active-backend` exists next to the located `config.yaml`, read its trimmed contents — dev-local override.
2. Else, if `config.yaml` has `backend:` set AND `backends/<that>.yaml` exists, use it — team default.
3. Else, no profile layer — legacy behavior (today's `config.yaml` stands alone).

Unknown profile name in the marker logs a warning and falls back to the team default (or legacy).

### Swap & inspect surface

One MCP tool **`eforge_backend`** with actions:

| Action | Params | Effect |
|---|---|---|
| `list` | — | Enumerate `eforge/backends/*.yaml`, show each profile's `backend` field, which is active, and source (`local`, `team`, `missing`, `none`). |
| `show` | — | Resolved backend + merged profile contents. |
| `use` | `name` | Write `eforge/.active-backend`. Validates the profile exists and the resulting merged config passes schema before persisting. |
| `create` | `name, backend, pi?, agents?, overwrite?` | Write `eforge/backends/<name>.yaml`. Validates parse + schema. Errors if file exists without `overwrite: true`. |
| `delete` | `name` | Delete `eforge/backends/<name>.yaml` (errors if it's the active one unless `force: true`). |

A separate MCP tool **`eforge_models`** with actions:

| Action | Params | Effect |
|---|---|---|
| `providers` | `backend` | For `backend: pi`, returns pi-ai's known providers (`anthropic`, `openai`, `google`, `google-vertex`, `mistral`, `amazon-bedrock`, `openrouter`, `zai`, etc. — derived from `@mariozechner/pi-ai`'s built-in provider list + anything registered in `~/.pi/agent/models.json`). For `claude-sdk`, providers are implicit — returns `[]` or a sentinel. |
| `list` | `backend, provider?` | Returns known models. Backed by `getModel`/`ModelRegistry.getAll()` for pi. For claude-sdk: a curated list of current Claude models (or live from Anthropic's `/v1/models` if an API key is configured). Each entry: `{ id, provider?, contextWindow?, releasedAt?, deprecated? }`. Sorted newest-first when release info is available. |

### Creator skill

New skill **`/eforge:backend:new`** (aliases `/eforge:backend new <name>` via the existing router) in both integration packages. It's an LLM-guided flow rather than a coded wizard, because skills are prompts:

1. Ask for profile name (or read from arg).
2. Ask: claude-sdk or pi? (default based on context — if user said "pi-anthropic", assume pi).
3. If pi: call `eforge_models({ action: 'providers', backend: 'pi' })` → present list, let user pick.
4. Call `eforge_models({ action: 'list', backend, provider })` → present top results, default to the newest (first in returned order). For large lists, show top 10 with a "see all" affordance.
5. Optional: ask about `pi.thinkingLevel`, `agents.effort`, other common knobs — with sensible defaults.
6. Synthesize the profile YAML (respecting the validated partial-config shape).
7. Call `eforge_backend({ action: 'create', name, backend, ... })` to persist + validate.
8. Offer to activate it immediately (`action: 'use'`).

Same skill body in both packages; only the invocation/alias wiring differs.

### Daemon HTTP

- `GET /api/backend/list` → `{ profiles: [{name, backend, path}], active: string|null, source: 'local'|'team'|'missing'|'none' }`
- `POST /api/backend/use` → body `{ name }`
- `POST /api/backend/create` → body `{ name, backend, pi?, agents?, overwrite? }`
- `DELETE /api/backend/:name` → body `{ force? }`
- `GET /api/models/providers?backend=pi`
- `GET /api/models/list?backend=pi&provider=anthropic`

Types in `packages/client/src/types.ts`; re-exported from `@eforge-build/client`. Bump `DAEMON_API_VERSION` in `packages/client/src/api-version.ts` per convention (additive endpoints).

### Model-listing implementation

pi-ai already has what we need:
- `import { getModel } from '@mariozechner/pi-ai'` — known-model lookup (used in `packages/engine/src/backends/pi.ts:17`).
- `ModelRegistry.create(authStorage)` with `.getAll()` and `.find(provider, id)` (used at `pi.ts:271-288`).
- Built-in providers live under `node_modules/@mariozechner/pi-ai/dist/providers/*` (anthropic, openai-responses, openai-completions, google, google-vertex, google-gemini-cli, mistral, amazon-bedrock, azure-openai-responses, openai-codex-responses, faux, etc.).
- Static generated model list in `dist/models.generated.d.ts`.

Daemon endpoint implementation:
- Instantiate a short-lived `ModelRegistry` (or reuse one cached per daemon lifetime), call `getAll()`, filter by `provider`.
- If provider is `anthropic` and the built-in list seems stale, optionally also hit Anthropic's `/v1/models` with the ambient API key and merge — but this is optional polish. **For MVP, static built-in registry is enough.**
- For `claude-sdk` backend: reuse the anthropic provider's registry entries (the Claude SDK backend runs Claude models, same set of ids).

### Reused utilities

- `parseRawConfig` / `parseRawConfigFallback` / `mergePartialConfigs` / `findConfigFile` / `validateConfigFile` — all in `packages/engine/src/config.ts`.
- `getModel`, `ModelRegistry` from `@mariozechner/pi-ai` — already used by the pi backend (`packages/engine/src/backends/pi.ts`).
- `daemonRequest` from `@eforge-build/client`.
- `yaml` package — serialize profiles.

## Scope

### In scope

**Engine:**
- `packages/engine/src/config.ts`
  - `resolveActiveProfileName(configDir, projectConfig)` — reads `.active-backend`, falls back to `projectConfig.backend` if `backends/<that>.yaml` exists.
  - `loadBackendProfile(configDir, name)` — parses `backends/<name>.yaml` via existing `parseRawConfig`.
  - `listBackendProfiles(configDir)` — returns `[{name, backend, path}]` by scanning the dir.
  - `setActiveBackend(configDir, name)` — validates profile exists; writes marker.
  - `createBackendProfile(configDir, {name, backend, pi?, agents?, overwrite?})` — serializes via `yaml` stringify, validates via `parseRawConfig` + `eforgeConfigSchema`, writes.
  - `deleteBackendProfile(configDir, name, force?)` — errors if active unless forced.
  - Extend `loadConfig` to thread the base dir and merge the profile layer via existing `mergePartialConfigs`.
  - No schema change needed — `backend:` on `config.yaml` keeps its existing role as fallback.

- `packages/engine/src/models.ts` (new, small) — thin adapter over pi-ai:
  - `listProviders(backend): string[]`
  - `listModels(backend, provider?): Array<{id, provider?, contextWindow?, deprecated?}>`
  - Uses `getModel` / `ModelRegistry` (already a runtime dep via pi backend). Keep the import localized so claude-sdk-only users don't pay for it — lazy `await import()` inside the endpoint.

**Daemon HTTP:**
- `packages/monitor/src/server.ts` — wire the endpoints listed above.
- `packages/client/src/types.ts` — request/response types.
- `packages/client/src/api-version.ts` — bump `DAEMON_API_VERSION`.

**MCP tools:**
- `packages/eforge/src/cli/mcp-proxy.ts` — register `eforge_backend` (list/show/use/create/delete) and `eforge_models` (providers/list). All dispatch to daemon via `daemonRequest`.

**Skills (parity in both):**
- `/eforge:backend` (inspect + switch)
  - `eforge-plugin/skills/backend/backend.md`
  - `packages/pi-eforge/skills/eforge-backend/SKILL.md`
- `/eforge:backend:new` (creator — uses `eforge_models` + `eforge_backend create`)
  - `eforge-plugin/skills/backend-new/backend-new.md`
  - `packages/pi-eforge/skills/eforge-backend-new/SKILL.md`
- `packages/pi-eforge/extensions/eforge/index.ts` — register both new tools + skill aliases.

**Init flow:**
- `eforge-plugin/skills/init/init.md` and `packages/pi-eforge/skills/eforge-init/SKILL.md` — add `eforge/.active-backend` to `.gitignore`. Optionally offer to scaffold a starter profile by invoking `/eforge:backend:new`.

**Plugin version:** bump `eforge-plugin/.claude-plugin/plugin.json` per `AGENTS.md`.

### Out of scope (Non-goals)

- Editing `config.yaml` as part of swapping or creating profiles.
- Simultaneous multi-backend builds.
- Live Anthropic `/v1/models` fetch in MVP (deferred polish; pi-ai's registry is authoritative first).
- Monitor UI affordance (deferred).
- Secret management (API keys remain on the user / env / `~/.pi/agent/auth.json`).

## Acceptance Criteria

### Tests (vitest, `test/`)

- `test/config-backend-profile.test.ts`
  - Marker wins over `config.yaml`'s `backend:` field.
  - Profile overrides base `backend`, `pi`, `agents.model*`.
  - Unknown profile name in marker → warning logged, falls back to team default.
  - `setActiveBackend` errors when profile missing.
  - `createBackendProfile` rejects invalid schema (e.g., pi + model ref without `provider`).
  - `createBackendProfile` refuses overwrite without flag; honors `overwrite: true`.
  - `deleteBackendProfile` refuses when active unless `force: true`.
  - Legacy: no `backends/` dir → existing behavior unchanged.
- `test/models-listing.test.ts`
  - `listProviders('pi')` returns non-empty known providers.
  - `listModels('pi', 'anthropic')` returns at least one known model with stable shape.

### Verification

1. **Unit tests:** `pnpm test -- config-backend-profile models-listing` passes all cases.
2. **Type check:** `pnpm type-check`.
3. **End-to-end:**
   - Rebuild + restart daemon via `eforge-daemon-restart` skill.
   - Scratch project with just `eforge/config.yaml` (baseline `backend: pi`).
   - `/eforge:backend list` → empty `profiles: []`, source `none`.
   - `/eforge:backend:new pi-anthropic` → walk through: pi → anthropic → top model → write `backends/pi-anthropic.yaml` → activate.
   - `/eforge:backend:new pi-glm` → pi → zai → glm-4.6 → write `backends/pi-glm.yaml`.
   - `/eforge:backend pi-glm` → marker written; `/eforge:config show` resolves `backend: pi` with glm provider + model. Kick a tiny PRD; daemon log shows `PiBackend` with the glm model.
   - `/eforge:backend pi-anthropic` → flips back; next build uses anthropic model.
   - `/eforge:backend` (no args) → shows active profile + resolved backend.
   - Delete the marker → falls back to team default per `config.yaml`.
   - Negative: `/eforge:backend bogus` → error; marker unchanged. `/eforge:backend:new existing-name` without `overwrite` → refuses.
4. **Parity:** same scenarios in Claude Code plugin and Pi extension — identical resolved config both ways.
5. **Back-compat:** project with no `backends/` dir still builds exactly as today.
