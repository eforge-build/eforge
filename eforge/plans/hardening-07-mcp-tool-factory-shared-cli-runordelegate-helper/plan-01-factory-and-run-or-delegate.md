---
id: plan-01-factory-and-run-or-delegate
name: MCP tool factory + runOrDelegate helper + shared error formatting
depends_on: []
branch: hardening-07-mcp-tool-factory-shared-cli-runordelegate-helper/factory-and-run-or-delegate
---

# MCP tool factory + runOrDelegate helper + shared error formatting

## Architecture Context

The MCP stdio proxy (`packages/eforge/src/cli/mcp-proxy.ts`) exposes 11 tools — `eforge_build`, `eforge_follow`, `eforge_enqueue`, `eforge_auto_build`, `eforge_status`, `eforge_queue_list`, `eforge_config`, `eforge_backend`, `eforge_models`, `eforge_daemon`, and `eforge_init`. Each tool is registered via `server.tool(name, desc, schemaObj, handler)`. Today every handler reimplements:

- error handling (mostly `throw` with no wrapping, or ad-hoc `{ error }` payloads with `isError: true`)
- JSON stringification via `JSON.stringify(data, null, 2)` (every tool does this)
- response shaping (`{ content: [{ type: 'text', text: ... }] }`)

On the CLI side (`packages/eforge/src/cli/index.ts`), the `build` command duplicates a tri-branch pattern (lines ~257-402): delegate to daemon when running → fall back to in-process → `--dry-run` path. `queue run` (lines ~487-545) shares the in-process branch conceptually but is spelled out separately.

This plan extracts the duplicated structure behind three small modules: a `createDaemonTool` factory, a `runOrDelegate` helper, and a shared error formatter used by both surfaces. It depends on hardening-02 having already landed `@eforge-build/client`'s `API_ROUTES` / `buildPath` / typed per-route API helpers (`apiStatus`, `apiEnqueue`, etc.), which the existing mcp-proxy already consumes. Future daemon HTTP version-check headers (hardening-03) will layer on top of `formatMcpError` without further factory changes.

## Implementation

### Overview

