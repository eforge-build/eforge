import * as React from 'react';
import type { FailedEnqueueInfo } from '@eforge-build/client/browser';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface FailedEnqueueRowProps {
  failedEnqueue: FailedEnqueueInfo;
  pending?: boolean;
  pendingAction?: 'reenqueue' | 'dismiss' | null;
  error?: string;
  onReenqueue?: (failedEnqueue: FailedEnqueueInfo) => Promise<void> | void;
  onDismiss?: (failedEnqueue: FailedEnqueueInfo) => Promise<void> | void;
}

function commandLabel(failedEnqueue: FailedEnqueueInfo): string {
  return [failedEnqueue.nextCommand.executable, ...failedEnqueue.nextCommand.args].join(' ');
}

export function FailedEnqueueRow({ failedEnqueue, pending = false, pendingAction = null, error, onReenqueue, onDismiss }: FailedEnqueueRowProps) {
  const [reenqueueOpen, setReenqueueOpen] = React.useState(false);
  const [dismissOpen, setDismissOpen] = React.useState(false);
  const canReenqueue = failedEnqueue.canReenqueue === true && Boolean(onReenqueue);
  const hasControls = Boolean(onDismiss) || canReenqueue;

  return (
    <li className="flex items-start gap-3 rounded-md border border-border/60 bg-background/40 px-3 py-2">
      <Badge variant="outline" className="shrink-0 border-yellow/30 bg-yellow/10 text-yellow text-10px uppercase tracking-wide">
        Enqueue failed
      </Badge>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">{failedEnqueue.sourceLabel}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>{failedEnqueue.failureReason}</span>
          <span>{failedEnqueue.failedAt}</span>
          <code>{failedEnqueue.runId}</code>
          {failedEnqueue.sessionId && <code>{failedEnqueue.sessionId}</code>}
        </div>
        {failedEnqueue.canReenqueue === false && (
          <p className="mt-1 text-xs text-muted-foreground">
            {failedEnqueue.disabledReason ?? 'Re-enqueue is unavailable.'}{' '}
            <code className="rounded bg-muted px-1 py-0.5">{commandLabel(failedEnqueue)}</code>
          </p>
        )}
        {error && <p className="mt-1 text-xs text-destructive" role="alert">{error}</p>}
      </div>
      {hasControls && <div className="flex shrink-0 items-center gap-2">
        {onDismiss && (
          <AlertDialog open={dismissOpen} onOpenChange={setDismissOpen}>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="text-xs" disabled={pending}>
                {pending && pendingAction === 'dismiss' ? 'Dismissing…' : 'Dismiss…'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Dismiss failed enqueue?</AlertDialogTitle>
                <AlertDialogDescription>
                  Hide this warning for {failedEnqueue.sourceLabel} from failed run {failedEnqueue.runId}. This will not re-enqueue the source or start any work.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={pending}
                  onClick={(event) => {
                    event.preventDefault();
                    void Promise.resolve(onDismiss(failedEnqueue)).then(() => setDismissOpen(false));
                  }}
                >
                  Dismiss
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        {canReenqueue && (
          <AlertDialog open={reenqueueOpen} onOpenChange={setReenqueueOpen}>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="text-xs" disabled={pending}>
                {pending && pendingAction !== 'dismiss' ? 'Re-enqueuing…' : 'Re-enqueue…'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Re-enqueue failed source?</AlertDialogTitle>
                <AlertDialogDescription>
                  Re-enqueue {failedEnqueue.sourceLabel} from failed run {failedEnqueue.runId}.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={pending}
                  onClick={(event) => {
                    event.preventDefault();
                    void Promise.resolve(onReenqueue?.(failedEnqueue)).then(() => setReenqueueOpen(false));
                  }}
                >
                  Re-enqueue
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>}
    </li>
  );
}
