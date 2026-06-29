---
id: plan-05-recovery-rendering
name: Render decomposition progress and classify decomposition exhaustion in
  recovery sidecars, CLI, Console, registry, and fixtures.
branch: add-context-managed-compile-planning-for-oversized-sources/recovery-rendering
---

# Recovery Rendering

## Architecture Reference

This module implements the **recovery-rendering** row from **Implementation Module Boundaries**, plus the rendering portions of the **Client-Owned Wire Model**, **Event Contract**, **Recovery Contract**, and **Artifact Synthesis** sections.

Key constraints from architecture:
- Decomposition events and failure evidence are client-owned contracts; this module consumes exported schemas/types and does not redefine wire shapes.
- Context-managed decomposition is internal compile evidence only; recovery text and UI must not auto-author or auto-enqueue successor PRDs.
- Recovery sidecars must distinguish `decomposition-exhausted` from provider `context-window`/`context-length` failures.
- Recovery sidecars must include bounded unit evidence: unit ID, parent ID, depth, budgets, observed pressure, assigned/unresolved criteria, blockers, and split attempts.
- CLI, Console timeline/activity, and sidecar markdown render decomposition progress from shared event types without raw source, raw content, raw prompts, transcripts, or unbounded agent output.
- `packages/engine/src/compile-resilience/context-recovery.ts` and `packages/console-ui/src/components/timeline/event-card.tsx` are shared files; edits must stay in this module's declared regions.
- `packages/client/src/events/variants/session-planning.ts` remains contract-owned. This module must not add or edit TypeBox event variants there.

## Scope

### In Scope
- Render `planning:decomposition:*` events in the CLI with concise status lines and bounded diagnostics.
- Render `planning:decomposition:*` events in Console timeline cards with summaries, expandable details, lifecycle styling, and blocker/waiting explanations.
- Ensure Console activity rows use useful client registry summaries for decomposition events.
- Explicitly ignore decomposition events in the Console run-state reducer when they have no plan/build state mutation.
- Render decomposition exhaustion evidence in compile scope/context recovery sidecar markdown.
- Preserve and display optional `decompositionEvidence` on compile-scope-context recovery options.
- Update sidecar read validation so optional decomposition evidence survives JSON sidecar parsing through the client-owned schema.
- Update compile scope/context recovery reason text for decomposition exhaustion and remove wording that implies engine-authored successor PRDs.
- Update CLI/Console compile failure detail formatting so `decomposition-exhausted` is labelled as a decomposition failure rather than a provider context-window failure.
- Update Claude Code plugin and Pi recovery skill docs to describe read-only decomposition evidence, with the required Claude Code plugin version bump.
- Add tests for sidecar markdown/JSON parsing, CLI output, Console format helpers, timeline rendering, activity summaries, and recovery skill parity.

### Out of Scope
- Adding or changing TypeBox schemas, event variant definitions, persistence flags, config defaults, or route wire shapes.
- Selecting context-managed decomposition, deriving graphs, scheduling units, invoking bounded planners, recursive splitting, or artifact synthesis.
- Reading raw `.decomposition/*` artifacts in recovery renderers beyond bounded evidence already carried by events/sidecars.
- Adding Console workflows for editing decomposition units or enqueueing follow-up work.
- Changing provider context-window classification or planner-family guard math.
- Bumping `packages/pi-eforge/package.json`.

## Implementation Approach

### Overview

Implement rendering as a consumer of the dependency modules. `contracts-config` supplies the decomposition event and failure evidence types; `compile-orchestration-synthesis` emits lifecycle/schedule/budget/synthesis events and maps `DecompositionPlanningError` into `CompileScopeContextFailure.decompositionEvidence`; `decomposition-core` supplies the meaning of evidence fields. This module adds formatting layers only.

