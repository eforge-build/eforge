---
title: Lower built-in default model class to `balanced` for builder, fixers, and test agents
created: 2026-04-22
---

# Lower built-in default model class to `balanced` for builder, fixers, and test agents

## Problem / Motivation

Today every "real work" agent in eforge defaults to the `max` model class, which on the `claude-sdk` backend resolves to `claude-opus-4-7`. For some roles this is overkill: the builder, the two fixer roles, and the test agents do tightly-scoped, well-specified work that Sonnet handles well, and running them on Opus burns budget without a proportional quality gain.

## Goal

Move the *built-in* default for five roles (`builder`, `review-fixer`, `validation-fixer`, `test-writer`, `tester`) from `max` to `balanced` so every project that hasn't explicitly overridden them benefits without needing per-project config. Users who still want Opus for these roles can opt back in via `agents.roles.<role>.modelClass: max` in `eforge/config.yaml`. `merge-conflict-resolver` stays at `max` (not requested).

## Approach

### 1. Engine defaults

**File:** `packages/engine/src/pipeline.ts` (lines 447-471, the `AGENT_MODEL_CLASSES` map)

Flip these five entries from `'max'` to `'balanced'`:

```ts
builder: 'balanced',
'review-fixer': 'balanced',
'validation-fixer': 'balanced',
'test-writer': 'balanced',
tester: 'balanced',
```

Leave the other 18 roles untouched. The resolution chain in `resolveAgentConfig` (same file, lines 491-590) and `MODEL_CLASS_DEFAULTS` (lines 474-485) need no changes - they already map `balanced` → `claude-sonnet-4-6` for `claude-sdk` and walk the fallback tier list for `pi`.

### 2. Tests

**File:** `test/pipeline.test.ts`

- **Line 532-545** ("resolveAgentConfig returns model class default for SDK fields when not configured"): the test asserts `builder` resolves to `{ id: 'claude-opus-4-7' }`. Update the comment on line 536 and the assertion on line 537 to expect `{ id: 'claude-sonnet-4-6' }` (balanced default for `claude-sdk`).
- **Line 815** ("No model configured for role 'builder'..."): the error-message assertion bakes in `model class "max"`. Update the regex to `model class "balanced".*backend "pi".*Tried fallback: max, fast` (the fallback walks ascending then descending - confirm the exact wording by re-reading the error builder near the top of `resolveAgentConfig`'s pi branch before editing).
- **Line 772-779** (`per-role modelClass override to balanced resolves to sonnet on claude-sdk`): this test overrides builder to `balanced` to prove the override path. With the new default it tests the same value as the default - keep it (it still proves the override mechanism works) but consider switching the override to `'max'` so it still proves *some* delta. Pick whichever is clearer; either is fine.

Run `pnpm test` and fix any other assertions that break (search for the exact strings `'claude-opus-4-7'`, `claude-opus-4-7`, `'max'` in the `test/` directory and triage). Don't blanket-update - only the tests whose meaning was "builder/fixer/test-* default to max" should change.

### 3. Documentation

**File:** `docs/config.md`

- Lines 124, 133-134, 138-139 in the per-role default class table: change `max` → `balanced` for `builder`, `validation-fixer`, `review-fixer`, `test-writer`, `tester`.
- Line 195 (fallback example narrative): the example uses `builder` as a "max-defaulting role". Replace the example role with `reviewer` (or `planner`) so the narrative still illustrates a max-tier fallback.

**File:** `packages/pi-eforge/skills/eforge-config/SKILL.md` (line 48)

The note reads: *"`staleness-assessor`, `prd-validator`, and `dependency-detector` default to `balanced`; all others default to `max`."* Rewrite to list both groups explicitly, e.g.: *"`builder`, `validation-fixer`, `review-fixer`, `test-writer`, `tester`, `staleness-assessor`, `prd-validator`, and `dependency-detector` default to `balanced`; all others default to `max`."*

**File:** `eforge-plugin/skills/config/config.md` (line 46)

Same wording change as the SKILL.md above. Keep the two files in sync per AGENTS.md ("Keep `eforge-plugin/` and `packages/pi-eforge/` in sync").

### 4. Plugin version bump

**File:** `eforge-plugin/.claude-plugin/plugin.json`

Bump the patch version. Per AGENTS.md: *"Always bump the plugin version when changing anything in the plugin"* - the config skill prose changed.

## Scope

### In scope

- Changing the default model class from `max` to `balanced` for five roles: `builder`, `review-fixer`, `validation-fixer`, `test-writer`, `tester`.
- Updating engine defaults in `packages/engine/src/pipeline.ts`.
- Updating affected tests in `test/pipeline.test.ts`.
- Updating documentation in `docs/config.md`, `packages/pi-eforge/skills/eforge-config/SKILL.md`, and `eforge-plugin/skills/config/config.md`.
- Bumping the plugin patch version in `eforge-plugin/.claude-plugin/plugin.json`.

### Out of scope

- `MODEL_CLASS_DEFAULTS` (the class → ModelRef map) is untouched. Sonnet is already wired up.
- `merge-conflict-resolver` stays `max` per the scoping question.
- No CHANGELOG edits (release flow owns it - per memory `feedback_changelog_managed_by_release.md`).
- No new config knobs - users already have `agents.roles.<role>.modelClass` to opt back to `max`.

## Acceptance Criteria

1. `pnpm type-check` passes, confirming the `AGENT_MODEL_CLASSES` map still satisfies `Record<AgentRole, ModelClass>`.
2. `pnpm test` passes, confirming the resolution tests pass with the new defaults.
3. Targeted sanity check: a one-off script (or a small added test) calls `resolveAgentConfig('builder', DEFAULT_CONFIG, 'claude-sdk')` and asserts `model.id === 'claude-sonnet-4-6'`. Same holds for `review-fixer`, `validation-fixer`, `test-writer`, `tester`. `reviewer` still resolves to `claude-opus-4-7` (regression guard).
4. End-to-end: running an `eforge-build` against a small fixture project (or using `mcp__plugin_eforge_eforge__eforge_enqueue` with a trivial PRD) shows the monitor stage hover displaying Sonnet for builder/fixer stages and Opus for planner/reviewer stages. Per memory `feedback_surface_runtime_decisions_in_monitor.md`, the resolved model is already surfaced in the monitor UI.
5. `docs/config.md` and the two skill files render the updated default-class table/note correctly.
6. Critical files touched:
   - `packages/engine/src/pipeline.ts` (defaults map)
   - `test/pipeline.test.ts` (assertions)
   - `docs/config.md` (default-class table + fallback example)
   - `packages/pi-eforge/skills/eforge-config/SKILL.md` (default note)
   - `eforge-plugin/skills/config/config.md` (default note)
   - `eforge-plugin/.claude-plugin/plugin.json` (version bump)
