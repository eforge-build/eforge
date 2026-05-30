import { describe, expect, it } from 'vitest';
import { extractPrdTitle, parseFrontmatterFields } from '@/lib/plan-content';

describe('plan-content helpers', () => {
  it('extracts PRD titles from delimiter-less metadata blocks', () => {
    expect(extractPrdTitle('title: Recoverable Validation Provider Failures\ncreated: 2026-05-30\n\n# Body')).toBe(
      'Recoverable Validation Provider Failures',
    );
  });

  it('extracts PRD titles from YAML frontmatter', () => {
    expect(extractPrdTitle('---\ntitle: "Quoted PRD"\n---\n# Body')).toBe('Quoted PRD');
  });

  it('parses title fields alongside compiled plan metadata', () => {
    expect(parseFrontmatterFields('id: plan-01\nname: Implement\ntitle: Original PRD').title).toBe('Original PRD');
  });
});
