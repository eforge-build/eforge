import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  RecoveryVerdictChip,
  asVerdict,
  asConfidence,
} from '@/components/recovery/verdict-chip';
import type { NowAttentionItem } from '@/lib/selectors/now';
import { formatQueueDispatchFailure } from '@/lib/selectors/queue-dispatch-failure';
import { TrustConfirmDialog } from '@/components/extensions/trust-confirm-dialog';
import { cn } from '@/lib/utils';

interface AttentionPanelProps {
  items: NowAttentionItem[];
  hiddenCount: number;
  /** Card heading. Defaults to "Attention". */
  title?: string;
  /**
   * When provided, items carrying a `recovery` payload render a "Recover…"
   * button that invokes this with that payload (the host opens the recovery
   * dialog). The attention strip owns the recovery action for failed PRDs.
   */
  onRecover?: (recovery: NonNullable<NowAttentionItem['recovery']>) => void;
  /**
   * Trust controls for extension-trust items. When provided, items carrying an
   * `extensionTrust` payload render a Trust/Re-trust button (disabled while that
   * path's mutation is pending) and any per-path error. The strip owns the trust
   * action so the user never has to leave Now to clear the warning.
   */
  extensionTrust?: {
    pendingPath: string | null;
    errors: Record<string, string>;
    onTrust: (payload: NonNullable<NowAttentionItem['extensionTrust']>) => void;
  };
}

const SEVERITY_RANK: Record<NowAttentionItem['severity'], number> = {
  critical: 2,
  warning: 1,
  info: 0,
};

/** Card accent keyed to the highest-severity item, so the panel reads as more
 *  or less urgent at a glance instead of as uniform chrome. */
function panelAccent(items: NowAttentionItem[]): string {
  const top = items.reduce<NowAttentionItem['severity']>(
    (acc, item) => (SEVERITY_RANK[item.severity] > SEVERITY_RANK[acc] ? item.severity : acc),
    'info',
  );
  if (top === 'critical') return 'border-l-2 border-l-destructive bg-destructive/5';
  if (top === 'warning') return 'border-l-2 border-l-yellow bg-yellow/5';
  return 'border-l-2 border-l-blue/60 bg-blue/5';
}

/** Severity tag for daemon/health items. `default` is the green primary, which
 *  reads as success — so warning gets an explicit amber outline instead. */
function SeverityTag({ severity }: { severity: NowAttentionItem['severity'] }) {
  if (severity === 'critical') {
    return <Badge variant="destructive" className="shrink-0 capitalize">Critical</Badge>;
  }
  if (severity === 'warning') {
    return (
      <Badge variant="outline" className="shrink-0 capitalize border-yellow/30 bg-yellow/10 text-yellow">
        Warning
      </Badge>
    );
  }
  return <Badge variant="secondary" className="shrink-0 capitalize">Info</Badge>;
}

/** A failed PRD awaiting a recovery decision. */
function RecoveryRow({
  recovery,
  onRecover,
}: {
  recovery: NonNullable<NowAttentionItem['recovery']>;
  onRecover?: (recovery: NonNullable<NowAttentionItem['recovery']>) => void;
}) {
  // Validate the wire strings before rendering the chip; an unrecognized
  // verdict/confidence degrades to "analysis pending" rather than a chip with
  // no color classes.
  const verdict = asVerdict(recovery.verdict);
  const confidence = asConfidence(recovery.confidence);
  const dispatchDetail = formatQueueDispatchFailure(recovery.dispatchFailure);
  return (
    <li className="flex items-center gap-3 rounded-md border border-border/60 bg-background/40 px-3 py-2">
      <Badge
        variant="outline"
        className="shrink-0 border-red/30 bg-red/10 text-red text-10px uppercase tracking-wide"
      >
        Failed
      </Badge>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-foreground">{recovery.prdTitle}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {dispatchDetail && <span>{dispatchDetail}</span>}
          {verdict && confidence ? (
            <>
              <span>{dispatchDetail ? 'Suggested' : 'Suggested'}</span>
              <RecoveryVerdictChip verdict={verdict} confidence={confidence} />
            </>
          ) : !dispatchDetail ? (
            <span>Recovery analysis pending</span>
          ) : null}
        </div>
      </div>
      {onRecover && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 text-xs"
          onClick={() => onRecover(recovery)}
        >
          Recover…
        </Button>
      )}
    </li>
  );
}

/** An untrusted/changed project-team extension, trusted directly from the strip. */
function ExtensionTrustRow({
  item,
  controls,
}: {
  item: NowAttentionItem;
  controls?: NonNullable<AttentionPanelProps['extensionTrust']>;
}) {
  const trust = item.extensionTrust!;
  const pending = controls?.pendingPath === trust.path;
  // Any in-flight trust mutation disables every trust control: the mutation hook
  // serializes trust calls, so other rows would silently no-op if left clickable.
  const anyPending = controls?.pendingPath != null;
  const error = controls?.errors[trust.path];
  return (
    <li className="flex items-start gap-3 rounded-md border border-border/60 bg-background/40 px-3 py-2">
      <SeverityTag severity={item.severity} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">{item.message}</p>
        {item.detail && <p className="truncate text-xs text-muted-foreground">{item.detail}</p>}
        {error && (
          <p className="mt-0.5 text-xs text-destructive" role="alert">{error}</p>
        )}
      </div>
      {controls?.onTrust && (
        <TrustConfirmDialog
          name={trust.name}
          path={trust.path}
          trustState={trust.trustState}
          actionLabel={trust.actionLabel}
          onConfirm={() => controls.onTrust(trust)}
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 text-xs"
            disabled={anyPending}
          >
            {pending ? 'Trusting…' : trust.actionLabel}
          </Button>
        </TrustConfirmDialog>
      )}
    </li>
  );
}

/** A daemon/stream health alert (no per-PRD action). */
function HealthRow({ item }: { item: NowAttentionItem }) {
  return (
    <li className="flex items-start gap-3 rounded-md border border-border/60 bg-background/40 px-3 py-2">
      <SeverityTag severity={item.severity} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">{item.message}</p>
        {item.detail && <p className="truncate text-xs text-muted-foreground">{item.detail}</p>}
      </div>
    </li>
  );
}

export function AttentionPanel({ items, hiddenCount, title = 'Attention', onRecover, extensionTrust }: AttentionPanelProps) {
  if (items.length === 0) return null;

  return (
    <Card className={cn(panelAccent(items))}>
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <ul className="space-y-2">
          {items.map((item) =>
            item.extensionTrust ? (
              <ExtensionTrustRow key={item.id} item={item} controls={extensionTrust} />
            ) : item.recovery ? (
              <RecoveryRow key={item.id} recovery={item.recovery} onRecover={onRecover} />
            ) : (
              <HealthRow key={item.id} item={item} />
            ),
          )}
        </ul>
        {hiddenCount > 0 && (
          <p className="text-xs text-muted-foreground mt-2">
            + {hiddenCount} more item{hiddenCount > 1 ? 's' : ''} hidden
          </p>
        )}
      </CardContent>
    </Card>
  );
}
