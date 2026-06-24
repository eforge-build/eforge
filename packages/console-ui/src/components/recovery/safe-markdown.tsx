import * as React from 'react';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';

interface SafeMarkdownProps {
  /** Raw markdown source to render. */
  markdown: string;
  className?: string;
  forbidResourceLoading?: boolean;
}

/**
 * Renders untrusted markdown as sanitized HTML inside a `plan-prose` container.
 *
 * Markdown is parsed with `marked` (GFM) and the resulting HTML is passed
 * through `DOMPurify.sanitize` before it is injected, so `<script>` tags and
 * inline event-handler attributes are stripped for Console recovery dialogs.
 */
export function SafeMarkdown({ markdown, className, forbidResourceLoading = false }: SafeMarkdownProps) {
  const html = React.useMemo(() => {
    const marked = new Marked({ gfm: true });
    const raw = marked.parse(markdown, { async: false }) as string;
    // Wrap GFM tables in a horizontal scroll container so wide issue tables
    // (Severity/Category/File/Line/Description/Fix) size to their content and
    // scroll rather than starving short columns into vertical letters.
    const wrapped = raw
      .replace(/<table>/g, '<div class="plan-table-scroll"><table>')
      .replace(/<\/table>/g, '</table></div>');
    return DOMPurify.sanitize(wrapped, forbidResourceLoading ? {
      FORBID_TAGS: ['img', 'picture', 'source', 'video', 'audio', 'object', 'embed', 'svg', 'style', 'link'],
      FORBID_ATTR: ['src', 'srcset', 'style'],
    } : undefined);
  }, [markdown, forbidResourceLoading]);
  // Stable object identity so React only re-applies `innerHTML` when the
  // sanitized HTML actually changes. A fresh `{ __html }` literal on every
  // render makes React's `nextProp !== lastProp` check always true, which
  // tears down and rebuilds the prose DOM on unrelated re-renders and
  // collapses any active text selection - making the body feel un-selectable.
  const innerHtml = React.useMemo(() => ({ __html: html }), [html]);

  return (
    <div
      className={`plan-prose${className ? ` ${className}` : ''}`}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={innerHtml}
    />
  );
}
