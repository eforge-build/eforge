import {
  createExtensionContributionFailedInvocationEnvelope,
  formatExtensionContributionFailedInvocationEnvelopeText,
  formatExtensionContributionOutputText,
  type ExtensionHostContributionEntry,
  type ExtensionHostContributionInvokeResult,
} from '@eforge-build/client';

type JsonObject = Record<string, unknown>;

export type ContributionInputDecision =
  | { kind: 'no-prompt'; input: JsonObject }
  | { kind: 'editor'; title: string; missingRequired: string[]; prefillText: string };

export function requiredFields(schema: unknown): string[] {
  if (!isRecord(schema) || !Array.isArray(schema.required)) return [];
  return schema.required.filter((field): field is string => typeof field === 'string');
}

export function schemaInputTemplate(entry: ExtensionHostContributionEntry): JsonObject {
  const defaults = isRecord(entry.inputDefaults) ? entry.inputDefaults : {};
  const template: JsonObject = { ...defaults };
  const properties = schemaProperties(entry.inputSchema);
  for (const field of [...requiredFields(entry.inputSchema), ...templateAlternativeFields(entry.inputSchema, defaults)]) {
    if (Object.prototype.hasOwnProperty.call(template, field)) continue;
    defineJsonProperty(template, field, placeholderForSchema(properties[field]));
  }
  return template;
}

function defineJsonProperty(target: JsonObject, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

export function canInvokeWithoutPrompt(entry: ExtensionHostContributionEntry): boolean {
  const defaults = isRecord(entry.inputDefaults) ? entry.inputDefaults : {};
  const rootRequiredSatisfied = requiredFields(entry.inputSchema).every((field) => Object.prototype.hasOwnProperty.call(defaults, field));
  if (!rootRequiredSatisfied) return false;
  const alternatives = conditionalRequiredAlternatives(entry.inputSchema);
  return alternatives.length === 0 || alternatives.some((fields) => fields.every((field) => Object.prototype.hasOwnProperty.call(defaults, field)));
}

export function prepareContributionInput(entry: ExtensionHostContributionEntry): ContributionInputDecision {
  if (canInvokeWithoutPrompt(entry)) return { kind: 'no-prompt', input: {} };
  const missingRequired = missingRequiredFields(entry);
  const missingSuffix = missingRequired.length > 0 ? ` - missing: ${missingRequired.join(', ')}` : '';
  return {
    kind: 'editor',
    title: `eforge extensions - JSON input (${entry.kind}:${entry.id})${missingSuffix}`,
    missingRequired,
    prefillText: JSON.stringify(schemaInputTemplate(entry), null, 2),
  };
}

export function formatInvocationPanel(result: ExtensionHostContributionInvokeResult): { title: string; content: string } {
  const header = [
    `Invocation: ${result.response.invocationId}`,
    `Target: ${result.target.kind}:${result.target.id}`,
    `Action: ${result.target.actionId}`,
    '',
  ];
  if (result.response.ok) {
    return {
      title: 'eforge extensions - Success',
      content: [
        ...header,
        formatExtensionContributionOutputText(result.response.output, { outputProfile: result.target.outputProfile }),
      ].join('\n'),
    };
  }
  const failureEnvelope = createExtensionContributionFailedInvocationEnvelope(result);
  return {
    title: 'eforge extensions - Failure',
    content: [...header, failureEnvelope ? formatExtensionContributionFailedInvocationEnvelopeText(failureEnvelope) : `${result.response.error.code}: ${result.response.error.message}`].join('\n'),
  };
}

function missingRequiredFields(entry: ExtensionHostContributionEntry): string[] {
  const defaults = isRecord(entry.inputDefaults) ? entry.inputDefaults : {};
  const missing = requiredFields(entry.inputSchema).filter((field) => !Object.prototype.hasOwnProperty.call(defaults, field));
  const alternatives = conditionalRequiredAlternatives(entry.inputSchema);
  if (alternatives.length > 0 && !alternatives.some((fields) => fields.every((field) => Object.prototype.hasOwnProperty.call(defaults, field)))) {
    missing.push(`one of: ${alternatives.map((fields) => fields.join(',')).join(' | ')}`);
  }
  return missing;
}

function conditionalRequiredAlternatives(schema: unknown): string[][] {
  if (!isRecord(schema)) return [];
  const alternatives: string[][] = [];
  for (const key of ['oneOf', 'anyOf']) {
    const variants = schema[key];
    if (!Array.isArray(variants)) continue;
    for (const variant of variants) {
      const fields = requiredFields(variant);
      if (fields.length > 0) alternatives.push(fields);
    }
  }
  return alternatives;
}

function templateAlternativeFields(schema: unknown, defaults: JsonObject): string[] {
  const alternatives = conditionalRequiredAlternatives(schema);
  if (alternatives.length === 0 || alternatives.some((fields) => fields.every((field) => Object.prototype.hasOwnProperty.call(defaults, field)))) return [];
  return alternatives[0] ?? [];
}

function schemaProperties(schema: unknown): Record<string, unknown> {
  if (!isRecord(schema) || !isRecord(schema.properties)) return {};
  return schema.properties;
}

function placeholderForSchema(schema: unknown): unknown {
  if (!isRecord(schema)) return null;
  const defaultValue = jsonSafeValue(schema.default);
  if (defaultValue !== undefined) return defaultValue;
  const enumValue = firstEnumValue(schema);
  if (enumValue !== undefined) return enumValue;
  if (schema.type === 'string') return '';
  if (schema.type === 'number' || schema.type === 'integer') return 0;
  if (schema.type === 'boolean') return false;
  if (schema.type === 'array') return [];
  if (schema.type === 'object') return {};
  return null;
}

function firstEnumValue(schema: JsonObject): unknown {
  if (Array.isArray(schema.enum)) {
    const value = schema.enum.find((item) => jsonSafeValue(item) !== undefined);
    return jsonSafeValue(value);
  }
  for (const key of ['anyOf', 'oneOf']) {
    const variants = schema[key];
    if (!Array.isArray(variants) || variants.length > 8) continue;
    const literalValues = variants
      .filter(isRecord)
      .map((variant) => jsonSafeValue(variant.const ?? firstSingleEnumValue(variant)));
    const value = literalValues.find((item) => item !== undefined);
    if (value !== undefined) return value;
  }
  return undefined;
}

function firstSingleEnumValue(schema: JsonObject): unknown {
  return Array.isArray(schema.enum) && schema.enum.length === 1 ? schema.enum[0] : undefined;
}

function jsonSafeValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
