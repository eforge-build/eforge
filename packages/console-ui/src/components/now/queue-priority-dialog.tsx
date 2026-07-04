/**
 * QueuePriorityDialog — context-rich priority editor for a queued item.
 *
 * Explains the daemon's priority semantics (lower dispatches first within a
 * dependency wave; unprioritized items run last in creation order), offers
 * Front/Back presets computed from sibling priorities, and previews where the
 * item would land among the currently queued items.
 */
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { compareQueueOrder } from '@/lib/selectors/queue-stacks';

/** Minimal sibling projection used to compute presets and the landing preview. */
export interface PrioritySibling {
  id: string;
  title: string;
  priority: number | undefined;
  created: string | undefined;
}

interface QueuePriorityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemId: string;
  itemTitle: string;
  currentPriority?: number;
  /** All forward (pending/waiting) queue items, including this one. */
  siblings?: PrioritySibling[];
  onSetPriority: (id: string, priority: number) => Promise<void> | void;
}

export function QueuePriorityDialog({
  open,
  onOpenChange,
  itemId,
  itemTitle,
  currentPriority,
  siblings = [],
  onSetPriority,
}: QueuePriorityDialogProps) {
  const [value, setValue] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Reset only on the closed → open transition. While the dialog is open an
  // SSE-driven change to `currentPriority` must not clobber the user's typed
  // value, so re-runs caused by the dependency changing are ignored.
  const prevOpenRef = React.useRef(false);
  React.useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;
    if (open && !wasOpen) {
      setValue(currentPriority != null ? String(currentPriority) : '');
      setError(null);
    }
  }, [open, currentPriority]);

  const others = React.useMemo(() => siblings.filter((s) => s.id !== itemId), [siblings, itemId]);
  const definedPriorities = others.map((s) => s.priority).filter((p): p is number => p != null);
  const frontPreset = definedPriorities.length > 0 ? Math.min(...definedPriorities) - 1 : 0;
  const backPreset = definedPriorities.length > 0 ? Math.max(...definedPriorities) + 1 : null;

  const trimmed = value.trim();
  const parsed = Number(trimmed);
  const isValid = trimmed !== '' && Number.isInteger(parsed);

  // Landing preview sorts all forward siblings with the shared within-wave
  // comparator; dependency waves are not modeled here, so the copy below says
  // "ignoring dependency ordering".
  const landing = React.useMemo(() => {
    if (!isValid || others.length === 0) return null;
    const self = siblings.find((s) => s.id === itemId);
    const projected = [...others, { id: itemId, title: itemTitle, priority: parsed, created: self?.created }];
    projected.sort(compareQueueOrder);
    const position = projected.findIndex((s) => s.id === itemId) + 1;
    return { position, total: projected.length };
  }, [isValid, parsed, others, siblings, itemId, itemTitle]);

  async function confirm() {
    if (!isValid) {
      setError('Priority must be an integer.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onSetPriority(itemId, parsed);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Set priority</DialogTitle>
          <DialogDescription>
            Lower numbers run first among items whose dependencies are met. Items without a priority run
            last, in creation order. Priority cannot jump an item ahead of its unmet dependencies.
            Negative values are allowed.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{itemTitle}</span>
            {' · '}
            {currentPriority != null
              ? `current priority ${currentPriority}`
              : 'no priority — runs after prioritized items'}
          </p>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              step={1}
              value={value}
              onChange={(event) => { setValue(event.target.value); setError(null); }}
              disabled={pending}
              aria-label={`Priority for ${itemTitle}`}
              className="h-8 w-24"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => setValue(String(frontPreset))}
            >
              Front
            </Button>
            {backPreset != null && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => setValue(String(backPreset))}
              >
                Back
              </Button>
            )}
          </div>
          {landing && (
            <p className="text-xs text-muted-foreground">
              Will run #{landing.position} of {landing.total} queued items (ignoring dependency ordering).
            </p>
          )}
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={pending || !isValid} onClick={() => void confirm()}>
            {pending ? 'Saving…' : 'Set priority'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
