import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { API_ROUTES } from '../routes.js';
import { QUEUE_RECOVERY_STRATEGY_RETRY_AND_REACTIVATE, isQueueRecoveryStrategy } from '../queue-recovery.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('queue recovery client contract', () => {
  it('exports route constants and strategy guard', () => {
    expect(API_ROUTES.queueRecoveryAnalyze).toBe(`/${['api', 'queue', 'recovery', 'analyze'].join('/')}`);
    expect(API_ROUTES.queueRecoveryApply).toBe(`/${['api', 'queue', 'recovery', 'apply'].join('/')}`);
    expect(isQueueRecoveryStrategy(QUEUE_RECOVERY_STRATEGY_RETRY_AND_REACTIVATE)).toBe(true);
    expect(isQueueRecoveryStrategy('unsupported')).toBe(false);
  });

  it('node helpers reference queue recovery route constants', async () => {
    const source = await readFile(resolve(__dirname, '..', 'api', 'queue-recovery.ts'), 'utf-8');
    expect(source.match(/API_ROUTES\.queueRecoveryAnalyze/g)).toHaveLength(2);
    expect(source.match(/API_ROUTES\.queueRecoveryApply/g)).toHaveLength(2);
  });
});
