---
id: plan-02-consumers
name: Rewrite init skill and tool API around multi-runtime profile input
branch: redesign-eforge-init-around-multi-runtime-profiles/consumers
---

# Rewrite init skill and tool API around multi-runtime profile input

## Architecture Context

With plan-01 in place, the engine accepts a fully-formed multi-runtime profile spec via `createAgentRuntimeProfile`, the daemon route forwards it, and `deriveProfileName` is exposed for both engine and consumer use. This plan rewrites the consumer-facing surface so the skill becomes the single locus of elicitation and `eforge_init` becomes a pure persister.

Two integration packages must stay in sync per AGENTS.md ("keep eforge-plugin and packages/pi-eforge in sync"):

- `eforge-plugin/` (Claude Code) - the `/eforge:init` skill (`eforge-plugin/skills/init/init.md`) drives elicitation in conversation, then calls `mcp__eforge__eforge_init` with a fully-assembled `profile` object. The MCP proxy (`packages/eforge/src/cli/mcp-proxy.ts`) registers the tool.
- `packages/pi-eforge/` (Pi) - the `eforge-init` skill (`packages/pi-eforge/skills/eforge-init/SKILL.md`) drives elicitation, then calls the bare `eforge_init` tool registered in `packages/pi-eforge/extensions/eforge/index.ts`. Harness is pinned to `pi`; mix-and-match varies provider+model per tier (since claude-sdk is unavailable in Pi).

The MCP proxy currently calls `elicitInput()` three times (lines ~685-789) inside `eforge_init`, even though the skill (current Step 1.5) already asks the user for harness/provider/model. The result is duplicate prompting. The Pi extension already accepts `provider`/`maxModel` as parameters and skips elicitation, but it only models a single max model. Both surfaces are converging on a richer `profile` parameter that mirrors what plan-01's helper accepts.

## Implementation

### Overview

Four groups of changes:

1. **MCP proxy `eforge_init`** (`packages/eforge/src/cli/mcp-proxy.ts`): Replace the three `elicitInput()` calls and the post-elicit profile-name derivation with a structured `profile` schema parameter. Forward the assembled profile to the daemon. The `--migrate` path is unchanged.
2. **Pi extension `eforge_init`** (`packages/pi-eforge/extensions/eforge/index.ts`): Replace the `provider`/`maxModel` scalars with the same `profile` schema parameter. Harness is pinned to `pi`. Per-tier provider+model is now expressible. The `--migrate` path is unchanged.
3. **Skills** (`eforge-plugin/skills/init/init.md` + `packages/pi-eforge/skills/eforge-init/SKILL.md`): Rewrite the workflow into the two-track flow (Quick / Mix-and-match) with a smart cascade and auto-derived profile name with single-confirmation override. Both skills emit a fully-formed `profile` object on the tool call.
4. **Plugin version + wiring tests** (`eforge-plugin/.claude-plugin/plugin.json` + `test/profile-wiring.test.ts`): Bump the plugin version (per AGENTS.md). Add wiring test cases that prove the elicitation removal and the new schema shape.

### Key Decisions

