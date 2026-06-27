---
id: plan-06-surfaces-docs
name: Render new typed preflight/failure/recovery guidance in existing CLI,
  Console, recovery, and documentation surfaces as needed.
branch: add-compile-resilience-for-oversized-prds/surfaces-docs
---

# Surfaces Docs

## Architecture Reference

This module implements the **surfaces-docs** portions of the architecture:

- **Module Responsibilities / surfaces-docs** — render shared client-owned `planning:preflight`, `planning:scope-context:failure`, terminal subtype, and recovery sidecar guidance in existing CLI, Console, recovery markdown, and documentation surfaces.
- **Integration Contracts Between Modules / Surfaces** — consume `@eforge-build/client` / `@eforge-build/client/browser` types and event variants without re-declaring daemon wire shapes or route constants.
- **Technical Decisions / Add new events rather than overloading warnings** — show typed compile-risk and scope/context events directly rather than treating provider context errors as generic manual failures.
- **Quality Attributes** — keep new display output bounded, keep normal small/moderate PRD output low-noise, and make recovery guidance visible without adding scheduler-owned workflows.

Key constraints from architecture:

- `@eforge-build/client` owns the serializable wire contracts. CLI and Console must import `CompilePreflightRisk`, `CompileScopeContextFailure`, and `RecoverySidecarRecoveryOption` types instead of declaring local shape interfaces.
- Surfaces render guidance only. They must not add queue scheduling, auto-drain, automatic decomposition, or mutating actions for `retry-as-expedition` / `bounded-decomposition` recovery options.
- Console and CLI must not inline `/api/...` route literals or re-declare daemon response shapes.
- Normal small/moderate PRDs must not gain noisy CLI output or lose source-detail preview behavior because a `planning:preflight` event exists.
- `planning:scope-context:failure` must be visible as a compile/scope context failure, not only as a generic `phase:end failed` message.
- Recovery sidecar markdown and Console recovery panels must distinguish non-mutating compile scope/context guidance from apply-recovery verdicts.
- Pi and Claude plugin command behavior is not expected to change. If implementation discovers a host command semantic change, update `packages/pi-eforge/` and `eforge-plugin/` together and bump `eforge-plugin/.claude-plugin/plugin.json`.

## Scope

### In Scope

- Add compact CLI rendering for elevated/overflow `planning:preflight` risk results.
- Add CLI rendering for `planning:scope-context:failure` with source, failure kind, stage, bounded explanation, observed metrics, artifact summary, and recovery action.
- Keep normal preflight events silent in non-verbose CLI mode.
- Add Console timeline summaries/details and severity classification for `planning:preflight` and `planning:scope-context:failure`.
- Add Console run-detail failure banner support for compile-level scope/context failures that have no `plan:build:failed` event.
- Add Console recovery-panel rendering for `compile-scope-context` sidecar options as read-only guidance.
- Add recovery sidecar Markdown rendering for `compile-scope-context` recovery options.
- Update hand-authored docs for oversized compile/scope-context failure diagnosis and recovery guidance.
- Regenerate generated docs/reference artifacts after docs and event-schema changes have landed.
- Add targeted CLI, Console, recovery Markdown, and docs drift tests.

### Out of Scope

- Defining or changing client event schemas, recovery option unions, terminal subtypes, or route contracts.
- Emitting `planning:preflight` or `planning:scope-context:failure` events from the engine.
- Implementing preflight scoring, prompt compaction, planner diagnostics, live context guardrails, provider classifiers, retry-as-expedition, bounded decomposition decisions, or artifact validation.
- Adding Console or CLI mutating actions for `retry-as-expedition`, `bounded-decomposition`, or `manual-reduce-scope` recovery options.
- Adding new daemon routes or changing daemon API version.
- Redesigning Console navigation, recovery workflows, or extension workstations.
- Changing Pi or Claude plugin command behavior when this module only changes rendering and docs.

## Implementation Approach

### Overview

Add small display-formatting helpers per surface and thread them into existing render points with bounded edits. The CLI helper returns compact text lines used by `display.ts`; Console gets a browser-safe helper used by the timeline, failure banner, and recovery panel. Recovery Markdown gains a focused section for non-mutating compile scope/context options. Documentation describes what operators see and which recovery paths are mutating versus advisory.

The dependency modules already provide these contracts:

