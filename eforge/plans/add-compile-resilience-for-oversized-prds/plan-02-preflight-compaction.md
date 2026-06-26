---
id: plan-02-preflight-compaction
name: Implement deterministic compile source risk estimation and
  generated-inventory prompt compaction before composer/planner prompts.
branch: add-compile-resilience-for-oversized-prds/preflight-compaction
---

# Preflight Compaction

## Architecture Reference

This module implements the **preflight-compaction** portions of the architecture:

- **Module Responsibilities / preflight-compaction** — deterministic source measurement, acceptance-criteria counting, generated inventory/sidecar detection, prompt-source compaction, and creation of `CompilePromptSourceBundle` plus `CompilePreflightRisk` values.
- **Shared Data Model / Compile Risk Result, Preflight Options, Compacted Source Bundle** — engine-owned preflight helper inputs/outputs backed by client-owned serializable risk contracts from `foundation-contracts`.
- **Integration Contracts Between Modules / Preflight and Compaction** — run immediately after compile source normalization, emit `planning:preflight`, preserve the full source outside prompts, and pass compacted prompt content to composer/planner-family prompts.
- **Shared File Registry / Region Declarations** — bounded exact edits in shared compile, pipeline, and agent prompt-plumbing files.

Key constraints from architecture:
- Use deterministic signals: PRD/source byte size, acceptance-criteria count, generated-inventory/sidecar detection, likely subsystem breadth, selected profile, and selected pipeline scope.
- Preserve full source in `ctx.sourceContent`; compaction affects only agent prompt input via `ctx.promptSourceContent`.
- For small and moderate ordinary PRDs, `promptSource` must equal the visible stripped source and prompt detail must not be removed.
- Generated or machine-readable inventories are included at full size only when `fullContentRequiredPaths` or `fullContentRequiredHeadings` explicitly match; otherwise they are summarized with counts, headings, hashes, path references, and compact summaries.
- Event-facing arrays must use bounded representative lists from the client contract (`MAX_COMPILE_RISK_LIST_ITEMS`); unbounded totals remain in count fields.
- This module computes recommendations in `CompilePreflightRisk`; provider-error classification, live context guards, retry attempt caps, recovery sidecars, bounded planner diagnostics, and artifact success gates belong to downstream modules.

## Scope

### In Scope

- Add engine-only `CompilePreflightOptions` and `CompilePromptSourceBundle` definitions.
- Implement `buildCompilePromptSourceBundle(strippedSource, options)` for generated inventory, machine-readable sidecar, and large code-fence compaction.
- Implement `estimateCompilePreflightRisk(bundle, options)` using deterministic score contributions for bytes, acceptance criteria, inventory/sidecar evidence, subsystem breadth, selected profile, and pipeline scope.
- Emit a `planning:preflight` event in `EforgeEngine.compile` after visible source normalization and before worktree creation / composer execution.
- Store full source, compact prompt source, preflight options, preflight risk, and compaction metadata on `PipelineContext`.
- Pass compacted source content into `composePipeline`, `runPlanner`, and `runModulePlanner` prompts while retaining existing raw-source fields for tracing, labels, artifact validation, and downstream repair modules.
- Enrich `ctx.compilePreflight` after `planning:pipeline` when the composer-selected scope becomes known.
- Append a compact preflight advisory prompt section only for elevated/overflow-risk or compacted sources.
- Add unit tests for risk scoring, AC counting, inventory compaction, explicit full-content allow-lists, subsystem breadth, profile/scope signals, and unchanged small PRDs.
- Add stub compile tests proving composer/planner prompt compaction and unchanged prompt detail for small PRDs.

### Out of Scope

- Defining client event schemas, terminal subtypes, or recovery option wire unions; `foundation-contracts` owns those.
- Formatting bounded planner tool validation diagnostics; `planner-guardrails` owns that helper and submission-tool integration.
- Proactive live context-budget stopping and usage-event observation; `planner-guardrails` owns that behavior.
- Classifying provider context-window/context-length errors and constructing `planning:scope-context:failure`; `context-recovery` owns that behavior.
- Automatic retry-as-expedition, attempt-cap metadata mutation, recovery sidecars, and decomposition routing; `context-recovery` owns those decisions.
- Validating persisted `orchestration.yaml` and plan files before success; `artifact-validation` owns the final success gate.
- CLI, Console, Pi, or Claude plugin rendering changes; `surfaces-docs` owns rendering if new user-facing output is needed.
- Broad source summarization of ordinary prose. This module compacts detected generated/machine-readable bulk; it only scores risk for large human-authored prose.

