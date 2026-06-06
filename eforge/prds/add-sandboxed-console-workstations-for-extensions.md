---
title: Add sandboxed Console workstations for extensions
created: 2026-06-05
landing: pr
landing_auto_merge: true
---

# Add sandboxed Console workstations for extensions

## Problem / Motivation

Backlog source: `.backlog/items/backlog-2026-06-01-explore-arbitrary-console-workstation-frontend-extension-bun.md`.

Console is the canonical local-first control surface, but extension frontend capabilities currently remain limited to declarative/native contribution surfaces. The current platform intentionally does not support arbitrary Console JavaScript, React bundles, raw frontend plugins, extension-owned HTTP routes, iframe renderers, or workstation navigation/discovery.

Evidence gathered before planning:

- `docs/roadmap.md` names Console as the canonical local-first control surface and the Extension Platform roadmap explicitly keeps arbitrary frontend plugin bundles deferred while shipped capabilities remain declarative/native extension surfaces.
- `docs/extensions.md`, `docs/extensions-api.md`, and `packages/extension-sdk/README.md` state that Console contributions render under `/console/system` with closed renderer IDs and explicitly do not ship arbitrary Console JavaScript, React bundles, raw frontend plugins, or extension-owned HTTP routes.
- `packages/client/src/extension-contributions.ts` owns the manifest schema with `actions`, `consoleContributions`, `integrationCommands`, and `deepLinks`.
- `ConsoleContributionBlockSchema` accepts only `text`, `markdown`, `status-badge`, `link`, `action-button`, and `action-form`.
- Existing tests reject `iframe`.
- `packages/extension-sdk/src/contributions.ts` exposes the same closed block union and no workstation/frontend registration API.
- `packages/console-ui/src/views/system/extension-contribution-card.tsx` renders each closed block in React.
- Console sanitizes markdown/resource loading through `SafeMarkdown`.
- Console filters link protocols in `extension-contribution-rendering.ts`.
- Console invokes extension actions through the shared browser client.
- `packages/monitor/src/routes/extensions/contributions.ts` exposes only contribution manifest and action invocation routes.
- Daemon contribution reads are local-only/cross-site protected.
- Daemon contribution mutations use `localMutation`.
- `packages/monitor/src/http/static-assets.ts` only serves first-party Console assets from `packages/console-ui/dist` under `/console/` and has no extension asset route.
- `eforge/extensions/eforge-plan/README.md` says the MVP intentionally avoids custom Console routes, browser bundles, custom React renderers, raw extension-owned HTTP routes, and extension-owned AI/workstation APIs.
- The current `eforge-plan` Console surface is declarative System blocks only.

Validated assumptions:

- There is no existing `registerWorkstation`, iframe renderer, frontend bundle loader, extension asset route, or workstation navigation/discovery model in the searched code paths.
- Direct same-origin React/JS injection would be a new trust boundary because Console runs with access to local daemon APIs.
- No current CSP or browser sandbox model exists in `packages/monitor/src/http/static-assets.ts`.

LLM-first authoring is also a product requirement:

- Developers should be able to ask Pi, Codex, or Claude Code to “build an eforge extension that does X.”
- Coding agents should discover current extension APIs, examples, validation commands, and migration guidance through the website LLM artifacts (`/llms.txt` and `/llms-full.txt`) and local docs.
- `web/public/llms.txt` already links to the Extensions guide, Extensions API reference, and full LLM bundle.
- `web/content/docs/troubleshooting.md` says `pnpm docs:generate` updates `web/public/llms.txt` and `web/public/llms-full.txt`.
- `packages/extension-sdk/README.md` has a stability note but no dedicated extension SDK migration-guidance artifact.

## Goal

Implement the first buildable version of Console/workstation frontend extensibility as a constrained, sandboxed workstation model.

The outcome is richer interactive browser UI for trusted native extensions without adding raw extension-owned HTTP routes, direct React component injection, or separately served extension asset bundles in this slice.

## Approach