Create small shared formatting helpers for CLI, Console, and recovery sidecars. The helpers convert bounded event/evidence fields into deterministic text: unit counts, active concurrent units, waiting reasons, triggered budget limits, compact handoff refs, artifact paths, unresolved criteria counts, and synthesis counts. They must never render raw root source, raw prompt text, transcript text, or unbounded agent output fields.

Recovery sidecar support has three parts:
1. `context-recovery.ts` emits sidecar recovery options with `decompositionEvidence` and decomposition-specific recovery reasons.
2. Sidecar JSON parsing preserves optional `decompositionEvidence` by validating through the client-owned recovery option schema.
3. Sidecar markdown, Console recovery panels, and recovery guidance sections render the bounded evidence and state that no automated recovery mutation exists for compile decomposition guidance.

CLI and Console event rendering remain display-only. The run-state reducer ignores decomposition events because synthesis already produces existing `planning:complete` or `expedition:architecture:complete` events that mutate plan/module state.

### Key Decisions

1. **Use typed client contracts end-to-end.** Import `PlanningDecomposition*Event`, `DecompositionFailureEvidence`, and `RecoverySidecarRecoveryOption` from `@eforge-build/client` / `@eforge-build/client/browser`; do not copy interface definitions into CLI, Console, or engine recovery code.
2. **Keep sidecar evidence bounded and action-neutral.** Markdown and JSON display unit evidence and unresolved criteria, but they do not propose generated successor PRD content or call any mutating recovery action for compile-scope-context guidance.
3. **Separate formatting helpers from large renderers.** Add new helper files for CLI and Console decomposition formatting, then make bounded edits to `display.ts` and `event-card.tsx` to call those helpers.
4. **Use existing lifecycle colors.** Console timeline maps start/queued/running to `start`/`progress`, completed/synthesis to `complete`, skipped to `info`, failed/budget exhaustion to `failed`, and budget pressure/schedule blockers to `warning`.
5. **Do not mutate run-state from decomposition events.** Console reducer exhaustiveness is satisfied by adding the new event types to `IGNORED_EVENT_TYPES`; compiled plan and expedition state continues to come from existing synthesis events.
6. **Treat registry summaries as activity-feed rendering.** If `contracts-config` has already added the registry entries, this module may refine only the `summary` functions for decomposition events. It must not alter `scope`, `persist`, event schema exports, or daemon route behavior.
7. **Validate optional evidence through client schemas in sidecar readers.** `sidecar-read.ts` must preserve `option.decompositionEvidence` only after schema validation, so sidecar parsing stays aligned with the client contract.
8. **Keep plugin and Pi recovery skills in sync.** Both skills explain the same decomposition evidence behavior; only the Claude Code plugin version is bumped.

## Files

### Create
- `packages/engine/src/recovery/decomposition-evidence-render.ts` — engine-side bounded text helpers for `DecompositionFailureEvidence`. Export functions such as `renderDecompositionEvidenceMarkdownLines(evidence)` and `decompositionEvidenceSummary(evidence)` for sidecar markdown, sidecar payload key evidence, and recovery guidance. Include a defensive forbidden-key scanner used by tests.
- `packages/eforge/src/cli/planning-decomposition-display.ts` — CLI render models for decomposition start, unit lifecycle, progress, schedule, budget, compact handoff, and synthesis events. Export `renderPlanningDecompositionEventModel(event)` plus `renderDecompositionEvidenceLines(evidence)` for compile-scope failure details.
- `packages/console-ui/src/lib/planning-decomposition-format.ts` — browser-safe summary/detail helpers for decomposition events and decomposition failure evidence. Export `planningDecompositionEventSummary(event)`, `planningDecompositionEventDetail(event)`, `decompositionFailureEvidenceSummary(evidence)`, and `decompositionFailureEvidenceDetail(evidence)`.
- `test/recovery-decomposition-sidecar-rendering.test.ts` — engine recovery tests for markdown rendering, JSON sidecar parsing, key evidence, and recovery guidance with `decompositionEvidence`.
- `test/cli-display-planning-decomposition.test.ts` — CLI formatter and `renderEvent()` tests for representative decomposition events and decomposition-exhausted compile failures.
- `packages/console-ui/src/__tests__/planning-decomposition-format.test.ts` — Console formatter tests for all decomposition event groups and bounded evidence formatting.

