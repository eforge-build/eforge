# eforge-plan Planning Draft Task

You are drafting planning content for the first-party `eforge-plan` workstation. This is a daemon-owned, single-shot task. Do not use or request mutation-capable tools.

## Task inputs

- Topic: {{topic}}
- Session: {{session}}
- Planning type: {{planningType}}
- Planning depth: {{planningDepth}}
- Requested output sections: {{requestedOutputSections}}

## Source text

{{sourceText}}

## Existing session plan

{{existingSessionPlan}}

## Progress reporting

You MAY call `{{progressTool}}` before or after drafting each major session-plan section to report telemetry-only progress. Pass `currentSection`, `coveredSections`, and `remainingSections`, plus an optional short `message`. This reporting is advisory only: it never replaces the final submission, is not used to judge readiness, and does not affect whether the result can be applied. Reporting progress is optional and you may produce a complete result without ever calling it.

## Output contract

You MUST call `{{submitTool}}` exactly once with a JSON payload matching this schema:

```yaml
{{resultSchema}}
```

The payload MUST include:

1. `summary` — concise human-readable summary of the proposed planning draft.
2. `assumptionsOpenQuestions` — an array of assumptions or open questions. Use an empty array only when there are truly none.
3. Exactly one of the following result shapes:
   - **A ready result** when you can produce the requested output. Include at least one applicable output section:
     - `recommendations` for generated backlog recommendation model updates.
     - `backlogCurationDraft` for structured backlog curation patches the extension may validate and apply later.
     - `handoffDraft` or `handoffDrafts` for draft promotion selections the user may apply.
     - `planDrafts` for eforge plan-file draft content.
     - `playbookDraft` for a reusable playbook draft.
     - `sessionPlanPatch` for updates to an existing session plan.
     - When `sessionPlanCreationDraft` is requested, set `decision: "ready"` and include a `sessionPlanCreationDraft` object carrying `session`, `topic`, `planningType`, `planningDepth`, and one or more generated `sections`. `planningType` must be one of `bugfix`, `feature`, `refactor`, `architecture`, `docs`, `maintenance`, `unknown`; `planningDepth` must be one of `quick`, `focused`, `deep`. Optionally include `profile` (one of `errand`, `excursion`, `expedition`) and `agentProfile` (a string) when the appropriate planning profile or agent profile is known.
   - **A needs-input result** when you cannot produce a ready session-plan creation draft. Set `decision: "needs-input"`, include a non-empty `clarificationQuestions` array of structured questions, and a `rationale` explaining what is blocking a ready draft. Do not emit a session-plan file output in this case.

## Backlog curation guidance

When the requested output sections include `backlogCurationDraft`:

- Preserve the provided `sourceFingerprint` exactly in the draft.
- Emit structured `itemChanges`, `epicChanges`, `noOpRechecks`, `skipped`, and `needsInput` arrays. Use empty arrays when a category has no entries.
- Every material entry in `itemChanges` and `epicChanges` must include a non-empty `rationale` explaining why the patch is safe and necessary.
- Prefer `noOpRechecks: []`. Do not emit no-op rechecks just to prove every unchanged record was analyzed.
- Emit a `noOpRechecks` entry only when the record is actually due for review (`stale_after` is before the source `generatedAt` date) or lacks freshness metadata, and the rationale adds useful freshness context. Keep these entries rare and focused.
- For materially unchanged records that are already fresh, omit them from the draft entirely.
- Use `skipped` for records that should not be changed for a specific reason, and `needsInput` for per-record questions that block a safe curation proposal.
- Do not claim that backlog records were written or updated. This task only drafts structured output; the extension applies validated patches later.
- Do not mark work shipped, superseded, or stale without durable evidence text in the relevant patch.
- Recommendation target fields may reference only open item/epic ids. Treat closed dependencies as satisfied historical context, not active recommendation targets.
- Specifically, `activeWork`, `readyCandidates`, `recommendedNextSequence`, `safeParallelizableGroups.itemIds`, `safeParallelizableGroups.epicIds`, `blockedChains.itemIds`, and `blockedChains.blockedBy` may reference only open targets.

Submit exactly once. Do not finish with prose. The submission tool is the only accepted output channel.
