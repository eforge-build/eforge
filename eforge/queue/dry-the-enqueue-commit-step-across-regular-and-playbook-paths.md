---
title: DRY the enqueue commit step across regular and playbook paths
created: 2026-04-30
---

# DRY the enqueue commit step across regular and playbook paths

## Problem / Motivation

Two enqueue paths exist in the daemon, and they diverged on whether they commit the resulting queue file:

- **Regular enqueue** — `POST /api/enqueue` (`packages/monitor/src/server.ts:890`) spawns a subprocess that runs `eforge enqueue` → `EforgeEngine.enqueue()` (`packages/engine/src/eforge.ts:359-468`). Subprocess is justified: it runs the **formatter agent** and **dependency-detector agent** (LLM calls, seconds long) and streams `enqueue:start`/`enqueue:complete` events. It writes via `enqueuePrd()` and then commits via inline `git add` + `forgeCommit` at `eforge.ts:446-455`.
- **Playbook enqueue** — `POST /api/playbook/enqueue` (`packages/monitor/src/server.ts:1506`) calls `enqueuePrd()` directly in-process. In-process is justified: playbooks pre-supply formatted content + explicit `afterQueueId`, no LLM agents are needed, and the `/eforge:playbook` skill UX depends on a synchronous `validateDependsOnExists` + response. It writes via `enqueuePrd()` and **never commits** — the queue file lands untracked in `eforge/queue/`. The user just hit this and noticed.

**The legitimate divergence** (subprocess vs in-process) stays. **The illegitimate divergence** is that the trivial write-and-commit step has two implementations — one inline in the engine, one missing entirely on the daemon HTTP path.

A latent bug compounds the gap: `eforge.ts:448` calls `forgeCommit` without a `paths` argument, so any pre-staged user changes get swept into the `enqueue(...)` commit. The codebase pattern at `prd-queue.ts:292` shows the right shape — `forgeCommit(cwd, msg, { paths: [filePath] })`.

## Goal

Both paths call one named helper that does `git add <file>` + `forgeCommit(... { paths: [file] })`. Playbook enqueue starts producing tracked commits. Regular enqueue stops sweeping unrelated staged changes. The subprocess vs in-process split stays exactly as it is.

## Approach

Add **`commitEnqueuedPrd(filePath, prdId, title, cwd)`** to `packages/engine/src/prd-queue.ts`, alongside the existing `cleanupCompletedPrd` (`prd-queue.ts:271`) which is the parallel pattern. The helper does:

```ts
await retryOnLock(() => exec('git', ['add', '--', filePath], { cwd }), cwd);
await forgeCommit(
  cwd,
  composeCommitMessage(`enqueue(${prdId}): ${title}`),
  { paths: [filePath] },
);
```

Notes:
- `--` after `git add` matches `prd-queue.ts:286, 311` style.
- `paths: [filePath]` scopes the commit (fixes the latent bug).
- Existing imports in `prd-queue.ts:15` (`forgeCommit`, `retryOnLock`) and the `composeCommitMessage` import (already used at `prd-queue.ts:312`) cover everything needed.

`enqueuePrd()` itself stays a pure file-I/O function — its contract at `prd-queue.ts:561-570` ("Pure file I/O — no agent calls, no events") is load-bearing for tests (`test/prd-queue-enqueue.test.ts`, `test/queue-piggyback.test.ts`) and for `recovery/apply.ts:94`, which uses a different commit message and threads a `modelTracker`. We don't fold commit logic into it.

### Call-site changes

**1. `packages/engine/src/eforge.ts:446-455`**

Replace the inline three-line `git add` + `forgeCommit` block with `await commitEnqueuedPrd(enqueueResult.filePath, enqueueResult.id, title, cwd)`. Keep the surrounding `try/catch` that yields `enqueue:commit-failed` (`events.ts:303`) — that's the streaming behavior the subprocess path needs.

**2. `packages/monitor/src/server.ts:1506-1518`**

After the `await enqueuePrd({...})` call, add `await commitEnqueuedPrd(result.filePath, result.id, title, cwd)` inside the existing `try` block at lines 1496-1526. A commit failure surfaces as the existing 500 response — correct semantics for a synchronous HTTP route. Add `commitEnqueuedPrd` to the dynamic import at line 1481.

**3. Recovery path stays untouched**

`packages/engine/src/recovery/apply.ts:94-111` uses a different commit message (`recover(${prdId}): enqueue successor ...`) and threads a `modelTracker`. Folding it in would force the helper to take a message-builder, undoing the simplicity. Leave it.

