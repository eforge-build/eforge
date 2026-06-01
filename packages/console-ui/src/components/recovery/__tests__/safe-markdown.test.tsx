import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import * as React from 'react';
import { SafeMarkdown } from '../safe-markdown';

describe('SafeMarkdown', () => {
  it('renders markdown inside a plan-prose container', () => {
    const { container } = render(<SafeMarkdown markdown={'# Recovery report\n\nFailed plan summary.'} />);
    const prose = container.querySelector('.plan-prose');
    expect(prose).not.toBeNull();
    expect(container.textContent).toContain('Recovery report');
    expect(container.textContent).toContain('Failed plan summary.');
  });

  it('strips script tags from rendered HTML', () => {
    const { container } = render(
      <SafeMarkdown markdown={'Safe text\n\n<script>window.__pwned = true;</script>'} />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.innerHTML).not.toContain('<script');
    expect(container.textContent).toContain('Safe text');
  });

  it('strips inline event-handler attributes from rendered HTML', () => {
    const { container } = render(
      <SafeMarkdown markdown={'<img src="x" onerror="window.__pwned = true" />'} />,
    );
    expect(container.innerHTML).not.toContain('onerror');
  });
});
