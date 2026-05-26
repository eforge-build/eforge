import * as React from 'react';
import { Sidebar } from './sidebar';
import { StatusStrip } from './status-strip';
import type { ConsoleRouteId } from '@/lib/navigation';
import type { ConsoleProjectState } from '@/lib/project-state';

interface ConsoleShellProps {
  currentRoute: ConsoleRouteId;
  projectState: ConsoleProjectState;
  children: React.ReactNode;
  onNavigate?: (href: string) => void;
}

export function ConsoleShell({
  currentRoute,
  projectState,
  children,
  onNavigate,
}: ConsoleShellProps) {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Sidebar */}
      <Sidebar
        currentRoute={currentRoute}
        connectionStatus={projectState.connectionStatus}
        onNavigate={onNavigate}
      />

      {/* Main area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Route content */}
        <main className="flex-1 overflow-auto p-4">
          {children}
        </main>

        {/* Status strip at the bottom */}
        <StatusStrip projectState={projectState} />
      </div>
    </div>
  );
}
