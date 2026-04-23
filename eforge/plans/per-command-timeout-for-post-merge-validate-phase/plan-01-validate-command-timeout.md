---
id: plan-01-validate-command-timeout
name: Per-command timeout for post-merge validate phase
depends_on: []
branch: per-command-timeout-for-post-merge-validate-phase/validate-command-timeout
---

# Per-command timeout for post-merge validate phase

## Architecture Context

The orchestrator's `validate()` phase in `packages/engine/src/orchestrator/phases.ts` runs post-merge commands sequentially via `promisify(execFile)` imported inline at the top of that file (lines 7-10). Today the call site is `await exec('sh', ['-c', cmd], { cwd: mergeWorktreePath })` (line 475) with no `timeout` option and no process-group handling. A child that hangs (vite, tsc, pnpm blocked on a TTY) pins the engine indefinitely; nothing has surfaced as an error in practice.

This plan introduces a new `execWithTimeout()` helper that spawns child processes in their own process group, enforces a wall-clock timeout, and performs an SIGTERM-grace-SIGKILL kill on the whole group. The validate phase switches to this helper, threads the configured timeout through `PhaseContext` / `OrchestratorOptions`, emits a new `validation:command:timeout` event, and treats a timeout exactly like a non-zero exit so the existing `validationFixer` loop (phases.ts line 498) picks up with no new recovery path.

The new event is also wired into the monitor UI event-card renderer and the CLI display so a stuck build is unmistakable on both surfaces.

Config defaults live in `packages/engine/src/config.ts` alongside the existing `build.postMergeCommands` schema and `DEFAULT_CONFIG.build`. The PRD references `packages/engine/src/schemas.ts` for the schema, but that file is for agent XML-output schemas only - the config.yaml Zod schema actually lives in `config.ts` (`eforgeConfigBaseSchema.build`). All config changes therefore happen in `config.ts`.

## Implementation

### Overview

1. Add `postMergeCommandTimeoutMs` config key (optional number, default 300_000, floor 10_000, clamp with `config:warning` event).
2. Create `packages/engine/src/exec-with-timeout.ts` exporting `execWithTimeout()` that spawns `sh -c <cmd>` as a process-group leader, arms a timer, and on expiry walks SIGTERM (grace 3000 ms) -> SIGKILL on the negative PID. Returns `{ stdout, stderr, exitCode, timedOut }` and never throws on timeout.
3. Thread `postMergeCommandTimeoutMs` through `OrchestratorOptions`, `PhaseContext`, and `eforge.ts` config wiring.
4. Rewrite the exec call in `validate()` (phases.ts:475) to use `execWithTimeout()`. On `timedOut === true`, emit a new `validation:command:timeout` event carrying `{ command, timeoutMs, pid }`, then emit the existing `validation:command:complete` with a synthetic non-zero exit and a `[timed out after Nm]` output so the existing fixer path fires. Record timeout in the validation summary so it surfaces in the CLI and monitor UI.
5. Add `validation:command:timeout` to the `EforgeEvent` union in `packages/engine/src/events.ts`.
6. Render the event in `packages/monitor-ui/src/components/timeline/event-card.tsx` (both `eventTitle()` and `eventDetail()`) and in `packages/eforge/src/cli/display.ts` so it visibly breaks the validation spinner.
7. Document the new key in `docs/config.md` next to the existing `postMergeCommands` comment block.
8. Tests covering unit behavior of `execWithTimeout()` (process-group kill) and integration behavior of the validate phase.

### Key Decisions

1. **Single scalar config key, applied uniformly.** `postMergeCommandTimeoutMs` applies to every entry in `postMergeCommands` and `validateCommands`. Per-command overrides are explicitly out of scope per the PRD.
2. **Default 300_000 ms, floor 10_000 ms, clamp with warning.** When the user sets a value below the floor we clamp to 10_000 and yield a `config:warning` event (existing event type in `events.ts:156`, already emitted from `eforge.ts` during config resolution). The warning fires from inside the `validate()` phase on first use (not during `resolveConfig()` which does not have an event stream) so the message reaches the run event timeline.
3. **SIGTERM-then-SIGKILL on process group.** Use `spawn('sh', ['-c', cmd], { cwd, detached: true })` so the child becomes a process group leader (`PGID === PID`). Send `process.kill(-child.pid, 'SIGTERM')`, wait `3000` ms, then `process.kill(-child.pid, 'SIGKILL')` if still alive. This takes out vite workers, nested pnpm children, etc. On Windows (`process.platform === 'win32'`), fall back to `spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)])`. Windows support is declared best-effort.
4. **Timeout reuses the failure recovery path.** Rather than invent a new failure mode in `validate()`, a timeout emits `validation:command:timeout` and then feeds `failures.push({ command, exitCode: 124, output: '[timed out after <N>ms]' })` (exit 124 is the coreutils `timeout(1)` convention). `validationPassed = false`, loop breaks, `validationFixer` runs exactly as today.
5. **Event shape is `validation:command:timeout` not `validate:command-timeout`.** The existing event family uses the `validation:` prefix with colon separators (`validation:command:start`, `validation:command:complete`, `validation:complete`). The PRD's `validate:command-timeout` naming would be a one-off. Using `validation:command:timeout` keeps the namespace consistent. Include `{ command, timeoutMs, pid }` as the PRD specifies.
6. **Helper lives at `packages/engine/src/exec-with-timeout.ts`** (sibling module), not appended to the inline `exec` in phases.ts. Keeps the new helper independently testable and does not perturb the `promisify(execFile)` call used elsewhere in the file (e.g., `await exec('git', ['rev-parse', ...])` calls outside the validate loop continue to use the plain `execFile` wrapper - they are not subject to hang risk the way user-supplied validate commands are).
7. **No retries inside the helper.** The helper runs one command once. The outer validate-phase loop owns retry semantics via the existing fixer cycle.

