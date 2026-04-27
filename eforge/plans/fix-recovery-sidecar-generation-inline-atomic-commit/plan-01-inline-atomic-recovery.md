---
id: plan-01-inline-atomic-recovery
name: Inline atomic recovery sidecar + resilient recover()
branch: fix-recovery-sidecar-generation-inline-atomic-commit/main
agents:
  builder:
    effort: high
    rationale: Coordinated changes across engine + monitor + tests with sidecar
      schema migration (v1 -> v2), atomic-commit semantics, and a
      partial-summary fallback path that has to keep working when state.json,
      the event db, and the feature branch may all be missing or partially
      absent.
  reviewer:
    effort: high
    rationale: "Failure path correctness matters: a regression here silently loses
      recovery sidecars on production failures. Reviewer must verify the
      failure-summary fallback chain, the single-commit assertion, and that the
      daemon polling loop is fully excised (no orphan callers of
      getNewBuildFailedEvents / failedPrdDir / inFlightRecoveries)."
  tester:
    effort: high
    rationale: Rewritten test file covers 5 distinct scenarios (atomic commit,
      multi-plan PRD bug, agent error fallback, partial-summary path, manual
      recover). The tester needs to validate against the spec rather than
      against a stale auto-trigger contract that this plan removes.
---

# Inline atomic recovery sidecar + resilient recover()

## Architecture Context

Today recovery sidecars are produced by the daemon's polling loop spawning `eforge recover` after seeing a `plan:build:failed` event. Two bugs prevent any sidecar from ever being written in the user's repo:

- `EforgeEngine.build()` deletes `.eforge/state.json` in a `finally` block (eforge.ts:810-812) before the recovery subprocess starts, so `buildFailureSummary` throws `no state file found`.
- The daemon resolves the failed-PRD path using `event.planId` (server.ts:352), conflating orchestration plan-ids with PRD-ids; multi-plan PRDs land in `failed/<prdId>.md` but recovery looks for `failed/<planId>.md`.

Even if both bugs were fixed, the move-to-failed commit (`prd-queue.ts:308`) and a later sidecar commit would be two separate commits with a window where `failed/` has a PRD without sidecars.

This plan collapses the architecture: on build failure, the queue parent's finalize handler runs recovery inline (synchronously, against the still-present `state.json`), then the PRD `git mv` and both `.recovery.{md,json}` files are staged and committed in one `forgeCommit` call. The daemon's polling loop is deleted entirely. Both bugs vanish by construction (the queue parent has the canonical `prdId` and `state.json` is still on disk). The manual `eforge recover` CLI command and `POST /api/recover` route stay; `EforgeEngine.recover()` is rewritten to never throw and always write a sidecar so the user can backfill the two PRDs already sitting in `failed/` without sidecars.

The `forgeCommit` helper from `packages/engine/src/git.ts` and `composeCommitMessage(body, modelTracker)` from `packages/engine/src/model-tracker.ts` are reused unchanged so the `Models-Used:` and `Co-Authored-By:` trailer contract is preserved.

## Implementation

### Overview

1. Stop deleting `state.json` on failure in `EforgeEngine.build()`'s `finally` block.
2. In `runQueueExec`'s `finalize` handler (the queue parent), when `moveTo === 'failed'`, run recovery inline against the failing PRD's `state.json`, then call a new `moveAndCommitFailedWithSidecar` helper that produces a single atomic commit containing the `git mv` + both sidecar files.
3. Delete the daemon recovery polling block in `packages/monitor/src/server.ts`, the `failedPrdDir` plumbing in `server-main.ts`, the `getNewBuildFailedEvents` SQL helper, and the `inFlightRecoveries` / `lastRecoveryCheckId` state.
4. Rewrite `EforgeEngine.recover()` to never throw — `buildFailureSummary` synthesizes a partial summary from PRD content + monitor.db events + git when `state.json` is missing; the top-level catch always writes a sidecar with `partial: true` and a `recoveryError` rationale.
5. Bump sidecar `schemaVersion` from `1` to `2`, extend `RecoveryVerdict` with optional `partial?: boolean` and `recoveryError?: string`, and add a partial-summary hint to the recovery-analyst prompt.
6. Rewrite `test/daemon-recovery.test.ts` to cover the new architecture (atomic commit, multi-plan-PRD scenario, agent-error fallback, manual `recover()` partial-summary, sidecar read-route compatibility).

