---
id: plan-02-monitor-ui-session-rename
name: Monitor-UI Session Backend to Harness Rename
depends_on:
  - plan-01-finish-plan-04
branch: complete-per-agent-runtime-configuration/monitor-ui-session-rename
---

# Monitor-UI Session Backend to Harness Rename

## Architecture Context

The per-agent runtime feature landed a top-level `harness` field on each agent (via the registry), but the monitor-UI still holds a session-level `backend` field in its reducer that's populated from the first `agent:start` event. That field name needs to track the engine's terminology.

This is a contained rename across 5 files in `packages/monitor-ui/`. No engine-side or daemon-side changes are required - the reducer already reads from `event.harness` at line ~300 (`state.backend = harnessVal ?? 'unknown'`). Only the field name and its consumer references change.

## Implementation

### Overview

Rename the session-level `backend` field (string | null) to `harness` throughout the monitor-UI reducer, types, state initializers, reset path, and three display components. The reducer logic that derives the value from `agent:start` event payload is unchanged - only the destination field name changes.

### Key Decisions

1. **Rename, not alias.** No backward-compat shim. The field is internal to monitor-UI state.
2. **Prop renames propagate.** `<SummaryCards backend={...} />` becomes `<SummaryCards harness={...} />`; component internal prop name updates accordingly.
3. **`metadata.backend` reference in sidebar.** The sidebar reads `metadata.backend` at L116-117; rename to `metadata.harness` so the source of truth aligns with the reducer's new field name (the reducer writes this metadata from session state).

## Scope

### In Scope

- Session-level `backend` field rename to `harness` across reducer, types, initializer, reset path, and consumers.
- Prop rename on `SummaryCards` and parent call site in `app.tsx`.
- `metadata.backend` display rename in sidebar.

### Out of Scope

- Any change to engine event payloads (already emit `harness`).
- Profile directory / MCP / HTTP renames.

## Files

### Modify

- `packages/monitor-ui/src/lib/types.ts` (L78) - rename `backend: string | null` to `harness: string | null` on `RunState`.
- `packages/monitor-ui/src/lib/reducer.ts` (L81, 108, 142, 297-300, 413, 435) - rename the reducer field, initial state entry, reset path, and the `agent:start` handler assignment.
- `packages/monitor-ui/src/app.tsx` (L318) - update the prop passed to `<SummaryCards>` from `backend={runState.backend}` to `harness={runState.harness}`.
- `packages/monitor-ui/src/components/common/summary-cards.tsx` (L23, 50, 75) - rename prop name and all internal references.
- `packages/monitor-ui/src/components/layout/sidebar.tsx` (L116-117) - rename `metadata.backend` read to `metadata.harness`.

## Verification

- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `grep -rn "\\bbackend\\b" packages/monitor-ui/src/` returns no matches for the renamed field, the prop, or `metadata.backend` (matches for unrelated strings like `Backend profile` docs comments in other files are acceptable but there should be none in the 5 files listed above).
- [ ] Monitor UI renders session summary without reference errors at runtime (`pnpm dev:monitor` loads without console errors against a fresh session).
