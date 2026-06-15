import { describe, expect, it } from 'vitest';
import type { ConsoleWorkstation, EforgeExtensionAPI } from '../packages/extension-sdk/src/index.js';
import eforgePlanExtension from '../eforge/extensions/eforge-plan/index.js';

describe('eforge-plan Console workstation dogfood registration', () => {
  it('registers the planning workstation as a frame bundle with planning actions', () => {
    const workstations: ConsoleWorkstation[] = [];
    const api = {
      registerAction() {},
      registerInputSource() {},
      registerConsoleContribution() {},
      registerConsoleWorkstation(workstation: ConsoleWorkstation) {
        workstations.push(workstation);
      },
      registerIntegrationCommand() {},
      registerDeepLink() {},
      onEvent() {},
    } as unknown as EforgeExtensionAPI;

    eforgePlanExtension(api);

    expect(workstations).toHaveLength(1);
    expect(workstations[0]).toMatchObject({
      id: 'planning-workstation',
      frameBundle: { root: 'workstation-assets/plans', entrypoint: 'index.js', styles: ['style.css'], browserSdkVersion: 1 },
      allowedActions: expect.arrayContaining([
        'list-board-compact',
        'get-item',
        'get-epic',
        'search-items',
        'get-recommendations',
        'analyze-all-backlog',
        'list-planning-artifacts',
        'show-session-plan',
        'show-session-plan-set',
        'create-session-plan',
        'set-session-plan-section',
        'check-session-plan-readiness',
        'set-session-plan-ready',
        'handoff-session-plan',
        'start-planning-agent-task',
        'get-planning-agent-task',
        'cancel-planning-agent-task',
        'list-planning-agent-tasks',
        'retry-planning-agent-task',
        'redraft-planning-agent-task',
        'apply-planning-agent-task-result',
      ]),
    });
    // The AI-first workstation never starts deterministic promotion; promote-selection
    // stays registered for integration commands and deep links, but is not allowed in
    // the workstation iframe action surface.
    expect(workstations[0]!.allowedActions).not.toContain('list-board');
    expect(workstations[0]!.allowedActions).not.toContain('promote-selection');
    expect(workstations[0]!.allowedActions).not.toContain('refresh-recommendations');
    expect('srcDoc' in workstations[0]!).toBe(false);
  });
});
