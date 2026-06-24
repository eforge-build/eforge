import * as React from 'react';
import { ChevronRight, MessageSquarePlus, Pencil } from 'lucide-react';
import { SafeMarkdown } from '@/components/safe-markdown';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
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

/** A floating annotate affordance pinned to a rect inside the section root. */
interface FloatingAnchor {
  target: PlanRevisionAnnotationTarget;
  top: number;
  left: number;
  /** Bottom edge of the anchored rect - used to flip the pill below a selection near the top. */
  bottom?: number;
}

/**
 * Block-level annotation targets within a rendered prose container. List
 * containers (`ul`/`ol`) are expanded to their direct `li` children so each
 * bullet is independently annotatable; every other top-level node is one block.
 */
function collectAnnotationBlocks(prose: HTMLElement): HTMLElement[] {
  const blocks: HTMLElement[] = [];
  for (const child of Array.from(prose.children) as HTMLElement[]) {
    const tag = child.tagName.toLowerCase();
    if (tag === 'ul' || tag === 'ol') {
      for (const item of Array.from(child.children) as HTMLElement[]) {
        if (item.tagName.toLowerCase() === 'li') blocks.push(item);
      }
    } else {
      blocks.push(child);
    }
  }
  return blocks;
}

/** A ghost icon button with a shadcn tooltip - used for the header actions. */
function IconAction({ label, icon, variant = 'ghost', ...props }: { label: string; icon: React.ReactNode } & React.ComponentProps<typeof Button>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant={variant} aria-label={label} {...props} size="icon-xs">{icon}</Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function AnnotatablePlanSection({ plan, dimension, content, disabled, defaultOpen = false, onSaveSection, onSelectAnnotationTarget }: Props) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [selection, setSelection] = React.useState<FloatingAnchor | null>(null);
  const [block, setBlock] = React.useState<FloatingAnchor | null>(null);
  const [expanded, setExpanded] = React.useState(defaultOpen);
  const [editing, setEditing] = React.useState(false);
  const title = titleCase(dimension);
  const hasContent = content.trim().length > 0;

  const refreshSelection = React.useCallback(() => {
    const root = rootRef.current;
    if (!root || !expanded || editing) return setSelection(null);
    const current = window.getSelection();
    const target = buildSelectionAnnotationTarget(current, root, dimension, `${title} selection`);
    if (!target || !current || current.rangeCount === 0) return setSelection(null);
    const range = current.getRangeAt(0);
    // `Range.getBoundingClientRect` is unavailable in jsdom; fall back to the
    // section origin so the affordance still mounts under test.
    const rect = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null;
    const origin = root.getBoundingClientRect();
    setSelection({
      target,
      top: rect ? rect.top - origin.top : 0,
      bottom: rect ? rect.bottom - origin.top : 0,
      left: rect ? rect.left - origin.left + rect.width / 2 : 0,
    });
  }, [dimension, title, expanded, editing]);

  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (!expanded || !root) return;
    const decorateBlocks = () => {
      const prose = root.querySelector<HTMLElement>('.plan-prose');
      if (!prose) return;
      collectAnnotationBlocks(prose).forEach((node, index) => {
        node.tabIndex = 0;
        node.setAttribute('role', 'group');
        node.setAttribute('aria-label', `${title} block ${index + 1}`);
        node.dataset.planAnnotationBlock = String(index + 1);
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
    setSelection(null);
    setBlock(null);
  }, [plan.session, dimension, defaultOpen]);

  React.useEffect(() => {
    setSelection(null);
    setBlock(null);
  }, [content]);

  React.useEffect(() => {
    if (!expanded || editing) {
      setSelection(null);
      setBlock(null);
    }
  }, [editing, expanded]);

  const selectTarget = (target: PlanRevisionAnnotationTarget | null) => {
    if (!target) return;
    onSelectAnnotationTarget(target);
    setSelection(null);
    setBlock(null);
    window.getSelection()?.removeAllRanges();
  };

  const showBlock = (event: React.SyntheticEvent) => {
    const root = rootRef.current;
    const element = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-plan-annotation-block]');
    if (!root || !element || !root.contains(element)) return;
    const target = buildBlockAnnotationTarget(element, root, dimension, `${title} block`);
    if (!target) return;
    const rect = element.getBoundingClientRect();
    const origin = root.getBoundingClientRect();
    setBlock({ target, top: rect.top - origin.top, left: rect.right - origin.left });
  };

  const saveSection = async (nextContent: string) => {
    if (!onSaveSection) return;
    await onSaveSection(dimension, nextContent);
    setEditing(false);
  };

  // Flip the selection pill below the range when the range sits too close to
  // the section top for the pill to float above it.
  const selectionFlip = selection !== null && selection.top < 32;
  const selectionTop = selection ? (selectionFlip ? selection.bottom ?? selection.top : selection.top) : 0;
  const selectionTransform = selectionFlip ? 'translate(-50%, 6px)' : 'translate(-50%, calc(-100% - 6px))';

  return (
    <TooltipProvider>
      <section className="rounded-md border bg-background/50 p-3">
        <div className="flex w-full items-center gap-2">
          <button type="button" className="flex flex-1 items-center gap-2 text-left" aria-label={`Toggle ${title} section`} aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>
            <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`} />
            <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h5>
          </button>
          {expanded && (
            <div className="flex items-center gap-0.5">
              {onSaveSection && !editing && (
                <IconAction label={`Edit ${title}`} icon={<Pencil className="h-3.5 w-3.5" />} disabled={disabled} onClick={() => setEditing(true)} />
              )}
              <IconAction label={`Annotate the entire ${title} section`} icon={<MessageSquarePlus className="h-3.5 w-3.5" />} disabled={disabled || !hasContent} onClick={() => selectTarget(buildSectionAnnotationTarget(dimension, title, content))} />
            </div>
          )}
        </div>
        {expanded && (editing && onSaveSection
          ? <SectionEditor dimension={dimension} disabled={disabled} initialContent={content} onSave={saveSection} onCancel={() => setEditing(false)} />
          : (
            <div ref={rootRef} className="relative mt-2" onMouseOver={showBlock} onFocus={showBlock} onMouseLeave={() => setBlock(null)}>
              <SafeMarkdown markdown={content} />
              {selection && !disabled && (
                <div className="absolute z-20" style={{ top: selectionTop, left: selection.left, transform: selectionTransform }}>
                  <Button type="button" size="xs" className="shadow-md" onMouseDown={(event) => event.preventDefault()} onClick={() => selectTarget(selection.target)}>
                    <MessageSquarePlus className="h-3.5 w-3.5" /> Annotate
                  </Button>
                </div>
              )}
              {block && !selection && !disabled && (
                <div className="absolute z-10" style={{ top: block.top + 4, left: block.left, transform: 'translateX(-100%)' }}>
                  <IconAction label={`Annotate this block in ${title}`} icon={<MessageSquarePlus className="h-3.5 w-3.5" />} variant="secondary" className="border border-border shadow-sm" onClick={() => selectTarget(block.target)} />
                </div>
              )}
            </div>
          ))}
      </section>
    </TooltipProvider>
  );
}
