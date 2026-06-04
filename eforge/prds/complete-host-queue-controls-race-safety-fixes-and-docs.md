---
title: Complete Host Queue Controls, Race-Safety Fixes, and Docs
created: 2026-06-04
recovery_from: add-queued-prd-priority-and-removal-controls
recovery_set_name: add-queued-prd-priority-and-removal-controls
recovery_feature_branch: eforge/add-queued-prd-priority-and-removal-controls
recovery_base_branch: main
---

<![CDATA[
# Complete Host Queue Controls, Race-Safety Fixes, and Docs

## Overview

Continue the partially completed “Add Queued PRD Priority and Removal Controls” work on branch `eforge/add-queued-prd-priority-and-removal-controls`.

The previous build session already merged:
- `plan-01-core-queue-control`: core client-owned route/API surface, daemon routes, engine queue-control helpers, and scheduler reconciliation.
- `plan-03-console-queue-controls`: Console Now queue priority and removal actions.

This successor PRD covers the remaining work:
- `plan-02-host-queue-controls`: finish CLI, Claude/MCP, and Pi host queue controls.
- Resolve the reviewer-confirmed queue-control race-safety blockers discovered while building `plan-02-host-queue-controls`.
- `plan-04-queue-control-docs`: update human and generated docs/reference artifacts.

Do not redo the already-merged Console implementation except where tests or type updates require narrow adjustments.

## Non-Negotiable Guardrails

- Preserve the semantic `@eforge-build/client` queue priority helper API: host callers pass a PRD id and priority value through shared helpers; do not change CLI, MCP, Pi, or tests to construct raw `{ body: { priority } }` daemon request shapes.
- Fix the queue-control race-safety blockers before host integration or documentation polish.
- Add regression tests proving priority updates cannot recreate PRD files that were moved, deleted, completed, or claimed after initial location.
- Add regression tests proving removal cannot report success after the target PRD file moved or disappeared.
- Keep the successor narrowly scoped to host queue controls, queue-control race-safety fixes, and docs/reference updates; do not reimplement completed Console/core work.
- Sync or rebase the feature branch with current `main` early, because `eforge/add-queued-prd-priority-and-removal-controls` has diverged from current main.

## Starting Point

The feature branch already contains:
- Core route constants, request/response types, client helpers, browser helpers, daemon route handlers, engine queue helpers, and scheduler reconciliation.
- Console queue row actions for pending/waiting priority updates and removal.
- Tests for core queue behavior, browser helpers, daemon routes, scheduler reconciliation, and Console behavior.

Known review outcomes from the failed `plan-02-host-queue-controls` attempt:
- Reviewer suggestions to change `apiUpdateQueuePriority` and `apiUpdateQueuePriorityIfRunning` to accept `{ body: { priority } }` were rejected as false positives.
- Preserve the current semantic client helper style where host consumers pass a priority value through the shared client abstraction rather than constructing daemon body shapes directly.
- Reviewer-confirmed blockers remain in `packages/engine/src/queue/control.ts`:
  - Root priority/remove mutations must not rely on stale located PRD data after acquiring a claim.
  - Priority updates must operate on the current existing file and fail if the file moved or disappeared.
  - Waiting or other movable item mutations must avoid `writeFile` recreation after disappearance.
  - Root removal must confirm the file still exists after claim or use non-force removal with correct not-found/conflict mapping.
- Maintainability region markers added during review were accepted; keep large-file region markers balanced.

## Scope

In scope:
- Finish `plan-02-host-queue-controls`.
- Add `eforge queue priority <prdId> <priority>`.
- Add `eforge queue remove <prdId>`.
- Add or update Claude/MCP tools for queue priority and queue removal.
- Add or update Pi tools/actions for queue priority and queue removal.
- Keep Claude/MCP and Pi behavior in sync where technically feasible.
- Use only typed helpers and route constants from `@eforge-build/client`.
- Preserve current public client helper shapes; do not push daemon request body construction into CLI/MCP/Pi consumers.
- Fix the reviewer-confirmed queue-control race-safety issues in `packages/engine/src/queue/control.ts`.
- Update docs and generated reference artifacts for CLI, tool, route, and queue behavior.
- Run targeted and required validation.

Out of scope:
- Reimplementing the already-merged Console queue controls from `plan-03-console-queue-controls`.
- Replacing the already-merged client/daemon route architecture from `plan-01-core-queue-control`.
- Changing public client helper signatures to require raw `{ body: QueuePriorityRequest }` at host call sites.
- Per-PRD hold/unhold.
- Global queue pause/resume.
- Cascade-aware deletion or cancellation.
- Cancelling a running worker by queued PRD id.
- Changing dependency relationships, stack parents, landing action, profile, or PRD body after enqueue.

## Requirements

### Queue-control race-safety remediation

- Root pending priority mutations must acquire exclusive ownership using the existing PRD lock/claim mechanism before writing.
- After acquiring a root claim, re-check that the originally located PRD file still exists and is still the current mutable root PRD.
- Root priority mutation must fail with a clear not-found or conflict result if the file disappeared, moved, or became non-mutable before write.
- Priority mutation must update the current existing file content rather than writing stale located content that could recreate a consumed or moved PRD.
- Waiting priority mutation must avoid recreating a disappeared file; it must re-read or update only an existing current file.
- Waiting priority mutation must fail with a clear not-found or conflict result if the file disappeared or moved before write.
- Root removal must not use forceful deletion in a way that reports success for a file that disappeared or moved before removal.
- Root removal must confirm file existence after claim or use non-force removal with not-found/conflict mapping.
- Movable item removal must fail if the original file disappeared rather than silently succeeding.
- Race-safety changes must preserve existing status semantics:
  - pending and waiting priority mutation allowed;
  - running, failed, and skipped priority mutation rejected;
  - non-running pending, waiting, failed, and skipped removal allowed;
  - live running removal rejected;
  - dependency-safety refusal preserved.
- Keep durable balanced `// --- eforge:region <slug> ---` / `// --- eforge:endregion <slug> ---` markers in large implementation files.

### CLI host controls

- `eforge queue priority <prdId> <priority>` calls the typed shared daemon helper from `@eforge-build/client`.
- `eforge queue priority <prdId> <priority>` accepts only finite integer priorities at the CLI boundary or passes validation errors cleanly from the daemon.
- `eforge queue priority <prdId> <priority>` prints a success message including the PRD id.
- `eforge queue priority <prdId> <priority>` prints a success message including the new priority.
- `eforge queue priority <prdId> <priority>` exits non-zero with the daemon error message on validation failure.
- `eforge queue priority <prdId> <priority>` exits non-zero with the daemon error message on not-found failure.
- `eforge queue priority <prdId> <priority>` exits non-zero with the daemon error message on conflict failure.
- `eforge queue priority <prdId> <priority>` exits non-zero with the daemon error message on daemon-unavailable failure.
- `eforge queue remove <prdId>` calls the typed shared daemon helper from `@eforge-build/client`.
- `eforge queue remove <prdId>` prints a success message including the PRD id.
- `eforge queue remove <prdId>` prints a success message including the removed status.
- `eforge queue remove <prdId>` exits non-zero with the daemon error message on not-found failure.
- `eforge queue remove <prdId>` exits non-zero with the daemon error message on conflict failure.
- `eforge queue remove <prdId>` exits non-zero with the daemon error message on daemon-unavailable failure.

### Claude/MCP host controls

- Claude/MCP host integrations expose a queue priority action backed by shared `@eforge-build/client` helpers and route constants.
- Claude/MCP host integrations expose a queue remove action backed by shared `@eforge-build/client` helpers and route constants.
- Claude/MCP queue priority actions return typed success payloads consistent with CLI behavior.
- Claude/MCP queue priority actions return typed error payloads consistent with CLI behavior.
- Claude/MCP queue remove actions return typed success payloads consistent with CLI behavior.
- Claude/MCP queue remove actions return typed error payloads consistent with CLI behavior.
- Do not inline `/api/...` route literals in MCP code.
- Do not construct raw daemon queue-priority request bodies in MCP call sites if the shared semantic helper already owns that contract.

### Pi host controls

- Pi host integrations expose a queue priority action backed by shared `@eforge-build/client` helpers and route constants.
- Pi host integrations expose a queue remove action backed by shared `@eforge-build/client` helpers and route constants.
- Pi queue priority actions return typed success payloads consistent with CLI behavior.
- Pi queue priority actions return typed error payloads consistent with CLI behavior.
- Pi queue remove actions return typed success payloads consistent with CLI behavior.
- Pi queue remove actions return typed error payloads consistent with CLI behavior.
- Keep Pi and Claude/MCP queue-control behavior in sync where technically feasible.
- Do not bump `packages/pi-eforge/package.json`.
- If files under `eforge-plugin/` are changed, bump only the Claude plugin version as required by repository policy.
- Do not inline `/api/...` route literals in Pi code.
- Do not construct raw daemon queue-priority request bodies in Pi call sites if the shared semantic helper already owns that contract.

### Documentation and references

- Queue-control docs describe priority ordering semantics.
- Queue-control docs describe allowed removal statuses.
- Queue-control docs describe running-item refusal.
- Queue-control docs describe dependency-safety refusal.
- Queue-control docs describe CLI commands.
- Queue-control docs describe host tool actions.
- Queue-control docs describe Console actions already added by `plan-03-console-queue-controls`.
- Update `docs/architecture.md` as needed to describe runtime priority mutation, non-running queue removal, failed-sidecar cleanup, dependency-safety refusal, and scheduler reconciliation.
- Update `docs/config.md` or other canonical queue behavior docs if they mention queue priority or queue commands.
- Update `README.md` if its runtime queue-file overview implies mutations are enqueue/recovery only.
- Update `docs/roadmap.md` so it remains future-focused, preserving only unshipped follow-up controls such as hold, pause, and cascade controls.
- Update public docs under `web/content/docs/` where queue priority, queue commands, integrations, glossary, troubleshooting, or Console controls are described.
- Regenerate or update generated reference docs under `web/content/reference/*` and `web/public/*` after CLI/tool/API surface changes.
- Run `pnpm docs:generate` as needed, then ensure `pnpm docs:check` passes.

## Acceptance Criteria

- [ ] `plan-02-host-queue-controls` is completed.
- [ ] `plan-04-queue-control-docs` is completed.
- [ ] Root queue priority mutation cannot recreate a PRD file that disappeared, moved, completed, or was claimed after initial location.
- [ ] Waiting queue priority mutation cannot recreate a PRD file that disappeared or moved after initial location.
- [ ] Root queue removal cannot report success when the PRD file disappeared or moved before deletion.
- [ ] Movable queue removal cannot report success when the PRD file disappeared before deletion.
- [ ] Race-safety fixes preserve existing pending/waiting/failed/skipped/running status semantics.
- [ ] Race-safety fixes preserve dependency-safety refusal semantics.
- [ ] `eforge queue priority <prdId> <priority>` calls the typed daemon helper.
- [ ] `eforge queue priority <prdId> <priority>` prints a success message that includes the PRD id on success.
- [ ] `eforge queue priority <prdId> <priority>` prints a success message that includes the new priority on success.
- [ ] `eforge queue priority <prdId> <priority>` exits non-zero with the daemon error message on validation failure.
- [ ] `eforge queue priority <prdId> <priority>` exits non-zero with the daemon error message on not-found failure.
- [ ] `eforge queue priority <prdId> <priority>` exits non-zero with the daemon error message on conflict failure.
- [ ] `eforge queue priority <prdId> <priority>` exits non-zero with the daemon error message on daemon-unavailable failure.
- [ ] `eforge queue remove <prdId>` calls the typed daemon helper.
- [ ] `eforge queue remove <prdId>` prints a success message that includes the PRD id on success.
- [ ] `eforge queue remove <prdId>` prints a success message that includes the removed status on success.
- [ ] `eforge queue remove <prdId>` exits non-zero with the daemon error message on not-found failure.
- [ ] `eforge queue remove <prdId>` exits non-zero with the daemon error message on conflict failure.
- [ ] `eforge queue remove <prdId>` exits non-zero with the daemon error message on daemon-unavailable failure.
- [ ] Claude/MCP host integrations expose a queue priority action backed by the same daemon route constants/shared client helpers.
- [ ] Claude/MCP host integrations expose a queue remove action backed by the same daemon route constants/shared client helpers.
- [ ] Pi host integrations expose a queue priority action backed by the same daemon route constants/shared client helpers.
- [ ] Pi host integrations expose a queue remove action backed by the same daemon route constants/shared client helpers.
- [ ] Claude/MCP queue priority actions return typed success payloads consistent with CLI behavior.
- [ ] Claude/MCP queue priority actions return typed error payloads consistent with CLI behavior.
- [ ] Claude/MCP queue remove actions return typed success payloads consistent with CLI behavior.
- [ ] Claude/MCP queue remove actions return typed error payloads consistent with CLI behavior.
- [ ] Pi queue priority actions return typed success payloads consistent with CLI behavior.
- [ ] Pi queue priority actions return typed error payloads consistent with CLI behavior.
- [ ] Pi queue remove actions return typed success payloads consistent with CLI behavior.
- [ ] Pi queue remove actions return typed error payloads consistent with CLI behavior.
- [ ] No inline `/api/...` queue-control literals are added outside the client route map.
- [ ] Public client helper shapes are not changed to require CLI/MCP/Pi callers to construct raw queue-priority request bodies.
- [ ] Queue-control docs describe priority ordering semantics.
- [ ] Queue-control docs describe allowed removal statuses.
- [ ] Queue-control docs describe running-item refusal.
- [ ] Queue-control docs describe dependency-safety refusal.
- [ ] Queue-control docs describe CLI commands.
- [ ] Queue-control docs describe host tool actions.
- [ ] Queue-control docs describe Console actions.
- [ ] CLI queue priority tests exit 0.
- [ ] CLI queue remove tests exit 0.
- [ ] MCP queue priority tests exit 0.
- [ ] MCP queue remove tests exit 0.
- [ ] Pi queue priority tests exit 0.
- [ ] Pi queue remove tests exit 0.
- [ ] Queue-control race-safety tests exit 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] `pnpm docs:check` exits 0 after generated API, CLI, and tool references are updated.

## Validation Notes

Run targeted tests for:
- Queue-control race safety.
- CLI queue priority and remove commands.
- Claude/MCP queue priority and remove tools.
- Pi queue priority and remove tools.
- Docs/reference drift.

Also run:
- `pnpm type-check`
- `pnpm maintainability:check`
- `pnpm docs:check`
]]>