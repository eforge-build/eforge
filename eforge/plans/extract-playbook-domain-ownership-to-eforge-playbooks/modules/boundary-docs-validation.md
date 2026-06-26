# Boundary Docs Validation

## Architecture Reference

This module implements the `Module: boundary-docs-validation`, `Integration contracts between modules > boundary-docs-validation → all modules`, and `Quality attributes > Boundary clarity / Replaceability / User-facing consistency` sections from the architecture.

Key constraints from architecture:
- This module runs after `input-neutrality`, `planning-contract-neutralization`, and `host-surface-neutrality`; remaining non-extension playbook references are either documentation/test boundary references or leaks assigned back to the owning module.
- Source-wide boundary tests fail on playbook-specific imports, exports, schemas, commands, tools, route helpers, model helpers, storage semantics, and `playbookDraft` outside `eforge/extensions/eforge-playbooks`.
- Enabled-extension coverage exercises representative list, create/save, run, and planning flows only through generic extension contribution discovery and invocation.
- Disabled/absent-extension coverage proves core and host packages do not register playbook commands, tools, skills, routes, or Console sections when `eforge-playbooks` is not loaded.
- Console core may render extension-provided metadata generically; it must not contain hard-coded playbook contribution IDs, playbook routes, or playbook-specific UI affordances.
- Public and architecture docs describe `eforge/extensions/eforge-playbooks` as the sole playbook domain owner and distinguish generic extension hosting from playbook behavior.
- Generated references are outputs. This module runs documentation generation/checks after host/input/planning source changes land.

## Scope

### In Scope
- Add a source-wide playbook ownership audit with explicit allowlists for `eforge/extensions/eforge-playbooks`, boundary docs/tests, and minimal extension package metadata.
- Add enabled-extension tests that resolve and invoke `eforge-playbooks` actions through `buildExtensionContributionManifest`, `summarizeExtensionContributionManifest`, `resolveExtensionContributionInvocation`, and `dispatchExtensionAction`.
- Add disabled/absent-extension tests for empty manifests and removed host surfaces.
- Strengthen Console tests so playbook UI appears only through generic extension contribution rendering and disappears when the manifest has no playbook contribution.
- Update architecture docs, public docs, README content, package docs, and generated reference artifacts to reflect extension-only playbook ownership and removed host facades.
- Update docs/content tests to assert generic extension contribution usage and absence of stale host command/tool references.
- Neutralize non-boundary examples in scopes, reviewer-context, and enqueue API tests that currently use playbook paths or helper names as generic fixtures.
- Remove stale maintainability baseline entries for deleted playbook implementation files.
- Regenerate and check public docs artifacts with `pnpm docs:generate` / `pnpm docs:check`.

### Out of Scope
- Moving parser, serializer, validator, storage, compiler, or planning-seed implementation into `eforge/extensions/eforge-playbooks`; that belongs to `playbook-domain-extraction`.
- Deleting `@eforge-build/input` playbook exports or session-plan playbook seed helpers; that belongs to `input-neutrality`.
- Removing `playbookDraft` from client/monitor/eforge-plan contracts; that belongs to `planning-contract-neutralization`.
- Removing CLI, MCP, Pi, plugin, or docs-generator host playbook facades; that belongs to `host-surface-neutrality`.
- Editing `packages/docs-gen/src/generators/tools.ts` unless the dependency module missed a generated-reference source update; host-surface-neutrality owns that generator source.
- Preserving old host-owned playbook UX through compatibility shims.

## Implementation Approach

### Overview

Treat this module as the final boundary gate. First, replace stale tests and generic examples that still mention playbooks for non-boundary reasons. Then add a source-wide classifier that scans implementation, docs, tests, generated public artifacts, package metadata, and scripts while skipping `node_modules`, `dist`, build outputs, and plan worktrees. The classifier reports every non-extension playbook reference as one of:

1. extension-owned implementation under `eforge/extensions/eforge-playbooks/**`;
2. boundary documentation or generated documentation that states extension ownership;
3. boundary tests enforcing absence or generic contribution behavior;
4. minimal package metadata needed to include the first-party extension package; or
5. a leak.

The tests in this module intentionally contain playbook tokens because they enforce the ownership boundary. Where a test constructs removed names such as `playbookDraft`, `eforge_playbook`, `/eforge:playbook`, or `eforge.plan.planning-mode-playbook`, build the token from segments when the test is checking absence inside scanned implementation roots. That keeps `rg`-based verification useful while preserving explicit assertions.

