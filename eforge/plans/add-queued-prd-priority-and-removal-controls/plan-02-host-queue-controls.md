---
id: plan-02-host-queue-controls
name: CLI, MCP, and Pi Queue Control Surfaces
branch: add-queued-prd-priority-and-removal-controls/plan-02-host-queue-controls
---

# CLI, MCP, and Pi Queue Control Surfaces

## Architecture Context

This plan adds user-facing host controls on top of the queue-control client helpers from `plan-01-core-queue-control`. The CLI, Claude/MCP proxy, and Pi extension must stay thin: they validate only presentation-level concerns, call shared client helpers or shared route constants, and return daemon responses without duplicating queue filesystem logic.

Pi extension files are subject to a no-start daemon policy. Use `api*IfRunning` helpers or the Pi-local no-start wrappers for Pi tools; do not import non-`IfRunning` `api*` helpers into `packages/pi-eforge/extensions/eforge/`.

## Implementation

### Overview

Add scriptable CLI commands and matching MCP/Pi tools for setting queued PRD priority and removing non-running queue items. Keep the Claude/MCP and Pi tool names, schemas, descriptions, success payloads, and error behavior aligned.

### Key Decisions

1. Add explicit companion tools (`eforge_queue_priority`, `eforge_queue_remove`) instead of overloading `eforge_queue_list`. This keeps tool calls simple and avoids action unions on the existing read-only list tool.
2. CLI priority parsing sends numeric values to the daemon helper and lets the daemon produce validation errors for non-integers. `Number('abc')` serializes to `null`, which the daemon rejects with the same priority validation path.
3. Do not modify `packages/pi-eforge/package.json`; the Pi package version is handled at publish time.
4. Do not change `eforge-plugin/` files unless a skill document is edited. If a plugin file is edited during implementation, bump `eforge-plugin/.claude-plugin/plugin.json` in the same change.

## Scope

### In Scope

- `eforge queue priority <prdId> <priority>`.
- `eforge queue remove <prdId>`.
- MCP tool `eforge_queue_priority`.
- MCP tool `eforge_queue_remove`.
- Pi tool `eforge_queue_priority`.
- Pi tool `eforge_queue_remove`.
- CLI/MCP/Pi tests for registration, typed helper usage, payload shape, success output, and representative error handling.

### Out of Scope

- Console UI controls.
- Human-authored docs and generated reference artifacts; those are updated after all user surfaces land.
- Queue cascade, pause, hold, or running cancellation by PRD id.
- Plugin version bump unless plugin files are edited.

## Files

### Create

- `packages/eforge/src/cli/queue-control.ts` — Commander registration helper for the two new queue mutation subcommands, keeping `index.ts` below its no-growth ceiling.
- `test/queue-controls-cli-mcp-pi.test.ts` — host-surface tests for CLI, MCP source/tool behavior, and Pi source/no-start parity.

### Modify

- `packages/eforge/src/cli/index.ts` — import and call the queue-control command registration helper after creating the `queue` command.
- `packages/eforge/src/cli/mcp-proxy.ts` — import queue-control helpers and register `eforge_queue_priority` plus `eforge_queue_remove` inline so docs-gen can extract them.
- `packages/pi-eforge/extensions/eforge/index.ts` — import `apiUpdateQueuePriorityIfRunning` and `apiRemoveQueueItemIfRunning`, then register matching Pi tools inline so docs-gen can extract them.
- `test/pi-no-start-policy.test.ts` — update only if the static policy allowlist needs a new non-request utility; `api*IfRunning` imports already pass by suffix.

## Implementation Details

### CLI

- Add `registerQueueControlCommands(queue: Command): void` in `packages/eforge/src/cli/queue-control.ts`.
- Register `queue priority <prdId> <priority>`:
  - Convert the `priority` argument with `Number(priorityRaw)`.
  - Call `apiUpdateQueuePriority({ cwd: process.cwd(), prdId, body: { priority } })`.
  - Print a success line containing the PRD id and the returned priority, for example `Queue priority updated: <id> -> <priority>`.
  - On error, use `formatCliError`, print `Error: <message>` to stderr, and exit with the returned exit code.
- Register `queue remove <prdId>`:
  - Call `apiRemoveQueueItem({ cwd: process.cwd(), prdId })`.
  - Print a success line containing the PRD id and `removed`, plus the previous status, for example `Queue item removed: <id> (was <status>)`.
  - If `removedSidecars` is non-empty, print a secondary line listing the sidecars.
  - On error, use `formatCliError`, print `Error: <message>` to stderr, and exit with the returned exit code.

### MCP Proxy

- Add `apiUpdateQueuePriority` and `apiRemoveQueueItem` imports from `@eforge-build/client`.
- Register `eforge_queue_priority` near `eforge_queue_list`:
  - Description: set the priority for a pending or waiting queued PRD; lower numbers run earlier; running builds must be cancelled by session id.
  - Schema: `prdId: z.string()`, `priority: z.number().int()`.
  - Handler calls `apiUpdateQueuePriority({ cwd: toolCwd, prdId, body: { priority } })` and returns `data`.
- Register `eforge_queue_remove` near `eforge_queue_list`:
  - Description: remove a non-running queued PRD; failed sidecars are deleted for failed items; live dependents cause a conflict.
  - Schema: `prdId: z.string()`.
  - Handler calls `apiRemoveQueueItem({ cwd: toolCwd, prdId })` and returns `data`.
- Rely on `createDaemonTool` for JSON formatting and daemon error payloads.

### Pi Extension

- Import only `apiUpdateQueuePriorityIfRunning` and `apiRemoveQueueItemIfRunning` as value imports.
- Register Pi tools near `eforge_queue_list`:
  - `eforge_queue_priority` with `prdId` and integer `priority` parameters.
  - `eforge_queue_remove` with `prdId` parameter.
- In each tool, call the `IfRunning` helper with `ctx.cwd`. If it returns `null`, throw `DAEMON_NOT_RUNNING_GUIDANCE`.
- Return `jsonResult(data)` on success.
- Keep Pi package version unchanged.

## Verification

- [ ] `eforge queue priority` appears under the Commander `queue` command with required `prdId` and `priority` args.
- [ ] `eforge queue remove` appears under the Commander `queue` command with required `prdId` arg.
- [ ] CLI success tests print the PRD id and new priority for `queue priority`.
- [ ] CLI success tests print the PRD id and `removed` for `queue remove`.
- [ ] CLI error tests surface daemon validation, not-found, conflict, and daemon-unavailable messages via `formatCliError`.
- [ ] MCP source tests find `name: 'eforge_queue_priority'`, `name: 'eforge_queue_remove'`, `apiUpdateQueuePriority`, and `apiRemoveQueueItem` in `mcp-proxy.ts`.
- [ ] MCP handler tests return JSON containing `id`, status fields, and `priority` for the priority tool.
- [ ] MCP handler tests return JSON containing `id`, `previousStatus`, `currentStatus: 'removed'`, and `removedSidecars` for the remove tool.
- [ ] Pi source tests find `name: "eforge_queue_priority"`, `name: "eforge_queue_remove"`, `apiUpdateQueuePriorityIfRunning`, and `apiRemoveQueueItemIfRunning` in the Pi extension.
- [ ] Pi no-start policy tests pass with no non-`IfRunning` `api*` value imports.
- [ ] No `eforge-plugin/` files change in this plan; if one changes, `plugin.json` version increments in the same commit.
