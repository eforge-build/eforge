---
title: Planner source localization repair loop
created: 2026-07-01
---

# Planner source localization repair loop

## Executive Summary

Add a bounded source-localization layer to the planner compiler so broad evidence needs are resolved to concrete repository owners before atom planning, then repair source/localization reduce gaps inside the compile loop instead of emitting vague candidate-reduce-gap implementation plans. The work is scoped to planner-compiler internals, source evidence contracts/materialization, residue gating, tests, and architecture docs/comments; atom and reducer agents remain tool-less, and wrapper/daemon workflow UX is out of scope except for any typed events needed for observability. Validation should combine focused unit tests, compiler integration regressions, type-checking, and maintainability checks; confidence is moderate-high because the current compiler already has source inventory, shared brief, evidence materialization, atom map, reduce, and residue seams to extend.

## Problem Statement

The bounded planner compiler currently materializes only exact actionable source paths already present in atom acceptance criteria. Broad subsystem/interface evidence needs, directory references, and shared/global inventory hints can reach reducers as gaps such as missing owner paths or missing contract, entrypoint, configuration, or consumer-surface evidence. Because atom planners and reducers intentionally run with `tools: 'none'`, reducers cannot inspect the repository to fill those gaps. Today, `residue-synthesis.ts` can turn reduce gaps into residue candidates and `plan-artifact-synthesis.ts` can turn those into executable modules, which risks scheduling meta-planning/self-repair branches instead of product-scoped implementation work.

This session should make source ownership deterministic before atom planning while remaining repository-agnostic. Localization must derive concrete owner candidates from the target workspace, tracked files, manifests, conventions, explicit PRD paths, and optional project hints rather than assuming the eforge repository layout or first-party package names. The desired behavior is fail-closed and no-human-in-the-loop: either localize concrete owners, rerun the affected bounded planning stages, and synthesize product plans, or finish incomplete/failed with machine-readable diagnostics rather than vague build plans.

## Scope

In scope:

- Add a first-class source-localization phase between source inventory/atom graph derivation and source evidence materialization.
- Build deterministic, bounded, git/workspace-aware repository indexing that excludes vendor, dependency, build, runtime, cache, and generated planning artifacts.
- Localize literal file paths, actionable directories, broad subsystem hints, interface/contract keys, symbols/keywords, docs/test surfaces, package manifests, entrypoints, configuration, command/route/API/UI surfaces, extension-like surfaces, and consumer-facing surfaces to ranked candidate files using the target repository structure.
- Define a structured source-localization record/bundle contract and feed localized evidence into shared-brief ownership, materialization, atom tasks, coverage, and diagnostics.
- Assign global source inventory candidates to relevant atoms even when individual acceptance criteria omit explicit paths.
- Add an internal compile repair loop for reducer gaps classified as source/localization gaps: localize missing evidence, rematerialize evidence, rerun affected atom planners, rerun affected reducers, then synthesize final product plans.
- Gate residue so source/localization reduce gaps are not directly converted into executable candidate-reduce-gap plans unless they have concrete localized owners and product-scoped outputs.
- Add regression tests using synthetic non-eforge repositories as primary generic-behavior proof, with the current eforge repository used only as an additional fixture for this implementation.
- Update planner-compiler architecture comments/docs to describe repository-agnostic localization responsibilities and any project-specific hint extension points.

Out of scope:

- Hard-coding the eforge repository layout, first-party package names, or product-specific surface names into generic localization rules.
- Giving atom planners or reducers general repository access.
- Turning the engine into a general planner self-repair/workflow orchestrator.
- Adding user-facing scheduler/daemon/workstation UX beyond typed compiler diagnostics/events if needed.
- Broad unbounded semantic search, mutation-capable tools, or generated artifact mining as localization evidence.

## Acceptance Criteria