## Scope

### In Scope

- New `build.postMergeCommandTimeoutMs` config key with 5-minute default and 10-second floor.
- Floor enforcement that clamps the value and emits a `config:warning` event when the user sets a sub-floor value.
- New `execWithTimeout()` helper module with process-group kill semantics (POSIX) and `taskkill /F /T /PID` fallback (Windows).
- Rewiring of `validate()` phase to use the helper, thread the timeout, emit `validation:command:timeout`, and feed the existing fixer loop on timeout.
- New `validation:command:timeout` event added to `EforgeEvent` union.
- CLI display handler (`packages/eforge/src/cli/display.ts`) renders the timeout event by failing the active validation spinner with `✗ <cmd> timed out after <N>ms`.
- Monitor UI event-card handler (`packages/monitor-ui/src/components/timeline/event-card.tsx`) renders the timeout event in both title and detail functions.
- Documentation in `docs/config.md` under the existing `build:` block, showing the new key with default commented.
- Unit test for `execWithTimeout()`: spawn `sh -c 'sleep 10 & sleep 10; wait'` with a 500 ms timeout; assert `timedOut: true`, `exitCode !== 0`, and no orphan child remains (verify via `ps` or by asserting the parent process group has no live members).
- Integration test for `validate()`: run the phase with a stub command list containing `sh -c 'sleep 60'` and a `postMergeCommandTimeoutMs` of 250 ms; assert `validation:command:timeout` fires, `validation:command:complete` fires with non-zero `exitCode`, and the injected `validationFixer` generator is invoked.
- Manual verification steps (see Verification).

### Out of Scope

- Per-command timeout overrides (explicitly deferred per PRD).
- Timeouts on `executePlans()` or `finalize()` phases (explicitly out of scope per PRD).
- Timeouts on agent / LLM calls (Hardening 06 territory).
- Windows process-tree-kill semantics beyond the best-effort `taskkill /F /T /PID` fallback.
- Any change to the `exec` helper used for git operations elsewhere in phases.ts - those are short-lived and not hang-prone.

## Files

### Create

- `packages/engine/src/exec-with-timeout.ts` - new helper exporting `execWithTimeout(command: string, options: { cwd: string; timeoutMs: number; graceMs?: number; signal?: AbortSignal }): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean; pid: number }>`. Spawns `sh -c <command>` via `child_process.spawn` with `detached: true` on POSIX (drops the process group on Windows). Buffers stdout/stderr, arms a `setTimeout(timeoutMs)`, and on fire: `process.kill(-child.pid, 'SIGTERM')` -> `setTimeout(graceMs ?? 3000)` -> `process.kill(-child.pid, 'SIGKILL')`. Windows path uses `spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)])`. Resolves with `timedOut: true` on timeout (never throws). Honors `signal?.aborted` by running the same kill path.
- `test/exec-with-timeout.test.ts` - unit coverage for the helper. At minimum: (a) short sleep under timeout completes normally; (b) long sleep over timeout sets `timedOut: true` and `exitCode !== 0`; (c) process-group kill reaches nested children - spawn a shell that forks a backgrounded `sleep` and verify both are gone after timeout; (d) abort-signal path kills the group.
- `test/validate-phase-timeout.test.ts` - integration coverage for the validate phase. Constructs a minimal `PhaseContext` (no real orchestrator needed; `validate()` is an exported async generator), injects `postMergeCommandTimeoutMs: 250`, `validateCommands: ["sh -c 'sleep 60'"]`, a stub `validationFixer` that records invocations, and drives the generator. Asserts: `validation:command:timeout` fires with the right payload; `validation:command:complete` follows with non-zero `exitCode`; fixer is called once; state transitions to the retry path.

### Modify

