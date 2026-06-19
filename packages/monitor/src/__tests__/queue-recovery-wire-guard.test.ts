import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FORBIDDEN_LOCAL_DECLARATIONS = [
  'QueueDispatchFailureProjection',
  'QueueRecoveryDependencyInfo',
  'QueueRecoveryDependencyStatus',
  'QueueRecoveryDispatchPreflight',
  'QueueRecoveryRepairAction',
  'QueueRecoveryRepairResult',
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (path.includes('/__tests__/')) return [];
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(path) ? [path] : [];
  });
}

describe('queue recovery wire contracts', () => {
  it('does not locally redeclare client-owned recovery wire shapes', () => {
    const offenders: string[] = [];
    for (const path of files(join(process.cwd(), 'packages/monitor/src'))) {
      const text = readFileSync(path, 'utf8');
      for (const name of FORBIDDEN_LOCAL_DECLARATIONS) {
        if (new RegExp(`(?:interface\\s+${name}\\b|type\\s+${name}\\s*=)`).test(text)) offenders.push(`${path}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
