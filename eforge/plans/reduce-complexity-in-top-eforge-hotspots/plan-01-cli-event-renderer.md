---
id: plan-01-cli-event-renderer
name: Decompose CLI Event Rendering
branch: reduce-complexity-in-top-eforge-hotspots/plan-01-cli-event-renderer
agents:
  builder:
    effort: high
    rationale: The target is a large, user-facing switch in an oversized file;
      implementation requires careful text-preserving helper extraction.
  reviewer:
    effort: high
    rationale: Review must compare moved renderer branches against the original
      output text and fallback behavior.
---

# Decompose CLI Event Rendering

## Architecture Context

The CLI display layer consumes typed `EforgeEvent` values and renders stdout/stderr output. The engine remains event-only and never renders. `packages/eforge/src/cli/display.ts` owns spinner state, verbose agent buffering, `renderStatus`, queue listing, playbook listing, dry-run rendering, and the public `renderEvent(event: EforgeEvent): void` export.

This plan is limited to mechanically decomposing the `renderEvent` hotspot in that file. Event schemas, engine event emission, daemon routes, and CLI call sites remain unchanged.

## Implementation

### Overview

Replace the single large `switch (event.type)` inside `renderEvent` with ordered private domain dispatch helpers. Each helper returns `true` after handling an event and `false` when the event belongs to another domain. The final fallback continues to call `getEventSummary(event)` and print the dim summary when present.

### Key Decisions

1. Keep `renderEvent(event: EforgeEvent): void` exported from `packages/eforge/src/cli/display.ts`; no CLI caller changes are in scope.
2. Keep private helpers in `display.ts` unless a same-file extraction breaches the existing no-growth ceiling; reduce repeated spinner/status formatting first.
3. Preserve every existing user-facing string, chalk color choice, spinner key, branch condition, blank line, and default-summary fallback.
4. Use type narrowing via `switch` branches or `Extract<EforgeEvent, { type: ... }>` helper parameters. Do not re-declare event wire shapes.

### Refactor Shape

Implement a small top-level dispatcher similar to:

```ts
export function renderEvent(event: EforgeEvent): void {
  if (renderPhaseEvent(event)) return;
  if (renderPlanningEvent(event)) return;
  if (renderPlanningReviewEvent(event)) return;
  if (renderPlanBuildEvent(event)) return;
  if (renderOrchestrationEvent(event)) return;
  if (renderExpeditionEvent(event)) return;
  if (renderValidationEvent(event)) return;
  if (renderAgentEvent(event)) return;
  if (renderInteractionEvent(event)) return;
  if (renderQueueEvent(event)) return;
  if (renderPrdValidationEvent(event)) return;
  if (renderRecoveryEvent(event)) return;
  if (renderDaemonExtensionAcceptanceEvent(event)) return;
  renderDefaultEvent(event);
}
```

The exact helper boundaries may vary, but no named helper extracted from `renderEvent` may exceed Cognitive Complexity 30.

Extract low-risk shared snippets where they reduce complexity without changing output:

- `setSpinnerText(key, text)` for repeated `const s = spinners.get(...); if (s) s.text = ...` blocks.
- `setPlanBuildSpinnerText(planId, text)` for `build:${planId}` updates.
- Evaluation summary formatting for planning, architecture, cohesion, and plan-build evaluation events.
- Review issue summary spinner completion for planning/architecture/cohesion review events.
- PRD validation gap complexity summary rendering.
- Acceptance validation verdict summary rendering.
- Status/color lookup helpers for queue staleness and planning pipeline scope colors.

## Scope

### In Scope

- Modify `packages/eforge/src/cli/display.ts`.
- Refactor only `renderEvent` and private helpers it uses.
- Reuse existing `startSpinner`, `succeedSpinner`, `failSpinner`, `stopAllSpinners`, `formatIssueSummary`, `elapsed`, `appendAgentBuffer`, `flushAgentBuffer`, and `getEventSummary` behavior.
- Keep `renderStatus`, `renderQueueList`, `renderPlaybookList`, and `renderDryRun` behavior unchanged except for behavior-preserving private helper reuse.

### Out of Scope

- Event schema changes.
- CLI command changes.
- Engine event ordering changes.
- New dependencies.
- Console snapshot rewrites.
- Daemon route or wire-shape changes.

## Files

### Create

- None.

### Modify

- `packages/eforge/src/cli/display.ts` — replace the monolithic `renderEvent` switch with domain dispatch helpers and small shared formatting helpers.

## Verification

- [ ] `packages/eforge/src/cli/display.ts` still exports `renderEvent(event: EforgeEvent): void`.
- [ ] `renderEvent` contains ordered domain dispatch calls and no monolithic event switch.
- [ ] Every named helper extracted from `renderEvent` has Cognitive Complexity ≤30.
- [ ] Existing explicit renderer strings in `renderEvent` branches are moved or shared; no user-facing text, icon, chalk color, spinner key, or blank-line sequence is intentionally edited.
- [ ] `renderStatus`, `renderQueueList`, `renderPlaybookList`, and `renderDryRun` remain exported with their current signatures.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `pnpm complexity:scan` no longer reports the original high-CC `packages/eforge/src/cli/display.ts:126` `renderEvent` entry.