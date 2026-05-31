---
id: plan-01-input-session-plan-sets
name: Read-Only Input Session Plan Sets
branch: add-read-only-session-plan-set-artifacts-to-eforge-build-input/plan-01-input-session-plan-sets
agents:
  builder:
    effort: high
    rationale: Adds a new public artifact API with schema, safe path resolution,
      deterministic loading/validation, JSON-safe summaries, and compatibility
      constraints across several small modules.
  reviewer:
    effort: high
    rationale: Review needs to verify public API shape, manifest source-of-truth
      boundaries, traversal guards, and that flat session-plan behavior remains
      unchanged.
---

# Read-Only Input Session Plan Sets

## Architecture Context

`@eforge-build/input` owns reusable input-artifact protocols and must stay independent of daemon routes, Console UI code, and engine queue semantics. Existing flat session plans live at `.eforge/session-plans/<session>.md`, are handled by `packages/input/src/session-plan.ts`, and are converted to build source only through `normalizeBuildSource` for the flat `**/.eforge/session-plans/*.md` matcher.

This plan adds session plan sets as read-only sibling artifacts in directories under `.eforge/session-plans/<plan-set-id>/`. The new protocol must not weaken flat session-plan path handling, must not add mutation/enqueue/build-handoff behavior, and must keep new implementation files below the 600-line hard cap.

## Implementation

### Overview

Implement a decomposed `session-plan-set` API in `packages/input/src/` with runtime schemas, deterministic manifest parse/serialize helpers, safe resolvers, list/load helpers, validation diagnostics, and JSON-safe summaries. Export the API from `@eforge-build/input` and document the read-only layout in `packages/input/README.md`.

The manifest is the canonical source of membership. Readers may verify files named by the manifest, but must not recursively discover child plans as a second membership source.

### Public API Contract

Export the following from `@eforge-build/input` via a small `packages/input/src/session-plan-set.ts` barrel and `packages/input/src/index.ts`:

- Constants/schemas/types:
  - `SESSION_PLAN_SET_MANIFEST_FILENAME = 'plan-set.yaml'`
  - `sessionPlanSetManifestSchema`
  - `sessionPlanSetChildSchema`
  - `SessionPlanSetStatus = 'planning' | 'ready' | 'submitted' | 'abandoned'`
  - `SessionPlanSetStrategy = 'sequential' | 'parallel' | 'dag'`
  - `SessionPlanSetChildKind = 'plan' | 'note' | 'reference'`
  - `SessionPlanSetExternalRef`
  - `SessionPlanSetChild`
  - `SessionPlanSetManifest`
  - `SessionPlanSetListEntry`
  - `SessionPlanSetLoadResult`
  - `SessionPlanSetSummary`
  - `SessionPlanSetDiagnostic`
  - `SessionPlanSetValidationResult`
- Manifest helpers:
  - `parseSessionPlanSetManifest(raw: string): SessionPlanSetManifest`
  - `serializeSessionPlanSetManifest(manifest: SessionPlanSetManifest): string`
- Path helpers:
  - `resolveSessionPlanSetDir({ cwd, planSetId })`
  - `resolveSessionPlanSetManifestPath({ cwd, planSetId })`
  - `resolveSessionPlanSetAnchorPath({ cwd, planSetId, anchor })`
  - `resolveSessionPlanSetChildPath({ cwd, planSetId, childFile })`
- Read helpers:
  - `listSessionPlanSets({ cwd }): Promise<SessionPlanSetListEntry[]>`
  - `loadSessionPlanSet({ cwd, planSetId }): Promise<SessionPlanSetLoadResult>`
- Validation/summary helpers:
  - `validateSessionPlanSet({ cwd, planSetId }): Promise<SessionPlanSetValidationResult>`
  - `summarizeSessionPlanSet(loadResult: SessionPlanSetLoadResult, diagnostics?: SessionPlanSetDiagnostic[]): SessionPlanSetSummary`

### Manifest Shape

Use `plan-set.yaml` as the manifest file name. The canonical manifest fields are:

```yaml
id: add-search
title: Add Search
status: planning
strategy: dag
anchor: umbrella.md
children:
  - id: plan-01-indexing
    title: Indexing
    file: plans/plan-01-indexing.md
    kind: plan
    buildable: true
    status: planning
    profile: excursion
    dependsOn: []
    externalRefs:
      - kind: issue
        ref: ABC-123
externalRefs: []
```

Rules:

1. `id` and child `id` are lower-case slug identifiers matching `^[a-z0-9]+(?:-[a-z0-9]+)*$`.
2. `children` array order is the child ordering; do not add a parallel order field.
3. `status` uses the same value set for the plan set and children: `planning`, `ready`, `submitted`, `abandoned`.
4. `strategy` is one of `sequential`, `parallel`, or `dag`.
5. `kind` is one of `plan`, `note`, or `reference`.
6. `buildable` is a required boolean on every child.
7. `dependsOn` defaults to `[]` when omitted.
8. `externalRefs` is optional at manifest and child levels; represent each item as `{ kind: string; ref: string; url?: string; title?: string }`.
9. Keep the schema permissive for unknown fields with `.passthrough()` so future metadata can be read without breaking this read-only slice.

### Key Decisions

1. **Manifest membership is canonical.** `listSessionPlanSets` discovers directories containing `plan-set.yaml`, and `loadSessionPlanSet` reads only the umbrella/child paths named by the manifest.
2. **Separate path resolvers.** Plan-set IDs and child files use new resolver functions; do not relax `resolveSessionPlanPath` in `session-plan.ts`.
3. **No build normalization change.** `normalizeBuildSource` continues to match only flat `.eforge/session-plans/<name>.md` files and returns nested `.eforge/session-plans/<set>/<child>.md` paths unchanged.
4. **Rich load result, JSON-safe summary.** The load result may include raw content/frontmatter metadata for internal consumers. Summary output must contain only arrays, strings, booleans, numbers, plain objects, and `null`/`undefined`-free optional omissions; no `Map` values.
5. **Small modules first.** Split schema, paths, manifest, read, and validation/summary code before implementation. Do not grow legacy oversized files such as `packages/input/src/session-plan.ts` or `packages/input/src/playbook.ts`.

## Scope

### In Scope

- Read-only plan-set manifest schema and exported TypeScript types.
- Manifest parse/serialize helpers with deterministic output ordering.
- Safe plan-set directory, manifest, umbrella anchor, and child path resolution.
- Immediate-directory listing under `.eforge/session-plans/` for directories with valid `plan-set.yaml` manifests.
- Loading a plan set from its manifest, umbrella anchor, and manifest-declared child files.
- Validation diagnostics for duplicate child IDs, duplicate child files, unknown dependencies, missing umbrella file, missing child file, child path errors, anchor path errors, and child frontmatter YAML parse failures.
- JSON-safe summary generation.
- README documentation for the read-only artifact layout and explicit out-of-scope mutation/build handoff.
- Focused tests for parse/serialize, resolver guards, list/load, validation, summary, and flat session-plan compatibility.

### Out of Scope

- Daemon HTTP routes, route constants, or client API helpers.
- Console UI or monitor UI changes.
- Plan-set create/add/update/delete helpers.
- Scaffolding workflows.
- Nested child enqueue/build handoff or `normalizeBuildSource` support for nested child paths.
- Submitted-state mutation for plan-set children.
- Pi or Claude Code skill updates.
- External tracker synchronization.
- Maintainability baseline increases.

## Files

### Create

- `packages/input/src/session-plan-set/schema.ts` — constants, Zod schemas, enum value arrays, and exported manifest/child/list/load/summary/diagnostic types.
- `packages/input/src/session-plan-set/paths.ts` — plan-set root/dir/manifest/anchor/child safe resolution helpers and shared slug/path validation utilities.
- `packages/input/src/session-plan-set/manifest.ts` — manifest YAML parse/serialize helpers with predictable error prefixes.
- `packages/input/src/session-plan-set/read.ts` — `listSessionPlanSets` and `loadSessionPlanSet`; use manifest membership only.
- `packages/input/src/session-plan-set/validate.ts` — deterministic diagnostics plus `summarizeSessionPlanSet`.
- `packages/input/src/session-plan-set.ts` — small public barrel for the plan-set modules.
- `test/session-plan-set.test.ts` — grouped tests for plan-set parsing, path resolution, listing/loading, validation, summary serialization, and flat compatibility.

