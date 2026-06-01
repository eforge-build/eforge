import * as React from 'react';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';

interface SafeMarkdownProps {
  /** Raw markdown source to render. */
  markdown: string;
  className?: string;
}

/**
 * Renders untrusted markdown as sanitized HTML inside a `plan-prose` container.
 *
 * Markdown is parsed with `marked` (GFM) and the resulting HTML is passed
 * through `DOMPurify.sanitize` before it is injected, so `<script>` tags and
 * inline event-handler attributes are stripped. Mirrors the rendering pattern
 * used by the legacy Monitor recovery sidecar sheet.
 */
export function SafeMarkdown({ markdown, className }: SafeMarkdownProps) {
  const html = React.useMemo(() => {
    const marked = new Marked({ gfm: true });
    const raw = marked.parse(markdown, { async: false }) as string;
    return DOMPurify.sanitize(raw);
  }, [markdown]);

  return (
    <div
      className={`plan-prose${className ? ` ${className}` : ''}`}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
