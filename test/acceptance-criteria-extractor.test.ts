import { describe, it, expect } from 'vitest';
import { runAcceptanceCriteriaExtractor } from '@eforge-build/engine/agents/acceptance-criteria-extractor';
import {
  extractExpectedAcceptanceCriteria,
  normalizeCriterionText,
  normalizeCriterionMatchText,
  matchVerdictsToExpected,
  synthesizeMissingVerdicts,
  analyzeAcceptanceCriteriaItem,
} from '@eforge-build/engine/validation/acceptance-criteria';
import {
  AC_EXTRACTION_MIN_CONFIDENCE,
  appendAcceptanceCriteriaInventoryBlock,
  parseAcceptanceCriteriaExtractorOutput,
  readAcceptanceCriteriaInventoryBlock,
  requireAcceptanceCriteriaInventoryFromPrd,
  stripAcceptanceCriteriaInventoryBlock,
} from '@eforge-build/engine/validation/acceptance-criteria-inventory';
import { StubHarness } from './stub-harness.js';

const CANONICAL_SOURCE = [
  '# Feature',
  '',
  '## Acceptance Criteria',
  '',
  '- Engine emits `enqueue:complete` after writing the PRD.',
  '- `pnpm type-check` exits 0.',
].join('\n');

function validExtractorJson(): string {
  return JSON.stringify({
    version: 1,
    criteria: [
      { text: 'Engine emits `enqueue:complete` after writing the PRD.', sourceQuote: 'Engine emits `enqueue:complete` after writing the PRD.', confidence: 0.95 },
      { text: '`pnpm type-check` exits 0.', sourceQuote: '`pnpm type-check` exits 0.', confidence: 0.9 },
    ],
  });
}

// ---------------------------------------------------------------------------
// extractor agent helper
// ---------------------------------------------------------------------------

describe('runAcceptanceCriteriaExtractor', () => {
  it('uses the prd-validator role with tools disabled and yields ordinary agent events', async () => {
    const harness = new StubHarness([{ text: validExtractorJson() }]);
    const events = [];
    const gen = runAcceptanceCriteriaExtractor({ harness, cwd: process.cwd(), prdContent: CANONICAL_SOURCE, verbose: true });
    let result = await gen.next();
    while (!result.done) {
      events.push(result.value);
      result = await gen.next();
    }

    expect(result.value.criteria.map((criterion) => criterion.id)).toEqual(['ac-001', 'ac-002']);
    expect(harness.calls[0].tools).toBe('none');
    expect(events.find((event) => event.type === 'agent:start')?.agent).toBe('prd-validator');
    expect(events.map((event) => event.type)).toContain('agent:start');
    expect(events.map((event) => event.type)).toContain('agent:message');
  });

  it('falls back to accumulated messages when resultText is blank', async () => {
    const harness = new StubHarness([{ text: validExtractorJson(), resultText: '   ' }]);
    const gen = runAcceptanceCriteriaExtractor({ harness, cwd: process.cwd(), prdContent: CANONICAL_SOURCE });
    let result = await gen.next();
    while (!result.done) result = await gen.next();

    expect(result.value.criteria[0].id).toBe('ac-001');
  });

  it('fails closed when the harness emits no parseable output', async () => {
    const harness = new StubHarness([{ resultText: '' }]);
    const gen = runAcceptanceCriteriaExtractor({ harness, cwd: process.cwd(), prdContent: CANONICAL_SOURCE });
    let result = await gen.next();
    await expect(async () => {
      while (!result.done) result = await gen.next();
    }).rejects.toThrow(/produced no output/);
  });
});

// ---------------------------------------------------------------------------
// canonical structured inventory
// ---------------------------------------------------------------------------

