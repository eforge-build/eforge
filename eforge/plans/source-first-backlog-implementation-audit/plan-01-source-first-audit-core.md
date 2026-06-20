---
id: plan-01-source-first-audit-core
name: Source-First Audit Core and Validation
branch: source-first-backlog-implementation-audit/plan-01-source-first-audit-core
agents:
  builder:
    effort: high
    rationale: This plan changes curation trust semantics, source assembly,
      concurrency control, and server-side apply validation across several
      extension files.
  reviewer:
    effort: high
    rationale: Review must verify that historical evidence cannot authorize
      source-first closure and that redaction/exclusion behavior remains intact.
  tester:
    effort: high
    rationale: Tests must cover worker-pool bounds, source fingerprints, closure
      validation, and prompt contract behavior.
---

# Source-First Audit Core and Validation

## Architecture Context

`eforge-plan` already owns backlog curation source assembly, durable workflow entries, and preview/apply validation. Keep the feature in that extension/workstation layer. The daemon continues to run the existing `eforge-plan.planning-draft` task with a deferred source provider; do not add daemon routes.

Keep the stored scan-mode value `full-implementation-audit` for compatibility with existing workflow entries, but evolve its trust model to source-first. User-facing labels can call this mode “Source-first implementation audit” in the UI/doc plan.

Current source becomes the only closure authority in this mode. Git history, PR metadata, lifecycle traces, branch hints, changed paths, and session-plan traces can seed navigation hints and compact candidate paths, but they must never produce shipped or superseded patches without matching current-source citations.

## Implementation

### Overview

Add a bounded per-item source-first audit pipeline for open backlog items and wire it through source-provider inputs, source fingerprints, preview metadata, prompts, and server-side apply validation.

### Key Decisions

1. Preserve `full-implementation-audit` as the canonical stored scan mode so existing workflow entries continue to parse and retry.
2. Add `itemAuditConcurrency` as the user/action-facing concurrency input, with default `4` and maximum `8`.
3. Represent source-first item outcomes with explicit intents: `source-shipped`, `source-superseded`, `partial`, `not-found`, `no-change`, `skipped`, and `recheck-note`.
4. Use new source evidence prefixes for closure: `Shipped evidence: current source — ...` and `Superseded evidence: current source — ...`.
5. Reject full/source-first closed-status patches unless preview metadata contains matching strong current-source closure evidence for the same item and status.

## Scope

### In Scope

- Source-first audit result modeling and source assembly.
- Bounded worker-pool execution for per-item audits.
- `itemAuditConcurrency` input normalization, workflow preservation, retry/redraft propagation, and source-provider parsing.
- Source fingerprints that include source-first settings and per-item audit results.
- Preview metadata carrying source-first audit evidence, caps, concurrency, diagnostics, and historical navigation hints.
- Prompt contract updates for source-first closure authority and fail-closed behavior.
- Server-authoritative preview/apply validation for source-first closure patches.
- Targeted extension tests.

### Out of Scope

- New daemon routes.
- Team-wide backlog management or scheduling.
- Exhaustive acceptance-test execution for every backlog item.
- Workstation rendering and user docs; those are handled in `plan-02-source-first-audit-ui-docs`.

## Files

### Create

