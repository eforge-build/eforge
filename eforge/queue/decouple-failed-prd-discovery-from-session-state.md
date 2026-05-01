---
title: Decouple failed-PRD discovery from session state
created: 2026-05-01
---

# Decouple failed-PRD discovery from session state

## Problem / Motivation

Diagnosed during a `/eforge:recover` invocation on 2026-04-30. The user had two failed PRDs sitting in `eforge/queue/failed/` with recovery sidecars present, but:

1. `eforge_status` returned no failed PRDs (only the latest session's plans).
2. The monitor UI's "Retry / Re-queue" button was missing for those failed items.

Root cause traced to the same shape on both surfaces: failed-PRD discovery is incorrectly bound to the most-recent run's `planSet`, even though the on-disk sidecars are keyed by `prdId` alone (flat layout under `eforge/queue/failed/`). The HTTP recovery-sidecar route requires a `setName` query param and then never uses it for path construction — pure ceremony that misleads the UI into gating fetches behind `activeSetName` derived from `runs[0]`.

### On-disk layout (authoritative)

Failed PRDs and their recovery analyses live in a flat, prdId-keyed structure:

```
eforge/queue/failed/
  <prdId>.md                  # original PRD body
  <prdId>.recovery.md         # human-readable recovery report
  <prdId>.recovery.json       # structured verdict (schemaVersion 2)
```

There is no `<setName>/` subdirectory anywhere in this path. The recovery sidecar JSON itself contains `summary.setName` and `summary.featureBranch` as data fields — so `setName` is *recoverable from the sidecar* whenever needed.

### `setName` usage by surface

| Surface | Requires `setName`? | Actually uses it? | Notes |
|---------|--------------------|--------------------|-------|
| `apiReadRecoverySidecar` (`packages/client/src/api/recovery-sidecar.ts:9`) | yes (signature) | no | Passes through to query string |
| Daemon `GET /api/recovery/sidecar` (`packages/monitor/src/server.ts:1786-1827`) | yes (400 if missing) | no | Validates as path segment, never used in `mdPath`/`jsonPath` |
| MCP `eforge_read_recovery_sidecar` (`packages/eforge/src/cli/mcp-proxy.ts:888-901`) | yes (Zod required) | no | Forwards to API helper |
| Pi MCP `eforge_read_recovery_sidecar` (`packages/pi-eforge/extensions/eforge/index.ts:1462-1474`) | yes | no | Mirror of the above |
| Daemon `POST /api/recovery/apply` (`packages/monitor/src/server.ts:982-1015`) | yes (400 if missing) | no | Spawns `apply-recovery` worker with `[setName, prdId]` argv |
| MCP `eforge_apply_recovery` (`packages/eforge/src/cli/mcp-proxy.ts:904-917`) | yes | no | Forwards |
| Pi MCP `eforge_apply_recovery` (`packages/pi-eforge/extensions/eforge/index.ts:1491-1503`) | yes | no | Mirror |
| CLI `eforge apply-recovery <setName> <prdId>` (`packages/eforge/src/cli/index.ts:812-848`) | yes (positional) | no | Forwards to `engine.applyRecovery(setName, prdId)` |
| `engine.applyRecovery(setName, prdId)` (`packages/engine/src/eforge.ts:2097-2150`) | yes (positional) | only emitted in `recovery:apply:start` event | `helperOptions = { cwd, prdId, queueDir }` — setName never reaches the helpers |
| `engine.recover(setName, prdId, ...)` (`packages/engine/src/eforge.ts:1892`) | yes | **YES — functional** | Builds `featureBranch: eforge/<setName>`, used by failure-summary |
| Daemon `POST /api/recovery/start` (`packages/monitor/src/server.ts:938-979`) | yes | yes (forwards to engine.recover) | Functional usage chain |

Two distinct flows:

- **Read + Apply**: `setName` is dead weight everywhere. The verdict is in the sidecar and the apply helpers only need `prdId + cwd + queueDir`.
- **Recover (start analysis)**: `setName` is functional (branch reference). For *re-running* analysis on an already-failed PRD, the existing sidecar JSON contains `summary.setName` so the parameter could be inferred rather than required from callers.

### Discovery: where failed PRDs are reachable today

| API | Surfaces failed PRDs? |
|-----|-----------------------|
| `GET /api/queue` (`packages/monitor/src/server.ts:664-751`, helper `loadFromDir(.../failed, 'failed')` at line 728) | **YES** — `status: 'failed'` items returned |
| `GET /api/run-summary/:id` (`server.ts:1981`, fed to `RunSummary.plans`) | NO — session-event-scoped only |
| MCP `eforge_queue_list` (`mcp-proxy.ts:391-400`) | YES — proxies `/api/queue` |
| MCP `eforge_status` (`mcp-proxy.ts:376-389`) | NO — calls `latestRun` then `runSummary` |

The data is already exposed via `/api/queue`. The bug is that `eforge_status` and the monitor UI's recovery-sidecar fetcher don't read it.

### Monitor UI failure (`packages/monitor-ui/src/components/layout/queue-section.tsx:103-155`)

The component fetches `/api/queue` correctly (line 74), receives the failed items, but then gates the *recovery-sidecar fetch* behind `activeSetName` derived from `runs[0]?.planSet` (lines 104-115). The fetch helper passes that setName as a query param (`fetchRecoverySidecar(activeSetName, item.id)` at line 142). Because the daemon ignores setName for path construction, *any* non-empty setName would work — but the UI early-returns when `activeSetName` is null (line 130). The "Re-queue PRD" button is reachable only inside `RecoverySidecarSheet` which is only opened when `sidecarData[item.id]` is populated — so when the fetch is skipped, the button is unreachable.

The dead-weight `setName` parameter in the request is causing the UI to invent gating logic that has no real reason to exist.

### Slash-command workflow drift

`eforge-plugin/skills/recover/recover.md` Step 1 instructs the assistant to discover failed PRDs via `eforge_status`. The status tool cannot surface them. The instruction is misaligned with the actual data path.

## Goal

Decouple failed-PRD discovery and recovery-sidecar access from session/run state so that failed PRDs are surfaced in `eforge_status` and the monitor UI regardless of the latest run's `planSet`, by removing the dead-weight `setName` parameter from the read-sidecar and apply-recovery surfaces and aligning the slash-command workflow with the actual data path.

## Approach

- **Remove `setName` from read-sidecar and apply-recovery surfaces** end to end (HTTP, MCP, CLI, engine), since it is never used for path construction and the verdict JSON itself carries `summary.setName` whenever it is needed.
- **Keep `setName` on `engine.recover()` and its associated CLI/daemon/MCP entry points** because the start-new-analysis flow functionally requires it for the feature-branch reference (`eforge/<setName>`).
- **Make failed PRDs reachable from the `/eforge:recover` Step 1 discovery path** by either adding a `failedPrds[]` field to `eforge_status` or by routing the slash command to a documented adjacent tool. The choice is documented in the implementation, with the slash command and Pi skill updated to match.
- **Strip the monitor UI's `activeSetName` gating** in `queue-section.tsx` so the recovery-sidecar fetch runs purely off `prdId` for any failed queue item, regardless of whether any run exists.
- **Bump `DAEMON_API_VERSION`** in `packages/client/src/api-version.ts` because this is a breaking change to the HTTP API surface.
- **No backward-compatibility shims** — remove old `setName` parameters cleanly per `feedback_no_backward_compat`.
- **Maintain Claude Code plugin <-> Pi extension parity** per `AGENTS.md`: changes land in both `eforge-plugin/skills/recover/recover.md` and `packages/pi-eforge/extensions/eforge/index.ts` + `packages/pi-eforge/skills/eforge-recover/`, plus the shared HTTP/MCP types in `packages/client/`.

## Scope

### In scope

- HTTP routes: `GET /api/recovery/sidecar`, `POST /api/recovery/apply` in `packages/monitor/src/server.ts`.
- Client helpers: `apiReadRecoverySidecar`, `apiApplyRecovery` in `packages/client/src/api/`.
- MCP tools: `eforge_read_recovery_sidecar` and `eforge_apply_recovery` in `packages/eforge/src/cli/mcp-proxy.ts` and `packages/pi-eforge/extensions/eforge/index.ts`.
- CLI: `eforge apply-recovery` in `packages/eforge/src/cli/index.ts`.
- Engine: `engine.applyRecovery()` signature and the `recovery:apply:start` event payload in `packages/engine/src/eforge.ts`.
- `eforge_status` (or a documented adjacent discovery tool) surfacing failed PRDs from `eforge/queue/failed/`.
- Monitor UI: `packages/monitor-ui/src/components/layout/queue-section.tsx` (remove `activeSetName` gating, collapse dedup-cache key).
- Slash-command workflow: `eforge-plugin/skills/recover/recover.md` Step 1 alignment.
- Pi parity: `packages/pi-eforge/skills/eforge-recover/` and `packages/pi-eforge/extensions/eforge/index.ts`.
- Shared types and `DAEMON_API_VERSION` bump in `packages/client/`.
- Tests in `test/` covering the new contract.

### Explicitly out of scope

- `engine.recover()` signature, its CLI command, daemon `POST /api/recovery/start`, and MCP `eforge_recover` tool — `setName` remains because it is functionally required.
- Backward-compatibility shims or "still accepts setName but ignores it" deprecation modes.
- `CHANGELOG.md` edits — the release flow owns it (`feedback_changelog_managed_by_release`).

## Acceptance Criteria

1. **`eforge_status` surfaces failed PRDs.** When `eforge/queue/failed/` contains PRDs and no run is currently active, the failed items are reachable to the `/eforge:recover` workflow's Step 1 discovery — either inline in the `eforge_status` response (e.g. a new `failedPrds[]` field), or via a documented adjacent tool the slash command is updated to call. The choice is documented in this PRD's implementation; the slash command (`eforge-plugin/skills/recover/recover.md`) is updated to match, with parity in `packages/pi-eforge/skills/eforge-recover/`.

2. **`setName` is removed from the read-sidecar and apply-recovery surfaces.** The following accept only `prdId`:
   - `GET /api/recovery/sidecar` query params (`packages/monitor/src/server.ts`)
   - `POST /api/recovery/apply` body (`packages/monitor/src/server.ts`)
   - `apiReadRecoverySidecar` and `apiApplyRecovery` helpers (`packages/client/src/api/`)
   - MCP tools `eforge_read_recovery_sidecar` and `eforge_apply_recovery` in both `packages/eforge/src/cli/mcp-proxy.ts` and `packages/pi-eforge/extensions/eforge/index.ts`
   - CLI `eforge apply-recovery` command (`packages/eforge/src/cli/index.ts`) — single positional arg `<prdId>`
   - `engine.applyRecovery(prdId)` signature — no `setName` parameter; the `recovery:apply:start` event either drops the `setName` field or fills it from the sidecar's `summary.setName`

3. **`engine.recover()` is unchanged.** The start-new-analysis flow keeps its `(setName, prdId)` signature because `setName` is functionally required for the feature-branch reference. The matching CLI command, daemon route (`POST /api/recovery/start`), and MCP `eforge_recover` tool all keep `setName`.

4. **Monitor UI no longer gates sidecar fetches on `activeSetName`.** In `packages/monitor-ui/src/components/layout/queue-section.tsx`:
   - The `activeSetName` `useMemo` over `runs` is removed.
   - The `useEffect` early-return on `!activeSetName` is removed.
   - The `${setName}/${prdId}` dedup-cache key collapses to `prdId`.
   - For any failed queue item, the sidecar fetcher loads on the next queue poll regardless of whether `runs` is empty or which `planSet` the latest run used.

5. **Reachability proof (manual verification).** With a failed PRD in `eforge/queue/failed/` and a fresh daemon (no runs in `state.json`, monitor.db absent):
   - `eforge_status` (or its documented adjacent tool) returns the failed PRD.
   - The monitor UI `Queue` section shows the failed item with its recovery-verdict chip and a clickable "Re-queue PRD" button inside the verdict sheet (when verdict is `retry`).

6. **No backward-compatibility shims.** Old `setName` parameters are removed cleanly; no deprecated-but-accepted aliases. Per `feedback_no_backward_compat`, do not add a "still accepts setName but ignores it" mode.

7. **`DAEMON_API_VERSION` bumped** in `packages/client/src/api-version.ts` (breaking change to HTTP API surface — per AGENTS.md).

8. **Tests cover the new contract.** New or updated vitest cases verify:
   - `apiReadRecoverySidecar({ cwd, prdId })` round-trips against the daemon route with `prdId`-only.
   - `engine.applyRecovery(prdId)` (verdict `retry` fixture) moves the failed PRD back to the queue without a `setName` argument.
   - `eforge_status` (or the chosen discovery path) returns failed PRDs from `queue/failed/` when no session is active.
   - The queue-section component renders the verdict chip and re-queue button when `runs` is empty (fixture: empty runs array, one failed item with sidecar in fixtures).
   - Existing tests that pass `setName` to these tools/routes are updated or removed.

9. **CHANGELOG untouched.** Per `feedback_changelog_managed_by_release`, the release flow owns CHANGELOG.md — this PRD does not edit it.
