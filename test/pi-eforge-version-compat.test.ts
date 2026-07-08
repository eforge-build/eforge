import { describe, expect, it } from 'vitest';
import {
  getPiDaemonVersionMismatch,
  normalizeEforgePackageVersion,
} from '../packages/pi-eforge/extensions/eforge/version-compat.js';

describe('Pi eforge daemon version compatibility', () => {
  it('normalizes daemon build identifiers to package versions', () => {
    expect(normalizeEforgePackageVersion('0.7.21-dirty (fb323747)')).toBe('0.7.21');
    expect(normalizeEforgePackageVersion('0.7.21 (fb323747)')).toBe('0.7.21');
    expect(normalizeEforgePackageVersion('0.7.21-beta.1-dirty (fb323747)')).toBe('0.7.21-beta.1');
  });

  it('does not warn when only daemon dirty/hash metadata differs', () => {
    expect(getPiDaemonVersionMismatch('0.7.21-dirty (fb323747)', '0.7.21')).toBeUndefined();
    expect(getPiDaemonVersionMismatch('0.7.21 (fb323747)', '0.7.21')).toBeUndefined();
  });

  it('warns when daemon and Pi extension package versions differ', () => {
    expect(getPiDaemonVersionMismatch('0.7.22-dirty (fb323747)', '0.7.21')).toMatch(/package version differs/);
  });

  it('skips warnings when either side is not comparable', () => {
    expect(getPiDaemonVersionMismatch(undefined, '0.7.21')).toBeUndefined();
    expect(getPiDaemonVersionMismatch('unknown', '0.7.21')).toBeUndefined();
    expect(getPiDaemonVersionMismatch('0.7.21-dirty (fb323747)', 'unknown')).toBeUndefined();
  });
});
