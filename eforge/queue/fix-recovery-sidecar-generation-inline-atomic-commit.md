---
title: Fix recovery sidecar generation (inline, atomic commit)
created: 2026-04-27
---

# Fix recovery sidecar generation (inline, atomic commit)

## Problem / Motivation

The user expected `*.recovery.md` / `*.recovery.json` sidecars in `eforge/queue/failed/` when builds fail, but in `~/projects/ytc/member-portal/eforge/queue/failed/` only the PRD `.md` files exist. The recovery feature is fully implemented end-to-end, but two bugs and one architectural quirk prevent sidecars from ever being written:

- **Bug A** — `packages/engine/src/eforge.ts:810-812` deletes `.eforge/state.json` in `build()`'s `finally` block before the daemon's recovery poller wakes up. `buildFailureSummary` (`packages/engine/src/recovery/failure-summary.ts:49-52`) then throws "no state file found". Confirmed in user's worker log `worker-daemon-1777323107460-...log`.
- **Bug B** — `packages/monitor/src/server.ts:352` does `const prdId = event.planId`, conflating the orchestration plan-id with the PRD-id. Recovery resolves `eforge/queue/failed/<planId>.md`, which doesn't exist for multi-plan PRDs. Confirmed in user's worker log `worker-daemon-1777322699450-...log`.
- **Quirk** — Even if both bugs were fixed, the move-to-failed commit (`packages/engine/src/prd-queue.ts:308`) and a later recovery sidecar commit would be two separate commits, with the sidecar landing seconds-to-minutes after the move. Sub-optimal git history and creates a window where `failed/` has a PRD without its sidecar.

## Goal

Collapse the recovery architecture so that on build failure, the PRD move into `failed/` and both recovery sidecar files (`.recovery.md` / `.recovery.json`) are produced atomically in a single commit by the queue parent's finalize handler, eliminating both bugs by construction and removing the daemon's recovery polling loop entirely.

## Approach

The user picked: **atomic single-commit failure** with sidecar inline. Recovery runs synchronously in the queue parent's finalize handler immediately after the build subprocess exits with failure, then the PRD move + both sidecar files are staged and committed in one `forgeCommit` call. The daemon's recovery polling loop is deleted entirely. Both bugs vanish by construction (the queue parent already has the canonical `prdId` and runs while `state.json` is still on disk — once we stop the premature deletion).

### 1. Stop deleting `state.json` on build failure

`packages/engine/src/eforge.ts:810-812` — split the cleanup. Only delete `.eforge/state.json` when the run succeeded. On failure, leave it for the queue parent to read. The queue parent's finalize handler (step 2) deletes it after committing the sidecar.

### 2. Run recovery inline in the queue parent's finalize handler

`packages/engine/src/eforge.ts` — `runQueueExec` finalize (lines 1069-1130). When the subprocess exits with `status === 'failed'` and `moveTo === 'failed'`:

1. Resolve sidecar paths: `<cwd>/eforge/queue/failed/<prdId>.recovery.{md,json}` (the PRD will land in `failed/` after `git mv` in step 4).
2. Build the failure summary via `buildFailureSummary({ setName, prdId, cwd })` from `packages/engine/src/recovery/failure-summary.ts`. This reads `.eforge/state.json` (still present because of step 1) and runs git log/diff. Wrap in try/catch — on error, fall through to step 3 with a degraded summary stub.
3. Run the recovery-analyst agent (`packages/engine/src/agents/recovery-analyst.ts`) inline against the summary. One-shot, read-only, no tools — typically completes in tens of seconds. Wrap in try/catch with a timeout (default 90s). On any error/timeout, synthesize a minimal `RecoveryVerdict { verdict: 'manual', confidence: 'low', rationale: '<error/timeout details>' }`.
4. Replace the existing `movePrdToSubdir(filePath, 'failed', cwd)` call with a new helper `moveAndCommitFailedWithSidecar(filePath, sidecarPaths, summary, verdict, cwd)` in `packages/engine/src/prd-queue.ts`. This helper:
   - `git mv` the PRD into `failed/` (existing logic).
   - Write both sidecar files via `writeRecoverySidecar()` (`packages/engine/src/recovery/sidecar.ts`).
   - `git add` the two sidecar paths.
   - Single `forgeCommit(cwd, composeCommitMessage(\`queue(${prdId}): failed - ${verdict.verdict}\`, modelTracker))` — produces one commit covering the move and the sidecars, with the `Models-Used:` trailer reflecting the recovery-analyst's model.
5. After the commit lands, best-effort delete `.eforge/state.json` (swallow ENOENT).
6. Concurrency: the queue parent already serializes git operations via `retryOnLock`. The inline recovery runs only on the failing PRD's branch of the scheduler — other concurrent PRDs (default parallelism = 2) are unaffected.

The daemon's `WorkerTracker.spawnWorker('recover', …)` mechanism is no longer used for the auto-trigger path. The manual `eforge recover` CLI command still works (delegates to `EforgeEngine.recover()`, unchanged) so the user can re-run recovery on the two PRDs already in `failed/` (`timezone-compliance-sweep`, `zod-enum-schema-factory`).