Implement a constrained first workstation model, not full arbitrary same-origin React component loading.

Use manifest-backed sandboxed iframe workstations registered by native extensions. The first version should use extension-provided `html`/`srcDoc` content in the manifest, rendered by Console in a sandboxed iframe under a new Workstations route.

Add a small `postMessage` action bridge from the iframe to Console so workstation UI can invoke existing extension actions through the existing daemon action route, with parent-side action allowlisting and `requestedBy: { host: 'console', surface: 'workstation:<id>' }` provenance.

Inject or expose a tiny versioned browser-side workstation SDK/bridge in the iframe, tentatively `window.eforge`, so extension HTML has a stable helper API for action invocation instead of hand-writing `postMessage` protocol details.

Defer separately hosted asset bundles, package-managed browser build output, Module Federation/shared React loading, and extension-owned HTTP routes until the trust/hash/CSP/versioning model is designed in a later slice.

User confirmed this V1 scope on 2026-06-05.

### Architecture impact

- `@eforge-build/client` remains the owner of daemon wire shapes.
- Add workstation manifest schemas/types in `packages/client/src/extension-contributions.ts`, browser exports, tests, and bump `DAEMON_API_VERSION` because first-party Console will rely on the new manifest field.
- `@eforge-build/extension-sdk` gets author-facing workstation types/helpers, likely `ConsoleWorkstation`, `defineConsoleWorkstation`, and `registerConsoleWorkstation` on `EforgeExtensionAPI`.
- Engine extension runtime captures workstation registrations during factory execution.
- Engine capture follows the existing contribution-family pattern: recorder/types/projector/manifest details update, no engine stdout, no extension code in Console.
- Daemon contribution routes can keep the existing route pair.
- `GET API_ROUTES.extensionContributionManifest` returns the enlarged manifest.
- `POST API_ROUTES.extensionActionInvoke` remains the only workstation action path.
- Console adds a first-party Workstations route/view.
- The Workstations view fetches the contribution manifest with the existing browser client helper.
- The Workstations view lists discovered workstations.
- The Workstations view renders one selected workstation in an iframe.
- Console owns the browser trust boundary.
- Extension workstation code runs inside `iframe sandbox="allow-scripts"` plus only additional flags that tests/docs justify.
- The iframe must not use `allow-same-origin`.
- The iframe must not have direct parent DOM access.
- The iframe must not have direct same-origin daemon fetch authority.
- Console owns the action bridge.
- The parent window validates `postMessage` shape, source frame, workstation id, and allowed action id before invoking `invokeExtensionAction`.
- Results are posted back to the same frame with the request id.
- Console may inject a first-party workstation browser SDK bootstrap into the iframe `srcDoc` before extension HTML.
- The first version can expose only action invocation helpers.
- The SDK boundary should preserve room for future SDK-provided widgets such as chat, markdown, forms, or progress panels as vanilla/custom-element primitives.
- First-version workstation content is manifest-carried `html`/`srcDoc`.
- This avoids introducing extension static asset serving, bundle path resolution, cache invalidation, and trust hashing for generated assets in the same slice.

### Preserved boundaries

- The build engine still consumes normalized build source and typed events.
- The build engine does not learn workstation concepts beyond extension registry/manifest projection.
- Extension-owned raw HTTP route registration remains unsupported.
- Existing declarative Console contributions under `/console/system` remain unchanged and backward-compatible.
- Existing extension actions keep their daemon-side validation, timeout, side-effect metadata, and lifecycle events.
- Existing Pi/Claude/CLI contribution discovery can ignore workstation entries unless explicitly updated later.
- Action-backed commands/deep links remain the cross-host generic surface.
- Console React component internals remain private.
- Extensions should not import Console React components.
- Reusable UI should be exposed through a versioned workstation browser SDK surface or declarative/host-rendered slots.

### Design decisions

