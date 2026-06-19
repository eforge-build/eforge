---
id: plan-06-docs-validation
name: Console/client documentation updates and final validation alignment for
  the new recovery and queue-control UX.
branch: improve-recovery-failed-enqueue-and-queue-control-ux/docs-validation
---

# Docs Validation

## Architecture Reference

This module implements the architecture sections **Documentation in `packages/console-ui/README.md`, client README/API docs, and any CLI/MCP/skill docs for exposed controls**, **Console-only exposure unless deliberately expanded**, and the final validation portion of **Projection parity**.

Key constraints from architecture:
- Documentation consumes the final client-owned route constants, helper names, event/snapshot fields, and Console behavior from dependency modules; it does not define new wire contracts.
- The new queue hold, scheduler pause, failed-enqueue, cascade, and recovery-guidance UX is exposed in Console and daemon/client APIs only. Do not add CLI/MCP/Pi/Claude command documentation unless an implementation module intentionally exposes those commands.
- Generated public reference artifacts are produced by `pnpm docs:generate`; do not hand-edit generated reference or public mirror files.
- Public docs must not claim cascade removal is future work after the cascade preview/apply routes exist.
- Public docs must distinguish disabling auto-build from pausing the scheduler.
- `packages/console-ui/README.md` is the shared-file registry entry owned by this module.

## Scope

### In Scope
- Update Console README data-flow documentation for durable failed-enqueue attention, re-enqueue, held queue rows, capability-driven disabled controls, scheduler pause/resume, cascade preview/apply, and recovery-guidance preparation.
- Update `@eforge-build/client` README to mention the new route/helper modules, snapshot fields, daemon events, and API-versioned first-party route surface.
- Update user-facing queue/recovery/Console docs in `README.md`, `docs/architecture.md`, and `web/content/docs/*` so they describe the shipped recovery-guidance, failed-enqueue, scheduler pause, hold/unhold, capability, and cascade behavior.
- Regenerate checked-in reference docs and public mirrors after client contract changes land.
- Add focused docs contract tests that guard against stale queue/recovery wording and missing generated route/event reference rows.
- Run final docs drift/link validation in addition to repository type/test/maintainability checks.

### Out of Scope
- Client route constants, request/response types, browser/node helpers, event schemas, and API versioning.
- Engine recovery-guidance patching, queue hold/cascade/cancel helpers, scheduler gating, or git commits.
- Monitor route handlers, projection parity implementation, recorder updates, validation/security, or worker cancellation.
- Console selectors, hooks, components, dialogs, refresh behavior, and tests.
- CLI/MCP/Pi/Claude command exposure for the new controls.
- Plugin or Pi package version bumps.

## Implementation Approach

### Overview

Treat this module as the final documentation and validation pass after `console-ux` and its dependencies have merged. First inspect the final exported helper/type names from `@eforge-build/client` and the final Console behavior from `packages/console-ui`. Then update hand-authored docs, regenerate reference artifacts with the docs generator, and add a focused docs contract test.

The implementation has five parts:

1. **Contract inventory** — verify the final route keys, helper exports, snapshot fields, event names, and Console labels introduced by dependency modules.
2. **Hand-authored docs** — update README, architecture, Console README, client README, and public guide sources with the final recovery/queue-control UX.
3. **Generated docs** — run `pnpm docs:generate` so public raw mirrors, API/event references, schemas, and LLM bundles reflect client contract and guide changes.
4. **Docs contract tests** — add tests that assert public/docs wording contains the new shipped behavior and omits stale future-cascade claims.
5. **Validation alignment** — run `pnpm docs:check`, `pnpm type-check`, `pnpm test`, and `pnpm maintainability:check` from the repo root.

### Contract Inventory

Before editing docs, read the final dependency outputs and use their exact exported names. The docs/tests must cover at least these client-owned route keys when present:

- `recoveryGuidancePrepare`
- `queueHold`
- `queueUnhold`
- `queueCascadePreview`
- `queueCascadeApply`
- `failedEnqueues`
- `failedEnqueueReenqueue`
- `schedulerPause`
- `schedulerResume`

Document these client/browser helper concepts using final names from `@eforge-build/client` / `@eforge-build/client/browser`:

- recovery guidance preparation
- queue hold/unhold
- queue cascade preview/apply
- failed-enqueue list/re-enqueue
- scheduler pause/resume

Document these data fields and events using final client-owned names:

- `QueueItem.hold`
- `QueueItem.capabilities`
- `DaemonStreamSnapshot.failedEnqueues`
- `daemon:failed-enqueue:upsert`
- `daemon:failed-enqueue:resolved`
- `FailedEnqueueInfo`
- `RecoveryGuidancePrepareResponse`

### Hand-Authored Documentation Updates

Update docs with these concrete content changes:

