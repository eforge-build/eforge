import { describe, it, expect } from 'vitest';
import { formatBuilderParallelNotice } from '@eforge-build/engine/agents/builder';

describe('formatBuilderParallelNotice', () => {
  it('returns empty string when builder is not in a parallel group', () => {
    // No parallel groups at all
    expect(formatBuilderParallelNotice([])).toBe('');
  });

  it('returns empty string when parallel group does not contain implement', () => {
    // Parallel group exists but doesn't include 'implement'
    expect(formatBuilderParallelNotice([['review', 'doc-update']])).toBe('');
  });

  it('returns notice with parallel stage names when builder is in a parallel group', () => {
    const result = formatBuilderParallelNotice([['implement', 'doc-update']]);
    expect(result).toContain('Parallel Execution Notice');
    expect(result).toContain('`doc-update`');
    expect(result).toContain('Stay in your lane');
    expect(result).toContain('targeted');
  });

  it('lists multiple parallel stages when present', () => {
    const result = formatBuilderParallelNotice([['implement', 'doc-update', 'lint']]);
    expect(result).toContain('`doc-update`');
    expect(result).toContain('`lint`');
    // Should not list implement itself as "other"
    expect(result).not.toContain('`implement`');
  });
});
