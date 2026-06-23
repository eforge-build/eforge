import * as React from 'react';
import DOMPurify from 'dompurify';

interface MermaidDiagramProps {
  /** Raw Mermaid diagram source from a fenced code block. */
  source: string;
}

type MermaidApi = typeof import('mermaid')['default'];

type MermaidRenderResult = string | { svg: string };

const STRICT_MERMAID_CONFIG = {
  securityLevel: 'strict',
  startOnLoad: false,
} as const;

const MAX_MERMAID_SOURCE_LENGTH = 12_000;

let mermaidIdCounter = 0;
let mermaidRenderQueue = Promise.resolve();

function nextMermaidRenderId(): string {
  mermaidIdCounter += 1;
  return `eforge-mermaid-${mermaidIdCounter}`;
}

async function loadMermaid(): Promise<MermaidApi> {
  const module = await import('mermaid');
  return module.default;
}

function sanitizeMermaidSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: [
      'a',
      'audio',
      'embed',
      'foreignObject',
      'foreignobject',
      'iframe',
      'image',
      'link',
      'object',
      'picture',
      'script',
      'source',
      'style',
      'video',
    ],
    FORBID_CONTENTS: ['a', 'foreignObject', 'foreignobject', 'link', 'script'],
    FORBID_ATTR: ['href', 'poster', 'src', 'srcset', 'style', 'xlink:href'],
  });
}

function getRenderedSvg(result: MermaidRenderResult): string {
  return typeof result === 'string' ? result : result.svg;
}

async function enqueueMermaidRender<T>(task: () => Promise<T>): Promise<T> {
  const run = mermaidRenderQueue.then(task, task);
  mermaidRenderQueue = run.then(() => undefined, () => undefined);
  return run;
}

type DiagramState =
  | { kind: 'loading' }
  | { kind: 'rendered'; svg: string }
  | { kind: 'error'; message: string };

/**
 * Lazily renders one Mermaid fenced block with Mermaid's strict mode enabled,
 * then sanitizes the returned SVG before injecting it into the workstation DOM.
 */
export function MermaidDiagram({ source }: MermaidDiagramProps) {
  const renderId = React.useMemo(nextMermaidRenderId, []);
  const [state, setState] = React.useState<DiagramState>({ kind: 'loading' });

  React.useEffect(() => {
    let cancelled = false;

    async function renderDiagram() {
      setState({ kind: 'loading' });
      if (source.length > MAX_MERMAID_SOURCE_LENGTH) {
        setState({ kind: 'error', message: `Mermaid source exceeds ${MAX_MERMAID_SOURCE_LENGTH} characters.` });
        return;
      }
      try {
        const svg = await enqueueMermaidRender(async () => {
          const mermaid = await loadMermaid();
          mermaid.initialize(STRICT_MERMAID_CONFIG);
          await mermaid.parse(source);
          const result = await mermaid.render(renderId, source);
          return sanitizeMermaidSvg(getRenderedSvg(result));
        });
        if (!svg.includes('<svg')) {
          throw new Error('Mermaid did not return SVG output.');
        }
        if (!cancelled) {
          setState({ kind: 'rendered', svg });
        }
      } catch (error) {
        if (!cancelled) {
          setState({ kind: 'error', message: error instanceof Error ? error.message : 'Mermaid rendering failed.' });
        }
      }
    }

    void renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [renderId, source]);

  if (state.kind === 'rendered') {
    return (
      <figure className="plan-mermaid" role="img" aria-label="Mermaid diagram">
        <div
          className="plan-mermaid-svg"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: state.svg }}
        />
      </figure>
    );
  }

  if (state.kind === 'error') {
    return (
      <figure className="plan-mermaid plan-mermaid-error" role="group" aria-label="Mermaid diagram failed to render">
        <div role="alert">Unable to render Mermaid diagram: {state.message}</div>
        <pre aria-label="Mermaid source fallback"><code>{source}</code></pre>
      </figure>
    );
  }

  return <div className="plan-mermaid plan-mermaid-loading" role="status" aria-label="Rendering Mermaid diagram">Rendering diagram…</div>;
}
