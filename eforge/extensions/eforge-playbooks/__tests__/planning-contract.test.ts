import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildExtensionContributionManifest } from '@eforge-build/engine/extensions/manifest.js';
import { createExtensionRecorder } from '@eforge-build/engine/extensions/recorder.js';
import eforgePlan from '../../eforge-plan/index.js';
import { EFORGE_PLAN_DRIFT_CONSTANTS } from '../planning.js';

describe('eforge-plan planning contribution contract', () => {
  it('matches the provider capability and contribution ids', async () => {
    const { api, state } = createExtensionRecorder('eforge-plan', '/project/eforge/extensions/eforge-plan/index.ts');
    eforgePlan(api as never);
    const manifest = buildExtensionContributionManifest({ ...state, extensions: [], candidates: [] });
    const pkg = JSON.parse(await readFile(new URL('../../eforge-plan/package.json', import.meta.url), 'utf-8'));
    expect(pkg.eforge.extension.capabilities).toContainEqual({ name: EFORGE_PLAN_DRIFT_CONSTANTS.capability, version: EFORGE_PLAN_DRIFT_CONSTANTS.version });
    expect(manifest.actions.map((a) => a.id)).toContain(EFORGE_PLAN_DRIFT_CONSTANTS.actionId);
    expect(manifest.integrationCommands.map((c) => c.id)).toContain(EFORGE_PLAN_DRIFT_CONSTANTS.integrationCommandId);
    expect(manifest.deepLinks.map((l) => l.id)).toContain(EFORGE_PLAN_DRIFT_CONSTANTS.deepLinkId);
    expect(state.consoleWorkstations.map((w) => w.id)).toContain(EFORGE_PLAN_DRIFT_CONSTANTS.workstationId);
    expect(manifest.deepLinks.find((l) => l.id === EFORGE_PLAN_DRIFT_CONSTANTS.deepLinkId)?.urlTemplate).toBe(EFORGE_PLAN_DRIFT_CONSTANTS.workstationUrl);
  });
});
