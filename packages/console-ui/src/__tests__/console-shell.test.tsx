import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ConsoleShell } from '@/components/shell/console-shell';
import { initialConsoleProjectState } from '@/lib/project-state';

const stubState = {
  ...initialConsoleProjectState,
  connectionStatus: 'connected' as const,
};

describe('ConsoleShell', () => {
  it('renders Eforge Console branding text', () => {
    const { getByText } = render(
      <ConsoleShell currentRoute="now" projectState={stubState}>
        <div>content</div>
      </ConsoleShell>,
    );
    expect(getByText('Eforge Console')).toBeDefined();
  });

  it('renders the eforge logo image with non-empty src and alt', () => {
    const { container } = render(
      <ConsoleShell currentRoute="now" projectState={stubState}>
        <div>content</div>
      </ConsoleShell>,
    );
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.src).toBeTruthy();
    expect(img!.alt).toBeTruthy();
  });

  it('renders a link with accessible name containing Monitor and href="/"', () => {
    const { getByRole } = render(
      <ConsoleShell currentRoute="now" projectState={stubState}>
        <div>content</div>
      </ConsoleShell>,
    );
    // Look for a link whose accessible name contains "Monitor"
    const monitorLink = getByRole('link', { name: /monitor/i });
    expect(monitorLink).toBeDefined();
    expect(monitorLink.getAttribute('href')).toBe('/');
  });

  it('renders nav links for all five routes with /console/ scoped hrefs', () => {
    const { getByRole } = render(
      <ConsoleShell currentRoute="now" projectState={stubState}>
        <div>content</div>
      </ConsoleShell>,
    );

    const nowLink = getByRole('link', { name: 'Now' });
    expect(nowLink.getAttribute('href')).toMatch(/^\/console/);

    const queueLink = getByRole('link', { name: 'Queue' });
    expect(queueLink.getAttribute('href')).toBe('/console/queue');

    const runsLink = getByRole('link', { name: 'Runs' });
    expect(runsLink.getAttribute('href')).toBe('/console/runs');

    const systemLink = getByRole('link', { name: 'System' });
    expect(systemLink.getAttribute('href')).toBe('/console/system');

    const activityLink = getByRole('link', { name: 'Activity' });
    expect(activityLink.getAttribute('href')).toBe('/console/activity');
  });
});
