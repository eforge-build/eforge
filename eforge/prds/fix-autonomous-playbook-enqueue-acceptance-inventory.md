---
title: Fix Autonomous Playbook Enqueue Acceptance Inventory
created: 2026-06-04
---

# Fix Autonomous Playbook Enqueue Acceptance Inventory

## Problem / Motivation

Source metadata:

- Created: `2026-06-04`
- Landing: `pr`
- `landing_auto_merge`: `true`

This fix aligns with the roadmap’s “honest gates” direction: queued builds should fail closed when acceptance evidence is structurally invalid, and input authoring surfaces should prepare valid normalized build sources before handing them to the engine.

The defect is in the autonomous playbook enqueue path, not in the queue executor’s missing-inventory gate.

Autonomous playbook runs can enqueue PRDs that fail immediately at queue dispatch because the queued file lacks the hidden canonical acceptance criteria inventory block required by current build execution. This affects users who run `mode: autonomous` playbooks through the daemon/Pi/Claude surfaces: the playbook run returns `{ kind: "enqueued" }`, auto-build picks it up, and the build fails before compile/planning/build work can begin.

Evidence reviewed:

- `docs/roadmap.md` calls for honest fail-closed validation and engine boundary discipline.
- `packages/monitor/src/routes/playbook-service.ts` owns `POST /api/playbook/run` behavior and directly enqueues autonomous playbook build sources.
- `packages/engine/src/eforge.ts` normal enqueue runs formatter plus acceptance criteria extraction before calling `enqueuePrd(...)`.
- `packages/engine/src/prd-queue.ts` only appends the hidden canonical inventory block when `acceptanceCriteriaInventory` is passed.
- `packages/engine/src/validation/acceptance-criteria-inventory.ts` enforces the required hidden inventory block for queued PRDs.
- `test/playbook-api-run-profile.test.ts` already has an autonomous playbook enqueue test that reads the queued PRD and can be extended to assert inventory persistence.
- Failed queue item: `generate-public-web-docs-and-audit-for-user-facing-gaps`.
- Monitor DB event at `2026-06-04T14:28:00.355Z` recorded `session:end` with summary `Acceptance criteria inventory issues (1): [missing-block] Queued PRD is missing the canonical acceptance criteria inventory; re-enqueue the PRD.`
- Failed PRD file `.eforge/queue/failed/generate-public-web-docs-and-audit-for-user-facing-gaps.md` contains playbook-derived frontmatter/body but no canonical acceptance criteria inventory hidden block.
- Backlog item: `.eforge/backlog/items/backlog-2026-06-04-fix-autonomous-playbook-enqueue-missing-canonical-acceptance.md`.

Expected behavior:

- Running an autonomous playbook enqueues a PRD that passes queue structural validation and proceeds into the normal build path.

Actual behavior:

- Running an autonomous playbook can enqueue a PRD that is structurally invalid for current queue execution.

## Goal

Autonomous playbook runs should enqueue PRDs that include the canonical acceptance criteria inventory required by queue execution. The fix must preserve the queue executor’s fail-closed missing-inventory validation and existing playbook route behavior.

## Approach

The confirmed root cause is that the autonomous playbook run path bypasses the normal enqueue preparation path that extracts and persists canonical acceptance criteria.

Root cause evidence:

- Normal `EforgeEngine.enqueue()` in `packages/engine/src/eforge.ts` runs `runAcceptanceCriteriaExtractor(...)`, stores `const acceptanceCriteriaInventory = extractorResult.value`, and passes `acceptanceCriteriaInventory` to `enqueuePrd(...)`.
- `enqueuePrd(...)` in `packages/engine/src/prd-queue.ts` appends the hidden inventory block only when `acceptanceCriteriaInventory` is provided.
- `runPlaybook()` in `packages/monitor/src/routes/playbook-service.ts` converts an autonomous playbook with `input.playbookToBuildSource(playbook)`, checks deterministic AC quality with `input.analyzeAcceptanceCriteriaInBody(plan.source)`, then calls `enqueuePrd(...)` without `acceptanceCriteriaInventory`.
- Queue execution in `buildSinglePrd()` calls `requireAcceptanceCriteriaInventoryFromPrd(prd.content, ...)` before staleness/compile/build for non-resume PRDs.
- `requireAcceptanceCriteriaInventoryFromPrd()` throws `[missing-block] Queued PRD is missing the canonical acceptance criteria inventory; re-enqueue the PRD.` when the block is absent.
- The deterministic playbook AC quality check is not a substitute for the canonical inventory extraction/persistence step; it validates authoring quality but does not create the persisted inventory required by build-time validation.

Implementation direction:

- Change the autonomous playbook `runPlaybook()` enqueue path in `packages/monitor/src/routes/playbook-service.ts` so it writes a PRD with a canonical acceptance criteria inventory block.
- Prefer a shared helper or delegation to the same preparation logic used by normal enqueue.
- Avoid hand-duplicating extractor semantics when practical.
- If needed, factor the formatter plus acceptance-criteria extraction portion of normal enqueue from `packages/engine/src/eforge.ts` into a new small engine helper that can be called by playbook enqueue without weakening queue validation.
- Add or update tests in `test/playbook-api-run-profile.test.ts` or a focused playbook API test file to assert autonomous playbook run persists a valid canonical acceptance criteria inventory in the queued PRD.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| The playbook route is the defective enqueue path, not the playbook input formatter. | Read `packages/monitor/src/routes/playbook-service.ts`; it calls `playbookToBuildSource()` then direct `enqueuePrd(...)` without `acceptanceCriteriaInventory`. `playbookToBuildSource()` is documented as formatting ordinary build source, not extracting canonical inventory. | high | low | Add/update a route test that runs an autonomous playbook and inspects queued PRD content with `requireAcceptanceCriteriaInventoryFromPrd()`. | Fixing the wrong layer could leave route behavior broken or duplicate engine-only logic in input. |
| The preferred fix is to share or mirror normal enqueue's formatter/extractor step before direct `enqueuePrd(...)`, rather than weakening `buildSinglePrd()`'s fail-closed missing-inventory gate. | Roadmap emphasizes honest gates and engine boundary discipline; current queue execution intentionally fails closed on missing inventory. Normal `EforgeEngine.enqueue()` already has the correct extraction/persistence behavior. | high | low | Implement using existing extractor helpers or a small shared enqueue-preparation helper and run targeted tests. | Weakening the gate would allow structurally invalid PRDs to proceed and undermine acceptance validation. |
| Adding extraction to autonomous playbook run may involve an agent call through the daemon route path. | Normal enqueue uses `runAcceptanceCriteriaExtractor(...)` with an agent harness; playbook route currently performs filesystem-only enqueue. This was verified by code inspection, but exact route access to agent runtimes/config requires implementation inspection. | medium | medium | Inspect monitor route context and existing enqueue worker boundaries; prefer delegating to the same engine enqueue path if available without changing API response semantics. | If route code cannot access a harness directly, an implementation that assumes it can would be too invasive; delegating to the enqueue worker/path may be safer. |
| Existing tests can be extended in `test/playbook-api-run-profile.test.ts` or related split playbook API tests. | Read existing test `returns { kind: "enqueued", id } for an autonomous playbook and creates a PRD`; it already reads the queued file and can assert inventory presence. | high | low | Add assertions/imports in the existing test or add a focused new test file if maintainability requires. | Missing test coverage could let this regression recur. |

Recommended profile: Excursion.

Rationale: this is a focused bugfix with a clear root cause and a small set of implementation targets, but it crosses daemon route behavior, engine enqueue preparation, and route-level tests. A single cohesive plan can cover the work without delegated module planning. Errand is too light because the route may need to reuse or factor engine preparation logic rather than make a trivial one-line change.

## Scope

In scope:

- Updating `packages/monitor/src/routes/playbook-service.ts`.
- Updating `packages/engine/src/eforge.ts` and/or adding a new small engine helper if needed.
- Reusing or delegating to normal enqueue preparation logic where practical.
- Preserving queue validation that requires the canonical acceptance criteria inventory block.
- Adding or updating tests in `test/playbook-api-run-profile.test.ts` or a focused playbook API test file.
- Preserving `profile`, `landing`, `landing_auto_merge`, `depends_on`, `intoWaiting`, and `postMerge` frontmatter behavior for autonomous playbook enqueue.
- Preserving existing invalid-acceptance-criteria rejection for autonomous playbooks.
- Preserving existing planning-mode playbook behavior returning `{ kind: "requires-agent" }` without queue writes.

Out of scope:

- Weakening `buildSinglePrd()`’s fail-closed missing-inventory gate.
- Treating the deterministic playbook AC quality check as a substitute for canonical inventory extraction and persistence.
- Changing planning-mode playbooks to write queued PRD files.

## Acceptance Criteria

- `POST /api/playbook/run` for an autonomous playbook with valid acceptance criteria writes a queued PRD containing exactly one canonical acceptance criteria inventory hidden block.
- `requireAcceptanceCriteriaInventoryFromPrd()` succeeds when called on the queued PRD written by `POST /api/playbook/run` for an autonomous playbook with valid acceptance criteria.
- The autonomous playbook run path preserves existing `profile` frontmatter behavior.
- The autonomous playbook run path preserves existing `landing` frontmatter behavior.
- The autonomous playbook run path preserves existing `landing_auto_merge` frontmatter behavior.
- The autonomous playbook run path preserves existing `depends_on` frontmatter behavior.
- The autonomous playbook run path preserves existing `intoWaiting` frontmatter behavior.
- The autonomous playbook run path preserves existing `postMerge` frontmatter behavior.
- `POST /api/playbook/run` returns a 400 response when an autonomous playbook has invalid acceptance criteria.
- `POST /api/playbook/run` writes zero queued PRD files when an autonomous playbook has invalid acceptance criteria.
- Planning-mode playbooks return `{ kind: "requires-agent" }`.
- Planning-mode playbooks write zero queued PRD files.
- A targeted Vitest run covering playbook API enqueue behavior exits 0.

## Manual Verification Notes

Confirmed reproduction from observed run:

1. Run autonomous playbook `public-docs-generate-and-gap-audit` or another autonomous playbook with acceptance criteria.
2. The playbook route returns an enqueued PRD id.
3. Auto-build dequeues the PRD.
4. Queue execution emits `queue:prd:start`.
5. Queue execution immediately emits `session:end` with `Acceptance criteria inventory issues ... [missing-block] Queued PRD is missing the canonical acceptance criteria inventory; re-enqueue the PRD.`
6. Queue execution emits `queue:prd:complete` with `status: failed`.

Observed timestamps for the failed build:

- `2026-06-04T14:28:00.354Z`: `queue:prd:start` for `generate-public-web-docs-and-audit-for-user-facing-gaps`.
- `2026-06-04T14:28:00.355Z`: `session:end` failure summary with `[missing-block]`.
- `2026-06-04T14:28:00.358Z`: `queue:prd:complete` with `status: failed`.