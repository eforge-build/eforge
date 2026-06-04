---
id: plan-04-queue-control-docs
name: Queue-Control Documentation and Generated References
branch: complete-host-queue-controls-race-safety-fixes-and-docs/plan-04-queue-control-docs
agents:
  builder:
    effort: medium
    rationale: Documentation and generated reference updates span several docs but
      follow established content patterns.
  reviewer:
    effort: medium
    rationale: Docs review must verify shipped-vs-future wording and generated
      reference drift.
---

# Queue-Control Documentation and Generated References

## Architecture Context

After race-safety and host integrations land, human-authored docs and generated references must describe the queue-control behavior that is now shipped. Generated artifacts derive from route constants, Commander command registration, MCP tool registration, and Pi tool registration, so this plan runs last.

## Implementation

### Overview

Update docs for runtime priority mutation, non-running queue removal, failed-sidecar cleanup, running refusal, dependency-safety refusal, Console actions already added by the predecessor session, and CLI/MCP/Pi host actions. Run `pnpm docs:generate` and commit all generated reference/mirror changes.

### Key Decisions

1. Treat priority mutation and queue removal as shipped controls, not roadmap items.
2. Keep future roadmap language limited to unshipped controls such as hold, pause, cascade-aware removal, and running cancellation by queued PRD id.
3. Document lower numeric priority values as earlier dispatch within a dependency wave.
4. Document removal as runtime filesystem mutation under `.eforge/queue/`, with no git commit.
5. Document Console controls as pending/waiting row actions already added in the predecessor session; document CLI/MCP/Pi priority as pending/waiting-only and removal as allowed for non-running pending, waiting, failed, and skipped items.

## Scope

### In Scope

- Human docs for queue priority mutation.
- Human docs for queue item removal.
- Human docs for running-item refusal and session-id cancel guidance.
- Human docs for dependency-safety refusal.
- Human docs for failed recovery sidecar cleanup.
- Human docs for scheduler reconciliation after queue mutations.
- Human docs for CLI commands.
- Human docs for MCP/Pi tools.
- Human docs for Console actions.
- Generated API, CLI, tools, public-doc mirrors, and LLM reference artifacts.

### Out of Scope

- Additional host behavior beyond plan-02.
- Console implementation changes.
- Queue hold, pause, cascade controls, or running cancellation by queued PRD id.
- Pi package version changes.

## Files

### Create

- None expected.

### Modify

- `README.md` — update runtime queue-file overview and standalone CLI examples for priority/remove controls.
- `docs/architecture.md` — describe runtime priority mutation, non-running removal, failed-sidecar cleanup, dependency refusal, and scheduler reconciliation.
- `docs/config.md` — update queue behavior around `prdQueue.dir`, priority, waiting items, and queue commands.
- `docs/roadmap.md` — remove shipped runtime priority mutation from future work; keep future hold/pause/cascade controls.
- `web/content/docs/concepts.md` — update queue concept language and Console action description.
- `web/content/docs/configuration.md` — update priority and queue command sections.
- `web/content/docs/integrations.md` — mention CLI, MCP/Pi, and Console queue-control surfaces.
- `web/content/docs/glossary.md` — update queue and queue priority entries with runtime mutation and removal notes.
- `web/content/docs/troubleshooting.md` — add conflict cases for running items, moved/missing queue files, and live dependents.
- `packages/docs-gen/src/generators/cli.ts` — add `packages/eforge/src/cli/queue-control.ts` to generated CLI provenance if plan-02 creates that helper file.
- `web/content/reference/api.md` — generated route reference after `pnpm docs:generate`.
- `web/content/reference/cli.md` — generated CLI reference after `pnpm docs:generate`.
- `web/content/reference/tools.md` — generated MCP/Pi tools reference after `pnpm docs:generate`.
- `web/public/reference/api.md` — generated route reference mirror.
- `web/public/reference/cli.md` — generated CLI reference mirror.
- `web/public/reference/tools.md` — generated tools reference mirror.
- `web/public/docs/*.md` — generated public docs mirrors touched by docs generation.
- `web/public/llms.txt` and `web/public/llms-full.txt` — generated LLM bundles if docs generation changes them.
- `eforge-plugin/.claude-plugin/plugin.json` — only if this plan edits any `eforge-plugin/` file.

## Documentation Requirements

- State that `eforge queue priority <prdId> <priority>` mutates pending or waiting PRD frontmatter.
- State that lower numeric priority values run earlier within each dependency wave.
- State that failed and skipped PRDs reject priority changes with conflict until recovery/requeue makes them runnable.
- State that running PRDs reject priority and removal controls, and cancellation uses the existing session-id cancel route.
- State that `eforge queue remove <prdId>` deletes non-running pending, waiting, failed, or skipped queue files.
- State that failed removal deletes matching `.recovery.md` and `.recovery.json` sidecars.
- State that removal fails closed when live pending/waiting dependents exist, lists dependent ids, and requires removing dependents first until future cascade controls ship.
- State that the daemon notifies the scheduler after successful mutations and the scheduler re-reads queue files before dispatch.
- State that queue mutations are runtime filesystem operations under `.eforge/queue/`, are gitignored, and produce no git commits.
- State that Console Now exposes set-priority and confirmed remove actions for pending/waiting queue rows.
- State that CLI/MCP/Pi expose priority controls for pending/waiting items and removal controls for non-running pending, waiting, failed, and skipped items.
- State that host tool names are `eforge_queue_priority` and `eforge_queue_remove`.

## Generated References

- Run `pnpm docs:generate` after docs and source changes.
- Commit generated changes under `web/content/reference/*`, `web/public/reference/*`, `web/public/docs/*`, and LLM bundles.
- Confirm generated API reference includes `queuePriority` and `queueRemove`.
- Confirm generated CLI reference includes `eforge queue priority` and `eforge queue remove`.
- Confirm generated tools reference includes `eforge_queue_priority` and `eforge_queue_remove` in MCP and Pi sections.

## Verification

- [ ] `docs/roadmap.md` does not list runtime queued PRD priority mutation as future work.
- [ ] Human docs contain `eforge queue priority <prdId> <priority>` and `eforge queue remove <prdId>`.
- [ ] Human docs state lower numeric priority values run earlier.
- [ ] Human docs state running queue items require session-id cancellation through the existing cancel route.
- [ ] Human docs state failed and skipped priority mutation returns conflict.
- [ ] Human docs state failed queue removal deletes matching recovery sidecars.
- [ ] Human docs state live-dependent removals return conflict listing dependent ids.
- [ ] Human docs state Console exposes pending/waiting priority and removal row actions.
- [ ] Human docs state MCP/Pi expose `eforge_queue_priority` and `eforge_queue_remove`.
- [ ] Human docs state priority applies to pending/waiting items and removal applies to non-running pending, waiting, failed, and skipped items.
- [ ] Generated API reference includes `queuePriority` and `queueRemove` route keys.
- [ ] Generated CLI reference includes `eforge queue priority` and `eforge queue remove`.
- [ ] Generated tools reference includes `eforge_queue_priority` and `eforge_queue_remove` in both MCP and Pi sections.
- [ ] `pnpm docs:generate` exits 0 during implementation.
- [ ] `pnpm docs:check` exits 0 after generated artifacts are committed.