## Implementation Approach

### Overview

Create a focused engine helper module under `packages/engine/src/compile-resilience/` that analyzes the visible stripped PRD source, builds a prompt-safe source bundle, and estimates risk using client-owned compile-resilience types from `foundation-contracts`.

`EforgeEngine.compile` will continue resolving `sourceContent` with `stripAcceptanceCriteriaInventoryBlock`. Immediately after that, it will build the prompt bundle and risk result, emit `planning:preflight`, and later place those values into `PipelineContext`. The compile stages will consume `ctx.promptSourceContent ?? ctx.sourceContent` when invoking the pipeline composer, planner, and module planner. The original `ctx.sourceContent` remains unchanged for traceability and downstream modules.

Risk scoring and compaction stay deterministic. The implementation must not call an LLM, run tokenizers, inspect provider limits, or search the repository. It may parse markdown structure, count bytes with `Buffer.byteLength`, use existing acceptance-criteria extraction helpers, hash content with SHA-256, and derive likely subsystem breadth from headings/path mentions.

### Key Decisions

1. **Use one public helper file with small pure functions.**  
   Add `packages/engine/src/compile-resilience/preflight.ts` with exported types, constants, `buildCompilePromptSourceBundle`, `estimateCompilePreflightRisk`, `formatCompilePreflightPromptAppend`, and small helpers. If the implementation exceeds 300 lines, add durable semantic region markers such as `// --- eforge:region compile-preflight-types ---` / `// --- eforge:endregion compile-preflight-types ---` to satisfy the large-file policy.

2. **Keep full source and prompt source as separate fields.**  
   `PipelineContext.sourceContent` remains the full visible stripped source. `PipelineContext.promptSourceContent` carries the compact prompt text. This prevents compaction from changing artifact validation, traceability, repair evidence, or future recovery logic.

3. **Emit preflight before worktree creation but enrich after pipeline selection.**  
   The initial `planning:preflight` event has `pipelineScope` omitted because the composer has not selected a scope. After `planning:pipeline`, `compile-stages.ts` recomputes/enriches `ctx.compilePreflight` with `requestedPipelineScope: ctx.pipeline.scope` for planner prompt guidance and downstream recovery. It does not mutate the already-emitted event.

4. **Only change prompts when the source is compacted or risk is not `normal`.**  
   Small and moderate PRDs get `promptSourceContent === sourceContent`, no preflight prompt appendix, and the existing prompt templates retain the full PRD text. This creates a direct regression assertion for normal errand/excursion inputs.

5. **Use explicit allow-lists for full generated content.**  
   `fullContentRequiredPaths` and `fullContentRequiredHeadings` default to empty arrays. Matching is case-insensitive for headings and normalized for simple relative paths. A matching block still contributes risk evidence, but it records `omittedBytes: 0` and leaves content in `promptSource`.

6. **Compact only detected generated/machine-readable bulk.**  
   The compactor targets markdown sections/code fences that have generated/inventory/sidecar hints or machine-readable fence/path metadata and exceed named byte thresholds. Large ordinary prose is scored as risk but not summarized by this module.

7. **Bound representative arrays through the client constant.**  
   Use `MAX_COMPILE_RISK_LIST_ITEMS` when building `contentHashes`, `pathReferences`, `headings`, `reasons`, `subsystems`, and `evidence`. Keep exact totals in numeric fields such as `blockCount`, `sidecarCount`, `omittedBytes`, `acceptanceCriteriaCount`, and `subsystemBreadth.count`.

