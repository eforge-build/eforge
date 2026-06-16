---
title: Mature eforge-plan with annotation revisions, local roadmaps, and installable packaging
created: 2026-06-15
---

# Mature eforge-plan with annotation revisions, local roadmaps, and installable packaging

## Problem / Motivation

Eforge-plan is becoming the first-party thinking workstation, but three product-maturity gaps keep it from feeling complete and portable:

1. Plan revision UX lacks first-class annotations. Users can revise with AI, but cannot select text or a rendered block in a session plan, accumulate durable annotations, and launch an AI revision from the collected annotation set.
2. Roadmap steering is too project-file-centric. Current evidence points to hardcoded `docs/roadmap.md` assumptions in planner context, curation, recommendation refresh, and recommendation freshness. The desired model is local-first: shared project roadmap sources may provide context, but eforge-plan should manage a developer-local focus roadmap that can steer recommendations without PR ceremony.
3. Eforge-plan is not an installable first-party extension package. It currently lives under `eforge/extensions/eforge-plan` and is monorepo-coupled through relative runtime imports, so other projects cannot cleanly install it with existing `eforge extension install/update` workflows.

This session should mature eforge-plan across planning UX, roadmap/recommendation workflows, and extension portability while preserving engine/wrapper boundaries and avoiding hardcoded host-specific behavior.

## Goal

Deliver a mature, portable eforge-plan workflow with durable annotation-driven AI revisions, configurable local-first roadmap steering, and first-party installable extension packaging.

## Approach

### Annotation and revision design

- Treat annotation targets as semantic/quote-context records rather than DOM-offset records.
- Store annotation target kind, dimension, captured text, and prefix/suffix context so annotations remain useful after plan edits.
- Keep annotation-driven revision as an extension-owned input to the existing durable revision-turn flow.
- Reuse the existing one-running-turn lock, auto-apply semantics, and idempotent apply behavior.
- Snapshot annotations into revision turns so later annotation edits do not change what a historical AI revision saw.
- Resolve annotations only after successful patch-bearing auto-apply.
- Do not resolve annotations for answer-only, needs-input, failed, or cancelled turns.

### Roadmap design

- Model roadmaps as multiple sources with metadata, not as a single path.
- Distinguish local steering from shared context in payloads and UI.
- Default local focus roadmap ownership to extension-private local storage.
- Treat shared project files as read-only context unless the user explicitly configures shared management.
- Label discovered conventional sources separately from configured sources to avoid making `docs/roadmap.md` canonical by accident.
- Use bounded, agent-friendly extension actions for roadmap operations.
- Avoid unbounded payloads and host-specific command assumptions.

### Packaging design

- Package eforge-plan as a first-party extension that consumes public package APIs.
- Create a locally packable or publishable first-party package such as `@eforge-build/eforge-plan`.
- Include a valid `eforge.extension` manifest and compiled entrypoint.
- Replace monorepo-relative runtime imports with public package imports.
- Promote source-only APIs to stable package entrypoints before eforge-plan depends on them.
- Keep the engine boundary clean: eforge-plan may author input artifacts and provide workstation UX, while the engine continues to consume normalized build/planning sources and emit typed events.

### Implementation areas to inspect and modify

- `eforge/extensions/eforge-plan/` plan revision store/model and revision turn source assembly.
- `eforge/extensions/eforge-plan/` workstation assets for the Plans detail view and revision controls.
- `eforge/extensions/eforge-plan/` extension action registrations for annotation and roadmap APIs.
- `eforge/extensions/eforge-plan/` backlog curation and planner orchestration source builders.
- `eforge/extensions/eforge-plan/` recommendation refresh/status/fingerprint code.
- `eforge/extensions/eforge-plan/backlog-curation-source.ts`.
- `eforge/extensions/eforge-plan/planner-orchestration.ts`.
- `eforge/extensions/eforge-plan/recommendation-status.ts`.
- Existing schemas that expose `roadmapEvidence` as a single `{ path: 'docs/roadmap.md', exists, headings, excerpts }` object.
- Add a package workspace layout, likely `packages/eforge-plan`, or create a packaging build around the existing extension source.
- Replace relative runtime imports from `../../../packages/.../src/...` with `@eforge-build/extension-sdk`, `@eforge-build/client`, `@eforge-build/input`, and other stable public package entrypoints.
- Update package export maps where eforge-plan currently needs source-only APIs.
- Add or copy workstation assets into package `files` output.
- Ensure release/publish scripts include the package or clearly document independent release.
- Add eforge-plan README/package docs for annotation revisions, roadmap management, install/update/trust/reload, scope selection, storage, and removal.
- Update first-party extension docs if installable first-party packages are documented centrally.