After code/test cleanup, update docs and run docs generation so `web/content/reference/**`, `web/public/reference/**`, `web/public/docs/**`, `web/public/llms.txt`, and `web/public/llms-full.txt` match the removed host surfaces and the extension-owned playbook boundary.

### Key Decisions

1. **Use a classifier, not only a token grep.** Some references are required package metadata (`pnpm-workspace.yaml`, root `type-check:eforge-playbooks`, lockstep versioning) and some are boundary docs/tests. The audit records those explicitly and fails every unclassified occurrence.
2. **Keep host IDs opaque in host tests.** Enabled-flow tests may invoke `eforge-playbooks:*` IDs because they exercise extension-provided contributions; host source tests fail if CLI/MCP/Pi/Console code contains a hard-coded map or branch for those IDs.
3. **Use actual extension registration for representative flows.** The enabled-flow test imports the eforge-playbooks extension, records its registrations, projects a manifest, resolves command/action contribution invocations generically, and then dispatches the resolved action. This verifies the path hosts use without importing playbook model/storage helpers.
4. **Use empty manifests for disabled/absent coverage.** Hosts no longer have playbook command/tool registrations. The absent-extension case is proven by empty contribution manifests plus static host-source assertions for removed commands, tools, and skills.
5. **Do not genericize `playbookDraft`.** Boundary tests assert that the field and related type/capability names are gone outside boundary tests and extension docs, matching the planning-contract module decision.
6. **Docs explain current entry points only.** Public docs instruct users to use generic contribution list/show/invoke APIs. They do not document removed command/tool names as active UX.
7. **Neutral fixture names stay domain-neutral.** Scopes and reviewer-context tests use names such as `templates/`, `runbooks/`, or `named-items/` instead of playbook directories when they test generic path behavior.

## Files

### Create
- `test/playbook-domain-ownership-boundary.test.ts` — source-wide classifier and leak audit. It scans text files outside skipped build/artifact directories; allows `eforge/extensions/eforge-playbooks/**`, explicit boundary test/doc paths, and exact extension package metadata; fails on playbook-specific imports/exports/schemas/commands/tools/routes/storage helpers/model helpers/action maps/`playbookDraft` outside those allowlists. `[region: boundary-docs-validation, whole file]`
- `test/playbook-extension-contribution-flows.test.ts` — enabled/disabled contribution coverage. It records the eforge-playbooks extension, builds the generic contribution manifest, verifies list/show/detail metadata, invokes save/list/run/planning-run through generic contribution resolution, asserts autonomous runs call only `ctx.buildQueue.enqueue`, asserts planning runs return the generic eforge-plan planning workstation metadata, and asserts an empty manifest has no playbook contribution entries. `[region: boundary-docs-validation, whole file]`
- `test/api-route-helpers.ts` — neutral replacement for `test/playbook-api-helpers.ts`; exports `setupApiProject`, `makeStubWorkerTracker`, and `postJson` without playbook-specific raw fixture helpers. `[region: boundary-docs-validation, whole file]`
- `test/enqueue-api-validation.test.ts` — neutral rename/rewrite of `test/playbook-api-enqueue-validation.test.ts` for landing and `afterQueueId` enqueue validation. It imports `setupApiProject` from `test/api-route-helpers.ts` and contains no playbook strings. `[region: boundary-docs-validation, whole file]`

