---
id: plan-01-consolidate-shared-types
name: Consolidate shared types and constants into @eforge-build/client
depends_on: []
branch: hardening-01-consolidate-shared-types-and-constants-into-eforge-build-client/consolidate
---

# Consolidate shared types and constants into @eforge-build/client

## Architecture Context

`@eforge-build/client` is the shared, zero-engine-dep package whose types cross the daemon HTTP boundary. Several types and constants that should flow from this single owner are currently duplicated across `packages/engine/src/config.ts`, `packages/client/src/types.ts`, `packages/monitor/src/server.ts`, `packages/monitor-ui/src/lib/types.ts`, `packages/eforge/src/cli/mcp-proxy.ts`, and `packages/pi-eforge/extensions/eforge/index.ts`. The `ReviewProfileConfig` duplicates have already drifted - the engine definition carries an `autoAcceptBelow` field that the other declarations silently drop during JSON serialization across the HTTP boundary.

The engine uses Zod schemas (`packages/engine/src/config.ts`, `packages/engine/src/schemas.ts`) as the validation source of truth. After consolidation, the hand-written TypeScript types live in `@eforge-build/client` and the engine's Zod schemas must be re-bound to those shared types via `z.ZodType<ReviewProfileConfig>` so validation stays aligned with the shared interface.

## Implementation

### Overview

One change set, applied in order:

1. Promote `ReviewProfileConfig` (including `autoAcceptBelow`) and `BuildStageSpec` in `packages/client/src/types.ts`; re-export from `packages/client/src/index.ts`.
2. Move `LOCKFILE_POLL_INTERVAL_MS` and `LOCKFILE_POLL_TIMEOUT_MS` into `packages/client/src/lockfile.ts`; re-export from `packages/client/src/index.ts`.
3. Add a JSDoc file header to `packages/client/src/event-to-progress.ts` describing the `EforgeEvent` -> `DaemonStreamEvent` mapping. Add a keep-in-sync banner above the `DaemonStreamEvent` interface in `packages/client/src/session-stream.ts`.
4. Delete duplicate declarations in `packages/monitor/src/server.ts`, `packages/monitor-ui/src/lib/types.ts`, and `packages/engine/src/config.ts`. Each imports from `@eforge-build/client`; engine re-exports so engine-internal call sites stay unchanged. Zod schemas in `packages/engine/src/config.ts` and `packages/engine/src/schemas.ts` bind via `z.ZodType<ReviewProfileConfig>` to keep validation aligned.
5. Update `packages/eforge/src/cli/mcp-proxy.ts` and `packages/pi-eforge/extensions/eforge/index.ts` to import the lockfile polling constants from `@eforge-build/client`.
6. Add `@eforge-build/client` as a workspace dependency on `packages/monitor-ui/package.json` (monitor-ui currently only depends on `@eforge-build/engine`).
7. `pnpm build` and `pnpm type-check` across the workspace.

### Key Decisions

1. **Client owns the hand-written TypeScript type; engine owns the Zod validator.** Moving the interface to client gives us one owner across the HTTP boundary. Binding the engine's Zod schema via `z.ZodType<ReviewProfileConfig>` keeps validation aligned with the shared type without duplicating the field list.
2. **Engine re-exports from client, not the reverse.** Client cannot depend on engine (would break the zero-engine-dep contract). Engine already depends on client, so engine imports the shared types and re-exports them so engine-internal callers (`plan.ts`, `eforge.ts`, `pipeline.ts`, `compiler.ts`, `events.ts`, `agents/*.ts`) do not need to change their import paths.
3. **Monitor-ui gains a direct `@eforge-build/client` dependency.** It already depends on `@eforge-build/engine`, but the consolidation is the natural moment to depend on `client` directly since the types now live there.
4. **Re-export from monitor-ui's `lib/types.ts`** so downstream callers (`@/lib/types`) do not need to change import paths. Only the source of truth moves.
5. **No behavioral change to `autoAcceptBelow` in the UI.** The engine config field is already wired end-to-end (engine `pipeline.ts` consumes it). This PRD's important outcome is that the field survives HTTP serialization. The monitor UI `build-config.tsx` can display it as an additional pill if present; if it looks busy, keep rendering unchanged and let the field round-trip through the types.

## Scope

