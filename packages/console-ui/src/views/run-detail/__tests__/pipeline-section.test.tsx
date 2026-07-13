// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { EforgeEvent, PlanInfo } from '@eforge-build/client/browser';
import { createInitialRunState } from '@/lib/run-state';
import { PipelineSection } from '../pipeline-section';
import { ThreadPipeline } from '@/components/pipeline/thread-pipeline';

vi.mock('@/components/pipeline/thread-pipeline', () => ({
  ThreadPipeline: vi.fn(() => <div data-testid="thread-pipeline" />),
}));

const threadPipelineMock = vi.mocked(ThreadPipeline);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makePlan(overrides: Partial<PlanInfo>): PlanInfo {
  return {
    id: 'plan-01',
    name: 'Plan 01',
    body: '# Plan 01',
    dependsOn: [],
    type: 'plan',
    ...overrides,
  };
}

const scopeFailureEvent = {
  type: 'planning:scope-context:failure',
  timestamp: '2026-01-01T00:00:00Z',
  failure: {
    source: 'provider',
    failureKind: 'context-window',
    stage: 'planner',
    explanation: 'Provider context exceeded.',
    recovery: { action: 'manual-reduce-scope', eligible: true, attempted: false, attempt: 0, maxAttempts: 1, reason: 'Reduce scope.' },
    artifacts: { orchestrationExists: false, validPlanCount: 0, invalidPlanCount: 0, missingPlanFileCount: 0, missingPlanFiles: [], invalidPlanFiles: [] },
  },
} as unknown as EforgeEvent;

describe('PipelineSection', () => {
  it('renders a compile failure banner without plan failures', () => {
    const runState = createInitialRunState();
    runState.events.push({ eventId: '1', event: scopeFailureEvent });
    render(<PipelineSection runState={runState} plans={null} />);

    expect(document.body.textContent).toContain('Compile scope/context failure');
    expect(document.body.textContent).toContain('context-window from provider at planner');
  });

  it('passes only execution plan artifacts to the pipeline lanes', () => {
    render(
      <PipelineSection
        runState={createInitialRunState()}
        plans={[
          makePlan({ id: '__architecture__', name: 'Architecture', body: '# Architecture', type: 'architecture' }),
          makePlan({ id: '__module__config', name: 'Config Module', body: '# Module', type: 'module' }),
          makePlan({ id: 'plan-01-config', name: 'Plan 01 Config', body: '# Plan 01' }),
        ]}
      />,
    );

    const props = threadPipelineMock.mock.calls.at(-1)?.[0] as ComponentProps<typeof ThreadPipeline>;
    expect(props.planPresentation).toMatchObject([
      { id: 'plan-01-config', name: 'Plan 01 Config', previewBody: '# Plan 01' },
    ]);
  });

  it('merges live, resumed, and REST artifacts by canonical plan ID', () => {
    const runState = createInitialRunState();
    runState.resumeArtifacts = [
      { id: 'plan-live', name: 'Resumed name', body: '# Resumed', dependsOn: [] },
      { id: 'plan-resume-only', name: 'Resumed only', body: '# Resume only', dependsOn: [] },
    ];
    runState.events.push({
      eventId: 'live',
      event: {
        type: 'planning:complete',
        timestamp: '2026-01-01T00:00:00Z',
        plans: [
          { id: 'plan-live', name: 'Live name', body: '# Live', dependsOn: [], branch: '', filePath: '' },
          { id: 'plan-live-only', name: 'Live only', body: '# Live only', dependsOn: [], branch: '', filePath: '' },
        ],
      } as unknown as EforgeEvent,
    });

    render(<PipelineSection runState={runState} plans={[makePlan({ id: 'plan-live', name: 'REST name', body: '# REST' })]} />);

    const props = threadPipelineMock.mock.calls.at(-1)?.[0] as ComponentProps<typeof ThreadPipeline>;
    expect(props.planPresentation).toMatchObject([
      { id: 'plan-live', name: 'Live name', previewBody: '# REST' },
      { id: 'plan-live-only', name: 'Live only', previewBody: '# Live only' },
      { id: 'plan-resume-only', name: 'Resumed only', previewBody: '# Resume only' },
    ]);
  });
});
