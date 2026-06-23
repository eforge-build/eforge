import type { ExtensionJsonObject } from '../extension-contributions.js';
import {
  type ExtensionHostContributionFailedInvocationEnvelope,
  type ExtensionHostContributionInputSummary,
  type ExtensionHostContributionInvokeResult,
} from './extension-contribution-projection-types.js';

const FAILED_INVOCATION_ERROR_MESSAGE_MAX_LENGTH = 1_000;
const FAILED_INVOCATION_INPUT_KEY_MAX_COUNT = 20;
const FAILED_INVOCATION_INPUT_KEY_MAX_LENGTH = 80;
const FAILED_INVOCATION_INPUT_VALUE_REDACTION_MIN_LENGTH = 80;

export function summarizeExtensionContributionInvocationInput(input: ExtensionJsonObject): ExtensionHostContributionInputSummary {
  const serialized = JSON.stringify(input) ?? '{}';
  const rawInputKeys = Object.keys(input).sort((left, right) => left.localeCompare(right));
  const inputKeys = rawInputKeys
    .slice(0, FAILED_INVOCATION_INPUT_KEY_MAX_COUNT)
    .map((key) => truncateForHostEnvelope(key, FAILED_INVOCATION_INPUT_KEY_MAX_LENGTH));
  const truncatedInputKeyCount = rawInputKeys.filter((key) => key.length > FAILED_INVOCATION_INPUT_KEY_MAX_LENGTH).length;
  const omittedInputKeyCount = Math.max(0, rawInputKeys.length - inputKeys.length);
  return {
    inputKeys,
    inputKeyCount: rawInputKeys.length,
    serializedInputSize: serialized.length,
    ...(omittedInputKeyCount > 0 && { omittedInputKeyCount }),
    ...(truncatedInputKeyCount > 0 && { truncatedInputKeyCount }),
  };
}

export function createExtensionContributionFailedInvocationEnvelope(
  result: ExtensionHostContributionInvokeResult,
): ExtensionHostContributionFailedInvocationEnvelope | undefined {
  if (result.response.ok) return undefined;
  const { input: _input, requestedBy, ...target } = result.target;
  const redactedMessage = redactInputValuesFromHostEnvelopeError(result.response.error.message, result.target.input);
  const errorMessage = truncateForHostEnvelope(redactedMessage, FAILED_INVOCATION_ERROR_MESSAGE_MAX_LENGTH);
  return {
    ok: false,
    invocationId: result.response.invocationId,
    target,
    requestedBy,
    error: {
      code: result.response.error.code,
      message: errorMessage,
      ...(errorMessage.length < redactedMessage.length && { messageTruncated: true }),
    },
    inputSummary: summarizeExtensionContributionInvocationInput(result.target.input),
  };
}

function truncateForHostEnvelope(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function redactInputValuesFromHostEnvelopeError(message: string, input: ExtensionJsonObject): string {
  const values = collectLongStringInputValues(input);
  const redacted = values.reduce((current, value) => inputValueForms(value).reduce((next, form) => next.split(form).join('[redacted input value]'), current), message);
  return values.some((value) => inputValueForms(value).some((form) => containsLongFragment(redacted, form)))
    ? 'Extension action failed; daemon error message omitted because it echoed request input.'
    : redacted;
}

function inputValueForms(value: string): string[] {
  const json = JSON.stringify(value);
  return Array.from(new Set([value, json, json.slice(1, -1)]));
}

function containsLongFragment(message: string, value: string): boolean {
  const fragmentLength = FAILED_INVOCATION_INPUT_VALUE_REDACTION_MIN_LENGTH;
  for (let offset = 0; offset + fragmentLength <= value.length; offset += 1) {
    if (message.includes(value.slice(offset, offset + fragmentLength))) return true;
  }
  return false;
}

function collectLongStringInputValues(value: unknown): string[] {
  if (typeof value === 'string') return value.length >= FAILED_INVOCATION_INPUT_VALUE_REDACTION_MIN_LENGTH ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((item) => collectLongStringInputValues(item));
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap((item) => collectLongStringInputValues(item));
  return [];
}