- **Recovery guidance** — failed root plan artifacts receive one canonical `## Recovery Guidance` section before compiled-artifact continue/resume; read-only recovery analysis remains mutation-free; guidance changes are tracked plan-artifact commits through engine git discipline.
- **Failed enqueue** — failed enqueue runs produce durable Console Needs attention rows keyed by run id with source label, reason, timestamp, disabled fallback/next command, and confirmed one-click re-enqueue when source data exists.
- **Queue hold/unhold** — pending and waiting queue items can be held/unheld from Console; held items keep order and are skipped by scheduler dispatch.
- **Capabilities** — Console renders queue action availability and disabled reasons from daemon-authored `QueueItem.capabilities` rather than inferring scheduler rules locally.
- **Scheduler pause/resume** — scheduler pause leaves desired auto-build enabled but prevents new launches; already-running builds continue until explicitly cancelled; resume restarts discovery.
- **Cascade remove/cancel** — destructive queue remove/cancel flows are preview-first; target-only apply fails closed when dependents exist; dependent mutation requires explicit cascade strategy and confirmation; running PRD cancel requires daemon ownership evidence.
- **Console-only exposure** — new rich controls are documented under Console and daemon/client APIs. CLI/MCP/Pi/Claude docs continue to mention existing priority/remove/recovery/auto-build controls only unless implementation adds host commands.

### Generated Documentation Updates

After hand-authored updates and client-contract changes are present, run:

```bash
pnpm docs:generate
```

This regenerates:

- `web/content/reference/api.md`
- `web/public/reference/api.md`
- `web/content/reference/events.md`
- `web/public/reference/events.md`
- `web/public/schemas/events.schema.json`
- `web/public/docs/*.md` raw mirrors for changed guide pages
- `web/public/llms.txt`
- `web/public/llms-full.txt`

If the generator changes additional checked-in artifacts, keep those generated diffs when they are deterministic outputs of the final client/docs source.

### Key Decisions

1. **Document source docs first, generated artifacts second.** Public mirrors and reference pages stay byte-identical to generator output, which keeps `pnpm docs:check` meaningful.
2. **Add a focused docs test file.** A new test avoids growing the existing broad reference-content test while giving this expedition its own drift guard.
3. **Preserve host-command boundaries.** Docs describe new Console/API controls without implying new CLI/MCP/Pi/Claude commands.
4. **Use negative stale-phrase assertions.** Tests catch regressions such as `there is no cascade remove action` and `future cascade-aware removal controls ship` after cascade routes ship.
5. **Validate docs drift explicitly.** This module adds `pnpm docs:check` to final verification even though the repository-wide acceptance list already includes type, test, and maintainability checks.

## Files

### Create
- `test/recovery-queue-control-docs.test.ts` — docs contract tests for recovery guidance, failed enqueue, scheduler pause, queue hold/capability/cascade wording, generated API/event references, and stale-future-cascade phrase removal.

### Modify
- `README.md` — update root queue/runtime artifact and Console descriptions to mention held queue items, scheduler pause, preview-first cascade controls, durable failed-enqueue attention, and recovery-guidance sections while keeping CLI examples limited to commands that exist.
- `docs/architecture.md` — update Queue and Daemon recovery/control sections to document hold frontmatter, capability projections, scheduler pause semantics, cascade preview/apply, failed-enqueue projection/re-enqueue, and recovery-guidance patching.
- `packages/client/README.md` — add the new route/helper modules and snapshot/event fields to the zero-dependency client overview.
- `packages/console-ui/README.md` — update Now dashboard data flow, Queue card behavior, Needs attention behavior, and header auto-build/scheduler control descriptions `[region: docs-validation, Console recovery/failed-enqueue/queue-control data-flow documentation]`.
- `web/content/docs/concepts.md` — update The Queue and Daemon section with shipped hold, capabilities, scheduler pause, failed-enqueue, and cascade semantics.
- `web/content/docs/integrations.md` — update Console dashboard and daemon API sections with new Console controls and client API route/helper guidance; keep host tool sections limited to exposed host tools.
- `web/content/docs/troubleshooting.md` — update auto-build paused/disabled guidance, queue-control conflict guidance, failed-enqueue recovery guidance, and failed-build recovery guidance.
- `web/content/docs/glossary.md` — add or revise entries for Auto-build, Console dashboard, Failed enqueue, Queue, Queue hold, Recovery guidance, and Scheduler pause.
- `web/content/reference/api.md` — generated by `pnpm docs:generate`; must include new route keys.
- `web/public/reference/api.md` — generated mirror of API reference.
- `web/content/reference/events.md` — generated by `pnpm docs:generate`; must include failed-enqueue daemon event rows and snapshot field references.
- `web/public/reference/events.md` — generated mirror of events reference.
- `web/public/schemas/events.schema.json` — generated event/snapshot schema with queue capabilities/hold and failed enqueue fields.
- `web/public/docs/concepts.md` — generated raw mirror of `web/content/docs/concepts.md`.
- `web/public/docs/integrations.md` — generated raw mirror of `web/content/docs/integrations.md`.
- `web/public/docs/troubleshooting.md` — generated raw mirror of `web/content/docs/troubleshooting.md`.
- `web/public/docs/glossary.md` — generated raw mirror of `web/content/docs/glossary.md`.
- `web/public/llms.txt` — generated LLM manifest reflecting guide/reference updates.
- `web/public/llms-full.txt` — generated full LLM bundle reflecting guide/reference updates.

