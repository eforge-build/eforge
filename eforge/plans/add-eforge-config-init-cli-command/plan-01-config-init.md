---
id: plan-01-config-init
name: Add eforge config init CLI command
dependsOn: []
branch: add-eforge-config-init-cli-command/config-init
---

# Add eforge config init CLI command

## Architecture Context

The `eforge config` parent command already has `validate` and `show` subcommands in `src/cli/index.ts` (~line 556-586). This plan adds `init` as a third subcommand following the same patterns. Interactive prompts follow the `readline/promises` pattern used in `src/cli/interactive.ts` and the daemon stop prompt. Config utilities (`findConfigFile`, `validateConfigFile`) are imported from `src/engine/config.ts`.

## Implementation

### Overview

Add `eforge config init [--backend <claude-sdk|pi>]` that interactively scaffolds a minimal `eforge/config.yaml`, then update README.md and docs/config.md to reference the new command and the `/eforge:config` plugin skill.

### Key Decisions

1. Use `readline/promises` for interactive prompts - consistent with existing CLI code in `src/cli/interactive.ts` and daemon stop flow.
2. Use `findConfigFile(process.cwd())` to detect existing config - reuses the engine's walk-up logic so it matches how the engine discovers config.
3. Write config via `yaml` package `stringify()` - consistent with `config show` command.
4. Validate the generated file via `validateConfigFile()` as a safety check before printing success.

## Scope

### In Scope
- `eforge config init` subcommand with `--backend` flag
- Interactive prompts for backend selection, pi provider, and model ID
- Config file generation for both `claude-sdk` and `pi` backends
- Existence check to prevent overwriting existing config
- Post-write validation via `validateConfigFile()`
- README.md quick-start update
- docs/config.md quick-start tip

### Out of Scope
- Advanced config options (langfuse, hooks, plugins) - users can add those manually or via `/eforge:config`
- Overwrite/force flag - keep it simple, refuse if config exists

## Files

### Modify
- `src/cli/index.ts` — Add `config init` subcommand after the existing `config show` command (~line 586). Includes `--backend` option, interactive readline prompts, `eforge/` directory creation, YAML file write, and validation.
- `README.md` — Replace the manual config creation instruction at line 76 with quick-start block referencing `eforge config init` and `/eforge:config`.
- `docs/config.md` — Add quick-start tip after line 2 referencing `eforge config init` and `/eforge:config`.

## Verification

- [ ] `pnpm build` completes with exit code 0
- [ ] `pnpm type-check` completes with exit code 0
- [ ] The `config init` subcommand is registered under the `config` parent command in `src/cli/index.ts`
- [ ] When no `eforge/config.yaml` exists, running the command creates one with `backend: claude-sdk` (default) or `backend: pi` with `pi.provider` and `agents.models.max` fields
- [ ] When `eforge/config.yaml` already exists (detected via `findConfigFile`), the command prints a message and exits without writing
- [ ] The `--backend` flag accepts `claude-sdk` or `pi` and skips the backend selection prompt when provided
- [ ] For `pi` backend, the command prompts for provider (default `openrouter`) and model ID (required, re-prompts if empty)
- [ ] The generated config passes `validateConfigFile()` validation
- [ ] README.md line 76 area contains `eforge config init` and `/eforge:config` references
- [ ] docs/config.md contains a quick-start tip referencing `eforge config init` and `/eforge:config`
