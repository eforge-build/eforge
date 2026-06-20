import { describe, expect, it } from 'vitest';
import type { RecoveryVerdictSidecar } from '@eforge-build/client';
import { countRecoveryGuidanceSections, patchRecoveryGuidanceSection, renderRecoveryGuidanceSection } from '@eforge-build/engine/recovery/guidance-render';

function sidecar(): RecoveryVerdictSidecar {
  return {
    schemaVersion: 3,
    generatedAt: '2026-01-02T03:04:05.000Z',
    prdId: 'prd-1',
    setName: 'demo-set',
    verdict: { verdict: 'manual', confidence: 'low', rationale: 'repair manually' },
    report: {
      operatorSummary: 'plan failed during validation',
      recommendedAction: 'continue and repair the compiled plan',
      rootFailure: { planId: 'plan-01', message: 'validation failed' },
      keyEvidence: [],
      completedWork: [],
      remainingWork: ['fix validation', 'rerun checks'],
      risks: [],
    },
    boundedEvidence: {
      identity: { prdId: 'prd-1', setName: 'demo-set', featureBranch: 'eforge/demo-set', baseBranch: 'main', failedAt: '2026-01-02T03:04:05.000Z' },
      plans: [{ planId: 'plan-01', status: 'failed' }],
      failingPlan: { planId: 'plan-01', errorMessage: 'validation failed' },
      landedCommits: [],
      modelsUsed: [],
    },
  } as RecoveryVerdictSidecar;
}

describe('recovery guidance rendering', () => {
  it('renders deterministic operator guidance with source identity', () => {
    const section = renderRecoveryGuidanceSection({
      sidecar: sidecar(),
      planId: 'plan-01',
      sidecarPath: '.eforge/queue/failed/prd-1.recovery.json',
      prdId: 'prd-1',
      setName: 'demo-set',
      featureBranch: 'eforge/demo-set',
      baseBranch: 'main',
    });

    expect(section.startsWith('## Recovery Guidance\n')).toBe(true);
    expect(section).toContain('plan failed during validation');
    expect(section).toContain('continue and repair the compiled plan');
    expect(section).toContain('fix validation');
    expect(section).toContain('Continue plan-01 for failed PRD prd-1');
    expect(section).toContain('2026-01-02T03:04:05.000Z');
    expect(section).toContain('.eforge/queue/failed/prd-1.recovery.json');
  });

  it('redacts and bounds sidecar-derived evidence', () => {
    const input = sidecar();
    input.report.operatorSummary = 'failed with Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturePart123456 and npm_0123456789ABCDEFabcdef0123456789';
    input.report.rootFailure = { planId: 'plan-01', message: '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----' };

    const section = renderRecoveryGuidanceSection({ sidecar: input, planId: 'plan-01', sidecarPath: 'failed/prd-1.recovery.json', prdId: 'prd-1', setName: 'demo-set', featureBranch: 'eforge/demo-set', baseBranch: 'main' });

    expect(section).toContain('[REDACTED');
    expect(section).not.toContain('npm_0123456789ABCDEFabcdef0123456789');
    expect(section).not.toContain('BEGIN PRIVATE KEY');
  });

  it('appends, replaces, deduplicates, and becomes idempotent', () => {
    const section = renderRecoveryGuidanceSection({ sidecar: sidecar(), planId: 'plan-01', sidecarPath: 'failed/prd-1.recovery.json', prdId: 'prd-1', setName: 'demo-set', featureBranch: 'eforge/demo-set', baseBranch: 'main' });
    const appended = patchRecoveryGuidanceSection('# Plan\n\nBody\n', section);
    expect(appended.changed).toBe(true);
    expect(countRecoveryGuidanceSections(appended.content)).toBe(1);

    const current = patchRecoveryGuidanceSection(appended.content, section);
    expect(current.changed).toBe(false);

    const duplicated = `${appended.content}\n## Notes\nkeep\n\n## Recovery Guidance\nold duplicate\n`;
    const collapsed = patchRecoveryGuidanceSection(duplicated, section);
    expect(collapsed.content).toContain('## Notes\nkeep');
    expect(collapsed.content).not.toContain('old duplicate');
    expect(countRecoveryGuidanceSections(collapsed.content)).toBe(1);
  });
});
