# Mature eforge-plan: annotation revisions, local roadmaps, installable package

## Vision and goals

Make `eforge-plan` a first-party planning workstation that is portable outside this monorepo. The implementation must add durable annotation-driven plan revisions, replace single-file roadmap assumptions with local-first roadmap context, and ship the extension as an installable package while preserving the existing engine/wrapper boundary.

The engine continues to consume normalized build/planning source and emit typed events. `eforge-plan` remains an extension-owned workstation and input-artifact authoring surface; it may use extension actions, private extension storage, daemon-owned agent tasks, and build queue handoff APIs, but it must not add daemon orchestration features or raw extension-owned routes.

## Current-state findings

Codebase exploration found these gaps against the source:

- Plan revision state is stored in `eforge/extensions/eforge-plan/plan-revision-store.ts` as sessions and turns only. `PlanRevisionSessionEntrySchema` has no annotations, and `PlanRevisionTurnEntrySchema` has no annotation/steering snapshot.
- `start-plan-revision-turn` accepts only a required free-form `message`; `buildPlanRevisionSourceText` does not include annotations or steering beyond `userMessage`.
- Auto-apply is present in `workstation-src/plans/src/views/plans/use-plan-revision-session.ts` and backend apply is idempotent, but there is no annotation resolution path after successful patch-bearing apply.
- The plan detail UI renders flat sections in `plan-detail.tsx` with `SafeMarkdown` and no selection/block/section/whole-plan annotation affordances.
- Roadmap context is hardcoded as `docs/roadmap.md` in `schema.ts`, `planner-orchestration.ts`, `backlog-curation-source.ts`, and `recommendation-status.ts`. `roadmapEvidence` is a single `{ path: 'docs/roadmap.md', exists, headings, excerpts }` object.
- Recommendation refresh uses `preparePlannerContext({ includeRoadmap: true })` plus `computeRecommendationSourceFingerprint`, so the hardcoded roadmap evidence also affects refresh source text and freshness.
- `eforge/extensions/eforge-plan/package.json` is a public workspace package named `@eforge-build/eforge-plan`, declares `eforge.extension.entrypoint: ./dist/index.js`, and participates in lockstep version propagation. Runtime files import public package entrypoints such as `@eforge-build/extension-sdk`, `@eforge-build/client`, and `@eforge-build/input` instead of monorepo-relative package source paths.
- Workstation assets are generated into `eforge/extensions/eforge-plan/workstation-assets/` and are gitignored. Package artifacts build and include them alongside the compiled runtime in `dist/`.

## Core architectural principles

1. **Annotations are semantic records, not DOM offsets.** Durable annotation targets record target kind, optional dimension, captured text, and quote-style prefix/suffix context. DOM selection is only a capture mechanism inside the iframe.
2. **Revision turns snapshot their inputs.** Annotation-driven turns store copies of referenced annotations and steering text on the turn record. Later annotation edits cannot mutate historical turn context.
3. **Resolution is tied to patch application.** Referenced annotations are resolved only when a completed turn has a valid patch and `apply-plan-revision-turn` returns `kind: 'applied'`. Answer-only, needs-input, failed, cancelled, mismatched, and invalid-patch turns leave annotations unresolved.
4. **Local roadmap steering wins over shared context.** Local focus roadmap content lives in eforge-plan private project-local storage by default. Shared files are context unless explicitly configured, and conventional discoveries such as `docs/roadmap.md` are labeled as discovered context, not canonical authority.
5. **Bounded payloads only.** Roadmap and annotation payloads must use excerpt/count limits and JSON-safe shapes. Do not introduce unbounded action responses for agents or workstation calls.
6. **Use public package APIs.** Runtime extension code imports from `@eforge-build/extension-sdk`, `@eforge-build/client`, `@eforge-build/input`, and other stable public entrypoints. No runtime imports from `packages/*/src` or monorepo-relative package source paths.
7. **No route or wire-shape drift.** The implementation must not add daemon routes or re-declare daemon wire shapes. Existing extension action and workstation bridge mechanisms are the integration surface.

## Package-root decision