describe('canonical acceptance criteria inventory', () => {
  it('parses valid extractor JSON and assigns stable ac ids', () => {
    const inventory = parseAcceptanceCriteriaExtractorOutput(validExtractorJson(), CANONICAL_SOURCE);
    expect(inventory.criteria.map((c) => c.id)).toEqual(['ac-001', 'ac-002']);
  });

  it('accepts source quotes grounded after whitespace normalization', () => {
    const source = [
      '# Feature',
      '',
      '## Acceptance Criteria',
      '',
      '- Engine emits `enqueue:complete` after',
      '  writing the PRD.',
    ].join('\n');
    const inventory = parseAcceptanceCriteriaExtractorOutput(JSON.stringify({
      version: 1,
      criteria: [{
        text: 'Engine emits `enqueue:complete` after writing the PRD.',
        sourceQuote: 'Engine emits `enqueue:complete` after writing the PRD.',
        confidence: 0.95,
      }],
    }), source);

    expect(inventory.criteria[0].id).toBe('ac-001');
  });

  it('rejects non-object and missing criteria extractor payloads', () => {
    expect(() => parseAcceptanceCriteriaExtractorOutput('[]', CANONICAL_SOURCE)).toThrow(/JSON object/);
    expect(() => parseAcceptanceCriteriaExtractorOutput('{"version":1}', CANONICAL_SOURCE)).toThrow(/criteria array/);
  });

  it('rejects ungrounded source quotes', () => {
    expect(() => parseAcceptanceCriteriaExtractorOutput(JSON.stringify({
      version: 1,
      criteria: [{
        text: 'Engine emits `enqueue:complete` after writing the PRD.',
        sourceQuote: 'A source quote that does not appear in the PRD.',
        confidence: 0.95,
      }],
    }), CANONICAL_SOURCE)).toThrow(/formatted PRD body/);
  });

  it('rejects empty inventories when not allowed', () => {
    expect(() => parseAcceptanceCriteriaExtractorOutput('{"version":1,"criteria":[]}', CANONICAL_SOURCE)).toThrow(/empty/i);
  });

  it('rejects criteria without a source quote', () => {
    expect(() => parseAcceptanceCriteriaExtractorOutput(JSON.stringify({ version: 1, criteria: [{ text: 'Something concrete happens.', confidence: 0.9 }] }), CANONICAL_SOURCE)).toThrow(/sourceQuote/);
  });

  it('rejects low-confidence criteria', () => {
    expect(() => parseAcceptanceCriteriaExtractorOutput(JSON.stringify({ version: 1, criteria: [{ text: 'Something concrete happens.', sourceQuote: 'Engine emits `enqueue:complete` after writing the PRD.', confidence: AC_EXTRACTION_MIN_CONFIDENCE - 0.01 }] }), CANONICAL_SOURCE)).toThrow(/confidence/);
  });

  it('rejects duplicate, grouping-label, bare-command, and vague criteria', () => {
    const cases = ['Tests cover:', '`pnpm type-check`.', 'Works correctly.'];
    for (const text of cases) {
      expect(() => parseAcceptanceCriteriaExtractorOutput(JSON.stringify({ version: 1, criteria: [{ text, sourceQuote: 'Engine emits `enqueue:complete` after writing the PRD.', confidence: 0.95 }] }), CANONICAL_SOURCE)).toThrow();
    }
    expect(() => parseAcceptanceCriteriaExtractorOutput(JSON.stringify({ version: 1, criteria: [
      { text: 'Engine emits `enqueue:complete` after writing the PRD.', sourceQuote: 'Engine emits `enqueue:complete` after writing the PRD.', confidence: 0.95 },
      { text: 'Engine emits `enqueue:complete` after writing the PRD.', sourceQuote: 'Engine emits `enqueue:complete` after writing the PRD.', confidence: 0.95 },
    ] }), CANONICAL_SOURCE)).toThrow(/duplicate/);
  });

  it('serializes, reads, and strips exactly one hidden inventory block', () => {
    const inventory = parseAcceptanceCriteriaExtractorOutput(validExtractorJson(), CANONICAL_SOURCE);
    const withBlock = appendAcceptanceCriteriaInventoryBlock(CANONICAL_SOURCE, inventory);
    expect(readAcceptanceCriteriaInventoryBlock(withBlock)).toContain('ac-001');
    expect(stripAcceptanceCriteriaInventoryBlock(withBlock)).toBe(CANONICAL_SOURCE);
    const stripped = stripAcceptanceCriteriaInventoryBlock(withBlock);
    expect(stripped).not.toContain('eforge:acceptance-criteria-inventory');
    expect(stripped).not.toContain('eforge:end-acceptance-criteria-inventory');
    expect(stripped).not.toContain('"version"');
    expect(stripped).not.toContain('"criteria"');
    expect(stripped).not.toContain('ac-001');
    expect(stripped).not.toContain('"confidence"');
    expect(requireAcceptanceCriteriaInventoryFromPrd(withBlock).criteria[1].id).toBe('ac-002');
  });

  it('does not fall back to deterministic PRD parsing when the persisted block is missing', () => {
    expect(extractExpectedAcceptanceCriteria(CANONICAL_SOURCE)).toHaveLength(2);
    expect(() => requireAcceptanceCriteriaInventoryFromPrd(CANONICAL_SOURCE)).toThrow(/re-enqueue/);
  });

  it('rejects persisted inventory grounded only by YAML frontmatter', () => {
    const frontmatterOnly = `---\ntitle: Hidden Metadata Criterion\n---\n\n${CANONICAL_SOURCE}\n\n<!-- eforge:acceptance-criteria-inventory\n${JSON.stringify({
      version: 1,
      criteria: [{ id: 'ac-001', text: 'Hidden metadata criterion is implemented by the engine.', raw: 'Hidden metadata criterion is implemented by the engine.', sourceQuote: 'Hidden Metadata Criterion', confidence: 0.95 }],
    })}\neforge:end-acceptance-criteria-inventory -->`;

    expect(() => requireAcceptanceCriteriaInventoryFromPrd(frontmatterOnly)).toThrow(/formatted PRD body.*re-enqueue|re-enqueue.*formatted PRD body/i);
  });

  it('rejects persisted inventory grounded only by its hidden JSON block', () => {
    const hiddenOnly = `${CANONICAL_SOURCE}\n\n<!-- eforge:acceptance-criteria-inventory\n${JSON.stringify({
      version: 1,
      criteria: [{ id: 'ac-001', text: 'Hidden-only criterion is completed by the engine.', raw: 'Hidden-only criterion is completed by the engine.', sourceQuote: 'Hidden-only criterion is completed by the engine.', confidence: 0.95 }],
    })}\neforge:end-acceptance-criteria-inventory -->`;

    expect(() => requireAcceptanceCriteriaInventoryFromPrd(hiddenOnly)).toThrow(/formatted PRD body.*re-enqueue|re-enqueue.*formatted PRD body/i);
  });

  it('rejects malformed, multiple, and out-of-order persisted inventory blocks with re-enqueue diagnostics', () => {
    const inventory = parseAcceptanceCriteriaExtractorOutput(validExtractorJson(), CANONICAL_SOURCE);
    const withBlock = appendAcceptanceCriteriaInventoryBlock(CANONICAL_SOURCE, inventory);
    const secondBlock = appendAcceptanceCriteriaInventoryBlock('# Other PRD', inventory);
    const malformedBlock = `${CANONICAL_SOURCE}\n\n<!-- eforge:acceptance-criteria-inventory\nnot json\neforge:end-acceptance-criteria-inventory -->`;
    const wrongIdBlock = withBlock.replace('"id":"ac-001"', '"id":"ac-999"');

    expect(() => requireAcceptanceCriteriaInventoryFromPrd(malformedBlock)).toThrow(/re-enqueue/);
    expect(() => requireAcceptanceCriteriaInventoryFromPrd(`${withBlock}\n${secondBlock}`)).toThrow(/multiple.*re-enqueue|re-enqueue.*multiple/i);
    expect(() => requireAcceptanceCriteriaInventoryFromPrd(wrongIdBlock)).toThrow(/id.*re-enqueue|re-enqueue.*id/i);
  });
});

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
// normalizeCriterionMatchText
// ---------------------------------------------------------------------------

