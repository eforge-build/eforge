---
title: Add doc-update stage guidance and backfill missing documentation
created: 2026-03-29
status: pending
---

# Add doc-update stage guidance and backfill missing documentation

## Problem / Motivation

Several features shipped without documentation updates: Pi backend, tester agent, and daemon CLI/config. Investigation reveals the root cause - the planner prompt (`planner.md`) has no guidance on when to include `doc-update` in build stages. There is a "Test stage guidance" section (planner.md:368-372) telling the planner when to include/omit test stages, but nothing equivalent for `doc-update`. The planner is left to guess, and it often guesses wrong by omitting the stage. Additionally, existing docs (`docs/config.md` and `CLAUDE.md`) are now stale, missing coverage of shipped features.

## Goal

Ensure the planner reliably includes `doc-update` stages for user-facing changes by adding explicit guidance to planner prompts, and backfill the documentation gaps that have already accumulated.

## Approach

1. **Add doc-update stage guidance to planner prompts** - Insert a "Doc-update stage guidance" block in both `src/engine/prompts/planner.md` (after line 372) and `src/engine/prompts/module-planner.md` (after line 163), mirroring the pattern of the existing "Test stage guidance" section. The guidance defaults to including the stage since the doc-updater is cheap and will emit `count="0"` if nothing needs updating.

2. **Backfill `docs/config.md`** - Add new config sections showing actual defaults from `config.ts` for backend, Pi, daemon, and autoBuild settings.

3. **Backfill `CLAUDE.md`** - Add missing references for test build stages, tester/test-writer agents, daemon CLI commands, updated agent file count, and Pi config merge strategy.

4. **Verify accuracy** - Spot-check defaults against `src/engine/config.ts` DEFAULT_CONFIG. Run `pnpm type-check` and `pnpm build` to confirm no breakage (prompt changes only affect runtime behavior).

## Scope

**In scope:**

- `src/engine/prompts/planner.md` (~line 372) - add doc-update stage guidance block
- `src/engine/prompts/module-planner.md` (~line 163) - add matching doc-update stage guidance block
- `docs/config.md` - add sections for:
  - `backend` field (`'claude-sdk' | 'pi'`)
  - `pi` section (provider, model, thinkingLevel, extensions, compaction, retry) with experimental/untested note
  - `daemon` section (`idleShutdownMs`)
  - `autoBuild` in `prdQueue`
  - Brief Pi Backend section covering env vars and API key resolution
- `CLAUDE.md` - minimal additions:
  - Test build stages: `test-write`, `test`, `test-fix`, `test-cycle`
  - Tester and Test Writer agents (2 lines each)
  - Daemon CLI commands: `daemon start/stop/status/kill`
  - Update agent file count (15 -> 16)
  - Add `pi` to config merge strategy object list

**Out of scope:**

- N/A

## Acceptance Criteria

- `src/engine/prompts/planner.md` contains a "Doc-update stage guidance" section after the existing "Test stage guidance" block with the following rules:
  - Include `doc-update` (parallel with `implement`) when the plan changes CLI commands, config schema/defaults, agent behavior, pipeline stages, public API surface, or architecture
  - Omit for pure bug fixes, test-only changes, internal refactors with no user-facing impact
  - Default to including it
- `src/engine/prompts/module-planner.md` contains equivalent doc-update guidance after line 163
- `docs/config.md` documents `backend`, `pi`, `daemon`, and `autoBuild` config sections with defaults matching `src/engine/config.ts` DEFAULT_CONFIG
- `CLAUDE.md` lists test build stages (`test-write`, `test`, `test-fix`, `test-cycle`), Tester and Test Writer agents, daemon CLI commands (`daemon start/stop/status/kill`), updated agent file count (16), and `pi` in config merge strategy object list
- `pnpm type-check` passes
- `pnpm build` passes
