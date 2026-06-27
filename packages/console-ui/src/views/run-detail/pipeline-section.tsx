import { useMemo } from 'react';
import { ThreadPipeline } from '@/components/pipeline/thread-pipeline';
import { FailureBanner } from '@/components/common/failure-banner';
import type { RunState } from '@/lib/run-state';
import type { CompileScopeContextFailure, PlanInfo } from '@eforge-build/client/browser';
import { compileFailureBannerModel } from '@/lib/compile-resilience-format';

// PlansResponse is PlanInfo[]
type PlansResponse = PlanInfo[];

interface PipelineSectionProps {
  runState: RunState;
  plans: PlansResponse | null;
}

export function PipelineSection({ runState, plans }: PipelineSectionProps) {
  const planArtifacts = useMemo(() => {
    if (plans && plans.length > 0) {
      return plans
        .filter((p) => p.type === 'plan')
        .map((p) => ({ id: p.id, name: p.name, body: p.body }));
    }
    if (runState.resumeArtifacts.length > 0) {
      return runState.resumeArtifacts.map((p) => ({ id: p.id, name: p.name, body: p.body }));
    }
    return undefined;
  }, [plans, runState.resumeArtifacts]);

  const prdSource = useMemo(() => {
    for (const { event } of runState.events) {
      if (event.type === 'planning:start') {
        return { label: event.label ?? 'Build PRD', content: event.source };
      }
    }
    return runState.resumeSource;
  }, [runState.events, runState.resumeSource]);

  const buildFailures = useMemo(() => {
    const failures: Array<{ planId: string; error: string }> = [];
    for (const { event } of runState.events) {
      if (event.type === 'plan:build:failed') {
        const e = event as { type: 'plan:build:failed'; planId: string; error: string };
        failures.push({ planId: e.planId, error: e.error });
      }
    }
    return failures;
  }, [runState.events]);

  const compileFailure = useMemo(() => {
    for (let i = runState.events.length - 1; i >= 0; i--) {
      const { event } = runState.events[i];
      if (event.type === 'planning:scope-context:failure' && event.failure.recovery.attempted !== true) {
        return compileFailureBannerModel(event.failure as CompileScopeContextFailure);
      }
    }
    return null;
  }, [runState.events]);

  const phaseSummary = useMemo(() => {
    for (let i = runState.events.length - 1; i >= 0; i--) {
      const { event } = runState.events[i];
      if (event.type === 'phase:end') {
        const e = event as { type: 'phase:end'; result: { status: string; summary: string } };
        if (e.result.status === 'failed') return e.result.summary;
      }
    }
    return null;
  }, [runState.events]);

  return (
    <div className="flex flex-col gap-3 px-6 py-3">
      <ThreadPipeline
        agentThreads={runState.agentThreads}
        startTime={runState.startTime}
        endTime={runState.endTime}
        planStatuses={runState.planStatuses}
        reviewIssues={runState.reviewIssues}
        events={runState.events}
        orchestration={runState.earlyOrchestration}
        prdSource={prdSource}
        planArtifacts={planArtifacts}
        validationCommands={runState.validationCommands}
        perspectiveErrors={runState.perspectiveErrors}
        reviewIssuesByPerspective={runState.reviewIssuesByPerspective}
        decisions={runState.decisions}
      />
      <FailureBanner failures={buildFailures} phaseSummary={phaseSummary} compileFailure={compileFailure} />
    </div>
  );
}
