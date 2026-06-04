---
id: plan-01-playbook-inventory
name: Persist Playbook Acceptance Inventory
branch: fix-autonomous-playbook-enqueue-acceptance-inventory/plan-01-playbook-inventory
---

# Persist Playbook Acceptance Inventory

## Architecture Context

Autonomous playbook runs are served by `packages/monitor/src/routes/playbook-service.ts`. That route converts a playbook to normalized build source via `@eforge-build/input`, then writes directly to the PRD queue with `enqueuePrd(...)`. Normal `EforgeEngine.enqueue()` already passes an `acceptanceCriteriaInventory` to `enqueuePrd(...)`, which makes `packages/engine/src/prd-queue.ts` append the hidden canonical inventory block. Queue execution in `EforgeEngine.buildSinglePrd()` must keep requiring that block through `requireAcceptanceCriteriaInventoryFromPrd(...)`.

The fix must add inventory persistence to the playbook route without weakening queue validation, without changing the `POST /api/playbook/run` response union, and without moving route constants or wire shapes out of `@eforge-build/client`.

## Implementation

### Overview

Add a small engine-owned helper for already-normalized PRD/playbook bodies that derives a `CanonicalAcceptanceCriteriaInventory` from visible Markdown acceptance criteria using existing engine validation primitives. Call that helper in the autonomous playbook route and pass the result to `enqueuePrd(...)` through the existing `acceptanceCriteriaInventory` option. Extend playbook API tests so a valid autonomous playbook enqueue is parsed by `requireAcceptanceCriteriaInventoryFromPrd(...)` and contains exactly one hidden block.

### Key Decisions

1. Keep the queue executor fail-closed: do not change `requireAcceptanceCriteriaInventoryFromPrd(...)`, `buildSinglePrd()`, or the missing-block error path.
2. Keep `enqueuePrd(...)` as the only writer that appends the hidden block. The playbook route passes `acceptanceCriteriaInventory`; it does not pre-append Markdown to the body.
3. Put inventory derivation in `packages/engine/src/validation/acceptance-criteria-inventory.ts` so monitor route code does not duplicate canonical inventory schema, IDs, confidence rules, or validation formatting.
4. Keep the playbook route filesystem-only. Do not delegate to full `EforgeEngine.enqueue()` from the route because that would change response timing, dependency-detection behavior, and agent-runtime requirements for the existing HTTP endpoint.
5. Preserve current no-AC route response semantics by allowing the helper to serialize an empty inventory block when no acceptance criteria section exists; queue dispatch still applies `build.validation.allowNoAcceptanceCriteria` and fails with the existing empty-inventory diagnostic when the waiver is absent. Valid playbooks with acceptance criteria get a non-empty inventory and pass the missing-block gate.

## Scope

### In Scope

- Derive and pass a canonical acceptance criteria inventory for autonomous playbook queue writes.
- Preserve the deterministic playbook acceptance-criteria quality gate and its 400 response before any queue write.
- Preserve profile lookup, landing action, landing auto-merge, dependency classification, waiting-directory routing, and `postMerge` frontmatter propagation.
- Add targeted Vitest coverage for the persisted hidden block and `requireAcceptanceCriteriaInventoryFromPrd(...)` success on a playbook-created queued PRD.
- Keep planning-mode playbooks returning `{ kind: "requires-agent" }` with zero queue writes.

### Out of Scope

- Weakening queue-time acceptance inventory validation.
- Changing `POST /api/playbook/run` request or response types.
- Bumping `DAEMON_API_VERSION`; no daemon wire contract changes are required.
- Changing Claude Code plugin or Pi extension behavior.
- Reworking normal `EforgeEngine.enqueue()` formatting, dependency detection, or agent extraction.

## Files

### Create

None.

### Modify

- `packages/engine/src/validation/acceptance-criteria-inventory.ts` — export a helper such as `deriveAcceptanceCriteriaInventoryFromPrdBody(body, options)` that:
  - imports and uses `extractExpectedAcceptanceCriteria(...)` from `./acceptance-criteria.js`;
  - strips any existing hidden inventory block before extraction;
  - maps each extracted criterion to `CanonicalAcceptanceCriterion` with positional `ac-###` IDs, normalized `text`, original `raw`, `sourceQuote` grounded in the visible body, and confidence `1`;
  - validates the assembled object with `validateCanonicalAcceptanceCriteriaInventory(...)` using `requireIds: true` and an option that permits empty inventories for serialization;
  - throws a formatted validation error when the assembled object fails validation.
- `packages/monitor/src/routes/playbook-service.ts` — after `playbookToBuildSource(...)` and the existing deterministic AC quality check, derive the inventory and pass it as `acceptanceCriteriaInventory` in the existing `enqueuePrd(...)` call. If inventory derivation fails, return HTTP 400 and write no queue file. Keep the existing order that rejects invalid AC before profile and dependency checks.
- `test/playbook-helpers.ts` — extend `validPlaybookRaw(...)` with an optional `acceptanceCriteria` input so API tests can create autonomous playbooks with explicit valid criteria while leaving existing no-AC fixture calls unchanged.
- `test/playbook-api-run-profile.test.ts` — import `requireAcceptanceCriteriaInventoryFromPrd(...)` and add assertions to an autonomous enqueue test, or add a focused test in the existing playbook run suite, that verifies one hidden block, successful inventory parsing, stable `ac-001` ID, and unchanged queue/frontmatter behavior.

## Database Migration

Not applicable.

## Verification

- [ ] `POST /api/playbook/run` for an autonomous playbook with a valid `## Acceptance Criteria` section returns `{ kind: "enqueued", id }` and writes one queued PRD markdown file.
- [ ] The queued PRD contains one `<!-- eforge:acceptance-criteria-inventory` marker and one `eforge:end-acceptance-criteria-inventory -->` marker.
- [ ] `requireAcceptanceCriteriaInventoryFromPrd(queuedContent)` returns an inventory containing `ac-001` for the test criterion and does not throw.
- [ ] The autonomous playbook route still persists `profile`, `landing`, `landing_auto_merge`, `depends_on`, `postMerge`, and waiting-directory placement in existing route tests.
- [ ] An autonomous playbook with invalid acceptance criteria returns HTTP 400 and `.eforge/queue` plus `.eforge/queue/waiting` contain zero `.md` files.
- [ ] Planning-mode playbook tests return `kind: "requires-agent"` and `.eforge/queue` plus `.eforge/queue/waiting` contain zero `.md` files.
- [ ] `pnpm exec vitest run test/playbook-api-run-profile.test.ts test/playbook-api-run-landing-auto-merge.test.ts` exits 0.
