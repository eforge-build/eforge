---
id: plan-02-host-queue-controls
name: CLI, MCP, and Pi Queue Control Surfaces
branch: complete-host-queue-controls-race-safety-fixes-and-docs/plan-02-host-queue-controls
agents:
  builder:
    effort: high
    rationale: Adds three host surfaces while preserving semantic client helper
      contracts and Pi no-start policy.
  tester:
    effort: high
    rationale: Host controls need CLI, MCP, and Pi success/error coverage against
      real daemon helpers.
  reviewer:
    effort: high
    rationale: Review must guard against raw daemon body construction and route
      literal drift across host integrations.
---

# CLI, MCP, and Pi Queue Control Surfaces

## Architecture Context

The daemon route contracts, typed client helpers, and Console queue controls already exist. After race-safety fixes land, this plan exposes queue priority and removal controls through the remaining host surfaces: standalone CLI, Claude/MCP proxy, and Pi extension.

Host code must stay thin. CLI, MCP, and Pi callers pass `prdId` plus `priority` to shared `@eforge-build/client` helpers. They must not construct raw `{ body: { priority } }` request shapes and must not inline `/api/...` queue-control route literals.

## Implementation

### Overview

Add two queue subcommands and two matching MCP/Pi tools:

- `eforge queue priority <prdId> <priority>`
- `eforge queue remove <prdId>`
- `eforge_queue_priority`
- `eforge_queue_remove`

Return daemon success payloads and daemon error messages consistently across the host surfaces.

### Key Decisions

1. Keep queue priority and removal as companion commands/tools rather than adding action unions to the existing queue-list tools.
2. Use `apiUpdateQueuePriority({ cwd, prdId, priority })` and `apiRemoveQueueItem({ cwd, prdId })` in CLI and MCP code.
3. Use `apiUpdateQueuePriorityIfRunning({ cwd, prdId, priority })` and `apiRemoveQueueItemIfRunning({ cwd, prdId })` in Pi code to preserve the Pi no-start daemon policy.
4. Register MCP and Pi tools inline in `mcp-proxy.ts` and `packages/pi-eforge/extensions/eforge/index.ts` so docs-gen can extract the final tool surface.
5. Avoid `eforge-plugin/` changes in this plan. If a plugin file changes, bump only `eforge-plugin/.claude-plugin/plugin.json` in the same commit.

## Scope

### In Scope

- CLI `queue priority` command.
- CLI `queue remove` command.
- MCP `eforge_queue_priority` tool.
- MCP `eforge_queue_remove` tool.
- Pi `eforge_queue_priority` tool.
- Pi `eforge_queue_remove` tool.
- Host-surface tests for registration, semantic helper usage, success payloads, error surfacing, and Pi no-start policy.

### Out of Scope

- Console queue controls already merged in the predecessor session.
- Engine queue-control race-safety logic, covered by plan-01.
- Human docs and generated references, covered by plan-04.
- Public client helper signature changes.
- Queue hold, pause, cascade deletion, or running cancellation by queued PRD id.

## Files

### Create

- `packages/eforge/src/cli/queue-control.ts` — Commander registration helper for queue priority and removal subcommands.
- `test/queue-controls-cli-mcp-pi.test.ts` — CLI/MCP/Pi host-surface tests.

### Modify

- `packages/eforge/src/cli/index.ts` — import and call `registerQueueControlCommands(queue)` immediately after creating the `queue` command.
- `packages/eforge/src/cli/mcp-proxy.ts` — import `apiUpdateQueuePriority` and `apiRemoveQueueItem`; register `eforge_queue_priority` and `eforge_queue_remove` near `eforge_queue_list`.
- `packages/pi-eforge/extensions/eforge/index.ts` — import `apiUpdateQueuePriorityIfRunning` and `apiRemoveQueueItemIfRunning`; register matching Pi tools near `eforge_queue_list`.
- `test/pi-no-start-policy.test.ts` — update only if the static no-start allowlist requires a new non-request utility; `api*IfRunning` imports must pass without allowlist expansion.

## Implementation Details

### CLI

Create `registerQueueControlCommands(queue: Command): void` in `packages/eforge/src/cli/queue-control.ts`.

`queue priority <prdId> <priority>`:

- Convert the raw priority argument to a number.
- Call `apiUpdateQueuePriority({ cwd: process.cwd(), prdId, priority })`.
- Print a success line containing the returned PRD id and returned priority, for example `Queue priority updated: <id> -> <priority>`.
- On error, call `formatCliError`, print `Error: <message>` to stderr, and exit with the returned code.
- Do not pass `{ body: { priority } }` from CLI code.

`queue remove <prdId>`:

- Call `apiRemoveQueueItem({ cwd: process.cwd(), prdId })`.
- Print a success line containing the returned PRD id and `removed`, including the previous status.
- If `removedSidecars` is non-empty, print a second line listing the removed sidecar paths.
- On error, call `formatCliError`, print `Error: <message>` to stderr, and exit with the returned code.

### MCP Proxy

Register tools with `createDaemonTool` near `eforge_queue_list`.

`eforge_queue_priority`:

- Description mentions pending/waiting support, lower numbers running earlier, and running cancellation by session id.
- Schema contains `prdId: z.string()` and `priority: z.number().int()`.
- Handler calls `apiUpdateQueuePriority({ cwd: toolCwd, prdId, priority })` and returns `data`.

`eforge_queue_remove`:

- Description mentions non-running removal, failed recovery sidecar cleanup, running refusal, and live-dependent conflicts.
- Schema contains `prdId: z.string()`.
- Handler calls `apiRemoveQueueItem({ cwd: toolCwd, prdId })` and returns `data`.

### Pi Extension

Register tools near `eforge_queue_list`.

`eforge_queue_priority`:

- Parameters contain `prdId` and integer `priority`.
- Handler calls `apiUpdateQueuePriorityIfRunning({ cwd: ctx.cwd, prdId, priority })`.
- If the helper returns `null`, throw `DAEMON_NOT_RUNNING_GUIDANCE`.
- Return `jsonResult(data)`.

`eforge_queue_remove`:

- Parameters contain `prdId`.
- Handler calls `apiRemoveQueueItemIfRunning({ cwd: ctx.cwd, prdId })`.
- If the helper returns `null`, throw `DAEMON_NOT_RUNNING_GUIDANCE`.
- Return `jsonResult(data)`.

### Tests

- Use a real monitor server, `writeLockfile`, and `clearApiVersionCache` for CLI and Pi success/error tests.
- For CLI success, write queue PRDs under a temp project, run `createProgram(...).parseAsync(['queue', 'priority', ...])` and `['queue', 'remove', ...]`, and assert stdout plus filesystem changes.
- For CLI daemon-unavailable behavior, use a temp path matching the agent-worktree guard or another fast failure path; do not wait for daemon-start timeout.
- For MCP, source-test the registered tool blocks and semantic helper calls, and use `createDaemonTool` with the same handler pattern for JSON success/error formatting if direct proxy registration capture remains impractical.
- For MCP and Pi error tests, exercise validation, not-found, and conflict failures and assert tool error payloads preserve daemon messages; for Pi, also assert the no-start guidance path.
- For Pi, instantiate the extension with a hand-crafted `ExtensionAPI` stub, execute captured tools, and assert JSON success payloads plus daemon-not-running errors.
- Add source assertions that queue-control host blocks do not contain `body: { priority }`, `'/api/`, or `"/api/` literals.

## Verification

- [ ] Commander registers `eforge queue priority <prdId> <priority>` under the `queue` command.
- [ ] Commander registers `eforge queue remove <prdId>` under the `queue` command.
- [ ] CLI priority success prints the PRD id and new priority.
- [ ] CLI remove success prints the PRD id and `removed` status.
- [ ] CLI priority validation failure exits non-zero and prints the daemon validation message or the identical local finite-integer message.
- [ ] CLI priority not-found failure exits non-zero and prints the daemon not-found message.
- [ ] CLI priority conflict failure exits non-zero and prints the daemon conflict message.
- [ ] CLI daemon-unavailable failure exits non-zero and prints the formatted daemon error message.
- [ ] CLI calls `apiUpdateQueuePriority({ cwd, prdId, priority })` and `apiRemoveQueueItem({ cwd, prdId })`.
- [ ] MCP registers `eforge_queue_priority` and `eforge_queue_remove`.
- [ ] MCP queue priority returns JSON containing `id`, `previousStatus`, `currentStatus`, and `priority` on success.
- [ ] MCP queue remove returns JSON containing `id`, `previousStatus`, `currentStatus: "removed"`, and `removedSidecars` on success.
- [ ] MCP queue priority validation, not-found, and conflict failures preserve the daemon error message in the `createDaemonTool` error payload.
- [ ] MCP queue remove not-found and conflict failures preserve the daemon error message in the `createDaemonTool` error payload.
- [ ] MCP queue-control blocks contain no raw `/api/` route literals.
- [ ] MCP queue priority code does not construct `body: { priority }`.
- [ ] Pi registers `eforge_queue_priority` and `eforge_queue_remove`.
- [ ] Pi queue priority returns JSON containing `id`, `previousStatus`, `currentStatus`, and `priority` on success.
- [ ] Pi queue remove returns JSON containing `id`, `previousStatus`, `currentStatus: "removed"`, and `removedSidecars` on success.
- [ ] Pi queue priority daemon-not-running, validation, not-found, and conflict failures preserve the daemon or no-start guidance message in the returned tool error.
- [ ] Pi queue remove daemon-not-running, not-found, and conflict failures preserve the daemon or no-start guidance message in the returned tool error.
- [ ] Pi queue-control blocks contain no raw `/api/` route literals.
- [ ] Pi queue priority code does not construct `body: { priority }`.
- [ ] Pi imports only `apiUpdateQueuePriorityIfRunning` and `apiRemoveQueueItemIfRunning` as queue-control API helper values.
- [ ] `packages/pi-eforge/package.json` is unchanged.
- [ ] If any `eforge-plugin/` file changes, `eforge-plugin/.claude-plugin/plugin.json` version increments.
- [ ] `pnpm test -- test/queue-controls-cli-mcp-pi.test.ts test/pi-no-start-policy.test.ts` exits 0.