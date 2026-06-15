# Extension examples

These examples demonstrate the `@eforge-build/extension-sdk` API. Each example is imported by `test/extension-sdk-example.test.ts` so TypeScript verifies its default export conforms to `EforgeExtensionFactory`.

## Examples

| Example | Primary API | Runtime status |
|---------|-------------|----------------|
| `minimal-event-logger.ts` | `onEvent('plan:build:failed', ...)` | Runtime-supported event dispatch and replay |
| `slack-webhook-notifier.ts` | `onEvent('plan:error:set', ...)` | Runtime-supported event dispatch and replay; webhook send is skipped unless `EFORGE_SLACK_WEBHOOK_URL` is set |
| `agent-context.ts` | `onAgentRun(...)` | Runtime-supported prompt-context augmentation |
| `agent-tools.ts` | `defineExtensionTool(...)`, `registerTool(...)`, `onAgentRun(...)` | Runtime-supported per-run extension tool injection and availability tuning |
| `profile-router.ts` | `registerProfileRouter(...)` | Runtime-supported pre-build dispatch; explicit `profile:` frontmatter wins; routers fail open |
| `protected-paths.ts` | `beforePlanMerge(...)`, `beforeFinalMerge(...)` | Runtime-supported policy enforcement for plan/final merge protected paths |
| `issue-tracker.ts` | `registerInputSource(...)` x3 | Runtime-supported input source dispatch via `eforge://input/<adapter>/<id>` |
| `reviewer-perspective.ts` | `registerReviewerPerspective(...)` | Runtime-supported parallel review-cycle dispatch; perspective runs when diff includes matching UI/TSX files |
| `validation-provider.ts` | `registerValidationProvider(...)` | Runtime-supported per-plan validate-stage execution; demonstrates both function-form (programmatic) and command-form (subprocess) providers |
| `action-contribution.ts` | `registerAction(...)`, `registerConsoleContribution(...)`, `registerIntegrationCommand(...)`, `registerDeepLink(...)` | Runtime-supported action dispatcher, Console System rendering, and host discovery/invocation for action-backed contributions |

### `minimal-event-logger.ts`

Subscribes to `plan:build:failed` events and logs through the extension context logger. Demonstrates default-export factory style, typed `onEvent` subscription, and `EventOfType<T>` narrowing.

### `slack-webhook-notifier.ts`

Subscribes to `plan:error:set` lifecycle events and formats a Slack-compatible webhook payload. The example is safe by default:

- It reads the destination from `EFORGE_SLACK_WEBHOOK_URL`.
- It contains no real webhook URL or token.
- It logs and skips when the env var is unset, so import tests and replay tests do not require network credentials.

> **Replay note:** `eforge extension test` executes matching event hooks. If `EFORGE_SLACK_WEBHOOK_URL` is set, replaying matching `plan:error:set` events will send webhook requests.

### `agent-context.ts`

Appends role- and tier-scoped context to agent prompts at runtime using the `onAgentRun` hook. Demonstrates filtering by `ctx.role` and `ctx.tier`, returning `{ promptAppend: '...' }`, and including lifecycle metadata such as `ctx.phase`.

The returned fragment is appended after any config-level `promptAppend`, wrapped in a named provenance section (`## Native extension context / ### <extension-name>`). Handlers are fail-open: a throw or timeout emits a typed `extension:agent-context:*` diagnostic but does not abort the agent run.

> **Runtime note:** `promptAppend` is runtime-supported. Use `agent-tools.ts` for the supported custom-tool injection pattern.

### `agent-tools.ts`

Defines a TypeBox-backed tool with `defineExtensionTool`, registers it with `eforge.registerTool(...)` for loader-time provenance, and returns it from `eforge.onAgentRun(...)` only for builder runs. The prompt text uses `ctx.effectiveToolName(...)` so the agent sees the harness-visible tool name.

The example also includes a conservative `disallowedTools` entry to show that `allowedTools` and `disallowedTools` are per-run harness availability tuning, not toolbelt configuration. Toolbelts continue to select only project MCP servers declared in `.mcp.json`.

### `profile-router.ts`

Implements a Claude → Codex → local fallback profile selection strategy using `registerProfileRouter`. Demonstrates `selectBuildProfile`, `ctx.usage.profile(name)`, returning `{ profile, reason, confidence }`, returning `null` to defer, and env-var-driven configuration (`EFORGE_PROFILE_PRIMARY`, `EFORGE_PROFILE_SECONDARY`, `EFORGE_PROFILE_LOCAL`).

Default profile names are `claude-sdk-4-7` (primary), `pi-codex-5-5` (secondary), and `pi-deepseek-qwen` (local fallback). All three can be overridden via environment variables.

