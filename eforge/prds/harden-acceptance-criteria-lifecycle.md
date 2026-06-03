---
title: Harden Acceptance Criteria Lifecycle
created: 2026-06-03
profile: pi-codex-5-5
landing: pr
landing_auto_merge: true
---

# Harden Acceptance Criteria Lifecycle

## Problem / Motivation

This work combines two backlog items into one acceptance-criteria lifecycle improvement: LLM-primary structured extraction/canonicalization at enqueue time plus final-validation unknown resolution.

Evidence gathered:

- `docs/roadmap.md` lists **Honest gates** under Kernel Resilience and Typed Recovery; this work directly strengthens fail-closed acceptance evidence without moving workflow UX into the kernel.
- `packages/engine/src/validation/acceptance-criteria.ts` owns deterministic extraction, normalization, matching, missing-verdict synthesis, and an inlined copy of AC quality analysis. Heading matching is exact today: `Acceptance Criteria`, `Acceptance criteria`, or `ACs`.
- `packages/input/src/acceptance-criteria-quality.ts` has a separate AC quality analyzer copy used by input/session-plan surfaces; heading logic there must stay in sync with the engine copy.
- `packages/engine/src/eforge.ts` runs the formatter during enqueue, applies the AC quality gate before queue write, and derives `expectedAcceptanceCriteria` at build time from the queued PRD or generated plan files.
- `packages/engine/src/agents/prd-validator.ts` prompts the validator with stable `ac-###` IDs and deterministic validation command evidence, then emits `acceptance_validation:complete`.
- `packages/engine/src/orchestrator/phases.ts` currently synthesizes unknown verdicts for uncovered expected criteria and rejects the build whenever PRD validation passed but acceptance validation is absent or non-passing. There is no targeted resolver between the first inconclusive AC verdict and final rejection.
- `packages/engine/src/orchestrator/acceptance-conflict-policy.ts` already centralizes post-processing of acceptance events for conflict waivers; the unknown-resolution pass should fit next to this gate rather than bypassing it.
- `test/acceptance-criteria-extractor.test.ts`, `test/acceptance-criteria-quality.test.ts`, `test/prd-validator.test.ts`, `test/prd-validate-phase.test.ts`, and validation-gate tests cover the existing behavior and are the main regression targets.

Direction update: do not try to make Markdown parsing the semantic source of truth. The LLM should perform structured extraction from the full PRD/build source; deterministic code should validate schema, grounding, quality, persistence, and fail-closed behavior.

This looks like an **architecture / deep** change. It touches engine validation flow, agent prompts, structured output parsing, acceptance inventory persistence, and potentially closed event/config schemas. Override if the plan should be narrowed to a smaller first slice.

## Goal

Treat acceptance criteria as a lifecycle artifact that begins at enqueue/compile and is consumed by final validation. Make LLM structured extraction/canonicalization the primary PRD acceptance-criteria extraction path at enqueue time, while preserving fail-closed behavior through deterministic validation, persistence, and final unknown-resolution handling.

## Approach

### Architecture impact

The change stays inside the engine/input boundary and does not introduce wrapper-app workflow orchestration.

Expected architecture changes:

- Add a focused acceptance-criteria extraction agent or structured-output path that runs during enqueue/compile for PRD builds and returns a canonical JSON inventory.
- Add deterministic inventory validation helpers in `packages/engine/src/validation/acceptance-criteria.ts` or a new lifecycle module. These helpers validate schema, non-empty text, source grounding, flat/atomic criteria, quality diagnostics, stable ID assignment, and serialization/deserialization.
- Remove parser-based PRD acceptance extraction from the build path. After this change, queued PRD builds require a persisted canonical inventory; missing inventory is a hard validation error.
- Keep `packages/input/src/acceptance-criteria-quality.ts` and the engine quality analyzer behaviorally aligned for criteria item quality. Session-plan/readiness quality checks may still use deterministic section detection because they are input-authoring surfaces, not the PRD build kernel source of truth.
- Introduce an enqueue/compile-time inventory source of truth for queued PRD builds. The build phase should consume the persisted inventory and fail closed if it is missing, malformed, or unreadable.
- Add a narrow final-validation resolver between `buildAcceptanceValidationEvents(...)` and the terminal acceptance rejection in `prdValidate(...)`.
- The resolver should reuse existing agent event streams and `acceptance_validation:complete` as the final terminal evidence when possible. Add new closed event variants only if observability cannot be expressed clearly with existing `agent:*`, `planning:progress`, and repeated acceptance-complete events.
- If a new agent role, event variant, queue metadata field, or daemon-visible wire shape is introduced, update `@eforge-build/client` schemas, route/API version metadata, generated docs, and consumers according to project policy.