describe('normalizeCriterionMatchText', () => {
  it('ignores harmless inline Markdown formatting for verdict matching', () => {
    expect(normalizeCriterionMatchText('- `/eforge:plan` skill guidance')).toBe('/eforge:plan skill guidance');
    expect(normalizeCriterionMatchText('**Formatter prompt** documents rules')).toBe('Formatter prompt documents rules');
    expect(normalizeCriterionMatchText('[CLI docs](docs/cli.md) mention status')).toBe('CLI docs mention status');
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

  it('matches verdict to expected criterion by ID-prefixed criterion field', () => {
    const expected = extractExpectedAcceptanceCriteria(`
## Acceptance Criteria

- Add login page
`.trim());
    const verdicts = [
      { criterion: 'ac-001: Add login page', verdict: 'pass' as const, evidence: 'Login page implemented.' },
    ];
    const matched = matchVerdictsToExpected(expected, verdicts);
    expect(matched.get('ac-001')).toEqual(verdicts[0]);
  });

  it('matches verdict text when harmless inline Markdown was dropped by the validator', () => {
    const expected = extractExpectedAcceptanceCriteria(`
## Acceptance Criteria

- \`/eforge:plan\` skill guidance constrains planned acceptance criteria to valid AC shape.
`.trim());
    const verdicts = [
      { criterion: '/eforge:plan skill guidance constrains planned acceptance criteria to valid AC shape.', verdict: 'pass' as const, evidence: 'Skill docs updated.' },
    ];
    const matched = matchVerdictsToExpected(expected, verdicts);
    expect(matched.get('ac-001')).toEqual(verdicts[0]);
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
