---
id: plan-01-console-to-events
name: Replace engine console.* with warning events and warnings return shape
depends_on: []
branch: hardening-04-engine-emission-hygiene/console-to-events
agents:
  builder:
    effort: high
    rationale: Signature change ripples across 4 packages and 2 test files; missed
      call sites caused 9 test failures in the previous attempt.
  reviewer:
    effort: high
    rationale: Verifying zero console.* in engine and that every
      loadConfig/parseRawConfig/resolveActiveProfileName caller destructures the
      new shape requires a complete sweep.
---

# Replace engine console.* with warning events and warnings return shape

## Architecture Context

Engine contract: **engine emits events, consumers render**. Five `console.error` calls in `packages/engine/src` bypass the event system, so subscribers (CLI renderer, monitor UI, CI integrations) miss structured diagnostics. This plan routes those warnings through the `EforgeEvent` union for contexts where an event stream exists, and through a `warnings: string[]` return channel for contexts where it does not (config loading at startup).

Key invariant: `packages/engine/src` must contain **zero** `console.log`/`console.warn`/`console.error` calls after this plan merges. Consumers (CLI, monitor server, debug-composer, pi-eforge extensions) own any stderr writes.

## Implementation

### Overview

1. Add two event variants to `EforgeEvent` in `packages/engine/src/events.ts`:
   - `{ type: 'config:warning'; message: string; source: string; details?: string }`
   - `{ type: 'plan:warning'; planId?: string; message: string; source: string; details?: string }`
2. Change `parseRawConfig()`, `loadConfig()`, and `resolveActiveProfileName()` in `packages/engine/src/config.ts` to return `{ ..., warnings: string[] }` instead of logging to stderr. The `ConfigMigrationError` throw path is unchanged.
3. Change `parsePlanFile()` and `parseOrchestrationConfig()` in `packages/engine/src/plan.ts` so that malformed `agents` blocks are collected as warnings on the returned object (add a `warnings: string[]` field to `PlanFile` and to the parsed orchestration object) rather than logged.
4. Update every caller to destructure the new shape. For callers with an active event stream, yield `config:warning`/`plan:warning` events for each warning. For early-startup callers without a stream (CLI bootstrap, debug-composer, monitor server startup, pi-eforge extensions), the consumer writes to `process.stderr` — the engine itself must not.
5. Add rendering for the new event types in the CLI renderer (`packages/eforge/src/cli/index.ts`) and monitor reducer (`packages/monitor-ui/src/lib/reducer.ts`).
6. Update `test/config.test.ts` and `test/config-backend-profile.test.ts` to match the new return shapes.

### Key Decisions

1. **`warnings: string[]` on the return shape**, not `warnings: Warning[]` with structured fields. The strings are user-facing diagnostic messages; consumers wrap them into `config:warning` events with `source` set to the caller (e.g., `'loadConfig'`, `'parseRawConfig'`, `'resolveActiveProfileName'`). This keeps the engine layer purely functional and defers event shaping to the caller.
2. **`parseRawConfig` returns `{ config, warnings }`** (change from returning `PartialEforgeConfig` directly). This is the leaf function that produces warnings on invalid fields, so the shape change must start here. All four engine call sites (`loadConfig`, `loadProfileFromPath`, and two in other config-load paths at lines 1025 and 1112) propagate warnings up.
3. **`resolveActiveProfileName` returns `{ name, source, warnings }`** (change from `{ name, source }`). The stale-marker warning is collected into `warnings` instead of logged. The `_staleMarkerWarnings` one-shot dedup set is **removed** — deduplication moves to the consumer, which can decide whether to suppress repeats (or not).
4. **`PlanFile.warnings` and parsed-orchestration `warnings`** carry malformed-agents-block warnings. Callers that consume these (plan execution, orchestration execution) yield `plan:warning` events before continuing.
5. **Bootstrap consumers write to `process.stderr` directly**. The CLI command handlers, `debug-composer.ts`, monitor startup, and pi-eforge extensions print warnings with a `[eforge]` prefix preserving current user-visible output.
6. **CLI renderer prints `config:warning`/`plan:warning` events** during interactive builds using the same prefix format, so mid-build warnings surface uniformly with bootstrap warnings.

## Scope

### In Scope
- Add `config:warning` and `plan:warning` variants to `EforgeEvent`.
- Change signatures of `parseRawConfig`, `loadConfig`, `resolveActiveProfileName`, `parsePlanFile`, `parseOrchestrationConfig` to carry warnings.
- Remove all five `console.error` calls in `packages/engine/src/config.ts` and `packages/engine/src/plan.ts`.
- Update every caller across engine, eforge CLI, monitor, monitor-ui, pi-eforge extensions, and tests.
- CLI renderer and monitor reducer handle new event types.
- Emit `plan:warning` events from engine call sites that have access to the event stream (plan execution inside `pipeline.ts`, orchestration loader inside `eforge.ts`).

### Out of Scope
- forgeCommit sweep (plan-02).
- Prompt variable enforcement (plan-03).
- Adding schema validation beyond what exists in `packages/engine/src/schemas.ts`.
- Structured logging infra (pino/winston).
- Retry policy (PRD 06).

## Files