- `foundation-contracts` exports `CompilePreflightRisk`, `CompileScopeContextFailure`, `CompileRecoveryAction`, `RecoverySidecarRecoveryOption`, `planning:preflight`, `planning:scope-context:failure`, and `error_context_window` through client barrels.
- `context-recovery` emits `planning:scope-context:failure`, writes `compile-scope-context` sidecar options, and sets terminal subtype evidence.
- `artifact-validation` supplies fail-closed messages for missing/invalid compile artifacts; this module only renders those existing failures.

### Key Decisions

1. **Create surface-local formatting helpers instead of expanding large render files.**  
   `packages/eforge/src/cli/display.ts` is over 1,000 lines and has a no-growth ceiling. `packages/console-ui/src/components/timeline/event-card.tsx` is close to the 600-line implementation cap. Put mapping/formatting logic in focused helper files and add only small switch cases/imports to existing renderers.

2. **Render normal preflight quietly.**  
   CLI prints normal-risk preflight only when `initDisplay({ verbose: true })` is active. Console timeline still records the event, but summary text stays one line and details are collapsed. Elevated and overflow-risk preflight uses warning styling and includes the recovery recommendation.

3. **Treat attempted recovery as progress, terminal recovery as failure.**  
   A `planning:scope-context:failure` event with `failure.recovery.attempted === true` can be emitted before a successful retry-as-expedition attempt; CLI renders it as a yellow recovery action rather than failing the planning spinner. Events with `attempted === false` or final failure context render as stopped/failed guidance.

4. **Do not turn compile guidance into apply buttons.**  
   `compile-scope-context` sidecar options are read-only. Console displays them in a separate guidance section and keeps the primary mutating action limited to existing verdict/continue-repair/accepted-success flows.

5. **Use shared client types directly.**  
   All new formatting helpers import types from `@eforge-build/client` or `@eforge-build/client/browser`. Tests may hand-craft event objects cast through `unknown`, but production code must not duplicate the wire interfaces.

6. **Prefer bounded detail over raw payloads.**  
   Rendering includes byte counts, hashes, counts, representative paths/headings, and recovery metadata already present in shared types. It must not print compacted source bodies, planner tool arguments, or raw provider payloads.

7. **Regenerate generated docs rather than editing them by hand.**  
   Update hand-authored docs under `web/content/docs/` and `docs/`; then run `pnpm docs:generate` so `web/public/`, reference events, schemas, and LLM bundles reflect the client event additions.

## Files

### Create

- `packages/eforge/src/cli/compile-resilience-display.ts` — pure CLI formatting helpers for compile risk, scope/context failures, byte counts, observed metrics, artifact summaries, and recovery action labels. Keep this file below 600 lines.
- `packages/console-ui/src/lib/compile-resilience-format.ts` — browser-safe formatting helpers for Console timeline summaries/details, compile failure banner models, and recovery option labels. Import shared types from `@eforge-build/client/browser`.
- `packages/console-ui/src/components/recovery/compile-scope-context-options.tsx` — presentational read-only section for `compile-scope-context` sidecar recovery options.
- `test/cli-display-compile-resilience.test.ts` — CLI rendering tests for preflight and scope/context failure events.
- `packages/console-ui/src/__tests__/compile-resilience-format.test.ts` — pure helper tests for Console compile-resilience formatting.
- `packages/console-ui/src/components/recovery/__tests__/compile-scope-context-options.test.tsx` — jsdom tests for read-only compile-scope recovery option rendering.
- `test/recovery-compile-scope-sidecar-rendering.test.ts` — recovery Markdown tests for `compile-scope-context` sidecar options.

### Modify

