import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('packages/engine/src/recovery/accept-success.ts', 'utf-8');

describe('accept-success static landing discipline', () => {
  it('does not construct direct raw PR publication commands in accept-success.ts', () => {
    expect(source).not.toMatch(/\['git',\s*\['push',\s*['"]origin['"]/);
    expect(source).not.toMatch(/\['gh',\s*\['pr',\s*['"]create['"]/);
    expect(source).not.toContain("['push', 'origin'");
    expect(source).not.toContain("['pr', 'create'");
  });
});