### Key Decisions

1. **Inline recovery runs synchronously in the queue parent's finalize handler, not via subprocess.** Recovery analyst is read-only with `tools: 'none'` and typically completes in tens of seconds. Running inline keeps the queue parent's git-serialization (`retryOnLock`) intact and makes the move + sidecar commit naturally atomic. The default 90s timeout protects against hung agent calls.
2. **State.json deletion moves from `build()`'s finally to after the failure-commit lands.** On success, `build()` still deletes it (the only behavior change is the failure path defers cleanup). After the `moveAndCommitFailedWithSidecar` call returns successfully, the queue parent best-effort deletes it (swallow ENOENT). On success no recovery runs and `build()`'s existing finally still cleans up.
3. **`buildFailureSummary` becomes resilient: state.json is now optional.** When missing, it synthesizes from monitor.db events (new `synthesizeFromEvents()` in `packages/engine/src/recovery/event-history.ts`) plus git log/diff against `eforge/<setName>` if the branch exists, and from the PRD frontmatter/content. Returns `partial: true` so the recovery-analyst (and the verdict it produces) flag the degraded context.
4. **Schema bump v1 -> v2** is purely additive — `partial` and `recoveryError` are optional. The HTTP `GET /api/recovery/sidecar` route uses `JSON.parse` with no strict schema validation (verified at server.ts:1334-1373), so v2 sidecars round-trip through the existing reader.
5. **No backward-compat layer for the daemon polling loop.** The PRD specifies clean removal — `inFlightRecoveries`, `lastRecoveryCheckId`, `getNewBuildFailedEvents`, `failedPrdDir` plumbing, and the `broadcast('recovery:start', ...)` daemon-spawn event are deleted outright. The `recovery:start` / `recovery:complete` / `recovery:error` agent-emitted EforgeEvents stay (the inline path emits them through the queue parent's event stream just like any other agent invocation, and the monitor UI's event-card already classifies them — see `packages/monitor-ui/src/components/timeline/event-card.tsx:29-32, 122-125, 212-281`).
6. **`POST /api/recover` and `GET /api/recovery/sidecar` HTTP routes stay.** They delegate to `EforgeEngine.recover()` (now resilient) and to filesystem reads, respectively. The `eforge_recover` MCP tool and `eforge recover` CLI command continue working unchanged.

## Scope

### In Scope
- Skip `state.json` rm on build failure in `EforgeEngine.build()`'s finally block.
- Inline recovery execution in `runQueueExec`'s `finalize` (90s timeout, try/catch fallbacks, manual-verdict on any error).
- New `moveAndCommitFailedWithSidecar` helper in `packages/engine/src/prd-queue.ts` producing one atomic commit covering `git mv` + both sidecar paths via `forgeCommit(cwd, composeCommitMessage(\`queue(${prdId}): failed - ${verdict.verdict}\`, modelTracker))`.
- Best-effort `state.json` cleanup after the failure commit lands (swallow ENOENT).
- Deletion of the daemon's recovery polling loop in `packages/monitor/src/server.ts:339-391`, the `failedPrdDir` plumbing at `packages/monitor/src/server-main.ts:469-470`, the `lastRecoveryCheckId` / `inFlightRecoveries` state, and the `getNewBuildFailedEvents` DB helper.
- New `packages/engine/src/recovery/event-history.ts` exporting `synthesizeFromEvents({ setName, prdId, dbPath })` that reads recent `plan:build:failed` / `agent:start` / `phase:end` rows and assembles a partial `BuildFailureSummary` shape. Accepts optional `dbPath`; returns null when no events are findable so callers can fall back to git/PRD-content synthesis.
- `buildFailureSummary` in `packages/engine/src/recovery/failure-summary.ts` tolerates missing `state.json` by combining: PRD frontmatter (passed in from caller), `synthesizeFromEvents()` output (when dbPath supplied), and git log/diff against `eforge/<setName>` if the branch exists. Returns the existing `BuildFailureSummary` shape with `partial: true` and `failedAt = new Date().toISOString()` when synthesized.
- Sidecar schema bump from `1` to `2` in `packages/engine/src/recovery/sidecar.ts`. Extend `RecoveryVerdict` in `packages/engine/src/events.ts` with optional `partial?: boolean` and `recoveryError?: string`. Extend `BuildFailureSummary` with optional `partial?: boolean`.
- `EforgeEngine.recover()` at `packages/engine/src/eforge.ts:1686-1768` wrapped in a top-level try/catch — on any error (PRD missing, agent timeout, git failure), still call `writeRecoverySidecar()` with a degraded verdict + `recoveryError: err.message`.
- Recovery-analyst prompt (`packages/engine/src/prompts/recovery-analyst.md`) — add a partial-summary hint instructing the agent to lean toward `verdict: 'manual'` and explain missing context in the rationale when input has `partial: true`.
- Update `getRecoveryVerdictSchemaYaml()` in `packages/engine/src/schemas.ts` so the agent sees the v2 schema.
- Rewrite `test/daemon-recovery.test.ts` per the test cases listed below.