1. Choose sandboxed iframe workstations over same-origin React/component injection.
   - Rationale: existing Console code has no CSP/frontend plugin boundary; direct same-origin JS would inherit local daemon API reachability.
   - A sandboxed iframe creates an explicit browser boundary while still allowing rich UI.
   - Evidence: `packages/monitor/src/http/static-assets.ts` serves first-party Console assets only and no CSP was found.
   - Evidence: `docs/extensions.md` explicitly defers arbitrary Console JS/React bundles.

2. Use manifest-carried `html`/`srcDoc` for V1 instead of separately served asset bundles.
   - Rationale: extension trust hashing currently includes source files and `package.json`, but excludes `dist/` and non-source assets.
   - Serving generated bundle files safely would require a separate trust/hash/cache/version design.
   - Inline/source-carried HTML keeps V1 under the existing trusted extension source model.
   - Evidence: `packages/engine/src/extensions/hash.ts` includes `.ts`, `.mts`, `.js`, `.mjs`, and `package.json`, while excluding `dist/`.

3. Add a dedicated workstation contribution family instead of overloading `ConsoleContributionBlockSchema` with an `iframe` renderer.
   - Rationale: workstations need route/navigation metadata, iframe lifecycle, bridge permissions, and a different threat model than closed declarative System blocks.
   - Keeping them as a separate manifest family avoids weakening the closed renderer contract for System contributions.
   - Evidence: current block schema and tests intentionally reject unknown renderer IDs such as `iframe`.

4. Make Console the only bridge from browser workstation code to daemon actions.
   - Rationale: the iframe should not fetch daemon routes directly.
   - Parent-side validation preserves action schema validation, timeout behavior, and existing action provenance/events.
   - Bridge request shape, subject to implementation refinement: `{ type: 'eforge:workstation:invoke-action', requestId: string, actionId: string, input: object }`.
   - Bridge response shape, subject to implementation refinement: `{ type: 'eforge:workstation:action-result', requestId: string, response: ExtensionActionInvokeResponse }`.
   - Developer-facing helper shape, subject to implementation refinement: Console injects `window.eforge.invokeAction(actionId, input)` into the iframe as a versioned wrapper over the bridge.

5. Require explicit or derivable action allowlisting.
   - Rationale: a workstation should not be a generic action dispatcher for every loaded extension.
   - The manifest should include `allowedActions?: string[]`.
   - If omitted, the implementation may derive same-extension actions only and document that default.

6. Add top-level Console navigation for workstations.
   - Rationale: the product goal is first-class workstation UI, not another System diagnostic panel.
   - A Workstations route can show an empty state when none are registered.

7. Defer remote/asset bundle support.
   - Rationale: bundle serving needs answers for trust hashing, cache invalidation, dependency isolation, package lifecycle, CSP, static asset path containment, and dev workflow.
   - Those should be designed on top of the iframe boundary after V1 proves the workstation contract.

8. Make extension authoring LLM-first and discoverable.
   - Rationale: the expected author is often an LLM-driven coding environment such as Pi, Codex, or Claude Code, not a human manually reading an API reference.
   - Documentation and examples should be optimized for agent discovery and task execution.
   - Evidence: `web/public/llms.txt` already points agents to extension docs/API.
   - Evidence: `web/content/docs/troubleshooting.md` documents that docs generation refreshes `/llms.txt` and `/llms-full.txt`.

9. Add a canonical extension SDK migration guidance surface.
   - Rationale: when extension SDK APIs break in the future, LLMs need a stable, discoverable migration source rather than inferring from changelogs or stale examples.
   - First-version shape: add or update a docs page/section for extension SDK stability and migrations.
   - Link the migration guidance from extension docs and LLM artifacts via docs generation.
   - State that future breaking SDK changes must include migration guidance there.

10. Treat SDK-provided workstation UI as a versioned browser toolkit, not shared Console React imports.
    - Rationale: this matches the iframe isolation model and avoids coupling extensions to Console's React version/build pipeline.
    - V1 should reserve and document the toolkit/bootstrap boundary, with a minimal action helper if feasible.
    - Rich SDK widgets such as a chat UI can be follow-up components implemented as host-injected vanilla JS/custom elements or host-rendered slots controlled by manifest/config.
    - Analogy: this is closer to a VS Code-style webview API plus contributed host surfaces than a plugin importing host-private UI components.

