# eforge-playbooks Extension

`eforge-playbooks` is the first-party extension that owns reusable playbook management and playbook execution handoff. It exposes playbook inventory, CRUD-style management, validation, scope moves, planning-mode handoff metadata, and autonomous build-queue enqueue through generic extension actions.

The extension owns its playbook parser, serializer, validation, scope-aware storage, compiler, and planning-seed extraction locally. `@eforge-build/input` remains a dependency only for domain-neutral acceptance-criteria quality helpers. The extension does not add direct daemon playbook routes, Console core sections, queue internals, or host-specific command implementations. Hosts discover and invoke the extension through normal extension action, integration-command, capability, and Console contribution metadata.

## Trust model

Extensions run as project-team code. Install and enable `eforge-playbooks` only in repositories where you trust the extension source and the team-maintained playbook content.

`eforge-playbooks` is not a sandbox boundary. Actions can read and write playbook files in project-local, project-team, and user scopes, and `run-playbook` can enqueue autonomous builds through the generic build queue. Review extension changes with the same care as build tooling, scripts, or other automation that runs in the repository.

Playbooks are reusable build-input artifacts. Treat them as executable workflow intent: a playbook can define normalized build source, profile defaults, post-merge commands, and a planning or autonomous mode.

## Install and manage

`eforge-playbooks` is published as the first-party npm package `@eforge-build/eforge-playbooks`. The package declares `eforge.extension.name: "eforge-playbooks"` and loads from the compiled runtime entrypoint `./dist/index.js`.

```bash
# Install from npm into the default local scope (.eforge/extensions/)
eforge extension install @eforge-build/eforge-playbooks

# Install from a local package directory or packed tarball after building
eforge extension install ./eforge/extensions/eforge-playbooks
eforge extension install ./eforge/extensions/eforge-playbooks/eforge-build-eforge-playbooks-<version>.tgz

# Install into the project/team scope and trust the reviewed artifact
eforge extension install @eforge-build/eforge-playbooks --scope project --trust
```

Scope behavior follows normal extension management rules:

- `local` (default) installs under `.eforge/extensions/` and loads without a project/team trust record.
- `project` installs under `eforge/extensions/`; each user must inspect and run `eforge extension trust eforge-playbooks`, or install/update with `--trust`, before it loads.
- `user` installs under the user eforge config directory and is trusted for that user.

Common lifecycle commands:

```bash
eforge extension validate eforge-playbooks
eforge extension trust eforge-playbooks
eforge extension reload
eforge extension show eforge-playbooks

eforge extension update eforge-playbooks
eforge extension update eforge-playbooks --version latest
eforge extension remove eforge-playbooks
```

The npm artifact contains the compiled runtime in `dist/`, `README.md`, `LICENSE`, and package metadata. Tests and development config are not part of the runtime artifact.

## Declared capabilities

The package manifest declares two stable first-party capabilities:

- `eforge.playbooks.management` version `1.0.0` — the extension owns playbook inventory, validation, copy, save, promote, and demote actions.
- `eforge.playbooks.run` version `1.0.0` — the extension owns playbook execution handoff for autonomous and planning-mode playbooks.

The extension declares an optional dependency on provider `eforge-plan` with capability `eforge.plan.planning-workstation` satisfying `>=1.0.0`. Planning-mode playbooks use that generic planning workstation capability when available, but the extension still loads without it and returns diagnostics instead of enqueueing a build.

## Extension-owned playbook domain

`eforge-playbooks` is the implementation owner for playbook domain behavior:

- `model.ts` defines the playbook frontmatter and body model, schemas, parsing, serialization, validation, and mode mismatch errors.
- `storage-core.ts` resolves named-set storage locations, lists and loads playbooks, writes scoped files, and performs copy, promote, and demote moves while preserving existing shadowing behavior.
- `compile.ts` converts autonomous playbooks to normalized build source and planning playbooks to JSON-safe planning seeds.

The package entrypoint exposes the extension contribution surface, not these domain helpers as host-facing APIs. Runtime imports from `@eforge-build/input` are limited to `analyzeAcceptanceCriteria`, `analyzeAcceptanceCriteriaInBody`, and `formatAcDiagnostics`.

## Actions

Registered action IDs are local to the extension and are exposed with effective IDs such as `eforge-playbooks:run-playbook`. Integration commands mirror the same eight local IDs so hosts can discover the same capabilities through command metadata.