- `packages/eforge/src/cli/display.ts` — import CLI helper functions and add bounded cases for `planning:preflight` and `planning:scope-context:failure` inside `renderPlanningEvent`; use bounded exact edits because the file is over 1,000 lines.
- `packages/console-ui/src/components/timeline/event-card.tsx` — import Console helper functions, classify `planning:preflight`/`planning:scope-context:failure`, add event summary/detail switch cases, and keep raw event JSON out of the default visible row.
- `packages/console-ui/src/lib/run-state/handlers/index.ts` — add `planning:preflight` and `planning:scope-context:failure` to `IGNORED_EVENT_TYPES` unless a later implementation chooses to store explicit state for them. This satisfies the reducer exhaustiveness check while preserving event-log rendering.
- `packages/console-ui/src/views/run-detail/pipeline-section.tsx` — derive the latest compile scope/context failure from `runState.events` and pass a compile-failure banner model to `FailureBanner`.
- `packages/console-ui/src/components/common/failure-banner.tsx` — render either plan failures, a compile-level failure, or both; use compile-specific copy such as `Compile scope/context failure` instead of `0 plans failed`.
- `packages/console-ui/src/components/recovery/recovery-report-panel.tsx` — render `CompileScopeContextOptions` when the loaded sidecar contains `recoveryOptions` with `kind: 'compile-scope-context'`; do not add those actions to `SIDECAR_ACTIONS`.
- `packages/engine/src/recovery/sidecar-markdown.ts` — add a `Compile scope/context recovery guidance` Markdown section for `compile-scope-context` options. Keep continue-and-repair rendering unchanged.
- `packages/console-ui/src/views/run-detail/__tests__/pipeline-section.test.tsx` — add a compile scope/context failure fixture that renders a compile failure banner without any `plan:build:failed` event.
- `packages/console-ui/src/components/timeline/__tests__/event-card.test.ts` — add pure mirror coverage or helper-based coverage for new event summary/detail/classification branches if the new Console helper tests do not cover every branch.
- `packages/console-ui/src/components/now/__tests__/queue-recovery-dialog.test.tsx` — add or extend a sidecar fixture with a `compile-scope-context` option and assert the recovery dialog shows guidance with no retry/continue/abandon button when the verdict is `manual`.
- `test/cli-display-render-event.test.ts` — keep existing top-level dispatcher tests; add only minimal compatibility coverage here if the focused CLI test cannot reuse its capture helpers.
- `test/recovery-sidecars.test.ts` — add compatibility coverage only if the focused sidecar rendering test cannot exercise `parseRecoverySidecarPayload()` with the broadened client-owned option union.
- `packages/console-ui/README.md` — update the Now failed-build recovery and data-flow sections to mention read-only compile scope/context guidance and the new timeline/banners.
- `web/content/docs/troubleshooting.md` — add a subsection for oversized PRDs / compile scope-context failures, including how to interpret `planning:preflight`, `planning:scope-context:failure`, `retry-as-expedition`, `bounded-decomposition`, and `repair-existing-artifacts` guidance.
- `web/content/docs/glossary.md` — update `Recovery sidecar` and related entries so `compile-scope-context` options are documented as read-only guidance alongside continue-and-repair options.
- `docs/architecture.md` — update the Event System planning row to mention `planning:preflight` and `planning:scope-context:failure` as typed compile-resilience diagnostics.
- Generated docs/reference outputs — run `pnpm docs:generate` after the code/docs changes. Do not manually edit generated `web/public/**`, `web/content/reference/**`, schema JSON, or LLM bundle files.

## Rendering Details

### CLI

`renderPlanningEvent()` must handle:

- `planning:preflight`
  - `normal`: no output unless `verbose === true`.
  - `elevated`: print one yellow line with level, source bytes, prompt bytes, AC count, generated inventory count, subsystem count, and recommendation.
  - `overflow-risk`: print the same fields plus a second indented line containing the bounded recommendation reason.
- `planning:scope-context:failure`
  - Always flush/stop the planning spinner path enough that the message is visible.
  - If `failure.recovery.attempted === true`, print a warning/progress line such as `Compile context guard: retrying as expedition` and keep planning alive.
  - If `failure.recovery.attempted !== true`, fail the planning spinner with a bounded `Planning stopped: <failureKind> at <stage>` message.
  - Print indented details for recovery action, eligibility, attempt count, artifact counts, and observed prompt/token/turn metrics when present.

Example source-owned block if temporary build-coordination markers are needed:

```ts
// --- eforge:region plan-06-surfaces-docs ---
case 'planning:preflight':
  return renderCompilePreflightEvent(event, { verbose });
case 'planning:scope-context:failure':
  return renderCompileScopeContextFailureEvent(event.failure);
// --- eforge:endregion plan-06-surfaces-docs ---
```

### Console timeline and run detail

- `planning:preflight` summary format: `Compile preflight: <level> (<sourceBytes> source, <promptSourceBytes> prompt, <action>)`.
- `planning:preflight` detail format includes risk reasons, generated inventory counts, representative hashes/paths/headings, subsystem evidence, and recommendation. It must cap representative list rendering using the already-bounded arrays from the event.
- `planning:scope-context:failure` summary format: `Compile scope/context failure: <failureKind> from <source> at <stage> — <action>`.
- `planning:scope-context:failure` detail format includes explanation, recovery metadata, artifact summary, observed metrics, and optional embedded preflight risk summary.
- Run detail must show a failure banner for compile scope/context failures even when no individual plan has failed.
- Activity rows can rely on the client `eventRegistry` summaries and existing attention classification because `planning:scope-context:failure` contains the `failure` keyword.

