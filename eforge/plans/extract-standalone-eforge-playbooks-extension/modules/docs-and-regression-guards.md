# Docs and Regression Guards

## Architecture Reference

This module implements the architecture sections **Documentation**, **Quality attributes**, and the final audit portions of **Integration contracts by subsystem**. It also provides acceptance-level regression coverage across the modules that already moved behavior into `eforge-playbooks`, migrated hosts, and removed the core Console Playbooks surface.

Key constraints from architecture:
- Public/user docs must describe playbooks as first-party `eforge-playbooks` extension-owned workflow behavior, not daemon/client/kernel-owned behavior.
- Docs must not present `/api/playbook/*`, `apiPlaybook*`, `API_ROUTES.playbook*`, or `sessionPlanCreateFromPlaybook` as supported entrypoints.
- Generated reference docs must be regenerated after direct route/helper removal so the HTTP API reference contains no playbook route keys.
- Final guards must catch regressions in direct daemon routes, playbook-specific client helpers, core Console `PlaybooksSection` ownership, `builtin:playbooks` workflow-adapter ownership language, planning dependency drift, extension-unavailable diagnostics, package registration, and cross-host parity.
- Tests must not reintroduce direct playbook route literals or duplicate playbook daemon wire shapes.
- Host behavior edits belong to `host-migration`; Console behavior edits belong to `console-surface`; direct client/daemon deletion belongs to `boundary-removal`; extension action behavior belongs to `playbooks-extension`.

Dependency note:
- The supplied module dependency list names `host-migration` and `console-surface`, but the architecture graph places `boundary-removal` before this module. Implement this module only after boundary-removal is present, or stop with a blocker. The docs and final audits cannot pass while `API_ROUTES.playbook*`, `/api/playbook/*`, `sessionPlanCreateFromPlaybook`, monitor playbook routes, or core Console Playbooks state remain.

## Scope

### In Scope
- Update source docs that describe playbook ownership, host usage, profile behavior, configuration, extension boundaries, integrations, concepts, glossary entries, architecture, release notes, and README narrative.
- Update docs-generator source text for API and tool references so generated artifacts no longer describe playbook routes as daemon/client APIs.
- Regenerate checked-in reference artifacts and public docs mirrors with `pnpm docs:generate`.
- Add final source-audit tests for direct route/helper/workflow-adapter/Core Console ownership removal.
- Add package-registration and lockstep-publish regression guards for `@eforge-build/eforge-playbooks`.
- Add docs regression guards that require `eforge-playbooks` extension-owned wording and forbid stale bundled-adapter/direct-route wording.
- Update the root planning-mode playbook contract test to exercise `eforge-playbooks:run-playbook` through extension action dispatch instead of deleted daemon routes.
- Add static cross-host parity guards for CLI/MCP/Pi/skill playbook surfaces after host migration.
- Update existing docs/platform tests whose assertions still assume bundled playbook adapters or direct playbook route keys.

### Out of Scope
- Implementing `eforge-playbooks` actions, schemas, capabilities, Console contribution registration, or package-local tests.
- Migrating CLI/MCP/Pi command/tool implementations or changing skill behavior; this module only verifies host-migration results and updates non-skill public docs.
- Removing daemon/client route files, client exports, or monitor handlers.
- Removing Console System Playbooks state/rendering.
- Reintroducing compatibility `/api/playbook/*` routes, `apiPlaybook*` wrappers, or session-plan-from-playbook helpers under new names.
- Bumping `eforge-plugin/.claude-plugin/plugin.json` or `packages/pi-eforge/package.json`.
- Changing eforge-plan planning workflows beyond checking that the playbook handoff metadata still matches eforge-plan registrations.

## Implementation Approach

### Overview

Run this module as the final boundary pass. Start with a source audit to confirm the upstream migration modules landed. Then rewrite the public docs around this new boundary: `eforge-playbooks` owns playbook list/show/save/validate/copy/promote/demote/run behavior, host compatibility commands delegate to generic extension contribution invocation, the Console shows playbook management through extension contributions/workstations, and the daemon/client HTTP API no longer has playbook-specific routes.

After source docs are updated, adjust docs-generator prose and run `pnpm docs:generate` so `web/content/reference/*`, `web/public/reference/*`, `web/public/docs/*`, `web/public/llms.txt`, and `web/public/llms-full.txt` reflect the new surface. Finally, add final regression tests that combine positive checks for the extension-owned path with negative checks for stale daemon/client/Console/kernel ownership tokens.

