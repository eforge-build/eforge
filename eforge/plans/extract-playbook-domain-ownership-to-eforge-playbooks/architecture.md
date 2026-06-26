# Extract Playbook Domain Ownership to eforge-playbooks

## Vision and goals

`eforge/extensions/eforge-playbooks` becomes the canonical and exclusive owner of playbook parsing, serialization, validation, storage, build-source compilation, planning seed extraction, and playbook-facing actions/commands/contributions. Core packages and host integrations keep only generic extension hosting, contribution discovery, action invocation, build intake, queueing, daemon/client transport, and generic contribution rendering.

This is a clean-break extraction. Removed host-owned command/tool/facade entry points are not replaced with compatibility shims.

## Current-state audit summary

The repository is not fully implemented against the source requirements. Significant current leaks include:

- `@eforge-build/input` exports `packages/input/src/playbook.ts` and `packages/input/src/playbook-plan-seed.ts`, and `session-plan.ts` still contains `createSessionPlanFromPlaybookSeed` and `seeded_from_playbook` behavior.
- `eforge-playbooks` delegates parser/storage/compiler/seed behavior back to `@eforge-build/input` instead of owning it.
- CLI, MCP, and Pi still expose host-owned playbook facades (`eforge playbook`, `eforge play`, `eforge_playbook`, `/eforge:playbook`) and helper maps of hard-coded `eforge-playbooks:*` action IDs.
- Claude/Pi skills still register playbook-specific skill surfaces, and docs/reference generation still describes those host facades.
- `packages/client/src/extension-agent-tasks.ts`, monitor task projection helpers, and eforge-plan task/workstation code still expose `playbookDraft` as a generic planning-task result field.
- eforge-plan declares a playbook-specific capability (`eforge.plan.planning-mode-playbook`) and prose around planning-mode playbook continuation.
- Several non-extension implementation comments/helpers contain playbook-specific names (`PLAYBOOK_NAME_RE`, session-plan agent-profile descriptions, engine/input architecture comments, scopes named-set examples).

## Core architectural principles

1. **Extension owns the domain.** All playbook model types, schemas, parsers, serializers, storage helpers, compiler helpers, plan-seed helpers, and playbook action schemas live under `eforge/extensions/eforge-playbooks`.
2. **Hosts invoke generic contributions only.** CLI, MCP, Pi, Claude plugin, Console, daemon, monitor, and client code do not register playbook-specific commands/tools/routes or maintain playbook action ID maps. They list/show/invoke extension contributions by generic APIs.
3. **Input package stays domain-neutral.** `@eforge-build/input` keeps session plans, session-plan sets, build-source normalization/preprocessing, and generic acceptance-criteria quality helpers. It exports no playbook-specific symbols.
4. **No compatibility layer.** Removed playbook host commands/tools/files are deleted rather than delegated.
5. **Planning task contracts are generic.** `playbookDraft` is removed from client/monitor/eforge-plan task result contracts. This architecture chooses deletion rather than a replacement generic artifact envelope because the source does not require a non-playbook artifact draft feature.
6. **Planning continuation capability is generic.** `eforge-playbooks` may depend on eforge-plan’s generic planning workstation/entry capability; eforge-plan does not declare a playbook-named capability.
7. **Boundary tests enforce the contract.** Source-wide tests fail on playbook-specific imports, exports, schemas, commands, tools, route helpers, wire fields, storage semantics, and `playbookDraft` outside the playbooks extension, with explicit allowlists for boundary documentation and boundary tests only.

## Shared data model

### Extension-owned playbook domain

Create focused domain modules under `eforge/extensions/eforge-playbooks` instead of moving the current 681-line input file as one oversized file:

- `model.ts` — playbook frontmatter/body types, Zod validation, `parsePlaybook`, `serializePlaybook`, `validatePlaybook`, parse errors, and mode mismatch errors.
- `storage-core.ts` — scoped path resolution, list/load/write/move/copy helpers using `@eforge-build/scopes` named-set APIs.
- `compile.ts` — `playbookToBuildSource`, `playbookToPlanSeed`, and JSON-safe seed data types.
- Existing action modules (`playbook-actions.ts`, `storage.ts`, `run-playbook-action.ts`, `planning.ts`, `json-safe.ts`) import these local modules.