### 3. Delete the daemon's recovery polling loop

`packages/monitor/src/server.ts:339-391` — remove the entire `--- eforge:region plan-03-daemon-mcp-pi ---` block. Also drop:

- The `failedPrdDir` option from `startServer` and the resolution at `packages/monitor/src/server-main.ts:469`.
- `inFlightRecoveries` set, `lastRecoveryCheckId` cursor, `broadcast('recovery:start', …)` event (search for any UI consumer first — if the monitor UI listens, replace with the existing `phase:end` failure signal it already renders).
- `getNewBuildFailedEvents()` from `packages/monitor/src/db.ts` if no other consumer.

The HTTP `POST /api/recover` route stays — it delegates to `EforgeEngine.recover()` and is the manual-retrigger path (and what the MCP tool `eforge_recover` calls into via the daemon). The `GET /api/recovery/sidecar` route stays for the monitor UI to read sidecars.

### 4. Make `EforgeEngine.recover()` resilient (manual-retrigger path)

`EforgeEngine.recover()` at `packages/engine/src/eforge.ts:1686-1768` is what the user will run manually for `timezone-compliance-sweep` and `zod-enum-schema-factory`. Their `state.json` is long gone, so today it would still throw. Update it to **never throw and always write a sidecar**:

- `buildFailureSummary` (`packages/engine/src/recovery/failure-summary.ts`): when `loadState()` returns null, build a partial summary from:
  - PRD file content (already resolved by `recover()`).
  - Latest run for `(setName, prdId)` from `monitor.db` events, if available — new helper `synthesizeFromEvents()` in `packages/engine/src/recovery/event-history.ts` (new file). Accept the SQLite path as a constructor option so the engine can reuse the daemon's db when running as a worker, but make this path optional — on a fresh checkout with no db, the synthesis still produces a usable summary from git alone.
  - Git log/diff against `eforge/<setName>` if the branch exists (existing logic, run unconditionally now).
  - Mark with `partial: true`, set `failedAt = new Date().toISOString()`.
- `packages/engine/src/recovery/sidecar.ts`: extend `RecoveryVerdict` JSON schema with optional `partial?: boolean` and `recoveryError?: string`. Bump `schemaVersion` from `1` to `2`. Reader code in `eforge_read_recovery_sidecar` / `GET /api/recovery/sidecar` only needs to tolerate the new optional fields — confirm no strict schema validation rejects v2.
- `EforgeEngine.recover()`: top-level try/catch — on **any** error (PRD missing, agent timeout, git failure), still call `writeRecoverySidecar()` with `{ verdict: 'manual', confidence: 'low', rationale: 'Recovery analysis could not complete: <err.message>', recoveryError: err.message, partial: true, ... }`. Manual-CLI runs always produce a sidecar.
- Same resilience applies to the inline call from step 2 — the inline failure summary builder shares the partial-fallback path.

### 5. Recovery-analyst agent: tolerate partial summaries

`packages/engine/src/agents/recovery-analyst.ts` and its prompt — when the input summary has `partial: true`, the prompt should hint that the agent may need to output `verdict: 'manual'` and explain in the rationale what context was missing. Existing parse-failure fallback at `recovery-analyst.ts:57-119` is already correct — leave it.

### Critical files

| File | Change |
|---|---|
| `packages/engine/src/eforge.ts` (810-812) | Skip `state.json` rm on failure |
| `packages/engine/src/eforge.ts` (1069-1130) | Inline recovery in `runQueueExec` finalize |
| `packages/engine/src/eforge.ts` (1686-1768) | `recover()` never throws |
| `packages/engine/src/prd-queue.ts` (~308) | New `moveAndCommitFailedWithSidecar` helper alongside `movePrdToSubdir` |
| `packages/engine/src/recovery/failure-summary.ts` | Tolerate missing state, synthesize from events+git |
| `packages/engine/src/recovery/event-history.ts` | **New**, db-event synthesis |
| `packages/engine/src/recovery/sidecar.ts` | Schema bump to v2 with `partial`, `recoveryError` |
| `packages/engine/src/agents/recovery-analyst.ts` (+ prompt) | Partial-summary handling |
| `packages/monitor/src/server.ts` (339-391) | Delete the recovery polling block |
| `packages/monitor/src/server-main.ts` (469-470) | Drop `failedPrdDir` plumbing |
| `packages/monitor/src/db.ts` | Drop `getNewBuildFailedEvents` if unused |
| `test/daemon-recovery.test.ts` | Rewrite (see Acceptance Criteria) |

### Reuse, don't rewrite

