---
id: plan-01-docs-example-and-skills
name: Issue-Tracker Example, Docs, and Skill Updates
branch: extend-11-successor-docs-issue-tracker-example-and-skill-updates/plan-01-docs-example-and-skills
---

# Issue-Tracker Example, Docs, and Skill Updates

## Architecture Context

The EXTEND_11 feature branch already shipped the runtime wiring for `registerInputSource` and `registerPrdEnricher`:

- SDK contracts in `packages/extension-sdk/src/hooks.ts` (`InputSourceAdapter`, `InputSourceResult`, `PrdEnricher`, `PrdEnrichmentInput`, `PrdEnrichmentResult`) and `packages/extension-sdk/src/context.ts` (`InputTransformContext`).
- Async preprocessing in `packages/input/src/extension-normalize.ts` with `eforge://input/<adapter>/<id>` URI parsing and adapter lookup by `name`.
- CLI/daemon enqueue paths preprocess sources before `EforgeEngine.enqueue()`.
- Provenance events `extension:input-source:fetched|failed` and `extension:prd-enricher:applied|failed` defined in `packages/client/src/events.schemas.ts`.
- Failure policy: input-source failures are fatal to enqueue (`FatalPreprocessingError`); enricher failures are fail-open with `extension:prd-enricher:failed` diagnostics and the unchanged content carries forward.

The remaining work is documentation, a worked example, and skill prose updates. No implementation changes.

## Implementation

### Overview

Ship one new TypeScript example (`examples/extensions/issue-tracker.ts`) plus updates to two doc files, the extension-sdk README, the examples README, and both extension-authoring skill files. Add a static import + factory-conformance check to `test/extension-sdk-example.test.ts`. All changes must keep `pnpm type-check`, `pnpm test -- test/extension-sdk-example.test.ts`, and `pnpm docs:check` green.

### Key Decisions

1. **Adapter matching is by `name`, not `canHandle`.** The shipped `InputSourceAdapter` interface in `packages/extension-sdk/src/hooks.ts` exposes only `name`, `description`, and `fetch(id, ctx?)`. The runtime in `packages/input/src/extension-normalize.ts` looks up adapters by exact name match against the URI's `<adapter>` segment. The PRD's mention of a `canHandle` function is reconciled by giving each adapter a distinct `name` (`github`, `linear`, `jira`) that owns its `eforge://input/<name>/<id>` URI prefix. The example must document this explicitly in comments and the README entry. Do NOT add a `canHandle` field to the SDK type contract — that is out of scope (Extension SDK type contracts are explicitly listed as out-of-scope in the PRD).
2. **`PrdEnricher` contract is `name`, `description`, `enrich`.** The shipped `PrdEnricher` interface in `packages/extension-sdk/src/hooks.ts` has no `appliesTo` predicate. The docs must reflect the actual API: enrichers always run for every preprocessed source in registration order, and authors gate their own behavior inside `enrich` (e.g. by inspecting `ctx.sourceKind`, `ctx.adapterId`, or `ctx.sourcePath` from `InputTransformContext`). Do NOT document an `appliesTo` field — it does not exist.
3. **Safe-by-default example.** The issue-tracker example must be importable without any env vars set. When a required env var is missing, each adapter returns a structured `InputSourceResult` whose `content` is helpful markdown explaining how to configure the adapter (token env var name, base URL env var, expected URI form). It must never throw and must never make a network call when its required env vars are unset.
4. **Single plan.** All eight files are part of one cohesive deliverable (example + tests + prose). No phasing or migration is needed. `[implement, review-cycle]` with `code` and `docs` review perspectives is sufficient.
5. **Provenance event names.** Use the exact wire names defined in `packages/client/src/events.schemas.ts`: `extension:input-source:fetched`, `extension:input-source:failed`, `extension:prd-enricher:applied`, `extension:prd-enricher:failed`. Do not invent new names.

## Scope

### In Scope