### Modify
- `test/playbook-extension-docs-boundary.test.ts` — rewrite stale compatibility-facade expectations. Assert docs describe eforge-playbooks as owner of parsing, serialization, validation, storage, compilation, planning seed extraction, and playbook action UX; assert docs point to generic contribution list/show/invoke; assert old host command/tool names, direct routes, `@eforge-build/input` playbook helper ownership, and `eforge.plan.planning-mode-playbook` are absent. `[region: boundary-docs-validation, whole file]`
- `test/playbook-extension-final-boundary.test.ts` — replace old “host surfaces delegated to playbook compatibility helpers” assertions with final absence assertions for deleted host files/skills/tools, no hard-coded `eforge-playbooks:*` action maps in host implementation, generic contribution APIs still present, eforge-playbooks package metadata using `eforge.plan.planning-workstation`, and root workspace/lockstep package inclusion. `[region: boundary-docs-validation, whole file]`
- `test/playbook-boundary-source-audit.test.ts` — either delete in favor of `test/playbook-domain-ownership-boundary.test.ts` or reduce it to daemon/client/input deleted-file assertions not duplicated by the new classifier. `[region: boundary-docs-validation, whole file]`
- `test/playbook-daemon-boundary-removal.test.ts` — keep unknown-route assertions for former direct playbook endpoints and add assertions that route keys contain `extensionContributionManifest` and `extensionActionInvoke` while no key starts with the removed playbook prefix or contains the removed create-from-playbook key. `[region: boundary-docs-validation, whole file]`
- `packages/console-ui/src/views/system/__tests__/playbook-console-boundary.test.tsx` — keep the generic contribution rendering assertion, add an empty-manifest case with no playbook text/buttons, assert invocations call `invokeExtensionAction` with `requestedBy.host: 'console'`, and expand the Console source token scan to include old route helpers, state fields, selector names, command palette shortcuts, and hard-coded contribution ID arrays. `[region: boundary-docs-validation, whole file]`
- `web/__tests__/content.test.ts` — update public docs snippets: retain the `playbooks` guide as optional workflow docs, replace `/eforge:playbook` snippets with `eforge extension contributions invoke eforge-playbooks:* --kind command`, assert removed host command/tool names are absent from the playbooks and integrations guides, and assert the planning capability text uses `eforge.plan.planning-workstation`. `[region: boundary-docs-validation, playbooks and integrations expectations]`
- `test/docs-kernel-boundary.test.ts` — update docs-generator and kernel-boundary assertions so generic docs may mention eforge-playbooks only as a first-party extension boundary; remove expectations for `eforge_playbook` compatibility tooling and public input playbook helpers; keep eforge-plan product terms out of core docs. `[region: boundary-docs-validation, docs generator and optional workflow expectations]`
- `test/skills-docs-wiring.test.ts` — after host-surface-neutrality deletes playbook skills, keep only absence/parity assertions for removed skill files and update the `docs/config.md` planning prose block to require the generic planning workstation capability and generic contribution guidance. Do not reintroduce skill-file reads for deleted playbook skills. `[region: boundary-docs-validation, docs/config planning prose block]`
- `test/scopes.test.ts` — replace generic named-set test directories named `playbooks` with neutral directories such as `templates` or `named-items`; keep shadowing and precedence assertions unchanged. `[region: boundary-docs-validation, named-set examples]`
- `test/review-context-filtering.test.ts` — replace `eforge/playbooks/dependency-update.md` with a neutral real-file path such as `docs/operational-runbook.md` or `workflow/templates/dependency-update.md`; update expected changed-file arrays and diff assertions. `[region: boundary-docs-validation, real non-generated fixture path]`
- `scripts/agent-maintainability-baseline.json` — remove entries for deleted playbook implementation files (`packages/pi-eforge/extensions/eforge/playbook-commands.ts`, `packages/input/src/playbook.ts`, and any other deleted playbook facade/domain file still present in the baseline). No region owner is declared in the architecture; this is final boundary cleanup for generated maintainability metadata.
- `packages/scopes/src/index.ts` — replace playbook examples in comments with neutral named-set examples such as `profiles/` and `templates/`.
- `packages/scopes/src/named-set.ts` — replace playbook examples in comments and parameter docs with neutral named-set examples.
- `packages/scopes/README.md` — describe scopes as generic path/named-set utilities; use profile/template examples; remove claims that `@eforge-build/input` owns playbook path resolution.
- `packages/docs-gen/src/generators/config.ts` — replace generated config-reference wording that says “playbook runs” can override landing auto-merge with “extension-originated enqueue requests” or “queued build requests”. This file is not listed in the architecture registry; edit only this generated prose line.
- `README.md` — update the overview, Pi/Claude/CLI sections, examples, and scope-precedence prose to state that playbooks are managed only through the eforge-playbooks extension and generic contribution invocation. Remove `eforge playbook`, `eforge play`, `/eforge:playbook`, `eforge_playbook`, public input-helper ownership, and the old planning-mode playbook capability. This root doc is not declared in the Shared File Registry; treat it as final documentation sweep ownership for this module.
- `AGENTS.md` — update the engine/wrapper-app boundary note so reusable domain-neutral input artifacts live in `@eforge-build/input`, playbook behavior lives in `eforge/extensions/eforge-playbooks`, and hosts use generic extension contributions.
- `docs/architecture.md` — update diagrams, package topology, allowed dependency edges, Engine/CLI/Monitor/Plugin/Pi sections, and input package descriptions so `@eforge-build/input` is domain-neutral and `eforge-playbooks` owns playbook parse/serialize/validate/storage/compile/seed behavior.
- `docs/config.md` — update extension runtime and playbook profile sections to remove public input-helper ownership and host-compatibility wording; use generic contribution invocation examples and `eforge.plan.planning-workstation`.
- `docs/extensions.md` — update first-party extension boundary prose and user-authored workflow registration limitations; state hosts invoke playbook behavior through generic contribution APIs only.
- `docs/extensions-api.md` — update runtime support and unsupported/future-work sections so shipped playbook behavior is extension-owned and user-authored custom playbook extraction remains unsupported/deferred without implying `@eforge-build/input` ownership.
- `docs/roadmap.md` — keep only boundary-safe future wording, with first-party playbook behavior owned by eforge-playbooks and no host/core playbook workflow items.
- `web/content/docs/playbooks.md` — rewrite active usage instructions around generic contribution discovery/invocation. Cover file format, scope tiers, profile precedence, autonomous run, planning handoff, and list/create/save/run/promote/demote using `eforge extension contributions ...` plus MCP/Pi `eforge_extension_contribution`; remove active `/eforge:playbook`, `eforge playbook`, `eforge play`, and `eforge_playbook` instructions; use the generic eforge-plan planning workstation capability.
- `web/content/docs/integrations.md` — remove Claude/Pi playbook host tool/skill rows and CLI `eforge play*` examples; document generic contribution APIs as the only host path to eforge-playbooks actions.
- `web/content/docs/configuration.md` — mirror `docs/config.md` playbook profile and extension boundary changes.
- `web/content/docs/concepts.md` — keep playbooks as optional extension-owned workflow artifacts only; remove any statement that input/core owns playbook behavior.
- `web/content/docs/extensions.md` — mirror `docs/extensions.md` first-party extension boundary wording.
- `web/content/docs/extensions-api.md` — mirror `docs/extensions-api.md` runtime support and unsupported/future-work wording.
- `web/content/docs/getting-started.md` — ensure first-build guidance prioritizes prompt/PRD/file/session-plan build paths and points playbook users to generic extension contribution discovery rather than host-specific commands.
- `web/content/docs/glossary.md` — update playbook and input package definitions so playbook domain ownership is the eforge-playbooks extension.
- `web/content/docs/profiles.md` — update any playbook profile examples to use generic contribution invocation and no host facade commands.
- `web/content/reference/api.md`, `web/content/reference/cli.md`, `web/content/reference/config.md`, `web/content/reference/tools.md`, `web/public/reference/api.md`, `web/public/reference/cli.md`, `web/public/reference/config.md`, `web/public/reference/tools.md` — generated by `pnpm docs:generate`; commit the generated diff. References must include generic extension contribution/action routes and omit playbook-specific daemon routes, CLI subcommands, MCP/Pi `eforge_playbook`, and removed skill pairs. `[region: boundary-docs-validation, generated reference artifacts]`
- `web/public/docs/*.md`, `web/public/llms.txt`, `web/public/llms-full.txt` — generated mirrors and LLM artifacts after docs updates. Commit generated diffs from `pnpm docs:generate`. `[region: boundary-docs-validation, generated public docs and LLM artifacts]`

