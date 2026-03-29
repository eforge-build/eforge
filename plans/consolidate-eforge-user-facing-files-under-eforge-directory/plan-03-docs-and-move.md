---
id: plan-03-docs-and-move
name: Documentation Updates and File Moves
depends_on: [plan-02-consumers]
branch: consolidate-eforge-user-facing-files-under-eforge-directory/docs-and-move
---

# Documentation Updates and File Moves

## Architecture Context

With all code updated to use new paths, this plan updates documentation to reflect the new directory structure and moves the actual project files (`eforge.yaml` -> `eforge/config.yaml`, `docs/prd-queue/` -> `eforge/queue/`). The `.gitignore` must correctly ignore `.eforge/` (runtime state) but NOT `eforge/` (committable artifacts).

## Implementation

### Overview

1. Update all documentation files referencing old paths
2. Move `eforge.yaml` to `eforge/config.yaml`
3. Move `docs/prd-queue/` to `eforge/queue/` (or create empty `eforge/queue/` if source doesn't exist)
4. Verify `.gitignore` is correct

### Key Decisions

1. File moves use `git mv` for clean history tracking.
2. The `eforge/` directory must be created before moving files into it.
3. `.gitignore` already has `.eforge/` (with the dot prefix), so `eforge/` (no dot) is not excluded. No `.gitignore` change needed.

## Scope

### In Scope
- Updating path references in CLAUDE.md, docs/config.md, docs/hooks.md, docs/roadmap.md, README.md, eforge-plugin/skills/config/config.md
- Moving `eforge.yaml` to `eforge/config.yaml` via `git mv`
- Moving `docs/prd-queue/` to `eforge/queue/` via `git mv` (or creating `eforge/queue/` if source doesn't exist)
- Verifying `.gitignore` does not exclude `eforge/`

### Out of Scope
- Any code changes (handled by plan-01 and plan-02)

## Files

### Create
- `eforge/` - Directory for consolidated eforge artifacts (created as part of file moves)

### Modify
- `CLAUDE.md` - Replace `eforge.yaml` with `eforge/config.yaml`, `docs/prd-queue` with `eforge/queue`, update project structure diagram
- `README.md` - Update any path references from `eforge.yaml` to `eforge/config.yaml` and `plans/` examples
- `docs/config.md` - Change `outputDir: plans` example to `outputDir: eforge/plans`, change `dir: docs/prd-queue` to `dir: eforge/queue`, update all `eforge.yaml` references to `eforge/config.yaml`
- `docs/hooks.md` - Update any `eforge.yaml` references to `eforge/config.yaml`
- `docs/roadmap.md` - Update any path references
- `eforge-plugin/skills/config/config.md` - Update `dir: docs/prd-queue` to `dir: eforge/queue`, update `eforge.yaml` references to `eforge/config.yaml`
- `eforge.yaml` -> `eforge/config.yaml` - File move (git mv)
- `docs/prd-queue/` -> `eforge/queue/` - Directory move (git mv)

## Verification

- [ ] `eforge/config.yaml` exists and contains valid YAML config
- [ ] `eforge/queue/` directory exists
- [ ] No `eforge.yaml` file exists at the project root
- [ ] No `docs/prd-queue/` directory exists
- [ ] `.gitignore` contains `.eforge/` but does NOT contain a line that would exclude `eforge/`
- [ ] Zero occurrences of `eforge.yaml` in CLAUDE.md, docs/config.md, docs/hooks.md, README.md, eforge-plugin/skills/config/config.md (except in legacy warning context)
- [ ] Zero occurrences of `docs/prd-queue` in any documentation file
- [ ] `pnpm dev -- config validate` succeeds reading `eforge/config.yaml`
- [ ] `pnpm dev -- config show` shows `eforge/queue` as queue dir and `eforge/plans` as plan output dir
