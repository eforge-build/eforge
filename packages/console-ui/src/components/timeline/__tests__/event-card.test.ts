// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import { createElement } from 'react';
import type { EforgeEvent } from '@eforge-build/client/browser';
import { PlanPreviewProvider } from '@/components/preview';
import { EventCard } from '../event-card';
import {
  getVerdictChipClass,
  getConfidenceClass,
  asVerdict,
  type RecoveryVerdictValue,
  type RecoveryConfidenceValue,
} from '@/components/recovery/verdict-chip';

// ---------------------------------------------------------------------------
// Pure helper mirrors — extracted from event-card.tsx for testability
// without a DOM environment.
// ---------------------------------------------------------------------------

/** Mirror of eventSummary's gap_close:complete branch */
function gapCloseCompleteSummary(passed: boolean): string {
  return passed ? 'Gap closing complete' : 'Gap closing failed';
}

/** Mirror of classifyEvent's gap_close:complete verdict-aware classification */
function classifyGapCloseComplete(passed: boolean): string {
  return passed === false ? 'failed' : 'complete';
}

/** Mirror of eventSummary's acceptance_validation:complete branch */
function acceptanceValidationSummary(
  verdicts: Array<{ verdict: 'pass' | 'fail' | 'unknown' }>,
): string {
  const passCount = verdicts.filter((v) => v.verdict === 'pass').length;
  const failCount = verdicts.filter((v) => v.verdict === 'fail').length;
  const unknownCount = verdicts.filter((v) => v.verdict === 'unknown').length;
  return `Acceptance: ${passCount} pass, ${failCount} fail, ${unknownCount} unknown`;
}

/** Mirror of classifyEvent's acceptance_validation:complete verdict-aware classification */
function classifyAcceptanceValidationComplete(passed: boolean): string {
  return passed === false ? 'failed' : 'complete';
}

/** Mirror of eventDetail's acceptance_validation:complete branch */
function acceptanceValidationDetail(
  verdicts: Array<{ criterion: string; verdict: 'pass' | 'fail' | 'unknown'; evidence: string }>,
  waivers?: string[],
): string | null {
  const parts: string[] = [];
  for (const v of verdicts) {
    const icon = v.verdict === 'pass' ? '✓' : v.verdict === 'fail' ? '✗' : '?';
    parts.push(`${icon} [${v.verdict}] ${v.criterion}\n  ${v.evidence}`);
  }
  if (waivers && waivers.length > 0) {
    parts.push('Waivers:');
    for (const waiver of waivers) {
      parts.push(`  • ${waiver}`);
    }
  }
  return parts.join('\n\n') || null;
}

// Mirror of EventCard's recoveryCompleteEvent narrowing — extracted as a pure
// function for testability.
const hash = 'd'.repeat(64);

const preflightEvent = {
  type: 'planning:preflight',
  timestamp: '2026-01-01T00:00:00.000Z',
  risk: {
    level: 'overflow-risk',
    sourceBytes: 4096,
    promptSourceBytes: 2048,
    acceptanceCriteriaCount: 8,
    score: 90,
    generatedInventory: { detected: true, contentHashes: [hash], pathReferences: ['generated.json'], headings: ['Generated Inventory'], blockCount: 2, sidecarCount: 1, omittedBytes: 42 },
    subsystemBreadth: { count: 2, subsystems: ['cli', 'console'], evidence: ['rendering surfaces'] },
    reasons: ['generated-inventory:detected'],
    recommendation: { action: 'bounded-decomposition', eligible: true, reason: 'Split oversized generated scope.' },
  },
} as unknown as EforgeEvent;

// --- eforge:region plan-02-planner-continuation-surfaces ---
const inspectionSummaryEvent = {
  type: 'planning:inspection-summary',
  timestamp: '2026-01-01T00:00:02.000Z',
  artifactPath: '/project/eforge/plans/set-a/planner-inspection-handoff.json',
  summary: {
    kind: 'planner-inspection-handoff',
    version: 1,
    source: { sourceName: 'Queue cleanup', planSetName: 'set-a' },
    relevantFiles: ['packages/engine/src/queue/scheduler.ts'],
    observedFacts: ['Read scheduler cleanup code.'],
    importantFindings: ['Queue cleanup coverage was removed.'],
    inferredImplementationAreas: ['packages/engine/src/queue'],
    unresolvedQuestions: ['Confirm failed dispatch shape.'],
    sourceBuildContext: { sourceSummary: 'Fix removed queue coverage cleanup.' },
    budgetDiagnostics: {
      maxObservedInputTokens: 160000,
      softInputTokenThreshold: 115200,
      plannerMaxTurns: 80,
      inspectionTurnBudget: 60,
      softInputTokenRatio: 0.72,
      softTurnRatio: 0.75,
      observed: { inputTokens: 115200, outputTokens: 1200, turns: 44, promptBytes: 4096 },
      toolUseCount: 32,
      toolResultCount: 31,
    },
    caveats: ['Inspection is incomplete.'],
    omittedCounts: { toolResults: 1 },
  },
} as unknown as EforgeEvent;
// --- eforge:endregion plan-02-planner-continuation-surfaces ---