### Modify

- `packages/input/src/index.ts` — add a session plan-set export section for the new helpers, schemas, and types; do not re-declare types inline.
- `packages/input/README.md` — document `.eforge/session-plans/<plan-set-id>/plan-set.yaml`, umbrella anchor, child markdown files, helper names, and out-of-scope mutation/build handoff.

### Avoid

- `packages/input/src/session-plan.ts` — do not edit unless a compile error makes a tiny type-only reuse unavoidable; the file is at its no-growth ceiling.
- `packages/client/**`, `packages/monitor/**`, `packages/console-ui/**`, `packages/monitor-ui/**`, `eforge-plugin/**`, `packages/pi-eforge/**` — no changes in this slice.

## Implementation Details

### Schema module

- Import `z` from `zod/v4` like existing input modules.
- Export readonly value arrays for statuses, strategies, and child kinds, then derive union types from the Zod schemas.
- Do not enforce duplicate IDs/files in the schema; duplicates are validation diagnostics.
- Use `.default([])` for `children`, `dependsOn`, and `externalRefs` so summaries do not need null checks.
- Keep schema-level errors focused on invalid primitive values/enums and missing required fields.

### Manifest module

- Use `yaml` package parse/stringify already present in `packages/input` dependencies.
- Catch YAML parser exceptions and throw `new Error('Invalid session plan-set manifest YAML: ...')`.
- For schema failures, throw `new Error('Invalid session plan-set manifest: ...')` with semicolon-separated Zod issue messages using the same path formatting pattern as `parseSessionPlan` and `parsePlaybook`.
- Serialize a canonical object with fields in this order: `id`, `title`, `status`, `strategy`, `anchor`, `children`, `externalRefs` when non-empty.
- Serialize child fields in this order: `id`, `title`, `file`, `kind`, `buildable`, `status`, `profile`, `dependsOn`, `externalRefs` when non-empty.

### Path module

- Resolve the root as `<cwd>/.eforge/session-plans`.
- Reject plan-set IDs that are empty, `.`, `..`, contain `/`, contain `\\`, or fail the slug regex.
- Child/anchor file resolvers reject:
  - absolute paths,
  - backslash separators,
  - `.` segments,
  - `..` segments,
  - empty segments from `//` or trailing `/`,
  - non-markdown final segments.
- After `resolve`, verify the result remains inside the selected plan-set directory using a separator-aware guard or `relative()` check.

### Read module

- Use `readdir(sessionPlansDir, { withFileTypes: true })`; return `[]` when the root does not exist.
- Ignore immediate markdown files such as `.eforge/session-plans/foo.md`.
- For each immediate directory, read `<dir>/plan-set.yaml`; skip directories without a manifest or with an invalid manifest in `listSessionPlanSets`.
- Sort list entries by manifest `id`, not directory name.
- `loadSessionPlanSet` loads the manifest, reads the umbrella anchor when present, and reads child files declared in manifest order.
- Child metadata includes manifest child entry, resolved absolute path, relative file path, existence boolean, optional raw content, optional parsed frontmatter record, and optional frontmatter parse error string.
- Use a small local frontmatter splitter for child markdown metadata; do not require child files to satisfy the flat `SessionPlan` schema.

### Validation and summary module

- Define diagnostic codes at minimum:
  - `duplicate-child-id`
  - `duplicate-child-file`
  - `unknown-child-dependency`
  - `missing-anchor`
  - `missing-child-file`
  - `child-frontmatter-parse-error`
  - `invalid-anchor-path`
  - `invalid-child-path`
- Produce diagnostics in deterministic order: duplicates first in manifest order, dependency diagnostics in manifest/dependency order, anchor diagnostics, then child file/path/frontmatter diagnostics in manifest order.
- Each diagnostic includes `severity: 'error'`, `code`, `message`, and contextual fields such as `childId`, `file`, `dependency`, and `path` when available.
- `validateSessionPlanSet` returns `{ ok: diagnostics.length === 0, diagnostics, summary }`.
- `summarizeSessionPlanSet` must not expose `Map`, raw child content, or raw umbrella content. Include manifest identity/status/strategy, anchor file/path/existence, child id/file/kind/buildable/status/profile/dependsOn/existence, and diagnostics.

