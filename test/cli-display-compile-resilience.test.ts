import { describe, expect, it } from 'vitest';
import type { CompilePreflightRisk, CompileScopeContextFailure } from '@eforge-build/client';
import { renderCompilePreflightLines, renderCompileScopeContextFailureModel } from '../packages/eforge/src/cli/compile-resilience-display.js';

const hash = 'a'.repeat(64);

function risk(level: CompilePreflightRisk['level']): CompilePreflightRisk {
  return {
    level,
    sourceBytes: 4096,
    promptSourceBytes: 2048,
    acceptanceCriteriaCount: 7,
    score: 3,
    generatedInventory: { detected: true, contentHashes: [hash], pathReferences: ['src/a.ts'], headings: ['Generated'], blockCount: 2, sidecarCount: 1, omittedBytes: 10 },
    subsystemBreadth: { count: 3, subsystems: ['cli', 'console'], evidence: ['cli evidence'] },
    reasons: ['large generated inventory'],
    recommendation: { action: level === 'normal' ? 'none' : 'bounded-decomposition', eligible: true, reason: 'Split into bounded pieces.' },
  };
}

function failure(): CompileScopeContextFailure {
  return {
    source: 'provider',
    failureKind: 'context-window',
    stage: 'planner',
    explanation: 'Provider rejected context window.',
    observed: { promptBytes: 8192, inputTokens: 1000, outputTokens: 20, turns: 2 },
    recovery: { action: 'manual-reduce-scope', eligible: true, attempted: false, attempt: 1, maxAttempts: 2, reason: 'Reduce scope.' },
    artifacts: { orchestrationExists: true, validPlanCount: 1, invalidPlanCount: 2, missingPlanFileCount: 3, missingPlanFiles: ['plan-03.md'], invalidPlanFiles: ['plan-02.md'] },
  };
}

describe('compile resilience CLI formatting', () => {
  it('keeps normal preflight silent unless verbose', () => {
    expect(renderCompilePreflightLines(risk('normal'))).toEqual([]);
    expect(renderCompilePreflightLines(risk('normal'), { verbose: true })[0]).toContain('normal');
  });

  it('renders elevated and overflow preflight compactly', () => {
    const elevated = renderCompilePreflightLines(risk('elevated'))[0];
    expect(elevated).toContain('elevated');
    expect(elevated).toContain('4.0 KiB source');
    expect(elevated).toContain('7 AC');
    expect(elevated).toContain('bounded decomposition');

    const overflow = renderCompilePreflightLines(risk('overflow-risk'));
    expect(overflow.join('\n')).toContain('Split into bounded pieces.');
  });

  it('renders scope/context failure details without raw payloads', () => {
    const model = renderCompileScopeContextFailureModel(failure());
    expect(model.headline).toContain('Compile scope/context failure');
    expect(model.headline).toContain('context-window');
    expect(model.details.join('\n')).toContain('attempt 1/2');
    expect(model.details.join('\n')).toContain('1 valid plan');
    expect(model.details.join('\n')).toContain('1000 input tokens');
  });
});
