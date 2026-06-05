---
title: Harden Acceptance-Criteria Extractor JSON Parsing
created: 2026-06-05
landing: pr
landing_auto_merge: true
---

# Harden Acceptance-Criteria Extractor JSON Parsing

## Problem / Motivation

This bugfix aligns with the roadmap’s **Kernel Resilience and Typed Recovery** goal, especially honest fail-closed gates and typed recovery paths. Enqueue should reject invalid acceptance-criteria inventory data, but it should not reject an otherwise valid extractor result solely because the model wrapped the JSON object in harmless prose.

Confirmed evidence:

- Failed enqueue run `c4c02fa8-c514-491c-b8a0-6dc8ee8a62d4` for `.eforge/session-plans/2026-06-05-console-extension-management-surface.md` ended at `2026-06-05T05:12:18.992Z` with `[invalid-json] Unexpected token 'I', "I don't se"...`.
- Failed enqueue run `152be249-22f7-4328-841b-e0bb0ffb0791` for the same session plan ended at `2026-06-05T05:33:55.256Z` with `[invalid-json] Unexpected token 'D', "Disregardi"...`.
- In the second failed run, the `prd-validator` result text began with prose: `Disregarding that erroneous tool call — the task explicitly says "Do not use tools." Here is the extraction:` followed by a valid-looking JSON object with `version`, `criteria`, and `warnings`.
- `packages/engine/src/eforge.ts` runs `runAcceptanceCriteriaExtractor()` during enqueue after formatting and before writing the queue file.
- `packages/engine/src/agents/acceptance-criteria-extractor.ts` runs the `acceptance-criteria-extractor` prompt through the `prd-validator` role and then passes the full agent result text to `parseAcceptanceCriteriaExtractorOutput()`.
- `packages/engine/src/prompts/acceptance-criteria-extractor.md` already instructs the agent to return exactly one JSON object and no prose.
- `packages/engine/src/validation/acceptance-criteria-inventory.ts` parses extractor output with a strict helper that accepts only whole-response raw JSON or a whole-response fenced JSON block.
- `packages/engine/src/agents/prd-validator.ts` already contains DRY-relevant balanced JSON extraction logic, `findJsonObjectText()` / `findBalancedObject()`, that tolerates prose around a JSON object for PRD validation output.
- Existing extractor tests in `test/acceptance-criteria-extractor.test.ts` cover valid JSON and invalid schema cases, but not prose-wrapped valid JSON.
- Project maintainability policy requires bounded edits for oversized files and prefers shared helpers over duplicated parsing logic.

Enqueue can fail even when the acceptance-criteria extractor produced an otherwise valid canonical inventory JSON object, because the extractor parser requires the entire model response to be raw JSON or a whole-response fenced JSON block. If the agent adds a short preamble before a valid JSON object, enqueue reports `[invalid-json]` and writes no queued PRD file.

This affects users promoting ready session plans through `/eforge:build` or host tools. In the observed case, the Console extension management PRD failed to enqueue twice, and the user had no UI retry affordance. The UI gap is captured separately; this plan fixes the engine-side extractor parsing defect while preserving fail-closed validation for genuinely invalid inventories.

## Goal

Harden acceptance-criteria extractor parsing so valid balanced JSON objects are accepted even when surrounded by harmless prose. Preserve fail-closed schema, grounding, quality, and persisted queue-block validation while reusing the existing balanced-object extraction logic.

## Approach

Extract the existing balanced JSON object extraction behavior from `packages/engine/src/agents/prd-validator.ts` into a small shared helper module, likely under `packages/engine/src/agents/` or `packages/engine/src/validation/`.

The shared helper must:

- Support fenced JSON blocks.
- Support prose-wrapped JSON objects.
- Respect strings and escaped quotes the same way the existing `findBalancedObject()` does.
- Stay small and focused.
- Avoid introducing a new large implementation file.

Refactor `packages/engine/src/agents/prd-validator.ts` to import and use the shared helper instead of retaining private `findJsonObjectText()` / `findBalancedObject()` implementations.

