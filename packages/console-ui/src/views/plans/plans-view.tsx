/**
 * Planning Workspace — top-level route component.
 * Shows a list/sidebar of session plans with a detail panel for the selected plan.
 */
import * as React from 'react';
import { Switch } from '@/components/ui/switch';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { useSessionPlans } from './use-session-plans';
import { SessionPlanList } from './session-plan-list';
import { SessionPlanDetail } from './session-plan-detail';

interface PlansViewProps {
  onNavigate?: (href: string) => void;
}

export function PlansView({ onNavigate }: PlansViewProps) {
  const {
    plans,
    listStatus,
    listError,
    includeSubmitted,
    selectedSession,
    detail,
    detailStatus,
    detailError,
    setIncludeSubmitted,
    selectPlan,
  } = useSessionPlans();

  const isLoading = listStatus === 'loading';
  const isEmpty = listStatus === 'success' && plans.length === 0;
  const hasPlans = listStatus === 'success' && plans.length > 0;
  const emptyText = includeSubmitted
    ? 'No session plans found'
    : 'No actionable session plans found';

  return (
    <div className="flex flex-col h-full">
      {/* Header bar with title and filter toggle */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-border shrink-0">
        <h1 className="text-sm font-semibold text-foreground">Planning Workspace</h1>
        <label className="flex items-center gap-2 ml-auto text-xs text-muted-foreground cursor-pointer select-none">
          Include handed off
          <Switch
            checked={includeSubmitted}
            onCheckedChange={setIncludeSubmitted}
            aria-label="Include handed off"
          />
        </label>
      </div>

      {/* Error banner */}
      {listStatus === 'error' && listError && (
        <div className="px-4 py-2 text-xs text-destructive shrink-0" role="alert">
          {listError}
        </div>
      )}

      {/* Loading indicator */}
      {isLoading && (
        <div className="flex items-center justify-center flex-1 text-xs text-muted-foreground">
          Loading...
        </div>
      )}

      {/* Empty state */}
      {isEmpty && (
        <div className="flex items-center justify-center flex-1 text-xs text-muted-foreground">
          {emptyText}
        </div>
      )}

      {/* Main list + detail layout */}
      {hasPlans && (
        <ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0">
          <ResizablePanel defaultSize={30} minSize={20}>
            <SessionPlanList
              plans={plans}
              selectedSession={selectedSession}
              onSelect={selectPlan}
            />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={70} minSize={30}>
            <SessionPlanDetail
              detail={detail}
              status={detailStatus}
              error={detailError}
              onNavigate={onNavigate}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  );
}
