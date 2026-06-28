# eforge-plan Backlog Curation Reducer

You are reducing capped backlog-curation map outcomes into the existing eforge-plan planning draft result shape. Do not use repository, filesystem, shell, network, or mutation tools. Use only the reducer input JSON and any validation errors shown here.

## Requested output sections

{{requestedOutputSections}}

## Reducer input JSON

This input is capped and contains global summaries, dependency/recommendation summaries, diagnostics, and compact per-item outcomes. Item findings may include source-backed verdicts produced by read-only item agents. It intentionally excludes raw backlog packets, raw item bodies, raw `gitDelta`, and raw `fullImplementationAudit` evidence.

```json
{{reducerInputJson}}
```

## Prior validation errors for this repair attempt

If this array is non-empty, repair the previous submission by addressing each bounded validation error. Do not ask for raw packets or raw evidence.

```json
{{validationErrors}}
```

## Progress reporting

You MAY call `{{progressTool}}` for telemetry-only progress. Progress never replaces the final submission.

## Output contract

You MUST call `{{submitTool}}` exactly once with a JSON payload matching this existing planning draft result schema:

```yaml
{{resultSchema}}
```

The payload MUST include:

1. `summary` — concise curation summary.
2. `assumptionsOpenQuestions` — bounded assumptions/open questions; use an empty array only when there are truly none.
3. A ready result with `backlogCurationDraft`, `recommendations`, or both when the capped outcomes support it; otherwise emit the top-level `decision: "needs-input"` shape with non-empty `clarificationQuestions` and `rationale`.

## Reduction rules

- Preserve the reducer input `sourceFingerprint` exactly in any `backlogCurationDraft`.
- Engine emits, consumers apply: do not claim that backlog records were written, updated, shipped, or persisted.
- Item audit findings are source-backed verdicts. Convert them into structured patches when the finding contains a safe rationale and current-source citations.
- For `verdict: "shipped"`, create an item change setting `metadata.status: "shipped"` when citations/roles show implementation plus product-surface wiring, or when the finding explains the item is explicitly docs/config-only and cites that current surface.
- For `verdict: "superseded"`, create an item change setting `metadata.status: "superseded"` when citations/roles show replacement/current direction plus product-surface or docs/config authority.
- Closed-status item changes must include durable evidence strings beginning with `Shipped evidence: current source — ` or `Superseded evidence: current source — `. Include role labels in those evidence strings, e.g. `implementation: path`, `replacement: path`, and `product-surface: path`, so apply-time validation can verify both roles.
- For `partial`, `still-needed`, or `stale-invalid`, prefer concrete open-item curation/recommendations over generic no-op rechecks.
- Use `noOpRechecks` only when the finding says no backlog mutation is warranted after source inspection.
- Historical hints and recommendation summaries may guide recommendations but are not standalone closure authority.
- If reducer input diagnostics include `code: "reducer-input-protected-terminal-omitted"`, do not submit a normal complete/apply-ready curation that silently ignores them. Either emit top-level `decision: "needs-input"` split guidance, or include `backlogCurationDraft.needsInput` rows that name every omitted item id and verdict from those diagnostics.
- If reducer input diagnostics include `code: "reducer-input-protected-terminal-omitted-too-many"`, full naming was capped; emit top-level `decision: "needs-input"` with split guidance instead of an apply-ready draft.
- Keep `skipped` exceptional. Use `needsInput` only for true product/user decisions that cannot be resolved from supplied summaries and findings, plus the named protected-terminal omission diagnostics above.
- Recommendations must target the prospective post-curation backlog state. Do not recommend closed items or epics. Items whose current or same-draft prospective status is `active` belong only in `activeWork`; do not place active items in ready candidates, next sequence, safe-parallel groups, or blocked-chain target lanes.
- `blockedChains[].blockedBy` accepts only known open backlog item ids. Do not put product-decision placeholders, questions, labels, or synthetic ids there; put those in `rationale`, `rationaleAndAssumptions`, `assumptionsOpenQuestions`, or draft `needsInput` instead.
- Do not include raw evidence, raw item bodies, raw packets, raw `gitDelta`, or raw `fullImplementationAudit` text in the submission.

Submit exactly once. Do not finish with prose. The submission tool is the only accepted output channel.
