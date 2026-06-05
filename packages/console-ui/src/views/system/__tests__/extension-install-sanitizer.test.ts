import { describe, it, expect } from 'vitest';
import type { ExtensionInstallProvenance } from '@eforge-build/client/browser';
import {
  redactSourceSpec,
  sanitizeInstallProvenance,
  REDACTED_VALUE,
} from '../extension-install-sanitizer';

describe('redactSourceSpec', () => {
  it('redacts credentials in URL userinfo', () => {
    const out = redactSourceSpec('https://user:s3cr3t-token@example.com/pkg.tgz');
    expect(out).not.toContain('s3cr3t-token');
    expect(out).toContain(REDACTED_VALUE);
    expect(out).toContain('example.com/pkg.tgz');
  });

  it('redacts token-like query parameters including presigned params', () => {
    const out = redactSourceSpec(
      'https://example.com/pkg.tgz?token=abc123&X-Amz-Signature=deadbeef&version=1.0.0',
    );
    expect(out).not.toContain('abc123');
    expect(out).not.toContain('deadbeef');
    expect(out).toContain('version=1.0.0');
  });

  it('redacts a bare token-like specifier', () => {
    expect(redactSourceSpec('npm_0123456789ABCDEFabcdef0123456789')).toBe(REDACTED_VALUE);
  });

  it('leaves ordinary npm and path specifiers untouched', () => {
    expect(redactSourceSpec('@scope/pkg@1.2.3')).toBe('@scope/pkg@1.2.3');
    expect(redactSourceSpec('./local/extension')).toBe('./local/extension');
  });
});

describe('sanitizeInstallProvenance', () => {
  it('redacts a credential-bearing URL sourceSpec while preserving other provenance', () => {
    const install: ExtensionInstallProvenance = {
      sourceKind: 'url',
      sourceSpec: 'https://deploy:p%40ss-token@registry.example.com/ext.tgz?token=leakme',
      resolvedVersion: '2.1.0',
      installedAt: '2026-01-01T00:00:00.000Z',
      targetScope: 'project',
    };

    const sanitized = sanitizeInstallProvenance(install);

    expect(sanitized.sourceSpec).not.toContain('leakme');
    expect(sanitized.sourceSpec).not.toContain('p%40ss-token');
    expect(sanitized.sourceSpec).toContain('registry.example.com/ext.tgz');
    expect(sanitized.resolvedVersion).toBe('2.1.0');
    expect(sanitized.installedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(sanitized.targetScope).toBe('project');
    // The original object is not mutated.
    expect(install.sourceSpec).toContain('leakme');
  });
});
