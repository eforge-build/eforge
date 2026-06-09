import * as React from 'react';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';

interface SafeMarkdownProps {
  /** Raw markdown source to render. */
  markdown: string;
  className?: string;
}

/**
 * Renders untrusted markdown as sanitized HTML inside a `plan-prose`
 * container. Mirrors console-ui's SafeMarkdown: parsed with `marked` (GFM),
 * sanitized with `DOMPurify` so script tags and inline event handlers are
 * stripped, and GFM tables wrapped in a horizontal scroll container. Resource
 * loading is always forbidden here - plan drafts have no business embedding
 * images or styles.
 */
export function SafeMarkdown({ markdown, className }: SafeMarkdownProps) {
  const html = React.useMemo(() => {
    const marked = new Marked({ gfm: true });
    const raw = marked.parse(markdown, { async: false }) as string;
    const wrapped = raw
      .replace(/<table>/g, '<div class="plan-table-scroll"><table>')
      .replace(/<\/table>/g, '</table></div>');
    return DOMPurify.sanitize(wrapped, {
      FORBID_TAGS: ['img', 'picture', 'source', 'video', 'audio', 'object', 'embed', 'svg', 'style', 'link'],
      FORBID_ATTR: ['src', 'srcset', 'style'],
    });
  }, [markdown]);

  return (
    <div
      className={`plan-prose${className ? ` ${className}` : ''}`}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