> **Runtime note:** `registerProfileRouter` is wired for pre-build dispatch. Routers run in registration order before a queued PRD build; explicit `profile:` frontmatter takes precedence and skips routers; failures/timeouts are fail-open.

### `protected-paths.ts`

Uses `eforge.beforePlanMerge` and `eforge.beforeFinalMerge` to block merges that touch a protected path. Demonstrates runtime-supported policy gate registration and the `PolicyDecision` discriminated union (`allow` / `block` / `require-approval`).

> **Runtime note:** `beforePlanMerge` and `beforeFinalMerge` are runtime-supported blocking policy gates. `require-approval` currently blocks because no approval workflow exists; `beforeEnqueue`, `beforeValidation`, approval UI/state, and `modify` decisions remain deferred.

### `issue-tracker.ts`

Registers three `registerInputSource` adapters — `github`, `linear`, and `jira` — so eforge can fetch PRD/build-source artifacts directly from issue-tracker systems via `eforge://input/<adapter>/<id>` URIs.

**Required env vars:**

| Adapter | Env var(s) |
|---------|-----------|
| `github` | `GITHUB_TOKEN` (classic or fine-grained PAT with repo read scope) |
| `linear` | `LINEAR_API_KEY` |
| `jira` | `JIRA_BASE_URL` (e.g. `https://yourorg.atlassian.net`) and `JIRA_TOKEN` (`<email>:<api-token>`) |

**Optional env vars:**

| Adapter | Env var | Purpose |
|---------|---------|---------|
| `github` | `GITHUB_API_BASE` | Override the GitHub REST base URL (defaults to `https://api.github.com`); use for GitHub Enterprise Server. |

**Safe-by-default:** when a required env var is absent, the adapter returns an `InputSourceResult` containing instructional markdown explaining how to configure the adapter. It never throws and never calls `globalThis.fetch` while unconfigured.

**URI dispatch shapes:**

```
eforge://input/github/<owner>/<repo>#<n>
eforge://input/linear/<issue-id>
eforge://input/jira/<KEY-123>
```

Adapter selection is by `name` match against the `<adapter>` segment. Each adapter receives the remaining `<id>` path.

For the full URI syntax, failure policy (`null` return is fatal to enqueue), and provenance event names (`extension:input-source:fetched`, `extension:input-source:failed`), see [`docs/extensions.md`](../../docs/extensions.md) — "Input sources and PRD enrichers" section.

### `validation-provider.ts`

Registers two validation providers using `registerValidationProvider`. Demonstrates both the function form (`type-check-gate`, using `ctx.exec.run` to invoke `pnpm type-check` programmatically) and the command form (`lint-gate`, using the `commands` array for simpler exit-code-is-failure subprocess dispatch). The function-form provider returns structured `ValidationProviderResult` objects and includes annotation guidance fields (`fix`, `retryGuidance`, `failureKind`, `repairClass`, and `metadata`) so recovery does not have to parse prose. The command-form provider demonstrates the simpler generic failure path: non-zero exit code output becomes the message, but command form cannot attach structured annotations or shell features such as quoted args, redirects, pipes, or env-var expansion.

> **Runtime note:** `registerValidationProvider` is runtime-supported. Providers execute during the per-plan `validate` build stage, after the implement stage and before the review stage, when `validate` is included in the build pipeline. Normal failures (structured `{ status: 'failed' }` results and command-form non-zero exits) are recoverable using `review.maxRounds`; after each recovery attempt, the provider suite reruns from the first provider. Narrow or unspecified structured failures use the review-fixer path first, `repairClass: 'structural'` routes to the validation-fixer path, and every automated repair is evaluator-gated with a checkpoint under `.eforge/validation-recovery/`. Non-empty string returns, thrown errors/rejections, timeouts, and unexpected return shapes are hard failures that bypass recovery. Unresolved recoverable failures still emit `plan:build:failed`. See [`docs/extensions.md`](../../docs/extensions.md) — "Validation providers" and [`docs/extensions-api.md`](../../docs/extensions-api.md) — `registerValidationProvider`.

### `action-contribution.ts`

For richer iframe UI, see the `registerConsoleWorkstation` Console workstation docs in [`docs/extensions.md`](../../docs/extensions.md), the API reference in [`docs/extensions-api.md`](../../docs/extensions-api.md), and the SDK README snippets. Those docs cover both small `srcDoc` workstations and `frameBundle` workstations backed by already-built files under `workstation-assets/`.

