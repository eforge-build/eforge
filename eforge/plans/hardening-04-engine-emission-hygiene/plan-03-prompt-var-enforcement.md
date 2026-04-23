---
id: plan-03-prompt-var-enforcement
name: loadPrompt() throws on unresolved template variables
depends_on: []
branch: hardening-04-engine-emission-hygiene/prompt-var-enforcement
agents:
  builder:
    effort: high
    rationale: Discovering and fixing callers that silently rely on unresolved vars
      requires running the full test suite and chasing each failure to its
      caller.
---

# loadPrompt() throws on unresolved template variables

## Architecture Context

Stored user feedback: *Keep prompts closed; data-driven model nudges. No model-specific guidance in prompts; use a mapping file the engine injects at runtime.* A corollary: unresolved `{{var}}` tokens must fail loudly, not silently pass through to the model. Today, `packages/engine/src/prompts.ts:70` leaves unmatched tokens in place: `content.replace(/\{\{(\w+)\}\}/g, (match, key) => allVars[key] ?? match)`. The planner prompt alone has 22 substitution sites per `rg` (145 across all prompts), so a missed variable silently ships a broken prompt to the model.

## Implementation

### Overview

1. After substitution in `loadPrompt()`, scan the output for any remaining `{{varName}}` tokens. If any are found, throw with the list of unresolved names.
2. Run `pnpm test` to discover which current callers rely on unresolved vars being silently preserved. For each failure, update the caller to pass the required variables.
3. Add a test in `test/prompts.test.ts` that asserts `loadPrompt('planner', { /* partial vars */ })` throws with the missing variable names listed in the error message.

### Key Decisions

1. **Throw rather than warn.** The PRD is explicit: "implies this should fail loudly." A warning would let broken prompts ship. The error message must include the prompt name and the unique unresolved variable names so debugging is immediate.
2. **Run the existing test suite first to enumerate callers.** Do not pre-analyze call sites — the test suite is the ground truth for which prompts have required variables. Fix each failing caller to pass the missing variable.
3. **If a prompt intentionally contains literal `{{var}}` text** (unlikely but possible for documentation-style prompts): escape the literal token at the source, for example by replacing `{{foo}}` in the markdown with a non-matching form like `{% raw %}{{foo}}{% endraw %}` and teaching the helper to unescape, OR simply splitting the token across a zero-width marker. Prefer changing the markdown over weakening the regex.

## Scope

### In Scope
- Update `loadPrompt()` in `packages/engine/src/prompts.ts` to throw on unresolved tokens.
- Fix every caller surfaced by `pnpm test` that was relying on silent pass-through.
- Add a unit test asserting the throw behavior.

### Out of Scope
- Console.* removal (plan-01).
- forgeCommit sweep (plan-02).
- Redesigning the prompt substitution format or template engine.
- Pre-validating at build time that every `{{var}}` in a prompt markdown file has a corresponding caller argument (that is a larger static-check feature).

## Files

### Modify
- `packages/engine/src/prompts.ts` — after the `content.replace(/\{\{(\w+)\}\}/g, ...)` call at line 70, scan for remaining tokens and throw when any are found. Exact pattern:
  ```ts
  const unresolved = [...content.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)].map(m => m[1]);
  if (unresolved.length > 0) {
    throw new Error(
      `loadPrompt(${filename}): unresolved template variables: ${[...new Set(unresolved)].join(', ')}`
    );
  }
  ```
  (Use the prompt filename/basename as the identifier in the error — match existing error conventions in this file.)
- **Any caller surfaced by `pnpm test` failures** — each must pass the previously-missing variable. Common call sites live in `packages/engine/src/pipeline.ts`, `packages/engine/src/agents/*`, and `packages/engine/src/plan-*.ts`. Do not guess — run tests and fix each reported failure.

### Create (if no existing prompts test file)
- `test/prompts.test.ts` — if this file does not yet exist; if it does, add to it.

### Tests
- Add a test: calling `loadPrompt('planner', { /* intentionally partial vars */ })` throws an `Error` whose message contains `loadPrompt(planner)` and at least one specific missing variable name. Sanity-case: calling `loadPrompt` with a fully-populated vars map returns a string with zero remaining `{{...}}` tokens.

## Verification

- [ ] `packages/engine/src/prompts.ts` contains a throw that fires when any `{{[a-zA-Z0-9_]+}}` token remains after substitution.
- [ ] The thrown error message contains the prompt identifier and the full list of unresolved variable names (deduplicated).
- [ ] `test/prompts.test.ts` contains a test that calls `loadPrompt('planner', {})` (or equivalent partial-vars call) and asserts the throw with the expected error message substring.
- [ ] `test/prompts.test.ts` contains a positive-case test asserting that a fully-populated call returns a string containing zero `{{...}}` tokens.
- [ ] Running `pnpm test` surfaces no callers that silently relied on unresolved-var pass-through (all have been fixed to pass required variables).
- [ ] `pnpm test` passes.
- [ ] `pnpm type-check` passes.
- [ ] `pnpm build` passes.
