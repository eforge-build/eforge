import { describe, expect, it } from 'vitest';
import type { ConsoleWorkstation, EforgeExtensionAPI } from '../packages/extension-sdk/src/index.js';
import eforgePlanExtension from '../eforge/extensions/eforge-plan/index.js';

describe('eforge-plan Console workstation dogfood registration', () => {
  it('registers the board workstation with render-board-markdown bridge invocation', () => {
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
      id: 'board-workstation',
      allowedActions: ['render-board-markdown'],
    });
    expect(workstations[0]?.srcDoc).toContain("window.eforge.invokeAction('render-board-markdown'");
  });
});
