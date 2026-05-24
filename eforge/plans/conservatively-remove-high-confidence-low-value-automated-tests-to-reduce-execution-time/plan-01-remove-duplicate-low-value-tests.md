---
id: plan-01-remove-duplicate-low-value-tests
name: Remove Duplicate Low-Value Tests
branch: conservatively-remove-high-confidence-low-value-automated-tests-to-reduce-execution-time/plan-01-remove-duplicate-low-value-tests
---

# Remove Duplicate Low-Value Tests

## Architecture Context

The repository uses Vitest across the monorepo. The source request is bounded to conservative test removals only: remove tests with strong evidence of duplicate or low-value coverage, preserve meaningful behavioral coverage, and run the existing test command after changes.

Exploration found one full duplicate HTTP/SSE test file and two single-test duplicates. The plan intentionally avoids broader test-suite restructuring and leaves uncertain candidates in place.

## Implementation

### Overview

Delete the duplicated `subscribeWithSnapshot` package-local test file and remove two isolated redundant test cases from monitor-ui tests. Keep the top-level `test/session-stream.test.ts` coverage for `subscribeWithSnapshot`, including its unique `parseSseChunk`, reconnect-cap, and 404/no-reconnect cases.

### Key Decisions

1. Prefer deleting the package-local `subscribeWithSnapshot` test file over editing the top-level session-stream tests because `test/session-stream.test.ts` covers the same generator behaviors through the public `@eforge-build/client` export and also contains unique coverage not present in the package-local file.
2. Remove only exact or near-exact duplicate assertions in monitor-ui tests; do not collapse larger reducer or schema suites where tests may encode edge-case contracts.
3. Do not move tests between files or rewrite the test architecture; this work is deletion-only except for cleanup of now-unused imports if a file edit creates them.

## Scope

### In Scope

- Delete high-confidence duplicate Vitest tests.
- Clean up unused imports or helpers caused by the removals.
- Run the existing project test command after changes.
- Summarize each removed test and its rationale in the implementation notes or final build summary.

### Out of Scope

- Removing slow tests that provide unique coverage.
- Refactoring test helpers, test architecture, or Vitest configuration.
- Replacing removed tests with new tests.
- Removing regression tests for known bugs.
- Removing brittle static guard tests whose value is uncertain.

## Files

### Delete

- `packages/client/src/__tests__/subscribe-with-snapshot.test.ts` — remove the duplicated `subscribeWithSnapshot` fake-SSE-server test suite. Its tests duplicate coverage retained in `test/session-stream.test.ts`:
  - `yields kind:snapshot before kind:event frames` duplicates `test/session-stream.test.ts` coverage for snapshot-before-event frame ordering.
  - `yields a fresh snapshot after server-initiated reconnect` duplicates retained reconnect snapshot coverage.
  - `uses the stream:hello cursor as Last-Event-ID on reconnect (no JSON events between hellos)` duplicates retained Last-Event-ID cursor-capture coverage.
  - `iterator throws AbortError when signal fires` duplicates retained mid-stream abort coverage.
  - `throws immediately when signal is already aborted` duplicates retained already-aborted signal coverage.
  - `yields monitor:shutdown-pending as kind:named` duplicates retained named-event routing coverage.
  - `yields monitor:shutdown-cancelled as kind:named` exercises the same name-agnostic branch as the retained named-event routing test and adds only another string literal.
  - `does not yield stream:hello as kind:named` duplicates retained stream:hello interception coverage.
  - `yields JSON events as kind:event with eventId` duplicates retained JSON event frame and eventId coverage.

### Modify

- `packages/monitor-ui/test/format-thinking.test.ts` — remove `formats thinkingOriginal with snake_case budget_tokens as "enabled (32.0k tokens)"`; it uses the same input shape and expected output as the retained `formats budget_tokens (snake_case wire format) identically to budgetTokens` test.
- `packages/monitor-ui/src/lib/__tests__/swr-fetcher.test.ts` — remove `throws Error containing status code on 403`; the retained `throws Error containing status code on 500` test covers the same non-404, non-2xx branch and status interpolation, while the retained 404 tests preserve the special null-return branch.

## Future Review Candidates Left In Place

- `packages/monitor-ui/src/components/pipeline/__tests__/agent-stage-map.test.ts` contains a client `eventRegistry` metadata block in a component test. It is misplaced, but it uniquely checks summary text for `plan:build:review:parallel:perspective:error`, so leave it in place unless equivalent client-package coverage is added later.
- `packages/monitor-ui/src/__tests__/two-sse-subscribers.test.ts` is a brittle static source scan, but it enforces an explicit two-SSE-subscriber invariant and the retired-subscriber guard, so leave it in place.
- Large event schema and reducer suites include many granular one-assertion tests, but they cover wire contracts and state projection edge cases; do not remove them in this conservative pass.

## Verification

- [ ] `packages/client/src/__tests__/subscribe-with-snapshot.test.ts` no longer exists.
- [ ] `test/session-stream.test.ts` still contains coverage for `parseSseChunk`, snapshot/event ordering, reconnect snapshots, Last-Event-ID cursor capture, abort behavior, named events, stream:hello interception, eventId propagation, reconnect-cap failure, and 404 no-reconnect behavior.
- [ ] `packages/monitor-ui/test/format-thinking.test.ts` still contains a retained snake_case `budget_tokens` assertion for `{ type: 'enabled', budget_tokens: 32000 }` producing `enabled (32.0k tokens)`.
- [ ] `packages/monitor-ui/src/lib/__tests__/swr-fetcher.test.ts` still contains retained tests for 404 returning null, non-404 HTTP errors throwing with the status code, 200 JSON parsing, tuple URL construction, and tuple 404 returning null.
- [ ] `pnpm test` completes with exit code 0 after the removals.