### Pi extension parity

Pi calls the daemon HTTP route (`packages/pi-eforge/extensions/eforge/playbook-commands.ts:336`), so the fix flows through automatically. No Pi-side change.

### Critical files

- `packages/engine/src/prd-queue.ts` — add `commitEnqueuedPrd` near `cleanupCompletedPrd` (~line 271)
- `packages/engine/src/eforge.ts` — replace `git add`/`forgeCommit` block at lines 446-455 with one call
- `packages/monitor/src/server.ts` — add `commitEnqueuedPrd` to the dynamic import at line 1481, call it after `enqueuePrd` at line 1518
- `test/playbook-api.test.ts` — extend existing enqueue suite with a commit assertion (file already does `git init` at lines 37-40)

## Scope

### In scope

- New `commitEnqueuedPrd(filePath, prdId, title, cwd)` helper in `packages/engine/src/prd-queue.ts`.
- Refactor of `packages/engine/src/eforge.ts:446-455` to call the new helper, preserving the surrounding `try/catch` that yields `enqueue:commit-failed`.
- Update of `packages/monitor/src/server.ts:1506-1518` to call the new helper after `enqueuePrd`, inside the existing `try` block at lines 1496-1526, with `commitEnqueuedPrd` added to the dynamic import at line 1481.
- Fix the latent `paths` argument bug on the regular enqueue commit by scoping with `paths: [filePath]`.
- Test addition in `test/playbook-api.test.ts` asserting commit message and clean queue dir after `POST /api/playbook/enqueue`.

### Out of scope

- Changing the subprocess vs in-process split between the two enqueue paths — it stays exactly as it is.
- Modifying `enqueuePrd()` itself — its "Pure file I/O — no agent calls, no events" contract at `prd-queue.ts:561-570` is preserved.
- Touching the recovery path at `packages/engine/src/recovery/apply.ts:94-111` (different commit message, threads a `modelTracker`).
- Pi-side changes — Pi calls the daemon HTTP route at `packages/pi-eforge/extensions/eforge/playbook-commands.ts:336` and inherits the fix.
- Emitting any new event from the playbook route — the in-process route returns `{ id }` and stays event-free; recorder (`packages/monitor/src/recorder.ts:52,107`) and session finalizer (`packages/engine/src/session.ts:111`) only consume from the subprocess path.

## Acceptance Criteria

1. **Unit/integration tests**
   - `pnpm test` passes.
   - `test/playbook-api.test.ts` — add an assertion to the existing `POST /api/playbook/enqueue` test that, after the route returns, `git log -1 --pretty=%s` shows `enqueue(<id>): <title>` and `git status --porcelain eforge/queue/` is clean.
   - `test/prd-queue-enqueue.test.ts` and `test/queue-piggyback.test.ts` — should pass unchanged (`enqueuePrd` contract is unmodified).

2. **Type check**
   - `pnpm type-check` passes.

3. **End-to-end via the daemon**
   - `pnpm build` + `eforge daemon stop` + `eforge daemon start`.
   - `mcp__eforge__eforge_playbook { action: "enqueue", name: "plugin-pi-parity-audit" }`.
   - `git log -1 --pretty=%s` should now show `enqueue(<slug>): ...`.
   - `git status --porcelain eforge/queue/` should be clean.

4. **Regression check on regular enqueue**
   - Stage an unrelated change in another file: `git add <unrelated-file>`.
   - Run `eforge enqueue "test prd"` (which runs through the subprocess path).
   - The resulting `enqueue(...)` commit should contain only the queue file, not the unrelated staged change.

## Risks

- **Commit failure on the playbook route now becomes a hard 500** instead of silently leaving an untracked file. The opposite would silently re-introduce the bug the user hit. Loud failure is correct; the queue file stays on disk and the operation is idempotent (`git add` on an already-tracked unchanged file is a no-op).
- **`paths: [filePath]` narrows commit scope** for the regular path. Intended fix — but if any caller relies on co-staged changes being swept in, it would regress. No such caller exists; `eforge enqueue` is only invoked from clean trees.
- **No new event emitted from the playbook route.** The "engine emits, consumers render" rule stays intact: subprocess path keeps emitting `enqueue:*` events; in-process route returns `{ id }` and stays event-free. Recorder (`packages/monitor/src/recorder.ts:52,107`) and session finalizer (`packages/engine/src/session.ts:111`) only consume from the subprocess path.
