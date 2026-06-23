import * as React from 'react';
import { Marked, type RendererObject, type Tokens } from 'marked';
import DOMPurify from 'dompurify';
import { createRoot, type Root } from 'react-dom/client';
import { MermaidDiagram } from './mermaid-diagram';

interface SafeMarkdownProps {
  /** Raw markdown source to render. */
  markdown: string;
  className?: string;
}

const MERMAID_PLACEHOLDER_CLASS = 'plan-mermaid-placeholder';
const RESOURCE_LOADING_TAGS = ['img', 'picture', 'source', 'video', 'audio', 'object', 'embed', 'svg', 'style', 'link'];
const RESOURCE_LOADING_ATTRS = ['poster', 'src', 'srcset', 'style'];

interface RenderedMarkdown {
  html: string;
  mermaidBlocks: string[];
}

function isMermaidFenceLanguage(lang?: string): boolean {
  const normalized = (lang ?? '').trim().split(/\s+/)[0]?.toLowerCase();
  return normalized === 'mermaid';
}

function sanitizeMarkdownHtml(raw: string): string {
  const wrapped = raw
    .replace(/<table>/g, '<div class="plan-table-scroll"><table>')
    .replace(/<\/table>/g, '</table></div>');
  return DOMPurify.sanitize(wrapped, {
    ADD_ATTR: ['data-mermaid-index'],
    FORBID_TAGS: RESOURCE_LOADING_TAGS,
    FORBID_ATTR: RESOURCE_LOADING_ATTRS,
  });
}

function renderMarkdown(markdown: string): RenderedMarkdown {
  const mermaidBlocks: string[] = [];
  const renderer: RendererObject = {
    code(token: Tokens.Code) {
      if (!isMermaidFenceLanguage(token.lang)) {
        return false;
      }
      const index = mermaidBlocks.push(token.text) - 1;
      return `<div class="${MERMAID_PLACEHOLDER_CLASS}" data-mermaid-index="${index}"></div>`;
    },
  };
  const marked = new Marked({ gfm: true, renderer });
  const raw = marked.parse(markdown, { async: false }) as string;
  return { html: sanitizeMarkdownHtml(raw), mermaidBlocks };
}

function mountMermaidDiagrams(container: HTMLElement, mermaidBlocks: string[]): Root[] {
  const roots: Root[] = [];
  const placeholders = container.querySelectorAll<HTMLElement>(`.${MERMAID_PLACEHOLDER_CLASS}[data-mermaid-index]`);
  placeholders.forEach((placeholder) => {
    const index = Number(placeholder.dataset.mermaidIndex);
    const source = Number.isInteger(index) ? mermaidBlocks[index] : undefined;
    if (source === undefined) {
      return;
    }
    const root = createRoot(placeholder);
    root.render(<MermaidDiagram source={source} />);
    roots.push(root);
  });
  return roots;
}

/**
 * Renders untrusted markdown as sanitized HTML inside a `plan-prose`
 * container. Mirrors console-ui's SafeMarkdown: parsed with `marked` (GFM),
 * sanitized with `DOMPurify` so script tags and inline event handlers are
 * stripped, and GFM tables wrapped in a horizontal scroll container. Resource
 * loading is always forbidden here - plan drafts have no business embedding
 * images or styles. Mermaid fenced code blocks take a dedicated strict render
 * path and raw SVG remains forbidden in normal Markdown.
 */
export function SafeMarkdown({ markdown, className }: SafeMarkdownProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const rendered = React.useMemo(() => renderMarkdown(markdown), [markdown]);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container || rendered.mermaidBlocks.length === 0) {
      return undefined;
    }
    const roots = mountMermaidDiagrams(container, rendered.mermaidBlocks);
    return () => {
      roots.forEach((root) => root.unmount());
    };
  }, [rendered]);

  return (
    <div
      ref={containerRef}
      className={`plan-prose${className ? ` ${className}` : ''}`}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: rendered.html }}
    />
  );
}
