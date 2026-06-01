// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { PlanInfo } from '@eforge-build/client/browser';
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

describe('PipelineSection', () => {
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
    expect(props.planArtifacts).toEqual([
      { id: 'plan-01-config', name: 'Plan 01 Config', body: '# Plan 01' },
    ]);
  });
});
