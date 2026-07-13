/**
 * Tests for thread-pipeline lane ordering and PRD pill host.
 *
 * Verifies:
 * - orderedPlanIds includes thread-only lane keys (e.g. validation with no planStatuses entry)
 * - PRD pill renders on the planning lane when planning threads exist
 * - no planning/validation thread is grouped under __global__
 */
import type { ComponentProps } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PlanPreviewProvider } from '@/components/preview';
import { ThreadPipeline } from '../thread-pipeline';
import type { AgentThread, StoredEvent, ValidationCommandSpan } from '@/lib/run-state';

const review = { strategy: 'auto' as const, perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' as const };
const orchestration = {
  name: 'feature-x',
  description: 'Feature X',
  created: '2025-01-01T00:00:00.000Z',
  mode: 'excursion' as const,
  baseBranch: 'main',
  pipeline: { scope: 'excursion' as const, compile: [], defaultBuild: [], defaultReview: review, rationale: 'compile' },
  plans: [
    { id: 'plan-01', name: 'Plan 01', dependsOn: [], branch: 'feature-x/plan-01', build: ['implement'], review },
  ],
};

function makeThread(overrides: Partial<AgentThread> & { agent: string; startedAt: string }): AgentThread {
  return {
    agentId: `agent-${Math.random().toString(36).slice(2, 8)}`,
    endedAt: null,
    durationMs: null,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    cacheRead: null,
    cacheCreation: null,
    costUsd: null,
    numTurns: null,
    model: 'test-model',
    ...overrides,
  };
}

function renderPipeline(props: Partial<ComponentProps<typeof ThreadPipeline>> = {}) {
  return render(
    <PlanPreviewProvider>
      <ThreadPipeline
        agentThreads={[]}
        startTime={Date.parse('2025-01-01T00:00:00.000Z')}
        endTime={Date.parse('2025-01-01T00:10:00.000Z')}
        planStatuses={{}}
        reviewIssues={{}}
        events={[]}
        orchestration={null}
        prdSource={null}
        planArtifacts={[]}
        decisions={{}}
        {...props}
      />
    </PlanPreviewProvider>,
  );
}

describe('ThreadPipeline map/reduce lane grouping', () => {
  const atomThreadA = makeThread({ agentId: 'agent-atom-a', planId: 'atom-a', agent: 'planner', startedAt: '2025-01-01T00:01:00.000Z' });
  const atomThreadB = makeThread({ agentId: 'agent-atom-b', planId: 'atom-b', agent: 'planner', startedAt: '2025-01-01T00:02:00.000Z' });
  const reduceThread = makeThread({ agentId: 'agent-reduce', planId: 'reduce-000', agent: 'planner', startedAt: '2025-01-01T00:03:00.000Z' });

  const mapReduceModel = {
    laneIdByMember: { 'atom-a': 'map-atoms', 'atom-b': 'map-atoms', 'reduce-000': 'reduce-level-0' },
    lanes: [
      { id: 'map-atoms', label: 'Map atoms (2)', tooltip: ['2 map atoms: 1 running, 1 done'] },
      { id: 'reduce-level-0', label: 'Reduce (1)', tooltip: ['1 reduce node: 1 running'] },
    ],
    laneIds: new Set(['map-atoms', 'reduce-level-0']),
    displayByAgentId: {
      'agent-atom-a': { barLabel: 'atom-a', tooltipLines: ['atom-a — A'] },
      'agent-atom-b': { barLabel: 'atom-b', tooltipLines: ['atom-b — B'] },
      'agent-reduce': { barLabel: 'reduce-000', tooltipLines: ['reduce-000'] },
    },
  };

  it('renders one lane per atom/reduce thread when no map/reduce model is provided', () => {
    renderPipeline({ agentThreads: [atomThreadA, atomThreadB, reduceThread] });
    expect(screen.getByText('atom-a')).toBeTruthy();
    expect(screen.getByText('atom-b')).toBeTruthy();
    expect(screen.getByText('reduce-000')).toBeTruthy();
  });

  it('collapses member threads into the grouped lanes with member-id bar labels', () => {
    const planThread = makeThread({ planId: 'planning', agent: 'plan-reviewer', startedAt: '2025-01-01T00:04:00.000Z' });
    renderPipeline({
      agentThreads: [atomThreadA, atomThreadB, reduceThread, planThread],
      mapReduce: mapReduceModel,
    });
    // Grouped lane labels render instead of one row per member.
    expect(screen.getByText('Map atoms (2)')).toBeTruthy();
    expect(screen.getByText('Reduce (1)')).toBeTruthy();
    // Bars are labeled by member id (the planner role label is replaced).
    expect(screen.getByText('atom-a')).toBeTruthy();
    expect(screen.getByText('atom-b')).toBeTruthy();
    expect(screen.getByText('reduce-000')).toBeTruthy();
    // Other lanes are unaffected.
    expect(screen.getByText('Planning')).toBeTruthy();
  });

  it('keeps the grouped lanes when plan artifacts exist (post-compile context)', () => {
    renderPipeline({
      orchestration,
      planStatuses: { 'plan-01': 'implement' },
      agentThreads: [atomThreadA, atomThreadB, reduceThread],
      planArtifacts: [{ id: 'plan-01', name: 'Plan 01', body: '# Plan 01' }],
      mapReduce: mapReduceModel,
    });
    expect(screen.getByText('Map atoms (2)')).toBeTruthy();
    expect(screen.getByText('Reduce (1)')).toBeTruthy();
    expect(screen.getByText('Plan 01 — Plan 01')).toBeTruthy();
  });
});

describe('ThreadPipeline lane ordering', () => {
  it('includes a validation lane key when only validation threads exist (no planStatuses entry)', () => {
    const validationThread = makeThread({
      planId: 'validation',
      agent: 'validation-fixer',
      startedAt: '2025-01-01T00:05:00.000Z',
    });

    renderPipeline({
      orchestration,
      planStatuses: { 'plan-01': 'complete' },
      agentThreads: [validationThread],
      planArtifacts: [{ id: 'plan-01', name: 'Plan 01', body: '# Plan 01' }],
    });

    // The validation lane should render with the agent name visible in the pipeline.
    // The numbered presentation label should also be present.
    expect(screen.getByText('Plan 01 — Plan 01')).toBeTruthy();
    // Validation lane renders with laneLabel('validation') = 'Validation'
    expect(screen.getByText('Validation')).toBeTruthy();
  });

  it('renders validation commands on the Validation lane instead of requiring a Compile row', () => {
    const validationCommands: ValidationCommandSpan[] = [
      {
        command: 'pnpm type-check',
        startedAt: '2025-01-01T00:05:00.000Z',
        endedAt: '2025-01-01T00:05:20.000Z',
        status: 'passed',
        exitCode: 0,
      },
    ];

    renderPipeline({
      orchestration,
      startTime: Date.parse('2025-01-01T00:05:00.000Z'),
      endTime: Date.parse('2025-01-01T00:05:20.000Z'),
      planStatuses: { 'plan-01': 'complete' },
      planArtifacts: [{ id: 'plan-01', name: 'Plan 01', body: '# Plan 01' }],
      validationCommands,
    });

    expect(screen.getByText('Validation')).toBeTruthy();
    expect(screen.getByText(/pnpm type-check/)).toBeTruthy();
    expect(screen.queryByText('Compile')).toBeNull();
  });

  it('does not render an unbacked raw acceptance-validation row when artifacts are present', () => {
    renderPipeline({
      orchestration,
      planStatuses: { 'plan-01': 'complete', 'acceptance-validation': 'plan' },
      planArtifacts: [{ id: 'plan-01', name: 'Plan 01', body: '# Plan 01' }],
    });

    expect(screen.getByText('Plan 01 — Plan 01')).toBeTruthy();
    expect(screen.queryByText('acceptance-validation')).toBeNull();
  });

  it('does not render thread-only synthetic acceptance-validation rows while backed phase lanes render', () => {
    renderPipeline({
      orchestration,
      planStatuses: { 'plan-01': 'complete' },
      planArtifacts: [{ id: 'plan-01', name: 'Plan 01', body: '# Plan 01' }],
      agentThreads: [
        makeThread({ planId: 'acceptance-validation', agent: 'builder', startedAt: '2025-01-01T00:04:00.000Z' }),
        makeThread({ planId: 'validation', agent: 'validation-fixer', startedAt: '2025-01-01T00:05:00.000Z' }),
      ],
    });

    expect(screen.getByText('Plan 01 — Plan 01')).toBeTruthy();
    expect(screen.getByText('Validation')).toBeTruthy();
    expect(screen.queryByText('acceptance-validation')).toBeNull();
  });

  it('does not render stale plan status rows when orchestration is present but empty', () => {
    renderPipeline({
      orchestration: { ...orchestration, plans: [] },
      planStatuses: { 'acceptance-validation': 'plan' },
    });

    expect(screen.queryByText('acceptance-validation')).toBeNull();
  });

  it('does not render unbacked registered phase rows when artifacts are present', () => {
    renderPipeline({
      orchestration,
      planStatuses: {
        'plan-01': 'complete',
        validation: 'implement',
        'gap-close': 'implement',
        'final-validation': 'implement',
      },
      planArtifacts: [{ id: 'plan-01', name: 'Plan 01', body: '# Plan 01' }],
    });

    expect(screen.getByText('Plan 01 — Plan 01')).toBeTruthy();
    expect(screen.queryByText('Validation')).toBeNull();
    expect(screen.queryByText('Gap Close')).toBeNull();
    expect(screen.queryByText('Final Validation')).toBeNull();
  });

  it('renders direct base-sync merge-resolver threads under their feature branch label', () => {
    renderPipeline({
      orchestration,
      planStatuses: { 'plan-01': 'complete' },
      planArtifacts: [{ id: 'plan-01', name: 'Plan 01', body: '# Plan 01' }],
      agentThreads: [makeThread({ planId: 'eforge/feature-x', agent: 'merge-conflict-resolver', startedAt: '2025-01-01T00:06:00.000Z' })],
    });

    expect(screen.getByText('Feature branch: eforge/feature-x')).toBeTruthy();
    expect(screen.getByText(/merge-conflict-resolver/)).toBeTruthy();
  });

  it('renders direct base-sync phase lane between plan and validation lanes', () => {
    renderPipeline({
      orchestration,
      planStatuses: { 'plan-01': 'complete', 'base-sync': 'implement', validation: 'implement' },
      planArtifacts: [{ id: 'plan-01', name: 'Plan 01', body: '# Plan 01' }],
      agentThreads: [
        makeThread({ planId: 'base-sync', agent: 'merge-conflict-resolver', startedAt: '2025-01-01T00:05:00.000Z' }),
        makeThread({ planId: 'validation', agent: 'validation-fixer', startedAt: '2025-01-01T00:06:00.000Z' }),
      ],
    });

    const plan = screen.getByText('Plan 01 — Plan 01');
    const baseSync = screen.getByText('Direct Base Sync');
    const validation = screen.getByText('Validation');
    expect(plan.compareDocumentPosition(baseSync) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(baseSync.compareDocumentPosition(validation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders a non-interactive Gap Close lane while its plan is still being generated', () => {
    renderPipeline({
      orchestration,
      planStatuses: { 'plan-01': 'complete', 'gap-close': 'implement' },
      planArtifacts: [{ id: 'plan-01', name: 'Plan 01', body: '# Plan 01' }],
      agentThreads: [makeThread({ planId: 'gap-close', agent: 'gap-closer', startedAt: '2025-01-01T00:06:00.000Z' })],
    });

    const laneLabel = screen.getByText('Gap Close');
    expect(laneLabel.closest('button')).toBeNull();
    const disabledPill = laneLabel.closest('[aria-disabled="true"]');
    expect(disabledPill?.getAttribute('tabindex')).toBe('0');
    expect(disabledPill?.getAttribute('aria-label')).toContain('plan is being generated');
  });

  it('makes the Gap Close plan preview available after plan_ready arrives', () => {
    const events: StoredEvent[] = [
      {
        eventId: 'gap-close-plan',
        event: {
          type: 'gap_close:plan_ready',
          timestamp: '2025-01-01T00:06:30.000Z',
          planBody: '# Close the remaining gap',
          gaps: [{ requirement: 'Requirement A', explanation: 'Still missing' }],
        } as StoredEvent['event'],
      },
    ];

    renderPipeline({
      orchestration,
      planStatuses: { 'plan-01': 'complete', 'gap-close': 'implement' },
      planArtifacts: [{ id: 'plan-01', name: 'Plan 01', body: '# Plan 01' }],
      agentThreads: [makeThread({ planId: 'gap-close', agent: 'builder', startedAt: '2025-01-01T00:07:00.000Z' })],
      events,
    });

    expect(screen.getByText('Gap Close').closest('button')).toBeTruthy();
  });

  it('renders the Final Validation lane when validation commands run after gap close completes', () => {
    const events: StoredEvent[] = [
      {
        eventId: 'gap-close-complete',
        event: { type: 'gap_close:complete', timestamp: '2025-01-01T00:06:00.000Z', passed: true } as StoredEvent['event'],
      },
    ];
    const validationCommands: ValidationCommandSpan[] = [
      {
        command: 'pnpm test',
        startedAt: '2025-01-01T00:07:00.000Z',
        endedAt: '2025-01-01T00:07:20.000Z',
        status: 'passed',
        exitCode: 0,
      },
    ];

    renderPipeline({
      orchestration,
      startTime: Date.parse('2025-01-01T00:07:00.000Z'),
      endTime: Date.parse('2025-01-01T00:07:20.000Z'),
      planStatuses: { 'plan-01': 'complete', 'final-validation': 'implement' },
      planArtifacts: [{ id: 'plan-01', name: 'Plan 01', body: '# Plan 01' }],
      events,
      validationCommands,
    });

    expect(screen.getByText('Final Validation')).toBeTruthy();
    expect(screen.getByText(/pnpm test/)).toBeTruthy();
  });

  it('does not group planning or validation threads under __global__/Compile', () => {
    const planningThread = makeThread({
      planId: 'planning',
      agent: 'planner',
      startedAt: '2025-01-01T00:00:00.000Z',
      endedAt: '2025-01-01T00:03:00.000Z',
    });
    const validationThread = makeThread({
      planId: 'validation',
      agent: 'validation-fixer',
      startedAt: '2025-01-01T00:05:00.000Z',
    });

    renderPipeline({
      orchestration,
      planStatuses: { 'plan-01': 'complete' },
      agentThreads: [planningThread, validationThread],
      planArtifacts: [{ id: 'plan-01', name: 'Plan 01', body: '# Plan 01' }],
    });

    // No "Compile" row should be present (no __global__ threads)
    expect(screen.queryByText('Compile')).toBeNull();
    // Planning and Validation lanes render as their own rows
    expect(screen.getByText('Planning')).toBeTruthy();
    expect(screen.getByText('Validation')).toBeTruthy();
  });
});

describe('ThreadPipeline plan presentation', () => {
  const opaquePlanId = 'plan-7f3a9c';

  it.each([
    ['short', 'Ship it'],
    ['spaced-long', 'Ship the console presentation with a readable label that has many words'],
    ['unbroken-long', 'x'.repeat(240)],
  ])('keeps the %s plan label constrained without hiding its stage sibling', (_kind, name) => {
    const declaredPlan = { ...orchestration.plans[0], id: opaquePlanId, name };
    renderPipeline({
      orchestration: { ...orchestration, plans: [declaredPlan] },
      planStatuses: { [opaquePlanId]: 'implement' },
      planArtifacts: [{ id: opaquePlanId, name: 'Stale REST title', body: '# Current plan' }],
    });

    const label = `Plan 01 — ${name}`;
    const labelNode = screen.getByText(label);
    const pill = labelNode.closest('button');
    expect(pill).toBeTruthy();
    expect(pill?.className).toContain('min-w-0');
    expect(pill?.className).toContain('max-w-full');
    expect(labelNode.className).toContain('truncate');
    expect(labelNode.className).toContain('min-w-0');
    // The two minmax columns let the label shrink rather than consuming the
    // timeline/status cell, which remains observable for every label shape.
    expect(pill?.parentElement?.parentElement?.parentElement?.className).toContain('grid-cols-[minmax(0,180px)_minmax(0,1fr)]');
    expect(screen.getByText('implement')).toBeTruthy();
  });

  it('uses live declaration metadata for presentation while retaining the semantic ID', async () => {
    const declaredPlan = { ...orchestration.plans[0], id: opaquePlanId, name: 'Live event name' };
    renderPipeline({
      orchestration: { ...orchestration, plans: [declaredPlan] },
      planStatuses: { [opaquePlanId]: 'implement' },
      // The artifact is intentionally stale: it must not replace declaration
      // metadata, and it supplies the preview content independently.
      planArtifacts: [{ id: opaquePlanId, name: 'Stale REST title', body: '# Current plan' }],
    });

    const label = screen.getByText('Plan 01 — Live event name');
    expect(screen.queryByText(/Stale REST title/)).toBeNull();
    const button = label.closest('button')!;
    fireEvent.pointerMove(button, { pointerType: 'mouse' });
    fireEvent.mouseEnter(button);
    await waitFor(() => expect(screen.getAllByText('ID: plan-7f3a9c').length).toBeGreaterThan(0));
  });

  it('numbers declared plans deterministically and leaves synthetic lanes on their registered labels', () => {
    const plans = [
      { ...orchestration.plans[0], id: 'semantic-first', name: 'First plan' },
      { ...orchestration.plans[0], id: 'semantic-second', name: 'Second plan', dependsOn: ['semantic-first'] },
    ];
    renderPipeline({
      orchestration: { ...orchestration, plans },
      planStatuses: { 'semantic-first': 'complete', 'semantic-second': 'implement', validation: 'implement' },
      planArtifacts: [
        { id: 'semantic-first', name: 'Old first title', body: '# First' },
        { id: 'semantic-second', name: 'Old second title', body: '# Second' },
      ],
      agentThreads: [makeThread({ planId: 'validation', agent: 'validation-fixer', startedAt: '2025-01-01T00:05:00.000Z' })],
    });

    const first = screen.getByText('Plan 01 — First plan');
    const second = screen.getByText('Plan 02 — Second plan');
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('Validation')).toBeTruthy();
    expect(screen.queryByText(/Plan 03/)).toBeNull();
  });
});

describe('ThreadPipeline PRD pill host', () => {
  it('renders the PRD pill on the planning lane when planning threads exist', () => {
    const planningThread = makeThread({
      planId: 'planning',
      agent: 'planner',
      startedAt: '2025-01-01T00:00:00.000Z',
      endedAt: '2025-01-01T00:03:00.000Z',
    });

    renderPipeline({
      orchestration,
      planStatuses: { 'plan-01': 'implement' },
      agentThreads: [planningThread],
      planArtifacts: [{ id: 'plan-01', name: 'Plan 01', body: '# Plan 01' }],
      prdSource: { label: 'My PRD', content: '# My PRD' },
    });

    // PRD pill should exist
    expect(screen.getByText('PRD')).toBeTruthy();
    // The Compile row should not host the PRD (no global threads, and even if
    // there were, the planning lane takes ownership of the pill)
    expect(screen.queryByText('Compile')).toBeNull();
  });

  it('renders the PRD pill on the Compile row when no planning threads exist', () => {
    const globalThread = makeThread({
      agent: 'formatter',
      startedAt: '2025-01-01T00:00:00.000Z',
      endedAt: '2025-01-01T00:01:00.000Z',
    });

    renderPipeline({
      orchestration,
      planStatuses: { 'plan-01': 'implement' },
      agentThreads: [globalThread],
      planArtifacts: [{ id: 'plan-01', name: 'Plan 01', body: '# Plan 01' }],
      prdSource: { label: 'My PRD', content: '# My PRD' },
    });

    // PRD pill should exist on the Compile row
    expect(screen.getByText('PRD')).toBeTruthy();
  });

  it('keeps the resume Source row when no global threads and no planning lane', () => {
    renderPipeline({
      prdSource: { label: 'Recovered PRD', content: '# PRD' },
    });

    expect(screen.getByText('PRD')).toBeTruthy();
    expect(screen.queryByText('Waiting for agent activity...')).toBeNull();
  });
});
