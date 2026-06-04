---
id: plan-01-adapter-foundation
name: SDK Storage Helper and Session Planning Adapter Foundation
branch: move-session-plans-behind-an-extension-shaped-adapter/plan-01-adapter-foundation
agents:
  builder:
    effort: high
    rationale: Introduces a new SDK path-containment API, a public input-package
      adapter contract, package dependency wiring, and path traversal tests.
  reviewer:
    effort: high
    rationale: The plan adds a public helper and path containment logic that
      requires careful API and security review.
---

# SDK Storage Helper and Session Planning Adapter Foundation

## Architecture Context

Session plans remain project-local Markdown files under `.eforge/session-plans/`, and the engine remains input-agnostic. This plan builds the reusable foundation for the boundary shift: a small SDK helper for contained project-local storage paths and a bundled `@eforge-build/input` session-planning workflow adapter that wraps existing session-plan and session-plan-set helpers. It does not add native extension workflow registration, route ownership, Console bundles, or client wire changes.

## Implementation

### Overview

Add an IO-free project-local storage resolver to `@eforge-build/extension-sdk`, then use it from `@eforge-build/input` path helpers and a new bundled session-planning workflow adapter. The adapter exposes domain operations for flat session plans and read-only plan sets without importing `@eforge-build/client`.

### Key Decisions

1. Export a minimal `resolveProjectLocalStoragePath({ cwd, segments })` helper from the SDK instead of adding `ctx.paths` or a workflow registration API in this slice.
2. Keep the adapter in `@eforge-build/input` because that package already owns reusable input-artifact protocols and normalization helpers.
3. Keep existing low-level session-plan helpers exported for compatibility, but route the new adapter and root path helpers through the SDK resolver.
4. Model readiness failures as input-domain errors carrying readiness detail; daemon services in plan 02 map those errors to HTTP responses.
5. Keep session-plan sets read-only by exposing only list, load, and validate operations on the adapter's plan-set surface.

### Suggested API Shape

Use these names unless implementation finds a compile-time reason to adjust them consistently:

```ts
// @eforge-build/extension-sdk
export interface ProjectLocalStoragePathOptions {
  cwd: string;
  segments: readonly string[];
}
export function resolveProjectLocalStoragePath(opts: ProjectLocalStoragePathOptions): string;
```

```ts
// @eforge-build/input
export const SESSION_PLANNING_WORKFLOW_ADAPTER_DESCRIPTOR = {
  id: 'builtin:session-planning',
  kind: 'workflow-input-adapter',
  sourceScope: 'project-local',
} as const;

export interface SessionPlanningWorkflowAdapter {
  descriptor: typeof SESSION_PLANNING_WORKFLOW_ADAPTER_DESCRIPTOR;
  flat: {
    resolveStorageRoot(cwd: string): string;
    resolvePath(opts: ResolveSessionPlanPathOpts): string;
    list(opts: { cwd: string; includeSubmitted?: boolean }): Promise<SessionPlanningListEntry[]>;
    load(opts: LoadSessionPlanOpts): Promise<{ plan: SessionPlan; readiness: SessionPlanReadinessDetail; path: string }>;
    create(opts: SessionPlanningCreateAndWriteOptions): Promise<{ plan: SessionPlan; path: string }>;
    setSection(opts: SessionPlanningSetSectionOptions): Promise<{ plan: SessionPlan; readiness: SessionPlanReadinessDetail }>;
    skipDimension(opts: SessionPlanningSkipDimensionOptions): Promise<{ plan: SessionPlan; readiness: SessionPlanReadinessDetail }>;
    setStatus(opts: SessionPlanningSetStatusOptions): Promise<{ plan: SessionPlan }>;
    selectDimensions(opts: SessionPlanningSelectDimensionsOptions): Promise<{ plan: SessionPlan; readiness: SessionPlanReadinessDetail }>;
    readiness(opts: LoadSessionPlanOpts): Promise<SessionPlanReadinessDetail>;
    migrateLegacy(opts: LoadSessionPlanOpts): Promise<{ plan: SessionPlan; migrated: boolean }>;
    normalizeBuildSource(input: NormalizeBuildSourceInput): NormalizeBuildSourceResult;
  };
  planSets: {
    list(opts: { cwd: string; includeSubmitted?: boolean }): Promise<SessionPlanSetListEntry[]>;
    load(opts: LoadSessionPlanSetOpts): Promise<SessionPlanSetLoadResult>;
    validate(opts: ValidateSessionPlanSetOpts): Promise<SessionPlanSetValidationResult>;
  };
}

export class SessionPlanReadinessError extends Error {
  readonly code: 'session-plan-readiness-failed';
  readonly readiness: SessionPlanReadinessDetail;
}
export function isSessionPlanReadinessError(err: unknown): err is SessionPlanReadinessError;
export function createSessionPlanningWorkflowAdapter(): SessionPlanningWorkflowAdapter;
```

The exact option type names may differ, but TypeScript consumers must be able to import the adapter boundary and descriptor from `@eforge-build/input`.

## Scope

### In Scope

