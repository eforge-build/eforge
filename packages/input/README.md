# @eforge-build/input

Reusable build-input protocols for eforge - playbook and session-plan artifacts that compile to ordinary build source.

## Consumers

- `@eforge-build/monitor` - daemon playbook and session-plan compatibility routes backed by bundled input workflow adapters, plus adapter-backed normalization for session-plan source paths before enqueue
- `@eforge-build/eforge` - in-process adapter-backed normalization for CLI build commands that accept session plans or playbooks as input
- Future wrapper apps that need to compile playbooks or session plans to build source independently of the daemon

## Dependencies

- Depends on `@eforge-build/scopes` for scope directory lookup and named-set resolution
- Depends on `@eforge-build/extension-sdk` for project-local session-plan/plan-set path resolution and scoped `ctx.paths` helpers in extension input contexts
- Does **NOT** depend on `@eforge-build/engine`

The engine consumes normalized PRD/build source; it has no knowledge of where that source originated. This keeps the engine input-agnostic.

## What's included

### Playbooks

Playbooks are Markdown files with YAML frontmatter encoding a reusable build intent. They resolve across all three scope tiers via `@eforge-build/scopes` named-set resolution.

- `parsePlaybook(content)` - parse a playbook Markdown file
- `serializePlaybook(playbook)` - serialize a playbook to Markdown
- `validatePlaybook(playbook)` - validate playbook structure
- `listPlaybooks(opts)` - list all playbooks across scope tiers with shadow annotations
- `loadPlaybook(name, opts)` - load the highest-precedence playbook by name
- `writePlaybook(playbook, opts)` - write a playbook to a scope directory
- `movePlaybook(name, opts)` - move a playbook between scope tiers
- `copyPlaybookToScope(name, opts)` - copy a playbook to a target scope
- `playbookToBuildSource(playbook)` - compile an autonomous playbook to ordinary build source for the engine queue
- `playbookToPlanSeed(playbook)` - extract static plan-seed data (Goal, Out of scope, Acceptance criteria, Notes) from a planning playbook. Used by the `create-from-playbook` session-plan action as a static template/scratch helper. This is not the planning-playbook Run path — planning playbook runs check the eforge-plan planning capability and return generic planning entry metadata for the eforge-plan workstation, which performs active codebase investigation before creating a session plan.

### Session plans

Session plans are Markdown files in `.eforge/session-plans/` that accumulate decisions during a structured eforge-plan planning entry/workstation flow. They are project-local only and compile to ordinary build source. Plans created from ready AI creation drafts may include a leading `## Executive Summary` section before readiness dimensions.

#### Lifecycle

A session plan moves through the following `status` values:

| Status | Meaning |
|--------|---------|
| `planning` | Actively being built up during a planning conversation |
| `ready` | All required dimensions are filled; can be enqueued |
| `submitted` | Enqueued to the daemon build queue; `eforge_session` is set in frontmatter |
| `abandoned` | Discarded; excluded from active listings |

`listActiveSessionPlans` returns only `planning` and `ready` plans. `submitted` and `abandoned` plans are excluded.

#### Parse / serialize

- `parseSessionPlan(content)` - parse a session plan Markdown file
- `serializeSessionPlan(plan)` - serialize a session plan to Markdown

#### List / load / write

- `listActiveSessionPlans(opts)` - list all active (`planning` or `ready`) session plans in the project-local scope
- `loadSessionPlan(opts)` - read and parse a session plan by session identifier (path-traversal safe)
- `writeSessionPlan(opts)` - serialize and atomically write a session plan to disk; constrained to `<cwd>/.eforge/session-plans/`

#### Path resolution

- `resolveSessionPlanPath(opts)` - resolve a session identifier to `<cwd>/.eforge/session-plans/<session>.md`; throws on path traversal attempts

#### Dimension helpers

