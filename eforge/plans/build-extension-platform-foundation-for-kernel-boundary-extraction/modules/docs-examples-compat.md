# Docs Examples Compat

## Architecture Reference

This module implements the architecture sections **Documentation updates**, **Integration contracts between modules**, **Host integration contract**, **Console renderer contract**, **Technical decisions and rationale**, and the documentation/example portion of **Compatibility and migration impact**.

Key constraints from architecture:
- Document shipped platform seams: typed extension actions, declarative Console contributions, integration commands, deep links, daemon-owned manifest/action invocation routes, and action lifecycle diagnostics/events.
- Preserve and document existing shipped seams: input-source fetching, PRD enrichment, reviewer perspectives, validation providers, profile routers, policy gates, event hooks, and agent context/tool injection.
- State deferred boundaries explicitly: no raw extension-owned HTTP routes, no extension-supplied browser JavaScript/React bundles/frontend plugins, no approval workflow/state/UI, no `beforeEnqueue`, no `beforeValidation`, no `modify` policy decisions, no session-plan extraction, and no playbook extraction in this slice.
- Keep host names aligned with `host-integration-surfaces`: CLI `eforge extension contributions list|invoke`, MCP/Claude `eforge_extension_contribution`, Pi `eforge_extension_contribution`, and Pi `/eforge:extensions`.
- Keep Console docs aligned with `console-contribution-rendering`: contributions render inside `/console/system` using closed renderer IDs: `text`, `markdown`, `status-badge`, `link`, `action-button`, and `action-form`.
- Do not duplicate daemon wire shapes or route literals in implementation code. Docs may name client-owned helpers and generated API reference entries; examples must use SDK registration methods rather than raw HTTP route registration.
- Generate and commit reference artifacts with `pnpm docs:generate`; do not hand-edit generated reference or public mirror files.
- `packages/console-ui/README.md` is also named in the architecture, but the completed `console-contribution-rendering` plan owns the **Adding a new control surface** section. This module does not edit that file unless the dependency fails to add the required wording; if a fallback edit is needed, limit it to a separate paragraph outside the dependency-owned section and record the overlap in the build summary.

## Scope

### In Scope
- Update conceptual extension docs for action/contribution/command/deep-link registration, daemon manifest/invocation behavior, action validation, timeout reuse, event privacy, and shipped/deferred capability boundaries.
- Update the SDK API reference docs with method signatures, public types, TypeBox schema rules, action context behavior, manifest/renderer concepts, and runtime support rows.
- Update `@eforge-build/extension-sdk` README with concise action/contribution authoring guidance and a minimal code example.
- Add a minimal `examples/extensions/action-contribution.ts` sample that registers one action, one Console contribution, one integration command, and one action-backed deep link without network calls, filesystem writes, raw HTTP routes, or browser bundle code.
- Update example README and SDK smoke tests so every `examples/extensions/*.ts` file is imported and type-checked.
- Update configuration docs to state the action invocation timeout behavior chosen by `daemon-action-routes` (`extensions.eventHookTimeoutMs` reuse when no new config field ships).
- Update public web docs for extensions, extension API, configuration, and integrations.
- Update high-level README wording for native extension runtime support and host contribution discovery.
- Update roadmap text only to remove or reframe shipped foundation work; keep session-plan/playbook extraction and arbitrary frontend plugin bundles future-focused.
- Regenerate tracked public docs mirrors, API/CLI/events/tools references, schemas, and LLM files with `pnpm docs:generate` after dependency modules add routes, events, helpers, CLI commands, MCP tools, and Pi tools.
- Add docs/static tests covering shipped/deferred claims, host command names, example import coverage, generated mirror parity, generated reference inclusion, and action event payload privacy wording.

### Out of Scope
- SDK contract implementation, client schemas/helpers, route constants, and API version bump.
- Engine registry recording, duplicate detection, projection, manifest generation, and action runtime dispatch.
- Daemon route handlers, event schema implementation, HTTP status mapping, and persisted action events.
- Console contribution renderer implementation or Console component tests.
- Pi, MCP/Claude, and CLI host command/tool implementation or plugin manifest version bump.
- Editing Claude plugin or Pi skill files; `host-integration-surfaces` owns those files.
- Editing `packages/console-ui/README.md` in its dependency-owned control-surface section.
- Extracting session-plan or playbook workflows into extensions.
- Adding raw HTTP routes, browser JavaScript bundles, React plugin bundles, or independently loaded frontend plugins.
- Introducing a new extension timeout config field unless an upstream dependency implements one; if it does, this module documents that exact field.