- Add and export an IO-free project-local storage/path helper in `@eforge-build/extension-sdk`.
- Reject unsafe storage path segment inputs before returning a path.
- Add `@eforge-build/extension-sdk` as a workspace dependency of `@eforge-build/input` and update `pnpm-lock.yaml`.
- Route flat session-plan root resolution and session plan-set root resolution through the SDK helper.
- Add a bundled session-planning workflow adapter in `@eforge-build/input`.
- Expose adapter operations for flat plan list, load/show, create, set section, skip dimension, set status, select dimensions, readiness, migrate legacy, path resolution, and build-source normalization/profile extraction.
- Expose adapter operations for read-only plan-set list, load, and validate.
- Add focused tests for the SDK helper and the adapter.

### Out of Scope

- No `EforgeExtensionAPI` method for user-authored session-plan workflow extensions.
- No raw extension-owned HTTP route support.
- No Console frontend bundle support.
- No client route or wire type changes.
- No file migration out of `.eforge/session-plans/`.
- No session-plan frontmatter field changes.
- No plan-set mutation or enqueue behavior.

## Files

### Create

- `packages/extension-sdk/src/project-storage.ts` — IO-free helper that resolves safe path segments under `<cwd>/.eforge/`.
- `packages/input/src/session-planning-workflow.ts` — bundled adapter descriptor, contract, domain error, factory, and implementation delegating to existing input helpers.
- `test/extension-sdk-project-storage.test.ts` — normal resolution and rejection tests for the SDK helper.
- `test/session-planning-workflow.test.ts` — adapter descriptor, operation, read-only plan-set, no-client-import, and normalization/profile tests.

### Modify

- `packages/extension-sdk/src/index.ts` — export `resolveProjectLocalStoragePath` and its option type.
- `packages/input/package.json` — add the `@eforge-build/extension-sdk` workspace dependency.
- `pnpm-lock.yaml` — record the new workspace dependency edge.
- `packages/input/src/session-plan.ts` — add a small root resolver using the SDK helper and replace existing `.eforge/session-plans` root joins in list/path/write code with that resolver. Use bounded exact edits; do not rewrite the file.
- `packages/input/src/session-plan-set/paths.ts` — make `resolveSessionPlanSetsRoot(cwd)` use the SDK helper.
- `packages/input/src/index.ts` — export adapter constants, factory, error type/helpers, operation option/result types, and update package-level comments to mention the bundled adapter boundary.

## Implementation Notes

- The SDK helper must import only `node:path` utilities. It must not import `node:fs`, `node:fs/promises`, or any extension runtime module.
- Treat an empty `segments` array and empty string segments as errors.
- Reject absolute segments, `.`/`..` segments, null-byte segments, slash/backslash separators inside a segment, and any resolved path that is outside `<cwd>/.eforge/`.
- Use a `relative()`/`isAbsolute()` or separator-terminated prefix guard after resolution so sibling directories such as `.eforge-other` cannot match.
- The adapter implementation must not import `@eforge-build/client`.
- `flat.list` must preserve current route-list behavior: active lists exclude submitted plans unless `includeSubmitted` is true, and a load race during readiness calculation returns `ready: false` and `missingDimensions: []` for that entry.
- `flat.setStatus` must preserve the existing acceptance-criteria quality gate when marking a plan `ready`; throw `SessionPlanReadinessError` carrying the readiness detail.
- `planSets.list` must preserve current route-list behavior: exclude `abandoned` sets and exclude `submitted` sets unless `includeSubmitted` is true.
- Keep existing functions such as `normalizeBuildSource`, `resolveSessionPlanPath`, `listSessionPlanSets`, and `validateSessionPlanSet` exported for compatibility.

## Verification

- [ ] `resolveProjectLocalStoragePath({ cwd, segments: ['session-plans'] })` returns `<cwd>/.eforge/session-plans` as an absolute path.
- [ ] SDK helper tests reject `segments: []` and `segments: ['']`.
- [ ] SDK helper tests reject `['..']`, `['../escape']`, `['/tmp/escape']`, `['session-plans/../../escape']`, and backslash separator inputs.
- [ ] A source assertion in the SDK helper test finds no `node:fs` or `node:fs/promises` import in `packages/extension-sdk/src/project-storage.ts`.
- [ ] `SESSION_PLANNING_WORKFLOW_ADAPTER_DESCRIPTOR` has literal `id`, `kind`, and `sourceScope` values from the source document.
- [ ] `createSessionPlanningWorkflowAdapter().planSets` exposes exactly `list`, `load`, and `validate` keys.
- [ ] Adapter tests create, load, update a section, skip a dimension, select dimensions, migrate legacy, and resolve a path under `.eforge/session-plans/`.
- [ ] Adapter tests prove `normalizeBuildSource` returns ordinary build-source content for a valid flat session-plan file path.
- [ ] Adapter tests prove `agent_profile` frontmatter is returned as `agentProfile` during normalization.
- [ ] A source assertion proves `packages/input/src/session-planning-workflow.ts` does not import `@eforge-build/client`.
- [ ] `pnpm vitest run test/extension-sdk-project-storage.test.ts test/session-planning-workflow.test.ts test/session-plan.test.ts test/session-plan-set.test.ts test/normalize-build-source.test.ts` exits 0.
- [ ] `pnpm type-check` exits 0.
