import { describe, expect, it } from 'vitest';
import { redactGitRemote, redactSensitive } from '../projections/config-redaction.js';

describe('config redaction projections', () => {
  it('redacts nested sensitive keys and recurses through arrays', () => {
    expect(redactSensitive({ token: 'x', nested: [{ password: 'p', keep: true }] })).toEqual({ token: '[redacted]', nested: [{ password: '[redacted]', keep: true }] });
  });
  it('redacts separator and camelCase secret key variants', () => {
    expect(redactSensitive({ api_key: 'a', accessToken: 'b', refresh_token: 'c', clientSecret: 'd', privateKey: 'e', keep: true })).toEqual({ api_key: '[redacted]', accessToken: '[redacted]', refresh_token: '[redacted]', clientSecret: '[redacted]', privateKey: '[redacted]', keep: true });
  });
  it('strips URL credentials and leaves SSH remotes unchanged', () => {
    expect(redactGitRemote('https://u:p@example.com/org/repo.git')).toBe('https://example.com/org/repo.git');
    expect(redactGitRemote('git@example.com:org/repo.git')).toBe('git@example.com:org/repo.git');
  });
});