### Key Decisions

1. **Use docs as the canonical user-facing boundary statement.**
   - Rationale: acceptance requires no direct daemon/client playbook APIs to be documented as supported. The playbooks guide and integrations guide must tell users to use host commands, `eforge_playbook`, or generic extension contribution invocation for `eforge-playbooks:*`.

2. **Regenerate generated artifacts instead of hand-editing them.**
   - Rationale: `docs:check` is the drift gate. Update `packages/docs-gen/src/*` and source docs, then let `pnpm docs:generate` rewrite generated references and public mirrors.

3. **Use final audit tests with explicit scan roots and constructed forbidden route fragments.**
   - Rationale: tests must catch boundary regressions without teaching new code to depend on direct route literals. Build forbidden direct-route regexes from fragments inside tests and scan source/docs directories while excluding generated plans, `node_modules`, and `dist`.

4. **Test planning behavior through extension action dispatch, not HTTP routes.**
   - Rationale: `/api/playbook/run` is gone. The root planning contract test must dispatch `eforge-playbooks:run-playbook`, inject fake capability registries/build queues, and assert planning outputs plus zero queue calls.

5. **Keep skill files owned by host migration.**
   - Rationale: the host module owns Claude/Pi playbook skill text and plugin versioning. This module adds final static assertions over those files but does not edit them unless the host migration result is missing.

6. **Distinguish first-party `eforge-playbooks` from user-authored custom extraction.**
   - Rationale: extension-platform docs can now say a shipped first-party native extension owns playbook behavior while still stating that arbitrary user-authored custom playbook extraction/registration APIs remain unsupported.

## Files

### Create
- `test/playbook-extension-final-boundary.test.ts` — final source-audit and package-registration guard. It scans client, monitor, input, host, Console, docs, generated reference, and skill surfaces for removed direct playbook ownership tokens; asserts `eforge-playbooks` package/workspace/lockstep/lockfile metadata; asserts hosts use generic contribution IDs; asserts core Console playbook ownership files/tokens are absent.
- `test/playbook-extension-docs-boundary.test.ts` — docs-focused guard requiring source docs and generated references to describe `eforge-playbooks` as extension-owned, requiring generic contribution/action examples, and rejecting stale direct route/bundled-adapter/internal-ownership language.

