import { describe, it, expect } from 'vitest';
import { API_ROUTES } from '@eforge-build/client';


describe('API_ROUTES', () => {
  it('exposes recover route', () => {
    expect(API_ROUTES.recover).toBe('/api/recover');
  });

  it('exposes readRecoverySidecar route', () => {
    expect(API_ROUTES.readRecoverySidecar).toBe('/api/recovery/sidecar');
  });

  it('exposes resumeEligibility route', () => { expect(API_ROUTES.resumeEligibility).toBe('/api/recover/resume-eligibility'); });
});