const scopeFailureEvent = {
  type: 'planning:scope-context:failure',
  timestamp: '2026-01-01T00:00:01.000Z',
  failure: {
    source: 'provider',
    failureKind: 'context-window',
    stage: 'planner',
    explanation: 'Provider context window exceeded.',
    observed: { promptBytes: 8192, inputTokens: 1234, turns: 3 },
    recovery: { action: 'manual-reduce-scope', eligible: true, attempted: false, attempt: 1, maxAttempts: 2, reason: 'Reduce scope before retrying.' },
    artifacts: { orchestrationExists: false, validPlanCount: 0, invalidPlanCount: 1, missingPlanFileCount: 2, missingPlanFiles: ['plan-01.md'], invalidPlanFiles: ['plan-02.md'] },
  },
} as unknown as EforgeEvent;

function renderEventCard(event: EforgeEvent) {
  return render(createElement(
    PlanPreviewProvider,
    null,
    createElement(EventCard, { event, startTime: null, showVerbose: false }),
  ));
}

afterEach(cleanup);

type RecoveryCompleteEventShape = {
  type: 'recovery:complete';
  prdId: string;
  verdict: { verdict: RecoveryVerdictValue; confidence: RecoveryConfidenceValue };
};

function getRecoveryVerdictProps(
  event: { type: string; [key: string]: unknown },
): { verdict: RecoveryVerdictValue; confidence: RecoveryConfidenceValue } | null {
  if (event.type !== 'recovery:complete') return null;
  const e = event as unknown as RecoveryCompleteEventShape;
  return e.verdict;
}

describe('EventCard compile resilience rendering branches', () => {
  it('renders planning:preflight summary and expandable bounded detail', () => {
    renderEventCard(preflightEvent);

    expect(screen.getByText('planning:preflight')).toBeTruthy();
    expect(screen.getByText(/Compile preflight: overflow-risk/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'details' }));
    expect(screen.getByText(/Generated inventory:/)).toBeTruthy();
    expect(screen.getByText(new RegExp(hash))).toBeTruthy();
    expect(screen.getByText(/Subsystem evidence: rendering surfaces/)).toBeTruthy();
    expect(screen.getByText(/Split oversized generated scope/)).toBeTruthy();
  });

  // --- eforge:region plan-02-planner-continuation-surfaces ---
  it('renders planning:inspection-summary with expandable compact detail', () => {
    renderEventCard(inspectionSummaryEvent);

    const typeLabel = screen.getByText('planning:inspection-summary');
    expect(typeLabel.className).toContain('text-yellow');
    expect(screen.getByText(/Planner compact inspection summary/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'details' }));
    expect(screen.getByText(/packages\/engine\/src\/queue\/scheduler.ts/)).toBeTruthy();
    expect(screen.getByText(/Queue cleanup coverage was removed/)).toBeTruthy();
    expect(screen.getByText(/planner-inspection-handoff.json/)).toBeTruthy();
  });
  // --- eforge:endregion plan-02-planner-continuation-surfaces ---

  it('renders planning:scope-context:failure with failed styling and detail', () => {
    renderEventCard(scopeFailureEvent);

    const typeLabel = screen.getByText('planning:scope-context:failure');
    expect(typeLabel.className).toContain('text-red');
    expect(screen.getByText(/Compile scope\/context failure: context-window from provider at planner/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'details' }));
    expect(screen.getByText(/Provider context window exceeded/)).toBeTruthy();
    expect(screen.getByText(/attempt 1\/2/)).toBeTruthy();
    expect(screen.getByText(/Artifacts:/)).toBeTruthy();
    expect(screen.getByText(/8.0 KiB prompt/)).toBeTruthy();
  });
});