1. Add `packages/eforge/src/cli/errors.ts` with a single source of truth for daemon/network/lockfile/version-mismatch/invalid-config messages. Export both a CLI-oriented renderer (returns a string + suggested exit code) and an MCP-oriented renderer (returns an `{ content, isError }` payload). Both call the same classifier so the surfaces stay in lock-step.
2. Add `packages/eforge/src/cli/mcp-tool-factory.ts` with `createDaemonTool<Args, Result>(spec)` that wraps `server.tool` registration. The factory takes a Zod schema (the raw Zod shape, matching `server.tool`'s existing signature) plus a typed async handler and handles response formatting and error wrapping via `formatMcpError` from `errors.ts`. Tools that need progress notifications or elicitations receive a `ctx` object carrying `{ cwd, extra, server }`.
3. Migrate all 11 tools in `mcp-proxy.ts` to use `createDaemonTool`. Pull tool handler bodies into named functions so the registration block becomes declarative. The cwd argument — today closed over from `runMcpProxy(cwd)` — is threaded via the `ctx.cwd` the factory provides, so tool schemas no longer individually declare `cwd` (none currently do; nothing to dedupe beyond the implicit closure, so "deduplicate the common cwd arg" becomes "all tools receive cwd through the factory context rather than each closing over the outer variable directly").
4. Add `packages/eforge/src/cli/run-or-delegate.ts` with `runOrDelegate(opts)` that encapsulates the `build` command's tri-branch:
   - `--dry-run` → run the existing enqueue-then-compile flow and call `showDryRun`
   - daemon running (checked via `readLockfile`) and not `--foreground` → enqueue via `apiEnqueue`, print session + monitor URL, exit 0
   - otherwise → in-process enqueue + `engine.runQueue` against the just-enqueued name
   All three paths preserve exit-code semantics. The helper returns a `CliExitInfo` that the caller converts to `process.exit(code)`.
5. Migrate `build` and `queue run` in `index.ts` to call `runOrDelegate`. `queue run` only ever uses the in-process branch (it has no `--dry-run` and doesn't delegate), so it passes `{ mode: 'queue' }` and reuses only the in-process arm of the helper — the shared structure comes from both commands going through the same entry point and using the same error formatter on failure.
6. Add `test/mcp-tool-factory.test.ts` with three cases: (a) factory wraps a successful handler and JSON-stringifies the result with 2-space indent by default, (b) a custom `formatResponse` is respected, (c) errors from the handler are rendered through `formatMcpError` — including the four error classes (daemon-not-running, daemon-version-mismatch, invalid-config, network/lock) — producing uniformly shaped `{ content, isError: true }` payloads.

### Key Decisions

1. **Keep Zod schema shape identical to `server.tool`.** The MCP SDK's `server.tool` takes a `ZodRawShape` (object of field → Zod type), not a `z.object({...})`. Matching the existing signature avoids churn at every call site and avoids a `zodToJsonSchema` dependency. The factory stays a thin wrapper: it only replaces the handler, not the registration shape.
2. **`errors.ts` classifies once, renders twice.** A single `classifyDaemonError(err)` returns a tagged union (`{ kind: 'daemon-down' | 'version-mismatch' | 'invalid-config' | 'lock' | 'network' | 'unknown', message: string, hint?: string }`). Both `formatMcpError` and the CLI's `formatCliError` consume that tag — guaranteeing the two surfaces speak the same language even when hardening-03 adds a new kind.
3. **Factory context over positional args.** Handlers receive `(args, ctx)` where `ctx = { cwd, extra, server }`. `extra` is the MCP SDK's per-call context (used by `eforge_follow` for `_meta.progressToken` and `signal`). `server` is the `McpServer` instance (used by `eforge_init` for `elicitInput` and by `eforge_follow` for progress notifications). This keeps the factory generic without forcing every tool to re-import `server`.
4. **`runOrDelegate` accepts a discriminated `mode`.** `{ mode: 'build', source, dryRun, foreground, options, engineFactory }` versus `{ mode: 'queue', ... }`. `queue run` only ever runs in-process, but funneling both through the same helper means the in-process path has exactly one implementation and the daemon-error fallback message is consistent.
5. **Preserve user-facing argument shape.** The `build` and `queue run` command options stay byte-for-byte identical; only their bodies change. Verification includes a manual smoke of both happy-path and `--dry-run` to confirm behavior parity.
6. **Per-plan agent tuning omitted.** This is a mechanical refactor with no novel API design; engine defaults are appropriate.

## Scope

### In Scope
- New file `packages/eforge/src/cli/errors.ts` — `classifyDaemonError`, `formatMcpError`, `formatCliError`, and the canonical user-facing messages for: daemon not running (hint to `eforge daemon start`), daemon version mismatch (placeholder hint, hardening-03 will wire the actual check), invalid config / missing `eforge/config.yaml`, network/lock errors.
- New file `packages/eforge/src/cli/mcp-tool-factory.ts` — `createDaemonTool` factory returning the same registration call the existing tools use; wraps all error handling and response formatting.
- Edits to `packages/eforge/src/cli/mcp-proxy.ts` — migrate all 11 tools (`eforge_build`, `eforge_follow`, `eforge_enqueue`, `eforge_auto_build`, `eforge_status`, `eforge_queue_list`, `eforge_config`, `eforge_backend`, `eforge_models`, `eforge_daemon`, `eforge_init`) to the factory. Replace inline `JSON.stringify(..., null, 2)` calls (the factory default covers them; only the factory itself may retain one).
- New file `packages/eforge/src/cli/run-or-delegate.ts` — `runOrDelegate` helper consolidating the build/queue-run tri-branch.
- Edits to `packages/eforge/src/cli/index.ts` — migrate `build` and `queue run` command bodies to call `runOrDelegate`. Keep CLI options and flag parsing untouched. Route CLI error handling through `formatCliError`.
- New test file `test/mcp-tool-factory.test.ts` — asserts response formatting (default JSON-stringify, custom formatter), error wrapping for each error class returned by `classifyDaemonError`, and version-check pass-through (using a hand-crafted error object cast through `unknown` to simulate the header check; per AGENTS.md: no mocks, hand-craft inputs inline).

### Out of Scope
- Adding new MCP tools.
- Renaming existing MCP tools or changing their arg schemas (aside from what the factory context implicitly centralizes).
- Wiring the actual daemon version-check HTTP header — that lands in hardening-03. This plan only reserves the `version-mismatch` classification and error message so the factory/formatter do not need to change when hardening-03 lands.
- Touching `packages/pi-eforge/` — Pi does not use this CLI or the MCP stdio proxy.
- Changing resources (`eforge://status`, `eforge://queue`, `eforge://config`, `eforge://status/{sessionId}`) — the source targets the 11 tools, not the 4 resources. Leaving resources alone matches the source's "In scope" list.
- Documentation updates beyond inline JSDoc; no user-facing behavior changes.

## Files

### Create
- `packages/eforge/src/cli/errors.ts` — `DaemonErrorKind` tagged union, `classifyDaemonError`, `formatMcpError`, `formatCliError`. Used by both the MCP factory and CLI entry points.
- `packages/eforge/src/cli/mcp-tool-factory.ts` — `DaemonToolSpec<Args, Result>` interface and `createDaemonTool(server, spec, ctx)` helper that registers the tool via `server.tool` with wrapped error handling and response formatting.
- `packages/eforge/src/cli/run-or-delegate.ts` — `runOrDelegate(opts)` helper plus the `CliExitInfo` type.
- `test/mcp-tool-factory.test.ts` — vitest file covering factory behavior, custom formatter, and error classification pass-through. Hand-crafted inputs, no mocks, per AGENTS.md.

### Modify
- `packages/eforge/src/cli/mcp-proxy.ts` — migrate all 11 tools to `createDaemonTool`; remove inline `JSON.stringify(..., null, 2)` from tool handlers; remove the duplicated `{ error: '... required when action is "X"' }` payloads in favor of throwing typed errors the factory renders. Resources remain unchanged.
- `packages/eforge/src/cli/index.ts` — migrate `build` command (the ~145-line action at lines ~201-403) and `queue run` command (~58-line action at lines ~498-545) to call `runOrDelegate`. Route any caught errors through `formatCliError` before `process.exit(1)`.

## Verification

- [ ] `pnpm type-check` exits zero.
- [ ] `pnpm test` exits zero, including the new `test/mcp-tool-factory.test.ts`.
- [ ] `pnpm build` exits zero and emits `packages/eforge/dist/cli.js`.
- [ ] `rg "JSON\.stringify\(.*null, 2\)" packages/eforge/src/cli/mcp-proxy.ts` returns at most one hit (inside the factory default in `mcp-tool-factory.ts` is fine; the source requirement targets `mcp-proxy.ts` specifically).
- [ ] Every MCP tool (`eforge_build`, `eforge_follow`, `eforge_enqueue`, `eforge_auto_build`, `eforge_status`, `eforge_queue_list`, `eforge_config`, `eforge_backend`, `eforge_models`, `eforge_daemon`, `eforge_init`) is registered via `createDaemonTool` — confirmed by `rg "server\.tool\(" packages/eforge/src/cli/mcp-proxy.ts` returning zero direct calls (all go through the factory).
- [ ] `test/mcp-tool-factory.test.ts` contains at least one assertion for each of: success path default JSON formatting, custom `formatResponse` path, `daemon-down` error wrapping, `version-mismatch` error wrapping, `invalid-config` error wrapping, `lock`/`network` error wrapping.
- [ ] `eforge build <prd>` against a running daemon enqueues the PRD and exits 0 with the session ID and monitor URL printed — matching pre-refactor output exactly.
- [ ] `eforge build <prd> --dry-run` compiles and prints the dry-run execution plan without delegating — matching pre-refactor behavior.
- [ ] `eforge build <prd> --foreground` with no daemon running executes in-process and exits 0 on success.
- [ ] `eforge queue run --all` processes pending queue entries in-process and exits 0 when complete.
- [ ] CLI error paths (daemon down with no fallback possible, invalid config, network error) print messages produced by `formatCliError` that match the messages produced by `formatMcpError` for the same classified error.