Update `packages/engine/src/validation/acceptance-criteria-inventory.ts` so extractor agent output parsing uses the shared helper. Persisted inventory block parsing may remain strict because hidden queue-file blocks should be exactly JSON and malformed persisted blocks should continue to fail closed with re-enqueue diagnostics.

The prompt is not the only issue. `packages/engine/src/prompts/acceptance-criteria-extractor.md` already says `Return exactly one JSON object and no prose. Do not use tools.` Prompt strengthening may reduce frequency, but parser hardening is needed because model output is not perfectly reliable and another engine parser already tolerates this class of wrapping. Do not rely on a prompt-only fix.

Current confirmed code path:

- `packages/engine/src/eforge.ts` lines 521-537 call `runAcceptanceCriteriaExtractor()` during enqueue and store the returned `acceptanceCriteriaInventory` before queue-file creation.
- `packages/engine/src/agents/acceptance-criteria-extractor.ts` lines 21-24 loads `acceptance-criteria-extractor.md`.
- `packages/engine/src/agents/acceptance-criteria-extractor.ts` lines 29-38 runs the extractor as `prd-validator`.
- `packages/engine/src/agents/acceptance-criteria-extractor.ts` lines 51-58 pass the raw `resultText` or accumulated message text to `parseAcceptanceCriteriaExtractorOutput()`.
- `packages/engine/src/validation/acceptance-criteria-inventory.ts` lines 41-49 parse extractor output with `parseJsonObject()`.
- `parseJsonObject()` only strips a fenced code block when the entire response exactly matches the fence; otherwise it calls `JSON.parse()` on the entire trimmed response.
- Any leading or trailing prose makes an otherwise valid JSON object fail before schema validation.
- The observed second failure confirms this exact mechanism: the model output contained a valid-looking JSON object after a prose prefix, and the diagnostic failed on the leading `D` in `Disregarding`.

DRY-relevant existing code:

- `packages/engine/src/agents/prd-validator.ts` lines 193 and 294-323 already implement `findJsonObjectText()` / `findBalancedObject()` for extracting a balanced JSON object from fenced or prose-wrapped model output.
- That helper is currently local to `prd-validator.ts`, so `acceptance-criteria-inventory.ts` cannot reuse it without moving or exporting it.
- The fix should extract the balanced-object JSON text finder to a small shared helper module, or otherwise expose it from an appropriate shared parsing module.
- Both `prd-validator.ts` and `acceptance-criteria-inventory.ts` should use the shared helper.
- Do not duplicate the brace-scanning implementation.

Add focused regression coverage in `test/acceptance-criteria-extractor.test.ts` for prose-prefixed and/or prose-suffixed valid extractor JSON.

Add or update a focused parser test if the shared helper is exported from a new module.

Keep existing invalid-schema, ungrounded-source, low-confidence, duplicate, and quality diagnostics intact.

Recommended profile: **Excursion**.

