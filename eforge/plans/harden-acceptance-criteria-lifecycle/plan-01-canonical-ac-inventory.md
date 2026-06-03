---
id: plan-01-canonical-ac-inventory
name: Canonical Acceptance Criteria Inventory
branch: harden-acceptance-criteria-lifecycle/plan-01-canonical-ac-inventory
agents:
  builder:
    effort: high
    rationale: Cross-cutting engine lifecycle change across enqueue, queue
      persistence, compile/build handoff, and tests while keeping oversized
      files under no-growth ceilings.
  tester:
    effort: high
    rationale: Requires targeted fail-closed regression coverage for extractor
      parsing, queue writes, prompt stripping, and PRD build inventory loading.
---

# Canonical Acceptance Criteria Inventory

## Architecture Context

Acceptance criteria become a persisted lifecycle artifact for queued PRD builds. The semantic extraction path moves from Markdown heading parsing to an LLM structured-output pass at enqueue time, while deterministic code validates schema, grounding, item quality, stable IDs, and persistence. The existing deterministic Markdown extractor remains available for plan-file builds and input-authoring surfaces; it must not remain the primary PRD build extraction path.

This plan intentionally does **not** introduce new `AgentRole` literals or new event variants. The extractor helper runs through the existing `prd-validator` role configuration and emits ordinary `agent:*` events, avoiding client wire-schema and daemon API version churn in this slice.

## Implementation

### Overview

Add a canonical acceptance-criteria inventory module, an enqueue-time structured extractor helper, hidden-block persistence for queued PRDs, and build-time loading of the persisted inventory. Strip the hidden block anywhere PRD prose is shown to planners, validators, staleness assessors, dependency detectors, or profile routers.

### Key Decisions

1. Persist inventory as an eforge-owned hidden Markdown block in the queued PRD body, not nested frontmatter. This avoids upgrading the simple queue frontmatter parser and still keeps inventory next to the source.
2. Run extraction against the formatted PRD body because that is the source committed to the queue. Grounding checks compare source quotes against that exact body.
3. Reject missing or malformed persisted inventories for queued PRD builds before orchestration starts, with a re-enqueue error. Do not call `extractExpectedAcceptanceCriteria(...)` as a PRD fallback.
4. Keep plan-file extraction unchanged for non-PRD compiled builds with `allowFallbackSections: true`.
5. Keep large legacy files under their baseline ceilings by moving new logic into new modules and using bounded exact edits in `eforge.ts`, `prd-queue.ts`, and other oversized files.

## Scope

### In Scope

- LLM structured extraction for PRD enqueue before queue writes.
- Deterministic validation of extractor JSON, source grounding, stable ID assignment, duplicate detection, confidence threshold, and item quality.
- Hidden-block serialization, parsing, and stripping helpers.
- Queue persistence through `enqueuePrd(...)` without nested frontmatter.
- PRD build consumption of the persisted canonical inventory.
- Fail-closed errors for missing, malformed, empty, ungrounded, low-confidence, duplicate, grouping-label, bare-command, and vague extracted criteria.
- Documentation for user-visible enqueue rejection and canonicalized acceptance criteria.

### Out of Scope

- Unknown verdict second-pass resolution; that is implemented in plan-02.
- New daemon routes, new event variants, new agent role literals, or API version changes.
- Manual inventory editing UI or approval workflow.
- Complex Markdown parsing for arbitrary PRD shapes.

## Files

### Create

- `packages/engine/src/validation/acceptance-criteria-inventory.ts` — Canonical inventory types, JSON extraction helpers, deterministic validation, source-quote grounding checks, `ac-###` assignment, hidden-block serialize/parse/strip helpers, and diagnostic formatting.
- `packages/engine/src/agents/acceptance-criteria-extractor.ts` — Structured extractor runner using the existing `prd-validator` role configuration, `tools: 'none'`, accumulated agent output parsing, and fail-closed empty-output handling.
- `packages/engine/src/prompts/acceptance-criteria-extractor.md` — Prompt requiring a single JSON object with flat criteria, source quotes, confidence, and warnings.

### Modify

