---
description: Author eforge TypeScript extensions from a natural-language request using the existing extension tooling and docs/examples
argument-hint: "[extension request]"
---

# /eforge:extend

Author eforge TypeScript extensions from a natural-language request using the existing extension tooling, docs, and examples. The workflow is conversational: classify the requested behavior, scaffold with `mcp__eforge__eforge_extension`, edit the returned file with normal file tools, validate, optionally replay-test, reload, and summarize trust/security notes.

## Workflow

### Step 1: Argument intake

- If `$ARGUMENTS` is missing or empty, ask what eforge behavior the user wants to add and stop until they answer.
- Generate a kebab-case extension name from the request.
- Ask for a name only when the generated name is ambiguous or conflicts with an existing extension.

### Step 2: Required context read

Before scaffolding or editing, read these required eforge docs. Prefer the repository-local paths below when they exist; in an installed consumer project where they are not present, use the same documents from https://eforge.build/docs/extensions, https://eforge.build/docs/extensions-api, and https://github.com/eforge-build/eforge/tree/main/examples/extensions.

- `docs/extensions.md`
- `docs/extensions-api.md`
- `examples/extensions/README.md`

Then read relevant examples based on the classified capability:

- `examples/extensions/minimal-event-logger.ts` for event hooks.
- `examples/extensions/slack-webhook-notifier.ts` for webhook/notification hooks.
- `examples/extensions/agent-context.ts` for prompt context.
- `examples/extensions/agent-tools.ts` for custom agent tools.
- `examples/extensions/profile-router.ts` for profile selection.
- `examples/extensions/protected-paths.ts` for runtime-supported plan/final merge policy gates.
- `examples/extensions/issue-tracker.ts` for runtime-supported input source adapters (GitHub, Linear, Jira).
- `examples/extensions/reviewer-perspective.ts` for runtime-supported reviewer perspectives with declarative file-pattern applicability.

### Step 3: Capability classification

Classify the requested behavior before choosing a template or editing code.

Runtime-supported capability families:

- `onEvent` event subscriptions and event replay.
- `onAgentRun` prompt context, per-run tools, and per-run allowed/disallowed tuning.
- `defineExtensionTool` + `registerTool` + returning `tools` from `onAgentRun` for runtime custom tool injection. `registerTool` alone is provenance capture; runtime tool injection requires returning the tool from `onAgentRun`.
- `registerProfileRouter` pre-build profile selection.
- `beforeQueueDispatch`, `beforePlanMerge`, and `beforeFinalMerge` blocking policy gates. `require-approval` currently blocks because no approval workflow/UI/state exists, and policy gate contexts are read-only snapshots. These helpers do not sandbox extension code; extensions are trusted unsandboxed code.
- `registerInputSource` input source adapters — supply PRD/build-source artifacts from external systems via `eforge://input/<adapter>/<id>` URIs. Adapter selection is by `name` match. Input-source failures (null return or throw) are fatal to enqueue; design adapters to return instructional content when credentials are absent.
- `registerPrdEnricher` PRD enrichers — mutate or augment PRD content before queue write. Enrichers run in registration order for every preprocessed source; failures are fail-open (`extension:prd-enricher:failed`). Gate behavior inside `enrich` using `ctx.sourceKind`, `ctx.adapterId`, or `ctx.sourcePath`.
- `registerReviewerPerspective` reviewer perspectives — inject custom prompt context into the reviewer agent during parallel review-cycle perspective dispatch (`review.strategy: parallel`, or `auto` once the diff crosses the parallel-review thresholds). Applicability is declared via `appliesTo.fileGlobs`, `paths`, `extensions`, `categories`, or `minChanged*` thresholds; a function-form `appliesTo.fn(changedFiles, changedLines)` escape hatch is also available. Applicability inputs are read-only snapshots; perspectives cannot mutate orchestration state. Failures are fail-open (`extension:reviewer-perspective:skipped` with reason `applicability-error` or `applicability-timeout`). See `examples/extensions/reviewer-perspective.ts` for an accessibility example.

Runtime-deferred capability families:

- `registerAction`, `registerConsoleContribution`, `registerIntegrationCommand`, and `registerDeepLink` are SDK methods for extension-authored actions and host-facing contributions; daemon manifest projection and action invocation are runtime-supported, while Console rendering and host command/deep-link UX are deferred.
- `beforeEnqueue` and `beforeValidation` policy gates.
- Approval workflow/UI/state and `modify` policy decisions.
- `registerValidationProvider` validation providers.

If user intent maps to the supported policy-gate, reviewer-perspective, or extension-action subset, explain that the capability executes at runtime and note the parallel-review condition for reviewer perspectives or daemon invocation boundary for actions. If user intent maps to deferred APIs, state whether the current SDK provides only a type contract or a captured registration, and that it will not execute at runtime yet. Ask whether to omit that portion or include it as a clearly labeled future-facing registration. Avoid promising that deferred capability families will enqueue, validate, approve, mutate, render Console UI, provide host command/deep-link UX, or validate builds at runtime.

### Step 4: Scope selection

- Default to `scope: "local"` for experiments and project-local personal behavior; this targets `.eforge/extensions/`.
- Use `scope: "user"` only for explicit cross-project personal extensions.
- Use `scope: "project"` only for explicit team-shared extensions. Project/team extensions (`eforge/extensions/`) are unsandboxed arbitrary code committed to the repository; they require an explicit per-extension local trust record in `.eforge/extension-trust.json` — created by `eforge extension trust <name>` — before loading. Any subsequent code change invalidates the stored hash and blocks the extension until re-trusted. Warn the user of these implications before proceeding.

### Step 4b: Package install workflow (when user requests installing a packaged extension)

If the user asks to install an extension from an npm package, local package directory, or tarball rather than authoring one from scratch, use the following workflow instead of Steps 5-6:

1. Clarify the install source (npm package name, local package directory, or tarball path/URL) and desired scope.
2. Warn the user that installed extensions are unsandboxed arbitrary code and installing from npm, tarballs, or local package directories introduces supply-chain risk.
3. Call `mcp__eforge__eforge_extension` with `action: "install"`, `source` set to the package name, local package directory, or tarball path/URL, and the selected `scope`. Pass `trust: true`, and optionally `trustedBy`, only when the user explicitly opts in after the warning.
4. On install success, call `mcp__eforge__eforge_extension` with `action: "list"` and confirm the installed entry appears.
5. **If the entry has `trustState: "untrusted"` or `"changed"` and the returned entry's `scope` is `project-team`:**
   - Read the installed extension files in full.
   - Summarize all side effects (filesystem, network, environment, subprocess). Show the summary.
   - Ask for explicit user confirmation before trusting. Do not proceed if they decline.
   - After confirmation, call `mcp__eforge__eforge_extension` with `action: "trust"` and the extension `name`.
6. After trust, call validate and then reload (with the same confirmation warnings as Steps 7-9 below).

**Promote and demote:**

If the user asks to promote a project-local extension to project/team scope or demote it back:

1. Call `mcp__eforge__eforge_extension` with `action: "promote"` or `"demote"` and the extension `name`.
2. After promotion to project-team scope: warn that team members will be required to trust this extension, read the extension files, summarize side effects, and ask for explicit confirmation before trusting. Call `action: "trust"` after confirmation.
3. After demotion to project-local scope: no trust step is required.

**Update and remove:**

For updating or removing an installed extension, call `mcp__eforge__eforge_extension` with `action: "update"` or `action: "remove"` and the extension `name`. After update, verify trust state (a changed source file invalidates the stored hash) and re-trust if needed. Pass `force: true` only when the user explicitly requests forced removal.

### Step 5: Scaffold

- Optionally call `mcp__eforge__eforge_extension` with `action: "list"` first to inspect existing extensions and shadowing.
- Call `mcp__eforge__eforge_extension` with `action: "new"`, the generated `name`, selected `scope`, and selected `template`:
  - `event-logger` for event-driven requests.
  - `blank` for non-event or complex mixed requests.
- Use the returned `path` for file reads and edits; do not hard-code scope paths when the tool returns a path.

### Step 6: Edit

- Read the scaffolded file at the returned `path`.
- Apply TypeScript edits using the required docs and examples as the source of truth.
- Use environment variables for secrets, tokens, webhook URLs, and other credentials; do not commit secrets into source.
- Preserve deferred-runtime caveats in code comments when including future-facing registrations.
- For policy gates, prefer `beforeQueueDispatch`, `beforePlanMerge`, and `beforeFinalMerge`; document that `require-approval` blocks in the current MVP and that extensions remain unsandboxed trusted code.

### Step 7: Validate

**Project/team scope: inspect and trust first.** If the extension is in project/team scope (`eforge/extensions/`):

- Read the extension file(s) in full before trust, validate, test, or reload.
- Summarize all side effects (filesystem, network, environment, subprocess). Show the summary and ask for explicit user confirmation before proceeding. Do not proceed if they decline.
- After confirmation, record the current content hash by calling `mcp__eforge__eforge_extension` with `action: "trust"` and the extension `name` or `path`. This writes a trust record to `.eforge/extension-trust.json`. If the code changed since the last trust, the extension is blocked (status `changed`) until re-trusted — confirm with the user before overwriting an existing trust record.
- The hash covers the entrypoint for file-layout extensions and, for directory-layout extensions, `package.json` plus `.ts`, `.mts`, `.js`, and `.mjs` files under the extension directory. Files imported from outside the extension directory and non-source/data files inside it are not hashed; keep implementation code inside the extension directory and in hashed source files to ensure relevant code changes are captured.
- Proceed to validate only after trust succeeds and the user has confirmed.

- Before validation, warn that extension loading is unsandboxed in the daemon process; review the code first and do not validate code with unexpected top-level filesystem, network, or environment side effects.
- Show the user a brief side-effect review and ask for explicit confirmation before calling validate; do not proceed if they decline.
- After editing and confirmation, call `mcp__eforge__eforge_extension` with `action: "validate"` by `name` or returned `path`.
- If validation returns `valid: false`, summarize diagnostics, fix the file, and validate again.
- Do not call `reload` after failed validation.

### Step 8: Optional test

- Offer event replay testing after validation.
- Use `mcp__eforge__eforge_extension` with `action: "test"` by `name` or `path`, plus `fixture`, `run`, or `event` when the user supplies an event source.
- Warn that replay executes matching `onEvent` handlers in the daemon process and can trigger filesystem, network, or environment side effects.
- Ask for explicit confirmation before running the replay test, even after validation succeeds.
- If no safe event source exists, the user declines confirmation, or the extension has side effects, skip testing and record the reason in the final summary.

### Step 9: Reload

- Before reload, warn that reload activates unsandboxed extension code in the daemon process.
- Ask for explicit confirmation before reload.
- Call `mcp__eforge__eforge_extension` with `action: "reload"` only after validation succeeds and after the user confirms that warning.
- Summarize watcher fields from the response when present: `wasRunning`, `restarted`, `running`, and `message`.

### Step 10: Final summary

Report:

- Extension name, scope, returned path, selected template, and capability families used.
- Validation result, optional test result or skipped-test reason, and reload result.
- Any deferred-runtime caveats that apply to the generated extension.
- Security/trust notes: extensions are unsandboxed code execution, project/team scope requires explicit trust, and secrets belong in environment variables rather than committed source.
- Follow-up commands: validate, test with fixture/run, reload, and where to edit the file.
