import { describe, it, expect } from 'vitest';
import { safeParseEforgeEvent } from '../events.schemas.js';
import {
  landingActionPayloads,
  missingRequiredFieldPayloads,
  stackEventPayloads,
  unknownDiscriminantPayloads,
  wrongLiteralPayloads,
  type InvalidEventWireParityFixture,
} from './events-wire-parity-invalid-fixtures.js';

function expectInvalid({ label, payload, expectedErrorPath, expectedErrorMessageFragment }: InvalidEventWireParityFixture): void {
  const result = safeParseEforgeEvent(payload);
  expect(result.success, `${label} should be rejected`).toBe(false);
  if (!result.success) {
    if (expectedErrorPath !== undefined) {
      expect(result.error.errors.map((error) => error.path), `${label} error paths`).toContain(expectedErrorPath);
    }
    if (expectedErrorMessageFragment) {
      expect(result.error.message, `${label} error message`).toContain(expectedErrorMessageFragment);
    }
  }
}

describe('events-wire-parity — invalid payloads (missing required field)', () => {
  for (const fixture of missingRequiredFieldPayloads) {
    it(`rejects ${fixture.label}`, () => {
      expectInvalid(fixture);
    });
  }
});

describe('events-wire-parity — invalid payloads (wrong literal)', () => {
  for (const fixture of wrongLiteralPayloads) {
    it(`rejects ${fixture.label}`, () => {
      expectInvalid(fixture);
    });
  }
});

describe('events-wire-parity — invalid payloads (landing action)', () => {
  for (const fixture of landingActionPayloads) {
    it(`rejects ${fixture.label}`, () => {
      expectInvalid(fixture);
    });
  }
});

describe('events-wire-parity — invalid payloads (stack events)', () => {
  for (const fixture of stackEventPayloads) {
    it(`rejects ${fixture.label}`, () => {
      expectInvalid(fixture);
    });
  }
});

describe('events-wire-parity — invalid payloads (unknown discriminant)', () => {
  for (const fixture of unknownDiscriminantPayloads) {
    it(`rejects ${fixture.label}`, () => {
      expectInvalid(fixture);
    });
  }
});
