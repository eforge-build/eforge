import * as React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SafeMarkdown } from './safe-markdown';

describe('SafeMarkdown', () => {
  it('renders GFM markdown as HTML', () => {
    const { container } = render(<SafeMarkdown markdown={'# Title\n\n- one\n- two\n\n`code`'} />);

    expect(container.querySelector('h1')?.textContent).toBe('Title');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelector('code')?.textContent).toBe('code');
  });

  it('strips script tags, event handlers, and resource-loading tags', () => {
    const markdown = [
      'safe text',
      '<script>window.hacked = true;</script>',
      '<img src="https://evil.test/track.png">',
      '<a href="https://example.test" onclick="window.hacked = true">link</a>',
    ].join('\n\n');
    const { container } = render(<SafeMarkdown markdown={markdown} />);

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')?.getAttribute('onclick')).toBeNull();
    expect(container.textContent).toContain('safe text');
  });

  it('wraps tables in a horizontal scroll container', () => {
    const { container } = render(<SafeMarkdown markdown={'| a | b |\n| - | - |\n| 1 | 2 |'} />);

    const wrapper = container.querySelector('.plan-table-scroll');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.querySelector('table')).not.toBeNull();
  });
});
