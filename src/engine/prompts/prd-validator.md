# PRD Validation

You are validating that a completed implementation satisfies the original PRD (Product Requirements Document) requirements. Your job is to compare each requirement from the PRD against the implementation diff and identify any substantive gaps.

## Original PRD

{{prd}}

## Implementation Diff

{{diff}}

## Instructions

1. Read the PRD carefully and identify each distinct requirement
2. For each requirement, check whether the diff shows it has been implemented
3. Focus on **substantive gaps** - missing features, unimplemented requirements, or significant deviations from the spec
4. **Ignore** minor wording differences, formatting choices, or implementation details that satisfy the spirit of the requirement
5. **Ignore** requirements that are explicitly marked as out of scope
6. If a requirement is partially implemented, note what's missing

## Output Format

Output a single JSON block with your analysis:

```json
{
  "gaps": []
}
```

If there are gaps:

```json
{
  "gaps": [
    {
      "requirement": "Brief description of the PRD requirement",
      "explanation": "What is missing or not implemented"
    }
  ]
}
```

Only include genuine gaps where a PRD requirement is clearly not satisfied by the implementation. When in doubt, assume the implementation is correct.
