---
id: plan-02-api-queue-and-ui
name: Per-build override across API, queue, CLI, and monitor UI
branch: parameterize-eforge-on-success-landing-actions/plan-02-api-queue-and-ui
agents:
  builder:
    effort: medium
    rationale: Mostly plumbing — wire-shape extension, child-process arg
      propagation, frontmatter persistence — but spans many files and needs
      durable persistence across queue exec.
---

# Per-build override across API, queue, CLI, and monitor UI

## Architecture Context

Plan-01 introduces `build.onSuccess` as a project-level default and lands the engine-side landing executor. This plan exposes the per-build override surface so `/eforge:build` and `eforge_build` can flip the action on a single build without changing the project config. The override is plumbed through:

- The daemon HTTP enqueue route (`POST /api/enqueue`) gains an optional `onSuccess` field on `EnqueueRequest`.
- The PRD frontmatter schema persists `onSuccess` alongside `profile` so the override survives across queued/autobuild child processes (per AGENTS.md, queued PRDs execute in their own child processes via `spawnPrdChild` — an in-memory override would be lost).
- The CLI's `eforge enqueue` and `eforge queue exec` and `eforge build` commands gain `--on-success <action>` flags.
- The queue scheduler reads `frontmatter.onSuccess` and propagates it into the child via `--on-success`.
- The engine resolves precedence: explicit `BuildOptions.onSuccess` > PRD `frontmatter.onSuccess` > config `build.onSuccess` > default `'merge-to-base-branch'`.
- The monitor UI reducer and timeline event card learn to render `landing:*` events distinctly from `merge:finalize:*`.

According to AGENTS.md: daemon route shapes live in `@eforge-build/client` (`packages/client/src/routes.ts`). `EnqueueRequest.onSuccess` is added there, and `DAEMON_API_VERSION` is bumped in `packages/client/src/api-version.ts` because the wire surface changes (adding an optional field is the same kind of additive bump as `profile` got in v28 — but to keep daemon/client lockstep clear, bump anyway). The monitor server in `packages/monitor/src/server.ts` validates `body.onSuccess` before spawning a worker, mirroring the pattern used for `body.profile`.

The "single-entry-point" rules from AGENTS.md still apply: no direct emission of landing decisions; the engine continues to use the helpers added in plan-01.

## Implementation

### Overview

1. Extend `EnqueueRequest` in `packages/client/src/routes.ts` with `onSuccess?: 'merge-to-base-branch' | 'issue-pr' | 'leave-branch'`.
2. Bump `DAEMON_API_VERSION` in `packages/client/src/api-version.ts` and document the change in the version comment.
3. In `packages/monitor/src/server.ts` enqueue handler: validate `body.onSuccess` against the closed set; emit a 400 for unknown values; propagate to the worker via `--on-success` CLI arg.
4. Extend `prdFrontmatterSchema` in `packages/engine/src/prd-queue.ts` with `onSuccess: z.enum([...]).optional()`, update `parseFrontmatter` (which is line-based, not yaml-based — make sure the new key is recognised), update `EnqueuePrdOptions` and `enqueuePrd` to write the field into frontmatter.
5. In `packages/engine/src/queue/scheduler.ts` and `packages/engine/src/eforge.ts::spawnPrdChild`: read `prd.frontmatter.onSuccess` and pass `--on-success <value>` to the child process.
6. In `packages/eforge/src/cli/index.ts`: add `--on-success <action>` to `enqueue`, `queue exec`, and `build` commands. The flag value is plumbed into `EnqueueOptions.onSuccess` or `BuildOptions.onSuccess` respectively.
7. In `packages/engine/src/eforge.ts::enqueue`: include `onSuccess` in the persisted PRD frontmatter when the option is provided.
8. In `packages/monitor-ui/src/lib/reducer/index.ts`: add `'landing:start'`, `'landing:complete'`, `'landing:skipped'` to the known event-type set (and any reducer slices that track terminal landing state).
9. In `packages/monitor-ui/src/components/timeline/event-card.tsx`: add display strings for the three new variants, distinguishing `merged → base`, `PR opened → <url>`, and `branch left: <featureBranch>`.
10. Add tests for the full path: `EnqueueRequest` validation, frontmatter round-trip, child-process arg propagation, and reducer/event-card rendering.

