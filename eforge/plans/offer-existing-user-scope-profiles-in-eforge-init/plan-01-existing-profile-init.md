---
id: plan-01-existing-profile-init
name: Offer existing user-scope profiles in /eforge:init
branch: offer-existing-user-scope-profiles-in-eforge-init/plan-01-existing-profile-init
---

# Offer existing user-scope profiles in /eforge:init

## Architecture Context

`/eforge:init` today always walks the user through harness/provider/model selection from scratch and persists a fresh project-scope profile under `eforge/profiles/<name>.yaml`. User-scope profiles already exist end-to-end (`eforge_profile { action: "list" | "use", scope: "user" }`, daemon `POST /api/profile/use` accepts `{ name, scope }`), but the init flow does not surface them.

`eforge_init` is implemented twice with the same shape:

- `packages/eforge/src/cli/mcp-proxy.ts` (lines 579–798) — Claude Code MCP proxy, uses zod for the input schema. Handler creates the profile via `daemonRequest(... API_ROUTES.profileCreate ...)`, activates it via `API_ROUTES.profileUse`, then writes `eforge/config.yaml` with `build.postMergeCommands` (lines 768–775).
- `packages/pi-eforge/extensions/eforge/index.ts` (lines 980–1240) — Pi extension, uses TypeBox `Type.Object` for the input schema. Same shape, restricted to `harness: 'pi'`, with a parallel config.yaml write (lines 1213–1220).

The daemon `POST /api/profile/use` endpoint already accepts `{ name, scope?: 'project' | 'user' }` (`packages/monitor/src/server.ts` ~line 1153). The shared API constants live in `packages/client/src/routes.ts` (`API_ROUTES.profileUse`).

The `/eforge:init` skill is also duplicated in two skill files (Claude Code plugin and Pi extension):

- `eforge-plugin/skills/init/init.md`
- `packages/pi-eforge/skills/eforge-init/SKILL.md`

Both files must stay in lockstep — the source PRD's acceptance criterion 5 requires the Pi variant simply omits the harness question (its harness is always `pi`).

## Implementation

### Overview

1. Extend the `eforge_init` MCP tool schema in both packages to accept an optional `existingProfile: { name: string; scope: 'user' | 'project' }` field.
2. When `existingProfile` is present, the handler short-circuits the fresh-init flow: it skips `profileCreate`, calls only `profileUse` with `{ name, scope }`, and still writes `eforge/config.yaml` with `postMergeCommands`. The `migrate` and `--force` paths are unaffected.
3. Add a new Step 1.5 to both skill files that lists user-scope profiles via `eforge_profile { action: "list", scope: "user" }`. If any exist, the skill offers picking one (which routes to the new `existingProfile` branch of `eforge_init`) or falling through to the existing Step 2 (setup mode). If none exist, the skill skips Step 1.5 entirely.
4. Bump the Claude Code plugin version.

### Key Decisions

1. **Extend `eforge_init` rather than introduce a new MCP tool.** The PRD explicitly prefers this path ("do not duplicate the logic in two MCP tools"). The new branch is a small early-return inside the existing handler — it reuses the existing config.yaml-write code path so postMergeCommands writing stays consistent.
2. **Pass `scope` through verbatim to `API_ROUTES.profileUse`.** The daemon endpoint already accepts `{ name, scope }`. No new endpoint or route is needed.
3. **Skill list+pick is plain conversational logic.** The skill calls `eforge_profile { action: "list", scope: "user" }`, presents results inline, and on selection calls `eforge_init { existingProfile: { name, scope: "user" }, postMergeCommands, force? }`. There is no new daemon-side state.
4. **Quick path & Mix-and-match are unchanged.** When the user picks "create a new project profile" (or has no user-scope profiles), the existing flow runs verbatim. This protects the Quick / Mix-and-match work landed by the dependency PRD `improve-eforge-init-quick-path-smarter-tier-defaults-per-harness`.
5. **`force` semantics on the new branch.** The handler still respects `force` for overwriting an existing `eforge/config.yaml`. If `existingProfile` is provided and `eforge/config.yaml` already exists without `force`, the same `McpUserError` is thrown as today's fresh-init mode — keeping the user's safety guarantee.
6. **No `tiers`/`models`/`profile` parameters required when `existingProfile` is set.** The handler treats `existingProfile` as mutually exclusive with `profile` (and with `migrate`). The schema does not enforce this with a discriminated union (zod/TypeBox keep it simple), but the handler validates the combination at the top of the fresh-init branch.

