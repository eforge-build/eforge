---
id: plan-02-default-cli-flag
name: Flip CLI Default to Generate Profiles
depends_on: [plan-01-schema-driven-prompts]
branch: default-profile-generation-with-schema-driven-prompts/default-cli-flag
---

# Flip CLI Default to Generate Profiles

## Architecture Context

With schema-driven prompts and named profiles in place (plan-01), profile generation produces better results than name-based selection. This plan makes it the default by flipping the CLI flag and ensuring queue mode passes the option through.

## Implementation

### Overview

Replace `--generate-profile` (opt-in boolean) with `--no-generate-profile` (opt-out via Commander's `--no-` prefix convention). Update `eforge run` queue mode to pass `generateProfile` through to `compile()`. Update the `runQueue` method in `EforgeEngine` to accept and propagate `generateProfile`. Update CLAUDE.md CLI flags section.

### Key Decisions

1. Commander's `--no-<flag>` convention: `.option('--no-generate-profile', ...)` creates a `generateProfile` property that defaults to `true` and is set to `false` when `--no-generate-profile` is passed. This is exactly the semantics we want.
2. Queue mode needs `generateProfile` plumbed through `QueueOptions` → `runQueue()` → `compile()` calls. Default to `true` via `options.generateProfile ?? true` so queue mode generates profiles even when the option isn't explicitly set.
3. The `eforge run` normal mode's `allPhases()` generator already passes `options.generateProfile` to `compile()` - with the Commander default flip, this automatically becomes `true` without code changes in that path.

## Scope

### In Scope
- Changing `--generate-profile` to `--no-generate-profile` in `src/cli/index.ts` `run` command
- Adding `generateProfile?: boolean` to `QueueOptions` in `src/engine/eforge.ts`
- Passing `generateProfile: options.generateProfile ?? true` in `runQueue()`'s `compile()` call
- Passing `generateProfile` through in queue mode's `run` command (CLI → engine)
- Updating CLAUDE.md CLI flags section

### Out of Scope
- Schema changes (plan-01)
- Parser changes (plan-01)
- Prompt rewrites (plan-01)

## Files

### Modify
- `src/cli/index.ts` — Replace `.option('--generate-profile', 'Let the planner generate a custom workflow profile')` with `.option('--no-generate-profile', 'Disable custom profile generation (enabled by default)')`. In `--queue` mode action, pass `generateProfile` through to queue options. Verify the `allPhases()` path already passes `options.generateProfile` correctly (it does - line 323).
- `src/engine/eforge.ts` — Add `generateProfile?: boolean` to `QueueOptions` interface. In `runQueue()`, pass `generateProfile: options.generateProfile ?? true` to the `this.compile()` call at line 623.
- `CLAUDE.md` — Update CLI flags documentation: change `--generate-profile` reference to `--no-generate-profile` and note that profile generation is on by default.

## Verification

- [ ] `eforge run --help` shows `--no-generate-profile` (not `--generate-profile`)
- [ ] `eforge run --help` description mentions "enabled by default" or equivalent
- [ ] In CLI `run` command, `options.generateProfile` is `true` when no flag is passed (Commander `--no-` convention)
- [ ] In CLI `run` command, `options.generateProfile` is `false` when `--no-generate-profile` is passed
- [ ] `QueueOptions` interface in `eforge.ts` has `generateProfile?: boolean`
- [ ] `runQueue()` passes `generateProfile: options.generateProfile ?? true` to `compile()`
- [ ] The `--queue` mode in CLI passes `generateProfile` from options to the engine
- [ ] CLAUDE.md flags section lists `--no-generate-profile` instead of `--generate-profile`
- [ ] `pnpm type-check` passes
- [ ] `pnpm build` succeeds