### Maintainability constraints

- Keep new implementation files under 600 lines.
- Keep new tests under 1,200 lines.
- Use bounded edits for existing oversized files.
- Preserve route and wire-shape ownership in `@eforge-build/client`.
- Do not inline daemon routes.
- Do not re-declare shared wire shapes.

### Assumptions

- The current plan revision auto-apply flow is landed and should be reused rather than replaced.
- Eforge-plan private storage can be safely extended with annotations and roadmap state through migrations/normalization.
- Existing extension package-management supports npm/local/tarball installs and `.eforge-install.json` update sidecars as described in the backlog evidence.
- It is acceptable to introduce new stable public exports from first-party packages when eforge-plan currently imports source paths.

### Validation plan

- Recheck whether annotation or packaging work has already shipped before implementing.
- Run targeted tests around revision storage migration, annotation actions, source text snapshotting, and auto-resolve behavior.
- Run UI tests for selection annotation, block/section fallback annotation, unresolved annotation rendering, sticky Revise with AI state, and roadmap editing/refresh paths.
- Run roadmap tests for explicit config, no-config discovery, missing sources, local roadmap mutation, conflict metadata, and recommendation freshness changes.
- Run packaging tests with a locally packed package installed into a fresh fixture project using existing extension install/update/trust/reload paths.
- Run repository gates before handoff: `pnpm test`, `pnpm type-check`, and `pnpm maintainability:check`.
- Include docs/reference checks if public docs or generated docs are changed.

### Risks and mitigations

- Scope risk: annotations, roadmap management, and packaging are each substantial. Mitigate by sequencing foundation first and splitting implementation if needed.
- Migration risk: existing revision indexes and recommendation sidecars may not match new schemas. Mitigate with normalization tests and backward-compatible readers.
- Fragile annotation target risk: DOM offsets may break after edits. Mitigate with quote/context targeting and clear fallback display when exact anchors cannot be restored.
- Roadmap authority risk: a local focus roadmap could be mistaken for a team roadmap. Mitigate with explicit source labels, docs, and no silent shared-file rewrites.
- Packaging portability risk: monorepo-relative imports may hide unstable APIs. Mitigate with an import audit and stable public exports before packaging.
- Trust/security risk: installed extensions are unsandboxed. Mitigate with clear README language, trust/retrust docs, package hashing coverage, and no surprise writes outside declared extension storage.
- Regression risk: existing manual revision flow, recommendation refresh, and extension install/update behavior may regress. Mitigate with focused regression tests and fresh-project install validation.

## Scope

### In scope

- Add annotation state and UI for flat session plans.
- Create annotations from selected text inside rendered plan sections using in-frame selection handling.
- Provide accessible block, section, and whole-plan annotation fallback controls.
- Persist annotations under eforge-plan private revision storage.
- Scope annotations to target sessions.
- Store durable targets with kind, dimension when available, selected/block text, and quote-style context.
- Show unresolved annotations with context, timestamps, edit/delete controls, and resolve/dismiss controls.
- Add a sticky annotation-driven Revise with AI control with count, optional steering text, and one-running-turn locking.
- Snapshot annotations and steering onto revision turns.
- Auto-resolve referenced annotations only after successful patch-bearing auto-apply.
- Add configurable roadmap management.
- Replace single-path `docs/roadmap.md` assumptions with a configurable roadmap context model.
- Support multiple shared/context sources plus a managed local focus roadmap.
- Store local focus roadmap in extension-owned local storage by default.
- Expose bounded extension actions for reading roadmap state, updating roadmap state, and refreshing recommendations.
- Add workstation UX for source status, local focus roadmap editing, and recommendation refresh after roadmap changes.
- Feed roadmap context into planner context, analyze-all curation, recommendation refresh, and recommendation freshness fingerprints.
- Package and publish eforge-plan.
- Create a locally packable/publishable first-party package such as `@eforge-build/eforge-plan` with a valid `eforge.extension` manifest and compiled entrypoint.
- Replace monorepo-relative runtime imports with public package imports.
- Export any currently source-only APIs through stable package entrypoints before depending on them.
- Include workstation assets required by the Console UI.
- Validate install, update, trust, reload, and removal-oriented docs using existing extension package-management semantics.

### Out of scope unless explicitly chosen as follow-up