Keep the existing `eforge/extensions/eforge-plan/` directory as the first-party package root and convert it into a publishable workspace package named `@eforge-build/eforge-plan`. This preserves the dogfood extension location while making the same directory locally packable and publishable. The package artifact should include compiled runtime files under `dist/`, built workstation assets under `workstation-assets/`, and README/package metadata. It should exclude source-only workstation development files from the published artifact unless needed for source maps or explicit docs.

The package manifest must set `eforge.extension.name` to `"eforge-plan"` and `eforge.extension.entrypoint` to the compiled entrypoint, e.g. `./dist/index.js`. The deferred curation source provider must also resolve to a compiled in-package module path, e.g. `./dist/backlog-curation-source-provider.js`, because installed packages cannot rely on TypeScript source loading.

## Shared data model

Type ownership is explicit: `annotation-backend` owns runtime schemas, normalization, and mutation semantics for the `PlanRevisionAnnotation*` and turn snapshot shapes; `roadmap-backend` owns `RoadmapContext`, roadmap config, source projection, conflict, and action schemas. Workstation modules may keep consumer projection types in `workstation-src/plans/src/types.ts`, but those types must mirror backend action contracts rather than redefine different wire shapes.

### Annotation model

Persist annotations inside the existing private revision index under each target session:

```ts
interface PlanRevisionAnnotation {
  annotationId: string;
  targetSession: string;
  body?: string;                 // User note / requested change; optional for quick capture.
  target: PlanRevisionAnnotationTarget;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  resolvedByTurnId?: string;
  dismissedAt?: string;
}

interface PlanRevisionAnnotationTarget {
  kind: 'selection' | 'block' | 'section' | 'whole-plan';
  dimension?: string;
  label?: string;
  capturedText: string;
  quoteContext: {
    exact: string;
    prefix?: string;
    suffix?: string;
  };
}

interface PlanRevisionTurnAnnotationSnapshot {
  steering?: string;
  selectedAnnotationIds: string[];
  openAnnotationIds: string[];
  includeOpenAnnotations: boolean;
  annotations: Array<
    PlanRevisionAnnotation & {
      snapshotAt: string;
      snapshotReason: 'selected' | 'open' | 'selected-and-open';
    }
  >;
}
```

`PlanRevisionSessionEntry` gains `annotations: PlanRevisionAnnotation[]` with normalization defaulting missing arrays to `[]`. `PlanRevisionTurnEntry` gains an optional annotation snapshot field. Normalization must preserve legacy indexes that only contain `schemaVersion` and `sessions`. `openAnnotationIds` is computed from the unresolved, non-dismissed annotations present at turn start; it is stored so historical turns can prove exactly which open annotations were included even after later annotation edits.

Unresolved annotations are entries without `resolvedAt` and without `dismissedAt`. Delete removes the annotation from the session; dismiss records `dismissedAt`; resolve records `resolvedAt` and optional `resolvedByTurnId`.

### Annotation action contract

Use extension actions rather than new routes. `annotation-backend` produces these registered action schemas and handlers; `annotation-workstation` consumes the same names through the workstation bridge. All responses are bounded and use the extension action error conventions already used by eforge-plan.

```ts
interface CreatePlanRevisionAnnotationRequest {
  session: string;
  body?: string;
  target: PlanRevisionAnnotationTarget;
}

interface UpdatePlanRevisionAnnotationRequest {
  session: string;
  annotationId: string;
  body?: string;
  target?: PlanRevisionAnnotationTarget;
}

interface DeletePlanRevisionAnnotationRequest {
  session: string;
  annotationId: string;
}

interface ResolvePlanRevisionAnnotationRequest {
  session: string;
  annotationId: string;
}

interface DismissPlanRevisionAnnotationRequest {
  session: string;
  annotationId: string;
}

interface StartPlanRevisionTurnRequest {
  session: string;
  message?: string;              // Existing manual prompt; still accepted for backwards compatibility.
  annotationIds?: string[];       // Explicitly selected unresolved annotations.
  includeOpenAnnotations?: boolean;
  steering?: string;
}
```