## Scope

### In Scope

- New `existingProfile: { name, scope }` field on the `eforge_init` MCP tool in both packages.
- New early-return branch in both handlers: skip profile assembly, call `profileUse` with `{ name, scope }`, still write `eforge/config.yaml` with `postMergeCommands`.
- New Step 1.5 in both skill files (`eforge-plugin/skills/init/init.md` and `packages/pi-eforge/skills/eforge-init/SKILL.md`).
- Bump `eforge-plugin/.claude-plugin/plugin.json` version (0.15.0 → 0.16.0).

### Out of Scope

- Changing the existing Quick / Mix-and-match flow.
- Adding a "create user-scope profile from this project" loop.
- Surfacing project-scope existing profiles in init.
- Migrating legacy configs (`--migrate` path stays unchanged).
- Bumping the npm package version of `@eforge-build/pi-eforge` (per AGENTS.md, that is owned by the publish flow).
- Bumping `DAEMON_API_VERSION` in `packages/client/src/api-version.ts` (no breaking HTTP API change — `profileUse` already accepts `{ name, scope }`).

## Files

### Modify

- `packages/eforge/src/cli/mcp-proxy.ts` — Extend the `eforge_init` zod schema (around line 583) with an optional `existingProfile: z.object({ name: z.string(), scope: z.enum(['user', 'project']) }).optional()` field. In the handler (line 606), after the `migrate` branch and after the `await ensureGitignoreEntries(...)` call but before the existing config-exists check (line 689), add a new early-return branch:
  - If `existingProfile` is provided: validate that neither `profile` nor `migrate` is also set (throw `McpUserError` with a clear message if so); reject if `existingProfile.scope === 'project'` since this skill flow is for user-scope (throw `McpUserError`); reuse the existing `eforge/config.yaml` exists/force check (throw the same `McpUserError` as today when present without `force`); ensure the config dir exists (`mkdir(configDir, { recursive: true })`); call `daemonRequest(toolCwd, 'POST', API_ROUTES.profileUse, { name: existingProfile.name, scope: existingProfile.scope })`; build `configData` from `postMergeCommands` exactly as the fresh-init branch (lines 768–775) and write `eforge/config.yaml`; best-effort daemon validation as today; return `{ status: 'initialized', configPath: 'eforge/config.yaml', profileName: existingProfile.name, source: 'user-scope', activatedExistingProfile: true }` and include `validation` if available. Do NOT call `profileCreate` and do NOT touch `eforge/profiles/`.

- `packages/pi-eforge/extensions/eforge/index.ts` — Apply the same extension to the TypeBox schema for the `eforge_init` tool (around line 985): add `existingProfile: Type.Optional(Type.Object({ name: Type.String(), scope: StringEnum(['user', 'project']) }))`. In the handler (line 1028), add the same early-return branch after the migrate block and before the config-exists check (line 1116). Use the package's existing `accessSync`/`writeFileSync`/`mkdirSync` patterns (this file does sync FS, unlike the MCP proxy). Reuse the existing `daemonRequest`/`API_ROUTES.profileUse` import. Same response shape. Same `_latestCtx ? refreshStatus(_latestCtx) : null` call as the other branches use.

