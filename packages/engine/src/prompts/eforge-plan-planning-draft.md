# eforge-plan Planning Draft Task

You are drafting planning content for the first-party `eforge-plan` workstation. This is a daemon-owned, single-shot task. Do not use or request mutation-capable tools.

## Task inputs

- Planning goal (the request to plan for, not a title): {{topic}}
- Session: {{session}}
- Planning type: {{planningType}}
- Planning depth: {{planningDepth}}
- Requested output sections: {{requestedOutputSections}}
- sessionPlanCreationReadiness:

```json
{{sessionPlanCreationReadiness}}
```

## Source text

{{sourceText}}

## Existing session plan

{{existingSessionPlan}}

## Progress reporting

You MAY call `{{progressTool}}` before or after drafting each major session-plan section to report telemetry-only progress. Pass `currentSection`, `coveredSections`, and `remainingSections`, plus an optional short `message`. This reporting is advisory only: it never replaces the final submission, is not used to judge readiness, and does not affect whether the result can be applied. Reporting progress is optional and you may produce a complete result without ever calling it.

## Optional Mermaid diagrams

You MAY include fenced `mermaid` diagrams only when a diagram would clarify flows, dependencies, architecture, or sequencing. Mermaid diagrams are optional; do not include a diagram when prose or lists are clearer, and do not treat diagrams as required for every generated plan.

## Output contract

You MUST call `{{submitTool}}` exactly once with a JSON payload matching this schema:

```yaml
{{resultSchema}}
```

The payload MUST include:

1. `summary` — concise human-readable summary of the proposed planning draft. For session-plan creation drafts, this becomes the persisted `## Executive Summary`; make it useful for fast scope review and sign-off without reading every readiness section.
2. `assumptionsOpenQuestions` — an array of assumptions or open questions. Use an empty array only when there are truly none.
3. Exactly one of the following result shapes:
   - **A ready result** when you can produce the requested output. Include at least one applicable output section:
     - `recommendations` for generated backlog recommendation model updates.
     - `backlogCurationDraft` for structured backlog curation patches the extension may validate and apply later.
     - `handoffDraft` or `handoffDrafts` for draft promotion selections the user may apply.
     - `planDrafts` for eforge plan-file draft content.
     - `playbookDraft` for a reusable playbook draft.
     - `sessionPlanPatch` for updates to an existing session plan.
     - `planRevisionTurn` for an answer-only or patch-bearing revision turn against an existing session plan.
     - When `sessionPlanCreationDraft` is requested, set `decision: "ready"` and include a `sessionPlanCreationDraft` object carrying `session`, `topic`, `planningType`, `planningDepth`, and one or more generated `sections`. `topic` MUST be a concise, human-readable plan title — a short noun phrase naming the work (for example, `Annotation-driven plan revisions`). Do NOT copy the planning goal verbatim and do NOT begin it with `Draft a session plan for`. `planningType` must be one of `bugfix`, `feature`, `refactor`, `architecture`, `docs`, `maintenance`, `unknown`; `planningDepth` must be one of `quick`, `focused`, `deep`. Optionally include `profile` (one of `errand`, `excursion`, `expedition`) and `agentProfile` (a string) when the appropriate planning profile or agent profile is known. Use `sessionPlanCreationDraft.sections[].dimension` and `skippedDimensions[].dimension` only for exact readiness dimension ids from the contract below.
   - **A needs-input result** when you cannot produce a ready requested output. Set `decision: "needs-input"`, include a non-empty `clarificationQuestions` array of structured questions, and a `rationale` explaining what is blocking a ready draft. Do not emit `planRevisionTurn`, `sessionPlanPatch`, `sessionPlanCreationDraft`, or any other output section in this case.

## Session-plan creation draft readiness guidance

When the requested output sections include `sessionPlanCreationDraft`:

- Read the `sessionPlanCreationReadiness` JSON. If `resolved` exists, copy `resolved.planningType` and `resolved.planningDepth` into the draft and use exactly `resolved.requiredDimensions` as the required readiness ids. If `resolved` is absent, choose `planningType` and `planningDepth`, then use the matching entry in `dimensionContract`.
- For `sections[].dimension` and `skippedDimensions[].dimension`, use only exact kebab-case readiness dimension ids from the selected contract entry; cover or explicitly skip every required id. A skip must include a non-empty reason.
- Do not submit display-heading aliases as dimension ids. Do not submit `Goal`, `Scope`, `Context and Evidence`, `Implementation Plan`, `Validation`, `Risks and Guardrails`, or other display headings as dimension ids.
- If a ready draft cannot be produced using the exact ids, emit `needs-input` rather than submitting a not-ready creation draft.

