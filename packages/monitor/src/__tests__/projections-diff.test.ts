import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db.js';
import { buildDiffResponse } from '../projections/diff.js';

const ts = '2025-01-01T00:00:00.000Z';

describe('diff projection', () => {
  it('shapes single-file and bulk diff responses', () => {
    const db = openDatabase(':memory:');
    db.insertRun({ id: 'r1', sessionId: 's1', planSet: 'set', command: 'build', status: 'completed', startedAt: ts, cwd: process.cwd() });
    db.insertFileDiffs('r1', 'p1', [{ path: 'a.ts', diff: 'diff-a' }, { path: 'b.ts', diff: 'diff-b' }], ts);
    expect(buildDiffResponse(db, 's1', 'p1', 'a.ts')).toEqual({ diff: 'diff-a' });
    expect(buildDiffResponse(db, 's1', 'p1', 'missing.ts')).toEqual({ diff: null });
    expect(buildDiffResponse(db, 's1', 'p1')).toEqual({ files: [{ path: 'a.ts', diff: 'diff-a' }, { path: 'b.ts', diff: 'diff-b' }] });
    db.close();
  });
});