Registers one JSON-safe `echo-status` action with TypeBox object-root input and output schemas, then binds it to a declarative Console contribution, a host integration command, and an action-backed deep link. The Console contribution uses closed renderer IDs (`markdown`, `status-badge`, `action-button`, and `action-form`) and renders under `/console/system`; it does not ship browser JavaScript or a React bundle.

The example intentionally avoids raw HTTP routes, daemon route literals, network calls, filesystem writes, secrets, and browser code. Local action IDs such as `echo-status` are resolved to effective namespaced manifest IDs by eforge. Host integrations can discover the command/deep link through the shared contribution surfaces, while URL-only deep links (not used in this sample) are listable navigation metadata rather than generic action invocations.

Bundle workstation examples intentionally live in the docs and SDK README snippets rather than as a runnable `examples/extensions/*.ts` entry, because eforge serves declared assets but does not build browser source for this examples directory.

### `reviewer-perspective.ts`

Registers an accessibility reviewer perspective using `registerReviewerPerspective`. During parallel review-cycle perspective dispatch, when the review diff includes UI source files (`.tsx`, `.jsx`, or `.ts` files under `src/`), the perspective injects an accessibility-focused prompt fragment into the reviewer agent's context — covering ARIA attributes, keyboard navigation, semantic HTML, color contrast, focus management, and form labeling.

Demonstrates:

- `registerReviewerPerspective` registration with required fields: `key`, `label`, `description`, and `promptFragment`.
- Declarative `appliesTo.fileGlobs` applicability — the perspective activates automatically when the diff includes at least one matching file; no runtime function call is needed.
- An optional commented-out `appliesTo.fn` escape hatch for richer context-aware rules on top of the declarative globs.
- Read-only applicability context — perspectives cannot mutate orchestration state.

> **Runtime note:** `registerReviewerPerspective` is runtime-supported. Perspectives execute during parallel review-cycle perspective dispatch alongside built-in eforge perspectives (`review.strategy: parallel`, or `auto` once the diff crosses the parallel-review thresholds). Registration is also captured at load time for provenance and management tooling (`eforge extension show`, list, validate, test). `appliesTo.fn` timeouts and throws are fail-open: the perspective is skipped and a diagnostic is emitted rather than blocking the review. See [`docs/extensions.md`](../../docs/extensions.md) — "Reviewer perspectives" and [`docs/extensions-api.md`](../../docs/extensions-api.md) — `registerReviewerPerspective`.

## Package authoring and install

These examples are designed for direct use in a project's extension directories. They can also serve as the basis for a published npm package, local package directory, or tarball that other projects install with `eforge extension install`.

To publish an example as a reusable package, add the `eforge.extension` manifest to `package.json`:

```json
{
  "name": "acme-build-notifier",
  "version": "1.0.0",
  "eforge": {
    "extension": {
      "name": "build-notifier",
      "entrypoint": "./dist/index.js",
      "capabilities": [{ "name": "acme.notifications", "version": "1.0.0" }],
      "dependencies": {
        "optional": [{ "name": "acme-backlog", "version": ">=1.0.0" }]
      }
    }
  }
}
```

Then install it in another project:

```sh
# Install to project-local scope (trusted, gitignored)
eforge extension install acme-build-notifier

# Install from a local package directory or tarball while developing
eforge extension install ./packages/acme-build-notifier
eforge extension install ./dist/acme-build-notifier-1.0.0.tgz

# Install to project/team scope; inspect the code, then trust
eforge extension install acme-build-notifier --scope project
eforge extension trust build-notifier
eforge extension reload
```

> **Supply-chain note:** npm packages, tarballs, and local package directories are unsandboxed arbitrary code. Inspect the installed extension source before trusting it, especially for project/team scope extensions that other team members will load.

See [`docs/extensions.md`](../../docs/extensions.md) — "Package-managed extensions" — for the full install/update/remove/promote/demote workflow, manifest dependency/capability fields, trust behavior, and sidecar hash-exclusion details.

## Validation

From the repo root, targeted validation for these examples is:

```sh
pnpm test -- test/extension-sdk-example.test.ts
pnpm test -- test/extension-tooling-wiring-cli.test.ts test/extension-tooling-wiring-consumer-parity.test.ts test/extension-tooling-wiring-runtime-docs.test.ts
pnpm docs:check
```

To replay event-oriented examples manually, create a fixture containing a canonical eforge event and run:

```sh
eforge extension test ./examples/extensions/minimal-event-logger.ts --fixture events.json
eforge extension test ./examples/extensions/slack-webhook-notifier.ts --fixture events.json
```

There is no separate build step for the examples directory. The vitest test at `test/extension-sdk-example.test.ts` imports every `examples/extensions/*.ts` default export, which forces TypeScript to type-check them as part of the test run.
