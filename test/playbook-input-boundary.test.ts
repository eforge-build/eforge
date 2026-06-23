import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as input from '@eforge-build/input';

const purePlaybookExports = [
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
] as const;

const removedWorkflowExports = [
  'createPlaybookWorkflowAdapter',
  'PLAYBOOK_WORKFLOW_ADAPTER_DESCRIPTOR',
  'PlaybookWorkflowAdapter',
  'PlaybookWorkflowRunResult',
  'PlaybookWorkflowError',
] as const;

function readSource(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('playbook input package boundary', () => {
  it('keeps pure playbook artifact helpers exported', () => {
    for (const name of purePlaybookExports) {
      expect((input as Record<string, unknown>)[name], `${name} should remain public`).toBeDefined();
    }
  });

  it('does not export workflow-adapter ownership symbols at runtime', () => {
    const runtimeExports = Object.keys(input as Record<string, unknown>);
    for (const name of removedWorkflowExports) {
      expect(runtimeExports, `${name} should not be a runtime export`).not.toContain(name);
    }
    expect(runtimeExports.filter((name) => name.startsWith('PlaybookWorkflow'))).toEqual([]);
  });

  it('keeps playbook source comments free of direct daemon route and workflow-adapter ownership', () => {
    const indexSource = readSource('packages/input/src/index.ts');
    const playbookSource = readSource('packages/input/src/playbook.ts');
    const combined = `${indexSource}\n${playbookSource}`;

    for (const token of [
      'builtin:' + 'playbooks',
      'createPlaybookWorkflowAdapter',
      'PLAYBOOK_WORKFLOW',
      '/api/' + 'playbook',
      'client-owned HTTP routes',
    ]) {
      expect(combined, `input source should not contain ${token}`).not.toContain(token);
    }
  });
});
