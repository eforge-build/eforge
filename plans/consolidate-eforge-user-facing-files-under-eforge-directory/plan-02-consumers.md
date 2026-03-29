---
id: plan-02-consumers
name: Monitor, CLI, MCP, and Test Updates
depends_on: [plan-01-engine-paths]
branch: consolidate-eforge-user-facing-files-under-eforge-directory/consumers
---

# Monitor, CLI, MCP, and Test Updates

## Architecture Context

With engine defaults and path wiring updated in plan-01, this plan updates all consumer code that hardcodes paths: the monitor server, CLI help text, MCP tool descriptions, and tests. The monitor server currently hardcodes `'docs/prd-queue'` and `'plans'` paths instead of reading from config. Tests assert against old default values.

## Implementation

### Overview

1. Update `src/monitor/server.ts` to accept `queueDir` and `planOutputDir` from config rather than hardcoding paths
2. Update CLI and MCP description strings from `eforge.yaml` to `eforge/config.yaml`
3. Fix CLI's `showDryRun` to use config-driven plan path
4. Update test expectations to match new defaults

### Key Decisions

1. The monitor server's `createMonitorServer` options interface gains `queueDir` and `planOutputDir` fields. Callers pass these from resolved config. This keeps the server agnostic of config loading.
2. For the `plans` path traversal security check in the monitor server, `expectedBase` derives from the same `planOutputDir` option rather than hardcoding `'plans'`.

## Scope

### In Scope
- Monitor server: replace hardcoded `'docs/prd-queue'` and `'plans'` with config-driven options
- CLI: update `eforge.yaml` description strings, replace hardcoded `'plans'` in `showDryRun`
- MCP proxy: update `eforge.yaml` reference in tool description
- Tests: update `test/config.test.ts` to use `eforge/config.yaml` paths, update `test/watch-queue.test.ts` default dir expectation

### Out of Scope
- Engine code changes (plan-01)
- Documentation and file moves (plan-03)

## Files

### Modify
- `src/monitor/server.ts` - Add `queueDir` and `planOutputDir` to server options interface; replace `resolve(cwd, 'docs/prd-queue')` on line ~508 with `options.queueDir ?? resolve(cwd, 'eforge/queue')`; replace `resolve(cwd, 'plans', ...)` on lines ~377-378, 433-434, 595 with `options.planOutputDir ?? 'eforge/plans'`
- `src/cli/index.ts` - Update `.description('Validate eforge.yaml configuration')` on line ~561 to reference `eforge/config.yaml`; replace `resolve(cwd, 'plans', planSet, ...)` on line ~109 with config-driven path
- `src/cli/mcp-proxy.ts` - Update `eforge.yaml` reference on line ~515 to `eforge/config.yaml`
- `test/config.test.ts` - Update test fixtures to create `eforge/config.yaml` instead of `eforge.yaml`; add test that `findConfigFile()` returns `null` when only legacy `eforge.yaml` exists and logs a warning
- `test/watch-queue.test.ts` - Change `dir: 'docs/prd-queue'` on line ~52 to `dir: 'eforge/queue'`

## Verification

- [ ] `pnpm build` compiles with zero errors
- [ ] `pnpm test` passes all tests
- [ ] Zero occurrences of `'docs/prd-queue'` remain in `src/monitor/server.ts`
- [ ] Zero hardcoded `resolve(cwd, 'plans',` remain in `src/monitor/server.ts` or `src/cli/index.ts`
- [ ] `test/config.test.ts` includes a test asserting `findConfigFile()` returns `null` for legacy `eforge.yaml`
- [ ] CLI `config validate` description references `eforge/config.yaml`, not `eforge.yaml`