## Implementation Approach

### Overview

Treat this as the final synchronization module for user-facing content after the platform, engine, daemon, Console, and host modules land. First add tests that lock the final terminology and boundaries. Then update hand-authored docs and examples using the actual exported names and host commands from dependency modules. Finally run `pnpm docs:generate` so generated references and public mirrors reflect new API routes, events, CLI commands, MCP/Pi tool references, schemas, and guide content.

Documentation updates are split by audience:

1. **Extension authors** — `docs/extensions.md`, `docs/extensions-api.md`, `packages/extension-sdk/README.md`, and `examples/extensions/*` explain how to register actions and bind declarative Console/host metadata.
2. **Host users** — `web/content/docs/integrations.md` and README describe how Pi, Claude/MCP, and CLI list/invoke extension-provided contributions.
3. **Operators/security reviewers** — configuration docs and trust sections state unsandboxed execution, timeout behavior, daemon-owned action boundaries, validation/failure behavior, and no raw payload leakage in action lifecycle events.
4. **Future-work readers** — `docs/roadmap.md` keeps workflow extraction, approval UI/state, raw routes, and frontend plugin bundles listed as future work.

### Documentation Content Map

Update the following content in both root docs and web docs where parallel pages exist:

- Native extension intro lists the new registration families alongside existing shipped families.
- Runtime support tables add rows for:
  - `registerAction(action)` — loader-time capture and daemon action invocation runtime.
  - `registerConsoleContribution(contribution)` — loader-time capture, manifest projection, and Console System rendering runtime.
  - `registerIntegrationCommand(command)` — loader-time capture, manifest projection, and host discovery/invocation through action bindings.
  - `registerDeepLink(deepLink)` — loader-time capture, manifest projection, host discovery, and action-backed invocation when a binding exists.
- A new conceptual section explains effective namespaced IDs, local IDs, action bindings, manifest metadata, renderer IDs, host command/deep-link discovery, and URL-only deep-link listing behavior.
- Safety sections state that actions run as trusted unsandboxed Node code, input schemas are object-root TypeBox schemas, outputs must be JSON-safe, optional output schemas are enforced, handler errors/timeouts return typed failure bodies, and action events omit raw input/output payloads.
- Deferred-boundary sections state no raw extension-owned HTTP route registration, no arbitrary extension-supplied Console JavaScript, no arbitrary React bundles, no independently loaded frontend plugins, no session-plan extraction, and no playbook extraction.
- Host integration docs name the concrete surfaces from `host-integration-surfaces`.
- Configuration docs describe timeout reuse. If upstream adds no new field, use this wording target: action handlers use `extensions.eventHookTimeoutMs`; `agentContextHookTimeoutMs`, `profileRouterTimeoutMs`, `policyGateTimeoutMs`, and `validationProviderTimeoutMs` remain scoped to their existing families.

### Example Design

Create `examples/extensions/action-contribution.ts` as a safe, deterministic example:

- Register an action with local ID such as `echo-status` using `defineExtensionAction` and `Type.Object(...)` input.
- Include an optional output schema using `Type.Object(...)` so docs demonstrate output validation.
- Use a handler that returns a JSON object derived only from caller input, for example `{ ok: true, message, dryRun }`.
- Register a Console contribution with renderer blocks covering markdown/status plus an action button or action form bound to the local action ID.
- Register an integration command bound to the local action ID with input defaults.
- Register an action-backed deep link bound to the same action; optionally include one URL-only deep link only if docs explain generic host invocation rejects URL-only links.
- Include comments stating local IDs are resolved to effective manifest IDs by eforge and that examples must not register raw HTTP routes or browser code.

### Generated Artifacts

After hand-authored content and dependency implementation are present, run `pnpm docs:generate`. Commit generated changes under:

- `web/content/reference/api.md`
- `web/content/reference/cli.md`
- `web/content/reference/events.md`
- `web/content/reference/tools.md`
- `web/public/reference/api.md`
- `web/public/reference/cli.md`
- `web/public/reference/events.md`
- `web/public/reference/tools.md`
- `web/public/schemas/events.schema.json`
- `web/public/schemas/config.schema.json` only if config schema changed upstream
- `web/public/docs/extensions.md`
- `web/public/docs/extensions-api.md`
- `web/public/docs/configuration.md`
- `web/public/docs/integrations.md`
- `web/public/llms.txt`
- `web/public/llms-full.txt`

Do not manually edit generated files. If `pnpm docs:check` reports drift after regeneration, inspect the generator inputs rather than patching generated output.

### Key Decisions

1. **Use actual dependency names instead of inventing aliases.** Docs name `registerAction`, `registerConsoleContribution`, `registerIntegrationCommand`, `registerDeepLink`, `fetchExtensionContributionManifest`, `invokeExtensionAction`, `eforge_extension_contribution`, and `/eforge:extensions` unless dependency implementations rename them; any rename must be reflected consistently in docs and tests.
2. **Document API routes through client-owned names and generated reference.** Hand-authored docs direct TypeScript consumers to `@eforge-build/client` helpers and `API_ROUTES` keys rather than teaching raw route construction.
3. **Keep public guide pages and root docs intentionally parallel, not byte-identical.** Root docs use repository-relative links; web docs include frontmatter and site-relative links. Tests check required snippets and generated public mirror parity instead of raw equality between root and web guide sources.
4. **Use a safe action example.** The new example performs no network call, writes no files, uses no secrets, and invokes no daemon routes directly, so import/type-check tests can run without side effects.
5. **Preserve existing workflow docs.** Session-plan and playbook docs remain source-owned workflow documentation; this module adds boundary notes that future extraction is deferred.
6. **Regenerate references only after all dependent modules land.** API route/event/CLI/tool reference output depends on platform, daemon, and host source code.
7. **Add docs assertions for negative claims.** Tests check absence of stale phrases that imply raw routes, arbitrary frontend bundles, session-plan extraction, or playbook extraction shipped in this slice.

## Files

### Create
- `examples/extensions/action-contribution.ts` — minimal safe extension that registers an action, Console contribution, integration command, and action-backed deep link with TypeBox schemas and local action bindings.
- `test/extension-platform-docs-examples.test.ts` — static/docs test coverage for new shipped/deferred extension-platform docs, host command names, generated reference snippets, and example import coverage.

### Modify
- `docs/extensions.md` — add conceptual action/contribution/command/deep-link sections, runtime support rows, daemon/client boundary notes, action safety/privacy wording, host discovery summary, and deferred-boundary statements.
- `docs/extensions-api.md` — add API reference entries for `registerAction`, `registerConsoleContribution`, `registerIntegrationCommand`, `registerDeepLink`, action binding/context/output types, renderer IDs, runtime status rows, and TypeBox object-root/action output schema rules.
- `docs/config.md` — update Native extensions runtime-support summary and timeout field descriptions to mention extension actions using the chosen timeout behavior; do not add a new field unless upstream code adds one.
- `docs/roadmap.md` — prune or reword only shipped extension-platform foundation items; keep `beforeEnqueue`, `beforeValidation`, approval workflow/state/UI, `modify`, session-plan extraction, playbook extraction, and arbitrary frontend plugin bundles as future work.
- `README.md` — update the native extension overview paragraph to include actions, declarative Console contributions, integration commands, deep links, and generic host discovery/invocation surfaces.
- `packages/extension-sdk/README.md` — add registration-method rows, concise action/contribution example, host/Console binding guidance, safety/timeout notes, and deferred-boundary wording.
- `examples/extensions/README.md` — add `action-contribution.ts` to the examples table, add a dedicated section describing action/contribution/command/deep-link behavior, and update validation command snippets if new tests are added.
- `web/content/docs/extensions.md` — web-facing counterpart to `docs/extensions.md` with site-relative links and frontmatter description updates.
- `web/content/docs/extensions-api.md` — web-facing counterpart to `docs/extensions-api.md` with site-relative links and frontmatter description updates.
- `web/content/docs/configuration.md` — update Native Extensions runtime-support and timeout wording to match `docs/config.md`.
- `web/content/docs/integrations.md` — document CLI, MCP/Claude, and Pi contribution discovery/invocation surfaces; explain URL-only versus action-backed deep links and shared manifest metadata.
- `test/extension-sdk-example.test.ts` — import `examples/extensions/action-contribution.ts`, add it to `importedExampleFiles`, assert it conforms to `EforgeExtensionFactory`, and extend type-export smoke coverage if dependency modules add SDK exported types not already covered by `platform-contracts`.
- `test/extension-docs-content.test.ts` — add the new example to import-smoke synchronization checks and extend docs assertions for action/contribution families when this is more local than the new focused test.
- `test/extension-tooling-wiring-runtime-docs.test.ts` — extend runtime docs assertions for the four new methods, action timeout/event privacy wording, and deferred-boundary statements if doing so avoids duplicate fixture reads.
- `web/__tests__/content.test.ts` — add journey snippets for extension actions, contribution manifests, host contribution tool names, and generated public guide mirrors.
- Generated by `pnpm docs:generate`: `web/content/reference/api.md`, `web/content/reference/cli.md`, `web/content/reference/events.md`, `web/content/reference/tools.md`, `web/public/reference/*.md`, `web/public/schemas/events.schema.json`, `web/public/schemas/config.schema.json` if changed, `web/public/docs/*.md` mirrors for modified guides, `web/public/llms.txt`, and `web/public/llms-full.txt`.