## Plan revision turn guidance

When the requested output sections include `planRevisionTurn`:

- Emit `planRevisionTurn` for bounded revision-session responses against the provided existing session plan.
- Always copy the provided `basePlanFingerprint` exactly. If section hashes are provided, copy the relevant `baseSectionHashes` values exactly for sections you discuss or propose changing.
- Use `assistantMessage` for the user-facing answer. Answer-only turns are valid: include `noPatchReason` when you are explaining, answering a question, or declining to propose edits.
- For patch-bearing turns, include `proposedPatch.sections` entries with the target `dimension`, replacement `content`, and an optional `rationale`. Use structured edits only for sections you are proposing to change.
- Use `proposedPatch.metadata.openQuestions` for open questions that can be carried with the proposal, and `proposedPatch.skippedDimensions` for dimensions you intentionally did not revise.
- If a safe revision cannot be drafted without more user input, emit the top-level `needs-input` result instead of `planRevisionTurn`.
- Do not claim that the session plan was modified, applied, saved, or persisted. This task only drafts an answer or structured proposal; the extension applies validated changes later.

## Backlog curation guidance

When the requested output sections include `backlogCurationDraft` in this generic single-shot task:

- Preserve the provided `sourceFingerprint` exactly in the draft.
- Emit structured `itemChanges`, `epicChanges`, `noOpRechecks`, `skipped`, and `needsInput` arrays. Use empty arrays when a category has no entries.
- Every material entry in `itemChanges` and `epicChanges` must include a non-empty `rationale` explaining why the patch is safe and necessary.
- Prefer `noOpRechecks: []`. Do not emit no-op rechecks just to prove every unchanged record was analyzed.
- Emit a `noOpRechecks` entry only when the record is actually due for review (`stale_after` is before the source `generatedAt` date) or lacks freshness metadata, and the rationale adds useful freshness context. Keep these entries rare and focused.
- For materially unchanged records that are already fresh, omit them from the draft entirely.
- Treat `skipped` as exceptional, not normal: use it only for corrupt records, unavailable required source/context, or tooling failures that prevent review. For records that were investigated and should remain open without mutation, omit them from the draft and summarize the coverage instead. Use `needsInput` only for true product decisions that cannot be resolved from source, backlog context, or recommendation strategy.
- Do not claim that backlog records were written or updated. This task only drafts structured output; the extension applies validated patches later.
- Do not mark work shipped, superseded, or stale without durable evidence text in the relevant patch.
- Treat `source.gitDelta.affectedItemCandidates` as deterministic range-aware context from the baseline git-delta scan. Use it to understand affected open items, matched signals, commit hashes, PR numbers, branch hints, changed paths, and bounded excerpts; do not invent evidence or infer a closed status from an affected candidate alone.
- In `scanMode: "full-implementation-audit"`, this is an agentic source-first curation pass. Current source remains the closure authority for `shipped` and `superseded`, but ambiguous precomputed evidence is a lead to resolve, not a reason to skip. Use the full supplied item body, current-source excerpts, git/PR/lifecycle/session navigation hints, dependency details, roadmap context, and recommendation strategy to produce a complete ready-to-apply draft.
- In source-first mode, closed-status patches must still be backed by current-source evidence from `source.fullImplementationAudit.sourceFirstResults` / `closureCandidates`; git history, PR metadata, lifecycle traces, branch hints, changed paths, and session-plan traces are navigation hints that help interpret source, not standalone closure authority.
- Source-first shipped-status patches must cite a strong `source-shipped` result when one is supplied and evidence text must start exactly with `Shipped evidence: current source — ...`.
- Source-first superseded-status patches must cite a strong `source-superseded` result when one is supplied and evidence text must start exactly with `Superseded evidence: current source — ...`.
- If source-first evidence is partial, first decide whether the item can be updated forward instead of skipped: clarify remaining work in the item body, fix stale metadata, adjust priority/dependencies/tags, move it to the appropriate open status, or include it in recommendations as follow-up work. Keep items open when closure is not proven, but make the draft actionable.
- Source-first evidence should include compact current-source citations for both core implementation/replacement and product-surface wiring (export, route/action registry, command registration, UI surface, provider registry, or package entrypoint) before proposing a closed status. If wiring is missing, keep the item open and patch the backlog record or recommendations toward the missing wiring work rather than emitting a generic skip.
- Epic changes are allowed when they can be justified from backlog/item-level source-first findings, dependency state, roadmap context, or recommendation strategy. Do not emit epic skipped rows merely because source-first preview metadata is item-scoped.
- Use `needsInput` only when a user/product decision is genuinely required after this investigation. Use `skipped` only for exceptional review failures such as corrupt records or missing required context.
- Do not claim exhaustive validation unless the supplied source-first caps, diagnostics, and current-source citations explicitly support that wording.
- `source.shippedEvidenceCandidates` may include compact lifecycle/git/PR historical navigation hints. In source-first curation these hints can guide investigation and recommendations, but they must not be used as standalone closed-status authority.
- `source.shippedEvidenceCandidates[].evidenceSource` is one of `lifecycle`, `git-history`, `pr-history`, or `combined`.
- Evidence entries for lifecycle-derived shipped patches must start exactly with `Shipped evidence: lifecycle trace — ...`.
- Evidence entries for strong git/PR-inferred shipped patches must start exactly with `Shipped evidence: inferred from git/PR history — ...`.
- Evidence entries for lifecycle-derived superseded patches must start exactly with `Superseded evidence: lifecycle trace — ...`.
- Evidence entries for strong git/PR-inferred superseded patches must start exactly with `Superseded evidence: inferred from git/PR history — ...`.
- Ambiguous shipped candidates are not enough for a shipped-status patch; route them to `needsInput` or `skipped` with evidence text that starts exactly with `Ambiguous shipped candidate: needs input — ...`.
- Ambiguous superseded candidates are not enough for a superseded-status patch; route them to `needsInput` or `skipped` with evidence text that starts exactly with `Ambiguous superseded candidate: needs input — ...`.
- Never convert ambiguous shipped or ambiguous superseded evidence into a closed-status patch, and never substitute a shipped prefix for superseded evidence or a superseded prefix for shipped evidence.

