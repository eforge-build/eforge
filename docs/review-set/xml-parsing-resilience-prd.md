# XML Parsing Resilience

Addresses the fragility of the regex-based XML parsers that extract structured signals from agent output. The parsers work today but break silently on attribute variations and provide no diagnostic visibility when expected blocks aren't found.

## Problem

All agent-to-engine structured communication goes through hand-rolled regex parsers in `common.ts`, `reviewer.ts`, and `builder.ts`. Current fragilities:

1. **Attribute parsing is brittle**: `attrs.match(/id="([^"]+)"/)` requires double quotes, no extra whitespace, and a specific attribute order. An LLM that outputs `id = 'q1'` or `id="q1" ` (trailing space) silently fails.

2. **Silent null returns**: Every parser returns `null` or `[]` on failure with no indication of whether the block was absent (expected in some flows) or malformed (a real problem). Callers can't distinguish "agent didn't produce this block" from "agent produced it but we couldn't parse it."

3. **No parse diagnostics**: When a scope block, profile block, or review issues block fails to parse, the pipeline continues with defaults or empty results. The user sees no indication that structured output was lost.

## Design

### Robust Attribute Extraction

Replace individual `attrs.match(/name="([^"]+)"/)` calls with a shared `parseAttributes` helper that handles common variations:

```typescript
function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const regex = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = regex.exec(attrString)) !== null) {
    attrs[match[1]] = match[2] ?? match[3];
  }
  return attrs;
}
```

This handles: double quotes, single quotes, whitespace around `=`, and arbitrary attribute order. All existing parsers switch to using this instead of individual regex matches.

### Parse Result Type

Instead of returning `null` or raw values, parsers return a result type that distinguishes "not found" from "found but malformed":

```typescript
type ParseResult<T> =
  | { status: 'found'; value: T }
  | { status: 'not-found' }
  | { status: 'malformed'; raw: string; reason: string };
```

Callers that currently check `result === null` switch to checking `result.status`. The `malformed` case carries the raw text and a reason string for diagnostics.

This is an internal refactor - the parse result type stays within the agent runners. The events emitted to consumers don't change.

### Diagnostic Warnings

When a parser returns `malformed`, the agent runner yields a new lightweight event:

```typescript
{ type: 'agent:parse_warning'; agent: AgentRole; block: string; reason: string; raw: string }
```

This event is always yielded (not gated on verbose) so it shows up in the monitor and CLI output. It's informational - it doesn't fail the pipeline. The agent runner continues with fallback behavior (same as today's null handling), but now the user knows something was lost.

## Implementation

### Files to modify

- **`src/engine/agents/common.ts`**: Add `parseAttributes()` helper and `ParseResult<T>` type. Refactor `parseClarificationBlocks`, `parseScopeBlock`, `parseProfileBlock`, `parseModulesBlock` to use `parseAttributes` and return `ParseResult`.

- **`src/engine/agents/reviewer.ts`**: Refactor `parseReviewIssues` to use `parseAttributes`. Return `ParseResult<ReviewIssue[]>`.

- **`src/engine/agents/builder.ts`**: Refactor `parseEvaluationBlock` to use `parseAttributes`. Return `ParseResult`.

- **`src/engine/events.ts`**: Add `agent:parse_warning` event type to the discriminated union.

- **`src/engine/agents/planner.ts`**, **`plan-evaluator.ts`**, **`cohesion-reviewer.ts`**, etc.: Update callers to handle `ParseResult` status and yield `agent:parse_warning` on malformed results.

- **`src/cli/display.ts`**: Render `agent:parse_warning` events (yellow warning with block name and reason).

- **`src/monitor/recorder.ts`**: No changes needed - all events are recorded.

### What stays the same

- XML format in agent prompts - no prompt changes needed
- Event types for structured data (plan:scope, plan:profile, etc.) - unchanged
- Pipeline behavior on missing blocks - same fallback logic, just with visibility now

## Verification

- `pnpm test` passes
- `pnpm type-check` passes
- Existing XML parsing tests in `agent-wiring.test.ts` continue to pass
- Add new tests for `parseAttributes`:
  - Double quotes: `id="foo"` → `{ id: 'foo' }`
  - Single quotes: `id='foo'` → `{ id: 'foo' }`
  - Whitespace: `id = "foo"` → `{ id: 'foo' }`
  - Multiple attrs: `id="foo" name="bar"` → `{ id: 'foo', name: 'bar' }`
- Add tests for `ParseResult` malformed detection:
  - `<scope>` block present but missing `assessment` attribute → `malformed`
  - `<scope>` block absent → `not-found`
  - Valid `<scope>` block → `found` with value
- Run `eforge run` on a PRD and verify no spurious warnings appear for normally-parsed blocks