## Testing Strategy

### Unit Tests
- Add `test/extension-platform-docs-examples.test.ts` with file-content assertions that root docs, web docs, SDK README, and examples README mention `registerAction`, `registerConsoleContribution`, `registerIntegrationCommand`, and `registerDeepLink`.
- Assert docs mention the client/browser helpers `fetchExtensionContributionManifest` and `invokeExtensionAction` where Console/browser consumption is described.
- Assert integration docs mention `eforge extension contributions list`, `eforge extension contributions invoke`, `eforge_extension_contribution`, `mcp__eforge__eforge_extension_contribution`, and `/eforge:extensions`.
- Assert docs state action inputs require TypeBox object-root schemas and action outputs must be JSON-safe.
- Assert docs state action lifecycle events include provenance/duration/error metadata and omit raw input/output payloads.
- Assert docs state raw extension-owned HTTP routes, arbitrary Console JavaScript, arbitrary React bundles, independently loaded frontend plugins, session-plan extraction, and playbook extraction are deferred or unsupported.
- Assert docs state input-source fetching, PRD enrichment, reviewer perspectives, validation providers, profile routers, policy gates, event hooks, and agent context/tool injection are shipped seams.
- Assert `examples/extensions/action-contribution.ts` source contains the four registration methods, TypeBox `Type.Object`, an output schema, no `/api/` literal, no `fetch(` call, and no filesystem import.
- Update `test/extension-sdk-example.test.ts` so every TypeScript example file is imported and type-checked.

### Integration Tests
- Run the updated `test/extension-sdk-example.test.ts` to type-check the new example against the SDK barrel exports.
- Extend existing generated-doc tests so `web/public/docs/extensions.md`, `extensions-api.md`, `configuration.md`, and `integrations.md` mirror `web/content/docs/*` after `pnpm docs:generate`.
- Add generated reference assertions after `docs:generate`:
  - API reference contains `extensionContributionManifest` and `extensionActionInvoke` route entries.
  - Events reference contains `extension:action:start`, `extension:action:complete`, `extension:action:failed`, and `extension:action:timeout`.
  - CLI reference contains `extension contributions list` and `extension contributions invoke`.
  - Tools reference contains `eforge_extension_contribution` under MCP and Pi tool sections.
- Keep `node scripts/check-skill-parity.mjs` in the validation path; this module does not edit skills, but generated references read host skill/tool metadata.

### Regression Tests
- Existing session-plan and playbook tests remain unchanged by this module.
- Existing extension-management docs tests must still pass after runtime-support rows expand.
- `pnpm docs:check` must pass after generated artifacts are committed.

## Verification