### Modify
- `packages/engine/src/compile-resilience/context-recovery.ts` — update decomposition-exhausted recovery wording and include optional `decompositionEvidence` on compile-scope-context recovery options `[region: recovery-rendering, near compileScopeContextRecoveryOption() and recoveryReason()]`.
- `packages/engine/src/recovery/sidecar-markdown.ts` — render a “Decomposition evidence” subsection under each compile-scope-context option when `decompositionEvidence` is present. Use `decomposition-evidence-render.ts`; do not inline schema shapes.
- `packages/engine/src/recovery/sidecar-read.ts` — preserve optional `decompositionEvidence` while validating compile-scope-context options through `RecoverySidecarCompileScopeContextOptionSchema`. Use bounded exact edits because this file exceeds 300 lines.
- `packages/engine/src/recovery/sidecar-payload.ts` — add decomposition exhaustion lines to `report.keyEvidence` and keep `report.recommendedAction` based on the existing recovery option reason. Do not add successor PRD text.
- `packages/engine/src/recovery/guidance-render.ts` — include bounded decomposition exhaustion details in generated `## Recovery Guidance` sections when sidecar recovery options contain evidence.
- `packages/eforge/src/cli/compile-resilience-display.ts` — append decomposition evidence details to `renderCompileScopeContextFailureModel()` and label `decomposition-exhausted` as decomposition evidence rather than provider context.
- `packages/eforge/src/cli/display.ts` — render `planning:decomposition:*` events from `renderPlanningDecompositionEventModel()` inside `renderPlanningEvent()` and update plan spinner text without forwarding raw payloads. Use bounded exact edits in the existing `cli-event-rendering` region.
- `packages/client/src/event-registry.ts` — refine decomposition event `summary` functions only if the contracts-config entries are too generic for activity rows. Do not change `scope`, `persist`, projectors, or schemas. **Shared registry issue:** this file is edited by `contracts-config` but is not listed in the architecture Shared File Registry; if implementation must change it, add a registry note or keep edits limited to the existing `planning:decomposition:*` summary values.
- `packages/client/src/__tests__/events-schemas-planning-decomposition.test.ts` — if registry summaries change, add assertions that `getEventSummary()` includes graph/unit IDs, selected batches, waiting reasons, budget triggered keys, compact handoff refs, and synthesis artifact counts.
- `packages/console-ui/src/lib/compile-resilience-format.ts` — append decomposition evidence summary/detail lines to compile scope/context failure formatting.
- `packages/console-ui/src/components/timeline/event-card.tsx` — classify, summarize, and render details for all `planning:decomposition:*` variants through `planning-decomposition-format.ts` `[region: recovery-rendering, classifyEvent/eventSummary/eventDetail decomposition cases]`.
- `packages/console-ui/src/lib/run-state/handlers/index.ts` — add all `planning:decomposition:*` variants to `IGNORED_EVENT_TYPES` with a comment that decomposition events are display-only and synthesis events carry state.
- `packages/console-ui/src/components/recovery/compile-scope-context-options.tsx` — render optional decomposition evidence under compile-scope-context recovery options, including unit ID, depth, triggered limits, blockers, unresolved criteria count, and split attempts.
- `packages/console-ui/src/components/recovery/__tests__/compile-scope-context-options.test.tsx` — assert the recovery panel shows decomposition evidence and exposes no mutating action for compile-scope-context options.
- `packages/console-ui/src/components/timeline/__tests__/event-card.test.ts` — add timeline card tests for start, schedule, unit running/completed/failed, budget, compact handoff, synthesis, and decomposition-exhausted failure details.
- `packages/console-ui/src/__tests__/activity-selectors.test.ts` — add activity selector coverage for decomposition event family, attention classification for failed/budget events, and registry summary text.
- `packages/console-ui/src/__tests__/compile-resilience-format.test.ts` — add `decomposition-exhausted` failure formatting tests with bounded evidence.
- `test/cli-display-compile-resilience.test.ts` — add CLI compile failure model tests for decomposition evidence and ensure details omit raw source/content/prompt/transcript sentinel keys.
- `test/cli-display-render-event.test.ts` — add top-level dispatcher tests for representative decomposition events.
- `test/recovery-compile-scope-sidecar-rendering.test.ts` — add a compile-scope-context option fixture with `source: 'decomposition'`, `failureKind: 'decomposition-exhausted'`, and `decompositionEvidence`.
- `test/recovery-sidecars.test.ts` — extend sidecar schema-version/read validation tests to accept and reject optional `decompositionEvidence`, and assert sidecar JSON/Markdown omit raw-source sentinel keys.
- `test/recovery-guidance-render.test.ts` — assert generated recovery guidance includes failed unit ID, triggered limit keys, and unresolved criteria counts for decomposition exhaustion.
- `eforge-plugin/skills/recover/recover.md` — explain that compile-scope-context options may include bounded decomposition evidence; summarize it without mapping to `eforge_apply_recovery` or `eforge_continue_repair`, and do not author replacement PRD content.
- `packages/pi-eforge/skills/eforge-recover/SKILL.md` — mirror the Claude Code recovery skill decomposition evidence guidance using Pi tool names.
- `eforge-plugin/.claude-plugin/plugin.json` — bump the plugin patch version because the plugin skill changes.

