import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConsoleShell } from '@/components/shell/console-shell';
import { initialConsoleProjectState } from '@/lib/project-state';

const stubState = {
  ...initialConsoleProjectState,
  connectionStatus: 'connected' as const,
};

describe('ConsoleShell layout', () => {
  it('renders the header shell and places children in the main landmark', () => {
    render(
      <ConsoleShell
        projectState={stubState}
        autoBuildToggling={false}
        onSetAutoBuildEnabled={vi.fn()}
      >
        <div data-testid="child">content</div>
      </ConsoleShell>,
    );

    expect(screen.getByRole('banner')).toBeDefined();
    const main = screen.getByRole('main');
    expect(main.querySelector('[data-testid="child"]')).not.toBeNull();
  });
});
