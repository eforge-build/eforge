import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Extension tooling wiring tests were split by consumer surface.
 *
 * See extension-tooling-wiring-*.test.ts.
 */
describe('extension tooling wiring split suite placeholder', () => {
  it('points direct runs at the split wiring suites', () => {
    for (const file of [
      'test/extension-tooling-wiring-cli.test.ts',
      'test/extension-tooling-wiring-consumer-parity.test.ts',
      'test/extension-tooling-wiring-runtime-docs.test.ts',
    ]) {
      expect(existsSync(resolve(file)), file).toBe(true);
    }
  });
});
