import { describe, expect, it } from 'vitest';
import { shortCommit, sortedGitDeltaDiagnostics } from './backlog-curation-git-delta-panel';

describe('backlog curation git-delta panel helpers', () => {
  it('sorts warning diagnostics before info diagnostics deterministically', () => {
    const diagnostics = sortedGitDeltaDiagnostics([
      { severity: 'info', code: 'baseline-missing', message: 'Baseline missing.' },
      { severity: 'warning', code: 'scan-cap-truncated', message: 'Scan cap hit.', commit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
      { severity: 'warning', code: 'baseline-unreachable', message: 'Baseline unreachable.', commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      { severity: 'info', code: 'baseline-invalid-sidecar', message: 'Invalid sidecar.' },
    ]);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'baseline-unreachable',
      'scan-cap-truncated',
      'baseline-invalid-sidecar',
      'baseline-missing',
    ]);
  });

  it('abbreviates commit and head hashes deterministically', () => {
    expect(shortCommit('2222222222222222222222222222222222222222')).toBe('222222222222');
    expect(shortCommit('abcdef1')).toBe('abcdef1');
    expect(shortCommit(undefined)).toBe('unknown');
  });
});