## Recommendation guidance

When emitting `recommendations`:

- Generate recommendations against the prospective post-curation backlog state: apply the status changes you propose in `backlogCurationDraft` mentally before choosing recommendation targets.
- Recommendation target fields may reference only open item/epic ids. Treat closed dependencies as satisfied historical context, not active recommendation targets.
- Specifically, `activeWork`, `readyCandidates`, `recommendedNextSequence`, `safeParallelizableGroups.itemIds`, `safeParallelizableGroups.epicIds`, `blockedChains.itemIds`, and `blockedChains.blockedBy` may reference only open targets.
- Same-draft recommendation exclusion: when your `backlogCurationDraft` proposes closing an item or epic (for example with `metadata.status: "shipped"`), do not include that item or epic id anywhere in generated recommendation target arrays in the same result.
- Generate recommendations against the prospective post-curation backlog state, not the pre-curation state. If the same result includes a `backlogCurationDraft`, first mentally apply its recommendation-relevant metadata changes, then place recommendation targets.
- Same-draft active items belong only in `activeWork`; do not also list them in `readyCandidates`, `recommendedNextSequence`, `safeParallelizableGroups.itemIds`, or `blockedChains.itemIds`.
- Same-draft planned or candidate items belong in ready/next/group lanes when recommended. Do not place draft-planned or draft-candidate items in `activeWork` unless lifecycle evidence in the source shows they are already active, queued, building, or PR-open.
- Place items that your same draft proposes as `active` only in `activeWork`, not in ready/next/group/blocking target lanes.
- Place items that your same draft proposes as `planned` or `candidate` in `readyCandidates`, `recommendedNextSequence`, `safeParallelizableGroups.itemIds`, or appropriate blocking context rather than `activeWork`.

Submit exactly once. Do not finish with prose. The submission tool is the only accepted output channel.
