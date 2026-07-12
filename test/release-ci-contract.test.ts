import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('release CI contract', () => {
  it('runs the full test suite on version-bumped release PRs', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');

    expect(workflow).toContain("startsWith(github.head_ref, 'release/')");
    expect(workflow).toMatch(/startsWith\(github\.head_ref, 'release\/'\)[^\n]*\}\}\n\s+run: pnpm test/);
  });
});