### Modify
- `README.md` — replace bundled playbook workflow-adapter and daemon compatibility wording with `eforge-playbooks` extension ownership; keep user command examples; add unavailable-extension guidance for `eforge-playbooks` and eforge-plan planning capability.
- `docs/architecture.md` — update system diagrams, allowed dependency prose, Monitor/Pi/Plugin sections, and package topology so playbooks flow through `eforge-playbooks` actions plus pure `@eforge-build/input` helpers and generic queue handoff; delete direct playbook route/client/monitor adapter paragraph `[region: docs-and-regression-guards, architecture playbook boundary and diagrams]`.
- `docs/config.md` — update Native extensions runtime support and Playbooks/Profile sections to say `eforge-playbooks` owns playbook management/run actions, uses pure input artifact helpers, and returns eforge-plan handoff metadata for planning playbooks `[region: docs-and-regression-guards, native extensions and playbook profile sections]`.
- `docs/extensions.md` — split playbooks from session-plan compatibility in the extension-surface table, add an optional first-party `@eforge-build/eforge-playbooks` package section, document action/contribution ownership, and preserve user-authored custom extraction as unsupported `[region: docs-and-regression-guards, extension platform playbook ownership sections]`.
- `docs/extensions-api.md` — update storage-helper/runtime-support text so shipped playbook behavior is first-party extension-owned, not a bundled internal adapter; keep user-authored custom extraction unsupported and raw extension-owned HTTP routes unsupported `[region: docs-and-regression-guards, API boundary and runtime support prose]`.
- `docs/releasing.md` — include `@eforge-build/eforge-playbooks` in lockstep publish/release verification wording and package smoke-check notes `[region: docs-and-regression-guards, first-party extension release wording]`.
- `docs/roadmap.md` — remove future wording that assumes direct built-in playbook compatibility surfaces still need deprecation; keep user-authored custom playbook/session-plan extraction as future work `[region: docs-and-regression-guards, native extension deferred workflow bullets]`.
- `web/content/docs/playbooks.md` — add a boundary section naming `eforge-playbooks`, list the canonical `eforge-playbooks:*` actions, show generic contribution invocation examples for list/run/copy, update planning-mode output shapes, replace “daemon returns” wording with “extension action returns”, document extension-unavailable diagnostics, and note Console management via extension contributions/workstations `[region: docs-and-regression-guards, full playbooks guide extension-owned rewrite]`.
- `web/content/docs/extensions.md` — mirror the root `docs/extensions.md` playbook ownership updates with public-site links and examples `[region: docs-and-regression-guards, public extension platform playbook ownership sections]`.
- `web/content/docs/extensions-api.md` — mirror the root `docs/extensions-api.md` runtime/support boundary updates `[region: docs-and-regression-guards, public extension API playbook boundary prose]`.
- `web/content/docs/configuration.md` — update Native Extensions and Playbook Profiles text so playbook execution is `eforge-playbooks` action behavior and planning profile inheritance happens through eforge-plan handoff metadata `[region: docs-and-regression-guards, public config native extension and playbook profile sections]`.
- `web/content/docs/integrations.md` — state that CLI/MCP/Pi playbook commands/tools are compatibility surfaces over `eforge-playbooks:*`; update the daemon HTTP API section to say direct playbook-specific routes are absent and integrations must use generic extension contribution/action routes `[region: docs-and-regression-guards, host playbook and daemon API sections]`.
- `web/content/docs/getting-started.md` — describe playbooks as first-party `eforge-playbooks` extension-owned optional workflow behavior and keep eforge-plan as the planning continuation dependency `[region: docs-and-regression-guards, optional producers section]`.
- `web/content/docs/concepts.md` — update normalized build-source boundary and Playbooks concept to name `eforge-playbooks` as producer/owner `[region: docs-and-regression-guards, normalized boundary and playbook concept]`.
- `web/content/docs/profiles.md` — update profile precedence prose so playbook `profile:` is applied by `eforge-playbooks:run-playbook` before generic queue handoff `[region: docs-and-regression-guards, profile precedence playbook item]`.
- `web/content/docs/glossary.md` — update the Playbook definition to state first-party extension ownership and planning handoff shape `[region: docs-and-regression-guards, Playbook glossary entry]`.
- `packages/docs-gen/src/generators/api.ts` — replace the generated route-table note that names `playbook*` route keys with wording that only session-plan/session-plan-set remain daemon API producer surfaces and playbooks use generic extension contribution/action routes `[region: docs-and-regression-guards, API reference generator boundary note]`.
- `packages/docs-gen/src/generators/tools.ts` — update the generated tools-reference intro so `eforge_playbook` is described as a compatibility facade over `eforge-playbooks` extension contributions; remove stale session-plan create-from-playbook language from expected generated text after host migration `[region: docs-and-regression-guards, tools reference generator boundary note]`.
- `packages/docs-gen/src/manifest.ts` — update LLM manifest overview, Playbooks guide description, package/optional links if needed, and generated `llms` wording so `eforge-playbooks` is visible as a first-party extension-owned workflow surface `[region: docs-and-regression-guards, LLM manifest playbook descriptions]`.
- `test/docs-kernel-boundary.test.ts` — update assertions that still expect playbook route keys in API generator prose; require `eforge-playbooks` extension-owned wording and keep optional workflow grouping for `/docs/playbooks.md`.
- `test/extension-platform-docs-examples.test.ts` — update deferred-boundary assertions to distinguish shipped `eforge-playbooks` from unsupported user-authored custom playbook extraction; require generated references to keep generic extension contribution routes and omit playbook-specific HTTP routes.
- `test/skills-docs-wiring.test.ts` — add final skill-doc assertions for `eforge-playbooks`, `eforge-playbooks:run-playbook`, `eforge-playbooks:copy-playbook`, host-specific generic contribution tool names, absent direct route text, absent `create-from-playbook`, and unchanged Pi package version `[region: docs-and-regression-guards, final playbook skill boundary assertions outside host-migration regions]`.
- `test/eforge-playbook-planning-contract.test.ts` — rewrite the root planning contract from direct `API_ROUTES.playbookRun` monitor-route calls to `dispatchExtensionAction` calls against `eforge-playbooks:run-playbook`; assert planning available/unavailable outputs, capability metadata, eforge-plan contribution/workstation IDs, JSON-safe seed, and zero build-queue calls for planning mode `[region: docs-and-regression-guards, extension-action planning contract migration]`.
- `web/content/reference/api.md`, `web/public/reference/api.md` — regenerated by `pnpm docs:generate`; no playbook route keys or `/api/playbook` paths remain.
- `web/content/reference/tools.md`, `web/public/reference/tools.md` — regenerated by `pnpm docs:generate`; `eforge_playbook` descriptions mention extension delegation and `copy`, and `eforge_session_plan` descriptions omit `create-from-playbook`.
- `web/content/reference/cli.md`, `web/public/reference/cli.md` — regenerated by `pnpm docs:generate`; CLI playbook descriptions use extension-owned language produced by host migration.
- `web/content/reference/config.md`, `web/public/reference/config.md`, `web/content/reference/events.md`, `web/public/reference/events.md`, `web/public/schemas/config.schema.json`, `web/public/schemas/events.schema.json` — regenerated if their inputs drift; keep checked in output byte-identical to generator output.
- `web/public/docs/getting-started.md`, `web/public/docs/concepts.md`, `web/public/docs/configuration.md`, `web/public/docs/extensions.md`, `web/public/docs/extensions-api.md`, `web/public/docs/glossary.md`, `web/public/docs/profiles.md`, `web/public/docs/playbooks.md`, `web/public/docs/integrations.md`, `web/public/docs/eforge-plan.md`, `web/public/docs/stacking.md`, `web/public/docs/troubleshooting.md` — regenerated public mirrors.
- `web/public/llms.txt`, `web/public/llms-full.txt` — regenerated LLM bundles with no stale direct playbook route or bundled adapter language.

