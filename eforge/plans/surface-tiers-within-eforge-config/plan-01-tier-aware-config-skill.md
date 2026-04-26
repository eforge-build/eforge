---
id: plan-01-tier-aware-config-skill
name: Tier-aware /eforge:config skill bodies
branch: surface-tiers-within-eforge-config/tier-aware-config-skill
---

# Tier-aware /eforge:config skill bodies

## Architecture Context

The engine config layer (`packages/engine/src/pipeline/agent-config.ts`) already implements an `AgentTier` system with four tiers — `planning`, `implementation`, `review`, `evaluation`. Each role is mapped to a tier in `AGENT_ROLE_TIERS` (lines 29-58) and tiers ship with built-in defaults via `BUILTIN_TIER_DEFAULTS` (lines 65-70):

- `implementation` → `effort=medium, modelClass=balanced`
- `planning` / `review` / `evaluation` → `effort=high, modelClass=max`

The full resolution chain (highest → lowest precedence) is documented in the file's header comment:
1. Plan-file override (`planEntry.agents[role]`)
2. User per-role override (`config.agents.roles[role]`)
3. User per-tier (`config.agents.tiers[tierForRole(role)]`)
4. User global (`config.agents.{model,thinking,effort,maxTurns}`)
5. Built-in per-role defaults (`AGENT_ROLE_DEFAULTS[role]`) — exceptions only
6. Built-in per-tier defaults (`BUILTIN_TIER_DEFAULTS[tier]`)

The schema at `packages/engine/src/config.ts:171-230` already accepts `agents.tiers.<tier>` overrides and `agents.roles.<role>.tier` (to reassign a role to a different tier).

The two consumer-facing `/eforge:config` skill bodies pre-date this tier work and still describe the resolution chain as `per-role > global > class > backend > fallback` and claim "Eight roles default to balanced; all others default to max". Both narratives are wrong post-tier-refactor. The same skill body lives in two places per the AGENTS.md "keep eforge-plugin and pi-eforge in sync" rule:

- `eforge-plugin/skills/config/config.md` (Claude Code plugin)
- `packages/pi-eforge/skills/eforge-config/SKILL.md` (Pi extension)

User directive: NO new `/eforge:tiers` skill — fold tier guidance into `/eforge:config` so the existing skill remains the single entry point for config edits.

## Implementation

### Overview

Edit both skill bodies in lockstep so they (a) frame agent config as three layers of granularity (global → tier → per-role), (b) add a conversational tier-tuning interview step, (c) fix the stale resolution-chain narrative, (d) replace the stale "eight roles default to balanced" claim with tier-driven framing, and (e) extend the YAML Configuration Reference with a `tiers:` example. Bump the Claude Code plugin version. Do **not** bump the Pi package version.

### Key Decisions

1. **Verify role lists from source at edit time, do not copy from the PRD.** The PRD itself warns that copying could go stale. Open `packages/engine/src/pipeline/agent-config.ts:29-58` while editing and transcribe the exact role membership for each tier into the skill body's tier-membership table.
2. **Single plan, doc-only.** No TypeScript changes. No test changes. The schema already accepts tier overrides — this work is purely user-facing copy.
3. **Mirror the two files.** Edit `eforge-plugin/skills/config/config.md` first, then mirror the same prose into `packages/pi-eforge/skills/eforge-config/SKILL.md`. The only legitimate text differences between the two are the existing Pi-specific top-of-file note and the MCP tool name prefixes (`mcp__eforge__eforge_*` vs `eforge_*`).
4. **Keep tier knob list aligned with engine schema.** Per-tier knobs documented in the new section: `effort`, `modelClass`, `model`, `thinking`, `maxTurns`, `maxBudgetUsd`, `allowedTools`, `disallowedTools`, `agentRuntime`. Confirm against `packages/engine/src/config.ts:171-230` while editing.
5. **Per-role section gets one new sentence about `roles.<role>.tier`** noting that a role can be reassigned to a different tier (rare but supported).

### Detailed edits per file

#### `eforge-plugin/skills/config/config.md` and `packages/pi-eforge/skills/eforge-config/SKILL.md`

Apply identical structural changes to both files (text differs only on MCP tool prefixes and the existing Pi top-of-file note):

**1. Restructure the "Sections to cover" list (currently lines 51-62 in plugin / 53-64 in Pi).**

