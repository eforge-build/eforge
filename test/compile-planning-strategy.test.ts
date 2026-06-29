import { describe, expect, it } from 'vitest';
import type { CompilePreflightRisk, CompilePipelineScope } from '@eforge-build/engine/events';
import { selectCompilePlanningStrategy } from '@eforge-build/engine/compile-resilience/planning-strategy';

function risk(level: CompilePreflightRisk['level'] | undefined, action: CompilePreflightRisk['recommendation']['action']): CompilePreflightRisk | undefined {
  if (!level) return undefined;
  return {
    level,
    sourceBytes: 100_000,
    promptSourceBytes: 80_000,
    acceptanceCriteriaCount: 42,
    score: level === 'overflow-risk' ? 95 : 40,
    generatedInventory: { detected: false, contentHashes: [], pathReferences: [], headings: [], blockCount: 0, sidecarCount: 0, omittedBytes: 0 },
    subsystemBreadth: { count: 3, subsystems: ['engine', 'client', 'console'], evidence: ['test'] },
    pipelineScope: 'excursion',
    reasons: ['test'],
    recommendation: { action, eligible: action !== 'none', reason: `test ${action}` },
  };
}

function select(level: CompilePreflightRisk['level'] | undefined, action: CompilePreflightRisk['recommendation']['action'], selectedScope: CompilePipelineScope = 'excursion') {
  return selectCompilePlanningStrategy({ risk: risk(level, action), selectedScope });
}

describe('selectCompilePlanningStrategy', () => {
  it('uses the direct planner for absent, normal, elevated, retry-as-expedition, and manual reduction recommendations', () => {
    expect(select(undefined, 'none')).toBe('direct');
    expect(select('normal', 'none')).toBe('direct');
    expect(select('elevated', 'bounded-decomposition')).toBe('direct');
    expect(select('overflow-risk', 'retry-as-expedition')).toBe('direct');
    expect(select('overflow-risk', 'manual-reduce-scope')).toBe('direct');
  });

  it('selects context-managed decomposition only for overflow-risk bounded-decomposition recommendations', () => {
    expect(select('overflow-risk', 'bounded-decomposition')).toBe('context-managed-decomposition');
  });

  it('keeps bounded-decomposition selected after composer or retry escalation changes the compile scope to expedition', () => {
    expect(select('overflow-risk', 'bounded-decomposition', 'expedition')).toBe('context-managed-decomposition');
  });
});