## Implementation Details

### Documentation updates

Use these source-of-truth wording rules across docs:

- “`eforge-playbooks` owns playbook management and run behavior.”
- “`@eforge-build/input` keeps pure playbook parse/serialize/list/load/write/move/copy/validate/compile/seed helpers.”
- “Autonomous playbooks enqueue through `ctx.buildQueue.enqueue(...)` via generic extension action handoff.”
- “Planning playbooks check `eforge.plan.planning-mode-playbook` from `eforge-plan` and return `planningEntry` metadata or unavailable diagnostics; they do not create session plans or enqueue PRDs.”
- “CLI/MCP/Pi/Claude/Pi skills keep compatibility commands/tools, but those call `eforge-playbooks:*` through generic extension contribution/action invocation.”
- “Console playbook management is displayed through extension contributions/workstations, not a core System Playbooks section.”
- “Direct `/api/playbook/*`, `apiPlaybook*`, and create-from-playbook daemon/client APIs are removed.”

Use these canonical action IDs in docs and tests:

- `eforge-playbooks:list-playbooks`
- `eforge-playbooks:show-playbook`
- `eforge-playbooks:save-playbook`
- `eforge-playbooks:validate-playbook`
- `eforge-playbooks:copy-playbook`
- `eforge-playbooks:promote-playbook`
- `eforge-playbooks:demote-playbook`
- `eforge-playbooks:run-playbook`

For planning metadata, docs and tests must use:

- required capability provider/id/range: `eforge-plan`, `eforge.plan.planning-mode-playbook`, `>=1.0.0`
- planning contribution: `eforge-plan:open-planning-entry`
- workstation id: `eforge-plan:planning-workstation`
- workstation URL: `/console/workstations/eforge-plan%3Aplanning-workstation`

### Final boundary audit test

`test/playbook-extension-final-boundary.test.ts` should include:

- A recursive text-file walker that skips `node_modules`, `dist`, `.git`, `.eforge`, `.next`, generated plan worktrees, and `eforge/plans/`.
- Negative scans over non-test source directories for these tokens/patterns:
  - direct route fragment built from `'/api/' + 'playbook'`
  - `apiPlaybook`
  - `API_ROUTES.playbook`
  - `PlaybookListResponse`
  - `PlaybookRunRequest`
  - `sessionPlanCreateFromPlaybook`
  - `create-from-playbook`
  - `createPlaybookWorkflowAdapter`
  - `PLAYBOOK_WORKFLOW_ADAPTER_DESCRIPTOR`
  - `builtin:playbooks`
  - `PlaybooksSection`
  - `fetchSystemPlaybookList`
  - `selectPlaybookModeCounts`