## Detailed Rendering Contracts

### Decomposition event summaries

Render these one-line summaries in CLI, Console timeline, and client registry summaries where applicable:
- `planning:decomposition:start`: `Context-managed planning: <unitCount> unit(s), <edgeCount> edge(s), parallelism <n>`; include coverage as `<covered>/<total> criteria` when available.
- `planning:decomposition:unit:queued`: `Planning unit queued: <unitId>` plus subsystem hints when present.
- `planning:decomposition:unit:running`: `Planning unit running: <unitId>`.
- `planning:decomposition:unit:progress`: `Planning unit <unitId>: <bounded message>`.
- `planning:decomposition:unit:completed`: `Planning unit completed: <unitId> (<coveredCount> criteria)`.
- `planning:decomposition:unit:skipped`: `Planning unit skipped: <unitId> — <reason>`.
- `planning:decomposition:unit:failed`: `Planning unit failed: <unitId> — <reason or triggered limits>`.
- `planning:decomposition:schedule`: `Planning schedule: running [a, b]; waiting <count>; selected [c, d]`.
- `planning:decomposition:budget`: `Planning budget: <unitId> triggered <limit keys>` or `Planning budget: <unitId> within limits`.
- `planning:decomposition:compact-handoff`: `Planning unit handoff: <unitId> → <artifactRef> (<bytes> B)`.
- `planning:decomposition:synthesis:complete`: `Context-managed synthesis complete: <artifactCount> artifact(s), <completed>/<failed>/<skipped> units`.

### Decomposition event details

Expandable detail renderers must include only bounded fields:
- graph/root IDs, unit IDs, dependency edges, source slice summaries, criteria IDs, subsystem hints, dependency IDs, interface/shared-file constraint keys, budgets, observed pressure, waiting reasons, blocked pairs, compact handoff refs/hashes, synthesized artifact paths/types, and unresolved criteria evidence.
- Details must omit event fields named `sourceContent`, `rawSource`, `prompt`, `transcript`, `rawTranscript`, or agent output blobs if a malformed payload reaches a renderer.

### Recovery sidecar decomposition evidence