- Rewriting committed shared project roadmap files automatically from recommendation refresh or analyze-all flows.
- Adding new daemon scheduling/orchestration features beyond extension actions and existing install/update mechanisms.
- Removing the built-in Console planning surface, unless already part of another active kernel-boundary item.
- Building a full collaborative/team roadmap workflow.
- Treating shared roadmap sources as anything other than context by default.

## Acceptance Criteria

- The rendered flat session plan view creates an annotation from selected text inside a plan section by using in-frame selection handling.
- Annotation creation from selected text does not depend on parent Console selection APIs.
- The rendered plan UI exposes an accessible fallback control that creates an annotation for a rendered block.
- The rendered plan UI exposes an accessible fallback control that creates an annotation for a section.
- The rendered plan UI exposes an accessible fallback control that creates an annotation for the whole plan.
- The revision store persists annotations under eforge-plan private revision storage.
- Each persisted annotation is scoped to a target session.
- Persisted annotations survive reloads.
- Revision storage normalization migrates existing revision indexes that do not contain annotations.
- Each annotation target records its target kind.
- Each annotation target records its dimension when a dimension is available.
- Each annotation target records selected text or block text.
- Each annotation target records quote-style context.
- Annotation targets remain useful after plan edits by using semantic target data and quote-style context.
- Annotation targets do not rely on DOM offsets as the only durable anchor.
- The plan view displays unresolved annotations.
- Each unresolved annotation displays target context.
- Each unresolved annotation displays stored timestamps.
- Each unresolved annotation has an edit control.
- Each unresolved annotation has a delete control.
- Each unresolved annotation has a resolve control.
- Each unresolved annotation has a dismiss control.
- A sticky annotation-driven Revise with AI control appears when unresolved annotations exist.
- The sticky annotation-driven Revise with AI control displays the unresolved annotation count.
- The sticky annotation-driven Revise with AI control accepts optional steering text.
- The sticky annotation-driven Revise with AI control is disabled while a revision turn is queued.
- The sticky annotation-driven Revise with AI control is disabled while a revision turn is running.
- Annotation-driven revisions snapshot the selected annotations onto the durable revision turn.
- Annotation-driven revisions snapshot the open annotations onto the durable revision turn.
- Annotation-driven revisions snapshot steering text onto the durable revision turn.
- Later annotation edits do not change the annotations captured by a historical revision turn.
- `buildPlanRevisionSourceText` includes structured annotations in the plan-revision-turn source context.
- `buildPlanRevisionSourceText` includes steering text in the plan-revision-turn source context.
- Successful patch-bearing auto-apply marks referenced annotations as resolved.
- Successful patch-bearing auto-apply sets `resolvedAt` on referenced annotations.
- Successful patch-bearing auto-apply sets `resolvedByTurnId` on referenced annotations.
- Answer-only revision turns leave referenced annotations unresolved.
- Needs-input revision turns leave referenced annotations unresolved.
- Failed revision turns leave referenced annotations unresolved.
- Cancelled revision turns leave referenced annotations unresolved.
- The existing manual Revise with AI prompt flow continues to work.
- The existing one-running-turn lock continues to work.
- Existing auto-apply semantics continue to work.
- Existing idempotent apply behavior continues to work.
- Planner context no longer treats `docs/roadmap.md` as the only canonical roadmap evidence path.
- Backlog curation no longer treats `docs/roadmap.md` as the only canonical roadmap evidence path.
- Recommendation refresh no longer treats `docs/roadmap.md` as the only canonical roadmap evidence path.
- Recommendation freshness no longer treats `docs/roadmap.md` as the only canonical roadmap evidence path.
- Roadmap source configuration supports multiple shared/context sources.
- Roadmap source configuration supports a managed local focus roadmap.
- Conventional files such as `docs/roadmap.md` can be discovered as roadmap context.
- Conventional files such as `docs/roadmap.md` are labeled as context when discovered.
- Conventional files such as `docs/roadmap.md` are not canonical by default.
- Local focus roadmap state is stored under extension-owned local storage by default.
- Extension actions expose a bounded API for reading roadmap state.
- Extension actions expose a bounded API for updating roadmap state.
- Extension actions expose a bounded API for refreshing recommendations.
- Workstation UX displays roadmap source status.
- Workstation UX supports editing the local focus roadmap.
- Workstation UX supports refreshing recommendations after roadmap changes.
- Planner context includes configured roadmap context.
- Analyze-all curation includes configured roadmap context.
- Recommendation refresh includes configured roadmap context.
- Recommendation freshness fingerprints include configured roadmap context.
- Planner payloads distinguish local steering from shared project context.
- Analyze-all curation payloads distinguish local steering from shared project context.
- Recommendation refresh payloads distinguish local steering from shared project context.
- Planner payloads surface conflicts or assumptions when relevant.
- Analyze-all curation payloads surface conflicts or assumptions when relevant.
- Recommendation refresh payloads surface conflicts or assumptions when relevant.
- Recommendation freshness marks recommendations stale when relevant configured roadmap sources change.
- Recommendation freshness marks recommendations stale when local focus roadmap content changes.
- Shared project roadmap files are treated as read-only context by default.
- Recommendation refresh does not silently rewrite committed shared project roadmap files.
- Analyze-all flows do not silently rewrite committed shared project roadmap files.
- A published or locally packable `@eforge-build/eforge-plan` package exists.
- The `@eforge-build/eforge-plan` package has valid package metadata.
- The `@eforge-build/eforge-plan` package has an `eforge.extension.name` value of `"eforge-plan"`.
- The `@eforge-build/eforge-plan` package has a compiled entrypoint.
- The package installs into a fresh non-eforge project through `eforge extension install`.
- A freshly installed package validates through the existing extension validation path.
- A freshly installed package loads after the existing trust flow completes.
- A freshly installed package reloads through the existing reload path.
- A freshly installed package registers extension actions.
- A freshly installed package registers its input source.
- A freshly installed package registers deep links.
- A freshly installed package registers integration commands.
- A freshly installed package registers its workstation bundle.
- Runtime code no longer relies on monorepo-relative imports.
- Runtime code no longer imports package `src/` paths that are not exported through stable entrypoints.
- APIs currently used through source-only paths are exported through stable package entrypoints before eforge-plan depends on them.
- Workstation assets required by the Console UI are included in the extension artifact.
- Workstation assets are served correctly after install.
- `eforge extension update eforge-plan` successfully updates npm-installed packages.
- `eforge extension update eforge-plan` preserves expected trust semantics.
- Version-pinned updates are documented where supported.
- Version-pinned updates are tested where supported.
- Documentation covers the annotation revision flow.
- Documentation covers the local-dev roadmap model.
- Documentation covers team/shared roadmap context.
- Documentation covers configuration and storage.
- Documentation covers install, update, trust, reload, scope, and removal.
- Documentation covers privacy and trust implications.
- First-party extension docs are updated when installable first-party packages are documented centrally.
- A test verifies revision-store migration for existing revision indexes without annotations.
- A test verifies annotation handler behavior.
- A test verifies source-context snapshots for annotation-driven revisions.
- A test verifies UI selection annotation behavior.
- A test verifies UI block annotation fallback behavior.
- A test verifies UI section annotation fallback behavior.
- A test verifies UI whole-plan annotation fallback behavior.
- A test verifies sticky annotation revision control behavior.
- A test verifies auto-resolve behavior after successful patch-bearing auto-apply.
- A test verifies roadmap source resolution.
- A test verifies local roadmap mutation.
- A test verifies recommendation staleness after configured roadmap source changes.
- A test verifies recommendation staleness after local focus roadmap changes.
- A test verifies planner payload shape for roadmap context.
- A test verifies curation payload shape for roadmap context.
- A test verifies recommendation payload shape for roadmap context.
- A test verifies package layout.
- A test verifies package manifest/layout helpers.
- A test verifies install/update regressions.
- A test verifies storage normalization.
- A test verifies source payload builders.
- A test verifies recommendation freshness.
- A test verifies explicit roadmap configuration.
- A test verifies no-config roadmap discovery.
- A test verifies missing roadmap sources.
- A test verifies roadmap conflict metadata.
- A UI or component test verifies roadmap editing.
- A UI or component test verifies recommendation refresh paths.
- A UI or integration test verifies workstation asset serving where existing test infrastructure supports asset-serving tests.
- A packaging test installs a locally packed package into a fresh fixture project.
- A packaging test uses existing extension install paths.
- A packaging test uses existing extension update paths.
- A packaging test uses existing extension trust paths.
- A packaging test uses existing extension reload paths.
- `pnpm test` exits 0 before handoff.
- `pnpm type-check` exits 0 before handoff.
- `pnpm maintainability:check` exits 0 before handoff.
- Applicable docs/reference checks exit 0 when public docs or generated docs are changed.
- No new implementation file exceeds 600 lines.
- No new test file exceeds 1,200 lines.
- Existing oversized files are changed with bounded edits.
- Route and wire-shape ownership remains in `@eforge-build/client`.
- No new daemon routes are inlined outside the shared client route ownership.
- No shared daemon wire shapes are re-declared outside `@eforge-build/client`.