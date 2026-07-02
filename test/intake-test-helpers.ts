/**
 * Shared helpers for tests that exercise the intake agent or need a valid
 * canonical acceptance criteria inventory without going through an agent.
 */
import {
  AC_INVENTORY_VERSION,
  formatAcceptanceInventoryDiagnostics,
  validateCanonicalAcceptanceCriteriaInventory,
  type AcceptanceInventoryValidationOptions,
  type CanonicalAcceptanceCriteriaInventory,
} from '@eforge-build/engine/validation/acceptance-criteria-inventory';
import type { StubResponse, StubScriptedEvent } from './stub-harness.js';

export interface IntakeCriterionInput {
  text: string;
  sourceQuote: string;
  confidence: number;
  warnings?: string[];
}

/**
 * Build a validated inventory the same way the intake submission handler does.
 * Throws with formatted diagnostics if the candidate is invalid.
 */
export function buildInventory(
  criteria: IntakeCriterionInput[],
  source: string,
  options: AcceptanceInventoryValidationOptions = {},
): CanonicalAcceptanceCriteriaInventory {
  const result = validateCanonicalAcceptanceCriteriaInventory({ version: AC_INVENTORY_VERSION, criteria }, source, options);
  if (!result.valid) throw new Error(formatAcceptanceInventoryDiagnostics(result.diagnostics));
  return result.inventory;
}

let toolUseCounter = 0;

/** Scripted StubHarness tool_call that routes an intake payload through the real submission handler. */
export function intakeSubmissionCall(
  formattedBody: string,
  criteria: IntakeCriterionInput[],
  warnings?: string[],
): StubScriptedEvent {
  return {
    kind: 'tool_call',
    tool: 'submit_intake',
    toolUseId: `intake-${++toolUseCounter}`,
    input: { formattedBody, criteria, ...(warnings !== undefined ? { warnings } : {}) },
    output: '',
  };
}

/** A full StubHarness response representing one valid intake submission. */
export function intakeResponse(
  formattedBody: string,
  criteria: IntakeCriterionInput[],
  warnings?: string[],
): StubResponse {
  return { events: [intakeSubmissionCall(formattedBody, criteria, warnings)], text: 'Submitted.' };
}