The internal playbook shape remains compatible with current files:

```ts
type PlaybookScope = 'user' | 'project-team' | 'project-local';
type PlaybookMode = 'autonomous' | 'planning';

interface Playbook {
  name: string;
  description: string;
  scope: PlaybookScope;
  mode: PlaybookMode;
  profile?: string;
  postMerge?: string[];
  goal: string;
  outOfScope: string;
  acceptanceCriteria: string;
  plannerNotes: string;
}
```

Autonomous compilation returns generic build queue input data (`source`, optional `profile`, optional `postMerge`) to the extension action, which then uses the existing generic build intake/queueing API available to extension actions. Planning seed extraction returns extension-owned handoff metadata used only by `eforge-playbooks` action output. If that metadata is surfaced to hosts, it is surfaced as opaque extension action result data with generic render metadata, not as a host-owned playbook wire field.

### Domain-neutral session plans

`@eforge-build/input` keeps:

- `SessionPlan`, `SessionPlanDataWire`, and session-plan helper APIs.
- Generic `agent_profile` support as producer-neutral metadata.
- `normalizeBuildSource`, `preprocessBuildSource`, session-plan-set helpers, and acceptance-criteria quality helpers.

It removes:

- `playbook.ts` and `playbook-plan-seed.ts`.
- Playbook exports from `index.ts`.
- `createSessionPlanFromPlaybookSeed` and `CreateSessionPlanFromPlaybookSeedOpts`.
- `seeded_from_playbook` frontmatter schema behavior and docs.

### Generic host contribution contract

Producer side:

- `eforge-playbooks` registers playbook contributions in its extension manifest/action registry. Contribution/action IDs such as `eforge-playbooks:*` are opaque strings owned by the extension.
- Each contributed action provides display metadata, JSON input schema, JSON output/render metadata, and an action handler. The handler may call generic extension-context services such as build intake/queueing; it must not require host-specific playbook queue contracts.
- The representative playbook action set must cover list/show, create/update (current save flow), validate, copy, promote/demote, autonomous run, and planning run/plan handoff flows.

Consumer side:

- CLI: `eforge extension contributions list|show|invoke`.
- MCP/Claude: `eforge_extension_contribution` tool.
- Pi: `eforge_extension_contribution` tool and `/eforge:extensions` command.
- Console: extension contribution manifest rendering and `invokeExtensionAction`.
- Daemon/client/monitor: extension contribution manifest/action invocation APIs.

The generic contribution API shape is: discovery returns extension ID, contribution/action ID, display metadata, input schema, output/render metadata, and enablement/status; invocation accepts an opaque contribution/action ID plus JSON input and returns opaque JSON output plus generic events/render metadata. Hosts may render schemas, labels, descriptions, status, and returned metadata generically, but they must not branch on playbook action IDs, parse playbook models, or validate playbook storage semantics.

No host layer contains a playbook action map, playbook command parser, playbook-specific tool schema, playbook-specific route, or playbook storage/model validation.

## Integration contracts between modules

### playbook-domain-extraction → input-neutrality

- Producer: `playbook-domain-extraction` creates the local `eforge-playbooks` domain modules (`model.ts`, `storage-core.ts`, `compile.ts`) and rewires extension actions/tests away from `@eforge-build/input` playbook symbols.
- Consumer: `input-neutrality` deletes the old input playbook files and exports after the extension has equivalent local behavior.
- Contract: after the producer lands, no extension playbook behavior imports playbook symbols from `@eforge-build/input`; after the consumer lands, `@eforge-build/input` has no playbook exports for stale call sites to use.

### playbook-domain-extraction → host-surface-neutrality