- [ ] `examples/extensions/action-contribution.ts` exports an `EforgeExtensionFactory` and imports only from `@eforge-build/extension-sdk` or other side-effect-free TypeScript modules.
- [ ] `examples/extensions/action-contribution.ts` calls `registerAction`, `registerConsoleContribution`, `registerIntegrationCommand`, and `registerDeepLink` exactly once or more.
- [ ] `examples/extensions/action-contribution.ts` contains no `/api/` literal.
- [ ] `examples/extensions/action-contribution.ts` contains no `fetch(` call.
- [ ] `examples/extensions/action-contribution.ts` contains no `node:fs` import.
- [ ] `test/extension-sdk-example.test.ts` imports `action-contribution.ts` and includes it in `importedExampleFiles`.
- [ ] `docs/extensions.md` and `web/content/docs/extensions.md` contain `registerAction`, `registerConsoleContribution`, `registerIntegrationCommand`, and `registerDeepLink`.
- [ ] `docs/extensions-api.md` and `web/content/docs/extensions-api.md` contain API sections for the four new registration methods.
- [ ] `packages/extension-sdk/README.md` contains a code example that registers an action and binds either a Console contribution or host command to it.
- [ ] `examples/extensions/README.md` table contains `action-contribution.ts`.
- [ ] Root and web extension docs state that action input schemas use TypeBox object-root schemas.
- [ ] Root and web extension docs state that action outputs must be JSON-safe.
- [ ] Root and web extension docs state that optional output schemas are enforced when present.
- [ ] Root and web extension docs state that action lifecycle events omit raw input payloads and raw output payloads.
- [ ] Root and web extension docs state that native extensions remain trusted unsandboxed Node code.
- [ ] Root and web extension docs state that raw extension-owned HTTP routes are unsupported.
- [ ] Root and web extension docs state that arbitrary Console JavaScript, React bundles, and independently loaded frontend plugins are deferred.
- [ ] Root and web extension docs state that session-plan extraction is deferred.
- [ ] Root and web extension docs state that playbook extraction is deferred.
- [ ] Root and web docs state that input-source fetching, PRD enrichment, reviewer perspectives, validation providers, profile routers, policy gates, event hooks, and agent context/tool injection are shipped seams.
- [ ] `docs/config.md` and `web/content/docs/configuration.md` name the extension action timeout behavior implemented by `daemon-action-routes`.
- [ ] `web/content/docs/integrations.md` mentions `eforge extension contributions list` and `eforge extension contributions invoke`.
- [ ] `web/content/docs/integrations.md` mentions MCP/Claude `eforge_extension_contribution` and `mcp__eforge__eforge_extension_contribution`.
- [ ] `web/content/docs/integrations.md` mentions Pi `eforge_extension_contribution` and `/eforge:extensions`.
- [ ] `docs/roadmap.md` does not claim session-plan extraction shipped.
- [ ] `docs/roadmap.md` does not claim playbook extraction shipped.
- [ ] `docs/roadmap.md` does not claim arbitrary frontend plugin bundles shipped.
- [ ] `web/public/docs/extensions.md` equals `web/content/docs/extensions.md` after `pnpm docs:generate`.
- [ ] `web/public/docs/extensions-api.md` equals `web/content/docs/extensions-api.md` after `pnpm docs:generate`.
- [ ] `web/public/docs/configuration.md` equals `web/content/docs/configuration.md` after `pnpm docs:generate`.
- [ ] `web/public/docs/integrations.md` equals `web/content/docs/integrations.md` after `pnpm docs:generate`.
- [ ] `web/content/reference/api.md` contains `extensionContributionManifest` and `extensionActionInvoke` after `pnpm docs:generate`.
- [ ] `web/content/reference/events.md` contains all four `extension:action:*` event names after `pnpm docs:generate`.
- [ ] `web/content/reference/cli.md` contains `extension contributions list` and `extension contributions invoke` after `pnpm docs:generate`.
- [ ] `web/content/reference/tools.md` contains `eforge_extension_contribution` under both MCP and Pi sections after `pnpm docs:generate`.
- [ ] `pnpm test -- test/extension-platform-docs-examples.test.ts test/extension-sdk-example.test.ts test/extension-docs-content.test.ts test/extension-tooling-wiring-runtime-docs.test.ts web/__tests__/content.test.ts` exits 0.
- [ ] `pnpm docs:check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] `pnpm type-check` exits 0.

<build-config>
{
  "build": ["test-write", ["implement", "doc-author"], "doc-sync", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["docs", "security"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