### Out of Scope
- Retroactive auto-rewrite of past failure commits. The user runs `eforge recover` once per existing failed PRD to backfill sidecars (manual command produces a follow-on commit, separate from the original move-to-failed).
- New HTTP route, MCP tool, or CLI command — existing surfaces become reliable.
- Recovery-analyst prompt strategy beyond the partial-summary hint.
- The `state.json`-shared-across-parallel-PRDs concern (pre-existing observation, not addressed here).

## Files

### Create
- `packages/engine/src/recovery/event-history.ts` — new module exporting `synthesizeFromEvents({ setName, prdId, dbPath })` that opens the SQLite db read-only via `node:sqlite`, queries the most recent `plan:build:failed` event for `(setName, prdId)`, plus surrounding `agent:start` / `phase:end` events, and returns a partial-summary fragment with the failing plan id, recent landed agents (for `modelsUsed`), and an inferred `failingPlan.errorMessage`. Returns null when no rows are findable. No throws (catches all I/O errors and returns null).

### Modify
- `packages/engine/src/eforge.ts` (~3 sites) —
  - Lines 810-812: change `try { await rm(resolve(cwd, '.eforge', 'state.json')); } catch {}` so it only runs when `status !== 'failed'`. Leave state intact on failure for the queue parent.
  - Lines 1107-1118 (the `finalize` handler in `spawnPrdChild`): when `moveTo === 'failed'`, before calling `movePrdToSubdir`, run recovery inline: load PRD content from `filePath`, call `buildFailureSummary({ setName, prdId, cwd })` (try/catch -> degraded summary stub on error), run `runRecoveryAnalyst()` with a 90s timeout via `AbortController` (try/catch -> manual verdict on error/timeout), then call the new `moveAndCommitFailedWithSidecar(filePath, summary, verdict, modelTracker, cwd)` helper instead of `movePrdToSubdir(filePath, 'failed', cwd)`. After the helper returns, best-effort delete `.eforge/state.json` (swallow ENOENT). Other `moveTo` branches (`'skipped'`) keep calling `movePrdToSubdir` unchanged.
  - `recover()` at lines 1686-1768: wrap the entire body in a top-level try. On `readFile` failure for the PRD, still emit `recovery:start` and write a sidecar with `verdict: 'manual'`, `recoveryError: 'PRD file not found: <path>'`, `partial: true`. On `buildFailureSummary` failure, fall through with the partial-summary builder's output. On `runRecoveryAnalyst` failure or parse failure, fall through to the existing manual-verdict path but tag `partial: true` and `recoveryError`. Always emit `recovery:complete` with sidecar paths at the end. Pass `dbPath` (resolved from monitor config) into `buildFailureSummary` when available.
