You are extracting canonical acceptance criteria from a formatted PRD.

Return exactly one JSON object and no prose. Do not use tools.

Minimum confidence for each extracted criterion: {{minConfidence}}

JSON shape:

{
  "version": 1,
  "criteria": [
    {
      "text": "A flat, standalone, objectively verifiable acceptance criterion.",
      "sourceQuote": "Exact quote copied from the PRD that grounds this criterion.",
      "confidence": 0.95,
      "warnings": []
    }
  ],
  "warnings": []
}

Rules:

- Extract only true acceptance criteria: observable outcomes, command outcomes, API/file/event behavior, or validation requirements.
- Keep criteria flat. Do not emit grouping labels such as "Tests cover:".
- Do not emit bare command fragments. Convert only when the PRD states the expected outcome, for example "`pnpm type-check` exits 0".
- Do not invent criteria. Every criterion must include a `sourceQuote` copied from the PRD text.
- Prefer the most specific wording from the PRD. Preserve important file paths, command names, event names, and numeric thresholds.
- If the PRD truly contains no acceptance criteria, return `{"version":1,"criteria":[],"warnings":["No acceptance criteria found"]}`.
- Do not include `id`; deterministic validation assigns stable `ac-###` ids after validating the extraction.

PRD:

{{prd}}