User-confirmed decision:

- V1 is `srcDoc`/inline iframe workstations with an action bridge.
- Separately loaded extension asset bundles remain deferred.

### Code impact

Likely implementation targets, verified by file reads/searches:

- `packages/client/src/extension-contributions.ts` should add `ConsoleWorkstationManifestEntrySchema`, exported types, parse helpers coverage, and a `consoleWorkstations` array to `ExtensionContributionManifestResponseSchema`.
- `packages/client/src/browser.ts` and package exports should expose the new workstation types through the browser-safe entry point if needed.
- `packages/client/src/api-version-const.ts` should bump `DAEMON_API_VERSION` because Console will require the new manifest field.
- `packages/client/src/__tests__/extension-contributions.test.ts` should verify workstation schema acceptance/rejection and manifest compatibility.
- `packages/extension-sdk/src/contributions.ts` should add author-facing `ConsoleWorkstation` types and `defineConsoleWorkstation` helper.
- `packages/extension-sdk/src/index.ts` or relevant exports should export the helper/types.
- `packages/engine/src/extensions/types.ts` should add workstation registration/spec types and `registerConsoleWorkstation` to the API shape and registry state.
- `packages/engine/src/extensions/recorder.ts` should capture workstation registrations, validate local IDs with existing contribution ID rules, and record diagnostics for invalid/duplicate registrations.
- `packages/engine/src/extensions/manifest.ts` should project workstation registrations into client-owned manifest entries and include diagnostics.
- `packages/engine/src/extensions/projector.ts` and management/detail projection files should be updated if registration counts/details are surfaced in extension list/show output.
- `packages/monitor/src/routes/extensions/contribution-service.ts` and `packages/monitor/src/routes/extensions/contributions.ts` likely do not need a new route, but tests must prove the enlarged manifest flows through the existing local-only read route.
- `packages/console-ui/src/lib/navigation.ts` and `packages/console-ui/src/app.tsx` should add Workstations route(s), parse/canonicalize `/console/workstations` and `/console/workstations/:workstationId`, and lazy-load the view.
- `packages/console-ui/src/components/header/control-surface-links.tsx` should include Workstations in top-level navigation, likely always visible.
- `packages/console-ui/src/views/workstations/` should contain the new view, selectors, iframe renderer, action bridge, and empty/error states.
- `packages/console-ui/src/views/system/system-types.ts` or a shared type re-export module should include workstation manifest types from `@eforge-build/client/browser` instead of local daemon interface declarations.
- Console tests under `packages/console-ui/src/views/workstations/__tests__/` or existing app/navigation tests should cover route parsing, listing/rendering, sandbox attributes, bridge allowlist enforcement, and invocation result posting.
- `docs/extensions.md`, `docs/extensions-api.md`, `packages/extension-sdk/README.md`, and `packages/console-ui/README.md` should document supported V1 and deferred phases.
- `eforge/extensions/eforge-plan/index.ts` should register a minimal proof-of-concept workstation after SDK support lands.
- The `eforge-plan` proof-of-concept can render a rough hello-world/status panel.
- If practical, the `eforge-plan` proof-of-concept can call an existing eforge-plan action such as `render-board-markdown` through the workstation bridge.
- `eforge/extensions/eforge-plan/README.md` should update the deferred platform-gap note to say first-class iframe workstations now exist, while bundle assets/AI APIs/full planning workstation remain follow-ups.

Pattern constraints:

- Do not inline new `/api/...` paths.
- Route constants remain in `@eforge-build/client`.
- Do not re-declare daemon wire interfaces in Console.
- Console must consume client/browser types.
- New implementation files should stay under 600 lines.
- Large files should get bounded exact edits.

### Documentation impact