- Producer: `eforge-playbooks` continues registering generic extension actions for list/show, create/update (save), validate, copy, promote/demote, run, and planning handoff flows.
- Consumer: host code discovers and invokes those actions only through generic contribution discovery/invocation APIs.
- Contract: host packages may render contribution metadata and JSON schemas, but must not import the extension package, its local domain modules, or a hard-coded map of `eforge-playbooks:*` action IDs.

### planning-contract-neutralization → playbook-domain-extraction

- Producer: eforge-plan exposes only generic planning entry/workstation capability metadata and generic contribution IDs/URLs; it no longer emits `playbookDraft` results or `eforge.plan.planning-mode-playbook` capability metadata.
- Consumer: `eforge-playbooks` planning-mode run output may refer to the generic eforge-plan planning entry/workstation contribution IDs and URLs, but it owns any playbook-specific handoff metadata itself.
- Contract: eforge-plan does not expose playbook-specific draft fields, capabilities, schema variants, or workstation types; eforge-playbooks does not depend on a playbook-named eforge-plan capability.

### boundary-docs-validation → all modules

- Producer: all code modules remove their assigned domain leaks and update their local tests.
- Consumer: `boundary-docs-validation` runs the final boundary audit, extension-enabled/disabled integration coverage, and docs/reference regeneration.
- Contract: remaining playbook references outside `eforge/extensions/eforge-playbooks` must be either boundary documentation explaining ownership or boundary tests enforcing ownership; all other references are failures that must be assigned back to the owning module or fixed in the boundary sweep when they are docs/tests/example-only references.

## Shared File Registry

No implementation source file is intentionally owned by more than one module. Module planners must keep this ownership split. Module-owned tests that live beside owned implementation files belong to that module; cross-cutting boundary/integration tests belong to `boundary-docs-validation`.

| File or group | Owner module | Region strategy |
|---|---|---|
| `eforge/extensions/eforge-playbooks/**` | `playbook-domain-extraction` | Single-owner edits; no plan-region markers required. Includes extension-local README/tests for moved playbook behavior. |
| `packages/input/**` | `input-neutrality` | Single-owner edits; delete playbook files and update neutral exports in one module. |
| `packages/client/src/extension-agent-tasks.ts`, `packages/client/src/api-version.ts`, monitor agent-task helpers, `eforge/extensions/eforge-plan/**` | `planning-contract-neutralization` | Single-owner edits for planning task contract neutralization and daemon API version bump. |
| `packages/eforge/src/cli/**`, `packages/pi-eforge/extensions/eforge/**`, `packages/pi-eforge/skills/**`, `eforge-plugin/**`, `packages/console-ui/src/**`, `packages/docs-gen/src/generators/tools.ts`, `scripts/check-skill-parity.mjs` | `host-surface-neutrality` | Single-owner host-surface removal. Bump `eforge-plugin/.claude-plugin/plugin.json` version in this module; do not bump `packages/pi-eforge/package.json`. |
| `docs/**`, `web/content/**`, `web/public/**`, `test/**` boundary tests, `packages/console-ui/**/__tests__/**`, `web/__tests__/**` | `boundary-docs-validation` | Single-owner docs/reference/boundary sweep after code modules. Does not edit docs generator source files owned by `host-surface-neutrality`. |

### Region Declarations

No shared source regions are predeclared. If module planners discover a required cross-module edit to a shared registry/barrel/config file, they must declare non-overlapping temporary plan regions using `// --- eforge:region plan-NN-slug ---` and `// --- eforge:endregion plan-NN-slug ---` in their detailed plans.

## Technical decisions and rationale

