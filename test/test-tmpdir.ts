import { afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Create a temp dir factory with automatic cleanup via vitest's afterEach.
 * Call inside a describe block — registers cleanup automatically.
 *
 * @param prefix - Prefix for the temp directory name (default: 'eforge-test-')
 * @returns A function that creates a new temp directory on each call
 */
export function useTempDir(prefix = 'eforge-test-'): () => string {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  return function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  };
}