### In Scope
- Promoting `ReviewProfileConfig` (with `autoAcceptBelow?: 'suggestion' | 'warning'` optional) and `BuildStageSpec` in `packages/client/src/types.ts`, plus re-exports from the package entrypoint.
- Moving `LOCKFILE_POLL_INTERVAL_MS = 250` and `LOCKFILE_POLL_TIMEOUT_MS = 5000` into `packages/client/src/lockfile.ts` and re-exporting them.
- Deleting the duplicate declarations in `packages/monitor/src/server.ts` (lines ~323-330), `packages/monitor-ui/src/lib/types.ts` (lines ~58-65), and `packages/engine/src/config.ts` (the hand-written `export type ReviewProfileConfig = ...` and `export type BuildStageSpec = ...`). Engine re-exports from client so every other engine file's imports stay unchanged.
- Rebinding the Zod schema `reviewProfileConfigSchema` in `packages/engine/src/config.ts` via `z.ZodType<ReviewProfileConfig>` so the shared type stays the source of truth for validation. Do the same for `pipelineReviewProfileConfigSchema` in `packages/engine/src/schemas.ts`.
- Updating `packages/eforge/src/cli/mcp-proxy.ts:541-542` and `packages/pi-eforge/extensions/eforge/index.ts:44-45` to import the lockfile polling constants from `@eforge-build/client`.
- Adding `@eforge-build/client: workspace:*` to `packages/monitor-ui/package.json` dependencies.
- Adding a file-header JSDoc to `packages/client/src/event-to-progress.ts` stating: "This module maps engine-emitted `EforgeEvent`s (defined in `@eforge-build/engine/events`) onto the wire-format `DaemonStreamEvent` (defined in this package) that consumers receive over `/api/events/:session` SSE. The engine event is the source of truth; `DaemonStreamEvent` is its serialized form. When engine events grow a new field, update the mapper and `DaemonStreamEvent` together."
- Adding a `// Serialized form of EforgeEvent - keep in sync with event-to-progress.ts` banner immediately above the `DaemonStreamEvent` interface in `packages/client/src/session-stream.ts`.

### Out of Scope
- Changing the shape of `ReviewProfileConfig` or `BuildStageSpec` beyond adding `autoAcceptBelow` to the client declaration (the field already exists in the engine).
- Introducing `API_ROUTES` or typed request helpers.
- Narrowing the `@eforge-build/client` public surface.
- Any wholesale redesign of the monitor-ui build-config display beyond optionally surfacing `autoAcceptBelow`.
- Changing `LOCKFILE_POLL_*` numeric values.
- Any changes to the SSE wire format, reconnect policy, or `eventToProgress` filtering behavior.

## Files

### Create
None. All changes are edits to existing files.

### Modify
- `packages/client/src/types.ts` - Extend `ReviewProfileConfig` with optional `autoAcceptBelow?: 'suggestion' | 'warning'`. Keep `BuildStageSpec = string | string[]`. Add brief comments noting these are the single owners.
- `packages/client/src/index.ts` - `BuildStageSpec` and `ReviewProfileConfig` are already re-exported - no change needed for types. Add exports for `LOCKFILE_POLL_INTERVAL_MS` and `LOCKFILE_POLL_TIMEOUT_MS` from `./lockfile.js`.
- `packages/client/src/lockfile.ts` - Add `export const LOCKFILE_POLL_INTERVAL_MS = 250;` and `export const LOCKFILE_POLL_TIMEOUT_MS = 5000;` near the top of the file alongside existing constants.
- `packages/client/src/event-to-progress.ts` - Replace or augment the existing file-header JSDoc with the PRD's specified text describing the `EforgeEvent` -> `DaemonStreamEvent` mapping contract.
- `packages/client/src/session-stream.ts` - Add a one-line banner comment `// Serialized form of EforgeEvent - keep in sync with event-to-progress.ts` immediately above the `export interface DaemonStreamEvent { ... }` declaration.
- `packages/engine/src/config.ts` - Remove the hand-written `export type ReviewProfileConfig = z.output<typeof reviewProfileConfigSchema>;` and `export type BuildStageSpec = string | string[];`. Import both from `@eforge-build/client` and re-export them (`export type { ReviewProfileConfig, BuildStageSpec } from '@eforge-build/client';`). Rebind `reviewProfileConfigSchema` so it satisfies `z.ZodType<ReviewProfileConfig>` (annotate the constant type so TypeScript errors if the Zod schema drifts from the shared interface). Leave `DEFAULT_REVIEW` as-is - it already produces a valid `ReviewProfileConfig` (with `autoAcceptBelow` omitted = undefined).
- `packages/engine/src/schemas.ts` - Rebind `pipelineReviewProfileConfigSchema` via `z.ZodType<ReviewProfileConfig>` so the schema used in pipeline composer agent output validation aligns with the shared type. Import the shared type from `@eforge-build/client`.
- `packages/monitor/src/server.ts` - Delete the local `type BuildStageSpec = string | string[];` and `interface ReviewProfileConfig { ... }` declarations (~lines 323-329). Import them at the top of the file from `@eforge-build/client` so `PlanResponse` continues to typecheck. Confirm the dynamic object cast on lines 300-306 preserves `autoAcceptBelow` (no code change expected - the object is built dynamically, so the field round-trips naturally once `ReviewProfileConfig` includes it).
- `packages/monitor-ui/src/lib/types.ts` - Delete the local `export type BuildStageSpec = ...` and `export interface ReviewProfileConfig { ... }` declarations (~lines 58-65). Replace with `export type { BuildStageSpec, ReviewProfileConfig } from '@eforge-build/client';` so every existing `@/lib/types` importer (see `build-config.tsx`, `plan-card.tsx`, `thread-pipeline.tsx`, `reducer.ts`) continues to resolve the same names.
- `packages/monitor-ui/package.json` - Add `"@eforge-build/client": "workspace:*"` to the `dependencies` block (currently only depends on `@eforge-build/engine`).
- `packages/eforge/src/cli/mcp-proxy.ts` - Delete the function-local `const LOCKFILE_POLL_INTERVAL_MS = 250;` and `const LOCKFILE_POLL_TIMEOUT_MS = 5000;` on lines 541-542. Add `LOCKFILE_POLL_INTERVAL_MS, LOCKFILE_POLL_TIMEOUT_MS` to the existing `import { ... } from '@eforge-build/client';` at the top of the file.
- `packages/pi-eforge/extensions/eforge/index.ts` - Delete the module-level `const LOCKFILE_POLL_INTERVAL_MS = 250;` and `const LOCKFILE_POLL_TIMEOUT_MS = 5000;` on lines 44-45. Add both constants to the existing `import { ... } from '@eforge-build/client';` at the top (line 17).
- `packages/monitor-ui/src/components/plans/build-config.tsx` - Optional: add a small display pill for `review.autoAcceptBelow` when present (e.g., `{review.autoAcceptBelow && <span ...>auto-accept: {review.autoAcceptBelow}</span>}`). If the visual footprint is undesirable, leave rendering unchanged and rely on the type round-tripping. Keep the change minimal.

