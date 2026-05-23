---
id: plan-01-playbook-onsuccess-api
name: Playbook Run onSuccess API Propagation
branch: add-shared-landing-gate-ux-for-autonomous-playbook-runs/plan-01-playbook-onsuccess-api
---

# Playbook Run onSuccess API Propagation

## Architecture Context

`@eforge-build/client` owns daemon route contracts and typed helpers. The daemon `/api/playbook/run` route currently enqueues autonomous playbooks directly via `enqueuePrd(...)`, but the request body has no `onSuccess` field and the route does not persist an action into queued PRD frontmatter. This plan adds the optional wire field and keeps daemon behavior headless: it validates and persists the provided action, with no prompts.

## Implementation

### Overview

Add optional `onSuccess` support to `PlaybookRunRequest`, client playbook helpers, the daemon playbook-run handler, and both Pi/Claude MCP tool schemas. For autonomous playbooks, a valid `onSuccess` value is passed to `enqueuePrd(...)`, which already writes the field to PRD frontmatter. Planning-mode playbooks still return `requires-agent` and do not enqueue.

### Key Decisions

1. Reuse the existing `BuildOnSuccess` union (`merge-to-base-branch | issue-pr | leave-branch`) for playbook-run requests so enqueue and playbook-run contracts cannot drift.
2. Validate `onSuccess` inside the daemon route before enqueueing, returning HTTP 400 for non-string or unsupported values.
3. Keep daemon and MCP proxy behavior non-interactive; callers must provide `onSuccess` or accept no persisted override.
4. Bump `DAEMON_API_VERSION` and update its version test because older daemons would silently ignore the new playbook-run field.

## Scope

### In Scope

- Optional `onSuccess` in playbook-run client request types and helpers.
- Daemon `/api/playbook/run` validation and `enqueuePrd(...)` propagation for autonomous playbooks.
- Pi extension `eforge_playbook` tool schema/body support.
- Claude MCP proxy `eforge_playbook` tool schema/body support.
- Route tests proving `onSuccess` frontmatter persistence and invalid-value rejection.

### Out of Scope

- Interactive landing prompts.
- Engine landing semantics.
- CLI interactive prompts.
- Planning-mode playbook execution changes.

## Files

### Create

- None.

### Modify

- `packages/client/src/routes.ts` — add `onSuccess?: BuildOnSuccess` to `PlaybookRunRequest`.
- `packages/client/src/api/playbook.ts` — type `apiPlaybookRun` and `apiPlaybookRunIfRunning` request bodies as `PlaybookRunRequest` so consumers can pass `onSuccess`.
- `packages/client/src/api-version.ts` — bump `DAEMON_API_VERSION` and prepend a changelog note for playbook-run `onSuccess`.
- `packages/monitor/src/server.ts` — parse, validate, and pass `body.onSuccess` into `enqueuePrd(...)` for autonomous playbooks; leave planning-mode responses unchanged.
- `packages/pi-eforge/extensions/eforge/index.ts` — add `onSuccess` to the `eforge_playbook` tool parameter schema and include it in the POST body for `action: "run"`.
- `packages/eforge/src/cli/mcp-proxy.ts` — add matching `onSuccess` schema and POST body handling for the Claude MCP `eforge_playbook` tool.
- `test/playbook-api.test.ts` — add tests that valid `onSuccess` values persist to queued PRD frontmatter and invalid values return 400 without a queue file.
- `test/daemon-recovery.test.ts` — update the API version assertion/comment.

## Verification

- [ ] `POST /api/playbook/run` with `{ name, onSuccess: "leave-branch" }` for an autonomous playbook returns `{ kind: "enqueued", id }` and the queued PRD contains `onSuccess: leave-branch`.
- [ ] `POST /api/playbook/run` with `{ name, onSuccess: "deploy" }` returns HTTP 400 and no PRD appears in `.eforge/queue` or `.eforge/queue/waiting`.
- [ ] `POST /api/playbook/run` for a planning-mode playbook with any valid `onSuccess` returns `requires-agent` and creates no PRD.
- [ ] The Pi and Claude MCP `eforge_playbook` schemas accept `onSuccess` for `action: "run"` and forward it to `API_ROUTES.playbookRun`.
- [ ] `pnpm type-check` completes with zero TypeScript errors.
- [ ] `pnpm test -- playbook-api daemon-recovery` completes with zero failing tests.
