import { useMemo } from 'react';
import { ThreadPipeline } from '@/components/pipeline/thread-pipeline';
import { FailureBanner } from '@/components/common/failure-banner';
import { OrchestrationSummary } from '@/components/map-reduce/orchestration-summary';
import type { RunState } from '@/lib/run-state';
import { buildMapReduceSummary, buildMapReduceTimeline } from '@/lib/run-state';
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
    const livePlans = new Map<string, { name: string; body: string }>();
    for (const { event } of runState.events) {
      if (event.type === 'planning:complete') {
        for (const plan of event.plans) {
          livePlans.set(plan.id, { name: plan.name, body: plan.body });
        }
      }
    }

    const artifacts = new Map<string, { id: string; name: string; body: string }>();
    const add = (id: string, name: string, body: string) => {
      const live = livePlans.get(id);
      const existing = artifacts.get(id);
      artifacts.set(id, {
        id,
        // A live completion is the current declaration, even when a REST
        // snapshot or resumed artifact supplies the preview body.
        name: live?.name || name || existing?.name || id,
        body: body || existing?.body || live?.body || '',
      });
    };

    // Body precedence is REST, then resumed artifacts, then the live event.
    // Merge per canonical ID so a partial source cannot hide another plan.
    for (const plan of livePlans) add(plan[0], plan[1].name, plan[1].body);
    for (const plan of runState.resumeArtifacts) add(plan.id, plan.name, plan.body);
    for (const plan of plans?.filter((plan) => plan.type === 'plan') ?? []) add(plan.id, plan.name, plan.body);

    return artifacts.size > 0 ? [...artifacts.values()] : undefined;
  }, [plans, runState.events, runState.resumeArtifacts]);

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

  // On map/reduce runs the atom/reduce agent threads render inside the pipeline
  // as grouped lanes (Map atoms + one lane per reduce level) instead of one row
  // per member, and the compact orchestration summary rides above the timeline.
  const mapReduceTimeline = useMemo(
    () => (runState.mapReduce ? buildMapReduceTimeline(runState.mapReduce, runState.agentThreads) : null),
    [runState.mapReduce, runState.agentThreads],
  );
  const mapReduceSummary = useMemo(
    () => (runState.mapReduce ? buildMapReduceSummary(runState.mapReduce, runState.agentThreads) : null),
    [runState.mapReduce, runState.agentThreads],
  );

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
        mapReduce={mapReduceTimeline}
      />
      <FailureBanner failures={buildFailures} phaseSummary={phaseSummary} compileFailure={compileFailure} />
      {mapReduceSummary && <OrchestrationSummary summary={mapReduceSummary} />}
    </div>
  );
}