Registered action names must be stable for UI/backend integration: `create-plan-revision-annotation`, `update-plan-revision-annotation`, `delete-plan-revision-annotation`, `resolve-plan-revision-annotation`, `dismiss-plan-revision-annotation`, and the existing `start-plan-revision-turn` extended with optional annotation fields. A start request is valid when it has the existing manual `message` or at least one annotation/steering input; existing callers that send `{ session, message }` continue to work.

`get-plan-revision-session` and `list-plan-revision-sessions` should project annotations when plan data is included so the UI does not need an unbounded separate list call.

### Roadmap model

Introduce a shared roadmap context projection consumed by planner context, backlog curation, recommendation refresh, and recommendation freshness:

```ts
interface RoadmapContext {
  schemaVersion: 1;
  localSteering: RoadmapSourceProjection;
  sharedContextSources: RoadmapSourceProjection[];
  discoveredContextSources: RoadmapSourceProjection[];
  assumptions: string[];
  conflicts: RoadmapConflict[];
  truncation: { sourceExcerpts: number; sourceContent: number };
}

interface RoadmapSourceProjection {
  id: string;
  label: string;
  role: 'local-steering' | 'shared-context';
  kind: 'local-focus' | 'configured-shared' | 'discovered-conventional';
  path: string;
  exists: boolean;
  editable: boolean;
  configured: boolean;
  headings: string[];
  excerpts: string[];
  sha256?: string;
  updatedAt?: string;
}

interface RoadmapConflict {
  code: 'configured-source-missing' | 'duplicate-source' | 'source-read-error' | string;
  message: string;
  sourceIds?: string[];
  path?: string;
}

interface ConfiguredRoadmapSource {
  id: string;
  label?: string;
  path: string;                  // Project-relative path after containment validation.
  enabled: boolean;
}

interface RoadmapConfig {
  schemaVersion: 1;
  sharedSources: ConfiguredRoadmapSource[];
  updatedAt?: string;
}
```

Private storage locations:

- `.eforge/storage/extensions/eforge-plan/roadmaps/local-focus.md` for local steering content.
- `.eforge/storage/extensions/eforge-plan/roadmaps/config.json` for configured shared/context source metadata.

Conventional discovery can include `docs/roadmap.md` when present, but it must be projected as `kind: 'discovered-conventional'`, `role: 'shared-context'`, `configured: false`, and not treated as canonical. Shared files are read-only context for recommendation and curation flows. This session does not add automatic shared-file rewriting.

### Roadmap action contract

Use bounded extension actions. `roadmap-backend` produces action schemas and the `roadmap-context` projection helper; `roadmap-workstation`, planner context, curation, refresh, and freshness consumers read only those contracts.

```ts
interface GetRoadmapStateRequest {
  includeLocalFocusContent?: boolean;
}

interface RoadmapStateResponse {
  config: RoadmapConfig;
  localFocus: RoadmapSourceProjection & { content?: string; maxContentBytes: number };
  context: RoadmapContext;
}

interface UpdateRoadmapStateRequest {
  localFocusContent?: string;
  expectedLocalFocusSha256?: string;
  sharedSources?: ConfiguredRoadmapSource[];
}
```

- `get-roadmap-state` returns config, optional local focus content, resolved source status, conflicts, assumptions, and truncation metadata.
- `update-roadmap-state` updates local focus content and configured source metadata with path containment and payload limits. It does not silently write shared project roadmap files.
- Existing `refresh-recommendations` and `analyze-all-backlog` remain the refresh mechanisms; their source builders consume the new roadmap context. Roadmap UI calls the existing `refresh-recommendations` action after roadmap changes when the user requests refresh, satisfying the bounded refresh API requirement without adding daemon routes.

## Integration contracts

### Revision flow

1. Workstation captures selection/block/section/whole-plan targets inside the iframe using `window.getSelection()` and closest rendered plan-section metadata.
2. Backend stores annotations in the plan revision index under the target session.
3. Sticky revision control starts a normal revision turn with selected/open annotations and optional steering.
4. `startTurn` computes fingerprints, snapshots selected and open annotations, writes source text through `buildPlanRevisionSourceText`, starts a daemon-owned `eforge-plan.planning-draft` task, and records the turn.
5. `apply-plan-revision-turn` validates the task result and patch exactly as today. On successful patch apply, it records `appliedAt`, `appliedSections`, and resolves referenced annotations with `resolvedAt` and `resolvedByTurnId` while preserving existing idempotent apply behavior on repeated calls.
6. Not-applicable paths return without annotation resolution.