- Explicit absence checks for deleted files:
  - `packages/client/src/api/playbook.ts`
  - `packages/client/src/routes/playbook.ts`
  - `packages/monitor/src/routes/playbooks.ts`
  - `packages/monitor/src/routes/playbook-service.ts`
  - `packages/input/src/playbook-workflow.ts`
  - `packages/console-ui/src/views/system/playbooks-section.tsx`
- Positive package checks:
  - `pnpm-workspace.yaml` contains `eforge/extensions/eforge-playbooks`.
  - `scripts/lib/lockstep-version.mjs` contains `eforge/extensions/eforge-playbooks/package.json`.
  - `pnpm-lock.yaml` contains an importer for `eforge/extensions/eforge-playbooks`.
  - `eforge/extensions/eforge-playbooks/package.json` declares `@eforge-build/eforge-playbooks`, `eforge.extension.name: eforge-playbooks`, `./dist/index.js`, public capabilities `eforge.playbooks.management` and `eforge.playbooks.run`, optional eforge-plan capability dependency, and `publishConfig.access: public`.
  - Root `package.json` contains `type-check:eforge-playbooks` if the extension-package module adds that convenience script.
- Positive host checks:
  - CLI and Pi playbook contribution helpers define all eight `eforge-playbooks:*` IDs.
  - MCP and Pi native `eforge_playbook` schemas include `copy`.
  - MCP and Pi native `eforge_session_plan` schemas omit `create-from-playbook` and `playbook_name`.
  - Claude and Pi playbook skills mention `eforge-playbooks`, `eforge-playbooks:run-playbook`, `eforge-playbooks:copy-playbook`, and their host-specific generic contribution tools.

### Docs boundary test

`test/playbook-extension-docs-boundary.test.ts` should include:

- Source docs positive checks for `eforge-playbooks`, generic contribution invocation, extension-unavailable diagnostics, and Console extension contribution/workstation wording in `README.md`, `web/content/docs/playbooks.md`, `web/content/docs/extensions.md`, `web/content/docs/extensions-api.md`, `web/content/docs/configuration.md`, `web/content/docs/integrations.md`, and root `docs/*` counterparts.
- Source docs negative checks for stale phrases such as “bundled playbook workflow adapter”, “playbook adapter owns”, “daemon compatibility service calls that adapter”, “client-owned HTTP routes”, `POST /api/playbook/copy`, `apiPlaybook`, and `create-from-playbook`.
- Generated reference checks:
  - API reference contains `extensionContributionManifest` and `extensionActionInvoke`.
  - API reference contains no route key matching `/^playbook/` and no direct route fragment built from `'/api/' + 'playbook'`.
  - Tools reference contains `eforge_playbook`, `eforge-playbooks`, and `copy`.
  - Tools reference contains no `create-from-playbook` or `playbook_name`.
  - `web/public/llms-full.txt` contains `eforge-playbooks:run-playbook` and no direct playbook route fragment.

### Planning contract test migration

Rewrite `test/eforge-playbook-planning-contract.test.ts` around extension action dispatch:

- Register `eforge-playbooks` with `createExtensionRecorder('eforge-playbooks', ...)` and import its default extension factory.
- Build a `NativeExtensionRegistry` from recorder state with optional loaded extension metadata for `eforge-plan` capability availability.
- Write playbooks into temp project/team playbook storage using pure `@eforge-build/input` helpers or raw files; pass `configDir` into `dispatchExtensionAction`.
- Dispatch `eforge-playbooks:run-playbook` with `{ name }` and `requestedBy: { host: 'test' }`.
- For planning available, include a loaded `eforge-plan` capability with version `1.0.0`; assert success output has `kind: 'requires-agent'`, `planningEntry.contributionId`, `planningEntry.workstationId`, `planningEntry.workstationUrl`, JSON-safe `seed`, source extension/name metadata, and zero build-queue calls.
- For planning unavailable, omit the provider or use an incompatible capability version; assert success output has `kind: 'planning-unavailable'`, required capability provider/id/range, diagnostics array, load/trust/reload guidance, and zero build-queue calls.
- For autonomous playbooks with eforge-plan unavailable, provide a fake `buildQueue.enqueue` and assert one call plus `{ kind: 'enqueued' }` output.
- Assert no session-plan creation helper is imported or called in this test.

## Testing Strategy