8. **Use conservative thresholds with exported constants.**  
   Define constants such as `DEFAULT_MAX_PROMPT_SOURCE_BYTES`, `GENERATED_INVENTORY_MIN_BYTES`, `MACHINE_READABLE_SECTION_MIN_BYTES`, `LARGE_CODE_FENCE_MIN_BYTES`, `ELEVATED_RISK_SCORE`, and `OVERFLOW_RISK_SCORE` in the helper file. Tests must assert behavior through these constants instead of duplicated magic values.

9. **Treat recommendations as advisory data.**  
   `estimateCompilePreflightRisk` can return `retry-as-expedition`, `bounded-decomposition`, `manual-reduce-scope`, or `none`, but it must not alter `ctx.pipeline`, restart the compile, or write recovery metadata. Downstream modules decide whether to act on the recommendation.

### Helper Contract

The helper module should expose the architecture contract plus implementation constants:

```ts
// --- eforge:region plan-02-preflight-compaction ---
export interface CompilePreflightOptions {
  selectedProfile?: string | null;
  requestedPipelineScope?: 'errand' | 'excursion' | 'expedition' | null;
  fullContentRequiredPaths?: string[];
  fullContentRequiredHeadings?: string[];
  maxPromptSourceBytes?: number;
}

export interface CompilePromptSourceBundle {
  originalBytes: number;
  promptSource: string;
  promptSourceBytes: number;
  sourceHash: string;
  compactions: Array<{
    kind: 'generated-inventory' | 'machine-readable-sidecar' | 'large-code-fence';
    heading?: string;
    path?: string;
    originalBytes: number;
    contentHash: string;
    itemCount?: number;
    preservedSummary: string;
  }>;
}

export function buildCompilePromptSourceBundle(
  strippedSource: string,
  options?: CompilePreflightOptions,
): CompilePromptSourceBundle;

export function estimateCompilePreflightRisk(
  bundle: CompilePromptSourceBundle,
  options?: CompilePreflightOptions,
): CompilePreflightRisk;

export function formatCompilePreflightPromptAppend(input: {
  risk?: CompilePreflightRisk;
  bundle?: CompilePromptSourceBundle;
}): string | undefined;
// --- eforge:endregion plan-02-preflight-compaction ---
```

The final source marker slug in code examples uses `plan-02-preflight-compaction` because this module is the second module in `index.yaml`. Builders may omit temporary plan markers in final code if edits are small and non-overlapping; if temporary markers are used, the slug must match this plan ID pattern.

### Detection and Compaction Rules

Implement deterministic detection in this order:

1. **Markdown structure pass**
   - Track heading text and depth for each section.
   - Track fenced code blocks with language/info strings.
   - Track nearby heading/path hints for code blocks.

2. **Machine-readable/generated hints**
   - Generated/inventory heading keywords: `generated`, `inventory`, `sidecar`, `machine-readable`, `extracted`, `catalog`, `index`, `file list`, `dependency graph`, `schema dump`.
   - Machine-readable fence/info/path extensions: `json`, `jsonl`, `ndjson`, `yaml`, `yml`, `toml`, `csv`, `tsv`, `lock`, plus path-looking strings ending in those extensions.
   - Eforge/generated marker comments other than the already-stripped acceptance inventory block.

3. **Compaction eligibility**
   - Generated/inventory sections over `GENERATED_INVENTORY_MIN_BYTES` compact unless a heading/path allow-list matches.
   - Machine-readable sidecar sections or fences over `MACHINE_READABLE_SECTION_MIN_BYTES` compact unless a path/heading allow-list matches.
   - Large code fences over `LARGE_CODE_FENCE_MIN_BYTES` compact only when the info string or nearby heading indicates generated/machine-readable content.

4. **Replacement text**
   - Replace the bulky block with a bounded markdown summary containing kind, heading, path reference, original byte count, SHA-256 hash, estimated item count, and compact summary lines.
   - Do not include raw lines from the omitted body beyond a bounded excerpt derived from headings, JSON keys, list counts, or first short human-readable labels.
   - Preserve surrounding markdown headings so planner prompts retain source structure.

5. **Risk evidence**
   - `generatedInventory.blockCount` counts detected generated/machine-readable blocks whether compacted or explicitly included.
   - `generatedInventory.sidecarCount` counts unique machine-readable path references.
   - `generatedInventory.omittedBytes` sums bytes omitted by compaction only.
   - `generatedInventory.contentHashes`, `pathReferences`, and `headings` use bounded representative arrays.

