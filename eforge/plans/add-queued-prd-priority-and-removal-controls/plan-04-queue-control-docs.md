---
id: plan-04-queue-control-docs
name: Queue Control Documentation and Generated References
branch: add-queued-prd-priority-and-removal-controls/plan-04-queue-control-docs
---

# Queue Control Documentation and Generated References

## Architecture Context

After the daemon/client contract, host integrations, and Console controls land, public and generated documentation must describe the shipped queue-control surface. Generated reference files derive from route constants, Commander commands, MCP/Pi tool registrations, and public content. This plan runs after the code plans so the generated artifacts reflect final source.

## Implementation

### Overview

Update human-authored docs for runtime priority mutation, non-running removal, dependency-safety refusal, failed sidecar cleanup, scheduler reconciliation, and the CLI/MCP/Pi/Console controls. Regenerate reference artifacts with `pnpm docs:generate` and update roadmap language so future-only items remain.

### Key Decisions

1. Keep follow-up roadmap items for hold/pause/cascade controls, but remove or narrow the shipped priority-control line.
2. Document that lower numeric priority values run earlier, both at enqueue time and after runtime mutation.
3. Document that failed and skipped priority mutation returns a conflict; recovery/requeue is the path for terminal items to become runnable again.
4. Document that removal is filesystem-only, gitignored runtime state, and produces no git commit.
5. Document that Console exposes only pending/waiting forward-queue controls in this first slice; terminal failed/skipped removal is available through CLI/MCP/Pi.

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
- Generated API, CLI, tools, and LLMS reference artifacts.

### Out of Scope

- New skill workflows unless implementation changed skill files earlier.
- Hold, pause, cascade, or per-item capability metadata docs beyond future-roadmap notes.
- Event reference changes; this feature adds no event variant.

## Files

### Create

- None expected.

### Modify

- `README.md` — update runtime queue-file overview and examples for priority/remove controls.
- `docs/architecture.md` — describe runtime priority mutation, non-running removal, failed-sidecar cleanup, dependency refusal, and scheduler reconciliation.
- `docs/config.md` — update queue behavior around `prdQueue.dir`, `priority`, waiting items, and queue commands.
- `docs/roadmap.md` — remove or narrow the shipped daemon/MCP priority-control item; leave future hold/pause/cascade controls.
- `web/content/docs/concepts.md` — update queue concept language and Console forward-queue description.
- `web/content/docs/configuration.md` — update priority and queue command sections.
- `web/content/docs/integrations.md` — mention CLI, MCP/Pi, and Console queue-control surfaces.
- `web/content/docs/glossary.md` — update queue and queue priority entries with runtime mutation and removal notes.
- `web/content/docs/troubleshooting.md` — add conflict cases for running items and live dependents.
- `web/content/reference/api.md` — generated route reference after `pnpm docs:generate`.
- `web/content/reference/cli.md` — generated CLI reference after `pnpm docs:generate`.
- `web/content/reference/tools.md` — generated MCP/Pi tool reference after `pnpm docs:generate`.
- `web/public/reference/api.md` — generated route reference.
- `web/public/reference/cli.md` — generated CLI reference.
- `web/public/reference/tools.md` — generated tool reference.
- `web/public/docs/*.md` — generated public docs mirrors touched by docs generation.
- `web/public/llms.txt` and `web/public/llms-full.txt` — generated LLM reference bundles if docs generation changes them.
- `eforge-plugin/.claude-plugin/plugin.json` — only if a plugin skill or plugin wrapper file changed in this plan or earlier queue-control work.

## Documentation Requirements

- State that `eforge queue priority <prdId> <priority>` mutates pending or waiting PRD frontmatter and lower numbers dispatch earlier.
- State that terminal failed/skipped PRDs reject priority changes with HTTP 409 until recovery/requeue makes them runnable again.
- State that running PRDs reject priority and removal controls, and cancellation uses the existing session-id cancel route.
- State that `eforge queue remove <prdId>` deletes non-running pending, waiting, failed, or skipped queue files.
- State that failed removal deletes matching `.recovery.md` and `.recovery.json` sidecars.
- State that removal fails closed when live pending/waiting dependents exist, lists dependent ids, and requires removing dependents first until future cascade controls ship.
- State that the daemon notifies the scheduler after successful mutations and the scheduler re-reads queue files before dispatching.
- State that queue mutations are runtime filesystem operations under `.eforge/queue/`, are gitignored, and produce no git commits.
- State that Console Now exposes set-priority and confirmed remove actions for pending/waiting forward queue rows only.
- State that CLI/MCP/Pi expose priority and remove controls for the full allowed non-running status set.

## Verification

- [ ] `docs/roadmap.md` no longer lists runtime queued PRD priority mutation as unshipped work.
- [ ] Human docs contain the exact CLI command strings `eforge queue priority <prdId> <priority>` and `eforge queue remove <prdId>`.
- [ ] Human docs state lower numeric priority values run earlier.
- [ ] Human docs state running queue items require session-id cancellation through the existing cancel route.
- [ ] Human docs state failed/skipped priority mutation returns a conflict.
- [ ] Human docs state failed queue removal deletes matching recovery sidecars.
- [ ] Human docs state live dependent removals return a conflict listing dependent ids.
- [ ] Generated API reference includes `queuePriority` and `queueRemove` route keys.
- [ ] Generated CLI reference includes `eforge queue priority` and `eforge queue remove`.
- [ ] Generated tools reference includes `eforge_queue_priority` and `eforge_queue_remove` in both MCP and Pi sections.
- [ ] `pnpm docs:generate` exits 0 after source changes.
- [ ] `pnpm docs:check` exits 0 after generated artifacts are committed.
