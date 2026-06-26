import { describe, expect, it } from 'vitest';
import { deriveItemSectionRows, normalizeItemSectionHeading, patchItemBodySections } from '../canonical/item-body-sections.js';

describe('canonical item body section helpers', () => {
  it('normalizes documented aliases to canonical item section headings', () => {
    expect(normalizeItemSectionHeading('claim')).toBe('Claim');
    expect(normalizeItemSectionHeading('Evidence')).toBe('Evidence');
    expect(normalizeItemSectionHeading('acceptanceCriteria')).toBe('Acceptance Criteria');
    expect(normalizeItemSectionHeading('acceptance criteria')).toBe('Acceptance Criteria');
    expect(normalizeItemSectionHeading('recheck')).toBe('Recheck');
    expect(normalizeItemSectionHeading('notes')).toBe('Notes');
    expect(normalizeItemSectionHeading('Implementation Links')).toBe('Implementation Links');
  });

  it('updates the first H1 when the title changes and prepends one when missing', () => {
    expect(patchItemBodySections('# Old title\n\n## Claim\n\nKeep me.\n', { title: 'New title' }).body).toBe('# New title\n\n## Claim\n\nKeep me.\n');
    expect(patchItemBodySections('Intro without heading.\n', { title: 'Inserted title' }).body).toBe('# Inserted title\n\nIntro without heading.\n');
  });

  it('applies sections as replacements before ordered operations while preserving unrelated unknown sections byte-for-byte', () => {
    const body = '# Item\n\n## Claim\n\nOld claim.\n\n## Custom Notes\n\nKeep this exact block.\n\n## Evidence\n\nOld evidence.\n';

    const patched = patchItemBodySections(body, {
      sections: { claim: 'New claim.', evidence: 'New evidence.' },
      sectionOperations: [{ heading: 'Investigation Log', action: 'append', content: 'First log entry.' }],
    });

    expect(patched.changedSections).toEqual(['Claim', 'Evidence', 'Investigation Log']);
    expect(patched.body).toContain('## Claim\n\nNew claim.\n');
    expect(patched.body).toContain('## Evidence\n\nNew evidence.\n');
    expect(patched.body).toContain('## Custom Notes\n\nKeep this exact block.\n');
    expect(patched.body).toContain('## Investigation Log\n\nFirst log entry.\n');
  });

  it('supports append and replace operations for existing and missing sections', () => {
    const body = '# Item\n\n## Notes\n\nExisting note.\n';

    const patched = patchItemBodySections(body, {
      sectionOperations: [
        { heading: 'Notes', action: 'append', content: 'Appended note.' },
        { heading: 'Recheck', action: 'replace', content: 'Run the recheck.' },
      ],
    });

    expect(patched.body).toContain('## Notes\n\nExisting note.\n\nAppended note.\n');
    expect(patched.body).toContain('## Recheck\n\nRun the recheck.\n');
  });

  it('renders empty section replacements as present empty sections', () => {
    const patched = patchItemBodySections('# Item\n\n## Notes\n\nExisting note.\n', { sections: { notes: '' } });

    expect(patched.body).toContain('## Notes\n\n');
    expect(patched.body).not.toContain('Existing note.');
  });

  it('rejects duplicate canonical headings before rendering patches or deriving rows', () => {
    const duplicate = '# Item\n\n## Claim\n\nOne.\n\n## claim\n\nTwo.\n';

    expect(() => patchItemBodySections(duplicate, { sections: { claim: 'New.' } })).toThrow(/duplicate.*Claim/i);
    expect(() => deriveItemSectionRows(duplicate)).toThrow(/duplicate.*Claim/i);
  });

  it('rejects malformed section operation headings and actions', () => {
    expect(() => patchItemBodySections('# Item\n', { sectionOperations: [{ heading: 'Bad\nHeading', action: 'replace', content: 'x' }] })).toThrow(/heading/i);
    expect(() => patchItemBodySections('# Item\n', { sectionOperations: [{ heading: '# Bad', action: 'replace', content: 'x' }] })).toThrow(/heading/i);
    expect(() => patchItemBodySections('# Item\n', { sectionOperations: [{ heading: 'Notes', action: 'delete' as never, content: 'x' }] })).toThrow(/action/i);
  });

  it('derives canonical and unknown section rows from the final rendered body', () => {
    const rows = deriveItemSectionRows('# Item\n\n## acceptance criteria\n\n- Ship it.\n\n## Design Notes\n\nKeep unknown.\n');

    expect(rows).toEqual([
      { sectionName: 'Acceptance Criteria', content: '- Ship it.' },
      { sectionName: 'Design Notes', content: 'Keep unknown.' },
    ]);
  });
});