### Delete
- `test/playbook-api-enqueue-validation.test.ts` — replaced by `test/enqueue-api-validation.test.ts`.
- `test/playbook-api-helpers.ts` — replaced by `test/api-route-helpers.ts`; remove unused `invalidAcPlaybookRaw`.
- `test/playbook-boundary-source-audit.test.ts` — delete if the new `test/playbook-domain-ownership-boundary.test.ts` fully covers its deleted-file and token assertions.

### Shared File and Region Notes

The architecture assigns `docs/**`, `web/content/**`, `web/public/**`, `test/**` boundary tests, `packages/console-ui/**/__tests__/**`, and `web/__tests__/**` to this module. Region annotations above use `[region: boundary-docs-validation, ...]` for those files.

`README.md`, `AGENTS.md`, `packages/scopes/**`, `scripts/agent-maintainability-baseline.json`, and `packages/docs-gen/src/generators/config.ts` are not declared in the Shared File Registry but contain final-boundary or generated-prose leaks that no dependency module owns. Treat these as boundary sweep files and keep edits bounded. If another module also edits one of these files during execution, resolve with non-overlapping exact edits or regenerate generated metadata after source edits land.

Do not add durable source region markers. If temporary build-coordination markers become necessary, use cleanup-targeted slugs matching `plan-\d{2}-...` and remove them before finalizing the module.

