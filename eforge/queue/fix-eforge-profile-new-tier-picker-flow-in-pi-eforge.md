---
title: Fix `/eforge:profile:new` tier-picker flow in pi-eforge
created: 2026-05-01
---

# Fix `/eforge:profile:new` tier-picker flow in pi-eforge

## Problem / Motivation

Two issues with the interactive new-profile flow surfaced while creating a multi-harness profile (planner + implementation already configured, on review step):

1. **Hardcoded `max` / `balanced` / `fast` presets are misleading.** They are claude-sdk-only and use value-laden labels ("max" implying best). They don't reflect multi-harness use (e.g. pi + qwen) and aren't a useful starting point for users running anything other than vanilla claude-sdk.
2. **"Copy from previous tier" only shows the *immediately* previous tier.** On the review tier, only `Copy from implementation` shows, even though planning was already configured this session. Code at `packages/pi-eforge/extensions/eforge/profile-commands.ts:357-358` indexes only `TIER_ORDER[i - 1]`.

## Goal

Replace the misleading hardcoded presets with a session-aware tier-picker that offers one `Copy from <tier>` entry per tier already configured in the current session, plus `Custom`, so multi-harness profile creation works correctly across all tiers.

## Approach

Decisions (confirmed with user):
- Remove the three preset shortcuts entirely. First tier shows only `Custom`. Subsequent tiers show one `Copy from <tier>` per prior tier configured this session, plus `Custom`.
- Scope is in-session only — no cross-profile lookup.

### 1. `packages/pi-eforge/extensions/eforge/profile-commands.ts`

- Delete the `PresetName` type and `PRESETS` constant (lines 159-167).
- In `handleProfileNewCommand` (around lines 354-421):
  - Remove `prevTier` / `prevSelection` single-tier lookups.
  - Drop the three `__preset_*` choice items.
  - Replace the single `__copy_prev__` entry with a loop over already-configured tiers in `tierSelections` (in `TIER_ORDER` order) that emits one `__copy_<tierName>__` choice per prior tier, labeled `Copy from <tierName> (<modelId>)` with the same description format already in use.
  - Replace the `__preset_*` / `__copy_prev__` branches in the choice handler with a `__copy_<tierName>__` branch that spreads `tierSelections[tierName]`.
  - For the `Custom` fallback's `defaultHarness` / `defaultProvider` inference, keep using the immediately previous tier (`TIER_ORDER[i - 1]`) as the seed — this preserves the "Pi flow defaults to keeping the same provider" UX without resurrecting the old `prevSelection` variable shape. If no prior tier exists, fall back to the existing `name.startsWith("claude-")` heuristic.

### 2. `eforge-plugin/skills/profile-new/profile-new.md`

The Claude Code plugin's skill markdown documents the same flow (per AGENTS.md "keep eforge-plugin and pi-eforge in sync"). Update Step 2 (lines 31-50):
- Remove the **Preset shortcuts** subsection (max / balanced / fast bullets).
- Change **Copy from previous tier** to **Copy from a previously configured tier**: "From the second tier onward, offer one entry per tier already configured in this session (e.g. on review: `Copy from planning` and `Copy from implementation`). Default to copy-from-immediately-previous when the user just presses enter."
- Remove the "no copy from previous for planning" note (line 48) — replace with: "For the **planning** tier present only **Custom**, since no prior tier exists yet."

### 3. `eforge-plugin/.claude-plugin/plugin.json`

Bump plugin version (per AGENTS.md: "Always bump the plugin version when changing anything in the plugin").

## Scope

### In scope

- `packages/pi-eforge/extensions/eforge/profile-commands.ts` — flow code
- `eforge-plugin/skills/profile-new/profile-new.md` — skill docs (parity)
- `eforge-plugin/.claude-plugin/plugin.json` — version bump

### Out of scope

- Cross-profile lookup (session-only scope).
- Any preset shortcut system (removed entirely, not replaced).

## Acceptance Criteria

1. `pnpm build` from repo root — must succeed (tsup bundles pi-eforge).
2. `pnpm type-check` — no TS errors.
3. Manual walkthrough of `/eforge:profile:new test-fix` in the Pi UI on a project with eforge initialized:
   - **Planning tier:** only `Custom` is offered. No preset entries.
   - Configure planning with e.g. `pi · openrouter · qwen-2.5-72b · medium`.
   - **Implementation tier:** `Copy from planning (qwen-2.5-72b)` and `Custom` are the only entries.
   - Configure implementation with e.g. `claude-sdk · claude-sonnet-4-6 · medium`.
   - **Review tier:** both `Copy from planning (qwen-2.5-72b)` and `Copy from implementation (claude-sonnet-4-6)` appear, in that order, plus `Custom`. **This is the bug fix.**
   - **Evaluation tier:** all three `Copy from <tier>` entries appear plus `Custom`.
4. Choosing `Copy from planning` on review must produce a review tier identical to planning in the YAML preview (Step 3 of the flow).
5. Sanity-check the Claude Code plugin path by reading the updated `profile-new.md` skill — the workflow text should match the new behavior.