For `RecoverySidecarRecoveryOption & { kind: 'compile-scope-context' }` with `decompositionEvidence`, render:
- `Failed Unit: <unitId>` and optional `Parent Unit: <parentId>`.
- `Depth: <depth>`.
- `Triggered limits: <triggeredLimitKeys>` from `observedPressure`.
- Budget summary: prompt source bytes, prompt bytes, observed input tokens, compact handoff bytes, local exploration tool uses, criteria/unit, subsystem/unit, recursive depth.
- Observed pressure summary: any present prompt/source bytes, observed input tokens/turns, compact handoff bytes, local exploration tool uses.
- Assigned criteria count and first bounded criteria IDs.
- Unresolved criteria entries as bounded bullets with criterion ID, reason, and evidence snippets.
- Blockers and split attempts as bounded bullets.

Recovery wording for this case must state:
- The failure came from context-managed decomposition exhaustion, not a provider context-window rejection.
- Existing direct retry or apply-recovery actions do not mutate compile decomposition state.
- Operators can inspect bounded evidence and choose a manual reduced source or deliberate follow-up PRD outside the engine.
- The engine does not auto-author or auto-enqueue successor PRDs.

## Testing Strategy

### Unit Tests
- CLI decomposition formatter returns the expected headline/details for one representative event from each event group: start, lifecycle, progress, schedule, budget, compact handoff, synthesis.
- CLI compile failure formatter includes failed unit ID, depth, triggered limits, blockers, assigned criteria count, and unresolved criteria count when `decompositionEvidence` is present.
- CLI formatters omit sentinel strings stored under forbidden raw fields in malformed test payloads cast through `unknown`.
- Engine decomposition evidence renderer bounds long blockers, long unresolved evidence, and split-attempt evidence while preserving counts.
- Sidecar read validation preserves valid optional `decompositionEvidence` and rejects malformed evidence with invalid budgets, negative depth, invalid observed pressure, or malformed split attempts.
- Sidecar markdown includes a “Decomposition evidence” subsection for decomposition-exhausted compile guidance.
- Sidecar payload `report.keyEvidence` includes failed unit ID and triggered limit keys for decomposition exhaustion.
- Recovery guidance rendering includes failed unit ID and unresolved criteria count for decomposition exhaustion.
- Console decomposition formatter returns deterministic summaries/details for all decomposition event variants.
- Console compile failure formatting includes decomposition evidence details and excludes raw field sentinel values.
- Console recovery option panel renders decomposition evidence fields without rendering an apply/continue action.

### Integration Tests
- `renderEvent()` prints decomposition schedule selected batches and waiting reasons through the top-level CLI dispatcher.
- `renderEvent()` prints decomposition budget triggered limit keys and compact handoff refs without raw JSON dumps.
- Console `EventCard` renders decomposition event summaries, expandable details, and failed/warning/complete classes for the expected event types.
- Console activity selectors classify decomposition events as `session`, mark `planning:decomposition:unit:failed` as attention, and use `getEventSummary()` output.
- Console run-state reducer compiles with all decomposition event variants present in `IGNORED_EVENT_TYPES`.
- Recovery sidecar markdown and JSON generated from a compile-scope-context option with decomposition evidence parse through `parseRecoverySidecarPayload()` and render in Console recovery components.
- Claude Code plugin and Pi recovery skill docs contain matching decomposition evidence instructions, with tool names adapted to each host.

## Verification

