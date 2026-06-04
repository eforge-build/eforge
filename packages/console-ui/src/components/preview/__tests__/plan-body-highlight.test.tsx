import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import * as React from 'react';
import { PlanBodyHighlight } from '../plan-body-highlight';

vi.mock('@/lib/shiki', () => ({
  getHighlighter: async () => ({
    getLoadedLanguages: () => [],
    codeToHtml: (text: string) => `<pre><code>${text}</code></pre>`,
  }),
}));

describe('PlanBodyHighlight', () => {
  it('sanitizes raw HTML in markdown previews', async () => {
    const { container } = render(
      <PlanBodyHighlight content={'# PRD\n\n<img src="x" onerror="window.__pwned = true" />\n\n[bad](javascript:alert(1))\n\n<script>alert(1)</script>'} />,
    );

    await waitFor(() => expect(container.querySelector('.plan-prose')).not.toBeNull());

    expect(container.querySelector('script')).toBeNull();
    expect(container.innerHTML).not.toContain('onerror');
    expect(container.innerHTML).not.toContain('javascript:');
  });
});
