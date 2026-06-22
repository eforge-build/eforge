import * as React from 'react';
import { Bot, Info, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BACKLOG_ANALYSIS_HELP } from './backlog-curation-view-model';

interface AnalyzeBacklogControlProps {
  /** A control mutation (this click's request) is in flight. */
  busy: boolean;
  /** A backlog-curation task is already queued/running - the trigger reflects that instead of inviting a duplicate. */
  analyzing: boolean;
  onAnalyze: () => Promise<unknown>;
}

/** Compact recommendations-rail trigger for server-owned backlog analysis. */
export function AnalyzeBacklogControl({ busy, analyzing, onAnalyze }: AnalyzeBacklogControlProps) {
  const [helpOpen, setHelpOpen] = React.useState(false);
  // A queued/running curation task or an in-flight click both lock the trigger;
  // the running task wins the label so the control reads as "already working".
  const disabled = busy || analyzing;
  return (
    <div className="relative flex items-center gap-1.5">
      <Button
        size="sm"
        className="h-7 flex-1 gap-1 px-2 text-2xs"
        disabled={disabled}
        title={analyzing ? 'Backlog analysis is already running - see Planning activity below' : 'Analyze backlog and refresh recommendations'}
        onClick={() => void onAnalyze()}
      >
        {disabled ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bot className="h-3 w-3" />} {analyzing ? 'Analyzing…' : 'Analyze backlog'}
      </Button>
      <button
        type="button"
        aria-label="About backlog analysis"
        aria-expanded={helpOpen}
        className="grid h-7 w-7 place-items-center rounded border border-border text-muted-foreground hover:text-foreground"
        onClick={() => setHelpOpen((open) => !open)}
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {helpOpen && (
        <div className="absolute right-0 top-8 z-20 w-72 rounded-md border border-border bg-card p-2 text-xs text-foreground shadow-lg">
          {BACKLOG_ANALYSIS_HELP}
        </div>
      )}
    </div>
  );
}