- `eforge-plugin/skills/init/init.md` — Insert a new "Step 1.5: Existing user-scope profiles" section between the existing Step 1 (postMergeCommands) and Step 2 (setup mode):
  - Call `mcp__eforge__eforge_profile { action: "list", scope: "user" }`.
  - If the response is empty/no profiles, skip this step entirely and proceed to Step 2.
  - Otherwise present the profiles with `name`, `harness` (read from `agentRuntimes[defaultAgentRuntime].harness`), and `models.max.id`. Ask the user whether to pick one or create a new project profile.
  - On pick: call `mcp__eforge__eforge_init { existingProfile: { name: "<chosen>", scope: "user" }, postMergeCommands: [...], force?: true }`. Skip Steps 2–6. Jump to a Step 7-equivalent message: "eforge initialized with user-scope profile `<name>` activated. The profile lives at `~/.config/eforge/profiles/<name>.yaml`. `eforge/config.yaml` was written with the agreed postMergeCommands."
  - On "create new project profile": fall through to the existing Step 2.
  - Renumber nothing else — keep the existing Steps 2–7 as-is.
  - Place the new step inside the existing `<!-- parity-skip-start -->` / `<!-- parity-skip-end -->` block where appropriate, since the listing call is conversational.

- `packages/pi-eforge/skills/eforge-init/SKILL.md` — Insert the equivalent "Step 1.5" with the same shape. Differences from the plugin variant: (a) the listing presentation only needs to show `name` and `models.max.id` since the harness is always `pi`; (b) the tool calls use Pi's bare names (`eforge_profile`, `eforge_init`) without the `mcp__eforge__` prefix. Otherwise the new step should match line-for-line so the two files stay in lockstep.

- `eforge-plugin/.claude-plugin/plugin.json` — Bump `version` from `0.15.0` to `0.16.0`.

## Verification

- [ ] In a project where `~/.config/eforge/profiles/` contains at least one profile, `/eforge:init` lists those profiles after the postMergeCommands step. Picking one writes `eforge/.active-profile` pointing at the user-scope profile and writes `eforge/config.yaml` containing only the `build.postMergeCommands` block; `eforge/profiles/` contains no new files for the chosen profile.
- [ ] After picking an existing user-scope profile, `eforge_profile { action: "show" }` returns `scope: "user"` and a `source` field whose value indicates user-scope (matches the existing show-handler contract).
- [ ] In a project where `~/.config/eforge/profiles/` is empty, the `eforge_profile { action: "list", scope: "user" }` response is empty and the skill proceeds straight from Step 1 to Step 2 with no prompt for picking an existing profile.
- [ ] Picking "create a new project profile" from Step 1.5 produces output identical to today's flow: a project-scope profile file at `eforge/profiles/<name>.yaml` with the same default-derived name as before this change (the deriveProfileName output is unchanged).
- [ ] Both `eforge-plugin/skills/init/init.md` and `packages/pi-eforge/skills/eforge-init/SKILL.md` contain the new Step 1.5; the Pi variant omits any harness column from the profile-listing presentation while keeping the same tool-call sequence.
- [ ] `eforge-plugin/.claude-plugin/plugin.json` `version` field equals `0.16.0`.
- [ ] Running `/eforge:init --migrate` on a pre-overhaul `config.yaml` produces the same migrated profile and config.yaml output as before this change (the migrate branch is not modified).
- [ ] Running `/eforge:init --force` on a project that already has `eforge/config.yaml` overwrites it via the existing fresh-init flow when the user picks "create a new project profile"; if the user picks an existing user-scope profile, the same `force` flag is passed and the config.yaml is overwritten.
- [ ] Calling `eforge_init` with `existingProfile` and `profile` simultaneously, or with `existingProfile` and `migrate: true` simultaneously, returns an `McpUserError` describing the conflict; calling with `existingProfile.scope === 'project'` returns an `McpUserError` indicating that path is unsupported by the init skill.
- [ ] Calling `eforge_init` with `existingProfile` against an existing `eforge/config.yaml` without `force` returns the same `eforge/config.yaml already exists` `McpUserError` as today's fresh-init branch.
- [ ] `pnpm build`, `pnpm type-check`, and `pnpm test` succeed at the repo root.