### Roadmap context flow

`roadmap-context` helpers should be the only source of roadmap reads/projections. Consumers:

- `preparePlannerContext` includes `roadmapContext` and removes the single canonical `roadmapEvidence` contract.
- `buildBacklogCurationSource` includes `roadmapContext` in the source and fingerprint projection.
- `buildRecommendationSourceProjection` includes `roadmapContext` in the freshness fingerprint.
- `buildRecommendationRefreshSource` receives planner context with the same roadmap context.

Payloads must distinguish `localSteering` from `sharedContextSources` and `discoveredContextSources`, and must include `assumptions`/`conflicts` when relevant.

### Package flow

- Runtime package build compiles TypeScript to `dist/`.
- Workstation build outputs `workstation-assets/plans/index.js` and `style.css` before packing/publishing.
- `package.json#files` includes `dist/`, `workstation-assets/`, and docs/metadata required by extension validation.
- Package-foundation performs a runtime import audit. Any API currently reached through a monorepo-relative `packages/*/src` path must either be replaced with an existing public package export or promoted through the owning package's public entrypoint/export map before eforge-plan imports it.
- `eforge extension install ./eforge/extensions/eforge-plan` and `eforge extension install <packed .tgz>` both validate through the existing extension management path.
- Packaging validation must verify that a freshly installed package registers extension actions, its input source, deep links, integration commands, and the workstation bundle; workstation assets must be served correctly after install.
- Publish scripts include the package in lockstep.
- Update tests cover npm/local package updates through `eforge extension update eforge-plan`, preserved trust semantics, and version-pinned updates where the existing extension manager supports them.

### Module dependency graph

The module graph is intentionally acyclic:

- `package-foundation` has no feature-module dependency and should land first.
- `annotation-backend` and `roadmap-backend` depend on package-foundation's public imports/build setup, but not on each other.
- `annotation-workstation` depends on annotation-backend action/type contracts only; it must not import backend implementation helpers.
- `roadmap-workstation` depends on roadmap-backend action/type contracts only; it must not import backend implementation helpers.
- `packaging-docs-validation` runs after feature modules and package-foundation. It may adjust docs, tests, package files, or release metadata needed for validation, but it should not redesign feature behavior owned by annotation or roadmap modules.

## Shared File Registry

