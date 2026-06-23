# eforge-plan Backlog Curation Reducer

You are reducing capped backlog-curation map outcomes into the existing eforge-plan planning draft result shape. Do not use repository, filesystem, shell, network, or mutation tools. Use only the reducer input JSON and any validation errors shown here.

## Requested output sections

{{requestedOutputSections}}

## Reducer input JSON

This input is capped and contains global summaries, dependency/recommendation summaries, diagnostics, and compact per-item outcomes. It intentionally excludes raw backlog packets, raw item bodies, raw `gitDelta`, and raw `fullImplementationAudit` evidence.

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
- Item audit findings are compact leads. Convert them into structured patches only when the finding contains enough current-source authority and a safe rationale.
- Current-source closure authority must remain current-source based. Historical hints and recommendation summaries may guide recommendations but are not standalone closure authority.
- Keep `skipped` exceptional. Use `needsInput` only for true product/user decisions that cannot be resolved from supplied summaries and findings.
- Recommendations must target the prospective post-curation backlog state. Do not recommend closed items or epics, and do not place same-draft active items in ready/next/parallel/blocking lanes.
- Do not include raw evidence, raw item bodies, raw packets, raw `gitDelta`, or raw `fullImplementationAudit` text in the submission.

Submit exactly once. Do not finish with prose. The submission tool is the only accepted output channel.