Rationale: this is a focused engine bugfix with a clear root cause and a small cohesive implementation target, but it touches shared parser behavior and regression tests. A single plan can cover the helper extraction, parser wiring, and validation scope without delegated module planning. Errand is too light because the DRY helper extraction must preserve both acceptance extractor and PRD validator behavior.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| The immediate enqueue failure is caused by strict parsing of prose-wrapped JSON, not malformed inventory content inside the JSON object. | Monitor DB for run `152be249-22f7-4328-841b-e0bb0ffb0791` shows `[invalid-json] Unexpected token 'D'`; extracting the balanced object from the agent `resultText` with a one-off script parsed successfully into keys `version`, `criteria`, and `warnings` with 104 criteria. | high | low | Add a regression unit test that prefixes `validExtractorJson()` with prose and proves current code fails before the fix and passes after the fix. | If wrong, parser hardening alone would not allow the PRD to enqueue and further schema/quality fixes would be needed. |
| Reusing the PRD validator's balanced JSON extraction behavior is the right DRY target. | `packages/engine/src/agents/prd-validator.ts` already documents that `parseGaps()` tolerates prose around JSON and implements `findJsonObjectText()` / `findBalancedObject()`; `acceptance-criteria-inventory.ts` currently has a separate strict parser. | high | low | Extract those helpers to a shared module and run existing `test/prd-validator.test.ts` plus new acceptance extractor tests. | If the helper semantics are not appropriate for extractor output, sharing could over-accept malformed extractor responses or regress PRD validator parsing. |
| Persisted hidden inventory block parsing should remain strict. | Queue-file validation reads a machine-written hidden block via `readAcceptanceCriteriaInventoryBlock()` and emits explicit re-enqueue diagnostics for missing/multiple/malformed blocks. Roadmap emphasizes honest fail-closed gates. | high | low | Keep `requireAcceptanceCriteriaInventoryFromPrd()` tests unchanged and add a test showing hidden block parsing does not accept prose around persisted JSON. | If hidden blocks become prose-tolerant, corrupted queue artifacts could pass validation too easily. |
| A small shared helper can be introduced without violating maintainability constraints. | The existing brace scanner in `prd-validator.ts` is small; new implementation file cap is 600 lines and new test cap is 1,200 lines. | high | low | Run `pnpm maintainability:check` if implementation touches file sizes near limits. | If a target file is over baseline ceilings, implementation may need a more careful extraction plan. |
| Type-check plus targeted parser tests are sufficient validation for this bugfix. | The change is parser-level and does not require daemon route changes; enqueue integration already calls the parser. Existing test suite has focused acceptance extractor and PRD validator tests. | medium-high | medium | Optionally run a real enqueue of `.eforge/session-plans/2026-06-05-console-extension-management-surface.md` after the fix once active builds allow it. | If integration behavior differs from unit tests, enqueue could still fail due to profile/harness behavior or a later validation gate. |

No low-confidence/high-impact assumptions remain unresolved. The main behavioral boundary is explicit: tolerate prose around extractor agent JSON, but keep schema/grounding/quality validation and persisted queue block validation fail-closed.

## Scope

In scope:

- Add a small shared JSON-object extraction helper.
- Refactor `packages/engine/src/agents/prd-validator.ts` to use the shared helper.
- Update `packages/engine/src/validation/acceptance-criteria-inventory.ts` so extractor output parsing uses the shared helper for agent output.
- Preserve strict persisted inventory block parsing for queued PRD markdown.
- Add focused regression coverage in `test/acceptance-criteria-extractor.test.ts`.
- Add or update focused parser coverage if the shared helper is exported from a new module.
- Keep invalid-schema, ungrounded-source, low-confidence, duplicate, and quality diagnostics intact.

Files likely touched:

- `packages/engine/src/agents/prd-validator.ts`
- `packages/engine/src/validation/acceptance-criteria-inventory.ts`
- A new small helper file such as `packages/engine/src/agents/json-object-extractor.ts` or `packages/engine/src/validation/json-object-extractor.ts`
- `test/acceptance-criteria-extractor.test.ts`
- Optionally `test/prd-validator.test.ts` only if refactoring the helper changes direct parser coverage needs

Out of scope:

- `packages/engine/src/prompts/acceptance-criteria-extractor.md`, unless implementation adds a minor prompt clarification after parser hardening.
- Prompt-only fixes.
- `packages/engine/src/prd-queue.ts`; queue writing already appends the validated canonical inventory block when the extractor succeeds.
- Console UI files; the separate Needs attention/re-enqueue backlog item covers UI retry behavior.

## Acceptance Criteria