- [ ] `renderPlanningDecompositionEventModel()` returns a headline containing `Context-managed planning` for `planning:decomposition:start` with two units.
- [ ] `renderPlanningDecompositionEventModel()` returns schedule details containing `selectedBatch: unit-a, unit-b` and `dependency:unit-foundation` for a schedule event.
- [ ] `renderPlanningDecompositionEventModel()` returns budget details containing `maxObservedInputTokens` when that key appears in `triggeredLimitKeys`.
- [ ] CLI `renderEvent()` for `planning:decomposition:compact-handoff` prints the unit ID, artifact ref, byte size, and hash prefix.
- [ ] CLI decomposition renderers do not print `ROOT-SOURCE-SHOULD-NOT-APPEAR`, `PROMPT-SHOULD-NOT-APPEAR`, or `RAW-TRANSCRIPT-SHOULD-NOT-APPEAR` from malformed raw fields.
- [ ] `compileScopeContextRecoveryOption()` copies `decompositionEvidence.unitId` for a `decomposition-exhausted` failure.
- [ ] `compileScopeContextRecoveryOption()` returns no option for recovery action `none` even when decomposition evidence exists.
- [ ] `recoveryReason()` for `decomposition-exhausted` contains the failed unit ID and does not contain `context-window`.
- [ ] `recoveryReason()` for bounded decomposition guidance contains `does not auto-author` and `does not auto-enqueue`, and it does not contain generated successor PRD content.
- [ ] `parseRecoverySidecarPayload()` preserves `recoveryOptions[0].decompositionEvidence.unitId` for a valid schemaVersion 4 sidecar.
- [ ] `parseRecoverySidecarPayload()` rejects a compile-scope-context option whose `decompositionEvidence.depth` is negative.
- [ ] `renderRecoverySidecarMarkdown()` contains `Decomposition evidence`, `Failed Unit: unit-overflow`, `Triggered limits: maxObservedInputTokens`, and `Unresolved criteria` for decomposition evidence.
- [ ] `renderRecoverySidecarMarkdown()` does not contain raw source, content, prompt, or transcript sentinel strings from evidence-adjacent malformed input.
- [ ] `buildRecoverySidecarPayload()` adds a key evidence line containing `Decomposition exhausted: unit-overflow` when recovery options carry decomposition evidence.
- [ ] `renderRecoveryGuidanceSection()` includes `Decomposition exhausted in unit unit-overflow` for sidecars with decomposition evidence.
- [ ] `compileScopeContextFailureSummary()` returns text containing `decomposition-exhausted from decomposition at planning-decomposition`.
- [ ] `compileScopeContextFailureDetail()` includes failed unit ID, depth, triggered limit keys, blockers, and unresolved criteria count.
- [ ] `planningDecompositionEventSummary()` returns non-empty text for all 11 `planning:decomposition:*` variants.
- [ ] `planningDecompositionEventDetail()` for a schedule event includes active concurrent units and blocked pair evidence.
- [ ] `EventCard` renders `planning:decomposition:unit:failed` with failed styling.
- [ ] `EventCard` renders `planning:decomposition:synthesis:complete` with complete styling and artifact paths in expanded details.
- [ ] `CompileScopeContextOptions` renders decomposition evidence for compile-scope-context recovery options.
- [ ] Console activity selectors classify `planning:decomposition:schedule` as `session`.
- [ ] Console activity selectors mark `planning:decomposition:unit:failed` as attention.
- [ ] `getEventSummary()` for `planning:decomposition:schedule` contains the selected unit IDs after registry summary refinement.
- [ ] `IGNORED_EVENT_TYPES` includes all 11 `planning:decomposition:*` variants.
- [ ] `eforge-plugin/skills/recover/recover.md` and `packages/pi-eforge/skills/eforge-recover/SKILL.md` both mention `decompositionEvidence`.
- [ ] `eforge-plugin/.claude-plugin/plugin.json` has a patch version greater than the pre-change version.
- [ ] `packages/pi-eforge/package.json` version is unchanged.
- [ ] `pnpm test -- cli-display-planning-decomposition recovery-decomposition-sidecar-rendering` exits 0.
- [ ] `pnpm --filter @eforge-build/console-ui test -- planning-decomposition-format event-card compile-scope-context-options activity-selectors` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `pnpm maintainability:check` exits 0.

<build-config>
{
  "build": [["implement", "doc-author"], "test-cycle", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["code", "test"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
