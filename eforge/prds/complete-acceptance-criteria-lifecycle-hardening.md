---
title: Complete Acceptance Criteria Lifecycle Hardening
created: 2026-06-03
recovery_from: harden-acceptance-criteria-lifecycle
recovery_set_name: harden-acceptance-criteria-lifecycle
recovery_feature_branch: eforge/harden-acceptance-criteria-lifecycle
recovery_base_branch: main
---

# Complete Acceptance Criteria Lifecycle Hardening

## Overview

Continue the acceptance-criteria lifecycle hardening work on branch `eforge/harden-acceptance-criteria-lifecycle`.

The previous build landed most of `plan-01-canonical-ac-inventory`, including canonical inventory validation, persistence, extractor wiring, hidden-block stripping, early queued-PRD inventory validation, and several regression tests. The build failed review because recovery split handling was changed to require hidden inventories in body-only recovery successor PRDs. That is incompatible with the current recovery analyst prompt and sidecar contract.

This successor covers the remaining work from `plan-01-canonical-ac-inventory` and the blocked `plan-02-unknown-resolution`.

## Starting Point

Already implemented and landed:
- `packages/engine/src/validation/acceptance-criteria-inventory.ts`
- `packages/engine/src/agents/acceptance-criteria-extractor.ts`
- `packages/engine/src/prompts/acceptance-criteria-extractor.md`
- Enqueue/build wiring in `packages/engine/src/eforge.ts`
- Queue persistence helpers in `packages/engine/src/prd-queue.ts`
- Tests in `test/acceptance-criteria-extractor.test.ts`, `test/acceptance-criteria-quality.test.ts`, and `test/engine-enqueue-after-queue-id.test.ts`

## Remaining Implementation Scope

### plan-01-canonical-ac-inventory Recovery Fixes

Fix `packages/engine/src/recovery/apply.ts` so recovery split successor PRDs remain body-only at the producer contract boundary.

The apply path must:
- Accept a visible body-only `suggestedSuccessorPrd`.
- Run the structured acceptance-criteria extractor before writing a successor queue file, or otherwise require a validated canonical inventory produced by the same canonical lifecycle.
- Reject before queue write if extraction or deterministic validation fails.
- Never synthesize queue inventories from deterministic Markdown fallback parsing.
- Preserve backwards compatibility for existing body-only recovery sidecars.

Update recovery tests so fixtures remain realistic:
- Do not inject hidden acceptance inventory blocks into recovery analyst output fixtures.
- Assert `applyRecoverySplit` produces a queued successor PRD with a valid hidden canonical inventory.
- Assert invalid body-only successor PRDs fail before queue write.

### plan-02-unknown-resolution

Implement a targeted read-only unknown-resolution pass in final PRD validation.

The resolver should run only when:
- Post-merge deterministic validation commands exit successfully.
- PRD validation passes.
- At least one expected acceptance criterion has verdict `unknown`.
- Zero expected acceptance criteria have verdict `fail`.

The resolver must:
- Receive only unknown criteria, existing verdict evidence, deterministic command evidence, implementation diff context, and permission for safe read-only inspection or comparison commands.
- Convert an unknown criterion to `pass` only with non-empty file or command evidence.
- Convert an unknown criterion to `fail` when evidence proves it is not satisfied.
- Leave criteria unknown when evidence is insufficient.
- Never mutate files, waive criteria, edit the PRD, or convert explicit failures to passes.
- Fail closed on malformed output, empty output, resolver crash, unsafe command request, dirty worktree, or unresolved unknowns.

## Acceptance Criteria

- plan-01-canonical-ac-inventory: recovery split accepts body-only `suggestedSuccessorPrd` values from current recovery analyst output.
- plan-01-canonical-ac-inventory: recovery split routes body-only successor PRDs through structured acceptance-criteria extraction before queue write.
- plan-01-canonical-ac-inventory: recovery split rejects malformed, empty, ungrounded, low-confidence, grouped, bare-command, vague, or duplicate extracted criteria before queue write.
- plan-01-canonical-ac-inventory: recovery split does not use deterministic Markdown acceptance-criteria extraction as a PRD queue-write fallback.
- plan-01-canonical-ac-inventory: recovery split writes a queued successor PRD containing a validated hidden canonical acceptance criteria inventory.
- plan-01-canonical-ac-inventory: recovery tests keep successor PRD fixtures body-only and assert the apply path creates the inventory.
- plan-01-canonical-ac-inventory: backwards-compatible recovery sidecars with body-only successor PRDs continue to work.
- plan-02-unknown-resolution: the unknown-resolution pass runs when post-merge validation exits 0, PRD validation passes, at least one expected acceptance criterion has verdict `unknown`, and zero expected acceptance criteria have verdict `fail`.
- plan-02-unknown-resolution: the unknown-resolution pass does not run when any expected acceptance criterion has verdict `fail`.
- plan-02-unknown-resolution: the unknown-resolution pass does not run when any deterministic validation command has a non-zero exit code or timeout evidence.
- plan-02-unknown-resolution: the unknown-resolution pass can convert an unknown criterion to `pass` only when it records non-empty file or command evidence for that criterion.
- plan-02-unknown-resolution: the build remains failed when the unknown-resolution pass leaves any expected acceptance criterion with verdict `unknown`.
- plan-02-unknown-resolution: the build remains failed when the unknown-resolution pass returns malformed output or produces no output.
- plan-02-unknown-resolution: the merge worktree has zero dirty tracked or untracked files after the unknown-resolution pass completes.
- `pnpm type-check` exits 0.
- The targeted Vitest commands for acceptance-criteria extraction, recovery apply, and PRD validation exit 0.
- `pnpm maintainability:check` exits 0.

## Out of Scope

- Do not add hidden inventory requirements to recovery analyst output prompts or sidecar schemas.
- Do not add a complex Markdown parser.
- Do not add user-facing approval workflow or console UI for editing acceptance inventories.
- Do not loosen acceptance criteria quality gates.
- Do not make unknown acceptance verdicts optimistic.