Replace the single "Model & thinking tuning" item (#2) and the existing "Per-role agent overrides" item (#4) with three items walking granularity from broad to narrow. Insert a one-sentence framing sentence above the list:

> Agent settings resolve through three layers of granularity: **global** (applies to every agent), **tier** (applies to a group of related agents — planning, implementation, review, evaluation), and **per-role** (applies to one named agent). The interview walks them in that order; skip layers you don't want to customize.

Then the new agent-related sections in the list:

- **Global agent defaults** (renamed from "Model & thinking tuning", opt-in) — keep the existing copy about `agents.model`, `agents.thinking`, `agents.effort`, and the `agents.models.{max,balanced,fast}` model-class mapping. Remove the stale "Eight roles default to balanced; all others default to max" sentence from this item — that narrative now belongs to the tier section. Keep the model-resolution sub-chain wording (`per-role model > global model > user class override > backend class default > fallback chain`) but rewrite it to include the tier step (see edit B below).
- **Tier tuning** (NEW, opt-in) — phrased conversationally. Suggested copy:
  > Would you like to tune agents by group? eforge organises agents into four groups by what they do: **planning**, **implementation**, **review**, and **evaluation**. You can give each group its own effort level or model class without touching individual roles.
  >
  > Group membership (verify against `AGENT_ROLE_TIERS` at edit time):
  > - **planning** — `planner`, `module-planner`, `formatter`, `pipeline-composer`, `dependency-detector`
  > - **implementation** — `builder`, `review-fixer`, `validation-fixer`, `merge-conflict-resolver`, `doc-updater`, `test-writer`, `tester`, `gap-closer`, `recovery-analyst`
  > - **review** — `reviewer`, `architecture-reviewer`, `cohesion-reviewer`, `plan-reviewer`, `staleness-assessor`, `prd-validator`
  > - **evaluation** — `evaluator`, `architecture-evaluator`, `cohesion-evaluator`, `plan-evaluator`
  >
  > Built-in defaults (so you know what "no override" gives you):
  > - `implementation` → `effort=medium, modelClass=balanced`
  > - `planning`, `review`, `evaluation` → `effort=high, modelClass=max`
  >
  > Available per-tier knobs: `effort`, `modelClass`, `model`, `thinking`, `maxTurns`, `maxBudgetUsd`, `allowedTools`, `disallowedTools`, `agentRuntime`. Set them under `agents.tiers.<tier>`.

  Implementor note: when editing, open `packages/engine/src/pipeline/agent-config.ts:29-58` and confirm the role lists above match the current `AGENT_ROLE_TIERS` map. If the PRD's lists differ from the source, trust the source.

- **Per-role overrides** (existing, opt-in, kept as the finest-grained option) — preserve the existing copy about per-role options (`model`, `modelClass`, `thinking`, `effort`, `maxBudgetUsd`, `fallbackModel`, `allowedTools`, `disallowedTools`, `maxTurns`, `promptAppend`). Add this sentence at the end of the item: "You can also set `roles.<role>.tier` to reassign a role to a different tier (rare, but supported when one role inside a group needs to behave like another group)." Remove the stale "Note: Eight roles ... default to balanced; all others default to max" sentence — the tier section now carries that information.

Keep the surrounding numbered items (Build settings, Agent behavior, Prompt customization, Hooks, Langfuse, Plugin settings, PRD queue, Daemon) intact, renumbered as needed.

**2. Fix the resolution-order narrative (edit B).**

Wherever the current text says `per-role model > global model > user class override > backend class default > fallback chain`, replace it with:

> Resolution order (highest → lowest): plan override → per-role config → per-tier config → global config → built-in per-role default → built-in per-tier default. Model resolution adds a sub-chain: an explicit `model` at any layer wins over `modelClass`, and `modelClass` resolves to a model ID via `agents.models.<class>` (with backend defaults and fallback walking if unset).

This applies inside the new "Global agent defaults" item (the natural home for resolution-chain prose).

**3. Fix the role-default narrative (edit C).**

Wherever the current text says "Eight roles (`builder`, `review-fixer`, ...) default to `balanced`; all others default to `max`" (it appears in both items #2 and #4 today), replace with tier-driven framing in the tier section only:

> Built-in defaults come from each role's tier: planning, review, and evaluation roles default to `effort=high, modelClass=max`; implementation roles (builder, fixers, tester, doc-updater, etc.) default to `effort=medium, modelClass=balanced`. Setting `agents.tiers.<tier>.modelClass` shifts a whole tier; setting `agents.roles.<role>.modelClass` shifts a single role.

Delete the old wording from items #2 and #4 — it should appear once, in the tier section.

**4. Extend the YAML Configuration Reference (edit D).**

Inside the `agents:` block in the example (currently lines 131-172 in plugin / 133-173 in Pi), add a `tiers:` subsection alongside the existing `roles:` example. Place the new block after the `# --- Per-role overrides ---` block (or before it — pick the order that reads best with the surrounding `# ---` section dividers; suggested: tiers first, then per-role, since tiers are coarser):

```yaml
  # --- Per-tier overrides ---
  # tiers:
  #   planning:
  #     effort: high           # default; lower this to save tokens on planning
  #     modelClass: max        # default
  #   implementation:
  #     effort: medium         # default
  #     modelClass: balanced   # default; raise to `max` for tougher codebases
  #   review:
  #     effort: high
  #     modelClass: max
  #   evaluation:
  #     effort: high
  #     modelClass: max
```

Leave the existing `# --- Per-role overrides ---` block intact.

**5. Pi-specific note (edit E).**

Leave the top-of-file note in `packages/pi-eforge/skills/eforge-config/SKILL.md` (line 7: "In Pi, the native `/eforge:config` command provides a richer interactive experience...") intact and unchanged.

#### `eforge-plugin/.claude-plugin/plugin.json`

Patch-bump `version` from `0.9.0` to `0.9.1`. No other changes to this file.

#### Out-of-scope follow-up flag

If the Pi native `/eforge:config` overlay (outside the skill body) renders config sections, that overlay code may also need a tier section. That's out of scope for this plan. Mention in the implementation PR description so it can be triaged as a follow-up.

## Scope

### In Scope
- Edit `eforge-plugin/skills/config/config.md`: tier framing + new tier interview step + fixed resolution chain + fixed role-default narrative + new `tiers:` block in YAML reference.
- Edit `packages/pi-eforge/skills/eforge-config/SKILL.md`: identical changes, mirroring the plugin file (only differences: existing Pi top-of-file note and `eforge_*` MCP tool name prefixes).
- Patch-bump `eforge-plugin/.claude-plugin/plugin.json` `version` from `0.9.0` to `0.9.1`.

### Out of Scope
- Any TypeScript or other source changes (engine, schema, MCP tools — already correct).
- Pi native `/eforge:config` overlay code outside the skill body (flag for follow-up only).
- Bumping `packages/pi-eforge/package.json` (per AGENTS.md "do not bump the Pi package version").
- Any new `/eforge:tiers` skill (user directive: keep skill surface minimal).
- Any other files.
- `pnpm test` runs (no code changes).

## Files

### Modify
- `eforge-plugin/skills/config/config.md` — restructure agent-related interview items into global/tier/per-role; rewrite resolution-chain prose to include tier; replace "eight roles default to balanced" with tier-driven framing; add `tiers:` block to the YAML Configuration Reference.
- `packages/pi-eforge/skills/eforge-config/SKILL.md` — mirror every change above, preserving the existing top-of-file Pi-overlay note and the `eforge_*` (no `mcp__eforge__` prefix) tool naming.
- `eforge-plugin/.claude-plugin/plugin.json` — patch-bump `version` from `0.9.0` to `0.9.1`.

## Verification

- [ ] `eforge-plugin/skills/config/config.md` contains a sentence introducing three-layer granularity (global → tier → per-role) above the "Sections to cover" list.
- [ ] `eforge-plugin/skills/config/config.md` has a new "Tier tuning" interview item between "Global agent defaults" and "Per-role overrides" that lists role membership for all four tiers and the built-in per-tier defaults (`implementation` → `effort=medium, modelClass=balanced`; `planning`/`review`/`evaluation` → `effort=high, modelClass=max`).
- [ ] The four tier role lists in `eforge-plugin/skills/config/config.md` exactly match the tier membership in `AGENT_ROLE_TIERS` at `packages/engine/src/pipeline/agent-config.ts:29-58` (no missing or extra roles per tier).
- [ ] `eforge-plugin/skills/config/config.md` lists per-tier knobs `effort`, `modelClass`, `model`, `thinking`, `maxTurns`, `maxBudgetUsd`, `allowedTools`, `disallowedTools`, `agentRuntime` in the tier section.
- [ ] `eforge-plugin/skills/config/config.md` documents the resolution chain as `plan override → per-role → per-tier → global → built-in per-role default → built-in per-tier default` and includes the model sub-chain (explicit `model` wins over `modelClass`; `modelClass` resolves via `agents.models.<class>`).
- [ ] `eforge-plugin/skills/config/config.md` no longer contains the substring "Eight roles" anywhere in the file.
- [ ] `eforge-plugin/skills/config/config.md` per-role section contains a sentence noting that `roles.<role>.tier` reassigns a role to a different tier.
- [ ] `eforge-plugin/skills/config/config.md` YAML Configuration Reference has a `tiers:` example block (commented) inside the `agents:` block, alongside the existing `roles:` example.
- [ ] `packages/pi-eforge/skills/eforge-config/SKILL.md` contains the same set of additions as the plugin file, with text differing only on (a) the preserved top-of-file Pi-overlay note and (b) MCP tool naming (`eforge_*` rather than `mcp__eforge__eforge_*`).
- [ ] `packages/pi-eforge/skills/eforge-config/SKILL.md` line 7 ("In Pi, the native `/eforge:config` command provides a richer interactive experience...") is present and unchanged.
- [ ] `eforge-plugin/.claude-plugin/plugin.json` `version` field equals `0.9.1`.
- [ ] `packages/pi-eforge/package.json` `version` field is unchanged from before the plan.
- [ ] Calling the `eforge_config` MCP tool with `{ action: "validate" }` against a hand-authored config that sets `agents.tiers.planning.modelClass: balanced` returns no schema errors (proves the YAML reference's new `tiers:` example matches what the schema accepts).
- [ ] `pnpm type-check` passes (sanity check that no TypeScript was inadvertently broken).