### Key Decisions

1. **Precedence: option > frontmatter > config > default.** When the daemon receives `POST /api/enqueue { onSuccess: 'leave-branch' }`, the enqueue worker persists `onSuccess: leave-branch` into the PRD frontmatter. When the scheduler later spawns `queue exec`, it forwards the persisted frontmatter value via `--on-success`. The engine's `eforge.ts::build` then sees `options.onSuccess === 'leave-branch'`, which already wins over `config.build.onSuccess` via the resolver added in plan-01. This avoids any in-memory state that could be lost across child boundaries (Source: Risks — Queue durability).
2. **`--on-success` is the single child-process channel.** Both the queue exec child and the direct `build` CLI path accept the flag. The flag value is validated by the engine; invalid values throw before any spawn/build work happens. This keeps PRD-frontmatter + flag + config in a tight, testable triangle.
3. **`DAEMON_API_VERSION` bumps even though the field is optional.** Adding an optional response field doesn't require a bump, but `EnqueueRequest.onSuccess` adds a new control-plane semantic the daemon must implement to honour — a stale daemon would silently ignore it and fall back to the config default, which would surprise the user. Bumping ensures version-mismatch detection surfaces the daemon/client skew clearly.
4. **Monitor UI text is action-aware.** `merge:finalize:complete` keeps its existing text ("Finalized: feat/x → main"). `landing:complete` switches text by action: `merge-to-base-branch` → "Merged: feat/x → main (sha)"; `issue-pr` → "PR opened: <url>"; `leave-branch` → "Branch ready: feat/x". `landing:skipped` is rendered as "Landing skipped (<action>): <reason>".
5. **No new CLI subcommand.** The override is a flag on existing commands (`enqueue`, `queue exec`, `build`) — adding a new subcommand for landing policy would be UX noise and there's no use case that isn't covered by the flag.

## Scope

### In Scope
- `EnqueueRequest.onSuccess` wire field and validation.
- `DAEMON_API_VERSION` bump with documented changelog entry.
- Monitor server enqueue handler: validates `body.onSuccess`, propagates via `--on-success`.
- PRD frontmatter `onSuccess` parsing + persistence (write side in `enqueuePrd`, read side in `parseFrontmatter` and the Zod schema).
- Queue scheduler / `spawnPrdChild` propagation of `frontmatter.onSuccess` to the child via `--on-success`.
- CLI flags: `eforge enqueue --on-success`, `eforge queue exec --on-success`, `eforge build --on-success`.
- Engine option wiring: `EnqueueOptions.onSuccess` → frontmatter; `BuildOptions.onSuccess` → `Orchestrator`.
- Monitor UI reducer event-type set additions and timeline event card text for the three landing events.
- Tests for: schema validation, frontmatter round-trip, child-process arg propagation, precedence ordering.

### Out of Scope
- Engine landing executor (plan-01).
- Pi extension and Claude plugin tool schema changes (plan-03).
- Skill markdown updates (plan-03).
- Public docs site updates (plan-03).
- Surfacing per-base landing locks for `merge-to-base-branch` concurrency safety (deferred per source Risks).

## Files

### Create
- `test/onsuccess-override-precedence.test.ts` — assert option > frontmatter > config > default. Use a real `EforgeEngine` and a temp queue dir; spy on `Orchestrator` construction to capture the resolved `onSuccess`.
- `test/prd-frontmatter-onsuccess.test.ts` — assert `enqueuePrd({ onSuccess: 'leave-branch' })` writes the field; `parseFrontmatter` reads it back; the Zod schema rejects an invalid string.
- `test/queue-scheduler-onsuccess-propagation.test.ts` — assert the scheduler passes `--on-success` to the child when `frontmatter.onSuccess` is set, and omits the flag when it's not (use the existing `spawnPrdChild` stub pattern from `test/queue-scheduler.test.ts`).

