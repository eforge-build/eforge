---
id: plan-02-enqueue-preprocessing-runtime
name: Enqueue Preprocessing Runtime
branch: extend-11-runtime-input-transformers-and-prd-enrichers/plan-02-enqueue-preprocessing-runtime
agents:
  builder:
    effort: high
    rationale: This plan wires async extension execution into CLI/daemon boundaries
      while preserving engine input-agnostic constraints and session-plan
      behavior.
  reviewer:
    effort: high
    rationale: Runtime execution, daemon worker arguments, and fail-open/fail-closed
      behavior need code, API, security, and test review.
---

# Enqueue Preprocessing Runtime

## Architecture Context

The input layer owns build-source normalization protocols. The engine consumes normalized build source and must not import `@eforge-build/input`. This plan implements the async preprocessing seam in `@eforge-build/input` and calls it from the CLI enqueue worker path before `EforgeEngine.enqueue(...)`.

## Implementation

### Overview

Create an async extension-aware helper that resolves explicit `eforge://input/<adapter>/<id...>` references, preserves existing session-plan normalization, applies PRD enrichers sequentially, and returns normalized content plus provenance/diagnostics. Wire direct CLI enqueue and daemon-spawned enqueue workers through the same helper. Keep daemon `/api/enqueue` from executing extension adapters/enrichers in the route process so worker session streams contain the provenance events.

### Key Decisions

1. Support only the explicit `eforge://input/<adapter>/<id...>` syntax in this slice; do not add `adapter:id` shorthand.
2. Run built-in session-plan normalization before PRD enrichers so enrichers see ordinary build source.
3. Treat explicit input-source failures, unknown adapters, not-found results, invalid results, and adapter timeouts as fatal enqueue failures.
4. Treat PRD enricher throws, invalid results, and timeouts as fail-open diagnostics; later enrichers continue with the latest valid content.
5. Keep helper types structural and avoid an `@eforge-build/input` dependency on `@eforge-build/engine`.

## Scope

### In Scope

- Async `preprocessBuildSource` (or equivalent exported name) in `@eforge-build/input`.
- Explicit `eforge://input/<adapter>/<id...>` parsing with URL-decoded adapter and source id.
- File/inline source resolution at the boundary and session-plan normalization using the existing synchronous `normalizeBuildSource()`.
- Sequential enricher execution in registration order with changed/no-op provenance.
- Timeout handling using the configured extension timeout passed by the caller.
- CLI enqueue wrapping that yields preprocessing events before yielding `engine.enqueue(normalizedContent, ...)` events.
- CLI display summaries for the new provenance/diagnostic events.
- Daemon `/api/enqueue` route change: retain profile validation and cheap session-plan parse prevalidation for 400 responses, but spawn the worker with the original source string.
- Tests for helper behavior, CLI event ordering, daemon worker arguments, and the no-engine-import boundary.

### Out of Scope

- New engine imports from `@eforge-build/input`.
- External issue tracker HTTP clients.
- New config keys for input transform timeout.
- Enricher policy gates or fail-closed enrichers.
- `adapter:id` shorthand.

## Files

### Create

- `packages/input/src/extension-normalize.ts` — async preprocessing helper, structural registration/result types, source-reference parser, timeout runner, provenance records, and fatal error type for selected input-source failures.
- `test/input-extension-normalization.test.ts` — unit tests for explicit reference parsing, adapter fetches, file/inline fallback, session-plan ordering, enricher ordering, no-op returns, fail-open enrichment failures, fatal source failures, invalid result handling, and timeouts.

### Modify

- `packages/input/src/index.ts` — export the new helper, structural registration types, provenance types, diagnostic types, and fatal error type.
- `packages/eforge/package.json` — add `@eforge-build/input` as a workspace dependency for the CLI boundary package.
- `packages/eforge/src/cli/index.ts` — wrap the enqueue action in an async generator that calls the preprocessing helper with `engine.nativeExtensionRegistry.inputSources`, `engine.nativeExtensionRegistry.prdEnrichers`, `process.cwd()`, and `engine.resolvedConfig.extensions.eventHookTimeoutMs`; yield returned provenance events with timestamps before yielding `engine.enqueue(normalizedContent, ...)`; on fatal preprocessing failure, yield its diagnostic event and an `enqueue:failed` event without calling the engine.
- `packages/eforge/src/cli/display.ts` — render concise messages for fetched input sources, failed input sources, applied enrichers, and failed enrichers.
- `packages/monitor/src/server.ts` — stop replacing request `source` with normalized session-plan content inside `/api/enqueue`; retain profile validation; for session-plan file sources that exist, call synchronous `normalizeBuildSource` only as prevalidation and discard the normalized content; spawn worker args with the original source plus flags/profile.
- `test/extension-cli-commands.test.ts` or a new CLI enqueue test — assert direct `eforge enqueue eforge://input/static/ISSUE-1` emits input-source provenance before `enqueue:start` and calls the engine with fetched content.
- `test/daemon-session-plan-routes.test.ts` — update comments/assertions so session-plan enqueue still marks submitted but worker args keep the original `.eforge/session-plans/*.md` path.
- `packages/monitor/src/__tests__/auto-build-route.test.ts` — add an assertion that `/api/enqueue` passes the original source string to `spawnWorker` and does not route-side transform extension references.
- `test/extension-tooling-wiring.test.ts` or a focused boundary test — add a grep-backed assertion that `packages/engine/src` and `packages/engine/package.json` do not reference `@eforge-build/input`.

## Helper Contract Details

- Input-source registrations accepted by the helper must be structural: `{ extensionName, extensionPath, name, value: { name, description, canHandle?, fetch } }`.
- PRD enricher registrations accepted by the helper must be structural: `{ extensionName, extensionPath, name, value: { name, description, appliesTo?, enrich } }`.
- `eforge://input/github/owner%2Frepo%23123` resolves adapter `github` and source id `owner/repo#123`.
- Unknown adapter and missing id throw a fatal preprocessing error with an `extension:input-source:failed` diagnostic.
- String adapter/enricher results replace content. Object results may include `content` and optional metadata; `null`/`undefined` from enrichers means no content change.
- The helper returns `{ content, sourcePath?, provenance, events }` where `events` are timestamp-free payloads compatible with the client event variants from Plan 1.

## Verification

- [ ] `preprocessBuildSource` resolves `eforge://input/static/ISSUE-1` through the `static` adapter and returns fetched content.
- [ ] `preprocessBuildSource` rejects `eforge://input/missing/ISSUE-1` with a fatal error whose diagnostic type is `extension:input-source:failed` and reason is `not-found` or `error` as applicable.
- [ ] Given two enrichers, the second receives the content returned by the first.
- [ ] An enricher that throws emits `extension:prd-enricher:failed` and the helper returns the last valid content.
- [ ] A session-plan file source is converted by `normalizeBuildSource()` before enrichers run.
- [ ] Direct CLI enqueue emits input-source/enricher events before `enqueue:start`.
- [ ] Daemon `/api/enqueue` spawns the worker with the original source string for `.eforge/session-plans/*.md` and `eforge://input/...` inputs.
- [ ] `packages/engine/package.json` and `packages/engine/src/**` contain zero `@eforge-build/input` references.
