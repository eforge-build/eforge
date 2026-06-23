import * as React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SafeMarkdown } from './safe-markdown';

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn(),
  render: vi.fn(),
}));

vi.mock('mermaid', () => ({ default: mermaidMock }));

describe('SafeMarkdown', () => {
  beforeEach(() => {
    mermaidMock.initialize.mockReset();
    mermaidMock.parse.mockReset();
    mermaidMock.render.mockReset();
    mermaidMock.parse.mockResolvedValue(true);
    mermaidMock.render.mockImplementation(async (id: string, source: string) => ({
      svg: `<svg data-render-id="${id}" role="img"><text>${source.includes('Beta') ? 'Beta diagram' : 'Alpha diagram'}</text></svg>`,
    }));
  });

  it('renders GFM markdown as HTML', () => {
    const { container } = render(<SafeMarkdown markdown={'# Title\n\n- one\n- two\n\n`code`'} />);

    expect(container.querySelector('h1')?.textContent).toBe('Title');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelector('code')?.textContent).toBe('code');
  });

  it('strips images, raw SVG, style/link/script tags, resource-loading attributes, and inline event handlers', () => {
    const markdown = [
      'safe text',
      '<script>window.hacked = true;</script>',
      '<style>.bad { background: url(https://evil.test/x.png); }</style>',
      '<link rel="stylesheet" href="https://evil.test/x.css">',
      '<svg><text>bad svg</text></svg>',
      '<img src="https://evil.test/track.png">',
      '<a href="https://example.test" onclick="window.hacked = true" src="https://evil.test/a" srcset="https://evil.test/b" poster="https://evil.test/c" style="color: red">link</a>',
    ].join('\n\n');
    const { container } = render(<SafeMarkdown markdown={markdown} />);

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('style')).toBeNull();
    expect(container.querySelector('link')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')?.getAttribute('onclick')).toBeNull();
    expect(container.querySelector('a')?.getAttribute('src')).toBeNull();
    expect(container.querySelector('a')?.getAttribute('srcset')).toBeNull();
    expect(container.querySelector('a')?.getAttribute('poster')).toBeNull();
    expect(container.querySelector('a')?.getAttribute('style')).toBeNull();
    expect(container.textContent).toContain('safe text');
  });

  it('wraps tables in a horizontal scroll container', () => {
    const { container } = render(<SafeMarkdown markdown={'| a | b |\n| - | - |\n| 1 | 2 |'} />);

    const wrapper = container.querySelector('.plan-table-scroll');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.querySelector('table')).not.toBeNull();
  });

  it('renders valid Mermaid fences as sanitized SVG content', async () => {
    const { container } = render(<SafeMarkdown markdown={'Before\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\nAfter'} />);

    await screen.findByText('Alpha diagram');

    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('pre code')).toBeNull();
    expect(container.textContent).toContain('Before');
    expect(container.textContent).toContain('After');
  });

  it('initializes Mermaid with strict security and no start-on-load before rendering', async () => {
    render(<SafeMarkdown markdown={'```mermaid\nflowchart TD\n  A --> B\n```'} />);

    await waitFor(() => expect(mermaidMock.render).toHaveBeenCalledTimes(1));

    expect(mermaidMock.initialize).toHaveBeenCalledWith(expect.objectContaining({
      securityLevel: 'strict',
      startOnLoad: false,
    }));
    expect(mermaidMock.initialize.mock.invocationCallOrder[0]).toBeLessThan(mermaidMock.render.mock.invocationCallOrder[0]);
  });

  it('uses distinct Mermaid render ids for multiple fences', async () => {
    render(<SafeMarkdown markdown={'```mermaid\nflowchart TD\n  Alpha --> One\n```\n\n```mermaid\nflowchart TD\n  Beta --> Two\n```'} />);

    await waitFor(() => expect(mermaidMock.render).toHaveBeenCalledTimes(2));

    const ids = mermaidMock.render.mock.calls.map(([id]) => id);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((id) => typeof id === 'string' && id.startsWith('eforge-mermaid-'))).toBe(true);
  });

  it('renders an accessible code-block fallback when Mermaid parsing fails', async () => {
    mermaidMock.parse.mockRejectedValueOnce(new Error('Parse failed'));
    render(<SafeMarkdown markdown={'```mermaid\nnot valid mermaid\n```'} />);

    expect((await screen.findByRole('alert')).textContent).toContain('Unable to render Mermaid diagram');
    expect(screen.getByRole('group', { name: 'Mermaid diagram failed to render' })).not.toBeNull();
    expect(screen.getByLabelText('Mermaid source fallback').textContent).toContain('not valid mermaid');
  });

  it('removes unsafe script, link, and resource content returned by Mermaid rendering', async () => {
    mermaidMock.render.mockResolvedValueOnce({
      svg: [
        '<svg role="img">',
        '<script>evilScript()</script>',
        '<a href="javascript:evilLink()"><text>bad link</text></a>',
        '<foreignObject><div>bad foreign</div></foreignObject>',
        '<image href="https://evil.test/track.png" />',
        '<text onclick="evilClick()" style="fill: red">safe node</text>',
        '</svg>',
      ].join(''),
    });
    const { container } = render(<SafeMarkdown markdown={'```mermaid\nflowchart TD\n  A --> B\n```'} />);

    await screen.findByText('safe node');

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('foreignObject')).toBeNull();
    expect(container.querySelector('image')).toBeNull();
    expect(container.textContent).not.toContain('bad link');
    expect(container.textContent).not.toContain('bad foreign');
    expect(container.querySelector('text')?.getAttribute('onclick')).toBeNull();
    expect(container.querySelector('text')?.getAttribute('style')).toBeNull();
  });
});