- New file `examples/extensions/issue-tracker.ts` covering GitHub, Linear, and Jira adapter patterns via three `registerInputSource` calls in a single default-export factory.
- Update `examples/extensions/README.md` to list the new example, its required env vars, and the safe-by-default behavior.
- Update `test/extension-sdk-example.test.ts` to import the new example, add it to `importedExampleFiles`, and add a `sdk.EforgeExtensionFactory` conformance check.
- Update `docs/extensions.md`:
  - Flip `registerInputSource` from `Deferred` to `Yes (extension-aware enqueue preprocessing)` in the runtime-support table.
  - Add a `registerPrdEnricher` row to that table marked runtime-supported.
  - Add a new section explaining `registerInputSource` runtime behavior, `registerPrdEnricher` API, `eforge://input/<adapter>/<id>` URI syntax, failure policy, and the four provenance event names.
  - Update the closing prose paragraph ("Custom input fetching ... are future runtime phases") to remove input sources and PRD enrichers from the deferred list.
- Update `docs/extensions-api.md`:
  - Replace the `registerInputSource` "Runtime status: ... deferred" line with runtime-supported wording referencing the URI form and adapter-by-name lookup. Refresh `InputSourceAdapter` to show the runtime signature (`fetch: (id: string, ctx?: InputTransformContext) => Promise<string | InputSourceResult | null>`) and document `InputSourceResult` and `InputTransformContext`.
  - Add a new `### registerPrdEnricher(spec)` section before or after `registerInputSource` documenting `PrdEnricher`, `PrdEnrichmentInput` (`content`, `sourceId`, `ctx`), and `PrdEnrichmentResult` (`content`). Document fail-open failure policy.
  - Update the closing "Runtime support status" table row for `registerInputSource` from `Deferred` to `Yes`. Add a `registerPrdEnricher` row.
  - Update the trailing paragraph that lists deferred capability families to remove input sources and add no new claims.
- Update `packages/extension-sdk/README.md`:
  - Flip the `registerInputSource` row in the registration-methods table from `Deferred` to `Yes` and add a `registerPrdEnricher` row.
  - Update the runtime-loading paragraph that currently says "Input sources, reviewer perspectives, validation providers ... remain deferred" to remove input sources and to add a PRD enricher mention.
  - Add a short "Input sources and PRD enrichers" subsection with: a `registerInputSource` snippet showing the `eforge://input/<adapter>/<id>` URI form and the `(id, ctx)` signature; a `registerPrdEnricher` snippet using `InputTransformContext` fields; and the failure policy summary (input-source failures fatal, enricher failures fail-open).
  - Document `InputTransformContext` fields (`cwd`, `originalSource`, `sourceKind`, `sourcePath`, `adapterId`).
- Update `eforge-plugin/skills/extend/extend.md`:
  - In the "Runtime-supported capability families" list, add `registerInputSource` and `registerPrdEnricher` bullets with a one-line `eforge://input/` URI note.
  - In the "Runtime-deferred capability families" list, remove `registerInputSource`.
- Update `packages/pi-eforge/skills/eforge-extend/SKILL.md` with the identical edits to keep Claude Code plugin and Pi extension skills in sync.

### Out of Scope

- Any change to `packages/extension-sdk/src/hooks.ts`, `context.ts`, `index.ts`, or related engine wiring.
- Adding `canHandle` to `InputSourceAdapter` or `appliesTo` to `PrdEnricher` (PRD lists SDK type contracts as out of scope).
- Updating reviewer-perspective or validation-provider rows (those remain deferred and are tracked by EXTEND_12A).
- Generated reference docs under `docs/reference/`, `docs/events/`, etc. (the docs-gen pipeline regenerates these from source; the planner verifies via `pnpm docs:check`).
- New runtime tests beyond the static compile/factory check in `test/extension-sdk-example.test.ts`.

## Files

### Create