- `selectDimensions(plan)` - resolve required/optional/skipped dimension sets for a plan
- `checkReadiness(plan)` - check whether all required dimensions have substantive content; returns `{ ready, missingDimensions }`
- `getReadinessDetail(plan)` - like `checkReadiness` but also returns `coveredDimensions` and `skippedDimensions` arrays
- `migrateBooleanDimensions(plan)` - migrate legacy boolean dimension format to the current schema

#### Mutation helpers

All mutation helpers return a new `SessionPlan` value; they do not write to disk. Use `writeSessionPlan` after composing mutations.

- `createSessionPlan(opts)` - create a fresh `SessionPlan` with canonical frontmatter in `planning` status
- `setSessionPlanSection(plan, dimensionName, content)` - append or replace a `## {Dimension Title}` section in the plan body; heading is derived from the kebab-case dimension name (e.g. `'acceptance-criteria'` → `## Acceptance Criteria`)
- `skipDimension(plan, name, reason)` - add or update an entry in `skipped_dimensions`
- `unskipDimension(plan, name)` - remove an entry from `skipped_dimensions`
- `setSessionPlanStatus(plan, status, metadata?)` - update `status`; when status is `'submitted'`, `metadata.eforge_session` is required
- `setSessionPlanDimensions(plan, opts)` - apply `planning_type`/`planning_depth` and write `required_dimensions`/`optional_dimensions` using the canonical dimension map; no-op on existing explicit lists unless `overwrite: true`

#### Build source compilation

- `sessionPlanToBuildSource(plan)` - compile a session plan to ordinary build source for the engine queue, preserving body section order such as a leading `## Executive Summary` before readiness sections

### Session plan sets (read-only)

Session plan sets are **read-only** sibling artifacts that group related plans under a directory:

```
.eforge/session-plans/<plan-set-id>/
  plan-set.yaml          # canonical manifest (source of membership)
  umbrella.md            # optional umbrella anchor markdown
  plans/plan-01-*.md     # manifest-declared child markdown files
```

The `plan-set.yaml` manifest is the **single source of membership**. Readers verify only the umbrella anchor and child files named by the manifest; they never recursively discover child markdown as a second membership source. The flat `.eforge/session-plans/<name>.md` session-plan handling is unchanged, and `normalizeBuildSource` continues to match only flat session-plan paths.

#### Manifest

```yaml
id: add-search
title: Add Search
status: planning        # planning | ready | submitted | abandoned
strategy: dag           # sequential | parallel | dag
anchor: umbrella.md     # optional umbrella anchor file
children:
  - id: plan-01-indexing
    title: Indexing
    file: plans/plan-01-indexing.md
    kind: plan            # plan | note | reference
    buildable: true
    status: planning
    profile: excursion    # optional
    dependsOn: []
    externalRefs:
      - kind: issue
        ref: ABC-123
externalRefs: []
```

`children` array order is the child ordering. Unknown fields are preserved (`.passthrough()`) so future metadata reads without breaking this slice.

#### Manifest parse / serialize

- `parseSessionPlanSetManifest(raw)` - parse a `plan-set.yaml` string to a typed manifest
- `serializeSessionPlanSetManifest(manifest)` - serialize a manifest with canonical field ordering

#### Path resolution

- `resolveSessionPlanSetsRoot(cwd)` - absolute `.eforge/session-plans` root
- `resolveSessionPlanSetDir({ cwd, planSetId })` - absolute plan-set directory; rejects unsafe ids
- `resolveSessionPlanSetManifestPath({ cwd, planSetId })` - absolute manifest path
- `resolveSessionPlanSetAnchorPath({ cwd, planSetId, anchor })` - absolute umbrella anchor path; rejects traversal
- `resolveSessionPlanSetChildPath({ cwd, planSetId, childFile })` - absolute child path; rejects traversal

#### List / load

- `listSessionPlanSets({ cwd })` - directories with a valid `plan-set.yaml`, sorted by manifest id
- `loadSessionPlanSet({ cwd, planSetId })` - load the manifest, umbrella anchor, and manifest-declared child files in manifest order

#### Validation / summary