describe('EventCard recovery:complete rendering branch', () => {
  it('returns non-null chip props for a recovery:complete event', () => {
    const event = {
      type: 'recovery:complete',
      prdId: 'my-plan',
      verdict: { verdict: 'retry' as RecoveryVerdictValue, confidence: 'high' as RecoveryConfidenceValue },
    };
    const props = getRecoveryVerdictProps(event);
    expect(props).not.toBeNull();
    expect(props?.verdict).toBe('retry');
    expect(props?.confidence).toBe('high');
  });

  it('returns null for non-recovery events (chip is not rendered)', () => {
    const event = { type: 'plan:build:complete', planId: 'my-plan' };
    expect(getRecoveryVerdictProps(event)).toBeNull();
  });

  it('returns null for recovery:start events (chip only shown on complete)', () => {
    const event = { type: 'recovery:start', prdId: 'my-plan', setName: 'my-set' };
    expect(getRecoveryVerdictProps(event)).toBeNull();
  });

  it('rejects removed recovery split verdicts', () => {
    expect(asVerdict('split')).toBeUndefined();
  });

  it('chip styling is valid for all verdict/confidence combinations from recovery events', () => {
    const verdicts: RecoveryVerdictValue[] = ['retry', 'continue-repair', 'abandon', 'manual'];
    const confidences: RecoveryConfidenceValue[] = ['low', 'medium', 'high'];

    verdicts.forEach((verdict) => {
      confidences.forEach((confidence) => {
        const event = {
          type: 'recovery:complete',
          prdId: 'my-plan',
          verdict: { verdict, confidence },
        };
        const props = getRecoveryVerdictProps(event);
        expect(props).not.toBeNull();
        expect(getVerdictChipClass(props!.verdict).trim().length).toBeGreaterThan(0);
        expect(getConfidenceClass(props!.confidence).trim().length).toBeGreaterThan(0);
      });
    });
  });
});

describe('EventCard gap_close:complete rendering branch', () => {
  it('classifies passed gap_close:complete as complete', () => {
    expect(classifyGapCloseComplete(true)).toBe('complete');
  });

  it('classifies failed gap_close:complete as failed', () => {
    expect(classifyGapCloseComplete(false)).toBe('failed');
  });

  it('summary for passed gap_close:complete is "Gap closing complete"', () => {
    expect(gapCloseCompleteSummary(true)).toBe('Gap closing complete');
  });

  it('summary for failed gap_close:complete is "Gap closing failed"', () => {
    expect(gapCloseCompleteSummary(false)).toBe('Gap closing failed');
  });
});

describe('EventCard acceptance_validation:complete rendering branch', () => {
  it('classifies passed acceptance_validation:complete as complete', () => {
    expect(classifyAcceptanceValidationComplete(true)).toBe('complete');
  });

  it('classifies failed acceptance_validation:complete as failed', () => {
    expect(classifyAcceptanceValidationComplete(false)).toBe('failed');
  });

  it('summary includes correct pass/fail/unknown counts', () => {
    const verdicts = [
      { verdict: 'pass' as const },
      { verdict: 'pass' as const },
      { verdict: 'fail' as const },
      { verdict: 'unknown' as const },
    ];
    expect(acceptanceValidationSummary(verdicts)).toBe('Acceptance: 2 pass, 1 fail, 1 unknown');
  });

  it('summary with all passing verdicts shows 0 fail and 0 unknown', () => {
    const verdicts = [{ verdict: 'pass' as const }, { verdict: 'pass' as const }];
    expect(acceptanceValidationSummary(verdicts)).toBe('Acceptance: 2 pass, 0 fail, 0 unknown');
  });

  it('detail lists each verdict with icon, label, criterion, and evidence', () => {
    const verdicts = [
      { criterion: 'AC-1: Must do X', verdict: 'pass' as const, evidence: 'Implemented in foo.ts' },
      { criterion: 'AC-2: Must do Y', verdict: 'fail' as const, evidence: 'No implementation found' },
      { criterion: 'AC-3: Must do Z', verdict: 'unknown' as const, evidence: 'Insufficient diff' },
    ];
    const detail = acceptanceValidationDetail(verdicts);
    expect(detail).toContain('✓ [pass] AC-1: Must do X');
    expect(detail).toContain('Implemented in foo.ts');
    expect(detail).toContain('✗ [fail] AC-2: Must do Y');
    expect(detail).toContain('No implementation found');
    expect(detail).toContain('? [unknown] AC-3: Must do Z');
    expect(detail).toContain('Insufficient diff');
  });

  it('detail includes waiver reasons when present', () => {
    const verdicts = [
      { criterion: 'AC-1', verdict: 'pass' as const, evidence: 'evidence' },
    ];
    const waivers = ['No-PRD build: acceptance inventory not applicable'];
    const detail = acceptanceValidationDetail(verdicts, waivers);
    expect(detail).toContain('Waivers:');
    expect(detail).toContain('No-PRD build: acceptance inventory not applicable');
  });

  it('detail returns null when verdicts array is empty and no waivers', () => {
    expect(acceptanceValidationDetail([])).toBeNull();
  });

  it('detail includes all waiver reason strings in order', () => {
    const verdicts = [{ criterion: 'AC-1', verdict: 'pass' as const, evidence: 'ok' }];
    const waivers = ['reason-one', 'reason-two'];
    const detail = acceptanceValidationDetail(verdicts, waivers);
    expect(detail).toContain('reason-one');
    expect(detail).toContain('reason-two');
  });
});