No architecture impact expected:

- No new daemon route is required.
- No new external service is required.
- No new host integration behavior is required in `eforge-plugin/` or `packages/pi-eforge/` unless user-facing CLI/MCP/skill behavior changes.

### Design decisions

Decision 1: LLM structured extraction is primary for PRD builds.

- The extractor reads the full PRD/build source and returns structured JSON rather than relying on Markdown heading/list parsing as the semantic source of truth.
- The extractor should output flat acceptance criteria, each with criterion text, source quote or source-grounding reference, confidence, and optional warning fields.
- The engine assigns or normalizes stable `ac-###` IDs after validating the inventory, so downstream validators use deterministic IDs even though semantic extraction came from the LLM.

Decision 2: deterministic code verifies the extracted inventory.

- Deterministic validation must reject malformed JSON, missing/empty criteria, duplicate criteria, missing source grounding, grouping-label criteria, bare command fragments, vague criteria, and low-confidence extraction.
- Deterministic validation may compare the LLM inventory to a simple Markdown parser as a sanity check, but disagreement should produce a warning or fail-closed diagnostic rather than causing the parser to become source of truth.
- This avoids growing a brittle parser while still preventing the LLM from silently inventing or certifying criteria.

Decision 3: no legacy parser fallback in the PRD build kernel.

- Do not maintain compatibility code that tries to recover acceptance criteria from queued PRDs lacking a persisted inventory.
- Do not require deterministic parsing to understand arbitrary PRD structure, prose criteria, or every possible heading variant.
- If a queued PRD has no persisted validated inventory, the build should fail closed with an actionable error telling the user to re-enqueue the source.

Decision 4: persist the inventory before the build validates it.

- Persist the validated canonical inventory alongside the queued PRD/build source so final validation uses the same inventory that passed enqueue-time checks.
- Prefer a format that can represent `{ id, text, raw/sourceQuote, confidence, warnings }` without depending on the current simplistic queue-frontmatter parser for nested arrays. Candidate implementations are a hidden Markdown block in the queued PRD or a companion metadata file owned by the queue item.
- If a hidden Markdown block is used, it must be excluded from PRD prose shown to planner/validator prompts except where explicitly intended.

Decision 5: unknown resolution is a second-pass evidence collector.

- Run the resolver only when PRD validation passed, deterministic validation command evidence has no failures, at least one acceptance verdict is `unknown`, and there are zero `fail` verdicts.
- Provide the resolver only the unknown criteria, existing verdict evidence, deterministic command evidence, the implementation diff context, and permission to inspect files and run safe read-only comparison/test commands.
- The resolver may convert each unknown to `pass` or `fail`; it must not convert explicit failures to passes, waive criteria, mutate files, or alter the PRD.

Decision 6: final gate stays fail-closed.

- After resolver output is merged, `acceptanceEventPassed(...)` remains the single acceptance pass predicate.
- Any unresolved unknown, resolver crash, malformed resolver output, unsafe command request, dirty worktree, or contradictory evidence keeps the build failed.
- Existing acceptance conflict waiver policy remains separate and explicit.

### Code impact

Likely engine targets:

- New `packages/engine/src/agents/acceptance-criteria-extractor.ts` and `packages/engine/src/prompts/acceptance-criteria-extractor.md`, or equivalent structured-output helper, for enqueue-time LLM extraction from full PRD/build source.
- `packages/engine/src/validation/acceptance-criteria.ts`: add structured inventory schema/types, deterministic validation, source-grounding checks, stable ID assignment, serialization/deserialization helpers, and keep matching/synthesis semantics strict.
- `packages/engine/src/eforge.ts`: after formatting and before queue write, run the AC extraction agent, validate its structured output, persist the canonical inventory with the queued PRD, and load the persisted inventory when constructing `expectedAcceptanceCriteria` for PRD builds.
- `packages/engine/src/prd-queue.ts`: support whatever persistence mechanism is chosen for the inventory if it affects queue read/write behavior. Avoid nested frontmatter unless the parser/schema is intentionally upgraded.
- `packages/input/src/acceptance-criteria-quality.ts`: continue to enforce item quality for session-plan/playbook readiness. Update only if shared quality rules or small section-detection sanity checks need alignment.
- `packages/engine/src/agents/prd-validator.ts` and `packages/engine/src/prompts/prd-validator.md`: preserve existing ID-based verdict behavior and consume the persisted canonical inventory.
- New `packages/engine/src/agents/acceptance-unknown-resolver.ts` and `packages/engine/src/prompts/acceptance-unknown-resolver.md`, or an equivalent small helper next to `prd-validator.ts`, for read-only second-pass evidence collection.
- `packages/engine/src/orchestrator/phases.ts`: insert the resolver path after initial `acceptance_validation:complete` processing when trigger conditions are met and before final state failure is set.
- `packages/engine/src/orchestrator/acceptance-conflict-policy.ts`: keep final acceptance pass calculation centralized and ensure resolver output still flows through existing conflict/waiver policy.
- `packages/engine/src/config.ts`, `packages/engine/src/events.ts`, `packages/client/src/events.schemas.ts`, `packages/client/src/event-registry.ts`, and `packages/client/src/api-version-const.ts` only if new agent roles or wire-visible event variants are introduced.

Likely tests:

- Add extractor structured-output parsing tests for valid inventories, malformed JSON, empty criteria, duplicate criteria, missing grounding, low confidence, grouping labels, bare commands, and vague criteria.
- Add enqueue tests proving invalid extractor output rejects before queue write.
- Add enqueue/build integration tests proving the queued/persisted inventory is what final validation receives.
- Remove or rewrite tests that expect parser-based PRD extraction as a build fallback; new tests should assert that queued PRDs without persisted inventories fail closed.
- Extend `test/prd-validate-phase.test.ts` with resolver trigger, no-trigger-on-fail, no-trigger-when-validation-failed, resolver-pass, resolver-fail, resolver-unknown, dirty-worktree, and resolver-crash cases.
- Extend `test/prd-validator.test.ts` or add focused resolver parsing tests for malformed, missing, and empty evidence.

### Documentation impact

Documentation likely affected:

- `docs/roadmap.md` should not grow implementation details; this work aligns with existing Honest gates roadmap language and may need no roadmap edit after shipping.
- User-facing docs that describe PRD/build-source acceptance criteria should mention that AC headings may be canonicalized and that malformed/vague criteria are rejected before enqueue. Locate exact files with `rg "Acceptance Criteria|acceptance criteria|PRD" docs README.md web packages -g '*.md' -g '*.mdx'` during implementation.
- Generated reference docs must be regenerated if event schemas, config schemas, or CLI/API behavior changes. Run `pnpm docs:generate` or the repository's documented docs check if those surfaces are touched.
- If the resolver emits new event variants, update event reference text/rendering through `packages/client/src/event-registry.ts` and generated docs.

### Risks and mitigations