- `packages/engine/src/config.ts` - extend `eforgeConfigBaseSchema.build` with `postMergeCommandTimeoutMs: z.number().int().positive().optional()`; add the same key to the `EforgeConfig.build` TypeScript interface (line 307); add `postMergeCommandTimeoutMs: 300_000` to `DEFAULT_CONFIG.build` (line 347); extend `resolveConfig()` (line 424 area) to include the field using `?? DEFAULT_CONFIG.build.postMergeCommandTimeoutMs`. Export a `MIN_POST_MERGE_COMMAND_TIMEOUT_MS = 10_000` constant for reuse by the validate phase.
- `packages/engine/src/events.ts` - add `| { type: 'validation:command:timeout'; command: string; timeoutMs: number; pid: number }` to the `EforgeEvent` union between `validation:command:complete` (line 270) and `validation:complete` (line 271).
- `packages/engine/src/orchestrator.ts` - add `postMergeCommandTimeoutMs?: number` to `OrchestratorOptions` (around line 71-72); plumb into the `PhaseContext` assembly (line 166 area) so the phase sees it.
- `packages/engine/src/orchestrator/phases.ts` - (a) add `postMergeCommandTimeoutMs?: number` to `PhaseContext` near the existing `postMergeCommands` field (line 34); (b) import `execWithTimeout` from `../exec-with-timeout.js` and `MIN_POST_MERGE_COMMAND_TIMEOUT_MS` from `../config.js`; (c) in `validate()` (line 447), resolve the effective timeout: if `ctx.postMergeCommandTimeoutMs` is undefined use `300_000`; if below `MIN_POST_MERGE_COMMAND_TIMEOUT_MS` yield a `config:warning` event (source `'validate'`, message noting the clamp) and clamp to the floor; (d) replace the `exec('sh', ['-c', cmd], ...)` call with `execWithTimeout(cmd, { cwd: mergeWorktreePath, timeoutMs, signal })`; (e) on `timedOut: true` yield `validation:command:timeout`, then yield `validation:command:complete` with `exitCode: 124` and `output: "[timed out after <Nm>]"`, push into `failures`, set `validationPassed = false`, break the inner loop. Normal non-zero exits keep the existing behavior unchanged.
- `packages/engine/src/eforge.ts` - in the `Orchestrator` construction call (line 759), add `postMergeCommandTimeoutMs: config.build.postMergeCommandTimeoutMs`.
- `packages/eforge/src/cli/display.ts` - add a `case 'validation:command:timeout':` handler near line 540 that fails the active `validation:${event.command}` spinner with `✗ <cmd> timed out after <N>s` (reuse `failSpinner`).
- `packages/monitor-ui/src/components/timeline/event-card.tsx` - (a) add `case 'validation:command:timeout':` to `eventSummary()` (function declared at line 30; insert near the existing `validation:command:complete` case at line 83) returning `` `${event.command}: timed out (${event.timeoutMs}ms)` ``; (b) add it to `eventDetail()` (function declared at line 110; insert near the existing `validation:command:complete` case at line 186) returning a short explanatory string referencing the pid and timeout. Also add a branch in `classifyEvent()` (line 14) so the new event classifies as `'failed'` rather than falling through to the default `'info'`, ensuring the timeline styles it as a failure.
- `docs/config.md` - under the `build:` YAML block (around line 62-68), add:
  ```yaml
  # postMergeCommandTimeoutMs: 300000  # Per-command timeout (ms) for postMerge/validate commands (default: 300000, floor: 10000)
  ```
  Add a short paragraph below the block explaining behavior: "Each command in `postMergeCommands` and the planner-generated validate commands runs under a wall-clock timeout. On expiry the full subprocess tree is killed and the validation-fixer loop is invoked as if the command had exited non-zero. Default 300000 ms (5 minutes). Values below 10000 ms are clamped and emit a `config:warning` event."

## Verification

- [ ] `pnpm type-check` passes.
- [ ] `pnpm build` passes (all workspace packages bundle cleanly).
- [ ] `pnpm test` passes, including the two new test files.
- [ ] `test/exec-with-timeout.test.ts`: the process-group assertion proves that when a parent shell spawns a backgrounded `sleep` inside the command, both the shell and the backgrounded `sleep` are dead within 1 second of the timeout firing (queryable via `ps -p <pid>` returning non-zero, or `process.kill(pgid, 0)` throwing `ESRCH`).
- [ ] `test/validate-phase-timeout.test.ts`: running `validate()` with `postMergeCommandTimeoutMs: 250` and a `sleep 60` command yields events in order `validation:start` -> `validation:command:start` -> `validation:command:timeout` -> `validation:command:complete` (with `exitCode === 124`) -> `validation:complete` (with `passed: false`) -> `validation:fix:start`.
- [ ] `test/validate-phase-timeout.test.ts`: setting `postMergeCommandTimeoutMs: 50` (below the 10000 floor) produces a `config:warning` event before the first command runs and the effective timeout used is `10000`.
- [ ] Manual end-to-end (documented in commit message, not automated): set `build.postMergeCommandTimeoutMs: 5000` in `eforge/config.yaml` and add `- sh -c 'sleep 30'` to `postMergeCommands`. Enqueue any PRD. Confirm that after ~5 seconds the sleep is killed, a `validation:command:timeout` appears in the monitor UI timeline, the run either fails or enters the validation-fixer loop, and `ps aux | grep sleep` shows no orphaned sleep process originating from the merge worktree.
- [ ] Manual end-to-end happy path: a normal build with the default 300000 ms timeout produces no `validation:command:timeout` events.
- [ ] CLI display: a timed-out command in a `pnpm eforge run` invocation fails the corresponding validation spinner with a "timed out after Ns" suffix, not a generic `exit 124` line.
