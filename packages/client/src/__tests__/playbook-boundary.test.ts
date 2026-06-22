import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { API_ROUTES } from '../routes/route-map.js';
import * as browser from '../browser.js';
import * as client from '../index.js';

const deletedRouteKeys = [
  'playbookList',
  'playbookShow',
  'playbookSave',
  'playbookRun',
  'playbookPromote',
  'playbookDemote',
  'playbookValidate',
  'playbookCopy',
  'sessionPlanCreateFromPlaybook',
] as const;

function exportedNames(module: object): string[] {
  return Object.keys(module).sort();
}

function readSource(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('playbook client boundary removal', () => {
  it('removes direct playbook and create-from-playbook route keys from API_ROUTES', () => {
    const routeKeys = Object.keys(API_ROUTES);
    for (const key of deletedRouteKeys) expect(routeKeys).not.toContain(key);
    expect(routeKeys.filter((key) => key.startsWith('playbook'))).toEqual([]);
    expect(routeKeys).not.toContain('sessionPlanCreateFromPlaybook');
  });

  it('keeps generic extension routes while removing direct playbook route paths', () => {
    expect(API_ROUTES.extensionContributionManifest).toBe('/api/extensions/contributions');
    expect(API_ROUTES.extensionActionInvoke).toBe('/api/extensions/actions/invoke');
    const removedFragment = 'play' + 'book';
    expect(Object.values(API_ROUTES).filter((route) => route.includes(removedFragment))).toEqual([]);
  });

  it('does not expose playbook-specific helpers from the main or browser facades', () => {
    const forbiddenPrefixes = ['api' + 'Playbook'];
    for (const name of exportedNames(client)) {
      expect(forbiddenPrefixes.some((prefix) => name.startsWith(prefix)), `main export ${name}`).toBe(false);
    }
    for (const name of exportedNames(browser)) {
      expect(name.includes('PlaybookRun') || name.includes('SessionPlanCreateFromPlaybook'), `browser export ${name}`).toBe(false);
    }

    expect(client.invokeEforgeExtensionContribution).toEqual(expect.any(Function));
    expect(client.apiInvokeExtensionAction).toEqual(expect.any(Function));
  });

  it('removes playbook helper and wire-contract tokens from public client barrels', () => {
    const forbidden = ['api' + 'Playbook', 'PlaybookRun', 'SessionPlanCreateFromPlaybook'];
    for (const path of ['packages/client/src/index.ts', 'packages/client/src/browser.ts', 'packages/client/src/routes.ts']) {
      const source = readSource(path);
      for (const token of forbidden) expect(source, `${path} should not contain ${token}`).not.toContain(token);
    }
  });
});