1. **Skill drives all elicitation** - the source PRD's central point. The MCP proxy and Pi extension never call `elicitInput()` inside `eforge_init`. They never call `daemonRequest('GET', API_ROUTES.modelProviders)` or `daemonRequest('GET', API_ROUTES.modelList)` from inside `eforge_init` either - that is the skill's job (it can reach those endpoints via `mcp__eforge__eforge_models`/`eforge_models`).
2. **`profile` is the single carrier** of harness/runtime/model decisions. The schema accepts the exact shape from the source PRD's "Tool API" section.
3. **Legacy fallback (deprecation note)** - when the skill omits `profile` (legacy callers that haven't been updated), the tool falls back to a minimal default profile *and* emits a warning string in the response under `deprecation`. Use a hard-coded minimal `{ agentRuntimes: { main: { harness: 'claude-sdk' } }, defaultAgentRuntime: 'main', agents: { models: { max: { id: 'claude-opus-4-7' }, balanced: { id: 'claude-opus-4-7' }, fast: { id: 'claude-opus-4-7' } } } }` for the MCP proxy fallback. The Pi extension's fallback uses `harness: 'pi'`, the only provider returned by `listProviders('pi')` it can synchronously discover via the daemon, and that provider's newest model. If that lookup fails, throw a hard error in Pi (the previous behavior already required `provider`/`maxModel` via the skill, so a Pi caller without `profile` is genuinely broken; the deprecation note pattern is for the Claude Code MCP proxy primarily).
4. **Auto-derived profile name with single-confirmation override** - the skill computes the candidate name via the new `deriveProfileName` helper conceptually (the skill itself doesn't import code; it inlines the same rules in prose), shows it to the user once, and accepts a name override in a single follow-up question. The tool then calls `deriveProfileName` server-side as a safety net when the skill omits `profile.name`.
5. **No `mcp__eforge__eforge_models` calls from inside the tool** - the skill is responsible for calling this MCP/Pi tool to populate the elicitation choices. The tool no longer hits `/api/models/providers` or `/api/models/list`.
6. **Mix-and-match cascade defaults** (skill prose): walk tiers in order `max -> balanced -> fast`. For each tier ask harness (default = previous tier's harness; max has no default). If `pi`, ask provider (default = previous tier's provider when same harness). Ask model (default = previous tier's model when harness+provider unchanged; otherwise show the top-10 newest-first list). Deduplicate runtimes by `(harness, provider)` tuple; name them `claude-sdk`, `pi-<provider>`. Assign each tier to its runtime via `agents.tiers.<tier>.agentRuntime`. Pick `defaultAgentRuntime` as the runtime backing the `max` tier.
7. **Single-tier optimization in the assembled YAML** (Quick path): When a single runtime backs all three tiers and the same model id is used across them, the skill omits `agents.tiers` entirely and only emits `agentRuntimes` + `defaultAgentRuntime` + `agents.models.{max,balanced,fast}`. This matches the example YAML in the source PRD's Step 3a and is also what plan-01's `deriveProfileName` keys off when computing `<sanitized-model-id>`.
8. **Plugin version bump** is `0.13.0 -> 0.14.0` (minor bump - new behavior, no breaking change for the plugin commands list itself; the underlying API version is already bumped in plan-01).

### MCP proxy schema

In `packages/eforge/src/cli/mcp-proxy.ts`, replace the elicitation block (lines ~682-790) and the post-elicit assembly (lines ~791-810) with a `profile` schema parameter. Update the tool registration:

```ts
createDaemonTool(server, cwd, {
  name: 'eforge_init',
  description: 'Initialize eforge in a project. The skill is responsible for picking harness/runtime/model interactively; the tool is a pure persister. Pass `profile` with the assembled multi-runtime spec. With `migrate: true`, extracts legacy harness config from a pre-overhaul config.yaml.',
  schema: {
    force: z.boolean().optional().describe('Overwrite existing eforge/config.yaml if it already exists. Default: false.'),
    postMergeCommands: z.array(z.string()).optional().describe('Post-merge validation commands. Only applied when creating a new config.'),
    migrate: z.boolean().optional().describe('Extract legacy harness config from existing pre-overhaul config.yaml into a named profile. Default: false.'),
    profile: z.object({
      name: z.string().optional().describe('Profile name. Auto-derived via deriveProfileName when omitted.'),
      agentRuntimes: z.record(z.string(), z.object({
        harness: z.enum(['claude-sdk', 'pi']),
        pi: z.object({ provider: z.string() }).optional(),
      })),
      defaultAgentRuntime: z.string(),
      models: z.object({
        max: z.object({ id: z.string() }).optional(),
        balanced: z.object({ id: z.string() }).optional(),
        fast: z.object({ id: z.string() }).optional(),
      }).optional(),
      tiers: z.object({
        max: z.object({ agentRuntime: z.string() }).optional(),
        balanced: z.object({ agentRuntime: z.string() }).optional(),
        fast: z.object({ agentRuntime: z.string() }).optional(),
      }).optional(),
    }).optional().describe('Multi-runtime profile spec. When omitted, the tool falls back to a minimal default and emits a deprecation note.'),
  },
  handler: async ({ force, postMergeCommands, migrate, profile }, { cwd: toolCwd }) => { ... },
});
```

In the handler, after the migrate-mode early return:

- Resolve the effective profile spec:
  - If `profile` is provided: use it directly. If `profile.name` is missing, compute it via the engine's `deriveProfileName({ agentRuntimes, defaultAgentRuntime, models, tiers })` and use that.
  - Else: build the minimal-default fallback (single `claude-sdk` runtime, `claude-opus-4-7` for all three model classes), name it via `deriveProfileName` (yields `'opus-4-7'`), and add `deprecation: 'eforge_init was called without a profile parameter. Future versions will require it. Update your skill or harness wrapper.'` to the response.
- Build `createBody` for `POST /api/profile/create`:
  - Always pass `name` and `overwrite: !!force`.
  - Build `agentRuntimes`, `defaultAgentRuntime`, and `agents` from the resolved spec. `agents` is `{ models, ...(tiers ? { tiers } : {}) }`. If both are empty, omit `agents` entirely.
- Call `daemonRequest(toolCwd, 'POST', API_ROUTES.profileCreate, createBody)`.
- Activate via `POST API_ROUTES.profileUse` with `{ name }` (unchanged from current).
- Write `eforge/config.yaml` with `postMergeCommands` if provided (unchanged).
- Run validation via `GET API_ROUTES.configValidate` (unchanged).
- Return shape: `{ status: 'initialized', configPath, profileName: name, profilePath: 'eforge/profiles/<name>.yaml', validation?, deprecation? }`. Drop the top-level `harness` field (a multi-runtime profile no longer has a single harness); add `agentRuntimes: Object.keys(agentRuntimes)` for skill-side reporting.

Delete every `elicitInput(...)` call inside `eforge_init` and the `import {} from '@modelcontextprotocol/sdk/...'` types associated only with elicitation if they become unused. (Keep them if other tools in the proxy still use elicitation.) Search the file with the grep pattern `elicitInput` after the rewrite to confirm zero matches inside `eforge_init`.

### Pi extension schema

In `packages/pi-eforge/extensions/eforge/index.ts` (lines ~979-1198), update the tool registration to take the same `profile` shape but constrained: every entry in `profile.agentRuntimes.<name>` must have `harness: 'pi'` and `pi.provider` (the schema rejects `claude-sdk` runtimes for the Pi extension). The handler logic mirrors the MCP proxy:

- Validate every runtime entry has `harness === 'pi'` and `pi.provider` set; otherwise throw a clear error.
- Resolve effective profile spec with `deriveProfileName` fallback (importing from `@eforge-build/engine/config`). Pi extension already imports from this package; check `packages/pi-eforge/package.json` and `tsconfig` to confirm the path - if not present, add `@eforge-build/engine` to the dependency list (workspace:*).
- Pi-only fallback: when `profile` is omitted, build a minimal `{ agentRuntimes: { 'pi-anthropic': { harness: 'pi', pi: { provider: 'anthropic' } } }, defaultAgentRuntime: 'pi-anthropic', models: { max: { id: 'claude-opus-4-7' }, balanced: { id: 'claude-opus-4-7' }, fast: { id: 'claude-opus-4-7' } } }`. Add `deprecation: 'eforge_init was called without a profile parameter. Future versions will require it.'` to the response. (Avoid the daemon `listProviders('pi')` call - it adds a network round trip and the goal is a pure persister.)
- Drop the `provider`/`maxModel` parameters from the schema entirely. They were the previous-gen single-model knobs.
- Build `createBody` and call `daemonRequest('POST', API_ROUTES.profileCreate, createBody)` with the same shape used by the MCP proxy.
- Return shape mirrors the MCP proxy (`status`, `configPath`, `profileName`, `profilePath`, `agentRuntimes`, `validation?`, `deprecation?`).

### Plugin skill rewrite (`eforge-plugin/skills/init/init.md`)

Rewrite the entire `## Workflow` section with:

1. **Step 1: Determine postMergeCommands** - unchanged (keep current prose verbatim).
2. **Step 2: Setup mode** - ask: "Quick setup (one harness, one model used for every tier) or mix-and-match (pick a different harness/provider/model per tier)?". No default. Both options remain visible.
3. **Step 3a: Quick path**:
   - Ask harness: `claude-sdk` or `pi`. **No default - user must pick.**
   - If `pi`: call `mcp__eforge__eforge_models` with `{ action: 'providers', harness: 'pi' }`; ask user to pick a provider.
   - Call `mcp__eforge__eforge_models` with `{ action: 'list', harness: '<chosen>', provider: '<chosen>?' }`; show top 10 newest-first; ask user to pick the max model.
   - Assemble single-runtime profile: `{ agentRuntimes: { main: { harness: <chosen>, ...(provider ? { pi: { provider: <chosen> } } : {}) } }, defaultAgentRuntime: 'main', models: { max: { id: <picked> }, balanced: { id: <picked> }, fast: { id: <picked> } } }`. (For claude-sdk runtimes, the runtime is named `main`; the YAML on disk will reflect that. The engine accepts any name as long as `defaultAgentRuntime` matches.)
4. **Step 3b: Mix-and-match path**:
   - Walk tiers `max -> balanced -> fast`. Ask harness, provider (when pi), and model per tier with the cascade defaults from "Key Decisions" #6.
   - Deduplicate runtimes by `(harness, provider)` tuple. Name them `claude-sdk` and `pi-<provider>` (if multiple Pi providers, append the provider name; for claude-sdk there's only one runtime name `claude-sdk`).
   - Assign each tier to its runtime via `agents.tiers.<tier>.agentRuntime`.
   - `defaultAgentRuntime` = the runtime backing the `max` tier (planners/reviewers default to max).
5. **Step 4: Profile name** - inline the `deriveProfileName` rules in prose. Show the candidate name to the user; offer a single follow-up confirmation to override.
6. **Step 5: Persist** - call `mcp__eforge__eforge_init` with `{ profile: <assembled>, postMergeCommands, force? }`.
7. **Step 6: Migrate (`--migrate`)** - unchanged path; still calls `mcp__eforge__eforge_init` with `{ migrate: true }`.
8. **Step 7: Report** - show profile name, path, and pointers to `/eforge:profile`, `/eforge:profile-new`, `/eforge:config --edit`.

Remove the existing Step 1.5 block (the current source of duplicate elicitation). Keep the `<!-- parity-skip-start -->` comment regions where they currently exist around skill-specific prose.

### Pi skill rewrite (`packages/pi-eforge/skills/eforge-init/SKILL.md`)

Mirror the plugin skill's two-track flow but constrain to `harness: 'pi'`:

- **Step 2: Setup mode** - same Quick / Mix question.
- **Step 3a: Quick path** - skip the harness question (always `pi`). Ask provider via `eforge_models { action: 'providers', harness: 'pi' }`, then model.
- **Step 3b: Mix path** - walk tiers; per tier ask provider (default = previous tier's provider) and model (default = previous tier's model when provider unchanged). Deduplicate runtimes by provider; name them `pi-<provider>`. Assign tiers via `agents.tiers.<tier>.agentRuntime`.
- Steps 4-7 mirror the plugin skill (name derivation, persist via `eforge_init` with `{ profile: ... }`, migrate path unchanged, report).

Keep `disable-model-invocation: true` and the existing `<!-- parity-skip-start -->` regions.

### Wiring tests

In `test/profile-wiring.test.ts`, add a new top-level `describe(...)` block for `/eforge:init` redesign with cases:

- **MCP proxy `eforge_init` no longer calls elicitInput**: read `packages/eforge/src/cli/mcp-proxy.ts`. Locate the `eforge_init` tool block (search for `name: 'eforge_init',` and slice up to the next `createDaemonTool(` call). Assert `block` does not contain `elicitInput`.
- **MCP proxy `eforge_init` declares the `profile` schema parameter**: in the same block, assert it contains the literal `profile:` key inside the `schema:` object and that it references `agentRuntimes`, `defaultAgentRuntime`, `models`, and `tiers` field names.
- **Pi extension `eforge_init` declares the `profile` schema parameter**: read `packages/pi-eforge/extensions/eforge/index.ts`. Locate the tool block. Assert it contains the field name `profile` in the `Type.Object({ ... })` declaration and references `agentRuntimes`, `defaultAgentRuntime`. Assert it does NOT declare `provider:` or `maxModel:` as top-level parameters.
- **Plugin init skill describes the two-track flow**: read `eforge-plugin/skills/init/init.md`. Assert the workflow contains both `Quick setup` and `mix-and-match` (case-insensitive); contains `Step 3a` and `Step 3b`; mentions `defaultAgentRuntime`; mentions `agents.tiers.<tier>.agentRuntime` (literal). Assert it no longer contains `Step 1.5`.
- **Pi init skill describes the two-track flow**: same checks against `packages/pi-eforge/skills/eforge-init/SKILL.md`. Additionally assert the skill mentions the harness is pinned to `pi` (no claude-sdk choice in the Pi flow).
- **Plugin version bumped**: assert `eforge-plugin/.claude-plugin/plugin.json` parses to a version that is not `0.13.0` and is greater than `0.13.0` (lexical compare via simple major/minor/patch parse is enough).

Keep all existing test cases in `test/profile-wiring.test.ts` passing. The existing init-skill assertions at lines 198-210 (must contain `eforge/.active-profile` and `/eforge:profile-new`) must still hold after the rewrite - both phrases stay in the rewritten skill.

### Plugin version bump

Update `eforge-plugin/.claude-plugin/plugin.json`: `"version": "0.13.0"` -> `"version": "0.14.0"`. Do not touch `packages/pi-eforge/package.json` (per AGENTS.md: "Do not bump the Pi package version").

## Scope

### In Scope
- Rewriting `eforge-plugin/skills/init/init.md` with the two-track Quick/Mix workflow, smart cascade defaults, name derivation, and `profile`-parameter tool call.
- Rewriting `packages/pi-eforge/skills/eforge-init/SKILL.md` to mirror the same two-track flow constrained to `harness: 'pi'`.
- Replacing elicitation in `packages/eforge/src/cli/mcp-proxy.ts` `eforge_init` with a structured `profile` schema parameter and forwarding it to the daemon.
- Replacing the `provider`/`maxModel` scalars in `packages/pi-eforge/extensions/eforge/index.ts` `eforge_init` with the same `profile` schema parameter.
- Adding a deprecation-note fallback when `profile` is omitted (Claude Code path; Pi path uses an analogous fallback).
- Bumping `eforge-plugin/.claude-plugin/plugin.json` from `0.13.0` to `0.14.0`.
- Adding wiring test cases in `test/profile-wiring.test.ts` that verify elicitation removal, the new schema shape, the two-track skill prose, and the version bump.

### Out of Scope
- The engine helper, daemon route, and API version bump - all owned by plan-01.
- The `--migrate` path in either `mcp-proxy.ts` or `pi-eforge/extensions/eforge/index.ts` - unchanged.
- `sanitizeProfileName` in `packages/client/src/profile-utils.ts` - still used by the migrate paths.
- Touching `eforgeConfigBaseSchema` cross-field validation.
- Bumping `packages/pi-eforge/package.json` (per AGENTS.md).
- Adding e2e tests that boot a live daemon - manual verification (Acceptance Criteria #3-6 in the source PRD) covers that.

## Files

### Create
- (none)

### Modify
- `eforge-plugin/skills/init/init.md` - replace the Workflow section: drop Step 1.5; add Steps 2/3a/3b/4/5/6/7 per the source PRD's Skill flow. The tool call now passes a fully-assembled `profile` object.
- `packages/eforge/src/cli/mcp-proxy.ts` - in the `eforge_init` tool registration, replace the three `elicitInput()` calls (lines ~685-789) and the post-elicit profile-name derivation with a `profile` schema parameter. Forward the assembled profile to `POST API_ROUTES.profileCreate`. Use the engine's `deriveProfileName` to fill in `profile.name` when the skill omits it. Add a deprecation-note response field when `profile` is omitted entirely. The `--migrate` branch is unchanged.
- `packages/pi-eforge/extensions/eforge/index.ts` - in the `eforge_init` tool registration (lines ~979-1198), replace `provider`/`maxModel` parameters with the same `profile` schema. Pin every runtime entry's `harness` to `pi`; reject claude-sdk entries with a clear error. Use `deriveProfileName` for the auto-name fallback.
- `packages/pi-eforge/skills/eforge-init/SKILL.md` - rewrite Workflow to mirror the plugin skill's two-track flow, constrained to `harness: 'pi'` (no harness choice; mix path varies provider+model per tier).
- `eforge-plugin/.claude-plugin/plugin.json` - bump `version` from `0.13.0` to `0.14.0`.
- `test/profile-wiring.test.ts` - add wiring test cases for the new `profile` schema in both surfaces, the elicitation removal in the MCP proxy, the two-track flow in both skills, and the plugin version bump.

## Verification

- [ ] `pnpm type-check` passes
- [ ] `pnpm test` passes; the new wiring cases in `test/profile-wiring.test.ts` (described above) all pass; existing assertions at `test/profile-wiring.test.ts:198-210` still hold
- [ ] `pnpm build` produces fresh bundles for `packages/eforge`, `packages/pi-eforge`, and `packages/monitor` without errors
- [ ] Grep for `elicitInput` in `packages/eforge/src/cli/mcp-proxy.ts` returns zero matches inside the `eforge_init` tool block (search the slice between `name: 'eforge_init',` and the next `createDaemonTool(` call)
- [ ] The `eforge_init` schema in `packages/eforge/src/cli/mcp-proxy.ts` declares a `profile` field whose object includes `agentRuntimes`, `defaultAgentRuntime`, `models`, and `tiers` keys (verified by reading the source and matching against literals)
- [ ] The `eforge_init` schema in `packages/pi-eforge/extensions/eforge/index.ts` declares a `profile` field with the same four keys; the source no longer declares top-level `provider:` or `maxModel:` parameters in this tool's `Type.Object({...})`
- [ ] `eforge-plugin/skills/init/init.md` no longer contains the literal text `Step 1.5`; contains both `Quick setup` and `mix-and-match`; references `agents.tiers.<tier>.agentRuntime`; the tool call example passes `profile` (literal substring `profile:`)
- [ ] `packages/pi-eforge/skills/eforge-init/SKILL.md` follows the same two-track structure (`Quick setup` + `mix-and-match`); does not present `claude-sdk` as a harness choice (the Pi flow pins to pi); the tool call example passes `profile`
- [ ] `eforge-plugin/.claude-plugin/plugin.json` `version` field equals `0.14.0`
- [ ] When `eforge_init` is called with a fully-formed `profile` parameter, the response shape is `{ status: 'initialized', configPath: 'eforge/config.yaml', profileName, profilePath, agentRuntimes, validation? }` (no `harness` field, no `deprecation` field)
- [ ] When `eforge_init` is called without a `profile` parameter (legacy caller), the response includes a `deprecation` string field and the helper still produces a valid profile via the minimal default fallback
- [ ] The MCP proxy `eforge_init` handler does not call `daemonRequest(..., API_ROUTES.modelProviders, ...)` or `daemonRequest(..., API_ROUTES.modelList, ...)` from inside the fresh-init path - those endpoints are exclusively reached by the skill via `mcp__eforge__eforge_models` (verified by greppping the `eforge_init` tool block)
- [ ] No file in `packages/pi-eforge/` bumps `package.json` `version` (per AGENTS.md)
