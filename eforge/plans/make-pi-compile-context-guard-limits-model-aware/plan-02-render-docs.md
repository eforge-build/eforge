---
id: plan-02-render-docs
name: Render Guard Diagnostics and Update Documentation
branch: make-pi-compile-context-guard-limits-model-aware/plan-02-render-docs
---

# Render Guard Diagnostics and Update Documentation

## Architecture Context

Plan 01 adds optional client-owned structured diagnostics to compile scope/context failures. This plan updates CLI and Console rendering surfaces to display those fields when present, leaves older events unchanged, and refreshes documentation/generated references for the event shape change.

## Implementation

### Overview

Use the optional guard diagnostic fields from `CompileScopeContextFailure` in CLI and Console formatting helpers. Update tests for both new and old failure payloads. Update source documentation and regenerate reference artifacts after the event schema changes.

### Key Decisions

1. Keep rendering logic in existing formatting helpers: `packages/eforge/src/cli/compile-resilience-display.ts` and `packages/console-ui/src/lib/compile-resilience-format.ts`.
2. Render one compact diagnostic line for model/limit data, plus reserve details in detail output, instead of duplicating raw JSON.
3. Treat `failure.guard` as optional. Old failure events must keep the same headline and observed/artifact lines.
4. Update source docs in `docs/` and `web/content/`; allow `pnpm docs:generate` to refresh `web/public/` and reference/schema artifacts.

## Scope

### In Scope

- CLI compile scope/context failure rendering for provider/model, resolved input-token limit, context window, reserve values, safety margin, metadata source, and fallback reason when present.
- Console compile scope/context failure formatting for the same optional diagnostics.
- Tests covering new diagnostics and older events without diagnostics.
- Architecture/troubleshooting/glossary documentation updates.
- Generated reference artifacts after event schema/docs updates.

### Out of Scope

- Further event schema changes beyond fields introduced in plan 01.
- Recovery sidecar action behavior changes.
- New Console components outside the existing compile-resilience formatting path.
- Claude Agent SDK model-aware guard implementation.

## Files

### Create

- None.

### Modify

- `packages/eforge/src/cli/compile-resilience-display.ts` — Add optional guard diagnostics lines to CLI failure details.
- `packages/console-ui/src/lib/compile-resilience-format.ts` — Add optional guard diagnostics lines to Console failure details and banner details.
- `test/cli-display-compile-resilience.test.ts` — Assert CLI rendering includes new guard diagnostics when present and remains compatible when absent.
- `packages/console-ui/src/__tests__/compile-resilience-format.test.ts` — Assert Console formatting includes new guard diagnostics when present and remains compatible when absent.
- `docs/architecture.md` — Document Pi ModelRegistry-derived compile guard limits and static prompt byte guard behavior.
- `web/content/docs/troubleshooting.md` — Add user-facing troubleshooting text for model-aware guard limits and fallback diagnostics.
- `web/content/docs/glossary.md` — Update compile scope/context failure glossary entry to mention optional guard diagnostics.
- `web/content/reference/events.md` — Regenerated event reference, if `pnpm docs:generate` changes it.
- `web/public/reference/events.md` — Regenerated public event reference, if `pnpm docs:generate` changes it.
- `web/public/schemas/events.schema.json` — Regenerated event schema artifact, if `pnpm docs:generate` changes it.
- `web/public/docs/troubleshooting.md` — Regenerated public troubleshooting content.
- `web/public/docs/glossary.md` — Regenerated public glossary content.
- `web/public/llms.txt` — Regenerated public LLM summary content, if docs generation changes it.
- `web/public/llms-full.txt` — Regenerated public full LLM content, if docs generation changes it.

## Rendering Requirements

- For diagnostics with provider/model, display a line equivalent to `Model: <provider>/<modelId>`.
- For diagnostics with final limits, display a line containing `maxObservedInputTokens=<number>`.
- For diagnostics with context window and reserves, display context window, output reserve, overhead reserve, and safety margin values.
- For fallback diagnostics, display the fallback reason text.
- For older events, do not add placeholder text such as `unknown model` or `no guard diagnostics`.

## Verification

- [ ] CLI failure rendering includes provider, model id, `maxObservedInputTokens`, context window, reserves, safety margin, metadata source, and fallback reason for a failure fixture that contains guard diagnostics.
- [ ] CLI failure rendering for the existing no-diagnostics fixture keeps the current headline and observed-token lines and emits no model placeholder line.
- [ ] Console failure detail includes provider, model id, `maxObservedInputTokens`, context window, reserves, safety margin, metadata source, and fallback reason for a failure fixture that contains guard diagnostics.
- [ ] Console failure detail for the existing no-diagnostics fixture keeps the current summary and observed-token lines and emits no model placeholder line.
- [ ] `docs/architecture.md` contains a Pi ModelRegistry-derived guard-limit description and states that prompt byte defaults remain static.
- [ ] `web/content/docs/troubleshooting.md` and `web/content/docs/glossary.md` mention optional guard diagnostics on compile scope/context failures.
- [ ] `pnpm docs:generate` completes and generated docs/schema artifacts are committed when their contents change.
- [ ] `pnpm docs:check` exits 0 after generated artifacts are committed.
