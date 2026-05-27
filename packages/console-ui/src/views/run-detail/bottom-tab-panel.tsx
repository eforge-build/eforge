// --- eforge:region plan-06-build-detail-base ---
import { useState, useRef, useCallback, useEffect } from 'react';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { ConsolePanel } from '@/components/console/console-panel';
import type { LowerTab } from '@/components/console/console-panel';
import { Timeline } from '@/components/timeline/timeline';
import { PipelineSection } from './pipeline-section';
import type { RunState } from '@/lib/run-state';
import type { PlanInfo } from '@eforge-build/client/browser';

// PlansResponse is PlanInfo[]
type PlansResponse = PlanInfo[];

interface BottomTabPanelProps {
  runState: RunState;
  plans: PlansResponse | null;
}

const DEFAULT_LAYOUT = [65, 35];

function hasOrchestrationEdges(runState: RunState): boolean {
  if (!runState.earlyOrchestration) return false;
  return runState.earlyOrchestration.plans.some((p) => p.dependsOn.length > 0);
}

export function BottomTabPanel({ runState, plans }: BottomTabPanelProps) {
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
    if (lowerTab === 'changes') {
      return <div className="text-xs text-text-dim italic">Loading...</div>;
    }
    if (lowerTab === 'graph') {
      return <div className="text-xs text-text-dim italic">Graph view coming soon.</div>;
    }
    if (lowerTab === 'plan') {
      return <div className="text-xs text-text-dim italic">Plan view coming soon.</div>;
    }
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