### Risk Scoring Rules

Implement a named-score approach that returns stable `reasons` strings for tests. The exact numeric thresholds can be tuned during implementation, but the plan requires these observable categories:

- Source/prompt bytes:
  - Add score for visible source bytes above a moderate threshold.
  - Add more score when `promptSourceBytes > maxPromptSourceBytes` after compaction.
- Acceptance criteria:
  - Count with `extractExpectedAcceptanceCriteria(strippedSource)` from `packages/engine/src/validation/acceptance-criteria.ts`.
  - Add score for many criteria, with 70+ criteria producing an overflow-risk contribution.
- Generated inventory:
  - Add score when generated/machine-readable inventory is detected.
  - Add score when omitted bytes exceed a named threshold.
- Subsystem breadth:
  - Derive unique subsystem slugs from path mentions (`packages/<name>`, `web`, `eforge-plugin`, `docs`, `test`, `scripts`, etc.) and recognized headings/terms (`engine`, `client`, `monitor`, `console`, `cli`, `plugin`, `pi`, `input`, `scopes`).
  - Add score for 4+ likely subsystems and more score for 6+.
- Selected profile:
  - Include `selectedProfile` in risk.
  - Add a conservative score contribution only for scope-like profiles that conflict with input scale, such as `errand` with elevated byte/AC/breadth signals.
- Pipeline scope:
  - Include `pipelineScope` once known.
  - If scope is `errand` or `excursion` and level is `overflow-risk`, recommend `retry-as-expedition` when breadth signals support delegated module planning.
  - If scope is already `expedition`, or if prompt bytes remain over budget after compaction without clear independent subsystems, recommend `bounded-decomposition`.

Level mapping must be deterministic:

- `normal`: score below `ELEVATED_RISK_SCORE` and prompt bytes at or under the max prompt byte threshold.
- `elevated`: score at or above `ELEVATED_RISK_SCORE` but below `OVERFLOW_RISK_SCORE`, with prompt bytes within the max threshold.
- `overflow-risk`: score at or above `OVERFLOW_RISK_SCORE`, or prompt bytes over `maxPromptSourceBytes`, or the many-AC/large-source combined threshold.

## Files

### Create

- `packages/engine/src/compile-resilience/preflight.ts` — engine-only preflight options, prompt-source bundle type, deterministic compaction, risk estimation, risk prompt appendix formatting, exported thresholds, SHA-256/byte-count helpers, bounded-list helpers, and subsystem/AC counting logic.
- `test/compile-preflight.test.ts` — unit tests for preflight estimation and compaction helper behavior.
- `test/compile-preflight-engine.test.ts` — stub compile tests for `planning:preflight` emission, composer/planner compact-source plumbing, pipeline-scope risk enrichment effects on planner prompt appendix, and unchanged small PRD prompts.

### Modify

- `packages/engine/src/eforge.ts` — after source normalization / visible stripped source construction and before merge worktree creation, build the preflight bundle/risk, emit `planning:preflight`, and carry local variables into `PipelineContext` `[region: preflight-compaction, in compile() immediately after the sourceContent resolution block and before featureBranch/worktree setup]`.
- `packages/engine/src/pipeline/types.ts` — add optional compile-preflight fields to `PipelineContext`: `promptSourceContent`, `compilePromptSourceBundle`, `compilePreflightOptions`, and `compilePreflight` `[region: preflight-compaction, after sourceContent and before mutable state fields]`.
- `packages/engine/src/pipeline/stages/compile-stages.ts` — import preflight prompt append/enrichment helpers, pass compact prompt source to composer/planner/module planner, append preflight advisory text when returned, and recompute `ctx.compilePreflight` after `planning:pipeline` with selected scope `[region: preflight-compaction, import section plus plannerStage composer options, planning:pipeline event handling, runPlannerAttempt options, and runModulePlannerAttempt options]`.
- `packages/engine/src/agents/pipeline-composer.ts` — add optional `promptSourceContent?: string` to `PipelineComposerOptions` and use it for the `{{source}}` prompt substitution while keeping `source` as the original source field `[region: preflight-compaction, PipelineComposerOptions source fields and loadPrompt variable setup]`.
- `packages/engine/src/agents/planner.ts` — add optional `promptSourceContent?: string` to `PlannerOptions` and use it in `loadPrompt('planner', { source: ... })`; do not change submission-tool validation formatting in this module `[region: preflight-compaction, PlannerOptions source fields and buildPrompt source substitution only]`.
- `packages/engine/src/agents/module-planner.ts` — add optional `promptSourceContent?: string` to `ModulePlannerOptions` and use it in `loadPrompt('module-planner', { source: ... })` `[region: preflight-compaction, ModulePlannerOptions source fields and loadPrompt source substitution]`.

