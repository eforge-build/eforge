/**
 * Guard for daemon/client wire compatibility version bumps.
 *
 * Keep this assertion intentionally hardcoded. When DAEMON_API_VERSION changes,
 * update this test with the new value and leave a concise rationale in the test
 * name so the bump is reviewed deliberately instead of drifting silently.
 */

import { describe, expect, it } from 'vitest';
import { DAEMON_API_VERSION } from '@eforge-build/client';

describe('DAEMON_API_VERSION', () => {
  it('is 64 for material backlog curation patch rationale requirements', () => {
    expect(DAEMON_API_VERSION).toBe(64);
  });
});
