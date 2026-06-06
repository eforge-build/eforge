import { describe, it, expect } from 'vitest';

import eforgeExtension from '../packages/pi-eforge/extensions/eforge/index.js';

interface CapturedPiTool {
  name: string;
  parameters?: { properties?: Record<string, unknown>; required?: string[] };
  renderResult?: (result: { content: Array<{ type: string; text?: string }> }, options: { expanded: boolean }, theme: TestTheme) => { render(width: number): string[] };
}

interface TestTheme {
  fg(color: string, text: string): string;
  bold(text: string): string;
}

function captureStatusTool(): CapturedPiTool {
  const tools = new Map<string, CapturedPiTool>();
  const pi = {
    on: () => {},
    registerTool: (tool: CapturedPiTool) => tools.set(tool.name, tool),
    registerCommand: () => {},
    sendUserMessage: () => {},
  };

  eforgeExtension(pi as never);
  const statusTool = tools.get('eforge_status');
  expect(statusTool, 'eforge_status tool should be registered').toBeDefined();
  return statusTool!;
}

const theme: TestTheme = {
  fg(color, text) {
    return `[${color}]${text}[/${color}]`;
  },
  bold(text) {
    return `**${text}**`;
  },
};

function textResult(payload: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

function renderStatus(
  payload: unknown,
  options: { expanded?: boolean } = {},
): string {
  const rendered = captureStatusTool().renderResult!(
    textResult(payload),
    { expanded: options.expanded ?? false },
    theme,
  );
  return rendered.render(240).map((line) => line.trimEnd()).join('\n').trim();
}

describe('Pi eforge_status renderer', () => {
  it('keeps the eforge_status name and empty parameter schema', () => {
    const statusTool = captureStatusTool();

    expect(statusTool.name).toBe('eforge_status');
    expect(statusTool.parameters?.properties ?? {}).toEqual({});
    expect(statusTool.parameters?.required ?? []).toEqual([]);
  });

  it('renders idle and empty-build payloads as muted no-active-sessions text', () => {
    expect(renderStatus({ status: 'idle', message: 'No active eforge sessions.' })).toContain(
      '[muted]⊘ No active sessions[/muted]',
    );
    expect(renderStatus({ status: 'active', builds: [] })).toContain(
      '[muted]⊘ No active sessions[/muted]',
    );
  });

  it('renders a single build with activity, plans, event counts, and expanded runs', () => {
    const output = renderStatus(
      {
        status: 'active',
        builds: [
          {
            sessionId: 'session-1',
            runId: 'run-1',
            command: 'eforge build prd.md',
            status: 'running',
            currentPhase: 'building',
            currentAgent: 'builder',
            duration: { startedAt: '2026-01-01T00:00:00Z', completedAt: null, seconds: 65 },
            plans: [
              { id: 'plan-a', status: 'completed', branch: null, dependsOn: [] },
              { id: 'plan-b', status: 'failed', branch: null, dependsOn: [] },
              { id: 'plan-c', status: 'waiting', branch: null, dependsOn: [] },
            ],
            eventCounts: { total: 12, errors: 2 },
            runs: [
              { id: 'run-1', command: 'eforge build prd.md', status: 'running', startedAt: '2026-01-01T00:00:00Z', completedAt: null },
              { id: 'run-0', command: 'eforge retry', status: 'completed', startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:01:00Z' },
            ],
          },
        ],
      },
      { expanded: true },
    );

    expect(output).toContain('[warning]⟳ running[/warning]');
    expect(output).toContain('[dim]  1m 5s[/dim]');
    expect(output).toContain('[accent]  ▸ building › builder[/accent]');
    expect(output).toContain('[dim]  1/3 plans[/dim]');
    expect(output).toContain('[success]✓[/success] [text]plan-a[/text]');
    expect(output).toContain('[error]✗[/error] [text]plan-b[/text]');
    expect(output).toContain('[muted]○[/muted] [text]plan-c[/text]');
    expect(output).toContain('[dim]12 events[/dim][error] · 2 errors[/error]');
    expect(output).toContain('[muted]  Runs:[/muted]');
    expect(output).toContain('[warning]⟳[/warning] [text]eforge build prd.md[/text] [dim](running)[/dim]');
    expect(output).toContain('[success]✓[/success] [text]eforge retry[/text] [dim](completed)[/dim]');
  });

  it('renders multiple builds with summary, command, session, activity, plans, and errors', () => {
    const output = renderStatus({
      status: 'active',
      builds: [
        {
          sessionId: 'session-a',
          runId: 'run-a',
          command: 'eforge build a.md',
          status: 'running',
          currentPhase: 'planning',
          currentAgent: 'planner',
          plans: [{ id: 'plan-a', status: 'completed', branch: null, dependsOn: [] }],
          eventCounts: { total: 4, errors: 0 },
        },
        {
          sessionId: 'session-b',
          runId: 'run-b',
          command: 'eforge build b.md',
          status: 'running',
          currentPhase: 'review',
          currentAgent: 'reviewer',
          plans: [
            { id: 'plan-b1', status: 'completed', branch: null, dependsOn: [] },
            { id: 'plan-b2', status: 'running', branch: null, dependsOn: [] },
          ],
          eventCounts: { total: 9, errors: 1 },
        },
      ],
    });

    expect(output).toContain('[warning]⟳ 2 builds running[/warning]');
    expect(output).toContain('[accent]  ▸ eforge build a.md[/accent]');
    expect(output).toContain('[dim]    session-a[/dim]');
    expect(output).toContain('[dim]    planning › planner[/dim]');
    expect(output).toContain('[dim]    1/1 plans[/dim]');
    expect(output).toContain('[accent]  ▸ eforge build b.md[/accent]');
    expect(output).toContain('[dim]    session-b[/dim]');
    expect(output).toContain('[dim]    review › reviewer[/dim]');
    expect(output).toContain('[dim]    1/2 plans[/dim]');
    expect(output).toContain('[error]    1 errors[/error]');
  });

  it('preserves raw-text parse fallback and no-data non-text behavior', () => {
    const statusTool = captureStatusTool();

    const rawText = statusTool.renderResult!(
      { content: [{ type: 'text', text: 'not json' }] },
      { expanded: false },
      theme,
    );
    expect(rawText.render(80).join('\n')).toContain('[muted]not json[/muted]');

    const noData = statusTool.renderResult!(
      { content: [{ type: 'image' }] },
      { expanded: false },
      theme,
    );
    expect(noData.render(80).join('\n')).toContain('[muted]No data[/muted]');
  });
});
