import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('repository hygiene', () => {
  it('does not track node_modules entries', () => {
    const stdout = execFileSync('git', ['ls-files', '*node_modules*'], {
      encoding: 'utf8',
    }).trim();

    expect(stdout).toBe('');
  });
});