- Source localization runs before bounded atom planning and produces concrete candidate owner files for PRD evidence needs.
- Localization handles literal paths, actionable directories, broad subsystem hints, interface/contract keys, symbols/keywords, docs, tests, manifests, entrypoints, configuration files, command/route/API/UI surfaces, extension-like surfaces, and consumer-facing surfaces without hard-coding any first-party eforge package or layout names.
- Repository indexing is deterministic, bounded, git/workspace aware, and excludes common vendor/dependency/build/runtime/generated locations such as `node_modules`, `dist`, `build`, `coverage`, caches, `.git`, `.eforge`, `.decomposition`, generated planner outputs such as `planner-inspection-handoff.json`, `output.json`, `graph.json`, and `orchestration.yaml`, plus project-configurable ignore patterns.
- Directory evidence expands to a bounded ranked file set instead of remaining only a non-materialized directory status.
- Interface/contract mappings are repository-agnostic: they are derived from discovered manifests, exported package entrypoints, registry/config files, handler/schema/contract modules, naming conventions, keyword/symbol matches, and optional project-provided hints. Eforge-specific concepts may appear in tests as fixture data but must not be baked into default localization rules.
- Global source inventory candidates are assigned to relevant atoms when individual criteria do not contain explicit evidence paths.
- A `SourceLocalizationRecord`/bundle-equivalent contract records need id, kind, query, status, candidate files, confidence, reason, linked criteria/aspects, and any assigned atoms.
- Materialized source evidence given to atom planners includes localized file excerpts, ownership rationale, and byte/file-budget accounting.
- Atom planners and reducers remain `tools: 'none'` by default; any optional source-localizer agent is a dedicated bounded read-only pass that submits structured localization records, not plans.
- Source/localization reduce gaps trigger automatic bounded repair: localize missing evidence, rematerialize evidence, rerun affected atom planners, rerun affected reducers, then synthesize product plans.
- Source/localization reduce gaps are not directly emitted as executable candidate-reduce-gap build plans.
- Buildable residue is allowed only with concrete localized owners, product-scoped outputs, and validation tied to original PRD criteria rather than generic gap representation.
- Exhausted repair attempts finish incomplete/failed with explicit machine-readable diagnostics and coverage transparency.
- Regression coverage proves synthetic repositories with non-eforge layouts can localize broad interface/subsystem owners without candidate-reduce-gap plans, and that current eforge route/client/extension surfaces are handled as fixtures rather than default assumptions.
- Regression coverage proves generated planning artifacts are excluded from localization and heatmaps, reducers stay tool-less, localization occurs before atom/reduce planning, and arbitrary package/surface names can be localized through repository-derived signals.
- Planner-compiler docs/comments explain source inventory, source localization, atom planning, reducers, residue, repair-loop responsibilities, repository-agnostic default behavior, and any optional project-specific hint mechanism.

## Code Impact

Likely engine files to extend or add:

- `packages/engine/src/planner-compiler/compiler-runner.ts`: insert localization before evidence materialization and orchestrate bounded repair attempts.
- New likely modules under `packages/engine/src/planner-compiler/`: `source-localization-contracts.ts`, `source-localization.ts`, `repository-index.ts`, and optionally `source-localizer-agent.ts`.
- `source-inventory.ts`, `source-analysis.ts`, `evidence-hygiene.ts`: enrich evidence needs, generic interface/contract keys, subsystem/surface inference, generated-artifact classification, and project-configurable ignore/hint handling without embedding first-party eforge source-layout assumptions.
- `shared-brief.ts` / `shared-brief-contracts.ts`: derive ownership from localized candidate files, not only exact evidence paths.
- `source-evidence-materialization.ts` / `source-evidence-contracts.ts`: materialize localized files with rationale/status and preserve budget validation.
- `atom-graph.ts`, `atom-planning-contracts.ts`, `atom-map-runner.ts`, `atom-planner-agent.ts`: carry localized evidence to atom tasks/prompts while preserving tool-less execution.
- `reduce-contracts.ts`, `reduce-runner.ts`, `reducer-agent.ts`: classify source/localization gaps in a structured way without granting reducer tools.
- `residue-synthesis.ts`, `residue-contracts.ts`, `plan-artifact-synthesis.ts`: prevent vague source/localization gaps from becoming executable modules and require concrete owners for buildable residue.
- `orchestration-events.ts` and `packages/client/src/events/variants/planning-map-reduce.ts` only if new typed localization/repair events are needed.
- `packages/engine/src/planner-compiler.ts`: export new public/internal contracts used by tests.

Tests to add or update:

- Add synthetic temp-workspace coverage with arbitrary package names, non-eforge directories, and representative manifest/entrypoint/contract/docs/test surfaces.
- `test/planning-source-evidence.test.ts`
- `test/planning-compiler-runner.test.ts`
- `test/planning-compiler-runtime-hardening.test.ts`
- `test/planning-residue-synthesis.test.ts`
- `test/planning-plan-artifact-synthesis.test.ts`
- Potential new `test/planning-source-localization.test.ts` and `test/planning-compiler-repair-loop.test.ts`.
- Current eforge-specific route/client/extension cases may remain as implementation regressions, but should be expressed as fixtures proving the generic resolver works on this repository, not as the default mapping contract.

Documentation/code-comment impact:

- Update planner-compiler comments or lightweight docs to describe source inventory, source localization, evidence materialization, atom planning, reducers, residue, repair-loop responsibilities, repository-agnostic defaults, and optional project-specific hint/configuration seams.
- If public reference docs are affected by new exports/events, update docs generation inputs and run `pnpm docs:check`.

Follow repository maintainability policy: keep new implementation files under 600 lines, add region markers for large files, use bounded exact edits in oversized files, and avoid duplicating client-owned event/API wire shapes.

## Design Decisions