## Verification

- [ ] `pnpm type-check` exits 0 across the workspace.
- [ ] `pnpm build` exits 0 across the workspace.
- [ ] `pnpm test` exits 0 (existing `test/review-strategy-wiring.test.ts` covers `autoAcceptBelow` behavior and must continue to pass).
- [ ] `rg "^export interface ReviewProfileConfig|^interface ReviewProfileConfig"` from the repo root returns exactly one hit, in `packages/client/src/types.ts`.
- [ ] `rg "interface BuildStageSpec|type BuildStageSpec"` returns exactly one hit, in `packages/client/src/types.ts`.
- [ ] `rg "LOCKFILE_POLL_(INTERVAL|TIMEOUT)_MS = "` returns exactly two hits, both in `packages/client/src/lockfile.ts` (one per constant).
- [ ] `packages/client/src/types.ts` `ReviewProfileConfig` includes `autoAcceptBelow?: 'suggestion' | 'warning'`.
- [ ] `packages/client/src/index.ts` re-exports `LOCKFILE_POLL_INTERVAL_MS` and `LOCKFILE_POLL_TIMEOUT_MS`.
- [ ] `packages/engine/src/config.ts` no longer declares a standalone TS type for `ReviewProfileConfig` or `BuildStageSpec`; both are imported from `@eforge-build/client` and re-exported. `reviewProfileConfigSchema` is typed `z.ZodType<ReviewProfileConfig>` so a type mismatch between the Zod schema and the shared interface produces a compile error.
- [ ] `packages/engine/src/schemas.ts` `pipelineReviewProfileConfigSchema` is typed `z.ZodType<ReviewProfileConfig>`.
- [ ] `packages/monitor/src/server.ts` has no local `BuildStageSpec` or `ReviewProfileConfig` declaration; both are imported from `@eforge-build/client`.
- [ ] `packages/monitor-ui/src/lib/types.ts` re-exports `BuildStageSpec` and `ReviewProfileConfig` from `@eforge-build/client` (no local declaration).
- [ ] `packages/monitor-ui/package.json` declares `@eforge-build/client: workspace:*` in `dependencies`.
- [ ] `packages/client/src/event-to-progress.ts` file-header JSDoc contains the exact phrases "maps engine-emitted `EforgeEvent`s", "`DaemonStreamEvent`", and "source of truth".
- [ ] `packages/client/src/session-stream.ts` has a line matching `// Serialized form of EforgeEvent - keep in sync with event-to-progress.ts` immediately above `export interface DaemonStreamEvent`.
- [ ] Manual: place `autoAcceptBelow: suggestion` under a plan's `review:` block in an `orchestration.yaml`, enqueue a build, and confirm the field appears in the `/api/orchestration/:id` response body (the monitor's `readBuildConfigFromOrchestration` path already reads it from YAML; confirm JSON serialization carries it through).