- `examples/extensions/issue-tracker.ts` — single default-export factory that calls `eforge.registerInputSource(...)` three times for adapters named `github`, `linear`, and `jira`. Each adapter:
  - Uses env vars: `GITHUB_TOKEN`; `LINEAR_API_KEY`; `JIRA_BASE_URL` + `JIRA_TOKEN`.
  - Implements `fetch(id, ctx?)` matching the SDK signature.
  - When the required env var(s) are missing, returns `{ content, title }` where `content` is helpful markdown explaining configuration (env var names, expected URI form, example endpoints, where to customize). Never throws on missing config.
  - When env vars are present, performs a placeholder fetch path with a clearly commented stub — the example must be self-documenting and explain in comments how to customize the endpoint (REST URL pattern for GitHub `/repos/{owner}/{repo}/issues/{number}`, Linear GraphQL `issues(id:)`, Jira `/rest/api/3/issue/{key}`). The example may use `globalThis.fetch` directly; it must not call out to the real network when env vars are unset.
  - Uses `ctx?.logger` defensively (the second arg is optional).
  - Returns `null` only for genuine not-found responses from the upstream API (documented as fatal-to-enqueue per failure policy).
  - Header comment explains URI dispatch (`eforge://input/github/<owner>/<repo>#<n>`, `eforge://input/linear/<issue-id>`, `eforge://input/jira/<KEY-123>`), notes that adapter selection is by `name` match, and references the docs.

### Modify

- `examples/extensions/README.md` — add an `issue-tracker.ts` row to the examples table (Primary API: `registerInputSource(...)` x3, Runtime status: "Runtime-supported input source dispatch via `eforge://input/<adapter>/<id>`"). Add a full subsection `### issue-tracker.ts` covering: required env vars (`GITHUB_TOKEN`, `LINEAR_API_KEY`, `JIRA_BASE_URL`+`JIRA_TOKEN`), safe-by-default behavior, URI dispatch shapes, and a pointer to `docs/extensions.md` for the failure policy.
- `test/extension-sdk-example.test.ts` — wrap the new content in a `// --- eforge:region plan-01-docs-example-and-skills ---` / `// --- eforge:endregion plan-01-docs-example-and-skills ---` block:
  - Add `import issueTracker from '../examples/extensions/issue-tracker.js';` to the import list.
  - Add `'issue-tracker.ts'` to the `importedExampleFiles` array (preserve sort order).
  - Add a `const _factoryCheckIssueTracker: sdk.EforgeExtensionFactory = issueTracker; void _factoryCheckIssueTracker;` line alongside the other factory checks.
  - No new runtime test cases — the import + factory assertion alone is the static compile check the PRD requires.
- `docs/extensions.md` — apply the runtime-support edits, add the new "Input sources and PRD enrichers" subsection (~30 lines), and refresh the trailing paragraph at line ~233 that enumerates deferred capability families to drop input sources and PRD enrichers.
- `docs/extensions-api.md` — replace the deferred note on `registerInputSource` (line ~393), refresh the `InputSourceAdapter` interface snippet to the runtime signature, add `InputSourceResult` and `InputTransformContext` blocks, add the new `### registerPrdEnricher(spec)` section with full type signatures (`PrdEnricher`, `PrdEnrichmentInput`, `PrdEnrichmentResult`), update the runtime-support table at line ~663 (flip `registerInputSource`, add `registerPrdEnricher`), and refresh the surrounding prose at line ~661 / ~678 to remove input sources from the deferred list.
- `packages/extension-sdk/README.md` — update the registration-methods table (line ~70), the runtime-loading paragraph (line ~66), add an "Input sources and PRD enrichers" subsection with code samples that match the actual SDK signatures, document `InputTransformContext` fields, and refresh the closing stability paragraph (line ~168) to remove input sources / enrichers from the deferred list.
- `eforge-plugin/skills/extend/extend.md` — move `registerInputSource` from the deferred list (line ~51) into the supported list (line ~44 area); add a `registerPrdEnricher` bullet to the supported list with an `eforge://input/` URI note and the fail-open enricher semantics.
- `packages/pi-eforge/skills/eforge-extend/SKILL.md` — apply the same edits as `extend.md` (the two files mirror each other; preserve any Pi-specific UX wording).