- `packages/engine/src/validation/acceptance-criteria.ts` — Reuse/export small normalization or item-quality helpers as needed; keep deterministic Markdown extraction available for plan files and input-authoring compatibility.
- `packages/engine/src/prd-queue.ts` — Add an optional `acceptanceCriteriaInventory` parameter to `EnqueuePrdOptions` and append the hidden inventory block during file serialization. Keep this file at or below its maintainability ceiling.
- `packages/engine/src/eforge.ts` — Run the extractor after formatting and before dependency detection/queue write; remove parser-primary PRD enqueue quality gating; pass inventory to `enqueuePrd`; strip hidden blocks from compile source, dependency summaries, staleness prompts, validator/gap-closer PRD content, and PRD prose; load the required persisted inventory for queued PRD builds and fail closed if absent or invalid.
- `packages/engine/src/extensions/profile-router-runtime.ts` — Strip the hidden inventory block from `prdBody` and `prdContentSummary` before router context construction.
- `test/acceptance-criteria-extractor.test.ts` — Add structured inventory parsing, validation, serialization, stripping, and PRD-build no-fallback regression tests while preserving deterministic plan-file extraction coverage.
- `test/acceptance-criteria-quality.test.ts` — Update enqueue integration tests so invalid extractor output causes `enqueue:failed` before any queue file is written; keep input package quality analyzer coverage.
- `test/engine-enqueue-after-queue-id.test.ts` — Update stub harness sequencing so valid extractor output exists before dependency handling assertions.
- `test/orchestration-validation-gates.test.ts` — Rewrite any PRD-build parser fallback expectations to use persisted inventories or assert the new re-enqueue failure path.
- `web/content/docs/getting-started.md` — Mention that enqueue canonicalizes acceptance criteria and rejects malformed or vague criteria before queue write.
- `web/content/docs/concepts.md` — Document the queued PRD inventory lifecycle and the requirement to re-enqueue PRDs missing an inventory.

## Implementation Notes

### Canonical inventory module

Implement a compact module with exports similar to:

- `AC_INVENTORY_VERSION`
- `AC_EXTRACTION_MIN_CONFIDENCE`
- `CanonicalAcceptanceCriterion`
- `CanonicalAcceptanceCriteriaInventory`
- `parseAcceptanceCriteriaExtractorOutput(text, source, options)`
- `validateCanonicalAcceptanceCriteriaInventory(value, source, options)`
- `appendAcceptanceCriteriaInventoryBlock(body, inventory)`
- `stripAcceptanceCriteriaInventoryBlock(markdown)`
- `readAcceptanceCriteriaInventoryBlock(markdown)`
- `requireAcceptanceCriteriaInventoryFromPrd(markdown, options)`
- `formatAcceptanceInventoryDiagnostics(diagnostics)`

Validation must reject:

- Non-JSON, invalid JSON, missing `criteria`, or non-array `criteria`.
- Empty inventory when `allowNoAcceptanceCriteria` is false.
- Blank criterion text.
- Missing or blank source quote/grounding. Prefer `sourceQuote` and require it to appear in the formatted PRD after whitespace normalization.
- Confidence below the exported threshold.
- Duplicate normalized criterion text.
- Grouping labels, bare command fragments, and vague criteria via the existing item quality analyzer.

Assign IDs only after validation: `ac-001`, `ac-002`, and so on. Persist those IDs and validate ID order on load.

### Hidden block format

Use a sentinel block that cannot be confused with frontmatter, for example:

```md
<!-- eforge:acceptance-criteria-inventory
{"version":1,"criteria":[...]}
eforge:end-acceptance-criteria-inventory -->
```

The parser must accept exactly one block. Multiple blocks or malformed JSON are invalid for build consumption. `stripAcceptanceCriteriaInventoryBlock(...)` must remove the entire block and normalize adjacent blank lines enough that prompts do not show the inventory.

### Oversized file constraints

`packages/engine/src/eforge.ts`, `packages/engine/src/prd-queue.ts`, and other baseline files have no-growth ceilings. Put substantial logic in the new inventory/extractor modules, trim obsolete comments where needed, and run `pnpm maintainability:check` before finishing.

## Verification

- [ ] `parseAcceptanceCriteriaExtractorOutput(...)` returns `ac-001` and `ac-002` for a valid JSON inventory with two grounded criteria.
- [ ] Malformed extractor JSON produces an enqueue failure and leaves the queue directory with zero new Markdown files.
- [ ] Empty extractor inventories are rejected when `allowNoAcceptanceCriteria` is false.
- [ ] Criteria without a source quote are rejected.
- [ ] Criteria below `AC_EXTRACTION_MIN_CONFIDENCE` are rejected.
- [ ] Grouping-label, bare-command, vague, and duplicate criteria are rejected by deterministic validation.
- [ ] A successful enqueue writes exactly one queued PRD Markdown file containing one hidden inventory block with stable `ac-###` IDs.
- [ ] Planner, validator, staleness, dependency-detector, and profile-router inputs do not contain `eforge:acceptance-criteria-inventory`.
- [ ] A queued PRD build reads the persisted inventory and passes stable IDs to `runPrdValidator`.
- [ ] A queued PRD build with malformed, unreadable, or multiple hidden inventory blocks fails before orchestration with an error containing `re-enqueue`.
- [ ] A queued PRD build with no hidden inventory block fails before orchestration with an error containing `re-enqueue`.
