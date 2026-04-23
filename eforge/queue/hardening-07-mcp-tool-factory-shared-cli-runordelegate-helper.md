---
title: Hardening 07: MCP tool factory + shared CLI runOrDelegate helper
created: 2026-04-23
---

# Hardening 07: MCP tool factory + shared CLI runOrDelegate helper

---
title: "Hardening 07: MCP tool factory + shared CLI runOrDelegate helper"
scope: excursion
depends_on: [2026-04-22-hardening-02-daemon-route-contract]
---

## Problem / Motivation

`packages/eforge/src/cli/mcp-proxy.ts` contains 11 MCP tools (`eforge_build`, `eforge_follow`, `eforge_enqueue`, `eforge_auto_build`, `eforge_status`, `eforge_queue_list`, `eforge_config`, `eforge_backend`, `eforge_models`, `eforge_daemon`, `eforge_init`). Each tool reimplements:

- Daemon-request error wrapping
- JSON stringification of responses (`JSON.stringify(data, null, 2)` scattered)
- Error message formatting
- Logging / debug prints (inconsistent)

If a header needs to be added (e.g., API version check from PRD 03), all 11 tools must be touched. New tools copy-paste boilerplate.

Separately, the CLI's `build` and `queue run` commands in `packages/eforge/src/cli/index.ts` both implement the same three-way branching (delegate to daemon / dry-run / run in-process). That's ~100 lines of duplicated structure.

## Goal

A `createDaemonTool` factory that takes a name, schema, and a typed handler; returns a fully formed MCP tool. All 11 tools use it. A `runOrDelegate` helper encapsulates the CLI's tri-branch; `build` and `queue run` use it.

## Approach

### 1. `createDaemonTool` factory

In `packages/eforge/src/cli/mcp-proxy.ts` (or a new `mcp-tool-factory.ts` alongside):

```ts
interface DaemonToolSpec<Args, Result> {
  name: string;
  description: string;
  schema: z.ZodType<Args>;
  handler: (args: Args, ctx: { cwd: string }) => Promise<Result>;
  formatResponse?: (result: Result) => string; // defaults to JSON.stringify
}

export function createDaemonTool<Args, Result>(spec: DaemonToolSpec<Args, Result>): McpTool {
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: zodToJsonSchema(spec.schema),
    handler: async (rawArgs) => {
      try {
        const args = spec.schema.parse(rawArgs);
        const cwd = resolveCwd(rawArgs); // existing pattern — reuse
        const result = await spec.handler(args, { cwd });
        return {
          content: [{ type: 'text', text: spec.formatResponse?.(result) ?? JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return formatMcpError(err); // shared helper
      }
    },
  };
}
```

`formatMcpError` centralizes how daemon 4xx/5xx, lockfile errors, version mismatch errors (PRD 03), and unknown errors are rendered back to the MCP client.

### 2. Migrate each tool

For each of the 11 tools, pull the current inline logic into a named `handler` and register via `createDaemonTool`. The typed helpers from PRD 02 do the heavy lifting, so most handlers become a few lines:

```ts
const eforgeStatus = createDaemonTool({
  name: 'eforge_status',
  description: '...',
  schema: z.object({ cwd: z.string() }),
  handler: async (args, ctx) => apiStatus({ cwd: ctx.cwd }),
});
```

Tools with non-trivial pre/post-processing (`eforge_build` with its enqueue + follow flow, `eforge_init` with its migration branch) still go through the factory - the handler just has more logic inside.

### 3. `runOrDelegate` CLI helper

In `packages/eforge/src/cli/run-or-delegate.ts` (new):

```ts
export async function runOrDelegate(opts: {
  cwd: string;
  spec: SessionSpec;
  dryRun: boolean;
  follow: boolean;
  onEvent?: (event: DaemonStreamEvent) => void;
}): Promise<CliExitInfo> {
  if (opts.dryRun) return runDryRun(opts.spec);
  if (await daemonIsRunning(opts.cwd)) return delegateToDaemon(opts);
  return runInProcess(opts); // existing in-process path
}
```

Migrate `packages/eforge/src/cli/index.ts` `build` and `queue run` commands to call `runOrDelegate`. Preserve the argument shape users already rely on.

### 4. Error formatting

Centralize user-facing error formatting in a single place - ensure consistent messages for:

- Daemon not running (instruct `eforge daemon start`)
- Daemon version mismatch (PRD 03)
- Invalid config / missing `eforge/config.yaml`
- Network/lock errors

Share this between `formatMcpError` and the CLI's process-exit path so both surfaces speak the same language.

## Scope

### In scope

- New files: `packages/eforge/src/cli/{mcp-proxy,run-or-delegate,errors}.ts` plus edits to `index.ts`.
- `createDaemonTool` factory covering all 11 MCP tools (`eforge_build`, `eforge_follow`, `eforge_enqueue`, `eforge_auto_build`, `eforge_status`, `eforge_queue_list`, `eforge_config`, `eforge_backend`, `eforge_models`, `eforge_daemon`, `eforge_init`).
- `runOrDelegate` helper used by `build` and `queue run`.
- Centralized `formatMcpError` / CLI error formatting for: daemon not running, daemon version mismatch (PRD 03), invalid config / missing `eforge/config.yaml`, network/lock errors.
- Deduplicating the common `cwd` arg across tool schemas.
- New test: `test/mcp-tool-factory.test.ts` exercising the factory with a fake handler (assert error wrapping, response formatting, version-check pass-through).

### Out of scope

- Adding new MCP tools.
- Changing tool arg schemas (aside from deduplicating the common `cwd` param).
- Renaming the MCP tools (breaking).

## Acceptance Criteria

- `pnpm test && pnpm build` pass.
- Every MCP tool exercised against a live daemon via `mcp__eforge__*` produces a response. Error cases (daemon down, invalid args, daemon 500) produce uniformly formatted messages.
- `eforge build <prd>` and `eforge queue run` behave identically before and after the refactor (both happy path and dry-run).
- `rg "JSON.stringify\(.*null, 2\)" packages/eforge/src/cli/mcp-proxy.ts` returns at most one hit (inside the factory default).
- A new `test/mcp-tool-factory.test.ts` exists and asserts error wrapping, response formatting, and version-check pass-through against a fake handler.
