---
title: Improve `/eforge:init` Quick path: smarter tier defaults per harness
created: 2026-04-29
---

# Improve `/eforge:init` Quick path: smarter tier defaults per harness

## Problem / Motivation

The current `/eforge:init` Quick path asks the user to pick a single model, then assigns it to all three tiers (`max`, `balanced`, `fast`) regardless of harness. This is wasteful for Claude SDK users — Claude Code ships three first-party model families (Opus, Sonnet, Haiku) that map cleanly onto the three tiers, so pinning all three to one model means the user pays Opus prices for every fast-tier read or pays for Haiku-quality reasoning at the max tier. For Pi users it's also limiting: they often want max + a cheaper balanced model, but the form forces a single choice.

## Goal

Make Quick setup tier-aware so Claude SDK users get auto-suggested Opus/Sonnet/Haiku defaults across the three tiers, and Pi users are explicitly encouraged to pick a separate balanced model (with `fast` auto-derived from `balanced`) — without changing the Mix-and-match path or any engine/MCP/schema surface.

## Approach

This change makes Quick setup tier-aware:

- **Claude SDK Quick path**: auto-suggest the newest Opus / Sonnet / Haiku from the registry as max / balanced / fast respectively, and ask the user to confirm or override individual tiers.
- **Pi Quick path**: still simple (max is the only required pick) but explicitly encourage the user to pick a separate balanced model; auto-derive `fast = balanced` so they don't have to answer a third question.

The Mix-and-match path is unchanged — it already lets users pick per tier with previous-tier defaults.

### Files to modify