| File | Modules | Region Strategy |
| --- | --- | --- |
| `eforge/extensions/eforge-plan/index.ts` | package-foundation, annotation-backend, roadmap-backend | Package foundation owns import path rewrites and compiled-provider path changes. Annotation backend owns annotation action imports/registration/allowedActions. Roadmap backend owns roadmap action imports/registration/allowedActions and contribution blocks. |
| `eforge/extensions/eforge-plan/schema.ts` | package-foundation, roadmap-backend | Package foundation owns import path rewrites only. Roadmap backend owns replacement of `PlannerRoadmapEvidenceSchema` and planner context roadmap output shape. |
| `eforge/extensions/eforge-plan/planning-agent-task-schemas.ts` | package-foundation, annotation-backend, roadmap-backend | Package foundation owns import path rewrites. Annotation backend owns annotation schemas, turn snapshot fields, and revision input/projection additions. Roadmap backend owns planning workflow fields only if needed for roadmap source fingerprints. |
| `eforge/extensions/eforge-plan/plan-revision-store.ts` | package-foundation, annotation-backend | Package foundation owns import rewrites. Annotation backend owns normalization and annotation mutation helpers. |
| `eforge/extensions/eforge-plan/plan-revision-actions.ts` | package-foundation, annotation-backend | Package foundation owns import rewrites. Annotation backend owns annotation actions, start-turn snapshot assembly, and apply-time resolution. |
| `eforge/extensions/eforge-plan/plan-revision-orchestration.ts` | package-foundation, annotation-backend | Package foundation owns import rewrites. Annotation backend owns source-text additions and recent-turn context snapshot projection. |
| `eforge/extensions/eforge-plan/backlog-curation-actions.ts` | package-foundation, roadmap-backend | Package foundation owns public imports and compiled source-provider path. Roadmap backend only changes request/source metadata if required by the roadmap context contract. |
| `eforge/extensions/eforge-plan/backlog-curation-source.ts` | package-foundation, roadmap-backend | Package foundation owns import rewrites. Roadmap backend replaces local hardcoded roadmap reader with the shared roadmap context helper. |
| `eforge/extensions/eforge-plan/planner-orchestration.ts` | package-foundation, roadmap-backend | Package foundation owns import rewrites. Roadmap backend replaces `readRoadmapEvidence` and planner output schema usage. |
| `eforge/extensions/eforge-plan/recommendation-status.ts` | package-foundation, roadmap-backend | Package foundation owns import rewrites. Roadmap backend replaces `readRoadmapFingerprintEvidence` and source fingerprint projection. |
| `eforge/extensions/eforge-plan/recommendation-refresh.ts` | package-foundation, roadmap-backend | Package foundation owns import rewrites. Roadmap backend verifies refresh source text and active refresh fingerprints consume `roadmapContext`. |
| `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts` | annotation-workstation, roadmap-workstation | Annotation workstation owns annotation/revision projection interfaces. Roadmap workstation owns roadmap state/action response interfaces. Keep additions in separate type blocks. |
| `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-detail.tsx` | annotation-workstation | Annotation workstation owns rendered-section annotation capture/fallback controls and sticky annotation revision wiring. |
| `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-revision-panel.tsx` | annotation-workstation | Annotation workstation owns any API surface changes for annotation-driven submission while preserving manual prompt behavior. |
| `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/use-plan-revision-session.ts` | annotation-workstation | Annotation workstation owns new submit options and auto-refresh after annotation mutations. |
| `eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-workstation-data.ts` | roadmap-workstation | Roadmap workstation owns loading roadmap state and refresh coupling. |
| `eforge/extensions/eforge-plan/workstation-src/plans/src/App.tsx` | roadmap-workstation | Roadmap workstation owns placement of roadmap status/editor UI. |
| `eforge/extensions/eforge-plan/__tests__/registration.test.ts` | annotation-backend, roadmap-backend, package-foundation | Each module owns its action/schema assertions. If this file grows too much, split new annotation/roadmap registration assertions into focused test files instead of expanding the oversized list. |
| `test/eforge-plan-workstation.test.ts` | annotation-workstation, roadmap-workstation, packaging-docs-validation | Annotation and roadmap modules add allowedActions checks. Packaging/docs module updates package entrypoint/import path assertions. |
| `eforge/extensions/eforge-plan/README.md` | packaging-docs-validation | Final docs module owns all README updates for annotations, roadmaps, package install/update/trust/reload, version-pinned updates where supported, storage, privacy, and removal. Feature modules should add code comments/tests, not competing README edits. |
| `eforge/extensions/eforge-plan/package.json`, `tsconfig.json`, new `tsup.config.ts` | package-foundation, packaging-docs-validation | Package foundation owns package metadata/build setup. Packaging/docs module owns final publish/files checks and release-script integration. |
| `package.json`, `pnpm-workspace.yaml`, `scripts/lib/lockstep-version.mjs`, `scripts/publish-all.mjs` | package-foundation, packaging-docs-validation | Package foundation owns workspace/build script additions. Packaging/docs module owns final publish inclusion or documented independent-release behavior. |

### Region declarations for module planners

If module planners add temporary coordination markers in shared files, they must use compiled plan IDs such as `plan-02-annotation-backend`, not raw module IDs. Declared ownership:

- `package-foundation`: top-level package metadata, build scripts, public import rewrites, stable public export promotion for source-only dependencies, source-provider compiled path, and package-layout tests.
- `annotation-backend`: annotation schemas, store helpers, annotation actions, revision turn snapshots, revision source text, and apply-time resolution.
- `annotation-workstation`: annotation UI components/hooks/tests and annotation-driven revision submission from the Plans detail view.
- `roadmap-backend`: roadmap state/config/context helpers, roadmap actions, planner/curation/recommendation integration, freshness tests.
- `roadmap-workstation`: roadmap status/editor UI, refresh-after-roadmap-change behavior, UI tests.
- `packaging-docs-validation`: final package packing/install/update/trust/reload/version-pinned update tests, installed registration checks, workstation asset-serving checks, and documentation. Avoid touching feature implementation except for packaging regressions.