## Tests

Create `test/session-plan-set.test.ts` and use real temporary directories via `useTempDir` from existing tests. Group tests by behavior:

1. **Manifest parse/serialize**
   - valid manifest parses with defaults for omitted arrays,
   - serialization round-trips through parse,
   - invalid manifest status throws with `Invalid session plan-set manifest:`,
   - invalid child kind throws with `Invalid session plan-set manifest:`,
   - invalid child status throws with `Invalid session plan-set manifest:`,
   - malformed YAML throws with `Invalid session plan-set manifest YAML:`.
2. **Path resolution**
   - plan-set ID with `/` rejects,
   - plan-set ID with `\\` rejects,
   - child path absolute input rejects,
   - child path with `..` rejects,
   - child path with `.` rejects,
   - child path with empty segment rejects,
   - child path with `\\` rejects,
   - valid `plans/plan-01.md` resolves under the selected plan-set directory.
3. **List/load**
   - listing returns directories containing valid `plan-set.yaml`, sorted by manifest id,
   - listing skips flat `.md` files in `.eforge/session-plans/`,
   - listing skips directories without `plan-set.yaml`,
   - loading a valid set returns manifest fields, umbrella content, and metadata for manifest-declared child files in manifest order.
4. **Validation**
   - duplicate child IDs produce `duplicate-child-id`,
   - duplicate child files produce `duplicate-child-file`,
   - unknown dependencies produce `unknown-child-dependency`,
   - missing umbrella anchor produces `missing-anchor`,
   - missing child file produces `missing-child-file`,
   - malformed child frontmatter produces `child-frontmatter-parse-error` without throwing the whole validation run.
5. **JSON-safe summaries**
   - `JSON.stringify(summarizeSessionPlanSet(...))` succeeds,
   - parsing the JSON string retains `id`, `children[].id`, `children[].dependsOn`, `anchor.exists`, and diagnostic codes.
6. **Flat compatibility**
   - `resolveSessionPlanPath({ session: 'a/b' })` and `resolveSessionPlanPath({ session: 'a\\b' })` throw,
   - `listActiveSessionPlans` ignores a plan-set directory and still returns only flat active markdown files,
   - `normalizeBuildSource` returns a nested `.eforge/session-plans/<set>/plans/plan-01.md` source unchanged.

## Database Migration

None.

## Verification

- [ ] `@eforge-build/input` exports `SessionPlanSetManifest`, `SessionPlanSetChild`, parse/serialize helpers, safe resolvers, list/load helpers, validation, and summary helpers from `packages/input/src/index.ts`.
- [ ] Invalid manifest status, child kind, and child status inputs throw `Invalid session plan-set manifest:` errors.
- [ ] Malformed manifest YAML throws an `Invalid session plan-set manifest YAML:` error.
- [ ] Plan-set ID and child path resolver tests cover `/`, `\\`, absolute paths, `.`, `..`, and empty segments.
- [ ] `listSessionPlanSets` returns directories with valid manifests and excludes flat session-plan markdown files.
- [ ] `loadSessionPlanSet` reads the umbrella anchor and manifest-declared child files without recursively discovering extra markdown files.
- [ ] `validateSessionPlanSet` emits all required diagnostic codes listed in this plan.
- [ ] `summarizeSessionPlanSet` output survives `JSON.stringify`/`JSON.parse` with required fields retained.
- [ ] Nested plan-set child markdown paths remain pass-through inputs for `normalizeBuildSource`.
- [ ] No files under `packages/monitor`, `packages/client`, `packages/console-ui`, or `packages/monitor-ui` are modified.
- [ ] Every new implementation file under `packages/input/src/session-plan-set/` has at most 600 lines.
- [ ] `packages/input/src/session-plan.ts` remains at or below its current no-growth ceiling.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] `pnpm test -- test/session-plan-set.test.ts test/session-plan.test.ts test/session-plan-helpers.test.ts test/normalize-build-source.test.ts` exits 0.
