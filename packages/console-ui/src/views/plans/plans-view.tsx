/**
 * Planning Workspace — top-level route component.
 * Shows a combined list/sidebar of flat session plans and read-only session
 * plan sets with a detail panel for the selected artifact.
 */
import * as React from 'react';
import { Switch } from '@/components/ui/switch';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { useSessionPlans } from './use-session-plans';
import { SessionPlanList } from './session-plan-list';
import { SessionPlanDetail } from './session-plan-detail';
import { SessionPlanSetDetail } from './session-plan-set-detail';
import { artifactKindFromKey } from './planning-artifacts';

interface PlansViewProps {
  onNavigate?: (href: string) => void;
}

export function PlansView({ onNavigate }: PlansViewProps) {
  const {
    items,
    listStatus,
    listError,
    includeSubmitted,
    selectedKey,
    detail,
    detailStatus,
    detailError,
    setIncludeSubmitted,
    selectArtifact,
  } = useSessionPlans();

  const isLoading = listStatus === 'loading';
  const isEmpty = listStatus === 'success' && items.length === 0;
  const hasItems = listStatus === 'success' && items.length > 0;
  const emptyText = includeSubmitted
    ? 'No session plans found'
    : 'No actionable session plans found';

  const selectedKind = artifactKindFromKey(selectedKey);

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

      {/*
        Main list + detail layout.
        Note: `min-w-0` is set on every panel and propagates down through
        SessionPlanList / SessionPlanDetail / SessionPlanMarkdownPreview.
        Long unbroken tokens (URLs, file paths) in the markdown preview
        would otherwise expand the flex children past the panel width.
        Do not remove `min-w-0` from these ancestors without testing with
        a plan body containing a long unbroken string.
      */}
      {hasItems && (
        <ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0 min-w-0">
          <ResizablePanel defaultSize={30} minSize={20} className="min-w-0 overflow-hidden">
            <SessionPlanList
              items={items}
              selectedKey={selectedKey}
              onSelect={selectArtifact}
            />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={70} minSize={30} className="min-w-0 overflow-hidden">
            {selectedKind === 'plan-set' ? (
              <SessionPlanSetDetail
                detail={detail?.kind === 'plan-set' ? detail.data : null}
                status={detailStatus}
                error={detailError}
              />
            ) : (
              <SessionPlanDetail
                detail={detail?.kind === 'plan' ? detail.data : null}
                status={detailStatus}
                error={detailError}
                onNavigate={onNavigate}
              />
            )}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  );
}
