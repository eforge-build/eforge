// --- eforge:region plan-06-build-detail-base ---
import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { ConsolePanel } from '@/components/console/console-panel';
import type { LowerTab } from '@/components/console/console-panel';
import { Timeline } from '@/components/timeline/timeline';
import { PipelineSection } from './pipeline-section';
import type { RunState, EforgeEvent } from '@/lib/run-state';
import type { PlanInfo } from '@eforge-build/client/browser';
// --- eforge:region plan-07-build-detail-tabs ---
import { FileHeatmap } from '@/components/heatmap';
import { DependencyGraph } from '@/components/graph';
import { PlanTab } from '@/components/console/plan-tab';
// --- eforge:endregion plan-07-build-detail-tabs ---

// PlansResponse is PlanInfo[]
type PlansResponse = PlanInfo[];

interface BottomTabPanelProps {
  runState: RunState;
  plans: PlansResponse | null;
  /** The session/run ID — passed to FileHeatmap for diff loading. */
  detailId: string;
}

const DEFAULT_LAYOUT = [65, 35];

function hasOrchestrationEdges(runState: RunState): boolean {
  if (!runState.earlyOrchestration) return false;
  return runState.earlyOrchestration.plans.some((p) => p.dependsOn.length > 0);
}

export function BottomTabPanel({ runState, plans, detailId }: BottomTabPanelProps) {
  const [lowerTab, setLowerTab] = useState<LowerTab>('log');
  const [showVerbose, setShowVerbose] = useState(false);
  const [consoleCollapsed, setConsoleCollapsed] = useState(false);

  // Auto-scroll state for the log tab
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setAutoScroll(atBottom);
  }, []);

  const handleEnableAutoScroll = useCallback(() => {
    setAutoScroll(true);
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  // Attach scroll listener — re-run when tab switches so the newly-mounted
  // DOM node gets a fresh listener (scrollRef.current is reassigned by React
  // when the log panel mounts/unmounts on tab change).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll, lowerTab]);

  // Auto-scroll when events change
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [runState.events, autoScroll]);

  const graphEnabled = hasOrchestrationEdges(runState);
  const planEnabled = runState.earlyOrchestration !== null;

  // --- eforge:region plan-07-build-detail-tabs ---
  // Merged plan IDs: plans whose mergeCommit has been recorded
  const mergedPlanIds = useMemo(
    () => new Set(Object.keys(runState.mergeCommits)),
    [runState.mergeCommits],
  );

  // Find most recent planning:pipeline event for PlanTab
  const pipelineEvent = useMemo(() => {
    for (let i = runState.events.length - 1; i >= 0; i--) {
      const e = runState.events[i].event;
      if (e.type === 'planning:pipeline') {
        return e as EforgeEvent & { type: 'planning:pipeline' };
      }
    }
    return null;
  }, [runState.events]);
  // --- eforge:endregion plan-07-build-detail-tabs ---

  const pipelineDefaultSize = consoleCollapsed ? 92 : DEFAULT_LAYOUT[0];
  const consoleDefaultSize = consoleCollapsed ? 8 : DEFAULT_LAYOUT[1];

  const tabContent = (() => {
    if (lowerTab === 'log') {
      return (
        <Timeline
          events={runState.events}
          startTime={runState.startTime}
          showVerbose={showVerbose}
        />
      );
    }
    // --- eforge:region plan-07-build-detail-tabs ---
    if (lowerTab === 'changes') {
      if (runState.fileChanges.size === 0) {
        return (
          <div className="flex items-center justify-center h-full text-xs text-text-dim italic">
            No file changes recorded yet.
          </div>
        );
      }
      return <FileHeatmap runState={runState} sessionId={detailId} />;
    }
    if (lowerTab === 'graph') {
      return (
        <DependencyGraph
          orchestration={runState.earlyOrchestration}
          planStatuses={runState.planStatuses}
          mergedPlanIds={mergedPlanIds}
        />
      );
    }
    if (lowerTab === 'plan') {
      return (
        <PlanTab
          orchestration={runState.earlyOrchestration}
          pipelineEvent={pipelineEvent}
          profile={runState.profile}
        />
      );
    }
    // --- eforge:endregion plan-07-build-detail-tabs ---
    return null;
  })();

  return (
    <ResizablePanelGroup
      orientation="vertical"
      className="h-full"
    >
      {/* Upper panel: pipeline */}
      <ResizablePanel
        id="upper"
        defaultSize={pipelineDefaultSize}
        minSize={20}
        className="overflow-y-auto"
      >
        <PipelineSection runState={runState} plans={plans} />
      </ResizablePanel>

      <ResizableHandle withHandle />

      {/* Lower panel: tabs */}
      <ResizablePanel
        id="console"
        defaultSize={consoleDefaultSize}
        minSize={consoleCollapsed ? 0 : 10}
        className="flex flex-col"
      >
        <ConsolePanel
          activeTab={lowerTab}
          onTabChange={setLowerTab}
          graphEnabled={graphEnabled}
          planEnabled={planEnabled}
          showVerbose={showVerbose}
          onToggleVerbose={setShowVerbose}
          collapsed={consoleCollapsed}
          onToggleCollapse={() => setConsoleCollapsed((v) => !v)}
          scrollRef={scrollRef}
          autoScroll={autoScroll}
          onEnableAutoScroll={handleEnableAutoScroll}
        >
          {tabContent}
        </ConsolePanel>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
// --- eforge:endregion plan-06-build-detail-base ---
