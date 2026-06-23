import * as React from 'react';
import { ChevronRight, MessageSquarePlus } from 'lucide-react';
import { SafeMarkdown } from '@/components/safe-markdown';
import { Button } from '@/components/ui/button';
import type { PlanData, PlanRevisionAnnotationTarget } from '@/types';
import { titleCase } from './dimensions';
import { buildBlockAnnotationTarget, buildSectionAnnotationTarget, buildSelectionAnnotationTarget } from './plan-revision-annotation-targets';
import { SectionEditor } from './section-editor';

interface Props {
  plan: PlanData;
  dimension: string;
  content: string;
  disabled: boolean;
  defaultOpen?: boolean;
  onSaveSection?: (dimension: string, content: string) => Promise<void>;
  onSelectAnnotationTarget: (target: PlanRevisionAnnotationTarget) => void;
}

export function AnnotatablePlanSection({ plan, dimension, content, disabled, defaultOpen = false, onSaveSection, onSelectAnnotationTarget }: Props) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [selectedTarget, setSelectedTarget] = React.useState<PlanRevisionAnnotationTarget | null>(null);
  const [focusedBlockTarget, setFocusedBlockTarget] = React.useState<PlanRevisionAnnotationTarget | null>(null);
  const [expanded, setExpanded] = React.useState(defaultOpen);
  const [editing, setEditing] = React.useState(false);
  const title = titleCase(dimension);
  const hasFocusedBlock = Boolean(focusedBlockTarget);

  const refreshSelection = React.useCallback(() => {
    const root = rootRef.current;
    setSelectedTarget(root ? buildSelectionAnnotationTarget(window.getSelection(), root, dimension, `${title} selection`) : null);
  }, [dimension, title]);

  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (!expanded || !root) return;
    const decorateBlocks = () => {
      const blocks = Array.from(root.querySelectorAll<HTMLElement>('.plan-prose > *'));
      blocks.forEach((block, index) => {
        block.tabIndex = 0;
        block.setAttribute('role', 'group');
        block.setAttribute('aria-label', `${title} block ${index + 1}`);
        block.dataset.planAnnotationBlock = String(index + 1);
      });
    };
    decorateBlocks();
    const observer = new MutationObserver(decorateBlocks);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [content, expanded, title]);

  React.useEffect(() => {
    document.addEventListener('selectionchange', refreshSelection);
    return () => document.removeEventListener('selectionchange', refreshSelection);
  }, [refreshSelection]);

  React.useEffect(() => {
    setExpanded(defaultOpen);
    setEditing(false);
    setSelectedTarget(null);
    setFocusedBlockTarget(null);
  }, [plan.session, dimension, defaultOpen]);

  React.useEffect(() => {
    setSelectedTarget(null);
    setFocusedBlockTarget(null);
  }, [content]);

  React.useEffect(() => {
    if (!expanded || editing) {
      setSelectedTarget(null);
      setFocusedBlockTarget(null);
    }
  }, [editing, expanded]);

  const selectTarget = (target: PlanRevisionAnnotationTarget | null) => {
    if (!target) return;
    onSelectAnnotationTarget(target);
    setSelectedTarget(null);
  };

  const currentBlockTarget = () => focusedBlockTarget;

  const selectBlock = (event: React.FocusEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) => {
    const root = rootRef.current;
    const element = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-plan-annotation-block]');
    if (element && root?.contains(element)) setFocusedBlockTarget(buildBlockAnnotationTarget(element, root, dimension, `${title} focused block`));
  };

  const saveSection = async (nextContent: string) => {
    if (!onSaveSection) return;
    await onSaveSection(dimension, nextContent);
    setEditing(false);
  };

  return (
    <section className="rounded-md border bg-background/50 p-3">
      <button type="button" className="flex w-full flex-wrap items-center gap-2 text-left" aria-label={`Toggle ${title} section`} aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>
        <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`} />
        <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h5>
        <span className="ml-auto text-2xs uppercase tracking-wide text-muted-foreground">{expanded ? 'expanded' : 'collapsed'}</span>
      </button>
      {expanded && (
        <div className="mt-2 grid gap-2">
          <div className="flex flex-wrap justify-end gap-2">
            {onSaveSection && !editing && <Button size="sm" variant="outline" disabled={disabled} onClick={() => setEditing(true)}>Edit {title}</Button>}
            <Button size="sm" variant="outline" disabled={disabled || !selectedTarget} onMouseDown={(event) => event.preventDefault()} onClick={() => selectTarget(selectedTarget ?? (rootRef.current ? buildSelectionAnnotationTarget(window.getSelection(), rootRef.current, dimension, `${title} selection`) : null))}>
              <MessageSquarePlus className="h-4 w-4" /> Annotate selection in {title}
            </Button>
            <Button size="sm" variant="outline" disabled={disabled || content.trim().length === 0 || !hasFocusedBlock} onClick={() => selectTarget(currentBlockTarget())}>
              Annotate focused block in {title}
            </Button>
            <Button size="sm" variant="outline" disabled={disabled || content.trim().length === 0} onClick={() => selectTarget(buildSectionAnnotationTarget(dimension, title, content))}>
              Annotate section {title}
            </Button>
          </div>
          {editing && onSaveSection
            ? <SectionEditor dimension={dimension} disabled={disabled} initialContent={content} onSave={saveSection} onCancel={() => setEditing(false)} />
            : (
              <div ref={rootRef} onFocus={selectBlock} onClick={selectBlock}>
                <SafeMarkdown markdown={content} />
              </div>
            )}
        </div>
      )}
    </section>
  );
}