### Unit Tests
- Final boundary audit tests for removed route/helper/workflow-adapter/Core Console tokens and positive package/host extension-owned surfaces.
- Docs boundary tests for source docs, generated references, public docs mirrors, and LLM bundles.
- Updated docs-kernel and extension-platform tests that assert eforge-playbooks is first-party extension-owned while user-authored custom playbook extraction remains unsupported.
- Updated skills docs wiring assertions for host skill parity after host migration.
- Updated planning contract test that dispatches `eforge-playbooks:run-playbook` directly.

### Integration Tests
- Run `pnpm docs:generate`, then `pnpm docs:check` to validate generated output drift.
- Run package-local `eforge-playbooks` registration/action tests from the dependency module to confirm docs-level positive IDs match runtime registrations.
- Run existing host migration, Console surface, boundary-removal, and generated docs tests with the new final guards.
- Run full repository validation after targeted tests: `pnpm test`, `pnpm type-check`, `pnpm docs:check`, and `pnpm maintainability:check`.

## Verification

- [ ] Preflight audit over `packages/client/src packages/monitor/src packages/input/src packages/eforge/src/cli packages/pi-eforge/extensions/eforge packages/console-ui/src docs web/content web/public README.md` returns zero matches for `apiPlaybook`, `API_ROUTES.playbook`, `sessionPlanCreateFromPlaybook`, `create-from-playbook`, `createPlaybookWorkflowAdapter`, `builtin:playbooks`, `PlaybooksSection`, and the constructed direct playbook route fragment.
- [ ] `README.md`, `web/content/docs/playbooks.md`, `docs/extensions.md`, `web/content/docs/extensions.md`, `docs/extensions-api.md`, `web/content/docs/extensions-api.md`, `docs/config.md`, `web/content/docs/configuration.md`, and `web/content/docs/integrations.md` contain `eforge-playbooks`.
- [ ] `web/content/docs/playbooks.md` contains all eight canonical `eforge-playbooks:*` action IDs.
- [ ] `web/content/docs/playbooks.md` contains `eforge-plan:open-planning-entry`, `eforge-plan:planning-workstation`, and `/console/workstations/eforge-plan%3Aplanning-workstation`.
- [ ] `web/content/docs/playbooks.md` contains no `daemon returns` phrase for playbook action results.
- [ ] `docs/architecture.md` contains no direct playbook route paragraph and contains `eforge-playbooks` plus `ctx.buildQueue.enqueue`.
- [ ] `docs/releasing.md` names both `@eforge-build/eforge-playbooks` and `@eforge-build/eforge-plan` in lockstep publish verification.
- [ ] `web/content/reference/api.md` and `web/public/reference/api.md` contain no route key beginning with `playbook`, no `sessionPlanCreateFromPlaybook`, and no constructed direct playbook route fragment.
- [ ] `web/content/reference/tools.md` and `web/public/reference/tools.md` contain `eforge_playbook`, `eforge-playbooks`, and `copy`; they contain no `create-from-playbook` or `playbook_name`.
- [ ] `web/public/llms-full.txt` contains `eforge-playbooks:run-playbook` and contains no constructed direct playbook route fragment.
- [ ] `test/eforge-playbook-planning-contract.test.ts` imports `dispatchExtensionAction` and contains no `API_ROUTES.playbookRun` or direct playbook route fragment.
- [ ] `test/playbook-extension-final-boundary.test.ts` asserts deleted client/monitor/input/Console file absence and package registration for `@eforge-build/eforge-playbooks`.
- [ ] `test/playbook-extension-docs-boundary.test.ts` asserts source docs and generated references contain extension-owned playbook language and reject stale bundled-adapter/direct-route language.
- [ ] Targeted tests exit 0: `pnpm vitest run test/playbook-extension-final-boundary.test.ts test/playbook-extension-docs-boundary.test.ts test/eforge-playbook-planning-contract.test.ts test/docs-kernel-boundary.test.ts test/extension-platform-docs-examples.test.ts test/skills-docs-wiring.test.ts`.
- [ ] Dependency smoke tests exit 0: `pnpm vitest run eforge/extensions/eforge-playbooks/__tests__/registration.test.ts eforge/extensions/eforge-playbooks/__tests__/actions-crud.test.ts eforge/extensions/eforge-playbooks/__tests__/run-playbook-action.test.ts eforge/extensions/eforge-playbooks/__tests__/planning-contract.test.ts`.
- [ ] `pnpm docs:generate` rewrites no files after its first run.
- [ ] `pnpm docs:check` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.

<build-config>
{
  "build": [["implement", "doc-author"], "doc-sync", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["docs", "test"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
