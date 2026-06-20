import * as React from 'react';
import { Header } from '@/components/header/header';
import type { ConsoleProjectState } from '@/lib/project-state';

interface ConsoleShellProps {
  projectState: ConsoleProjectState;
  autoBuildToggling: boolean;
  onSetAutoBuildEnabled: (enabled: boolean) => void;
  schedulerToggling: boolean;
  schedulerError: string | null;
  onPauseScheduler: () => void;
  onResumeScheduler: () => void;
  children: React.ReactNode;
  onNavigate?: (href: string) => void;
}

export function ConsoleShell({
  projectState,
  autoBuildToggling,
  onSetAutoBuildEnabled,
  schedulerToggling,
  schedulerError,
  onPauseScheduler,
  onResumeScheduler,
  children,
  onNavigate,
}: ConsoleShellProps) {
  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background text-foreground">
      <Header
        projectState={projectState}
        autoBuildToggling={autoBuildToggling}
        onSetAutoBuildEnabled={onSetAutoBuildEnabled}
        schedulerToggling={schedulerToggling}
        schedulerError={schedulerError}
        onPauseScheduler={onPauseScheduler}
        onResumeScheduler={onResumeScheduler}
        onNavigate={onNavigate}
      />
      <main className="flex-1 overflow-auto p-4">
        {children}
      </main>
    </div>
  );
}