- `validateSessionPlanSet({ cwd, planSetId })` - returns `{ ok, diagnostics, summary }` with diagnostic codes for duplicate child ids/files, unknown dependencies, missing/invalid anchor, missing/invalid child paths, and child frontmatter parse errors
- `summarizeSessionPlanSet(loadResult, diagnostics?)` - JSON-safe summary (no `Map`, no raw content)

#### Out of scope for plan sets

This is a read-only protocol. It does **not** create, add, update, or delete plan sets; does **not** enqueue children or hand off plan sets to the build pipeline; and does **not** change `normalizeBuildSource` matching. Nested `.eforge/session-plans/<set>/<child>.md` paths pass through `normalizeBuildSource` unchanged.

### Boundary normalization

- `normalizeBuildSource(input)` - single chokepoint for session-plan handling: if a source path matches `**/.eforge/session-plans/*.md`, parses the plan and converts it to ordinary build source; other paths pass through unchanged

The matcher contract is `**/.eforge/session-plans/*.md`. Paths that do not match this pattern are returned unchanged.

### Bundled playbook workflow adapter

`createPlaybookWorkflowAdapter()` returns the built-in adapter that bundles the three-tier playbook protocol behind one workflow-shaped boundary. It remains a compatibility shim for client-owned HTTP routes and wire response shapes while the engine still receives only normalized build source. The first-party `@eforge-build/eforge-playbooks` extension does not import this adapter; it uses the public pure playbook helpers in this package for parser, storage, validation, compiler, and planning-seed behavior. The adapter is not a native extension registration API for user-authored playbook extraction.

The adapter descriptor is exported as `PLAYBOOK_WORKFLOW_ADAPTER_DESCRIPTOR`:

```ts
{
  id: 'builtin:playbooks',
  kind: 'workflow-input-adapter',
  sourceScopes: ['project-local', 'project-team', 'user'],
}
```

The adapter exposes a `scoped` surface for list/load/save/write/move/promote/demote/copy, raw validation, autonomous compilation, and planning session-plan seed creation. Daemon services keep HTTP error mapping, landing-action validation, queue dependency handling, profile lookup, acceptance-criteria inventory derivation, enqueue, and scheduler notification outside this package.

### Bundled session-planning workflow adapter

`createSessionPlanningWorkflowAdapter()` returns the built-in adapter that bundles the project-local session-planning protocol behind one workflow-shaped boundary. It is internal to eforge's shipped session-planning flow: daemon services use it as a compatibility shim for client-owned HTTP routes and wire response shapes, and CLI/daemon enqueue paths use it to normalize session-plan files before the engine sees them. It is not a native extension registration API for user-authored session-plan extraction.

The adapter descriptor is exported as `SESSION_PLANNING_WORKFLOW_ADAPTER_DESCRIPTOR`:

```ts
{
  id: 'builtin:session-planning',
  kind: 'workflow-input-adapter',
  sourceScope: 'project-local',
}
```

The adapter exposes two surfaces:

- `flat` - project-local flat session-plan operations for `.eforge/session-plans/<session>.md`: storage-root and path resolution, list, load, create, section mutation, dimension skip/selection, status mutation, readiness, legacy migration, and `normalizeBuildSource`.
- `planSets` - read-only session-plan-set operations: list, load, and validate. Plan sets remain read-only; the adapter does not create, mutate, enqueue, or delete plan sets.

The build engine still receives only normalized build source and has no dependency on this adapter or package.

## Boundary

This package compiles input artifacts (playbooks, session plans) to ordinary build source. The engine consumes that source and has no dependency on `@eforge-build/input`. See [docs/architecture.md](../../docs/architecture.md) for the full package dependency diagram.

## Out of scope

- No daemon HTTP client - use `@eforge-build/client` for daemon-backed flows
- No engine queue knowledge - this package normalizes input before the engine sees it
- No new CRUD or tool API surface - wire-protocol additions belong in `@eforge-build/client`
- No conversational planning logic - eforge-plan contribution/workstation surfaces own structured planning conversations

## Stability

- Public exports are stability-promised within a major version.
- Breaking changes bump the major version and are noted in the release.
