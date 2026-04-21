---
id: plan-03-pi-follow-parity
name: "Pi extension parity: eforge_follow tool and command wiring"
depends_on:
  - plan-01-client-subscribe-helper
  - plan-02-mcp-follow-tool
branch: real-time-build-feedback-for-the-eforge-claude-code-plugin-and-pi-parity/pi-follow-parity
---

# Pi extension parity: eforge_follow tool and command wiring

## Architecture Context

AGENTS.md mandates cross-consumer parity: any user-facing capability exposed in `eforge-plugin/` (Claude Code) must also exist in `packages/pi-eforge/` (Pi extension) when technically feasible. Plan-02 adds `eforge_follow` to the Claude Code plugin via MCP `notifications/progress`. Pi does not use MCP, but its tool contract exposes an `onUpdate(message)` callback on `execute(_toolCallId, params, signal, onUpdate, ctx)` - currently unused across all eforge Pi tools in `packages/pi-eforge/extensions/eforge/index.ts`.

This plan mirrors the Claude Code capability on the Pi side using the same `subscribeToSession()` helper from `@eforge-build/client` (plan-01) and pushing high-signal progress through `onUpdate`. The command aliases `/eforge:build` and `/eforge:status` that map to skill entry points in `packages/pi-eforge/skills/` are updated to chain follow after enqueue.

## Implementation

### Overview

1. **Register `eforge_follow` Pi tool** in `packages/pi-eforge/extensions/eforge/index.ts` near the existing `eforge_build` registration (around lines 215-235). Use Typebox schema `Type.Object({ sessionId: Type.String(), timeoutMs: Type.Optional(Type.Number()) })`.
2. **Implement `execute`** that:
   - Calls `subscribeToSession(params.sessionId, { onEvent, signal, cwd: ctx.cwd })` from `@eforge-build/client`
   - Uses the same `eventToProgress()` mapping from plan-02 - **extract that mapping** into a shared module at `packages/client/src/event-to-progress.ts` so both MCP and Pi consume the same mapping (see Files section). Plan-02 will need a follow-up reference to this shared helper; plan-03 does this extraction so both consumers share a single source of truth.
   - For each mapped event, calls `onUpdate(message)` with the human-readable string
   - Resolves with the `SessionSummary` as the tool result via `jsonResult(summary)` matching the pattern used by existing Pi tools
   - Honors `signal` for cancellation
3. **Update Pi skills** for `/eforge:build` and `/eforge:status` in `packages/pi-eforge/skills/eforge-build/` and `packages/pi-eforge/skills/eforge-status/` (whichever format they use) so they chain `eforge_follow` after enqueue / when a running session is detected. Follow the exact same UX pattern as plan-02's plugin skill updates.
4. **Add renderCall / renderResult** for the new tool consistent with other Pi tools (uses `ui-helpers.ts` theme).

### Shared eventToProgress helper

To avoid drift between MCP and Pi progress messages, this plan extracts `eventToProgress()` into `packages/client/src/event-to-progress.ts` and exports it from `@eforge-build/client`. Plan-02 places the helper inline in `mcp-proxy.ts`; this plan moves it to the shared package and updates `mcp-proxy.ts` to import it.

**Coordination note for the builder**: because plan-02 and plan-03 both depend on plan-01 (not on each other), but this plan touches `mcp-proxy.ts` to rewire the import, plan-03 must merge after plan-02. The engine will order them via `depends_on`. Ensure the dependency edge `plan-03 -> plan-02` is added in orchestration.yaml.

### Key Decisions

1. **Share `eventToProgress()` via `@eforge-build/client`**: single source of truth prevents the two consumer surfaces from drifting on high-signal event messages.
2. **Use `onUpdate` rather than a custom UI overlay**: Pi's tool contract is the intended mechanism; matches the rest of the Pi ecosystem and renders inline.
3. **Command aliases chain follow, not the tool itself**: the aliases (`/eforge:build`, `/eforge:status`) in `index.ts` lines 1101-1146 delegate to skills; the skills gain the new chaining instructions, keeping transport and skill logic separate.
4. **Return `SessionSummary` via `jsonResult`**: matches the existing Pi tool return convention (see `eforge_build` at line 215-235).

