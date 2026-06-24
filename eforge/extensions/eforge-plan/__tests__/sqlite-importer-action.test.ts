import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { dispatchExtensionAction } from '@eforge-build/engine/extensions/action-runtime.js';
import { createExtensionRecorder } from '@eforge-build/engine/extensions/recorder.js';
import eforgePlanExtension from '../index.js';

function load() { const { api, state } = createExtensionRecorder('eforge-plan', fileURLToPath(new URL('../index.ts', import.meta.url))); eforgePlanExtension(api as never); return state; }
async function temp<T>(fn: (cwd: string) => Promise<T>) { const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-importer-action-')); try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); } }

describe('sqlite importer action', () => {
  it('registers import-planning-store and returns bounded dry-run output for empty input', async () => {
    await temp(async (cwd) => { const state = load(); expect(state.actions.map((a) => a.value.id)).toContain('import-planning-store'); const contribution = state.consoleContributions.flatMap((c) => c.value.blocks).find((b) => b.action?.actionId === 'import-planning-store'); expect(contribution).toBeDefined(); const result = await dispatchExtensionAction({ ...state, extensions: [], candidates: [] }, { actionId: 'eforge-plan:import-planning-store', input: { diagnosticLimit: 0 }, requestedBy: { host: 'cli' }, cwd, timeoutMs: 1000 }); expect(result).toMatchObject({ kind: 'success' }); expect(result.kind === 'success' ? result.output : undefined).toMatchObject({ schemaVersion: 1, dryRun: true, applied: false, diagnostics: [], diagnosticsOmitted: 0 }); });
  });
});