Documentation updates required:

- `docs/extensions.md` should add a section for Console workstations under Actions/Console contributions/commands/deep links.
- `docs/extensions.md` should explain sandboxed iframe V1, manifest-carried HTML, action bridge, trusted extension source, and deferred asset bundles/raw HTTP routes.
- `docs/extensions-api.md` should document `registerConsoleWorkstation`, `ConsoleWorkstation`, bridge behavior, allowed actions, and runtime status table updates.
- `packages/extension-sdk/README.md` should add a quick authoring example for a minimal workstation.
- `packages/extension-sdk/README.md` should clarify that V1 is iframe `srcDoc`, not shared React.
- An LLM-oriented extension authoring guide/checklist should be added or updated so Pi/Codex/Claude Code can follow it when asked to build an extension from natural language.
- Extension SDK stability/versioning/migration guidance should be added or updated.
- Extension SDK stability/versioning/migration guidance should be linked from the extension docs/API reference.
- `packages/console-ui/README.md` should update the route table/data flow with `/console/workstations`.
- `packages/console-ui/README.md` should update “Adding a new control surface” to distinguish source-owned routes, declarative contributions, and extension-registered workstations.
- `README.md` likely needs one short mention in the configuration/extensions paragraph if the public-facing capability should be advertised.
- `web/content/docs/extensions.md` and `web/content/docs/extensions-api.md` should be regenerated through the `pnpm docs:generate` or `pnpm docs:check` workflow if docs artifacts are generated from `docs/`.
- `web/public/llms.txt` should expose the workstation docs, extension authoring guide/checklist, and migration guidance.
- `web/public/llms-full.txt` should expose the workstation docs, extension authoring guide/checklist, and migration guidance.
- `eforge/extensions/eforge-plan/README.md` should update the deferred-platform-gaps paragraph so it does not incorrectly claim workstation APIs are entirely absent after this build.
- Documentation must preserve the deferred status of separately served frontend bundles.
- Documentation must preserve the deferred status of direct React renderer injection.
- Documentation must preserve the deferred status of raw extension-owned HTTP routes.
- Documentation must preserve the deferred status of extension-owned AI planning/chat APIs.
- Documentation must make the happy path obvious to an LLM agent: scaffold/new, write typed registrations, run validate/test, trust/reload when needed, and update migration guidance when APIs break.

### Risks and mitigations

- Browser trust boundary risk: arbitrary same-origin JS could call daemon routes directly.
  - Mitigation: V1 uses sandboxed iframe without `allow-same-origin`; bridge calls are parent-validated.
- Scope creep risk: true bundle serving requires trust hashing for non-source/generated files, path containment, cache invalidation, package lifecycle UX, CSP, and dev-server ergonomics.
  - Mitigation: V1 uses manifest-carried HTML and explicitly defers asset routes.
- Action exfiltration / confused deputy risk: iframe code could try to invoke unrelated extension actions.
  - Mitigation: workstation manifest declares allowed actions or implementation derives same-extension-only defaults; Console rejects unknown/disallowed actions before daemon invocation.
- API drift risk: Console and daemon disagree on manifest fields.
  - Mitigation: client-owned schema/types, API version bump, and route tests.
- Unsafe HTML misconception risk: developers may think iframe content is sanitized.
  - Mitigation: docs must state workstation HTML is trusted extension UI, isolated by iframe sandbox, not sanitized declarative content.
- Testing realism risk: jsdom cannot fully enforce browser iframe sandbox behavior.
  - Mitigation: unit-test attributes and bridge validation logic; rely on browser semantics for actual sandbox enforcement; avoid acceptance criteria that require manual visual-only verification.
- UX discoverability risk: adding a permanent Workstations nav item may be noisy when no workstations exist.
  - Mitigation: empty state explains how to register one; this is acceptable for first-class platform capability.
- Backward compatibility risk: existing consumers may parse manifests without the new field.
  - Mitigation: additive schema with API version bump for first-party Console; generic host contribution tools can ignore `consoleWorkstations` if not updated to display them.