## Scope

### In Scope
- New `packages/client/src/event-to-progress.ts` with the shared mapping function and re-export from `packages/client/src/index.ts`
- Update `packages/eforge/src/cli/mcp-proxy.ts` to import `eventToProgress` from `@eforge-build/client` instead of keeping it inline (replaces the inline version added in plan-02)
- Register `eforge_follow` Pi tool in `packages/pi-eforge/extensions/eforge/index.ts` using the shared helper, with `renderCall` / `renderResult`
- Update Pi build skill at `packages/pi-eforge/skills/eforge-build/` to chain `eforge_follow` after enqueue
- Update Pi status skill at `packages/pi-eforge/skills/eforge-status/` to offer `eforge_follow` when a session is running
- Test in `test/pi-follow-tool.test.ts` that exercises the Pi tool handler with a stub daemon emitting synthetic events and asserts `onUpdate` is invoked with the mapped messages

### Out of Scope
- Changes to the MCP tool registration itself (lives in plan-02)
- Changes to `subscribeToSession()` (lives in plan-01)
- Changes to `EforgeEvent` definitions
- Pi extension Pi package version bump (per AGENTS.md, the Pi package version is handled at publish time, not in feature PRs)
- Monitor UI changes
- `DAEMON_API_VERSION` bump

## Files

### Create
- `packages/client/src/event-to-progress.ts` - `eventToProgress(event): { progress: number; message: string } | null` shared between MCP and Pi consumers
- `test/pi-follow-tool.test.ts` - tests the Pi tool `execute()` with a synthetic in-process HTTP server emitting SSE events and a captured `onUpdate` spy (hand-crafted event objects cast through `unknown` per AGENTS.md)

### Modify
- `packages/client/src/index.ts` - export `eventToProgress`
- `packages/eforge/src/cli/mcp-proxy.ts` - replace inline `eventToProgress()` (introduced in plan-02) with an import from `@eforge-build/client`; delete the inline function
- `packages/pi-eforge/extensions/eforge/index.ts` - register `eforge_follow` tool near existing `eforge_build` registration; import `subscribeToSession` and `eventToProgress` from `@eforge-build/client`; add `renderCall` / `renderResult` using `ui-helpers.ts` theme helpers
- `packages/pi-eforge/skills/eforge-build/SKILL.md` (or equivalent skill definition file) - chain `eforge_follow` after enqueue and report final summary
- `packages/pi-eforge/skills/eforge-status/SKILL.md` (or equivalent) - offer `eforge_follow` when `eforge_status` reports a running session

## Verification

- [ ] `pnpm build` completes with zero errors across the workspace
- [ ] `pnpm type-check` returns zero errors
- [ ] `pnpm test -- pi-follow-tool` passes; the test captures every `onUpdate` call and asserts the sequence matches the synthetic event sequence for `phase:start`, `phase:end`, `build:files_changed`, and `review:issue{severity: 'high'}`
- [ ] `grep -n 'eforge_follow' packages/pi-eforge/extensions/eforge/index.ts` shows the tool registration
- [ ] `grep -n 'eventToProgress' packages/eforge/src/cli/mcp-proxy.ts` shows an import from `@eforge-build/client` (no local definition)
- [ ] `grep -n 'eventToProgress' packages/client/src/index.ts` shows the export
- [ ] `packages/pi-eforge/skills/eforge-build/` skill file references `eforge_follow` by exact tool name
- [ ] `packages/pi-eforge/skills/eforge-status/` skill file references `eforge_follow` by exact tool name
- [ ] `pnpm --filter @eforge-build/pi-eforge build` completes with zero errors