## Integration Notes

- `foundation-contracts` must land first so this module can import `CompilePreflightRisk`, `CompileRecoveryAction`, `MAX_COMPILE_RISK_LIST_ITEMS`, and the `planning:preflight` event variant through `packages/engine/src/events.ts` or `@eforge-build/client`.
- Keep `compile-stages.ts` growth below its `scripts/agent-maintainability-baseline.json` ceiling of 613 lines. Push parsing/scoring logic into the new helper file rather than adding long code to the stage file.
- `eforge.ts` is over 1,000 lines; implement its changes with bounded exact edits only. Do not rewrite the full compile method.
- If any new implementation or test file exceeds 300 lines, add durable semantic region markers; keep all new implementation files at or below 600 lines and all new test files at or below 1,200 lines.
- Do not add `/api/...` route literals or daemon/console wire shape declarations in this module.
- Do not modify `eforge-plugin/` or `packages/pi-eforge/`; this module has no user-facing command behavior change.

## Testing Strategy

### Unit Tests

Add `test/compile-preflight.test.ts` covering:

- Small PRD with two acceptance criteria:
  - `promptSource` equals input.
  - `acceptanceCriteriaCount` equals 2.
  - `level` equals `normal`.
  - `recommendation.action` equals `none`.
- Oversized ordinary PRD over the source-byte threshold:
  - `sourceBytes` equals the UTF-8 byte count.
  - `reasons` contains the source-byte reason.
  - No compaction occurs when there is no generated/machine-readable evidence.
- PRD with 71 acceptance criteria:
  - `acceptanceCriteriaCount` equals 71.
  - `level` equals `overflow-risk` or the configured many-AC overflow threshold output.
  - `recommendation.action` is not `none` when `requestedPipelineScope` is `excursion`.
- Embedded generated inventory section with a large JSON fence:
  - `generatedInventory.detected` is `true`.
  - `blockCount` equals 1.
  - `omittedBytes` is greater than 0.
  - `contentHashes[0]` matches a 64-character lowercase SHA-256 hex string.
  - `headings` contains the generated inventory heading.
  - `promptSource` contains the compaction summary and does not contain a sentinel raw inventory item from the omitted body.
- Machine-readable sidecar/path references:
  - `sidecarCount` counts unique `.json`/`.yaml` path references.
  - `pathReferences` is bounded to `MAX_COMPILE_RISK_LIST_ITEMS`.
- Subsystem breadth:
  - PRD text mentioning at least `packages/engine`, `packages/client`, `packages/monitor`, `packages/console-ui`, `eforge-plugin`, and `packages/pi-eforge` yields `subsystemBreadth.count >= 4` and bounded `subsystems`/`evidence` arrays.
- Profile/scope signals:
  - `selectedProfile: 'errand'` with high byte/AC signals adds a profile reason.
  - Re-estimating with `requestedPipelineScope: 'expedition'` changes `pipelineScope` to `expedition` and yields a non-`retry-as-expedition` recommendation for already-expedition scope.
- Explicit full-content allow-lists:
  - Matching `fullContentRequiredHeadings` leaves the generated section body in `promptSource` and records `omittedBytes` as 0.
  - Matching `fullContentRequiredPaths` leaves the sidecar fence body in `promptSource` and records the path reference.
- Prompt appendix formatting:
  - Normal risk with no compactions returns `undefined`.
  - Overflow risk returns text containing level, score, source bytes, prompt bytes, AC count, recovery action, and no raw omitted sentinel.

