import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as input from '@eforge-build/input';

describe('playbook workflow adapter boundary', () => {
  it('keeps pure playbook artifact helpers public', () => {
    for (const helper of [
      'parsePlaybook',
      'serializePlaybook',
      'listPlaybooks',
      'loadPlaybook',
      'writePlaybook',
      'movePlaybook',
      'copyPlaybookToScope',
      'validatePlaybook',
      'playbookToBuildSource',
      'playbookToPlanSeed',
    ]) {
      expect((input as Record<string, unknown>)[helper], helper).toBeDefined();
    }
  });

  it('removes the builtin playbook workflow-adapter API surface', () => {
    const exports = Object.keys(input as Record<string, unknown>);
    expect(exports).not.toContain('PLAYBOOK_WORKFLOW_ADAPTER_DESCRIPTOR');
    expect(exports).not.toContain('createPlaybookWorkflowAdapter');
    expect(exports.filter((name) => name.startsWith('PlaybookWorkflow'))).toEqual([]);
  });

  it('removes workflow-adapter ownership strings from the input barrel', () => {
    const source = readFileSync('packages/input/src/index.ts', 'utf8');
    for (const token of ['builtin:' + 'playbooks', 'createPlaybookWorkflowAdapter', 'PLAYBOOK_WORKFLOW', 'PlaybookWorkflow']) {
      expect(source).not.toContain(token);
    }
  });
});