- Risk: LLM extraction hallucinates criteria or rewrites intent. Mitigation: require source quotes/grounding, confidence, deterministic schema validation, duplicate checks, quality checks, and fail-closed handling for ungrounded or low-confidence criteria.
- Risk: abandoning parser-primary extraction misses obvious formatting errors. Mitigation: keep deterministic quality analysis on the extracted inventory and optionally compare against simple Markdown parsing for diagnostics.
- Risk: hidden/persisted inventory leaks into planner or validator prose and creates duplicate criteria. Mitigation: define explicit render/strip helpers and test that prompts receive the intended PRD content and exactly one expected inventory.
- Risk: adding nested AC inventory to queue frontmatter exceeds the current simple frontmatter parser. Mitigation: avoid nested queue frontmatter unless the parser/schema is deliberately upgraded and covered by tests.
- Risk: extractor and formatter interact poorly. Mitigation: define whether extraction runs on raw source, formatted source, or both; record source provenance; fail closed if formatting removes or changes criteria materially.
- Risk: resolver becomes a second full validator and increases latency/cost. Mitigation: trigger only for unknown-only failures after deterministic gates pass and pass only unknown criteria plus bounded evidence.
- Risk: read-only resolver accidentally mutates files through coding tools. Mitigation: prompt forbids mutation, run in merge worktree, inspect dirty files after resolver if tools are allowed, and fail closed if dirty files appear.
- Risk: multiple `acceptance_validation:complete` events confuse consumers. Mitigation: either make the final event clearly latest and verify event-history/status consumers use the final verdict, or add explicit resolver event variants with client schema updates.
- Risk: existing queued PRDs without inventories fail after this change. Mitigation: accept the break as intentional kernel simplification and return an actionable re-enqueue error.

### Assumptions and validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| Parser-primary PRD extraction is brittle and should not be the semantic source of truth. | Current extractor in `packages/engine/src/validation/acceptance-criteria.ts` compares headings to exact names and already needs edge-case expansion for numbered headings. User explicitly challenged parser-primary design and then rejected legacy fallback code. | high | low | Add plan tests around LLM structured extraction and fail-closed behavior when persisted inventory is missing. | The implementation could keep accumulating Markdown edge cases instead of solving extraction robustly. |
| LLM structured extraction can be made safe enough for enqueue if deterministic validation is strict. | Existing agent patterns already parse structured output in `packages/engine/src/agents/prd-validator.ts`; AC quality checks already reject vague/grouped/bare-command criteria. | medium | medium | Prototype extractor parsing with malformed-output tests and grounded-source requirements. | Hallucinated or rewritten criteria could become the persisted validation target. |
| Source grounding is practical to validate deterministically. | The PRD source is available at enqueue/build time, but exact span offsets are not currently modeled. | medium | medium | Start with required source quotes that must appear verbatim or near-verbatim in the source; consider spans only if needed. | Weak grounding could allow invented criteria; overly strict grounding could reject legitimate paraphrases. |
| Persisting inventory in queue frontmatter may be awkward because the parser is simple. | `packages/engine/src/prd-queue.ts` frontmatter parser handles simple key values and inline arrays, and the schema has no AC inventory field. | high | low | Inspect `enqueuePrd` serialization and choose hidden block or companion metadata file. | A nested frontmatter design could create parser drift and invalid queued PRDs. |
| Re-emitting `acceptance_validation:complete` may be acceptable for final resolver output. | Existing event history searches for latest acceptance event in recovery paths, but not all consumers were exhaustively audited. | medium | medium | Search all consumers of `acceptance_validation:complete` and add tests for multiple events in one run. | Console/status/recovery could display the initial failure instead of the resolver-adjusted verdict. |
| The resolver can safely run with coding tools in read-only mode if guarded. | Existing PRD validator can read summarized files and the resolver would need similar inspection; no existing read-only tool sandbox was confirmed. | medium | medium | Inspect harness/tool controls and add dirty-worktree guard after resolver. | Resolver could accidentally mutate the merge worktree and invalidate build provenance. |
| No user-facing Pi/Claude integration changes are required. | Planned work is engine/internal validation flow; no new commands or MCP tools are currently proposed. | medium | low | Re-evaluate if implementation adds config knobs, commands, or user-facing events. | Integration packages could drift if a user-facing behavior change is introduced without updates. |

### Profile signal

Recommended profile: **Excursion**.

