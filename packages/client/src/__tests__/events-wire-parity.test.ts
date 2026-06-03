/**
 * Wire parity tests for valid EforgeEventSchema payloads.
 */

import { describe, it, expect } from 'vitest';
import { safeParseEforgeEvent } from '../events.schemas.js';
import { validPayloads } from './events-wire-parity-valid-fixtures.js';

describe('events-wire-parity — valid payloads', () => {
  for (const { label, payload } of validPayloads) {
    it(`accepts valid ${label} payload`, () => {
      const result = safeParseEforgeEvent(payload);
      expect(result.success, `${label} should be valid but got error: ${!result.success ? result.error.message : ''}`).toBe(true);
    });
  }
});