### Modify
- `packages/client/src/routes.ts` — extend `EnqueueRequest` with `onSuccess?: 'merge-to-base-branch' | 'issue-pr' | 'leave-branch'`. Export a `BuildOnSuccess` type alias so consumers don't redeclare the union.
- `packages/client/src/api-version.ts` — bump `DAEMON_API_VERSION` to v36 (next after the current v35); prepend a versioned summary describing the new optional `onSuccess` field on `EnqueueRequest`, the propagated PRD frontmatter `onSuccess` key, and the new `landing:*` event variants from plan-01.
- `packages/monitor/src/server.ts` — in the `API_ROUTES.enqueue` handler, after `body.profile` validation, validate `body.onSuccess`: if defined, assert it is one of the three values; otherwise return 400. When valid, append `--on-success <value>` to the worker args before `spawnWorker('enqueue', args)`.
- `packages/engine/src/prd-queue.ts` — extend `prdFrontmatterSchema` with `onSuccess: z.enum(['merge-to-base-branch', 'issue-pr', 'leave-branch']).optional()`; ensure `parseFrontmatter` returns the value as a string so the Zod parse succeeds (the existing line parser handles plain strings already, so no new branches are needed — verify with a fixture). Extend `EnqueuePrdOptions` with `onSuccess?: BuildOnSuccess`; in `enqueuePrd`, write `onSuccess: <value>` into `fmLines` when defined. Also extend `setQueuedPrdProfile`-style mutation pattern: add `setQueuedPrdOnSuccess` *only if* a code path actually rewrites the field at runtime (none exists today — skip unless needed).
- `packages/engine/src/queue/scheduler.ts` — at the child-spawn call site (line ~753), forward `prd.frontmatter.onSuccess` into a new `spawnPrdChild` parameter alongside `routedProfileOverride`. No new event surface — the override flows through silently.
- `packages/engine/src/eforge.ts` — in `spawnPrdChild` (line ~1170), accept an optional `onSuccess` arg and append `--on-success <value>` to the child args (mirror the `--profile` block at line ~1232). In the `enqueue` method (around line 530), persist `options.onSuccess` into the PRD frontmatter via the `enqueuePrd` call.
- `packages/eforge/src/cli/index.ts` — add `.option('--on-success <action>', 'Override the project default on-success landing action')` to the `enqueue`, `queue exec`, and `build` commands (around lines 425, 530, 746). Plumb the parsed value through `EnqueueOptions.onSuccess` / `BuildOptions.onSuccess`. Reject invalid values up-front with a clear error before any engine work.
- `packages/monitor-ui/src/lib/reducer/index.ts` — extend the event-type set near line 236 with the three new variants. If the reducer has a `finalize` slice or terminal-state map, add cases for the new events.
- `packages/monitor-ui/src/components/timeline/event-card.tsx` — add cases for `landing:start`, `landing:complete`, `landing:skipped` near line 103 with the action-aware text from Key Decision 4 above.

## Verification

- [ ] `POST /api/enqueue { source: '...', onSuccess: 'foo' }` returns HTTP 400 with a message naming the field; valid values return 200.
- [ ] After `eforge enqueue <source> --on-success leave-branch`, the resulting PRD file in the queue dir contains `onSuccess: leave-branch` in its YAML frontmatter.
- [ ] `parseFrontmatter` + `prdFrontmatterSchema.safeParse` accept the new field; an unknown value fails the parse.
- [ ] When the scheduler spawns a child for a PRD whose frontmatter has `onSuccess: issue-pr`, the child argv contains `--on-success issue-pr` (asserted via the existing `spawnPrdChild` stub pattern).
- [ ] `eforge build <source> --on-success issue-pr` constructs an `Orchestrator` whose resolved `onSuccess` is `'issue-pr'` regardless of `config.build.onSuccess`.
- [ ] Precedence test: when both `--on-success` and `frontmatter.onSuccess` are present, the explicit option wins. When only the frontmatter value is present, that wins over the config default.
- [ ] `DAEMON_API_VERSION` is incremented and the inline comment documents the new optional `onSuccess` field.
- [ ] Monitor UI reducer's known-event-type set includes the three new types; the timeline event card renders distinct text for each (`Merged: ...`, `PR opened: <url>`, `Branch ready: ...`, `Landing skipped (<action>): <reason>`).
- [ ] `pnpm type-check`, `pnpm test`, and `pnpm build` pass.