| Action | Purpose | Side effects |
| --- | --- | --- |
| `list-playbooks` | List playbooks from project-local, project-team, and user scopes. Supports optional `scope`, `mode`, and `includeShadowed`; shadowed entries are included by default. | `local-read` |
| `show-playbook` | Show the highest-precedence playbook by name, or an exact scoped copy when `scope` is supplied. | `local-read` |
| `save-playbook` | Save a playbook from raw Markdown, nested `{ playbook: { frontmatter, body } }`, or flattened fields. Defaults `overwrite` to `true` and validates acceptance criteria before writing. | `local-write` |
| `validate-playbook` | Validate raw playbook Markdown without filesystem writes. This preserves raw validation semantics and does not run the save/run acceptance-criteria quality gate. | `none` |
| `copy-playbook` | Copy a playbook to another scope, updating frontmatter `scope`; `overwrite` defaults to `true` (set `false` to reject existing destinations). | `local-read`, `local-write` |
| `promote-playbook` | Move a playbook from `project-local` to `project-team`; `overwrite` defaults to `true` (set `false` to reject existing destinations). | `local-write` |
| `demote-playbook` | Move a playbook from `project-team` to `project-local`; `overwrite` defaults to `true` (set `false` to reject existing destinations). | `local-write` |
| `run-playbook` | Resolve and run a playbook. Autonomous playbooks compile to normalized build source and enqueue through the generic build queue. Planning-mode playbooks return eforge-plan planning entry metadata or diagnostics and never enqueue. | `local-read`, `daemon-state`, `build-queue` |

Common action input forms:

```json
{ "scope": "project-team", "mode": "autonomous", "includeShadowed": false }
```

```json
{ "name": "weekly-maintenance", "scope": "project-local" }
```

```json
{
  "scope": "project-team",
  "playbook": {
    "frontmatter": {
      "name": "weekly-maintenance",
      "description": "Run routine maintenance",
      "mode": "autonomous",
      "profile": "excursion"
    },
    "body": {
      "goal": "Update routine maintenance checks.",
      "acceptanceCriteria": "Maintenance checks are documented and pass."
    }
  },
  "overwrite": true
}
```

```json
{
  "name": "weekly-maintenance",
  "mode": "autonomous",
  "profile": "excursion",
  "afterQueueId": "session_123",
  "landingAction": "pr",
  "landingAutoMerge": false
}
```

`save-playbook` accepts exactly one payload shape: `raw` Markdown, the nested `{ "playbook": { "frontmatter", "body" } }` form, or flattened playbook fields (`name`, `description`, `mode`, `profile`, `postMerge`, `goal`, `outOfScope`, `acceptanceCriteria`, and `plannerNotes`). When a top-level `name` is supplied, it must match the parsed or structured playbook name. `run-playbook` rejects a supplied `mode` when it differs from the playbook frontmatter mode.

## Planning-mode behavior

A playbook whose frontmatter mode is `planning` is an investigation-first handoff. `run-playbook` converts the playbook to a JSON-safe planning seed and checks:

```text
eforge.plan.planning-workstation >=1.0.0
```

When the optional `eforge-plan` provider is available, the action returns `kind: "requires-agent"` with planning entry metadata for `eforge-plan:open-planning-entry`, workstation `eforge-plan:planning-workstation`, and workstation URL `/console/workstations/eforge-plan%3Aplanning-workstation`.

When the provider is unavailable, the action returns `kind: "planning-unavailable"` with diagnostics and guidance to install, trust, and reload `eforge-plan`. It does not create session plans, enqueue PRDs, or call the build queue.

Planning seed output is JSON-safe: section maps are projected to plain objects, and undefined values are omitted.

## Autonomous queue handoff

A playbook whose frontmatter mode is `autonomous` compiles to normalized build source using the extension-local compiler. Before enqueueing, `run-playbook` runs the existing domain-neutral acceptance-criteria quality gate from `@eforge-build/input` against the compiled source. Invalid criteria fail as user-visible invalid input.

Autonomous handoff uses only the generic build queue API:

```ts
ctx.buildQueue.enqueue({
  source,
  profile,
  postMerge,
  afterQueueId,
  landingAction,
  landingAutoMerge,
});
```

`profile` defaults to the compiled playbook profile when the action input does not override it. `postMerge`, `afterQueueId`, `landingAction`, and `landingAutoMerge` are passed through to generic queue validation. Queue validation failures remain invalid-input action failures; unexpected daemon/runtime enqueue errors propagate as handler errors.

The success result is `kind: "enqueued"` and aliases `id` to `sessionId`.

## Console contribution

`eforge-playbooks` contributes playbook management declaratively through extension Console metadata rather than a core Console section or a packaged workstation bundle. The contribution includes a Markdown summary plus action controls for listing, showing, saving, validating, copying, promoting, demoting, and running playbooks.

Console action bindings reference the canonical effective action IDs owned by this extension, such as `eforge-playbooks:list-playbooks` and `eforge-playbooks:run-playbook`.

## Storage model

Playbook storage is resolved by the extension-local storage layer through `@eforge-build/scopes` named-set APIs with the daemon-provided project root and config directory:

- project-local playbooks live under `.eforge/playbooks/`;
- project-team playbooks live under `eforge/playbooks/`;
- user playbooks live under the user's eforge config directory.

Higher-precedence scopes shadow lower-precedence copies with the same playbook name. `show-playbook` without a scope returns the highest-precedence copy; exact-scope actions fail with a not-found user error when that scope lacks the requested playbook.

The extension imports public `@eforge-build/extension-sdk` APIs, `@eforge-build/scopes` named-set helpers, and only the domain-neutral acceptance-criteria helpers from `@eforge-build/input` for runtime behavior. It does not import playbook-specific input symbols, the legacy playbook workflow adapter, or use `builtin:playbooks`.