1. **Split the moved playbook implementation.** The current `packages/input/src/playbook.ts` is over the new-file policy limit. Splitting model/storage/compiler modules keeps files within maintainability limits and clarifies ownership.
2. **Keep acceptance-criteria quality generic.** `eforge-playbooks` may continue to call `@eforge-build/input` generic acceptance-criteria quality helpers, but it must not import playbook symbols from input. If direct dependency remains, package docs/tests must state that it is for domain-neutral quality helpers only.
3. **Delete host facades.** The old host commands/tools are removed instead of delegating to extension contributions. Users and agents invoke `eforge-playbooks:*` through generic contribution tools/commands.
4. **Remove `playbookDraft`, do not genericize yet.** No source requirement needs a generic artifact draft feature. Removing the field narrows the planning-task contract and eliminates the leak. A future generic artifact envelope can be introduced from a separate source document.
5. **Use eforge-plan’s existing generic planning workstation capability.** Planning-mode playbooks depend on generic eforge-plan planning entry/workstation availability, not a playbook-named capability.
6. **Bump daemon API version for client task contract removal.** Removing `playbookDraft` from client/monitor extension-agent-task wire schemas is a breaking API contract change.
7. **Generated docs are outputs, not hand-authored sources.** `host-surface-neutrality` updates docs generator source that enumerates removed commands/tools; `boundary-docs-validation` then runs docs generation/checks so `web/public/**` and reference pages match removed commands/tools.

## Module details

### Module: playbook-domain-extraction

Scope:

- Create extension-local domain modules for parse/serialize/validate/storage/compile/plan seed behavior.
- Rewire `playbook-actions.ts`, `storage.ts`, `run-playbook-action.ts`, `planning.ts`, and `json-safe.ts` away from `@eforge-build/input` playbook imports.
- Update `eforge/extensions/eforge-playbooks/package.json`, `tsup.config.ts`, tests, and README.
- Add direct dependencies required by moved helpers (`@eforge-build/scopes`, `yaml`, `zod`) and keep only domain-neutral input imports if acceptance-criteria quality helpers remain in input.
- Update extension registration tests for the generic eforge-plan planning capability.

Verification targets:

- Extension tests cover parse, serialize, validate, list, load, write, move, copy, autonomous compile, and planning seed extraction through extension-owned modules.
- `rg "@eforge-build/input" eforge/extensions/eforge-playbooks -g '*.ts'` returns only explicitly documented domain-neutral helper imports, if any; no import clause from `@eforge-build/input` contains `playbook`, `Playbook`, `parsePlaybook`, `serializePlaybook`, `validatePlaybook`, `playbookToBuildSource`, or `playbookToPlanSeed`.
- The eforge-playbooks workspace type-check target, or root `pnpm type-check` when no package-specific script exists, exits 0.

### Module: input-neutrality

Scope:

- Delete `packages/input/src/playbook.ts` and `packages/input/src/playbook-plan-seed.ts`.
- Remove playbook exports, package docs, and package description claims from `@eforge-build/input`.
- Remove playbook-specific session-plan seed helper and `seeded_from_playbook` schema behavior.
- Keep `agent_profile` as generic producer metadata and update comments in input/client/monitor docs to avoid playbook-specific wording.
- Remove direct `@eforge-build/scopes` dependency from `packages/input/package.json` if no remaining source uses it.
- Move or rewrite root playbook domain tests so domain behavior is tested under `eforge/extensions/eforge-playbooks`.

Verification targets:

- `Object.keys(await import('@eforge-build/input'))` contains no names matching `/playbook/i`.
- `test/playbook-input-boundary.test.ts` asserts no playbook files or exports exist in `@eforge-build/input`.
- Session-plan tests assert `agent_profile` round-trips as generic metadata and `seeded_from_playbook` is absent from serialized session plans.

### Module: planning-contract-neutralization

Scope:

- Remove `playbookDraft` requested-output literals, schemas, result variants, type exports, and helper checks from `packages/client/src/extension-agent-tasks.ts`.
- Bump `DAEMON_API_VERSION` for the breaking task contract change.
- Update monitor extension agent-task output counting and storage validation to the new contract.
- Update eforge-plan task schemas, submission tool schema, prompt template, action projection, workstation types/fixtures/UI logic, and tests to remove `playbookDraft`.
- Remove the eforge-plan `eforge.plan.planning-mode-playbook` capability and replace descriptions with generic planning entry/workstation wording.

Verification targets:

