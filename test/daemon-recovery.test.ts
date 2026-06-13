import { describe, it, expect } from 'vitest';
import { API_ROUTES } from '@eforge-build/client';


describe('API_ROUTES', () => {
  it('exposes recover route', () => {
    expect(API_ROUTES.recover).toBe('/api/recover');
  });

  it('exposes readRecoverySidecar route', () => {
    expect(API_ROUTES.readRecoverySidecar).toBe('/api/recovery/sidecar');
  });

  it('exposes continueRepair route', () => { expect(API_ROUTES.continueRepair).toBe('/api/recover/continue-repair'); });
  it('exposes continueRepairEligibility route', () => { expect(API_ROUTES.continueRepairEligibility).toBe('/api/recover/continue-repair/eligibility'); });
});