### Integration Tests

Add `test/compile-preflight-engine.test.ts` using `StubHarness` and a real temporary git repo:

- Oversized generated-inventory compile:
  - `engine.compile()` emits `planning:preflight` before the `pipeline-composer` `agent:start` event.
  - The emitted risk has `generatedInventory.detected === true`, `omittedBytes > 0`, and bounded representative arrays.
  - `harness.prompts[0]` (pipeline composer) contains the compaction summary and does not contain the raw generated-inventory sentinel.
  - `harness.prompts[1]` (planner) contains the compaction summary and does not contain the raw generated-inventory sentinel.
- Pipeline-scope enrichment:
  - When the composer returns `scope: 'excursion'` for an overflow-risk source, the planner prompt appendix contains `retry-as-expedition` or `bounded-decomposition` based on the helper recommendation after scope enrichment.
- Small PRD regression:
  - Composer and planner prompts contain the full small PRD body text.
  - Composer and planner prompts do not contain the preflight appendix heading.
  - `promptSourceContent` behavior does not remove acceptance criteria text.
- Existing hidden acceptance-inventory behavior:
  - A queued PRD containing the hidden `eforge:acceptance-criteria-inventory` block still omits that block from composer and planner prompts after compaction plumbing.

## Verification

- [ ] `buildCompilePromptSourceBundle('# PRD\n...small...')` returns `promptSource` equal to the input string.
- [ ] `estimateCompilePreflightRisk()` returns `acceptanceCriteriaCount: 2`, `level: 'normal'`, and `recommendation.action: 'none'` for the small PRD unit fixture.
- [ ] A fixture with 71 acceptance-criteria bullets returns `acceptanceCriteriaCount: 71` and `level: 'overflow-risk'`.
- [ ] A large generated-inventory fixture returns at least one compaction entry with `kind: 'generated-inventory'`, `originalBytes > 0`, a 64-character lowercase `contentHash`, and a non-empty `preservedSummary`.
- [ ] The generated-inventory fixture's `promptSource` contains the compaction summary and does not contain the raw omitted sentinel string.
- [ ] The generated-inventory risk result has `generatedInventory.detected === true`, `blockCount >= 1`, `omittedBytes > 0`, and representative arrays with length `<= MAX_COMPILE_RISK_LIST_ITEMS`.
- [ ] A sidecar/path fixture returns `sidecarCount >= 1` and includes the sidecar path in `generatedInventory.pathReferences`.
- [ ] A broad-subsystem fixture returns `subsystemBreadth.count >= 4` and `subsystemBreadth.subsystems.length <= MAX_COMPILE_RISK_LIST_ITEMS`.
- [ ] A matching `fullContentRequiredHeadings` fixture leaves the matching generated section body in `promptSource` and records `omittedBytes === 0` for that block.
- [ ] `formatCompilePreflightPromptAppend()` returns `undefined` for a normal no-compaction risk result.
- [ ] `formatCompilePreflightPromptAppend()` returns text under 4 KiB for the oversized generated-inventory fixture and excludes the raw omitted sentinel string.
- [ ] `EforgeEngine.compile()` emits a `planning:preflight` event before the first `agent:start` event whose agent is `pipeline-composer`.
- [ ] In the oversized generated-inventory compile test, composer and planner prompts exclude the raw generated-inventory sentinel string.
- [ ] In the oversized generated-inventory compile test, composer and planner prompts include the generated inventory content hash.
- [ ] In the small PRD compile test, composer and planner prompts contain the full acceptance-criteria bullet text.
- [ ] In the small PRD compile test, composer and planner prompts do not contain the preflight appendix heading.
- [ ] `packages/engine/src/pipeline/stages/compile-stages.ts` remains at or below 613 lines.
- [ ] New implementation files remain at or below 600 lines.
- [ ] New test files remain at or below 1,200 lines.
- [ ] `pnpm test -- test/compile-preflight.test.ts test/compile-preflight-engine.test.ts` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.

<build-config>
{
  "build": ["implement", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "auto",
    "perspectives": ["code", "test"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
