import { useState } from 'react';
import { PanelLeftClose, PanelLeft } from 'lucide-react';
import type { AutoBuildState } from '@/lib/api';
import type { DaemonState } from '@/lib/daemon-reducer';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { DaemonStatusPill } from '@/components/daemon/daemon-status-pill';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';

export interface ProjectContext {
  cwd: string | null;
  gitRemote: string | null;
}

interface HeaderProps {
  autoBuildState: AutoBuildState | null;
  autoBuildToggling: boolean;
  onSetAutoBuildEnabled: (enabled: boolean) => void;
  projectContext?: ProjectContext | null;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  daemonState: DaemonState;
}

function extractOwnerRepo(gitRemote: string): string | null {
  const match = gitRemote.match(/(?:github\.com[:/])([^/]+\/[^/.]+?)(?:\.git)?$/);
  return match ? match[1] : null;
}

function getProjectLabel(projectContext: ProjectContext | null | undefined): string | null {
  if (!projectContext) return null;
  if (projectContext.gitRemote) {
    const ownerRepo = extractOwnerRepo(projectContext.gitRemote);
    if (ownerRepo) return ownerRepo;
  }
  if (projectContext.cwd) {
    const parts = projectContext.cwd.split('/');
    return parts[parts.length - 1] || null;
  }
  return null;
}

function getAutoBuildToggleCopy(autoBuildState: AutoBuildState): { label: string; title: string } {
  const mode = autoBuildState.mode ?? 'unknown';
  const desired = autoBuildState.desired ?? 'not reported';
  return {
    label: autoBuildState.mode ? `Auto-build: ${mode}` : 'Auto-build',
    title: `Desired: ${desired}; runtime mode: ${mode}`,
  };
}

export function Header({ autoBuildState, autoBuildToggling, onSetAutoBuildEnabled, projectContext, sidebarCollapsed, onToggleSidebar, daemonState }: HeaderProps) {
  const projectLabel = getProjectLabel(projectContext);
  const autoBuildToggleCopy = autoBuildState ? getAutoBuildToggleCopy(autoBuildState) : null;
  const [enableDialogOpen, setEnableDialogOpen] = useState(false);

  function handleSwitchChange(checked: boolean) {
    if (checked) {
      // Enabling — show confirmation dialog
      setEnableDialogOpen(true);
    } else {
      // Disabling — immediate, no confirmation
      onSetAutoBuildEnabled(false);
    }
  }

  function handleConfirmEnable() {
    setEnableDialogOpen(false);
    onSetAutoBuildEnabled(true);
  }

  function handleCancelEnable() {
    setEnableDialogOpen(false);
  }

  return (
    <header className="col-span-full bg-card border-b border-border px-6 py-3.5 flex items-center gap-3 shadow-sm shadow-black/30">
      <Button variant="ghost" size="icon" onClick={onToggleSidebar} className="h-7 w-7">
        {sidebarCollapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
      </Button>
      <h1 className="text-base font-bold text-text-bright tracking-tight">eforge</h1>
      {projectLabel && (
        <span className="text-xs text-text-dim">
          {projectLabel}
        </span>
      )}
      <div className="ml-auto text-xs flex items-center gap-2">
        <a
          href="/console/"
          className="text-text-dim hover:text-text-bright transition-colors"
        >
          Console
        </a>
        <DaemonStatusPill daemonState={daemonState} />
        {autoBuildState !== null && autoBuildToggleCopy !== null && (
          <div
            className={cn('flex items-center gap-1.5 text-text-dim', autoBuildToggling ? 'cursor-not-allowed opacity-50' : '')}
            title={autoBuildToggleCopy.title}
          >
            <span>{autoBuildToggleCopy.label}</span>
            <Switch
              checked={autoBuildState.enabled}
              onCheckedChange={handleSwitchChange}
              disabled={autoBuildToggling}
              aria-label="Toggle auto-build"
            />
          </div>
        )}
      </div>

      <AlertDialog open={enableDialogOpen} onOpenChange={setEnableDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enable auto-build?</AlertDialogTitle>
            <AlertDialogDescription>
              Queued builds may start immediately if auto-build is enabled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelEnable}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmEnable}>Enable</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </header>
  );
}
