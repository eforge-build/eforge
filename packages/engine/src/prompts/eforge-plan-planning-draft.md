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

## Output contract

You MUST call `{{submitTool}}` exactly once with a JSON payload matching this schema:

```yaml
{{resultSchema}}
```

The payload MUST include:

1. `summary` — concise human-readable summary of the proposed planning draft.
2. `assumptionsOpenQuestions` — an array of assumptions or open questions. Use an empty array only when there are truly none.
3. At least one applicable output section:
   - `recommendations` for generated backlog recommendation model updates.
   - `handoffDraft` or `handoffDrafts` for draft promotion selections the user may apply.
   - `planDrafts` for eforge plan-file draft content.
   - `playbookDraft` for a reusable playbook draft.
   - `sessionPlanPatch` for updates to an existing session plan.

Do not finish with prose. The submission tool is the only accepted output channel.
