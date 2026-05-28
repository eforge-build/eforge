---
id: plan-02-playbook-placement-parity
name: Playbook Dependency Placement Parity
branch: add-first-class-dependency-handoff-for-builds/plan-02-playbook-placement-parity
agents:
  builder:
    effort: medium
    rationale: Uses the helper from plan 01 to fix one route path and expand route tests.
  tester:
    effort: high
    rationale: Completed-artifact vs active-upstream playbook placement needs
      file-location assertions.
---

# Playbook Dependency Placement Parity

## Architecture Context

Autonomous playbooks already expose `afterQueueId`, but the daemon route writes every dependent into `waiting/`. That strands dependents when the upstream already completed with a usable artifact because no future completion event will unblock them. Plan 01 provides the shared placement helper; this plan moves playbooks onto it.

## Implementation

### Overview

Update `POST /api/playbook/run` for autonomous playbooks so it validates and classifies `afterQueueId` via the shared helper. Active upstreams still write to `.eforge/queue/waiting/`; completed upstreams with usable durable artifacts write to the queue root with `depends_on` preserved; invalid upstreams fail before queue mutation.

### Key Decisions

1. Reuse the plan 01 helper instead of retaining a playbook-only validator.
2. Keep planning-mode playbooks unchanged: they return `requires-agent` even when `afterQueueId` is present because no PRD is enqueued on that path.
3. Preserve AC quality gate order: invalid autonomous playbook acceptance criteria still return 400 before dependency validation.

## Scope

### In Scope

- Update the autonomous playbook route in `packages/monitor/src/server.ts` to call the shared placement helper and pass its `dependsOn` and `intoWaiting` values into `enqueuePrd()`.
- Preserve existing `afterQueueId` validation failure status and message expectations where tests already assert them.
- Add playbook route tests for active upstream, completed-artifact upstream, unknown upstream, failed upstream, skipped upstream, and completed-without-artifact upstream.
- Add assertions that completed-artifact dependents are written to the queue root and active dependents are written to `waiting/`.

### Out of Scope

- Pi or Claude playbook UX changes.
- Normal `/api/enqueue` behavior; plan 01 owns that path.
- Scheduler or stack provider changes.

## Files

### Create

- None expected.

### Modify

- `packages/monitor/src/server.ts` — replace the playbook route's validator-only logic plus unconditional `intoWaiting: true` with shared placement helper output.
- `test/playbook-api.test.ts` — expand autonomous playbook `afterQueueId` coverage for active, completed-artifact, failed, skipped, unknown, and completed-without-artifact upstreams.
- `test/queue-piggyback.test.ts` — adjust helper tests if plan 01 placed any playbook-specific edge case there.

## Verification

- [ ] Autonomous playbook run with active upstream writes the dependent PRD under `.eforge/queue/waiting/`.
- [ ] Autonomous playbook run with completed upstream plus usable artifact writes the dependent PRD under `.eforge/queue/` root.
- [ ] Both active and completed-artifact playbook dependents contain `depends_on: ["<afterQueueId>"]` in frontmatter.
- [ ] Failed, skipped, unknown, and completed-without-artifact playbook upstreams return an error before queue mutation.
- [ ] Planning-mode playbook run with `afterQueueId` still returns `{ kind: "requires-agent" }` and writes no queue file.
- [ ] Existing AC-quality tests still return AC errors before dependency errors.