- `rg "playbookDraft|PlanningPlaybookDraft|planning-mode-playbook" packages/client packages/monitor eforge/extensions/eforge-plan -g '*.ts' -g '*.tsx' -g '*.md' -g 'package.json'` reports zero non-test implementation hits, except boundary docs/tests if explicitly allowed.
- Client extension-agent-task tests cover accepted result variants without `playbookDraft`.
- eforge-plan registration tests assert generic planning workstation capability metadata only.

### Module: host-surface-neutrality

Scope:

- Delete CLI playbook command registration (`eforge playbook`, `eforge play`) and CLI playbook helper modules.
- Delete MCP `eforge_playbook` tool and imports from the MCP proxy.
- Delete Pi `eforge_playbook` tool, `/eforge:playbook` command, playbook contribution helper modules, and playbook-specific landing helper exports.
- Remove Pi and Claude playbook skills from package registrations and skill parity checks, or convert any remaining documentation to generic extension contribution guidance without registering a playbook command/skill.
- Remove any Console implementation hard-coding of playbook contribution IDs, playbook routes, or playbook-specific UI affordances; Console may only render extension-provided metadata through the generic contribution UI.
- Update docs generator source that enumerates host commands/tools so removed playbook facades disappear from generated references.
- Bump `eforge-plugin/.claude-plugin/plugin.json` version for plugin changes. Do not bump `packages/pi-eforge/package.json`.
- Update host tests to assert absence of playbook commands/tools and continued availability of generic extension contribution list/show/invoke flows.

Verification targets:

- CLI help/tests contain no `playbook` command or `play` alias.
- MCP/Pi tool extraction contains no `eforge_playbook` tool.
- Pi command registration contains no `eforge:playbook` command.
- Claude plugin `commands` omits the playbook skill path, and skill parity passes without a playbook pair.
- Console implementation contains no hard-coded playbook contribution IDs, playbook routes, or playbook-specific UI affordances outside boundary tests/docs.

### Module: boundary-docs-validation

Scope:

- Add or strengthen a source-wide boundary audit that classifies playbook references outside `eforge/extensions/eforge-playbooks` as allowed boundary-doc/boundary-test references or leaks.
- Add targeted enabled-extension tests for list/create/save/run/planning flows through extension contributions.
- Add targeted disabled/absent-extension tests proving core/host packages register no playbook commands/tools and generic contribution lookup returns no playbook UX unless the extension is loaded.
- Update Console tests to assert playbook UI appears only through generic extension contribution rendering.
- Update architecture docs, public docs, README sections outside `eforge/extensions/eforge-playbooks`, and generated reference artifacts to describe `eforge-playbooks` as sole playbook domain owner and to remove old host-facade instructions.
- Update scopes tests/docs to use neutral named-set examples instead of `playbooks/` where they are not explicitly boundary docs.

Verification targets:

- Boundary tests fail on playbook-specific imports, exports, schemas, commands, tools, route helpers, model helpers, storage semantics, `playbookDraft`, and `playbookDraft`-like wire fields outside the playbooks extension.
- `pnpm docs:check` exits 0 after regeneration.
- `pnpm maintainability:check`, `pnpm type-check`, `pnpm build`, and `pnpm test` exit 0 after all modules merge.

## Quality attributes

- **Boundary clarity:** Core and host packages contain no playbook domain code after the final audit.
- **Replaceability:** Disabling/removing `eforge-playbooks` removes playbook UX without changing the engine, daemon, client, Console, CLI, MCP, Pi, or plugin code paths.
- **Type safety:** Removed exports and wire fields create TypeScript errors in stale call sites.
- **User-facing consistency:** Playbook list/create/run/plan flows use one contribution path across CLI, MCP, Pi, Console, and docs.
- **Maintainability:** New files stay within repository file-size policy; large existing files use bounded edits.
- **Clean break:** Old host command/tool names are absent, not deprecated wrappers.

## Final validation commands

Run from the repository root after all modules merge:

```bash
pnpm maintainability:check
pnpm type-check
pnpm build
pnpm test
pnpm docs:check
```
