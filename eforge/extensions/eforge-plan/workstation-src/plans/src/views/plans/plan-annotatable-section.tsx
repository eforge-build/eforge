import * as React from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { SafeMarkdown } from '@/components/safe-markdown';
import { Button } from '@/components/ui/button';
import type { PlanData, PlanRevisionAnnotationTarget, PlanRevisionSessionProjection } from '@/types';
import { titleCase } from './dimensions';
import { buildBlockAnnotationTarget, buildSectionAnnotationTarget, buildSelectionAnnotationTarget } from './plan-revision-annotation-targets';

interface Props {
  plan: PlanData;
  dimension: string;
  content: string;
  disabled: boolean;
  onCreateAnnotation: (target: PlanRevisionAnnotationTarget, body?: string) => Promise<PlanRevisionSessionProjection | null>;
}

export function AnnotatablePlanSection({ dimension, content, disabled, onCreateAnnotation }: Props) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [hasSelection, setHasSelection] = React.useState(false);
  const [focusedBlock, setFocusedBlock] = React.useState<HTMLElement | null>(null);
  const title = titleCase(dimension);

  const refreshSelection = React.useCallback(() => {
    const root = rootRef.current;
    const target = root ? buildSelectionAnnotationTarget(window.getSelection(), root, dimension, `${title} selection`) : null;
    setHasSelection(Boolean(target));
  }, [dimension, title]);

  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const blocks = Array.from(root.querySelectorAll<HTMLElement>('.plan-prose > *'));
    blocks.forEach((block, index) => {
      block.tabIndex = 0;
      block.setAttribute('role', 'group');
      block.setAttribute('aria-label', `${title} block ${index + 1}`);
      block.dataset.planAnnotationBlock = String(index + 1);
    });
  }, [content, title]);

  React.useEffect(() => {
    document.addEventListener('selectionchange', refreshSelection);
    return () => document.removeEventListener('selectionchange', refreshSelection);
  }, [refreshSelection]);

  const create = async (target: PlanRevisionAnnotationTarget | null) => {
    if (!target) return;
    await onCreateAnnotation(target);
    setHasSelection(false);
  };

  const selectBlock = (event: React.FocusEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) => {
    const element = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-plan-annotation-block]');
    if (element && rootRef.current?.contains(element)) setFocusedBlock(element);
  };

  return (
    <section className="rounded-md border bg-background/50 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h5>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={disabled || !hasSelection} onMouseDown={(event) => event.preventDefault()} onClick={() => void create(rootRef.current ? buildSelectionAnnotationTarget(window.getSelection(), rootRef.current, dimension, `${title} selection`) : null)}>
            <MessageSquarePlus className="h-4 w-4" /> Annotate selection in {title}
          </Button>
          <Button size="sm" variant="outline" disabled={disabled || !focusedBlock} onClick={() => void create(rootRef.current ? buildBlockAnnotationTarget(focusedBlock, rootRef.current, dimension, `${title} focused block`) : null)}>
            Annotate focused block in {title}
          </Button>
          <Button size="sm" variant="outline" disabled={disabled || content.trim().length === 0} onClick={() => void create(buildSectionAnnotationTarget(dimension, title, content))}>
            Annotate section {title}
          </Button>
        </div>
      </div>
      <div ref={rootRef} onFocus={selectBlock} onClick={selectBlock}>
        <SafeMarkdown markdown={content} />
      </div>
    </section>
  );
}
