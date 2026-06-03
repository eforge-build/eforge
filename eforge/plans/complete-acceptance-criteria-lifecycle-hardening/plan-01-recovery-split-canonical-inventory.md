---
id: plan-01-recovery-split-canonical-inventory
name: Recovery Split Canonical Inventory
branch: complete-acceptance-criteria-lifecycle-hardening/plan-01-recovery-split-canonical-inventory
---

# Recovery Split Canonical Inventory

## Architecture Context

The queue now persists a hidden canonical acceptance criteria inventory in queued PRDs. `enqueuePrd()` can append that inventory, and normal enqueue/staleness flows already use `runAcceptanceCriteriaExtractor()`. Recovery split apply currently violates the same lifecycle because `packages/engine/src/recovery/apply.ts` falls back to deterministic Markdown extraction when a body-only `suggestedSuccessorPrd` has no hidden inventory. Recovery analyst output is body-only by contract, so the apply path must add the inventory before the queue write without changing the sidecar schema or prompt.

`packages/engine/src/eforge.ts` and some tests are oversized. Use bounded exact edits in those files and do not rewrite them.

## Implementation

### Overview

Route recovery split successor bodies through the structured acceptance-criteria extractor before `enqueuePrd()` writes the successor PRD. Keep recovery sidecars body-only, remove the deterministic Markdown fallback from recovery apply, and validate the canonical inventory before any successor file is created.

### Key Decisions

1. Keep the recovery analyst contract unchanged: `suggestedSuccessorPrd` remains visible Markdown body content with optional agent frontmatter stripped by the apply path.
2. Move inventory construction to the same structured extractor used by normal queue enqueue and stale-PRD revision. Deterministic `extractExpectedAcceptanceCriteria()` must not be used to synthesize queue inventories for recovery split.
3. Preserve existing hidden-inventory sidecars as an accepted legacy input only when the block validates with `requireAcceptanceCriteriaInventoryFromPrd()`. Body-only sidecars must receive an extractor-produced inventory from the caller.
4. Make the monitor apply route use the same canonical lifecycle as `EforgeEngine.applyRecovery()` for split verdicts, rather than calling a fallback path.

## Scope

### In Scope

- Accept body-only recovery split successor PRDs from existing recovery analyst output.
- Run `runAcceptanceCriteriaExtractor()` for body-only split successor PRDs before queue write.
- Validate extractor output with the canonical inventory quality gates, including empty, ungrounded source quote, low confidence, duplicate, grouping-label, bare-command, and vague criteria failures.
- Strip any hidden inventory block from the visible body before writing the successor PRD, then append exactly one validated hidden inventory block via `enqueuePrd()`.
- Keep continuation frontmatter derived from the recovery sidecar summary.
- Update recovery apply and route tests so fixtures do not contain hidden inventory blocks and assertions verify the apply path creates the block.

### Out of Scope

- Recovery analyst prompt changes that ask the agent to emit hidden inventory blocks.
- Sidecar schema changes that require hidden inventory content.
- A deterministic Markdown fallback parser for recovery successor PRDs.
- Loosening acceptance criteria quality thresholds.

## Files

### Create

- None expected.

### Modify

- `packages/engine/src/recovery/apply.ts` — remove the deterministic `extractExpectedAcceptanceCriteria()` fallback; add a small exported helper that normalizes the visible successor body; require either a caller-supplied canonical inventory or a valid legacy hidden block; validate the inventory before calling `enqueuePrd()`.
- `packages/engine/src/eforge.ts` — in the split branch of `applyRecovery()`, normalize the suggested successor body, run `runAcceptanceCriteriaExtractor()` with the `prd-validator` role config, drain and yield extractor events, then pass the returned inventory into `applyRecoverySplit()`.
- `packages/monitor/src/types.ts` — if needed for tests and route parity, add an optional `agentRuntimes` field to `StartServerOptions` matching `EforgeEngine.create()` test injection.
- `packages/monitor/src/routes/recovery.ts` — ensure split apply uses the same extractor-backed path as the engine path before notifying queue mutation; retain existing 400/404 behavior for malformed or missing sidecars.
- `test/apply-recovery.test.ts` — update split fixtures to body-only successor PRDs with explicit acceptance criteria; provide `StubHarness` extractor responses; assert queued successors contain a valid hidden canonical inventory; add failure cases proving invalid extractor output stops before queue write.
- `test/apply-recovery-route.test.ts` — update split route tests to supply extractor responses through the daemon/server test harness and assert hidden inventory persistence.
- `test/recovery-engine.test.ts` and `test/recovery-analyst-wiring.test.ts` — keep analyst output fixtures body-only if touched; do not add hidden inventory blocks.

## Verification

- [ ] A body-only split `suggestedSuccessorPrd` with extractor output writes a queued successor PRD containing one valid hidden canonical inventory block.
- [ ] The queued successor body excludes agent-supplied frontmatter and uses sidecar-derived recovery continuation fields when partial-work evidence exists.
- [ ] Invalid extractor outputs for malformed JSON, empty criteria, ungrounded source quote, low confidence, duplicate criteria, grouping-label criteria, bare-command criteria, and vague criteria throw before any successor PRD file appears in `.eforge/queue`.
- [ ] A body-only split with a valid Markdown Acceptance Criteria section still fails before queue write when the extractor returns no output, proving there is no deterministic Markdown fallback.
- [ ] Legacy split sidecars that already contain a valid hidden canonical inventory continue to enqueue a successor PRD.
- [ ] `rg "extractExpectedAcceptanceCriteria" packages/engine/src/recovery/apply.ts` returns no matches.
