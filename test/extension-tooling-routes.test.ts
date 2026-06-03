import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Extension tooling daemon route tests were split by operation family.
 *
 * See extension-tooling-routes-*.test.ts.
 */
describe('extension tooling routes split suite index', () => {
  it('points direct runs at the split route suites', () => {
    for (const file of [
      'test/extension-tooling-routes-errors.test.ts',
      'test/extension-tooling-routes-list-show.test.ts',
      'test/extension-tooling-routes-package-management.test.ts',
      'test/extension-tooling-routes-scaffold-trust.test.ts',
    ]) {
      expect(existsSync(resolve(file)), file).toBe(true);
    }
  });
});
