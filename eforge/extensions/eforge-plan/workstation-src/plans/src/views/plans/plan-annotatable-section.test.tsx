import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PlanData } from '@/types';
import { AnnotatablePlanSection } from './plan-annotatable-section';

const plan: PlanData = { session: 's', topic: 'Topic', status: 'planning', sections: {} };

function renderSection(content: string, onSelect = vi.fn()) {
  render(<AnnotatablePlanSection plan={plan} dimension="design-decisions" content={content} disabled={false} defaultOpen onSelectAnnotationTarget={onSelect} />);
  return onSelect;
}

describe('AnnotatablePlanSection block granularity', () => {
  afterEach(cleanup);

  it('decorates each list item as its own annotation block', async () => {
    renderSection(['- First decision', '- Second decision', '- Third decision'].join('\n'));
    const blocks = await waitFor(() => {
      const found = Array.from(document.querySelectorAll<HTMLElement>('[data-plan-annotation-block]'));
      expect(found).toHaveLength(3);
      return found;
    });
    expect(blocks.map((block) => block.tagName.toLowerCase())).toEqual(['li', 'li', 'li']);
    expect(blocks.map((block) => block.textContent?.trim())).toEqual(['First decision', 'Second decision', 'Third decision']);
  });

  it('captures a single bullet - not the whole list - as the block target', async () => {
    const onSelect = renderSection(['- First decision', '- Second decision'].join('\n'));
    const second = await waitFor(() => {
      const item = Array.from(document.querySelectorAll<HTMLElement>('[data-plan-annotation-block]')).find((block) => block.textContent?.includes('Second decision'));
      expect(item).toBeTruthy();
      return item as HTMLElement;
    });
    fireEvent.focus(second);
    fireEvent.click(await screen.findByRole('button', { name: /Annotate this block in Design Decisions/ }));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'block', dimension: 'design-decisions', capturedText: 'Second decision' }),
      expect.objectContaining({ left: expect.any(Number), top: expect.any(Number) }),
    );
  });

  it('treats a non-list paragraph as a single block', async () => {
    renderSection('A single prose paragraph with no bullets.');
    const blocks = await waitFor(() => {
      const found = Array.from(document.querySelectorAll<HTMLElement>('[data-plan-annotation-block]'));
      expect(found).toHaveLength(1);
      return found;
    });
    expect(blocks[0].tagName.toLowerCase()).toBe('p');
  });
});