- `forgeCommit()` (`packages/engine/src/git.ts`) — used for the atomic move+sidecar commit. AGENTS.md mandates all engine commits go through it; the `Models-Used:` trailer flows automatically via `composeCommitMessage(body, modelTracker)`.
- `writeRecoverySidecar()` (`packages/engine/src/recovery/sidecar.ts`) — single sidecar write path, atomic temp+rename, reused for both inline and manual paths.
- `loadState()` (`packages/engine/src/state.ts`) — unchanged; absence is no longer fatal.
- `recovery-analyst` agent and prompt — reused with a small partial-summary hint.

## Scope

### In scope

- Stop deleting `.eforge/state.json` on build failure (delete only on success).
- Inline recovery execution in `runQueueExec` finalize handler with try/catch + timeout fallbacks.
- New `moveAndCommitFailedWithSidecar` helper in `packages/engine/src/prd-queue.ts` producing a single atomic commit covering PRD move + both sidecars via `forgeCommit`.
- Best-effort `state.json` cleanup after the failure commit lands.
- Deletion of the daemon's recovery polling loop (`packages/monitor/src/server.ts:339-391`), `failedPrdDir` plumbing, `inFlightRecoveries`, `lastRecoveryCheckId`, `broadcast('recovery:start', …)`, and `getNewBuildFailedEvents` if unused.
- Resilient `EforgeEngine.recover()` that never throws and always writes a sidecar.
- `buildFailureSummary` tolerates missing `state.json` and synthesizes a partial summary from PRD content, monitor.db events, and git log/diff.
- New `packages/engine/src/recovery/event-history.ts` with `synthesizeFromEvents()` helper accepting an optional SQLite path.
- Sidecar schema bump from v1 to v2, adding optional `partial?: boolean` and `recoveryError?: string`.
- Recovery-analyst prompt hint for partial summaries.
- Rewritten `test/daemon-recovery.test.ts`.
- The HTTP `POST /api/recover` route and `GET /api/recovery/sidecar` route are retained.
- The manual `eforge recover` CLI command and `eforge_recover` MCP tool continue to work via `EforgeEngine.recover()`.

### Out of scope

- No retroactive auto-rewrite of past failure commits. The user runs `eforge recover` once per existing failed PRD to backfill sidecars (manual command produces its own follow-on commit, separate from the original move-to-failed).
- No new HTTP route, MCP tool, or CLI command. Existing surfaces become reliable.
- No change to recovery-analyst prompt strategy beyond the partial-summary hint.
- The `state.json`-shared-across-parallel-PRDs concern (a pre-existing concurrency observation, not raised by the user) is not addressed here.

## Acceptance Criteria

1. **Type-check + tests**
   - `pnpm type-check` is clean.
   - `pnpm test` is green, including the rewritten `test/daemon-recovery.test.ts`.

2. **Rewritten test cases** in `test/daemon-recovery.test.ts`
   - Inline recovery on queue failure: spawn a queue with a PRD designed to fail; assert that after the queue exits there's a single commit `queue(<prdId>): failed - <verdict>` containing the moved PRD + both sidecar files.
   - Atomicity: assert no commit exists where the PRD is in `failed/` without sidecars (i.e. the move-only commit no longer occurs).
   - Multi-plan PRD failure (the Bug B scenario): a PRD that compiles into `plan-01-…`, `plan-02-…`, `plan-03-…` and fails on plan-03 produces a sidecar at `failed/<prdId>.recovery.json` (NOT `failed/plan-03-….recovery.json`).
   - Recovery-analyst error → manual-verdict sidecar still written (use the existing `StubHarness` from `test/stub-harness.ts` to inject a parse-failure response).
   - Manual `EforgeEngine.recover()` with no `state.json` and a populated event-db → partial-summary sidecar with `partial: true` and a sensible rationale. (No mocks per AGENTS.md — construct the SQLite db with hand-rolled events as fixtures.)

3. **Manual end-to-end against the user's existing failures**
   - Build & restart daemon (use the `eforge-daemon-restart` skill or `pnpm build` then daemon restart).
   - In `~/projects/ytc/member-portal/`, run:
     ```
     eforge recover <setName> timezone-compliance-sweep
     eforge recover <setName> zod-enum-schema-factory
     ```
     (Confirm `<setName>` from the entries in `monitor.db` — likely identical to the prdId for single-PRD sets.)
   - Both should produce `eforge/queue/failed/<prdId>.recovery.{md,json}` with `partial: true` (state.json gone) and a synthesized summary from the 39MB `monitor.db` event history.

4. **Forward test with a fresh failure**
   - Enqueue a deliberately-failing small PRD in `~/projects/ytc/member-portal/eforge/queue/`.
   - Watch the daemon: when the build fails, the queue parent should produce **one** commit (`queue(<prdId>): failed - <verdict>`) containing the moved PRD + non-partial sidecar with full state-derived summary.
   - Verify `state.json` cleaned up after the commit.
   - Verify `git log` shows no separate "move to failed" commit.

5. **Schema-bump compatibility**
   - The two old (would-have-been v1) sidecar formats don't exist in any user repo (they were never written). Old `eforge_read_recovery_sidecar` callers tolerate optional fields — confirm by reading a v2 sidecar via the MCP tool.
