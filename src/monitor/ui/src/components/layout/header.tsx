import type { AutoBuildState } from '@/lib/api';
import type { ConnectionStatus } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';

interface HeaderProps {
  connectionStatus: ConnectionStatus;
  autoBuildState: AutoBuildState | null;
  autoBuildToggling: boolean;
  onToggleAutoBuild: () => void;
}

export function Header({ connectionStatus, autoBuildState, autoBuildToggling, onToggleAutoBuild }: HeaderProps) {
  return (
    <header className="col-span-full bg-card border-b border-border px-6 py-3.5 flex items-center gap-3 shadow-sm shadow-black/30">
      <h1 className="text-base font-bold text-text-bright tracking-tight">eforge monitor</h1>
      <div className="ml-auto text-xs flex items-center gap-2">
        {autoBuildState !== null && (
          <label className={cn('flex items-center gap-1.5 text-text-dim', autoBuildToggling ? 'cursor-not-allowed opacity-50' : 'cursor-pointer')}>
            <span>Auto-build</span>
            <Switch
              checked={autoBuildState.enabled}
              onCheckedChange={onToggleAutoBuild}
              disabled={autoBuildToggling}
            />
          </label>
        )}
        <div
          className={cn(
            'w-2 h-2 rounded-full',
            connectionStatus === 'connected' && 'bg-green',
            connectionStatus === 'connecting' && 'bg-yellow animate-[pulse-opacity_1.5s_ease-in-out_infinite]',
            connectionStatus === 'disconnected' && 'bg-text-dim',
          )}
        />
        <span className="text-text-dim">{connectionStatus}</span>
      </div>
    </header>
  );
}