### Assumptions and validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| A sandboxed iframe `srcDoc` workstation is an acceptable first version, while separately served asset bundles are deferred. | User confirmed this V1 scope on 2026-06-05; code/docs show no existing asset route, no CSP model, and trust hash excludes generated/non-source assets. | high | low | No further validation needed for V1 scope; revisit before implementing served bundle assets. | Low for V1; future bundle work still needs separate asset routing/trust hashing design. |
| Workstation action bridge over existing extension actions provides enough interactivity for V1. | Current eforge-plan extension already models host/UI interactions as actions (`list-board`, `render-board-markdown`, `capture-item`, `promote-item`, etc.); daemon action route already validates input/output and emits lifecycle events. | medium | low | Confirm with user; optionally add a tiny example workstation in tests that invokes a stub action through the bridge. | Medium: if richer streaming/state APIs are needed immediately, V1 is too constrained. |
| `iframe sandbox="allow-scripts"` without `allow-same-origin` is viable for the first Console-hosted workstation renderer. | Browser sandbox model supports script execution in an opaque-origin iframe; no code evidence contradicts this. Console tests can assert attributes and bridge guards, but jsdom will not enforce full browser security semantics. | medium | medium | Implement the iframe renderer and run browser/dev-server smoke manually if desired; unit-test bridge validation. | High: if browser behavior blocks necessary UI patterns, renderer needs adjusted sandbox flags or a different isolation model. |
| Adding `consoleWorkstations` to the existing contribution manifest is better than adding a separate daemon route in V1. | Existing manifest already carries actions, Console contributions, commands, and deep links; monitor contribution routes can return enlarged manifest without extension-owned routes. | high | low | Schema and route tests verify field projection; Console consumes client/browser types. | Low/medium: if manifests become large due to inline HTML, a later route or lazy loading may be needed. |
| Inline HTML size will remain small enough for local manifest responses in V1. | V1 is intended for first dogfood/workstation prototypes, not production bundle assets. No current data suggests huge HTML payloads. | medium | low | Document guidance; add no hard limit in V1 unless existing request/response paths impose one. | Medium: large workstations could slow System/Workstations manifest loads and motivate asset routes sooner. |
| Existing extension trust source hash is adequate for inline HTML stored in TypeScript/JavaScript source. | `hash.ts` includes `.ts`, `.mts`, `.js`, `.mjs` files and `package.json`, so string literals in extension source affect project-team trust hashes. | high | low | No further validation needed beyond code inspection; tests for hash behavior already exist or can be extended only if implementation changes hash rules. | Low: if authors load HTML from external un-hashed files, docs/API should discourage or validate against that. |

Additional confirmed requirement:

- Extension authoring must be optimized for LLM-driven coding assistants.
- `/llms.txt` and `/llms-full.txt` should make extension authoring, workstation APIs, examples, validation commands, and SDK migration guidance discoverable.

### Profile signal

Recommended profile: **Excursion**.

Rationale: this is a cross-package feature touching client schemas, extension SDK, engine extension registry/projection, daemon contribution routes, Console routing/rendering, and docs. It is architecture-sensitive but cohesive: one planner can enumerate the implementation sequence and dependencies without delegating independent module-planning work.

It should not use Expedition unless the scope expands to independently served frontend bundle assets, CSP policy, package lifecycle, and trust-hash redesign in the same build.

## Scope

In scope:

- Add a new extension SDK contribution family, tentatively `registerConsoleWorkstation`, for manifest-backed rich Console workstations.
- Add client-owned wire schema/types for workstation manifest entries.
- Include `consoleWorkstations` in the existing extension contribution manifest response.
- Capture workstation registrations in the engine extension recorder/registry/manifest projection alongside actions, Console contributions, integration commands, and deep links.
- Render discovered workstations in Console under a first-party route, tentatively `/console/workstations` and `/console/workstations/:workstationId`.
- Render the first version as a sandboxed iframe whose content is extension-provided HTML (`srcDoc`) carried in the trusted manifest, not as same-origin React component injection.
- Add a minimal parent-owned `postMessage` bridge so iframe UI can request invocation of existing extension actions through `invokeExtensionAction`.
- Inject or expose a tiny versioned browser-side workstation SDK/bridge in the iframe, tentatively `window.eforge`, so extension HTML has a stable helper API for action invocation instead of hand-writing `postMessage` protocol details.
- Restrict bridge calls to allowed action IDs declared by the workstation manifest.
- Default bridge calls to same-extension actions only if that is implemented more simply and documented.
- Add route/navigation tests.
- Add rendering tests.
- Add schema tests.
- Add recorder/manifest tests.
- Add action-bridge tests.
- Add a rough proof-of-concept workstation to one existing project-team extension, preferably `eforge/extensions/eforge-plan` because it is the current dogfood planning extension.
- Make the proof-of-concept workstation a simple “hello world”/status iframe that invokes one existing action if enough for the slice.
- Update docs to describe the first-version workstation model and deferred bundle/asset phases.
- Update the eforge-plan extension README to describe the first-version workstation model and deferred bundle/asset phases.
- Add an LLM-oriented extension authoring quickstart or checklist that tells agents how to scaffold, validate, test, trust, reload, and publish/use workstation-capable extensions.
- Add discoverable extension SDK versioning and migration guidance, so future breaking SDK changes have a canonical place for LLMs to find migration instructions.

Out of scope for this first version:

- Direct React component sharing or Module Federation between Console and extensions.
- Serving independent extension asset bundles from daemon-owned routes.
- Extension-owned raw HTTP routes.
- Remote package lifecycle UX for browser bundles.
- A general CSP policy for all Console pages beyond iframe sandboxing and any per-iframe protections added for this slice.
- Workstation-owned AI planning/chat runtime APIs.
- A full natural-language extension builder beyond documenting and linking the existing `/eforge:extend`/extension tooling discovery path.
- Shipping a full SDK-provided chat UI widget in this first slice.
- Migrating the eforge-plan extension from its declarative System panel into a full workstation.
- Separately hosted asset bundles.
- Package-managed browser build output.
- Module Federation/shared React loading.
- Extension-owned HTTP routes.
- Served bundle assets until trust hashing, cache invalidation, dependency isolation, package lifecycle, CSP, static asset path containment, and dev workflow are designed.

## Acceptance Criteria

