import type {
  ConsoleContributionBlock,
  ExtensionActionBindingManifest,
  ExtensionActionManifestEntry,
  ExtensionActionRequestedBy,
  ExtensionContributionManifestResponse,
  ExtensionJsonObject,
  ExtensionJsonValue,
} from './system-types';

export const JSON_PREVIEW_LIMIT = 4096;

export type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

export interface InvocationIdleState { status: 'idle' }
export interface InvocationRunningState { status: 'running' }
export interface InvocationSuccessState { status: 'success'; invocationId: string; output?: ExtensionJsonValue }
export interface InvocationFailureState { status: 'failure'; invocationId?: string; code?: string; message: string }
export type InvocationState = InvocationIdleState | InvocationRunningState | InvocationSuccessState | InvocationFailureState;

export interface FieldCoercionResult {
  input: ExtensionJsonObject;
  errors: Record<string, string>;
}

export function buildActionLookup(actions: ExtensionActionManifestEntry[]): Map<string, ExtensionActionManifestEntry> {
  return new Map(actions.map((action) => [action.id, action]));
}

export function buildRequestedBy(contributionId: string): ExtensionActionRequestedBy {
  return {
    host: 'console',
    surface: `contribution:${contributionId}`,
  };
}

export function sanitizeContributionHref(href: string): string | null {
  if (href.startsWith('/console/')) return href;
  try {
    const url = new URL(href);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function statusToneToBadgeVariant(status: string): BadgeVariant {
  const tone = status.toLowerCase();
  if (['success', 'ok', 'healthy', 'ready', 'loaded'].includes(tone)) return 'secondary';
  if (['danger', 'error', 'failed', 'failure', 'invalid'].includes(tone)) return 'destructive';
  if (['warning', 'warn', 'pending'].includes(tone)) return 'outline';
  if (['neutral', 'info', 'unknown'].includes(tone)) return 'outline';
  return 'outline';
}

export function formatJsonPreview(value: ExtensionJsonValue | undefined, limit = JSON_PREVIEW_LIMIT): string {
  if (value === undefined) return '';
  const text = JSON.stringify(value, null, 2);
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export function manifestHasEntries(manifest: ExtensionContributionManifestResponse): boolean {
  return manifest.actions.length > 0
    || manifest.consoleContributions.length > 0
    || manifest.integrationCommands.length > 0
    || manifest.deepLinks.length > 0
    || (manifest.diagnostics?.length ?? 0) > 0;
}

export function actionKey(contributionId: string, block: ConsoleContributionBlock, index: number): string {
  const binding = 'action' in block ? block.action.actionId : 'none';
  return `${contributionId}:${index}:${binding}`;
}

export function mergeInputDefaults(
  binding: ExtensionActionBindingManifest,
  values: ExtensionJsonObject,
): ExtensionJsonObject {
  return { ...(binding.inputDefaults ?? {}), ...values };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function propertySchema(schema: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const properties = schema.properties;
  if (!isRecord(properties)) return undefined;
  const prop = properties[key];
  return isRecord(prop) ? prop : undefined;
}

function requiredSet(schema: Record<string, unknown>): Set<string> {
  return new Set(Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === 'string') : []);
}

export function schemaPropertyNames(schema: unknown): string[] {
  if (!isRecord(schema) || !isRecord(schema.properties)) return [];
  return Object.keys(schema.properties);
}

export function schemaPropertyKind(schema: unknown): 'string' | 'number' | 'integer' | 'boolean' | 'enum' | 'json' {
  if (!isRecord(schema)) return 'json';
  if (Array.isArray(schema.enum)) return schema.enum.every(isSelectableEnumValue) ? 'enum' : 'json';
  if (schema.type === 'string') return 'string';
  if (schema.type === 'number') return 'number';
  if (schema.type === 'integer') return 'integer';
  if (schema.type === 'boolean') return 'boolean';
  return 'json';
}

export interface SchemaEnumOption {
  value: string;
  label: string;
}

function isSelectableEnumValue(value: unknown): value is ExtensionJsonValue {
  return value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value));
}

function enumOptionValue(index: number): string {
  return `enum:${index}`;
}

function enumValues(schema: unknown): ExtensionJsonValue[] {
  if (!isRecord(schema) || !Array.isArray(schema.enum) || schema.enum.some((value) => !isSelectableEnumValue(value))) return [];
  return schema.enum;
}

export function schemaEnumValues(schema: unknown): SchemaEnumOption[] {
  return enumValues(schema).map((value, index) => ({
    value: enumOptionValue(index),
    label: value === null ? 'null' : String(value),
  }));
}

export function defaultFieldValue(defaults: ExtensionJsonObject | undefined, name: string, schema: unknown): string | boolean {
  const value = defaults?.[name];
  const kind = schemaPropertyKind(schema);
  if (kind === 'boolean') return Boolean(value);
  if (kind === 'enum') {
    const index = enumValues(schema).findIndex((option) => option === value);
    return index === -1 ? '' : enumOptionValue(index);
  }
  if (value === undefined || value === null) return '';
  if (kind === 'json') return JSON.stringify(value, null, 2);
  return String(value);
}

export function coerceFormValues(
  schema: unknown,
  rawValues: Record<string, string | boolean>,
  defaults?: ExtensionJsonObject,
): FieldCoercionResult {
  const root = isRecord(schema) ? schema : {};
  const required = requiredSet(root);
  const input: ExtensionJsonObject = {};
  const errors: Record<string, string> = {};

  for (const name of schemaPropertyNames(root)) {
    const prop = propertySchema(root, name);
    const raw = rawValues[name];
    const hasDefault = defaults && Object.prototype.hasOwnProperty.call(defaults, name);
    const kind = schemaPropertyKind(prop);

    if (kind === 'boolean') {
      if (raw === true || raw === false) input[name] = raw;
      continue;
    }

    if (raw === '' || raw === undefined) {
      if (required.has(name)) errors[name] = 'Required';
      continue;
    }

    if (kind === 'number' || kind === 'integer') {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || (kind === 'integer' && !Number.isInteger(parsed))) {
        errors[name] = kind === 'integer' ? 'Enter a valid integer' : 'Enter a valid number';
      } else {
        input[name] = parsed;
      }
      continue;
    }

    if (kind === 'json') {
      try {
        input[name] = JSON.parse(String(raw)) as ExtensionJsonValue;
      } catch {
        errors[name] = 'Enter valid JSON';
      }
      continue;
    }

    if (kind === 'enum') {
      const values = enumValues(prop);
      const index = values.findIndex((_, optionIndex) => enumOptionValue(optionIndex) === raw);
      if (index === -1) {
        errors[name] = 'Select a valid option';
      } else {
        input[name] = values[index];
      }
      continue;
    }

    if (kind === 'string') {
      input[name] = String(raw);
    }

    if (!hasDefault && raw === '') delete input[name];
  }

  return { input, errors };
}
