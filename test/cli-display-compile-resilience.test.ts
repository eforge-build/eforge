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

function failureWithGuardDiagnostics(): CompileScopeContextFailure {
  return {
    ...failure(),
    source: 'live-context-guard',
    failureKind: 'context-budget',
    guardDiagnostics: {
      provider: 'openai',
      modelId: 'gpt-5',
      metadataSource: 'registry',
      fallbackReason: 'registry entry lacked token limits; used provider fallback',
      contextWindow: 200000,
      outputReserveTokens: 32000,
      overheadReserveTokens: 4096,
      safetyMargin: 0.8,
      limits: {
        maxPromptBytes: 500000,
        maxObservedInputTokens: 131072,
        maxObservedTurns: 12,
        maxExplanationBytes: 2000,
      },
    },
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
    const detail = model.details.join('\n');
    expect(model.headline).toContain('Compile scope/context failure');
    expect(model.headline).toContain('context-window');
    expect(detail).toContain('attempt 1/2');
    expect(detail).toContain('1 valid plan');
    expect(detail).toContain('1000 input tokens');
    expect(detail).not.toContain('Model:');
  });

  it('renders optional guard diagnostics when present', () => {
    const detail = renderCompileScopeContextFailureModel(failureWithGuardDiagnostics()).details.join('\n');
    expect(detail).toContain('Model: openai/gpt-5');
    expect(detail).toContain('maxObservedInputTokens=131072');
    expect(detail).toContain('contextWindow=200000');
    expect(detail).toContain('outputReserveTokens=32000');
    expect(detail).toContain('overheadReserveTokens=4096');
    expect(detail).toContain('safetyMargin=0.8');
    expect(detail).toContain('metadataSource=registry');
    expect(detail).toContain('registry entry lacked token limits; used provider fallback');
  });
});