- `packages/engine/src/prd-queue.ts` (~line 308) — add new exported helper:
  ```ts
  export async function moveAndCommitFailedWithSidecar(
    filePath: string,
    summary: BuildFailureSummary,
    verdict: RecoveryVerdict,
    modelTracker: ModelTracker | undefined,
    cwd: string,
  ): Promise<{ mdPath: string; jsonPath: string; destPath: string }>
  ```
  Implementation: resolve `failed/` destination + sidecar paths the way `movePrdToSubdir` does; `git mv` the PRD; call `writeRecoverySidecar({ failedPrdDir, prdId, summary, verdict })`; `git add --` both sidecar paths; single `forgeCommit(cwd, composeCommitMessage(\`queue(${prdId}): failed - ${verdict.verdict}\`, modelTracker))`. All git operations wrapped in `retryOnLock`. Existing `movePrdToSubdir` stays for the `skipped/` path.
- `packages/engine/src/recovery/failure-summary.ts` — change signature to `buildFailureSummary({ setName, prdId, cwd, dbPath?, prdContent? })`. When `loadState(cwd)` returns null, build a partial summary from `synthesizeFromEvents({ setName, prdId, dbPath })` (when dbPath supplied) plus git log/diff against `eforge/<setName>` if branch exists, with `partial: true` and `failedAt = new Date().toISOString()`. Existing path (state present) returns `partial: false` (or omitted). No throws.
- `packages/engine/src/recovery/sidecar.ts` — bump `schemaVersion` from `1` to `2`. Pass `partial` and `recoveryError` through from the verdict to the JSON payload (already covered by the `verdict` field). Update the markdown builder to render `**Partial summary** — context was incomplete: <recoveryError>` near the verdict block when `verdict.partial === true`.
- `packages/engine/src/events.ts` — extend `RecoveryVerdict` with optional `partial?: boolean` and `recoveryError?: string`. Extend `BuildFailureSummary` with optional `partial?: boolean`.
- `packages/engine/src/agents/recovery-analyst.ts` — when `summary.partial === true`, append a one-line hint to the rendered prompt (or pass through a template variable) telling the agent to set `verdict: 'manual'` and explain missing context. Existing parse-failure fallback at lines 110-118 stays.
- `packages/engine/src/prompts/recovery-analyst.md` — add a `{{partialHint}}` template variable rendered as `Note: this summary is partial (state.json was missing); prefer verdict=manual and document missing context in the rationale.` when `summary.partial === true`, otherwise empty string.
- `packages/engine/src/schemas.ts` — update `getRecoveryVerdictSchemaYaml()` to include the new optional `partial` and `recoveryError` fields so the agent sees them in its output schema.
- `packages/monitor/src/server.ts` — delete the entire `--- eforge:region plan-03-daemon-mcp-pi ---` polling block (lines 339-391), the `lastRecoveryCheckId = db.getMaxEventId()` initialization (lines 169-176), the `inFlightRecoveries` Set, and the `failedPrdDir` field on the `startServer` options object (line 165). Keep the `RECOVERY_SIDECAR_BASE` constant and the `POST /api/recover` route. The `GET /api/recovery/sidecar` route reads sidecars off the filesystem from `cwd + config.prdQueue.dir + '/failed/'` resolved at request time (no plumbed `failedPrdDir` needed) — adjust accordingly.
- `packages/monitor/src/server-main.ts` — drop the `failedPrdDir = config ? resolve(...) : undefined;` line at 469 and the `failedPrdDir` arg to `startServer` at 470.
- `packages/monitor/src/db.ts` — drop `getNewBuildFailedEvents` from the `MonitorDB` interface (line 68), the prepared statement (lines 197-199), and the implementation (lines 377-378). Verify no other consumer remains via the codebase search.
- `packages/client/src/api-version.ts` — bump `DAEMON_API_VERSION` from `7` to `8` since the polling-trigger contract is removed (the HTTP API surface changes — the daemon no longer auto-spawns recover workers via the events endpoint side-channel).
- `test/daemon-recovery.test.ts` — full rewrite per the test cases below.
- `eforge-plugin/.claude-plugin/plugin.json` — bump plugin version per AGENTS.md (the plugin version must bump on any user-facing recovery behavior change).

### Verification