### Recovery surfaces

- Recovery Markdown renders a new section only when `payload.recoveryOptions` contains at least one `kind: 'compile-scope-context'` option.
- Console recovery panel renders compile options in a read-only guidance callout, including action label, recommended flag, eligible flag, attempted flag, attempt/maxAttempts, source, failure kind, and reason.
- The guidance callout states that these options do not map to `apply-recovery`; the operator must use the existing recovery verdict actions, continue-and-repair when artifacts are valid, or manual scope reduction/decomposition.
- Existing continue-and-repair eligibility and primary action rendering remain unchanged.

## Testing Strategy

### Unit Tests

- CLI formatting helper tests cover:
  - normal preflight produces no non-verbose lines;
  - elevated preflight includes level, byte counts, AC count, generated inventory count, subsystem count, and action;
  - overflow preflight includes the bounded recommendation reason;
  - scope/context failure includes failure kind, source, stage, recovery action, attempt count, artifact counts, and observed metrics;
  - long explanations are truncated by the dependency module before rendering and the renderer does not add raw source/payload text.
- Console formatting helper tests cover:
  - preflight summary and detail for normal/elevated/overflow levels;
  - scope/context failure summary and detail for provider and live-context-guard sources;
  - recovery action label mapping for `retry-as-expedition`, `bounded-decomposition`, `manual-reduce-scope`, and `repair-existing-artifacts`.
- Recovery Markdown tests cover:
  - sidecar with one recommended `compile-scope-context` option renders the new section;
  - option action, eligible flag, attempted metadata, source, failure kind, and reason appear;
  - the section text states that no apply-recovery mutation is available for compile guidance;
  - continue-repair section output remains present for a sidecar that contains both option kinds.

### Integration / Component Tests

- CLI `renderEvent()` tests verify:
  - non-verbose normal preflight emits no line;
  - overflow preflight emits compact warning lines;
  - terminal scope/context failure emits stopped guidance;
  - attempted retry-as-expedition emits retry guidance without using the `Planning failed:` text.
- Console timeline tests verify:
  - `planning:preflight` renders a visible summary and expandable detail;
  - `planning:scope-context:failure` uses failed styling and expandable detail.
- Console run-detail tests verify:
  - a run with `planning:scope-context:failure` and `phase:end failed` but no `plan:build:failed` renders a compile failure banner;
  - a run with plan failures still renders existing plan failure rows.
- Console recovery panel tests verify:
  - a manual sidecar containing `compile-scope-context` guidance renders the guidance section;
  - no `Retry from scratch`, `Continue and repair build`, or `Archive failed PRD` button appears because of compile guidance alone;
  - an existing eligible continue-and-repair response still renders exactly one continue-and-repair action.
- Docs tests/drift checks verify generated docs are current after `pnpm docs:generate`.

## Verification