## Testing Strategy

### Unit Tests
- `test/playbook-domain-ownership-boundary.test.ts` verifies deleted files are absent, scans implementation roots for forbidden tokens, classifies non-extension playbook references, and fails on unclassified references.
- `test/playbook-extension-docs-boundary.test.ts` verifies docs and generated references describe extension ownership and omit removed host commands/tools/routes/fields.
- `test/playbook-extension-final-boundary.test.ts` verifies host source contains no playbook adapters/action maps and extension package metadata uses the generic planning workstation capability.
- `packages/console-ui/src/views/system/__tests__/playbook-console-boundary.test.tsx` verifies Console renders playbook controls only from generic extension contribution manifest data and has no core Playbooks section/source tokens.
- `test/scopes.test.ts`, `test/review-context-filtering.test.ts`, and `test/enqueue-api-validation.test.ts` verify generic behavior with neutral fixture names.
- `web/__tests__/content.test.ts`, `test/docs-kernel-boundary.test.ts`, and `test/skills-docs-wiring.test.ts` verify updated public docs/navigation/reference expectations.

### Integration Tests
- Enabled extension flow: record `eforge-playbooks`, build the manifest, list/show contribution entries, resolve command/action invocations, save a playbook, list it, run an autonomous playbook with a queue stub, and run a planning playbook with an eforge-plan registry capability.
- Disabled/absent extension flow: use an empty registry/manifest and verify no playbook entries exist; static host registration tests verify no CLI/MCP/Pi/plugin playbook commands/tools/skills are available.
- Daemon route flow: former direct playbook endpoints return the normal unknown-route response while extension contribution manifest/action routes remain registered.
- Docs generation flow: run `pnpm docs:generate`, commit generated artifacts, then run `pnpm docs:check`.

## Verification

- [ ] `pnpm vitest run test/playbook-domain-ownership-boundary.test.ts test/playbook-extension-contribution-flows.test.ts test/playbook-extension-docs-boundary.test.ts test/playbook-extension-final-boundary.test.ts test/playbook-daemon-boundary-removal.test.ts` exits 0.
- [ ] `pnpm vitest run packages/console-ui/src/views/system/__tests__/playbook-console-boundary.test.tsx packages/console-ui/src/views/system/__tests__/extension-contributions-section.test.tsx` exits 0.
- [ ] `pnpm vitest run web/__tests__/content.test.ts test/docs-kernel-boundary.test.ts test/skills-docs-wiring.test.ts` exits 0.
- [ ] `pnpm vitest run test/scopes.test.ts test/review-context-filtering.test.ts test/enqueue-api-validation.test.ts` exits 0.
- [ ] `rg "registerPlaybookCommands|invokePlaybookContributionForHost|invokePlaybookContributionIfRunning|eforge_playbook|eforge:playbook|PLAYBOOK_CONTRIBUTION_IDS|playbookDraft|PlanningPlaybookDraft|planning-mode-playbook|sessionPlanCreateFromPlaybook|create-from-playbook" packages eforge-plugin eforge/extensions/eforge-plan scripts docs web README.md AGENTS.md --glob '!node_modules/**' --glob '!dist/**' --glob '!eforge/extensions/eforge-playbooks/**' --glob '!test/**'` prints no lines.
- [ ] `rg "from ['\"]@eforge-build/input['\"].*playbook|from ['\"]@eforge-build/input['\"].*Playbook" packages eforge-plugin eforge/extensions --glob '!node_modules/**' --glob '!dist/**' --glob '!eforge/extensions/eforge-playbooks/**'` exits with code 1.
- [ ] `rg "eforge playbook|eforge play |/eforge:playbook|eforge_playbook" README.md docs web/content web/public eforge-plugin packages/pi-eforge --glob '!node_modules/**' --glob '!dist/**'` prints no lines.
- [ ] `rg "@eforge-build/input[^\n]*(playbook|Playbook)|pure playbook helpers|public input helpers" README.md docs web/content web/public packages/scopes packages/docs-gen/src --glob '!node_modules/**' --glob '!dist/**'` exits with code 1.
- [ ] `pnpm docs:check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm build` exits 0.
- [ ] `pnpm test` exits 0.

<build-config>
{
  "build": ["test-write", ["implement", "doc-author"], "test-cycle", "doc-sync", "review-cycle"],
  "review": {
    "strategy": "auto",
    "perspectives": ["test", "docs"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