- [ ] `pnpm type-check` exits 0 with no errors across all workspace packages.
- [ ] `pnpm test` exits 0 with all tests passing, including the rewritten `test/daemon-recovery.test.ts`.
- [ ] `pnpm build` exits 0 (CLI lands at `packages/eforge/dist/cli.js`).
- [ ] `git log -1 --format=%B HEAD` after a queue-parent failure commit shows exactly: `queue(<prdId>): failed - <verdict>` body, then `Models-Used: <ids>` trailer (when models were recorded), then `Co-Authored-By: forged-by-eforge <noreply@eforge.build>` trailer.
- [ ] `git show --stat HEAD` after a queue-parent failure commit lists exactly three paths: the moved PRD (`R` rename status into `failed/`), `<prdId>.recovery.md`, `<prdId>.recovery.json`. No prior commit modifies these paths between the build's last commit and this one.
- [ ] `grep -r getNewBuildFailedEvents packages/ test/` returns zero matches.
- [ ] `grep -r failedPrdDir packages/ test/` returns zero matches outside of any historical changelog/doc strings.
- [ ] `grep -r inFlightRecoveries packages/` returns zero matches.
- [ ] `grep -rn 'lastRecoveryCheckId' packages/` returns zero matches.
- [ ] `cat packages/engine/src/recovery/sidecar.ts | grep schemaVersion` shows `schemaVersion: 2`.
- [ ] Test case `inline recovery: failed queue exec produces single commit with PRD + both sidecars` passes — spawns `EforgeEngine` against a temp git repo with a PRD designed to fail, asserts after the queue exits that `git log --format=%s HEAD~1..HEAD` shows exactly one commit matching `queue(<prdId>): failed - <verdict>` and `git show --name-status HEAD` lists all three paths.
- [ ] Test case `multi-plan PRD failure writes sidecar at failed/<prdId>.recovery.json (NOT plan-03-*.recovery.json)` passes — uses a PRD that compiles into `plan-01`, `plan-02`, `plan-03` and fails on `plan-03`; asserts `existsSync(failed/<prdId>.recovery.json) === true` and `existsSync(failed/plan-03*.recovery.json) === false`.
- [ ] Test case `recovery-analyst parse error -> manual-verdict sidecar still written` passes — uses `StubHarness` from `test/stub-harness.ts` with `text: 'unparseable garbage'` for the recovery-analyst response; asserts the sidecar exists and `JSON.parse(sidecarJsonContents).verdict.verdict === 'manual'` and `recoveryError` field is set.
- [ ] Test case `manual EforgeEngine.recover() with no state.json + populated event db -> partial sidecar with partial:true` passes — constructs a SQLite db with hand-rolled `plan:build:failed` + `agent:start` events for `(setName, prdId)`, no `state.json` on disk; calls `EforgeEngine.recover()` programmatically; asserts the resulting sidecar JSON has `verdict.partial === true` and a non-empty `summary.failingPlan.planId`.
- [ ] Test case `EforgeEngine.recover() with no state.json AND no event db -> partial sidecar with manual verdict and recoveryError` passes — asserts `verdict.verdict === 'manual'` and `verdict.recoveryError` contains a substring describing missing context.
- [ ] Test case `GET /api/recovery/sidecar reads v2 sidecar` passes — writes a v2 sidecar fixture (with `partial: true`, `schemaVersion: 2`); fetches via the route; asserts `res.status === 200` and `data.json.schemaVersion === 2` and `data.json.verdict.partial === true`.
- [ ] `DAEMON_API_VERSION === 8` is asserted in the rewritten test file.
- [ ] Manual end-to-end (post-merge, run by user): build & restart daemon; in `~/projects/ytc/member-portal/`, run `eforge recover <setName> timezone-compliance-sweep` and `eforge recover <setName> zod-enum-schema-factory`; both produce `eforge/queue/failed/<prdId>.recovery.{md,json}` with `partial: true`. (Tracked outside the test suite — verify by inspecting the two sidecar files exist and parse as v2 JSON.)
- [ ] Manual end-to-end forward test (post-merge, run by user): enqueue a deliberately-failing small PRD; when the build fails, `git log --grep='queue(.*): failed'` shows exactly one commit and `git log --grep='queue(.*): move to failed'` shows zero commits for this run; `cat eforge/queue/failed/<prdId>.recovery.json | jq .summary.partial` is `false` or absent (full state-derived summary); `.eforge/state.json` does not exist after the commit lands.
