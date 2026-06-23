import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const deletedBoundaryFiles = [
  'packages/client/src/api/playbook.ts',
  'packages/client/src/routes/playbook.ts',
  'packages/monitor/src/routes/playbooks.ts',
  'packages/monitor/src/routes/playbook-service.ts',
  'packages/input/src/playbook-workflow.ts',
];

const sourceRoots = [
  'packages/client/src',
  'packages/monitor/src',
  'packages/input/src',
  'packages/engine/src',
];

const forbiddenSourceTokens = [
  'api' + 'Playbook',
  'API_ROUTES.' + 'playbook',
  'sessionPlanCreateFrom' + 'Playbook',
  'create' + 'PlaybookWorkflowAdapter',
  'PLAYBOOK_' + 'WORKFLOW',
  'builtin:' + 'playbooks',
  'playbook-' + 'enqueue',
];

function collectSourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (['__tests__', 'dist', 'node_modules'].includes(entry)) continue;
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...collectSourceFiles(path));
    else if (/\.(ts|tsx)$/.test(entry)) files.push(path);
  }
  return files;
}

describe('playbook boundary source audit', () => {
  it('removes direct playbook client, daemon route, and workflow adapter files', () => {
    for (const path of deletedBoundaryFiles) {
      expect(existsSync(path), `${path} should be deleted`).toBe(false);
    }
  });

  it('keeps production sources free of removed direct playbook boundary tokens', () => {
    const offenders = sourceRoots.flatMap((root) => collectSourceFiles(root)).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return forbiddenSourceTokens
        .filter((token) => source.includes(token))
        .map((token) => `${file}: ${token}`);
    });

    expect(offenders).toEqual([]);
  });
});
