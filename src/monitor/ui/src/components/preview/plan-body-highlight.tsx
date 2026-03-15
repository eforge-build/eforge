import { useEffect, useRef, useState } from 'react';
import type { Highlighter } from 'shiki';
import { splitPlanContent } from '@/lib/plan-content';

interface PlanBodyHighlightProps {
  content: string;
}

export function PlanBodyHighlight({ content }: PlanBodyHighlightProps) {
  const highlighterRef = useRef<Highlighter | null>(null);
  const [loading, setLoading] = useState(true);
  const [highlightedHtml, setHighlightedHtml] = useState<string>('');

  const { frontmatter, body } = splitPlanContent(content);

  useEffect(() => {
    let cancelled = false;

    async function initHighlighter() {
      if (highlighterRef.current) {
        // Already initialized — just highlight
        highlight(highlighterRef.current);
        return;
      }

      try {
        const { createHighlighter } = await import('shiki');
        const highlighter = await createHighlighter({
          themes: ['github-dark'],
          langs: ['yaml', 'markdown'],
        });

        if (cancelled) return;
        highlighterRef.current = highlighter;
        highlight(highlighter);
      } catch (err) {
        console.error('Failed to initialize shiki:', err);
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    function highlight(highlighter: Highlighter) {
      let html = '';

      if (frontmatter) {
        html += highlighter.codeToHtml(frontmatter, {
          lang: 'yaml',
          theme: 'github-dark',
        });
      }

      if (body) {
        html += highlighter.codeToHtml(body, {
          lang: 'markdown',
          theme: 'github-dark',
        });
      }

      if (!cancelled) {
        setHighlightedHtml(html);
        setLoading(false);
      }
    }

    initHighlighter();

    return () => {
      cancelled = true;
    };
  }, [content]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-text-dim text-xs py-4">
        <div className="w-4 h-4 border-2 border-text-dim border-t-transparent rounded-full animate-spin" />
        Loading syntax highlighter...
      </div>
    );
  }

  if (!highlightedHtml) {
    // Fallback: render as plain preformatted text
    return (
      <pre className="text-xs text-foreground whitespace-pre-wrap break-words overflow-x-auto">
        {content}
      </pre>
    );
  }

  return (
    <div
      className="text-xs overflow-x-auto [&_pre]:!bg-transparent [&_pre]:p-3 [&_pre]:rounded-md [&_pre]:overflow-x-auto [&_code]:text-xs"
      dangerouslySetInnerHTML={{ __html: highlightedHtml }}
    />
  );
}
