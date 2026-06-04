import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { resolveProjectLocalStoragePath } from '@eforge-build/extension-sdk';

describe('resolveProjectLocalStoragePath', () => {
  it('resolves storage segments under the project .eforge directory', () => {
    const cwd = resolve('/tmp/project');
    expect(resolveProjectLocalStoragePath({ cwd, segments: ['session-plans'] })).toBe(
      resolve(cwd, '.eforge', 'session-plans'),
    );
  });

  it('rejects empty segment input', () => {
    expect(() => resolveProjectLocalStoragePath({ cwd: '/tmp/project', segments: [] })).toThrow();
    expect(() => resolveProjectLocalStoragePath({ cwd: '/tmp/project', segments: [''] })).toThrow();
  });

  it.each([
    [['.']],
    [['..']],
    [['../escape']],
    [['/tmp/escape']],
    [['session-plans/../../escape']],
    [['session-plans\\escape']],
    [['session-plans\0escape']],
  ])('rejects unsafe segment %j', (segments: string[]) => {
    expect(() => resolveProjectLocalStoragePath({ cwd: '/tmp/project', segments })).toThrow();
  });

  it('does not import filesystem modules', async () => {
    const source = await readFile('packages/extension-sdk/src/project-storage.ts', 'utf-8');
    expect(source).not.toMatch(/from ['"]node:fs(?:\/promises)?['"]/);
  });
});