- Pipeline order: `deriveSourceInventory` -> `derivePlanningAtomGraph` -> `deriveSourceLocalizationBundle` -> `deriveSharedPlanningBrief`/ownership -> `materializePlanningSourceEvidence` -> atom map -> reduce -> repair classification -> residue/artifact synthesis.
- Deterministic repository-agnostic localization first: use `git ls-files`/workspace-aware traversal, stable sorting, fixed default excludes for vendor/build/runtime/generated artifacts, repository manifests, explicit PRD paths, naming conventions, symbol/keyword hits, and optional project hints. Do not infer source ownership from eforge-specific package names or directory layouts.
- Contract shape: model localization needs separately from materialized evidence. Records should include need id, kind, query, status, candidate files with ranks/confidence/reasons, linked criterion/aspect ids, assigned atom ids, budget notes, and diagnostics.
- Surface resolution model: prefer generic resolvers for manifests, package/workspace entrypoints, exports, config/registry files, schemas/contracts, route/command/handler patterns, UI/docs/tests, and consumer-facing artifacts. Project-specific mappings should be data-driven/configurable hints or test fixtures, not hard-coded default rules.
- Interface mapping: maintain a small deterministic vocabulary for generic concepts such as `event`, `api`, `route`, `schema`, `config`, `plugin`, `extension`, `command`, `ui`, `docs`, and `test`; resolve them through discovered repository files and conventions rather than through first-party eforge paths.
- Directory expansion: expand actionable directories to a capped ranked set of likely source/test/docs files; treat broad roots as low-confidence or excluded unless narrowed by subsystem/interface context.
- Atom assignment: merge criterion-level needs with global source inventory candidates, assign candidates to atoms by criterion/aspect/subsystem/interface overlap, and preserve shared-primary ownership for shared evidence.
- Optional agent pass: if needed, introduce a dedicated `source-localizer` role/pass using only bounded read-only tools and a `submit_source_localization_output` custom tool. It must submit localization records only, never implementation plans, and should have explicit max searches, reads, bytes, allowed roots, and result limits.
- Repair loop: classify reducer gaps with source/localization signals (gap ids, source ids, aspect sources, or structured issue kind), then rerun only affected localization/materialization/atom/reduce work. Cap attempts and record diagnostics on exhaustion.
- Residue policy: source/localization gaps are repair inputs, not executable plans. Residue synthesis may emit buildable work only when localized concrete owners and product-scoped validation are present.

Key risks to manage in implementation:

- Over-selecting files can dilute prompt budgets; use deterministic ranking, per-need caps, and excerpt budgets.
- Generic heuristics can underfit real repositories; prove behavior with synthetic workspaces and allow bounded project-specific hints where necessary.
- Project-specific mappings can go stale; keep them data-driven, optional, and covered by tests if introduced.
- Repair loops can become expensive; rerun only affected atoms and cap attempts.
- Optional agent localization can add nondeterminism; keep it conditional, read-only, structured, and bounded.

## Assumptions And Validation

Validation approach:

- Add pure unit tests for repository indexing, default and configurable exclude rules, generic interface/contract vocabulary, manifest/entrypoint/surface resolution, directory expansion, candidate ranking, and localization record validation.
- Add temp-workspace integration tests that use real files and `StubHarness`, consistent with the no-mocks test policy, with arbitrary non-eforge package names and layouts as the primary proof of generic behavior.
- Add current-repository regressions for relevant eforge surfaces only as fixtures demonstrating that the generic resolver handles this implementation repo.
- Assert atom planner and reducer harness calls remain `tools: 'none'`; if a source-localizer pass is added, assert its read-only bounds and structured submission contract.
- Add compiler-runner regressions for broad subsystem/interface PRDs, contract/entrypoint/surface localization, generated artifact exclusion, and bounded repair of source/localization reduce gaps.
- Add residue/artifact synthesis tests proving unresolved source/localization gaps do not become vague executable `candidate-reduce-gap` plans.
- Add regression checks that arbitrary package/surface names localize through repository-derived signals and that hard-coded first-party eforge source paths are not required for success.
- Run targeted tests such as `pnpm test -- test/planning-source-evidence.test.ts test/planning-compiler-runner.test.ts test/planning-compiler-runtime-hardening.test.ts test/planning-residue-synthesis.test.ts`, then `pnpm test`, `pnpm type-check`, and `pnpm maintainability:check`.

Assumptions:

- Deterministic localization should satisfy most required cases with repository-derived indexing, generic surface resolvers, and optional project-provided hints.
- Eforge-generated runtime/planning artifacts may be excluded by default when present because they are tool outputs, but source-owner inference must not assume the eforge implementation repository layout.
- Repair attempts should be intentionally low-budget; exhausted repair is an honest incomplete/failed compiler outcome, not a reason to schedule meta-planning work.
- No migration of existing plan artifacts is required.