- `@eforge-build/extension-sdk` exports author-facing types for registering a Console workstation.
- `@eforge-build/extension-sdk` exports author-facing helpers for registering a Console workstation.
- `EforgeExtensionAPI` includes a `registerConsoleWorkstation` method that extension factories can call during registration capture.
- `@eforge-build/client` exposes a client-owned `ConsoleWorkstationManifestEntry` schema.
- `@eforge-build/client` exposes a client-owned `ConsoleWorkstationManifestEntry` type.
- `ExtensionContributionManifestResponse` includes a `consoleWorkstations` array in its validated wire shape.
- Invalid workstation manifest entries fail client schema validation.
- Console does not declare a local workstation wire interface for daemon manifest responses.
- Engine extension registration capture records valid workstation registrations in the native extension registry.
- Engine extension registration capture records diagnostics for invalid workstation local IDs.
- Engine extension registration capture records diagnostics for duplicate workstation local IDs.
- The daemon contribution manifest route returns registered workstation entries through `API_ROUTES.extensionContributionManifest`.
- `DAEMON_API_VERSION` is bumped for the workstation manifest contract.
- Console parses `/console/workstations` as a Workstations route.
- Console parses `/console/workstations/:workstationId` as a workstation detail route.
- Console top-level navigation includes a Workstations link.
- The Workstations route renders an empty state when the manifest contains zero workstation entries.
- The Workstations route lists discovered workstation entries from the contribution manifest.
- Selecting a workstation renders its HTML inside an iframe.
- The workstation iframe has a `sandbox` attribute that includes `allow-scripts`.
- The workstation iframe has a `sandbox` attribute that does not include `allow-same-origin`.
- Console validates workstation iframe `postMessage` requests before invoking an extension action.
- Console rejects a workstation iframe action request when the source window does not match the selected workstation iframe.
- Console rejects a workstation iframe action request when the action id is not allowed for the selected workstation.
- Console invokes allowed workstation action requests through the existing `invokeExtensionAction` browser helper.
- Workstation action invocations set `requestedBy.host` to `console`.
- Workstation action invocations set `requestedBy.surface` to `workstation:<workstationId>`.
- Console posts action invocation success results back to the requesting iframe with the original request id.
- Console posts action invocation failure results back to the requesting iframe with the original request id.
- Workstation iframe content can invoke an allowed action through a documented browser helper instead of manually constructing the raw `postMessage` request.
- If the proof-of-concept workstation includes an action call, the call uses the documented browser helper.
- If the proof-of-concept workstation includes an action call, the call is covered by a targeted test or documented fixture.
- Existing declarative Console contributions under `/console/system` continue rendering with the closed renderer ID set.
- Client tests cover workstation manifest schema acceptance.
- Client tests cover workstation manifest schema rejection.
- Engine tests cover workstation registration capture.
- Engine tests cover workstation manifest projection.
- Console tests cover workstation route parsing.
- Console tests cover the Workstations empty state.
- Console tests cover workstation iframe sandbox attributes.
- Console tests cover workstation action bridge validation.
- Extension docs describe the V1 workstation model as sandboxed iframe `srcDoc` with a parent-owned action bridge.
- Extension docs state that separately served frontend asset bundles remain deferred.
- Extension docs state that direct React component loading remains deferred.
- Extension docs state that extension-owned HTTP routes remain deferred.
- `packages/console-ui/README.md` documents the Workstations route.
- `packages/console-ui/README.md` documents the current deferred bundle scope.
- `eforge/extensions/eforge-plan/README.md` no longer claims workstation APIs are entirely absent after this feature lands.
- Extension authoring docs include an LLM-oriented happy path for creating an extension from a natural-language request.
- Extension authoring docs name the command for scaffolding an extension.
- Extension authoring docs name the command for validating an extension.
- Extension authoring docs name the command for testing an extension.
- Extension authoring docs name the command or workflow for trusting an extension.
- Extension authoring docs name the command or workflow for reloading an extension.
- Extension authoring docs include a minimal workstation example that an LLM can copy and adapt.
- An existing project-team extension registers at least one rough proof-of-concept workstation.
- The proof-of-concept workstation appears in the Console Workstations list when that extension is loaded and trusted.
- The proof-of-concept workstation renders visible hello-world or status content in its iframe.
- Workstation docs describe the browser-side SDK/bridge exposed to iframe content.
- Workstation docs state that reusable SDK-provided widgets such as chat should use the versioned workstation browser SDK or host-rendered slots.
- Workstation docs state that reusable SDK-provided widgets such as chat should not use private Console React imports.
- Extension SDK docs include a stability and versioning section for extension authors.
- Extension SDK docs include a canonical migration-guidance location for future breaking extension SDK changes.
- Generated `/llms.txt` references the extension authoring guidance.
- Generated `/llms.txt` references the migration guidance.
- Generated `/llms-full.txt` contains the extension authoring guidance content.
- Generated `/llms-full.txt` contains the migration guidance content.
- `pnpm docs:generate` completes without errors.
- `pnpm docs:check` exits 0.
- `pnpm type-check` exits 0.
- `pnpm test` exits 0.

## Manual Verification Notes

- A browser/dev-server smoke check may be run manually after implementing the iframe renderer to validate real browser sandbox behavior.
- The browser/dev-server smoke check is informational because jsdom cannot fully enforce browser iframe sandbox semantics.
- Unit tests should still validate iframe attributes and bridge validation logic.