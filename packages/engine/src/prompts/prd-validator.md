# PRD Validation

You are validating that a completed implementation satisfies the original PRD (Product Requirements Document) requirements. Your job is to compare each requirement and acceptance criterion from the PRD against the implementation diff, identify any substantive gaps, and produce a per-criterion acceptance verdict for each acceptance criterion.

## Original PRD

{{prd}}

## Expected Acceptance Criteria

{{criteria}}

When the list above is populated, you MUST produce a verdict entry in `acceptanceVerdicts` for **every** criterion listed. Do not skip or merge criteria.

{{validationEvidence}}

## Implementation Diff

{{diff}}

Some files appear with a marker of the form `[summarized: ...]` instead of a full diff, either because the individual file exceeded the per-file budget or because the total diff exceeded the global cap. The files are present in your working directory. If understanding a specific summarized file is necessary to assess PRD coverage, you may open and read it directly from the working directory; otherwise prefer the summary.

## Instructions

1. Read the PRD carefully and identify each distinct requirement and acceptance criterion
2. For each requirement, check whether the diff shows it has been implemented
3. Focus on **substantive gaps** - missing features, unimplemented requirements, or significant deviations from the spec
4. **Ignore** minor wording differences, formatting choices, or implementation details that satisfy the spirit of the requirement
5. **Ignore** requirements that are explicitly marked as out of scope
6. If a requirement is partially implemented, note what's missing
7. For each acceptance criterion (AC) in the PRD, produce a verdict:
   - `pass`: the diff clearly shows the AC is satisfied — include the specific evidence
   - `fail`: the diff clearly shows the AC is not satisfied — include what is missing
   - `unknown`: you cannot determine from the diff alone whether the AC is satisfied — explain why
8. When uncertain about an acceptance criterion, classify it as `unknown` — do not assume the implementation is correct
{{validationEvidenceInstruction}}

## Output Format

Output a single JSON block with your analysis. Include a `completionPercent` field (0-100 integer) estimating overall PRD completion, a `complexity` field per gap, and an `acceptanceVerdicts` array with one entry per acceptance criterion.

Complexity definitions:
- `trivial` - missing log line, config tweak, or minor wiring
- `moderate` - missing function, handler, or isolated feature path
- `significant` - missing subsystem or major feature path

If all requirements are satisfied:

```json
{
  "completionPercent": 100,
  "gaps": [],
  "acceptanceVerdicts": [
    {
      "criterion": "Brief text of the acceptance criterion from the PRD",
      "verdict": "pass",
      "evidence": "Specific evidence from the diff showing this criterion is satisfied"
    }
  ]
}
```

If there are gaps:

```json
{
  "completionPercent": 85,
  "gaps": [
    {
      "requirement": "Brief description of the PRD requirement",
      "explanation": "What is missing or not implemented",
      "complexity": "moderate"
    }
  ],
  "acceptanceVerdicts": [
    {
      "criterion": "Brief text of the acceptance criterion from the PRD",
      "verdict": "pass",
      "evidence": "Specific evidence from the diff showing this criterion is satisfied"
    },
    {
      "criterion": "Another acceptance criterion",
      "verdict": "fail",
      "evidence": "What is missing that prevents this criterion from being satisfied"
    },
    {
      "criterion": "A criterion that cannot be determined from the diff",
      "verdict": "unknown",
      "evidence": "Why the diff is insufficient to verify this criterion"
    }
  ]
}
```

Only include genuine gaps where a PRD requirement is clearly not satisfied by the implementation. Every acceptance criterion must have a verdict with non-empty evidence — never leave the `evidence` field blank.