- `parseAcceptanceCriteriaExtractorOutput()` accepts extractor output that contains a valid balanced JSON object preceded by non-JSON prose.
- `parseAcceptanceCriteriaExtractorOutput()` accepts extractor output that contains a valid balanced JSON object followed by non-JSON prose.
- `parseAcceptanceCriteriaExtractorOutput()` accepts extractor output that contains a valid balanced JSON object inside a fenced `json` code block with surrounding prose.
- `parseAcceptanceCriteriaExtractorOutput()` rejects extractor output that contains no balanced JSON object.
- `parseAcceptanceCriteriaExtractorOutput()` rejects extractor output whose extracted JSON object fails canonical acceptance-criteria inventory schema validation.
- `parseAcceptanceCriteriaExtractorOutput()` rejects extractor output whose extracted JSON object contains ungrounded `sourceQuote` values.
- `parseAcceptanceCriteriaExtractorOutput()` rejects extractor output whose extracted JSON object contains low-confidence criteria below `AC_EXTRACTION_MIN_CONFIDENCE`.
- `packages/engine/src/agents/prd-validator.ts` uses the shared balanced JSON object extraction helper.
- `packages/engine/src/agents/prd-validator.ts` does not declare a private balanced-brace JSON scanner.
- The acceptance-criteria extractor parser uses the same shared balanced JSON object extraction helper used by `packages/engine/src/agents/prd-validator.ts`.
- The implementation adds zero duplicated balanced-brace JSON scanner functions outside the shared helper.
- Persisted acceptance-criteria inventory block validation requires exactly one well-formed hidden inventory block in queued PRD markdown.
- Persisted acceptance-criteria inventory block validation emits a re-enqueue diagnostic for a malformed persisted inventory block.
- Persisted acceptance-criteria inventory block validation emits a re-enqueue diagnostic for a missing persisted inventory block.
- Persisted acceptance-criteria inventory block validation emits a re-enqueue diagnostic for multiple persisted inventory blocks.
- Persisted acceptance-criteria inventory block validation emits a re-enqueue diagnostic for an invalid persisted inventory block.
- Persisted acceptance-criteria inventory block parsing does not accept prose around persisted JSON.
- Existing invalid-schema diagnostics remain intact.
- Existing ungrounded-source diagnostics remain intact.
- Existing low-confidence diagnostics remain intact.
- Existing duplicate diagnostics remain intact.
- Existing quality diagnostics remain intact.
- A targeted Vitest run covering acceptance-criteria extractor parsing exits 0.
- A targeted Vitest run covering PRD validator JSON parsing exits 0 if the PRD validator parser tests are changed.
- `pnpm type-check` exits 0.

## Manual Verification Notes

Confirmed monitor DB and code-inspection reproduction:

1. Use `/eforge:build` or `eforge_build` on `.eforge/session-plans/2026-06-05-console-extension-management-surface.md`.
2. Run with a profile whose `prd-validator` role can produce prose-wrapped JSON, such as the observed `gpt-claude-combo` profile where the formatter used `gpt-5.5` and `prd-validator` used `claude-opus-4-8`.
3. Let enqueue complete the formatter stage.
4. The acceptance-criteria extractor agent returns text beginning with prose such as `Disregarding that erroneous tool call — ... Here is the extraction:` followed by a JSON object with `version`, `criteria`, and `warnings`.
5. `parseAcceptanceCriteriaExtractorOutput()` attempts to parse the whole response with `JSON.parse()`.
6. Enqueue emits `enqueue:failed` with an `[invalid-json]` diagnostic, for example `Unexpected token 'D', "Disregardi"... is not valid JSON`.
7. The queue directory contains no new PRD markdown file for that failed enqueue.

Minimal unit reproduction:

1. Construct a valid extractor JSON object using the existing `validExtractorJson()` test helper in `test/acceptance-criteria-extractor.test.ts`.
2. Prefix it with prose, for example `Here is the extraction:\n\n`.
3. Call `parseAcceptanceCriteriaExtractorOutput(proseWrappedJson, source)`.
4. Current behavior: the call throws `[invalid-json]`.
5. Expected behavior: the call parses the balanced JSON object, validates it against the canonical inventory schema and source grounding rules, assigns stable `ac-###` ids, and returns a canonical inventory.

Optional validation path:

- Run a real enqueue of `.eforge/session-plans/2026-06-05-console-extension-management-surface.md` after the fix once active builds allow it.