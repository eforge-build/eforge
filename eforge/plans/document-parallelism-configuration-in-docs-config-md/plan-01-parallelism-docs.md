---
id: plan-01-parallelism-docs
name: Document parallelism configuration
depends_on: []
branch: document-parallelism-configuration-in-docs-config-md/parallelism-docs
---

# Document parallelism configuration

## Architecture Context

`docs/config.md` is the configuration reference for eforge. It documents all `eforge/config.yaml` fields but currently omits `prdQueue.parallelism` from the YAML example block and has no section explaining the three dimensions of parallelism (queue processing, plan execution, enqueuing).

## Implementation

### Overview

Two changes to `docs/config.md`:

1. Add `parallelism: 1` to the `prdQueue` YAML example block, between `autoBuild` and `watchPollIntervalMs` (line 60 area).
2. Add a new `## Parallelism` section immediately after the `## Config Layers` section (after line 156), documenting all three dimensions.

### Key Decisions

1. Place `parallelism: 1` in the YAML block to match the field's position in `DEFAULT_CONFIG` and make it discoverable alongside other `prdQueue` fields.
2. The Parallelism section goes after Config Layers because it's a cross-cutting operational concept that references fields from multiple config sections (`prdQueue.parallelism` and `build.parallelism`).

## Scope

### In Scope
- Adding `parallelism: 1` to the `prdQueue` YAML example block
- New `## Parallelism` section with three subsections: queue processing, plan execution, enqueuing

### Out of Scope
- Changes to any file other than `docs/config.md`
- Changes to parallelism behavior or implementation code

## Files

### Modify
- `docs/config.md` - Add `parallelism: 1` to the `prdQueue` YAML example block; add `## Parallelism` section after `## Config Layers`

## Implementation Details

### Change 1: prdQueue YAML example block

Insert after the `autoBuild: true` line and before `watchPollIntervalMs`:

```yaml
  parallelism: 1              # Max concurrent PRD builds from the queue
```

### Change 2: Parallelism section

Add after the `## Config Layers` section (after the paragraph ending with "CLI flags and environment variables override everything."):

```markdown
## Parallelism

eforge has three dimensions of parallelism:

### Queue processing (`prdQueue.parallelism`)

Controls the maximum number of PRDs built concurrently when processing the queue (`eforge build --queue` or `eforge queue run`). Default: `1` (sequential).

PRDs with `depends_on` frontmatter wait for their dependencies to complete before starting. If a dependency fails, all transitive dependents are marked as blocked and skipped.

CLI override: `--queue-parallelism <n>`

```yaml
prdQueue:
  parallelism: 3    # Build up to 3 PRDs concurrently
```

### Plan execution (`build.parallelism`)

Controls the maximum number of plans executed in parallel within a single build. Applies to expedition and multi-plan profiles where plans run in separate git worktrees. Default: CPU core count via `os.availableParallelism()`.

This is config-only - there is no CLI override.

```yaml
build:
  parallelism: 4    # Run up to 4 plan worktrees in parallel
```

### Enqueuing

Enqueuing is always single-threaded. The formatter processes one PRD at a time before adding it to the queue. No configuration is needed or available.
```

## Verification

- [ ] The `prdQueue` YAML example block contains `parallelism: 1` on its own line between `autoBuild: true` and `watchPollIntervalMs: 5000`
- [ ] A `## Parallelism` heading exists after the `## Config Layers` section
- [ ] The Parallelism section contains a `### Queue processing` subsection that states the default is `1`, describes dependency-gating (PRDs wait for `depends_on`, failures transitively block dependents), and mentions `--queue-parallelism <n>` CLI override
- [ ] The Parallelism section contains a `### Plan execution` subsection that states the default is `os.availableParallelism()`, mentions worktree-based execution, and states it is config-only with no CLI override
- [ ] The Parallelism section contains a `### Enqueuing` subsection stating it is always single-threaded with no configuration