## Verification

- [ ] `examples/extensions/issue-tracker.ts` exists and exports a default `EforgeExtensionFactory` that calls `eforge.registerInputSource` exactly three times with `name` values `github`, `linear`, and `jira`.
- [ ] `examples/extensions/issue-tracker.ts` imports zero secrets and contains zero literal tokens; all credentials are read from `process.env`.
- [ ] Importing `examples/extensions/issue-tracker.ts` with no env vars set does not throw at module-evaluation time and the factory does not call `globalThis.fetch` until an adapter is invoked with a configured env var.
- [ ] `test/extension-sdk-example.test.ts` imports `../examples/extensions/issue-tracker.js`, includes `'issue-tracker.ts'` in `importedExampleFiles`, and contains a `sdk.EforgeExtensionFactory` typed assignment for the imported factory.
- [ ] `examples/extensions/README.md` lists `issue-tracker.ts` in the examples table and has an `### issue-tracker.ts` subsection naming `GITHUB_TOKEN`, `LINEAR_API_KEY`, `JIRA_BASE_URL`, and `JIRA_TOKEN`.
- [ ] `docs/extensions.md` runtime-support table row for `registerInputSource` no longer contains the string `Deferred`, contains a runtime-supported marker, and a new row for `registerPrdEnricher` is present and also marked runtime-supported.
- [ ] `docs/extensions.md` documents the `eforge://input/<adapter>/<id>` URI form, the failure policy (input-source failures fatal to enqueue; enricher failures fail-open), and names all four provenance event types: `extension:input-source:fetched`, `extension:input-source:failed`, `extension:prd-enricher:applied`, `extension:prd-enricher:failed`.
- [ ] `docs/extensions-api.md` `### registerInputSource(adapter)` section no longer contains the literal string `Runtime status: registration is captured at load time; input-source execution is deferred.` and now describes runtime-supported behavior.
- [ ] `docs/extensions-api.md` contains a `### registerPrdEnricher(spec)` section with type signatures for `PrdEnricher`, `PrdEnrichmentInput`, and `PrdEnrichmentResult`.
- [ ] `docs/extensions-api.md` runtime-support table row for `registerInputSource` shows `Yes` (or equivalent runtime-supported marker) in the "Runtime execution today" column; a `registerPrdEnricher` row is present with the same marker.
- [ ] `packages/extension-sdk/README.md` registration-methods table shows runtime-supported markers for both `registerInputSource` and `registerPrdEnricher`, contains an enricher registration code sample, and documents `InputTransformContext` fields `cwd`, `originalSource`, `sourceKind`, `sourcePath`, `adapterId`.
- [ ] `eforge-plugin/skills/extend/extend.md` lists `registerInputSource` under runtime-supported capabilities and lists `registerPrdEnricher` under runtime-supported capabilities; `registerInputSource` no longer appears under runtime-deferred capabilities.
- [ ] `packages/pi-eforge/skills/eforge-extend/SKILL.md` shows the identical capability-classification updates as `eforge-plugin/skills/extend/extend.md`.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test -- test/extension-sdk-example.test.ts` exits 0 and the `imports every TypeScript example file` test still passes after adding `issue-tracker.ts`.
- [ ] `pnpm test -- test/normalize-build-source.test.ts test/extension-loader.test.ts test/extension-tooling-routes.test.ts test/extension-cli-commands.test.ts test/extension-sdk-example.test.ts packages/client/src/__tests__/events-schemas.test.ts packages/client/src/__tests__/events-wire-parity.test.ts` exits 0.
- [ ] `pnpm docs:check` exits 0.
