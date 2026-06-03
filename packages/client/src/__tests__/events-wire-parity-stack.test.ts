import { describe, it, expect } from 'vitest';
import { safeParseEforgeEvent } from '../events.schemas.js';
import {
  stackSyncInvalidPayloads,
  stackSyncLifecycleValidPayloads,
  stackSyncRoundTripPayloads,
} from './events-wire-parity-stack-fixtures.js';

describe('events-wire-parity — stack sync lifecycle events', () => {
  for (const { label, payload } of stackSyncLifecycleValidPayloads) {
    it(`accepts ${label}`, () => {
      const result = safeParseEforgeEvent(payload);
      expect(result.success).toBe(true);
    });
  }

  for (const { label, payload } of stackSyncRoundTripPayloads) {
    it(`round-trips ${label}`, () => {
      const result = safeParseEforgeEvent(JSON.parse(JSON.stringify(payload)));
      expect(result.success).toBe(true);
    });
  }

  for (const { label, payload } of stackSyncInvalidPayloads) {
    it(`rejects ${label}`, () => {
      const result = safeParseEforgeEvent(payload);
      expect(result.success).toBe(false);
    });
  }
});
