import * as React from 'react';
import { Bot, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import type { BacklogCurationScanMode } from '@/types';
import { curationScanModeLabel, FULL_AUDIT_WARNING, SOURCE_FIRST_DEFAULT_CONCURRENCY, SOURCE_FIRST_MAX_CONCURRENCY } from './backlog-curation-view-model';

interface AnalyzeBacklogControlProps {
  busy: boolean;
  onAnalyze: (input: { scanMode: BacklogCurationScanMode; itemAuditConcurrency?: number }) => Promise<unknown>;
}

/**
 * Compact "Analyze backlog" trigger for the recommendations rail. Analysis is
 * what generates recommendations, so it lives with them rather than on a
 * separate planning surface. The scan mode picks between the default delta
 * curation and a broader full-implementation audit; the audit warning only
 * appears once that heavier mode is chosen.
 */
export function AnalyzeBacklogControl({ busy, onAnalyze }: AnalyzeBacklogControlProps) {
  const [scanMode, setScanMode] = React.useState<BacklogCurationScanMode>('delta');
  const [itemAuditConcurrency, setItemAuditConcurrency] = React.useState(SOURCE_FIRST_DEFAULT_CONCURRENCY);
  const normalizedConcurrency = Math.min(SOURCE_FIRST_MAX_CONCURRENCY, Math.max(1, Math.trunc(itemAuditConcurrency || SOURCE_FIRST_DEFAULT_CONCURRENCY)));
  return (
    <div className="grid gap-1.5 rounded-md border border-primary/30 bg-primary/5 p-2">
      <Select
        value={scanMode}
        onChange={(event) => setScanMode(event.target.value as BacklogCurationScanMode)}
        disabled={busy}
        className="h-7 w-full text-2xs"
        aria-label="Backlog curation mode"
      >
        <option value="delta">{curationScanModeLabel('delta')}</option>
        <option value="full-implementation-audit">{curationScanModeLabel('full-implementation-audit')}</option>
      </Select>
      <Button
        size="sm"
        className="h-7 w-full gap-1 px-2 text-2xs"
        disabled={busy}
        title="Curate the backlog and regenerate recommendations"
        onClick={() => void onAnalyze(scanMode === 'full-implementation-audit' ? { scanMode, itemAuditConcurrency: normalizedConcurrency } : { scanMode })}
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bot className="h-3 w-3" />} Analyze all backlog
      </Button>
      {scanMode === 'full-implementation-audit' && (
        <div className="grid gap-1 rounded border border-amber-400/40 bg-amber-400/10 p-1.5 text-2xs text-amber-100">
          <p>{FULL_AUDIT_WARNING}</p>
          <label className="grid gap-1 text-amber-50">
            <span>Item audit concurrency (default {SOURCE_FIRST_DEFAULT_CONCURRENCY}, max {SOURCE_FIRST_MAX_CONCURRENCY})</span>
            <input
              type="number"
              min={1}
              max={SOURCE_FIRST_MAX_CONCURRENCY}
              step={1}
              value={itemAuditConcurrency}
              disabled={busy}
              onChange={(event) => setItemAuditConcurrency(Number(event.target.value))}
              className="h-7 rounded border border-amber-300/40 bg-background px-2 text-foreground"
            />
          </label>
        </div>
      )}
    </div>
  );
}