- [ ] `renderEvent()` emits zero console lines for a `planning:preflight` event with `risk.level === 'normal'` when `verbose` is false.
- [ ] `renderEvent()` emits a line containing `Compile preflight`, `overflow-risk`, source bytes, prompt bytes, AC count, and recovery action for an overflow-risk preflight event.
- [ ] `renderEvent()` emits a line containing `Compile scope/context failure`, failure kind, source, stage, recovery action, and attempt count for a terminal scope/context failure event.
- [ ] `renderEvent()` emits retry-as-expedition guidance without the substring `Planning failed:` when `failure.recovery.attempted === true`.
- [ ] Console timeline summary for `planning:preflight` contains the risk level and recovery action.
- [ ] Console timeline detail for `planning:preflight` contains generated inventory counts, representative hashes, subsystem evidence, and recommendation reason.
- [ ] Console timeline summary for `planning:scope-context:failure` contains failure kind, source, stage, and recovery action.
- [ ] Console timeline detail for `planning:scope-context:failure` contains explanation, observed metrics, recovery metadata, and artifact summary.
- [ ] `packages/console-ui/src/lib/run-state/handlers/index.ts` type-checks with `planning:preflight` and `planning:scope-context:failure` accounted for by the registry or ignored list.
- [ ] Run detail renders a compile failure banner when events include `planning:scope-context:failure` and `phase:end failed` but no `plan:build:failed`.
- [ ] Existing plan failure banner copy remains `1 plan failed` or `<N> plans failed` for runs that only contain `plan:build:failed` events.
- [ ] Recovery Markdown for a sidecar with `kind: 'compile-scope-context'` contains `Compile scope/context recovery guidance`.
- [ ] Recovery Markdown for compile guidance contains the action, eligibility flag, attempted flag, attempt/maxAttempts, source, failure kind, and reason.
- [ ] Recovery Markdown for compile guidance contains text stating that the option is read-only guidance and is not an `apply-recovery` mutation.
- [ ] Console recovery panel renders `Compile scope/context guidance` for a sidecar containing a `compile-scope-context` option.
- [ ] Console recovery panel does not render `Retry from scratch`, `Continue and repair build`, or `Archive failed PRD` solely because a manual sidecar contains compile-scope guidance.
- [ ] Console recovery panel still renders exactly one `Continue and repair build` action when live continue-and-repair eligibility is true and non-partial.
- [ ] Production code imports compile-resilience event/recovery types from `@eforge-build/client` or `@eforge-build/client/browser` and declares no local copies of those wire interfaces.
- [ ] No new `/api/...` route literals are added outside client-owned route constants.
- [ ] `eforge-plugin/.claude-plugin/plugin.json` is unchanged when only rendering/docs change and no plugin behavior changes.
- [ ] `packages/pi-eforge/package.json` is unchanged.
- [ ] `web/content/docs/troubleshooting.md` documents how to diagnose `planning:preflight` and `planning:scope-context:failure` events.
- [ ] `web/content/docs/troubleshooting.md` states that `retry-as-expedition` and `bounded-decomposition` sidecar options are guidance, not Console/daemon apply actions.
- [ ] Generated docs are refreshed by `pnpm docs:generate`; `pnpm docs:check` exits `0`.
- [ ] `packages/eforge/src/cli/display.ts` stays at or below its `1235` line no-growth ceiling.
- [ ] `packages/console-ui/src/components/timeline/event-card.tsx` stays below `600` lines.
- [ ] New implementation files stay at or below `600` lines.
- [ ] New test files stay at or below `1,200` lines.
- [ ] `pnpm test -- test/cli-display-compile-resilience.test.ts test/recovery-compile-scope-sidecar-rendering.test.ts packages/console-ui/src/__tests__/compile-resilience-format.test.ts packages/console-ui/src/components/recovery/__tests__/compile-scope-context-options.test.tsx packages/console-ui/src/views/run-detail/__tests__/pipeline-section.test.tsx packages/console-ui/src/components/now/__tests__/queue-recovery-dialog.test.tsx` exits `0`.
- [ ] `pnpm type-check` exits `0`.
- [ ] `pnpm maintainability:check` exits `0`.
- [ ] `pnpm build` exits `0`.

<build-config>
{
  "build": [["implement", "doc-author"], "doc-sync", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "auto",
    "perspectives": ["code", "docs"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>

## Recovery Guidance

- Failed PRD: "add-compile-resilience-for-oversized-prds"
- Root failed plan: "plan-06-surfaces-docs"
- Failure summary: "Compiled plan artifacts are eligible for continue-and-repair for add-compile-resilience-for-oversized-prds. artifact source: feature-branch; 10 landed commit(s); failing plan: plan-06-surfaces-docs; feature branch: eforge/add-compile-resilience-for-oversized-prds. Queue the failed PRD through the compiled-artifact recovery path so preserved work is reused and the remaining build can be repaired without generating a successor PRD."
- Failure detail: "Review cycle exhausted 3 round(s) without a final evaluation verdict."
- Failure detail: "Review cycle exhausted 3 round(s) without a final evaluation verdict."
- Recommended action: "Continue and repair build (Continue build): run `eforge continue-repair add-compile-resilience-for-oversized-prds`. This queues the failed PRD through the compiled-artifact repair path and reuses preserved work; do not generate a successor PRD."
- Remaining work:
  - "Repair plan-06-surfaces-docs through the compiled-artifact recovery path"
  - "Resolve or bound the review context-window failure so final evaluation can complete"
  - "Re-run required validation commands after repair"
- Retry/resume guidance: Continue plan-06-surfaces-docs for failed PRD add-compile-resilience-for-oversized-prds from the preserved compiled artifacts; do not restart dependency-satisfied work that is already landed or complete.
- Sidecar generated at: 2026-06-27T04:12:45.118Z
- Source sidecar: .eforge/queue/failed/add-compile-resilience-for-oversized-prds.recovery.json
- Source identity: prdId=add-compile-resilience-for-oversized-prds; setName=add-compile-resilience-for-oversized-prds; featureBranch=eforge/add-compile-resilience-for-oversized-prds; baseBranch=main
