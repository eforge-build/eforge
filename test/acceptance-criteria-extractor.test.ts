import { describe, it, expect } from 'vitest';
import {
  extractExpectedAcceptanceCriteria,
  normalizeCriterionText,
  matchVerdictsToExpected,
  synthesizeMissingVerdicts,
  analyzeAcceptanceCriteriaItem,
} from '@eforge-build/engine/validation/acceptance-criteria';

// ---------------------------------------------------------------------------
// normalizeCriterionText
// ---------------------------------------------------------------------------

describe('normalizeCriterionText', () => {
  it('strips leading dash bullet', () => {
    expect(normalizeCriterionText('- Add login')).toBe('Add login');
  });

  it('strips leading asterisk bullet', () => {
    expect(normalizeCriterionText('* Add login')).toBe('Add login');
  });

  it('strips leading ordered marker', () => {
    expect(normalizeCriterionText('1. Add login')).toBe('Add login');
  });

  it('strips leading ordered marker with closing paren', () => {
    expect(normalizeCriterionText('2) Add login')).toBe('Add login');
  });

  it('strips leading open-checkbox marker', () => {
    expect(normalizeCriterionText('[ ] Add login')).toBe('Add login');
  });

  it('strips leading checked-checkbox marker (lowercase x)', () => {
    expect(normalizeCriterionText('[x] Add login')).toBe('Add login');
  });

  it('strips leading checked-checkbox marker (uppercase X)', () => {
    expect(normalizeCriterionText('[X] Add login')).toBe('Add login');
  });

  it('strips combined bullet + checkbox', () => {
    expect(normalizeCriterionText('- [ ] Add login')).toBe('Add login');
  });

  it('normalizes "- Add login", "1. Add login", and "[ ] Add login" to the same text', () => {
    const a = normalizeCriterionText('- Add login');
    const b = normalizeCriterionText('1. Add login');
    const c = normalizeCriterionText('[ ] Add login');
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('collapses internal whitespace', () => {
    expect(normalizeCriterionText('-  Add   login  ')).toBe('Add login');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeCriterionText('  Add login  ')).toBe('Add login');
  });
});

// ---------------------------------------------------------------------------
// extractExpectedAcceptanceCriteria — explicit AC section
// ---------------------------------------------------------------------------

describe('extractExpectedAcceptanceCriteria — explicit AC section', () => {
  it('returns two criteria with IDs ac-001 and ac-002 for a PRD with two bullet items under ## Acceptance Criteria', () => {
    const body = `
## Overview

Some overview.

## Acceptance Criteria

- Add login page
- Support OAuth

## Out of Scope

Something else.
`.trim();

    const criteria = extractExpectedAcceptanceCriteria(body);
    expect(criteria).toHaveLength(2);
    expect(criteria[0].id).toBe('ac-001');
    expect(criteria[0].text).toBe('Add login page');
    expect(criteria[1].id).toBe('ac-002');
    expect(criteria[1].text).toBe('Support OAuth');
  });

  it('matches "Acceptance criteria" (lowercase c) heading', () => {
    const body = `
## Acceptance criteria

- Add login page
`.trim();
    const criteria = extractExpectedAcceptanceCriteria(body);
    expect(criteria).toHaveLength(1);
    expect(criteria[0].text).toBe('Add login page');
  });

  it('matches "ACs" heading', () => {
    const body = `
## ACs

- Add login page
- Support OAuth
`.trim();
    const criteria = extractExpectedAcceptanceCriteria(body);
    expect(criteria).toHaveLength(2);
    expect(criteria[0].id).toBe('ac-001');
    expect(criteria[1].id).toBe('ac-002');
  });

  it('stops at next heading of equal depth', () => {
    const body = `
## Acceptance Criteria

- Criterion one
- Criterion two

## Implementation

Other content.
`.trim();
    const criteria = extractExpectedAcceptanceCriteria(body);
    expect(criteria).toHaveLength(2);
    expect(criteria.map((c) => c.text)).toEqual(['Criterion one', 'Criterion two']);
  });

  it('keeps list items after a nested subheading inside the Acceptance Criteria section', () => {
    const body = `
## Acceptance Criteria

- Top-level criterion

### Sub-category

- Nested criterion
`.trim();
    const criteria = extractExpectedAcceptanceCriteria(body);
    expect(criteria).toHaveLength(2);
    expect(criteria[0].text).toBe('Top-level criterion');
    expect(criteria[1].text).toBe('Nested criterion');
  });

  it('stops at next heading of higher depth (shallower section)', () => {
    const body = `
# Root

## Acceptance Criteria

- Criterion one

# Another Root

Content.
`.trim();
    const criteria = extractExpectedAcceptanceCriteria(body);
    expect(criteria).toHaveLength(1);
    expect(criteria[0].text).toBe('Criterion one');
  });

  it('handles checkbox-style criteria', () => {
    const body = `
## Acceptance Criteria

- [ ] Add login page
- [x] Support OAuth
`.trim();
    const criteria = extractExpectedAcceptanceCriteria(body);
    expect(criteria).toHaveLength(2);
    expect(criteria[0].text).toBe('Add login page');
    expect(criteria[1].text).toBe('Support OAuth');
  });

  it('handles ordered-list criteria', () => {
    const body = `
## Acceptance Criteria

1. Add login page
2. Support OAuth
`.trim();
    const criteria = extractExpectedAcceptanceCriteria(body);
    expect(criteria).toHaveLength(2);
    expect(criteria[0].text).toBe('Add login page');
    expect(criteria[1].text).toBe('Support OAuth');
  });

  it('preserves raw text alongside normalized text', () => {
    const body = `
## Acceptance Criteria

- [ ] Add login page
`.trim();
    const criteria = extractExpectedAcceptanceCriteria(body);
    expect(criteria[0].raw).toBe('- [ ] Add login page');
    expect(criteria[0].text).toBe('Add login page');
  });
});

// ---------------------------------------------------------------------------
// extractExpectedAcceptanceCriteria — blank/placeholder rejection
// ---------------------------------------------------------------------------

describe('extractExpectedAcceptanceCriteria — placeholder rejection', () => {
  it('does not create a criterion for a blank line', () => {
    const body = `
## Acceptance Criteria

- Valid criterion

`.trim();
    const criteria = extractExpectedAcceptanceCriteria(body);
    expect(criteria).toHaveLength(1);
  });

  it('does not create a criterion for a line containing only "TBD"', () => {
    const body = `
## Acceptance Criteria

- TBD
- Valid criterion
`.trim();
    const criteria = extractExpectedAcceptanceCriteria(body);
    expect(criteria).toHaveLength(1);
    expect(criteria[0].text).toBe('Valid criterion');
  });

  it('does not create a criterion for a line containing only "N/A"', () => {
    const body = `
## Acceptance Criteria

- N/A
- Valid criterion
`.trim();
    const criteria = extractExpectedAcceptanceCriteria(body);
    expect(criteria).toHaveLength(1);
    expect(criteria[0].text).toBe('Valid criterion');
  });

  it('does not create a criterion for a line containing only "none"', () => {
    const body = `
## Acceptance Criteria

- none
`.trim();
    const criteria = extractExpectedAcceptanceCriteria(body);
    expect(criteria).toHaveLength(0);
  });

  it('does not create a criterion for a standalone dash', () => {
    const body = `
## Acceptance Criteria

-
- Valid criterion
`.trim();
    const criteria = extractExpectedAcceptanceCriteria(body);
    expect(criteria).toHaveLength(1);
    expect(criteria[0].text).toBe('Valid criterion');
  });

  it('returns empty array for section with only placeholder lines', () => {
    const body = `
## Acceptance Criteria

- TBD
- N/A
`.trim();
    const criteria = extractExpectedAcceptanceCriteria(body);
    expect(criteria).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// extractExpectedAcceptanceCriteria — no explicit AC section (fallback)
// ---------------------------------------------------------------------------

describe('extractExpectedAcceptanceCriteria — fallback to Verification / Scope', () => {
  it('returns empty array when no AC section and no fallback sections exist', () => {
    const body = `
## Overview

Some overview text.
`.trim();
    const criteria = extractExpectedAcceptanceCriteria(body);
    expect(criteria).toHaveLength(0);
  });

  it('extracts checklist items from ## Verification as fallback', () => {
    const body = `
## Overview

Some overview text.

## Verification

- [ ] Type checking passes
- [ ] Build succeeds
`.trim();
    const criteria = extractExpectedAcceptanceCriteria(body, { allowFallbackSections: true });
    expect(criteria).toHaveLength(2);
    expect(criteria[0].id).toBe('ac-001');
    expect(criteria[0].text).toBe('Type checking passes');
    expect(criteria[1].id).toBe('ac-002');
    expect(criteria[1].text).toBe('Build succeeds');
  });

  it('skips non-list lines in fallback Verification section', () => {
    const body = `
## Verification

Run the following:

- [ ] Type checking passes

Some prose note.
`.trim();
    const criteria = extractExpectedAcceptanceCriteria(body, { allowFallbackSections: true });
    expect(criteria).toHaveLength(1);
    expect(criteria[0].text).toBe('Type checking passes');
  });

  it('extracts bullet items from ## Scope as fallback', () => {
    const body = `
## Scope

- Add login page
- Support OAuth
`.trim();
    const criteria = extractExpectedAcceptanceCriteria(body, { allowFallbackSections: true });
    expect(criteria).toHaveLength(2);
  });

  it('aggregates criteria from both ## Scope and ## Verification in document order', () => {
    const body = `
## Scope

- Add login page
- Support OAuth

## Verification

- [ ] Type checking passes
`.trim();
    const criteria = extractExpectedAcceptanceCriteria(body, { allowFallbackSections: true });
    expect(criteria).toHaveLength(3);
    expect(criteria[0]).toMatchObject({ id: 'ac-001', text: 'Add login page' });
    expect(criteria[1]).toMatchObject({ id: 'ac-002', text: 'Support OAuth' });
    expect(criteria[2]).toMatchObject({ id: 'ac-003', text: 'Type checking passes' });
  });

  it('does not collect bullets from an Out of Scope subsection inside ## Scope', () => {
    const body = `
## Scope

### In Scope

- Implement login page
- Support OAuth

### Out of Scope

- Native mobile app
- Billing integration
`.trim();
    const criteria = extractExpectedAcceptanceCriteria(body, { allowFallbackSections: true });
    expect(criteria).toHaveLength(2);
    expect(criteria.map((c) => c.text)).toEqual(['Implement login page', 'Support OAuth']);
  });

  it('collects bullets from In Scope but skips Out of Scope in the same ## Scope section', () => {
    const body = `
## Scope

- Top-level scope item

### Out of Scope

- Excluded item

### In Scope

- Included item
`.trim();
    const criteria = extractExpectedAcceptanceCriteria(body, { allowFallbackSections: true });
    // Top-level and In Scope bullets included; Out of Scope bullets excluded
    expect(criteria.map((c) => c.text)).toContain('Top-level scope item');
    expect(criteria.map((c) => c.text)).toContain('Included item');
    expect(criteria.map((c) => c.text)).not.toContain('Excluded item');
  });

  it('prefers explicit AC section over fallback even when both are present', () => {
    const body = `
## Acceptance Criteria

- Real criterion

## Verification

- [ ] Type checking passes
`.trim();
    const criteria = extractExpectedAcceptanceCriteria(body);
    // Should only return from AC section, not from Verification
    expect(criteria).toHaveLength(1);
    expect(criteria[0].text).toBe('Real criterion');
  });
});

// ---------------------------------------------------------------------------
// extractExpectedAcceptanceCriteria — grouped parent bullets
// ---------------------------------------------------------------------------

describe('extractExpectedAcceptanceCriteria — grouped parent bullets', () => {
  it('extracts leaf items from an AC section containing grouping-label parent bullets', () => {
    // The extractor uses listItemsOnly=true so it extracts any list item.
    // Grouping labels (ending in ":") are included in extraction — they are
    // NOT automatically rejected by the extractor, only by the quality analyzer.
    const body = `
## Acceptance Criteria

- Tests cover:
  - Engine enqueue gate
  - Session-plan readiness
- \`pnpm type-check\` exits 0.
`.trim();

    const criteria = extractExpectedAcceptanceCriteria(body);
    // Extractor collects all list items including the grouping label
    // (filtering is done by the quality gate, not the extractor)
    expect(criteria.length).toBeGreaterThan(0);
    // The "`pnpm type-check` exits 0." item should be present
    const concreteItem = criteria.find((c) => c.text.includes('`pnpm type-check` exits 0'));
    expect(concreteItem).toBeDefined();
  });

  it('reports grouping-label diagnostic for "Tests cover:" via the quality analyzer', () => {
    const d = analyzeAcceptanceCriteriaItem('- Tests cover:');
    expect(d).not.toBeNull();
    expect(d!.kind).toBe('grouping-label');
  });

  it('reports grouping-label diagnostic for "Targeted validation passes:" via the quality analyzer', () => {
    const d = analyzeAcceptanceCriteriaItem('- Targeted validation passes:');
    expect(d).not.toBeNull();
    expect(d!.kind).toBe('grouping-label');
  });
});

// ---------------------------------------------------------------------------
// matchVerdictsToExpected
// ---------------------------------------------------------------------------

describe('matchVerdictsToExpected', () => {
  it('matches verdict to expected criterion by normalized text', () => {
    const expected = extractExpectedAcceptanceCriteria(`
## Acceptance Criteria

- [ ] Add login page
`.trim());
    const verdicts = [
      { criterion: '- Add login page', verdict: 'pass' as const, evidence: 'Login page implemented.' },
    ];
    const matched = matchVerdictsToExpected(expected, verdicts);
    expect(matched.get('ac-001')).toEqual(verdicts[0]);
  });

  it('matches verdict to expected criterion by criterion ID', () => {
    const expected = extractExpectedAcceptanceCriteria(`
## Acceptance Criteria

- Add login page
- Support OAuth
`.trim());
    // Validator returns criterion field set to the stable ID rather than the text
    const verdicts = [
      { criterion: 'ac-001', verdict: 'pass' as const, evidence: 'Login page implemented.' },
      { criterion: 'ac-002', verdict: 'fail' as const, evidence: 'OAuth not implemented.' },
    ];
    const matched = matchVerdictsToExpected(expected, verdicts);
    expect(matched.get('ac-001')).toEqual(verdicts[0]);
    expect(matched.get('ac-002')).toEqual(verdicts[1]);
  });

  it('returns undefined for unmatched expected criteria', () => {
    const expected = extractExpectedAcceptanceCriteria(`
## Acceptance Criteria

- Add login page
- Support OAuth
`.trim());
    const verdicts = [
      { criterion: 'Add login page', verdict: 'pass' as const, evidence: 'Done.' },
    ];
    const matched = matchVerdictsToExpected(expected, verdicts);
    expect(matched.size).toBe(expected.length);
    expect(matched.get('ac-001')).toBeDefined();
    expect(matched.has('ac-002')).toBe(true);
    expect(matched.get('ac-002')).toBeUndefined();
  });

  it('handles empty verdicts list', () => {
    const expected = extractExpectedAcceptanceCriteria(`
## Acceptance Criteria

- Add login page
`.trim());
    const matched = matchVerdictsToExpected(expected, []);
    expect(matched.size).toBe(expected.length);
    expect(matched.has('ac-001')).toBe(true);
    expect(matched.get('ac-001')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// synthesizeMissingVerdicts
// ---------------------------------------------------------------------------

describe('synthesizeMissingVerdicts', () => {
  it('synthesizes unknown verdicts for unmatched expected criteria', () => {
    const expected = extractExpectedAcceptanceCriteria(`
## Acceptance Criteria

- Add login page
- Support OAuth
`.trim());
    const verdicts = [
      { criterion: 'Add login page', verdict: 'pass' as const, evidence: 'Done.' },
    ];
    const combined = synthesizeMissingVerdicts(expected, verdicts);
    expect(combined).toHaveLength(2);
    // Original verdict is preserved first
    expect(combined[0]).toEqual(verdicts[0]);
    // Synthesized verdict for Support OAuth
    expect(combined[1].criterion).toBe('Support OAuth');
    expect(combined[1].verdict).toBe('unknown');
    expect(combined[1].evidence).toMatch(/ac-002/);
  });

  it('does not synthesize a verdict when the validator returns the criterion ID as the criterion field', () => {
    const expected = extractExpectedAcceptanceCriteria(`
## Acceptance Criteria

- Add login page
- Support OAuth
`.trim());
    // Validator uses stable IDs in the criterion field
    const verdicts = [
      { criterion: 'ac-001', verdict: 'pass' as const, evidence: 'Login page implemented.' },
      { criterion: 'ac-002', verdict: 'pass' as const, evidence: 'OAuth flow implemented.' },
    ];
    const combined = synthesizeMissingVerdicts(expected, verdicts);
    // Both criteria matched by ID — no synthesized unknowns
    expect(combined).toHaveLength(2);
    expect(combined.every((v) => v.verdict === 'pass')).toBe(true);
  });

  it('returns original verdicts unchanged when all criteria are matched', () => {
    const expected = extractExpectedAcceptanceCriteria(`
## Acceptance Criteria

- Add login page
`.trim());
    const verdicts = [
      { criterion: 'Add login page', verdict: 'pass' as const, evidence: 'Done.' },
    ];
    const combined = synthesizeMissingVerdicts(expected, verdicts);
    expect(combined).toHaveLength(1);
    expect(combined[0]).toEqual(verdicts[0]);
  });

  it('synthesizes all criteria as unknown when verdicts is empty', () => {
    const expected = extractExpectedAcceptanceCriteria(`
## Acceptance Criteria

- Add login page
- Support OAuth
`.trim());
    const combined = synthesizeMissingVerdicts(expected, []);
    expect(combined).toHaveLength(2);
    expect(combined.every((v) => v.verdict === 'unknown')).toBe(true);
  });

  it('returns empty array when both expected and verdicts are empty', () => {
    const combined = synthesizeMissingVerdicts([], []);
    expect(combined).toHaveLength(0);
  });
});