Rationale: this is cross-cutting engine work, but a single cohesive plan can cover the lifecycle from LLM structured extraction through final acceptance validation. The work likely touches multiple files and tests, yet it does not require independently delegated subsystem planning. Use Expedition only if implementation discovers that event/schema migration, queue metadata storage, extractor agent wiring, and resolver agent wiring must be split into independently planned modules.

## Scope

### In scope

- Treat acceptance criteria as a lifecycle artifact that begins at enqueue/compile and is consumed by final validation.
- Make LLM structured extraction/canonicalization the primary PRD acceptance-criteria extraction path at enqueue time.
- Require the extractor to return a structured inventory with flat criteria, source quotes or source-grounding references, confidence, and warnings.
- Use deterministic code to validate the extractor output, not to semantically parse arbitrary Markdown as the source of truth.
- Persist the validated canonical criteria inventory with the queued/build source so final validation consumes the same inventory that passed enqueue-time checks.
- Preserve fail-closed semantics when extraction is empty, malformed, ungrounded, low-confidence, quality-invalid, or contradictory.
- Do not keep a compatibility fallback for queued PRDs that lack a persisted canonical inventory; fail closed instead so the kernel stays lean.
- Add a targeted read-only unknown-resolution pass that runs only after deterministic validation passes, PRD validation passes, and acceptance verdicts contain `unknown` verdicts but no `fail` verdicts.
- Keep explicit `fail` verdicts terminal unless covered by the existing explicit waiver/conflict policy.

### Out of scope

- Do not grow a complex Markdown parser to understand every PRD shape.
- Do not add a user-facing approval workflow or console UI for manually editing AC inventories in this slice.
- Do not loosen the AC quality gate to accept grouping labels, bare commands, or vague criteria.
- Do not make final acceptance validation optimistic; unresolved unknowns still fail.
- Do not move scheduling, approvals, or richer workflow orchestration into the engine.

## Acceptance Criteria

- Enqueue runs an LLM structured acceptance-criteria extractor for PRD builds before writing the queued PRD.
- The extractor output parser rejects malformed JSON and emits `enqueue:failed` before queue write.
- The extractor output parser rejects an empty criteria inventory when `allowNoAcceptanceCriteria` is not waived.
- The extractor output parser rejects any criterion without non-empty source grounding or a source quote.
- The extractor output parser rejects any criterion with confidence below the implemented acceptance threshold.
- The extractor output parser rejects grouping-label criteria such as `Tests cover:`.
- The extractor output parser rejects bare command criteria such as `` `pnpm type-check`. ``.
- The extractor output parser rejects vague criteria such as `Works correctly.`.
- The engine assigns stable `ac-###` IDs to the validated canonical inventory before persistence.
- A queued PRD build reads the persisted canonical acceptance criteria inventory instead of using Markdown parsing as the primary PRD extraction path.
- Final PRD validation receives stable `ac-###` IDs from the persisted canonical inventory.
- A queued PRD build without a persisted canonical acceptance criteria inventory fails closed with an actionable re-enqueue error.
- The unknown-resolution pass runs when post-merge validation exits 0, PRD validation passes, at least one expected acceptance criterion has verdict `unknown`, and zero expected acceptance criteria have verdict `fail`.
- The unknown-resolution pass does not run when any expected acceptance criterion has verdict `fail`.
- The unknown-resolution pass does not run when any deterministic validation command has a non-zero exit code or timeout evidence.
- The unknown-resolution pass can convert an unknown criterion to `pass` only when it records non-empty file or command evidence for that criterion.
- The build remains failed when the unknown-resolution pass leaves any expected acceptance criterion with verdict `unknown`.
- The build remains failed when the unknown-resolution pass returns malformed output or produces no output.
- The merge worktree has zero dirty tracked or untracked files after the unknown-resolution pass completes.
- `pnpm type-check` exits 0.
- The implemented targeted Vitest command for acceptance-criteria extraction and PRD validation exits 0.
- `pnpm maintainability:check` exits 0.
