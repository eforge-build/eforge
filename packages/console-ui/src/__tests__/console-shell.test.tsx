import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ConsoleShell } from '@/components/shell/console-shell';
import { initialConsoleProjectState } from '@/lib/project-state';

const stubState = {
  ...initialConsoleProjectState,
  connectionStatus: 'connected' as const,
};

describe('ConsoleShell', () => {
  it('renders a <header> element as the first child of the shell root', () => {
    const { container } = render(
      <ConsoleShell projectState={stubState}>
        <div>content</div>
      </ConsoleShell>,
    );
    const shellRoot = container.firstElementChild;
    const firstChild = shellRoot?.firstElementChild;
    expect(firstChild?.tagName.toLowerCase()).toBe('header');
  });

  it('renders children inside a <main> element', () => {
    const { getByRole } = render(
      <ConsoleShell projectState={stubState}>
        <div data-testid="child">content</div>
      </ConsoleShell>,
    );
    const main = getByRole('main');
    expect(main).toBeDefined();
    expect(main.querySelector('[data-testid="child"]')).not.toBeNull();
  });

  it('does not render the legacy sidebar navigation element', () => {
    const { queryByRole } = render(
      <ConsoleShell projectState={stubState}>
        <div>content</div>
      </ConsoleShell>,
    );
    // The old sidebar rendered as <aside aria-label="Console navigation">
    expect(queryByRole('complementary', { name: /console navigation/i })).toBeNull();
  });

  it('does not render the legacy bottom status strip', () => {
    const { queryByLabelText } = render(
      <ConsoleShell projectState={stubState}>
        <div>content</div>
      </ConsoleShell>,
    );
    // The old status strip had aria-label="connection and daemon status"
    expect(queryByLabelText('connection and daemon status')).toBeNull();
  });

  it('does not render any <aside> element', () => {
    const { container } = render(
      <ConsoleShell projectState={stubState}>
        <div>content</div>
      </ConsoleShell>,
    );
    expect(container.querySelector('aside')).toBeNull();
  });

  it('does not render any <footer> element', () => {
    const { container } = render(
      <ConsoleShell projectState={stubState}>
        <div>content</div>
      </ConsoleShell>,
    );
    expect(container.querySelector('footer')).toBeNull();
  });
});
