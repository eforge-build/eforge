import { afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLEANUP_MAX_RETRIES = 5;
const CLEANUP_RETRY_DELAY_MS = 100;

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
    const dirs = tempDirs.splice(0);
    let cleanupError: unknown;

    for (const dir of dirs) {
      try {
        rmSync(dir, {
          recursive: true,
          force: true,
          maxRetries: CLEANUP_MAX_RETRIES,
          retryDelay: CLEANUP_RETRY_DELAY_MS,
        });
      } catch (err) {
        cleanupError ??= err;
      }
    }

    if (cleanupError) throw cleanupError;
  });

  return function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  };
}
