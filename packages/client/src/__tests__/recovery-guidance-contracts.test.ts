import { describe, expect, it } from 'vitest';
import { API_ROUTES, type RecoveryGuidancePrepareResponse } from '../index.js';
import { readFileSync } from 'node:fs';


describe('recovery guidance contracts', () => {
  it('exposes the prepare route and response fields', () => {
    expect(API_ROUTES.recoveryGuidancePrepare).toBe('/api/recover/guidance/prepare');
    const response: RecoveryGuidancePrepareResponse = {
      prdId: 'prd-1',
      setName: 'set-a',
      featureBranch: 'feature/prd-1',
      baseBranch: 'main',
      outputDir: '.eforge/recovery',
      sidecarPath: '.eforge/recovery/prd-1.json',
      sidecarGeneratedAt: '2026-06-19T10:00:00.000Z',
      plans: [{ planId: 'plan-1', path: 'plans/plan-1.md', status: 'patched' }],
      commitSha: 'abc123',
    };
    expect(response.plans[0]?.status).toBe('patched');
  });

  it('node and browser helpers select the client-owned route constant', () => {
    expect(readFileSync('packages/client/src/api/recovery-guidance.ts', 'utf8')).toContain('API_ROUTES.recoveryGuidancePrepare');
    expect(readFileSync('packages/client/src/browser-recovery.ts', 'utf8')).toContain('API_ROUTES.recoveryGuidancePrepare');
  });
});