Both skill files must change in lockstep (they're parity-tracked, with `<!-- parity-skip-start/end -->` markers around harness-specific sections):

1. `/Users/markschaake/projects/eforge-build/eforge/eforge-plugin/skills/init/init.md` — Claude Code plugin skill (handles both `claude-sdk` and `pi` harnesses).
2. `/Users/markschaake/projects/eforge-build/eforge/packages/pi-eforge/skills/eforge-init/SKILL.md` — Pi extension skill (`pi` harness only).

No engine, MCP, or schema changes are needed. The `eforge_models` MCP tool already returns the data we need (sorted newest-first), and the `eforge_init` MCP tool already accepts a fully-assembled `profile.models.{max,balanced,fast}.id` payload.

### Existing utilities to reuse

- `mcp__eforge__eforge_models` with `{ action: "list", harness, provider? }` — returns `ModelInfo[]` sorted newest-first by `releasedAt`. `ModelInfo` shape (`packages/engine/src/models.ts:15`): `{ id, provider?, contextWindow?, releasedAt?, deprecated? }`.
- `deriveProfileName()` server-side (`packages/engine/src/config.ts:1613`) — already handles the resulting profile shapes:
  - Claude SDK Quick (single `claude-sdk` runtime, three different model ids per tier) → name resolves to `claude-sdk`.
  - Pi Quick with same model in all tiers → name resolves to sanitized model id (e.g. `opus-4-7`).
  - Pi Quick with split max/balanced → name resolves to `pi-<provider>`.
- The skill never needs to embed a static "latest model" list — it derives the latest Opus / Sonnet / Haiku at runtime by scanning the sorted `eforge_models` response. Family detection is by case-insensitive substring match on `id` (`opus`, `sonnet`, `haiku`), filtered to `!deprecated`.

### Detailed changes

#### A. `eforge-plugin/skills/init/init.md` — Step 3a (Quick path)

Replace the current Quick-path block (lines ~37–62) with a harness-branched flow:

##### Quick path, harness = `claude-sdk`

1. Call `mcp__eforge__eforge_models` once with `{ action: "list", harness: "claude-sdk" }`.
2. From the returned list (already sorted newest-first), select tier defaults by scanning for the first non-deprecated entry whose `id` contains (case-insensitive):
   - `opus` → `max` default
   - `sonnet` → `balanced` default
   - `haiku` → `fast` default
3. Present the three selections to the user, framed as a recommendation, e.g.:

   > Claude Code ships three model families. Latest of each:
   > - **max**: `claude-opus-4-7` (Opus — deepest reasoning)
   > - **balanced**: `claude-sonnet-4-6` (Sonnet — strong default)
   > - **fast**: `claude-haiku-4-5` (Haiku — cheapest, quickest)
   >
   > Use these, or customize a tier?

4. Accept one of: `confirm`, `customize <tier>`, or `customize all`. For each tier the user wants to change, show the top 10 from the same model list (no extra `eforge_models` call) and let them pick a different id. The default at each prompt is the family-derived suggestion.
5. Assemble a single-runtime profile (no `tiers` block — there's only one runtime):

   ```yaml
   profile:
     agentRuntimes:
       main:
         harness: claude-sdk
     defaultAgentRuntime: main
     models:
       max:     { id: <picked> }
       balanced:{ id: <picked> }
       fast:    { id: <picked> }
   ```

##### Quick path, harness = `pi`

1. **Provider**: ask the user to pick a provider (existing behavior — call `eforge_models` with `{ action: "providers", harness: "pi" }`).
2. **Max model** (required): call `eforge_models` with `{ action: "list", harness: "pi", provider: "<chosen>" }` and ask the user to pick from the top 10.
3. **Balanced model** (encouraged, optional): immediately after the max pick, prompt:

   > Pick a separate **balanced**-tier model? (Recommended — most build steps run at the balanced tier, so a cheaper/smaller model here saves a lot. Press enter to reuse `<max-id>`.)

   Show the same top-10 list with the user's max pick highlighted as the default. If the user accepts the default, set `balanced.id = max.id`.
4. **Fast model**: do not prompt. Set `fast.id = balanced.id` (whichever value balanced ended up at). This keeps Quick setup to at most two model questions while still giving Pi users an easy on-ramp to tier-aware cost savings.
5. Assemble the single-runtime profile (runtime named `main`, harness=`pi`, with `pi.provider` set):

   ```yaml
   profile:
     agentRuntimes:
       main:
         harness: pi
         pi:
           provider: <chosen>
     defaultAgentRuntime: main
     models:
       max:      { id: <picked> }
       balanced: { id: <picked-or-max> }
       fast:     { id: <balanced> }
   ```

#### B. `packages/pi-eforge/skills/eforge-init/SKILL.md` — Step 3a (Quick path)

Pi-eforge has no `claude-sdk` branch, so only the Pi Quick path needs to change. Apply the same Pi-Quick treatment as above:

1. Provider pick (unchanged).
2. Max model pick (unchanged).
3. **New**: encourage a balanced-tier pick with the same prompt copy as the plugin skill, falling back to `balanced = max`.
4. **New**: derive `fast = balanced` automatically (no prompt).
5. Runtime name stays `pi-<provider>` (existing pi-eforge convention — do not change this in scope; the plugin skill keeps its `main` convention).

#### C. Profile-name derivation note

Re-confirm the existing Step 4 rules already cover the new shapes — no edits needed:

- Claude SDK Quick with three distinct model ids → "single runtime, model varies" → name = `claude-sdk`.
- Pi Quick where balanced was skipped (all three tiers identical) → "single runtime, same model id" → name = sanitized model id (e.g. `opus-4-7`).
- Pi Quick with split max/balanced → "single runtime, model varies" → name = `pi-<provider>`.

Add a one-line aside under Step 4 in both skills clarifying that the Claude SDK Quick path will typically land on `claude-sdk` (since each tier picks a different family by default), to set expectations before the user is shown the candidate name.

## Scope

### In scope

- Step 3a (Quick path) updates in both:
  - `/Users/markschaake/projects/eforge-build/eforge/eforge-plugin/skills/init/init.md`
  - `/Users/markschaake/projects/eforge-build/eforge/packages/pi-eforge/skills/eforge-init/SKILL.md`
- Harness-branched Quick flow for `claude-sdk` (auto-suggest Opus/Sonnet/Haiku per tier, confirm-or-customize) and `pi` (max required, balanced encouraged, fast auto-derived).
- One-line aside under Step 4 in both skills clarifying expected Claude SDK Quick profile name (`claude-sdk`).
- Bump `eforge-plugin/.claude-plugin/plugin.json` version per the project rule that any plugin change requires a version bump.

### Out of scope (explicitly NOT changing)

- Mix-and-match path (Step 3b) — already tier-by-tier with smart defaults.
- `eforge_init` MCP tool, `eforge_models` MCP tool, profile schemas, daemon endpoints.
- Step 1 (postMergeCommands), Step 5 (persist), Step 6 (`--migrate`), Step 7 (report).
- Parity skip markers — the harness-branched section stays inside the existing `<!-- parity-skip-start --> ... <!-- parity-skip-end -->` block in the plugin skill (the Pi skill is single-harness, so it has no claude-sdk branch to skip).
- Runtime naming inconsistency between plugin (`main`) and pi-eforge (`pi-<provider>`) — pre-existing, out of scope.

## Acceptance Criteria

1. **Plugin skill, Claude SDK Quick path** — in a fresh project, run `/eforge:init` in a Claude Code session, choose Quick → claude-sdk. Confirm:
   - The three suggested models match `eforge_models { action: "list", harness: "claude-sdk" }`'s newest-first first match for `opus`/`sonnet`/`haiku`.
   - Accepting the suggestion writes `eforge/profiles/claude-sdk.yaml` with three different model ids per tier and a single `main` agent runtime.
   - Customizing one tier (e.g. fast → opus too) still produces a valid profile and the daemon activates it.
2. **Plugin skill, Pi Quick path** — same project, `--force` to redo init, choose Quick → pi → anthropic. Confirm:
   - User is prompted for max, then for balanced (with reuse-max default), and is NOT prompted for fast.
   - Skipping balanced produces a profile named after the sanitized max model id (e.g. `opus-4-7`).
   - Splitting max/balanced produces a profile named `pi-anthropic`.
3. **Pi-eforge skill** — in a Pi extension session, run `/eforge:init` Quick path; verify the same balanced-encouragement prompt and `fast = balanced` derivation behavior, with runtime named `pi-<provider>`.
4. **Mix-and-match regression** — confirm both skills still walk tiers correctly when the user chooses Mix-and-match (unchanged path, but worth a smoke test since both files are edited).
5. **`--migrate` regression** — confirm `/eforge:init --migrate` still calls `eforge_init { migrate: true }` and skips Step 3 entirely in both skills.
6. `eforge-plugin/.claude-plugin/plugin.json` version is bumped per the project rule that any plugin change requires a version bump.