## Technical decisions

1. **Schema version stays at 1 with normalization unless a breaking persisted shape is unavoidable.** Existing revision indexes without annotations should parse and normalize to `annotations: []` rather than being discarded.
2. **Keep manual revision input compatible.** Existing callers that send `{ session, message }` to `start-plan-revision-turn` continue to work. Annotation fields are optional and ignored for manual turns when absent.
3. **Use exact snapshots for source text.** Store the annotation snapshot on the turn before or immediately after daemon task start. If durable turn recording fails, cancel the daemon task as the current code does.
4. **Roadmap helper owns all file reads.** Do not leave duplicate `docs/roadmap.md` readers in planner, curation, or freshness code.
5. **Conventional discovery is context only.** `docs/roadmap.md` can appear in discovered sources, but no code path should special-case it as the sole canonical roadmap.
6. **Package around the existing source tree.** This minimizes file moves and keeps trust hashing aligned with the extension code loaded in this repository.
7. **No shared project roadmap writes from background AI flows.** Recommendation refresh and analyze-all may mark recommendations stale/fresh but never rewrite shared roadmap files.

## Module implementation guidance

### package-foundation

Convert `eforge/extensions/eforge-plan` into a buildable package: public imports, promotion of needed source-only APIs through stable package entrypoints/export maps, package metadata, `tsup`/build scripts, workspace inclusion, compiled source provider path, and baseline package-layout tests. Keep functional changes minimal so feature modules can build on stable imports.

### annotation-backend

Add persisted annotation state/actions and integrate snapshots into revision turns. Extend source text generation and apply-time annotation resolution. Cover legacy migration, annotation handler behavior, source-context snapshot immutability, and auto-resolve vs non-resolve outcomes.

### annotation-workstation

Add in-frame selection capture, rendered block/section/whole-plan fallback controls, unresolved annotation rendering, edit/delete/resolve/dismiss controls, and sticky annotation-driven revise control. Preserve existing manual Revise with AI prompt behavior and one-running-turn locking.

### roadmap-backend

Create roadmap config/local-focus storage and shared context projection. Replace all single-path roadmap readers in planner context, backlog curation, recommendation refresh, and recommendation status/fingerprint. Add tests for explicit config, no-config discovery, missing sources, local roadmap mutation, conflicts, payload shapes, and staleness.

### roadmap-workstation

Expose roadmap source status, local focus editor, and refresh path in the workstation. Ensure local edits update private storage and refresh recommendation status without requiring shared-file writes. Add component tests for editing and refresh behavior.

### packaging-docs-validation

Finalize package artifacts, package files, publish/release wiring, local pack/install/update/trust/reload regression tests, version-pinned update tests where supported, installed registration checks, workstation asset-serving checks, and user docs. Ensure docs cover annotations, local/team roadmap model, install/update/version-pinned update/trust/reload/scope/removal, storage, privacy, and trust implications. Avoid changing core package build mechanics except to fix validation regressions discovered after package-foundation lands.

## Quality attributes

- New implementation files stay under 600 lines; split helpers/components when a file approaches the limit.
- New test files stay under 1,200 lines; extend existing focused tests or add new focused files rather than creating one large acceptance test.
- Existing oversized files are edited with bounded exact edits.
- Roadmap and annotation action outputs are bounded and JSON-safe.
- No daemon route literals or daemon wire-shape re-declarations are introduced.
- Engine/provider SDK boundaries stay intact; eforge-plan uses extension SDK contexts and daemon-owned agent tasks.
- Shared roadmap files are read-only context by default, and AI refresh/curation flows do not rewrite them.

## Validation commands

Run after all modules merge:

```bash
pnpm build
pnpm type-check
pnpm test
pnpm maintainability:check
pnpm docs:check
```