## Testing Strategy

### Unit Tests
- `test/recovery-queue-control-docs.test.ts` reads hand-authored docs and asserts:
  - `packages/console-ui/README.md` mentions failed-enqueue state, `Re-enqueue`, queue capabilities, held rows, scheduler pause/resume, and cascade preview/apply.
  - `packages/client/README.md` mentions failed enqueue helpers, scheduler pause/resume helpers, queue hold/cascade helpers, `failedEnqueues`, and queue item capabilities.
  - `README.md`, `docs/architecture.md`, `web/content/docs/concepts.md`, `web/content/docs/troubleshooting.md`, and `web/content/docs/integrations.md` mention the shipped queue hold, scheduler pause, cascade preview/apply, and failed-enqueue behavior.
  - `web/content/docs/troubleshooting.md` mentions the canonical `## Recovery Guidance` section before continue-and-repair/resume.
  - checked docs do not contain stale phrases: `there is no cascade remove action`, `future cascade-aware removal controls ship`, `until future cascade`, or `future cascade controls ship`.
- The same test reads generated reference artifacts and asserts:
  - `web/content/reference/api.md` and `web/public/reference/api.md` contain the nine new route keys.
  - `web/content/reference/events.md` and `web/public/reference/events.md` contain `daemon:failed-enqueue:upsert` and `daemon:failed-enqueue:resolved`.
  - `web/public/schemas/events.schema.json` contains `failedEnqueues`, `capabilities`, and `hold`.

### Integration Tests
- `pnpm docs:check` verifies generated docs drift and internal links after docs regeneration.
- Existing `test/reference-content.test.ts` verifies `web/public/docs/*.md` mirrors match `web/content/docs/*.md`.
- Existing `test/docs-gen-determinism.test.ts` verifies generated reference artifacts are deterministic.
- Existing `test/docs-link-check.test.ts` verifies new internal links resolve.

## Verification

- [ ] `packages/console-ui/README.md` contains a failed-enqueue data-flow paragraph that names `FailedEnqueueInfo`, `failedEnqueues`, and `Re-enqueue`.
- [ ] `packages/console-ui/README.md` contains queue-control text that names held rows, daemon-authored capabilities, disabled reasons, scheduler pause/resume, and cascade preview/apply.
- [ ] `packages/client/README.md` lists the new failed-enqueue, recovery-guidance, queue hold/cascade, and scheduler pause/resume helper surfaces.
- [ ] `README.md` no longer contains `until future cascade controls ship`.
- [ ] `docs/architecture.md` no longer contains `future cascade-aware removal controls ship`.
- [ ] `web/content/docs/concepts.md` no longer contains `there is no cascade remove action`.
- [ ] `web/content/docs/troubleshooting.md` no longer contains `there is no cascade remove action`.
- [ ] `web/content/docs/troubleshooting.md` contains `## Recovery Guidance` in the failed-build recovery section.
- [ ] `web/content/docs/integrations.md` lists Console queue controls for hold/unhold, scheduler pause/resume, failed enqueue re-enqueue, and cascade preview/apply.
- [ ] `web/content/docs/glossary.md` contains entries or paragraphs for failed enqueue, queue hold, recovery guidance, and scheduler pause.
- [ ] `web/content/reference/api.md` contains `recoveryGuidancePrepare`, `queueHold`, `queueUnhold`, `queueCascadePreview`, `queueCascadeApply`, `failedEnqueues`, `failedEnqueueReenqueue`, `schedulerPause`, and `schedulerResume`.
- [ ] `web/public/reference/api.md` contains the same nine route keys.
- [ ] `web/content/reference/events.md` contains `daemon:failed-enqueue:upsert` and `daemon:failed-enqueue:resolved`.
- [ ] `web/public/schemas/events.schema.json` contains `failedEnqueues`, `capabilities`, and `hold`.
- [ ] `web/public/docs/concepts.md` is byte-identical to `web/content/docs/concepts.md`.
- [ ] `web/public/docs/integrations.md` is byte-identical to `web/content/docs/integrations.md`.
- [ ] `web/public/docs/troubleshooting.md` is byte-identical to `web/content/docs/troubleshooting.md`.
- [ ] `web/public/docs/glossary.md` is byte-identical to `web/content/docs/glossary.md`.
- [ ] `test/recovery-queue-control-docs.test.ts` passes.
- [ ] `pnpm docs:generate` exits 0 and leaves deterministic generated artifacts.
- [ ] `pnpm docs:check` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `pnpm maintainability:check` exits 0.

<build-config>
{
  "build": ["test-write", ["implement", "doc-author"], "doc-sync", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["docs", "test"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