### Modify
- `packages/engine/src/events.ts` — add `config:warning` and `plan:warning` to the `EforgeEvent` union.
- `packages/engine/src/config.ts` — change `parseRawConfig()` to return `{ config, warnings }`; change `loadConfig()` to return `{ config, warnings }`; change `resolveActiveProfileName()` to return `{ name, source, warnings }`; drop `_staleMarkerWarnings` set; remove `console.error` at lines 392, 524, 866; update internal callers at lines 691, 720, 910, 1025, 1112. Preserve legacy-eforge.yaml detection behavior via warning string instead of stderr write.
- `packages/engine/src/plan.ts` — add `warnings: string[]` to `PlanFile` interface and to the parsed orchestration return object; replace `console.error` at lines 162 and 212 with warnings pushes; remove `console.error` imports if unused.
- `packages/engine/src/eforge.ts` — destructure `{ config, warnings }` from `loadConfig(cwd)` at line 149; yield `config:warning` events for each warning via the active event stream (follow the existing event yield pattern in this file).
- `packages/engine/src/pipeline.ts` — when loading plan files or orchestration config inside a pipeline run, yield `plan:warning` events for each warning returned by `parsePlanFile`/`parseOrchestrationConfig` before using the parsed value.
- `packages/eforge/src/cli/index.ts` — destructure `{ config: resolvedConfig, warnings }` from `loadConfig(cwd)` at line 112 and from the additional calls at lines 462, 645; print each warning to `process.stderr` with `[eforge]` prefix from the consumer side; add handling for `config:warning` and `plan:warning` events in the event renderer so mid-build warnings surface.
- `packages/eforge/src/cli/debug-composer.ts` — destructure `{ config: projectConfig, warnings }` from `parseRawConfig(...)` at line 89; destructure `{ name, source, warnings }` from `resolveActiveProfileName(...)` at line 99; write each warning to `process.stderr`.
- `packages/monitor/src/server.ts` — destructure `{ name, source, warnings }` from `resolveActiveProfileName(...)` at lines 922 and 945; destructure `{ config: resolved, warnings }` from `loadConfig(...)` at line 1143; write each warning to `process.stderr` from the server-startup path.
- `packages/monitor/src/server-main.ts` — destructure `{ config, warnings }` from `loadConfig(cwd)` at line 434; write each warning to `process.stderr`.
- `packages/monitor-ui/src/lib/reducer.ts` — handle `config:warning` and `plan:warning` event types. A `console.log` in the UI reducer is acceptable — the requirement is that the events flow; visual surfacing is optional.
- `packages/pi-eforge/extensions/**` — destructure the new shape at every `loadConfig`/`parseRawConfig`/`resolveActiveProfileName`/`findConfigFile` call site (use `rg 'loadConfig\(|resolveActiveProfileName\(|parseRawConfig\(|findConfigFile\(' packages/pi-eforge` to find all sites). For each warning, write to `process.stderr` from the extension layer.
- `test/config.test.ts` — rewrite each `await loadConfig(tmpDir)` call site (lines 322, 344) to destructure `{ config, warnings }`; update assertions to match the new shape; add at least one new assertion that warnings are emitted (not thrown) for invalid field values.
- `test/config-backend-profile.test.ts` — **MUST be updated**. Rewrite the 4 `const cfg = await loadConfig(projectDir)` sites (around lines 361, 381, 402, 949) to `const { config: cfg } = await loadConfig(projectDir);`. Update all 8 `expect(result).toEqual({ name, source })` assertions on `resolveActiveProfileName` (around lines 515, 529, 539, 552, 788, 807, 823, 829, 839) to include the `warnings: [...]` key — empty array for happy paths, and the stale-marker warning string for the two stale-marker edge cases (look for tests that exercise the `{ name: null, source: 'missing' }` path and a user-marker fallback after a stale project marker).
- **Any additional callers found** by running `rg -l 'loadConfig\(|resolveActiveProfileName\(|parseRawConfig\(|findConfigFile\(' test/ packages/` — every hit must destructure the new `{ ..., warnings }` shape.

## Verification

- [ ] `rg 'console\.(log|warn|error)' packages/engine/src` returns zero hits.
- [ ] `EforgeEvent` union in `packages/engine/src/events.ts` contains `config:warning` and `plan:warning` variants with exactly the fields specified in the PRD.
- [ ] `loadConfig` return type is `Promise<{ config: EforgeConfig; warnings: string[] }>`.
- [ ] `parseRawConfig` return type is `{ config: PartialEforgeConfig; warnings: string[] }`.
- [ ] `resolveActiveProfileName` return type is `Promise<{ name: string | null; source: ActiveProfileSource; warnings: string[] }>`.
- [ ] `rg -l 'loadConfig\(|resolveActiveProfileName\(|parseRawConfig\(|findConfigFile\(' test/ packages/` — every listed file compiles against the new shape (run `pnpm type-check` to confirm).
- [ ] `test/config-backend-profile.test.ts` passes with 0 failures.
- [ ] `test/config.test.ts` passes and includes at least one test that asserts a warning is returned for an invalid config field.
- [ ] CLI renderer prints `config:warning` events with `[eforge]` prefix to stderr during `eforge build` against a project with an intentionally malformed `eforge/config.yaml` field.
- [ ] Monitor reducer in `packages/monitor-ui/src/lib/reducer.ts` contains case branches for `config:warning` and `plan:warning` event types.
- [ ] `pnpm test` passes.
- [ ] `pnpm type-check` passes.
- [ ] `pnpm build` passes.
