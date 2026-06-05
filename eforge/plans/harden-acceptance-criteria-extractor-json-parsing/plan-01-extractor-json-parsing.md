---
id: plan-01-extractor-json-parsing
name: Shared Balanced JSON Parsing for Acceptance Criteria Extractor
branch: harden-acceptance-criteria-extractor-json-parsing/plan-01-extractor-json-parsing
---

# Shared Balanced JSON Parsing for Acceptance Criteria Extractor

## Architecture Context

Acceptance-criteria extraction runs during enqueue and currently validates the model's full response as JSON. That rejects otherwise usable extractor output when the response contains a prose preamble or suffix around a canonical inventory object. The PRD validator already tolerates fenced or prose-wrapped JSON through a private balanced-brace scanner. This plan moves that behavior into a shared validation helper and wires the extractor parser to use it only for agent output. Hidden queue-file inventory blocks remain strict because those blocks are machine-written artifacts and malformed persisted artifacts must fail with re-enqueue diagnostics.

No database migrations are required.

## Implementation

### Overview

Create a small shared JSON-object text extractor, refactor existing private scanners to call it, and use it in `parseAcceptanceCriteriaExtractorOutput()` before canonical inventory validation. Keep persisted block parsing on the existing strict whole-response parser.

### Key Decisions

1. Put the helper in `packages/engine/src/validation/json-object-extractor.ts` so validation parsers and agent parsers can import it without adding an agent-to-validation dependency cycle.
2. Preserve the PRD validator scanner semantics: inspect fenced `json` or unlabeled code blocks first, extract the first balanced object in a fence, then fall back to the first balanced object in the full response; string literals and escaped quotes must not affect brace depth.
3. Limit prose tolerance to agent-output parsing paths. `requireAcceptanceCriteriaInventoryFromPrd()` must continue to parse the hidden block with a strict raw/whole-fence JSON parser and append `re-enqueue` diagnostics on malformed persisted blocks.
4. Remove local balanced-brace scanner declarations from current consumers discovered during exploration (`prd-validator.ts`, and the duplicate resolver scanner in `acceptance-unknown-resolution.ts`) so the implementation has one scanner source.

## Scope

### In Scope

- Add a shared balanced JSON-object text extraction helper.
- Refactor `packages/engine/src/agents/prd-validator.ts` to import the helper and delete its local `findJsonObjectText()` / `findBalancedObject()` functions.
- Refactor `packages/engine/src/validation/acceptance-unknown-resolution.ts` to import the helper and delete its local scanner, preserving current error messages.
- Update `packages/engine/src/validation/acceptance-criteria-inventory.ts` so `parseAcceptanceCriteriaExtractorOutput()` extracts a balanced object from prose/fence-wrapped agent output before `JSON.parse()`.
- Keep `requireAcceptanceCriteriaInventoryFromPrd()` on strict persisted-block parsing.
- Add regression tests for prose-prefixed, prose-suffixed, and prose-plus-fenced extractor output.
- Add tests for no-object extractor output and prose around persisted hidden block JSON.
- Add focused helper coverage for fenced blocks, escaped strings, and no-object input.

### Out of Scope

- Prompt-only changes to `packages/engine/src/prompts/acceptance-criteria-extractor.md`.
- Queue writing changes in `packages/engine/src/prd-queue.ts`.
- Console UI retry or Needs attention behavior.
- Daemon API, route, and database changes.

## Files

### Create

- `packages/engine/src/validation/json-object-extractor.ts` — exports `findJsonObjectText(text: string): string | undefined` and contains the single private balanced-object scanner.
- `test/json-object-extractor.test.ts` — direct coverage for the shared helper's fenced/prose/escaped-string behavior.

### Modify

- `packages/engine/src/agents/prd-validator.ts` — import the shared helper in `parseGaps()` and remove private scanner functions.
- `packages/engine/src/validation/acceptance-criteria-inventory.ts` — add a tolerant agent-output parse path for `parseAcceptanceCriteriaExtractorOutput()` while keeping persisted block parsing strict.
- `packages/engine/src/validation/acceptance-unknown-resolution.ts` — import the shared helper and remove the duplicate local scanner.
- `test/acceptance-criteria-extractor.test.ts` — add regression coverage for prose-wrapped extractor JSON, fenced JSON surrounded by prose, no balanced object, and strict persisted block parsing with prose around valid JSON.
- `test/acceptance-unknown-resolver.test.ts` — add a small regression case if the resolver parser is refactored to the shared helper.

## Implementation Notes

- The shared helper can be a direct extraction of the current PRD validator `findJsonObjectText()` / `findBalancedObject()` behavior, with clearer exported naming if desired.
- `parseAcceptanceCriteriaExtractorOutput()` must report an `invalid-json` diagnostic when no balanced object is found, with a message containing `JSON object`.
- After extracting and parsing JSON, all existing calls to `validateCanonicalAcceptanceCriteriaInventory()` must remain unchanged except for the parser input value; invalid schema, ungrounded source quotes, low confidence, duplicates, and quality diagnostics must still originate from the canonical inventory validator.
- `parseJsonObject()` in `acceptance-criteria-inventory.ts` can remain strict for persisted block use, or be renamed to make strict usage explicit. Do not pass persisted hidden block text through the new tolerant helper.
- Use bounded edits in oversized files. `test/acceptance-criteria-extractor.test.ts` is under the new-test ceiling but already large; add focused tests near the existing canonical inventory parser cases instead of rewriting the file.

## Verification

- [ ] `parseAcceptanceCriteriaExtractorOutput(``Here is the extraction:\n${validExtractorJson()}``, CANONICAL_SOURCE)` returns criteria ids `['ac-001', 'ac-002']`.
- [ ] `parseAcceptanceCriteriaExtractorOutput(``${validExtractorJson()}\nDone.``, CANONICAL_SOURCE)` returns criteria ids `['ac-001', 'ac-002']`.
- [ ] `parseAcceptanceCriteriaExtractorOutput()` returns criteria ids `['ac-001', 'ac-002']` for prose surrounding a fenced `json` block containing `validExtractorJson()`.
- [ ] `parseAcceptanceCriteriaExtractorOutput('I do not see acceptance criteria.', CANONICAL_SOURCE)` throws an error message containing `JSON object`.
- [ ] Existing invalid-schema, ungrounded-source, low-confidence, duplicate, and quality tests in `test/acceptance-criteria-extractor.test.ts` still throw their existing diagnostic categories.
- [ ] A hidden acceptance-criteria inventory block containing prose plus a valid JSON object throws a `re-enqueue` diagnostic through `requireAcceptanceCriteriaInventoryFromPrd()`.
- [ ] `packages/engine/src/agents/prd-validator.ts` contains no `function findJsonObjectText` or `function findBalancedObject` declarations.
- [ ] `rg -n "function findJsonObjectText|function findBalancedObject|function findBalancedJsonObject" packages/engine/src --glob '!dist' --glob '!node_modules'` reports scanner function declarations only in `packages/engine/src/validation/json-object-extractor.ts`.
- [ ] `pnpm vitest run test/json-object-extractor.test.ts test/acceptance-criteria-extractor.test.ts test/prd-validator.test.ts test/acceptance-unknown-resolver.test.ts` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.