- `eforge/extensions/eforge-plan/backlog-curation-source-first-audit.ts` — source-first audit types, concurrency normalization, bounded worker-pool helper, per-item outcome classification, source citation projection, and fingerprint projection.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-source-first-audit.test.ts` — worker-pool, classification, historical-hint, concurrency default/cap, and redaction/exclusion tests.

### Modify

- `eforge/extensions/eforge-plan/backlog-curation-full-audit.ts` — compose source-first item audit results into the existing full-audit packet; demote git/PR/lifecycle candidates to navigation hints; expose only current-source closure candidates for source-first closed outcomes; include settings, concurrency, caps, diagnostics, and source-first results in preview and fingerprint projection.
- `eforge/extensions/eforge-plan/backlog-curation-source.ts` — add `itemAuditConcurrency` to build options; pass it to full/source-first audit; include source-first settings/results in fingerprint; avoid feeding historical full-audit candidates into `source.shippedEvidenceCandidates` for source-first mode; preserve existing exclusions and redaction before excerpts reach the source packet. Keep this file under 600 lines by moving helper code into the new source-first module if needed.
- `eforge/extensions/eforge-plan/backlog-curation-source-provider.ts` — parse `itemAuditConcurrency`, reject invalid values, pass the normalized value to `buildBacklogCurationSource`, and persist preview metadata.
- `eforge/extensions/eforge-plan/backlog-curation-schemas.ts` — add `itemAuditConcurrency` input schema and normalization constants; extend full-audit preview schemas for source-first intents, citations, historical hints, concurrency settings, and diagnostics.
- `eforge/extensions/eforge-plan/backlog-curation-actions.ts` — include normalized `itemAuditConcurrency` in source-provider input for source-first mode; record it on curation workflow entries; include it in active-task reuse keys; omit it for delta mode.
- `eforge/extensions/eforge-plan/planning-agent-task-schemas.ts` — add optional `itemAuditConcurrency` to durable planning task workflow entries.
- `eforge/extensions/eforge-plan/planning-task-workflow-store.ts` — match curation workflow entries by normalized scan mode and normalized source-first concurrency when a source-first task is being reused.
- `eforge/extensions/eforge-plan/agent-task-actions.ts` — preserve `itemAuditConcurrency` through retry/redraft source-provider input and linked workflow entries. Keep this file under 600 lines by extracting a small curation source-provider helper if needed.
- `eforge/extensions/eforge-plan/backlog-curation-evidence-prefixes.ts` — add source-current shipped and superseded prefixes and validate status-specific prefix combinations.
- `eforge/extensions/eforge-plan/backlog-curation-apply.ts` — require source-first closed-status patches to match strong current-source preview metadata; reject git-only, PR-only, lifecycle-only, session-plan-only, and ambiguous closure metadata in source-first mode; keep preview and apply using the same validation path.
- `packages/engine/src/prompts/eforge-plan-planning-draft.md` — update backlog curation guidance so source-first current-source citations can justify closure, historical signals are navigation hints, per-item ambiguity fails closed without top-level user questions, and auditors must not claim exhaustive validation unless supplied source evidence supports that wording.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-source.test.ts` — update full-audit expectations from history-authoritative closure to source-first closure/hints, and add fingerprint/preview metadata coverage for source-first inputs/results.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts` — cover `itemAuditConcurrency` schema validation, normalization, source-provider input, workflow entry persistence, active-task reuse, and retry/redraft propagation.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts` — cover current-source shipped/superseded closure acceptance, git-only/PR-only/lifecycle-only/session-plan-only rejection, ambiguous-source rejection, and server-authoritative preview/apply parity.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts` — prevent git-only closure under source-first guidance and require current-source closure guidance.
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` — update action schema expectations for optional `itemAuditConcurrency` without exposing task results in analyze output.
- `eforge/extensions/eforge-plan/__tests__/planner-agent-task-actions.test.ts` — update retry/redraft expectations so curation source-provider input preserves scan mode and source-first concurrency.
- `eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts` and `eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts` — adjust only if schema/help contract assertions live with runtime docs strings touched in this plan.

## Implementation Details

### Audit input bounds

Each per-item audit must be assembled from bounded inputs: item title/claim, description, acceptance criteria, normalized curation scope, compact redacted current-source excerpts, and historical/git/PR/lifecycle/session/changed-path hints marked as navigation-only. Do not pass full-repo context or unredacted source. If an item lacks acceptance criteria, record that diagnostic and orient the audit from the item claim instead of widening the context.

### Source-first audit model

Add exported types similar to:

```ts
export type SourceFirstAuditIntent =
  | 'source-shipped'
  | 'source-superseded'
  | 'partial'
  | 'not-found'
  | 'no-change'
  | 'skipped'
  | 'recheck-note';
```

Each item result must include `itemId`, `intent`, `confidence`, `citations`, `historicalHints`, `diagnostics`, and a short `rationale`. Closure-capable results must include compact current-source citations showing both core implementation evidence and product-surface wiring evidence. Historical hints must carry a flag or wording such as `closureAuthority: false`.

### Worker pool

Implement a reusable bounded worker pool in the new source-first module. It must:

- Run at most the normalized `itemAuditConcurrency` item audits at the same time.
- Default to `4`.
- Reject user/action/provider input values above `8` at the schema boundary; for internal optional options, normalize missing values to `4` and clamp any already-trusted values to `8` before executing the worker pool.
- Treat invalid, zero, negative, and non-integer values as schema errors for actions/provider input and as the default for internal optional options.
- Propagate abort signals and convert per-item audit failures/timeouts into `skipped` or `recheck-note` source-first results rather than top-level planning questions.

### Source closure criteria

For `source-shipped` and `source-superseded`, require current-source citations that include:

- A compact citation for core implementation or replacement implementation.
- A compact citation showing the implementation is wired into the relevant product surface, such as an export, route/action registry, command registration, UI surface, provider registry, or package entrypoint.
- Strong confidence from current-source evidence.

If evidence is current but lacks product-surface wiring, classify the item as `partial`. If evidence is only tests/docs, classify as `partial` or `recheck-note`, not closed. If only history/lifecycle/PR evidence exists, classify as `not-found`, `no-change`, or `recheck-note` with historical hints.

### Apply validation

Update validation so source-first closure patches pass only when:

- The scan mode resolves to `full-implementation-audit`.
- The patch is an item patch.
- The target status is `shipped` or `superseded`.
- Patch evidence uses the matching current-source prefix.
- Preview metadata contains a matching source-first closure candidate for that item and status.
- The draft evidence cites at least one path/citation/excerpt from that metadata.

Keep existing delta validation for lifecycle/git/PR evidence unchanged outside source-first mode.

## Verification

- [ ] `AnalyzeAllBacklogInputSchema` accepts `itemAuditConcurrency: 1`, `4`, and `8`; rejects `0`, negative values, non-integers, and values above the chosen maximum.
- [ ] `analyze-all-backlog` sends `{ scanMode: 'full-implementation-audit', itemAuditConcurrency: 4 }` to the source provider by default when source-first mode is selected.
- [ ] Retry and redraft curation tasks preserve `itemAuditConcurrency` in the workflow entry and deferred source-provider input.
- [ ] The bounded worker-pool test records a maximum active audit count no greater than the configured concurrency.
- [ ] The default source-first worker-pool concurrency is `4`.
- [ ] Per-item audit inputs include item claim/description, acceptance criteria when present, navigation-only historical hints, and compact redacted current-source excerpts rather than full-repo context.
- [ ] A fixture repository with current implementation and product-surface wiring produces a `source-shipped` result with current-source citations.
- [ ] A fixture repository with strong git/PR evidence and no current implementation does not produce a shipped or superseded source-first closure candidate.
- [ ] Ambiguous and partial fixtures produce `partial`, `not-found`, `skipped`, `no-change`, or `recheck-note` item results and do not require top-level planner `needs-input`.
- [ ] Source fingerprints change when source-first concurrency, source-first inputs, or source-first per-item results change.
- [ ] Preview metadata includes source-first item results, evidence citations, caps, concurrency settings, and diagnostics.
- [ ] Source-first shipped patches with matching current-source metadata pass preview and apply validation.
- [ ] Source-first shipped patches with only git, PR, lifecycle, or session-plan evidence fail preview and apply validation before any backlog write.
- [ ] Secret-like paths and excluded directories remain absent from current-source excerpts, and secret-looking values remain redacted.
- [ ] No new daemon route is added.