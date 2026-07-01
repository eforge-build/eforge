---
id: plan-01-source-localization-foundation
name: Source Localization Foundation
branch: planner-source-localization-repair-loop/plan-01-source-localization-foundation
agents:
  builder:
    effort: high
    rationale: Introduces new repository indexing and ranking contracts that must
      stay deterministic, bounded, and repository-agnostic.
  reviewer:
    effort: high
    rationale: Review must check path traversal, subprocess usage, ignore rules, and
      absence of hard-coded first-party layouts.
---

# Source Localization Foundation

## Architecture Context

The planner compiler already derives a source inventory and atom graph, but evidence handling is path-centric and the current inventory helpers contain repository-shaped assumptions. This plan adds the deterministic source-localization layer and repository index that later plans consume. It does not change atom/reducer execution or residue behavior.

The foundation must remain repository-agnostic: default rules may use generic concepts such as manifests, entrypoints, schema, route, command, UI, docs, test, plugin, extension, and config, but must not bake in eforge package names, first-party workspace names, or the current repository layout.

## Implementation

### Overview

Create the localization contracts, repository index, and deterministic resolver. The resolver turns evidence needs from PRD criteria, inventory-level hints, directory references, generic interface keys, symbols, keywords, manifests, entrypoints, docs, tests, configuration, command/API/UI surfaces, extension-like surfaces, and consumer-facing surfaces into ranked candidate files with confidence and diagnostics.

### Key Decisions

1. Use an in-process deterministic pass for the first implementation. Do not add a source-localizer agent unless a later change proves deterministic indexing cannot satisfy a case.
2. Prefer `git ls-files` for indexed repositories and fall back to bounded workspace traversal when git metadata is unavailable. Normalize every candidate path to a POSIX path relative to `cwd`.
3. Keep default excludes broad and generic: dependency/vendor/build/runtime/cache directories, `.git`, `.eforge`, `.decomposition`, and generated planner artifacts including `planner-inspection-handoff.json`, `output.json`, `graph.json`, and `orchestration.yaml`.
4. Model optional project hints as data on the localization input contract, not as default code paths tied to this repository.
5. Replace hard-coded source inventory package/layout assumptions with generic token, manifest, heading, and path-segment extraction.

## Scope

### In Scope

- Add `SourceLocalizationRecord` and bundle contracts with need id, kind, query, status, candidate files, confidence, reason, linked criteria/aspects, assigned atoms, diagnostics, and budget notes.
- Add deterministic repository indexing with default ignores, configurable ignore globs/prefixes, symlink/root checks, file count limits, and text scan byte limits.
- Add candidate ranking for literal files, directories, subsystem hints, interface/contract keys, symbols/keywords, docs/tests, manifests, entrypoints, configuration files, command/route/API/UI surfaces, extension-like surfaces, and consumer-facing surfaces.
- Assign global source inventory candidates to atoms by criterion/aspect/subsystem/interface overlap even when individual criteria omit explicit paths.
- Update source inventory and evidence hygiene helpers so generic behavior does not depend on eforge-specific roots or first-party package names.
- Add synthetic temp-workspace tests that use arbitrary non-eforge package names and real files.

### Out of Scope

- Wiring localized evidence into atom prompts or materialization; plan 02 owns that.
- Repair-loop orchestration and residue gating; plan 03 owns that.
- Daemon, scheduler, workstation, or user-facing UX.
- Mutation-capable tools or unbounded semantic search.

## Files

### Create

- `packages/engine/src/planner-compiler/repository-index.ts` — deterministic git/workspace-aware file discovery, default and configurable excludes, manifest/entrypoint detection, bounded content scanning, stable path sorting, and index diagnostics.
- `packages/engine/src/planner-compiler/source-localization-contracts.ts` — localization need, candidate, record, bundle, hint, limits, diagnostic, and validation types.
- `packages/engine/src/planner-compiler/source-localization.ts` — derives localization needs from inventory/atom graph/global hints, resolves ranked candidate files through the repository index, expands actionable directories, and assigns records to atom ids.
- `test/planning-source-localization.test.ts` — unit and temp-workspace coverage for repository indexing, excludes, ranking, generic surface detection, configurable ignores, generated artifact filtering, and atom assignment.
- `test/helpers/planning-temp-workspace.ts` — shared test helper for creating real temp repositories/files for planner compiler tests if no equivalent helper already exists.

### Modify

- `packages/engine/src/planner-compiler/source-inventory.ts` — enrich inventory output with localization-ready global needs and generic interface/subsystem hints; remove first-party path/package assumptions from evidence extraction.
- `packages/engine/src/planner-compiler/source-analysis.ts` — replace fixed first-party subsystem lists and eforge-specific interface patterns with generic vocabulary and text-derived surface keys.
- `packages/engine/src/planner-compiler/evidence-hygiene.ts` — generalize path extraction/classification, generated artifact detection, directory classification, and non-actionable evidence handling.
- `packages/engine/src/planner-compiler.ts` — export the new localization/index contracts and deterministic derivation helpers for tests and internal consumers.
- `test/planning-compiler-runtime-hardening.test.ts` — adjust existing generated-artifact and broad-evidence assumptions that depend on old path-only behavior.

## Implementation Notes

- Define a bounded default limits object, for example max indexed files, max candidate files per need, max directory expansion files, max bytes per scanned file, and max total scanned bytes. Tests must assert these limits are represented in bundle diagnostics.
- Candidate reasons must identify the repository-derived signal used, such as literal path match, directory expansion, manifest export, entrypoint file, config filename, handler/schema/contract naming, docs/test surface, keyword hit, or project hint.
- Directory expansion must return a capped ranked file list. Broad roots without a narrowing interface/subsystem context must be low confidence or excluded with diagnostics.
- Generated planner artifacts and ignored paths must not appear in repository index files, candidate records, heatmap inputs, or directory expansions.
- Keep each new implementation file under 600 lines. If resolver logic grows, split ranking/scoring helpers into another focused module rather than creating an oversized file.

## Verification

- [ ] `deriveRepositoryIndex` returns stable relative paths and excludes `node_modules/`, `dist/`, `build/`, `coverage/`, caches, `.git/`, `.eforge/`, `.decomposition/`, `planner-inspection-handoff.json`, `output.json`, `graph.json`, and `orchestration.yaml` in tests.
- [ ] A synthetic repository with arbitrary package names localizes manifest entrypoints, contract/schema modules, command handlers, route/API files, UI files, docs, and tests without any eforge path in the default resolver.
- [ ] Directory evidence expands to a capped ranked file list with candidate reasons and budget diagnostics.
- [ ] Global source inventory candidates receive assigned atom ids when matching atom criterion ids, subsystem hints, or interface keys.
- [ ] Configurable ignore patterns and project hints alter localization records only through the new hint/input contract.
- [ ] `pnpm type-check` exits 0 for the new contracts and exports.