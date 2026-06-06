import { safeParseWithSchema, type ExtensionActionSideEffect } from '@eforge-build/client';
import type { TSchema } from '@sinclair/typebox';

import { isValidExtensionLocalContributionId } from './ids.js';
import { validateWorkstationFrameBundleSource } from './workstation-bundle-paths.js';
import type {
  ConsoleContributionBlockSpec,
  ConsoleContributionSpec,
  ConsoleWorkstationSpec,
  ExtensionActionBindingSpec,
  ExtensionActionSpec,
  ExtensionDeepLinkSpec,
  IntegrationCommandSpec,
} from './types.js';

const SIDE_EFFECTS = new Set<ExtensionActionSideEffect>([
  'none',
  'local-read',
  'local-write',
  'network',
  'daemon-state',
  'build-queue',
]);
const RENDERERS = new Set(['text', 'markdown', 'status-badge', 'link', 'action-button', 'action-form']);
const ACTION_RENDERERS = new Set(['action-button', 'action-form']);
const SAFE_CONSOLE_LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:']);
const SAFE_DEEP_LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'eforge:']);

export interface RegistrationValidationResult<T> {
  ok: boolean;
  value?: T;
  id?: string;
  message?: string;
}

export interface JsonSafeValidationResult {
  ok: boolean;
  message?: string;
}

export function isNonArrayObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isObjectRootSchema(value: unknown): value is Record<string, unknown> {
  return isNonArrayObject(value) && value.type === 'object';
}

export function validateActionSpec(value: unknown): RegistrationValidationResult<ExtensionActionSpec> {
  const base = validateBase(value, 'registerAction', 'title');
  if (!base.ok) return base as RegistrationValidationResult<ExtensionActionSpec>;
  const spec = value as Record<string, unknown>;
  const inputSchemaResult = validateSchemaDocument(spec.inputSchema, { requireObjectRoot: true });
  if (!inputSchemaResult.ok) return fail(base.id, `registerAction inputSchema must be a JSON-safe object-root schema (type: "object"): ${inputSchemaResult.message}`);
  if (spec.outputSchema !== undefined) {
    const outputSchemaResult = validateSchemaDocument(spec.outputSchema);
    if (!outputSchemaResult.ok) return fail(base.id, `registerAction outputSchema must be a JSON-safe schema document: ${outputSchemaResult.message}`);
  }
  if (spec.sideEffects !== undefined && (!Array.isArray(spec.sideEffects) || !spec.sideEffects.every((item) => typeof item === 'string' && SIDE_EFFECTS.has(item as ExtensionActionSideEffect)))) {
    return fail(base.id, 'registerAction sideEffects must be an array of supported side-effect values');
  }
  if (typeof spec.handler !== 'function') return fail(base.id, 'registerAction requires a handler function');
  return { ok: true, id: base.id, value: value as ExtensionActionSpec };
}

export function validateConsoleContributionSpec(value: unknown): RegistrationValidationResult<ConsoleContributionSpec> {
  if (!isNonArrayObject(value)) return fail(undefined, 'registerConsoleContribution requires an object spec');
  const id = typeof value.id === 'string' ? value.id : undefined;
  if (!isValidExtensionLocalContributionId(value.id)) return fail(id, 'registerConsoleContribution id must match ^[a-z][a-z0-9-]{0,63}$');
  if (!isNonBlankString(value.title)) return fail(id, 'registerConsoleContribution title must be a non-empty string');
  if (value.description !== undefined && typeof value.description !== 'string') return fail(id, 'registerConsoleContribution description must be a string');
  if (!Array.isArray(value.blocks) || value.blocks.length === 0) return fail(id, 'registerConsoleContribution requires a non-empty blocks array');
  for (const block of value.blocks) {
    const blockResult = validateConsoleContributionBlock(block);
    if (!blockResult.ok) return fail(id, blockResult.message ?? 'registerConsoleContribution block is invalid');
  }
  return { ok: true, id, value: value as unknown as ConsoleContributionSpec };
}

export function validateConsoleWorkstationSpec(value: unknown): RegistrationValidationResult<ConsoleWorkstationSpec> {
  if (!isNonArrayObject(value)) return fail(undefined, 'registerConsoleWorkstation requires an object spec');
  const id = typeof value.id === 'string' ? value.id : undefined;
  if (!isValidExtensionLocalContributionId(value.id)) return fail(id, 'registerConsoleWorkstation id must match ^[a-z][a-z0-9-]{0,63}$');
  if (!isNonBlankString(value.title)) return fail(id, 'registerConsoleWorkstation title must be a non-empty string');
  if (value.description !== undefined && typeof value.description !== 'string') return fail(id, 'registerConsoleWorkstation description must be a string');
  const hasSrcDoc = value.srcDoc !== undefined;
  const hasFrameBundle = value.frameBundle !== undefined;
  if (hasSrcDoc === hasFrameBundle) return fail(id, 'registerConsoleWorkstation requires exactly one of srcDoc or frameBundle');
  if (hasSrcDoc && !isNonBlankString(value.srcDoc)) return fail(id, 'registerConsoleWorkstation srcDoc must be a non-empty string');
  // --- eforge:region plan-04-engine-registration-manifest-trust ---
  if (hasFrameBundle) {
    const frameBundleResult = validateWorkstationFrameBundleSource(value.frameBundle);
    if (!frameBundleResult.ok) return fail(id, `registerConsoleWorkstation ${frameBundleResult.message}`);
  }
  // --- eforge:endregion plan-04-engine-registration-manifest-trust ---
  if (value.allowedActions !== undefined) {
    if (!Array.isArray(value.allowedActions)) return fail(id, 'registerConsoleWorkstation allowedActions must be an array of local action ids');
    if (!value.allowedActions.every((actionId) => isValidExtensionLocalContributionId(actionId))) return fail(id, 'registerConsoleWorkstation allowedActions must contain only local action ids matching ^[a-z][a-z0-9-]{0,63}$');
  }
  const jsonSafe = validateJsonSafeValue(value, { requireObjectRoot: true, rejectSymbolKeys: true });
  if (!jsonSafe.ok) return fail(id, `registerConsoleWorkstation spec must be JSON-safe: ${jsonSafe.message}`);
  return { ok: true, id, value: value as unknown as ConsoleWorkstationSpec };
}

export function validateIntegrationCommandSpec(value: unknown): RegistrationValidationResult<IntegrationCommandSpec> {
  const base = validateBase(value, 'registerIntegrationCommand', 'label');
  if (!base.ok) return base as RegistrationValidationResult<IntegrationCommandSpec>;
  const spec = value as Record<string, unknown>;
  if (spec.inputSchema !== undefined) {
    const inputSchemaResult = validateSchemaDocument(spec.inputSchema, { requireObjectRoot: true });
    if (!inputSchemaResult.ok) return fail(base.id, `registerIntegrationCommand inputSchema must be a JSON-safe object-root schema (type: "object"): ${inputSchemaResult.message}`);
  }
  if (!isValidActionBindingSpec(spec.action)) return fail(base.id, 'registerIntegrationCommand requires an action binding');
  return { ok: true, id: base.id, value: value as IntegrationCommandSpec };
}

export function validateDeepLinkSpec(value: unknown): RegistrationValidationResult<ExtensionDeepLinkSpec> {
  const base = validateBase(value, 'registerDeepLink', 'label');
  if (!base.ok) return base as RegistrationValidationResult<ExtensionDeepLinkSpec>;
  const spec = value as Record<string, unknown>;
  if (spec.urlTemplate !== undefined && !isNonBlankString(spec.urlTemplate)) return fail(base.id, 'registerDeepLink urlTemplate must be a non-empty string');
  if (typeof spec.urlTemplate === 'string' && !isSafeUrlString(spec.urlTemplate, SAFE_DEEP_LINK_SCHEMES)) return fail(base.id, 'registerDeepLink urlTemplate must use a safe URL scheme');
  if (spec.action !== undefined && !isValidActionBindingSpec(spec.action)) return fail(base.id, 'registerDeepLink action must be a valid action binding');
  if (spec.urlTemplate === undefined && spec.action === undefined) return fail(base.id, 'registerDeepLink requires urlTemplate or an action binding');
  return { ok: true, id: base.id, value: value as ExtensionDeepLinkSpec };
}

export function validateActionBindingJson(binding: ExtensionActionBindingSpec): JsonSafeValidationResult {
  if (!isValidExtensionLocalContributionId(binding.actionId)) return { ok: false, message: `action binding references invalid local action id "${String(binding.actionId)}"` };
  if (binding.inputDefaults === undefined) return { ok: true };
  if (!isNonArrayObject(binding.inputDefaults)) return { ok: false, message: 'action binding inputDefaults must be JSON-safe object data' };
  return validateJsonSafeValue(binding.inputDefaults, { requireObjectRoot: true, rejectSymbolKeys: true });
}

export function validateJsonSafeValue(value: unknown, options: { requireObjectRoot?: boolean; rejectSymbolKeys?: boolean } = {}): JsonSafeValidationResult {
  const seen = new Set<object>();
  function visit(current: unknown, root: boolean): JsonSafeValidationResult {
    if (current === null || typeof current === 'string' || typeof current === 'boolean') return { ok: true };
    if (typeof current === 'number') return Number.isFinite(current) ? { ok: true } : { ok: false, message: 'number values must be finite' };
    if (typeof current === 'undefined' || typeof current === 'function' || typeof current === 'symbol' || typeof current === 'bigint') return { ok: false, message: `${typeof current} values are not JSON-safe` };
    if (Array.isArray(current)) {
      if (seen.has(current)) return { ok: false, message: 'circular references are not JSON-safe' };
      if (options.rejectSymbolKeys && Object.getOwnPropertySymbols(current).length > 0) return { ok: false, message: 'symbol-keyed data is not JSON-safe' };
      seen.add(current);
      for (const item of current) {
        const result = visit(item, false);
        if (!result.ok) return result;
      }
      seen.delete(current);
      return { ok: true };
    }
    if (!isPlainObject(current)) return { ok: false, message: 'only plain objects are JSON-safe' };
    if (root && options.requireObjectRoot !== false && !isNonArrayObject(current)) return { ok: false, message: 'root value must be an object' };
    if (seen.has(current)) return { ok: false, message: 'circular references are not JSON-safe' };
    if (options.rejectSymbolKeys && Object.getOwnPropertySymbols(current).length > 0) return { ok: false, message: 'symbol-keyed data is not JSON-safe' };
    seen.add(current);
    for (const entry of Object.values(current as Record<string, unknown>)) {
      const result = visit(entry, false);
      if (!result.ok) return result;
    }
    seen.delete(current);
    return { ok: true };
  }
  return visit(value, true);
}

export function jsonSafeClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function validateBase(value: unknown, method: string, labelField: 'title' | 'label'): RegistrationValidationResult<unknown> {
  if (!isNonArrayObject(value)) return fail(undefined, `${method} requires an object spec`);
  const id = typeof value.id === 'string' ? value.id : undefined;
  if (!isValidExtensionLocalContributionId(value.id)) return fail(id, `${method} id must match ^[a-z][a-z0-9-]{0,63}$`);
  if (!isNonBlankString(value[labelField])) return fail(id, `${method} ${labelField} must be a non-empty string`);
  if (value.description !== undefined && typeof value.description !== 'string') return fail(id, `${method} description must be a string`);
  return { ok: true, id };
}

function validateConsoleContributionBlock(block: unknown): JsonSafeValidationResult {
  if (!isNonArrayObject(block)) return { ok: false, message: 'Console contribution blocks must be objects' };
  if (typeof block.rendererId !== 'string' || !RENDERERS.has(block.rendererId)) return { ok: false, message: 'Console contribution block rendererId is unsupported' };
  if (!hasOnlyAllowedBlockFields(block)) return { ok: false, message: `${block.rendererId} blocks include unsupported fields` };
  if (block.title !== undefined && typeof block.title !== 'string') return { ok: false, message: 'Console contribution block title must be a string' };
  if (typeof block.content !== 'string') return { ok: false, message: 'Console contribution block content must be a string' };
  if (block.rendererId === 'status-badge' && typeof block.status !== 'string') return { ok: false, message: 'status-badge blocks require string status' };
  if (block.rendererId === 'link' && typeof block.href !== 'string') return { ok: false, message: 'link blocks require string href' };
  if (block.rendererId === 'link' && typeof block.href === 'string' && !isSafeConsoleHref(block.href)) return { ok: false, message: 'link blocks require a safe href URL scheme' };
  if (ACTION_RENDERERS.has(block.rendererId) && !isValidActionBindingSpec(block.action)) return { ok: false, message: `${block.rendererId} blocks require an action binding` };
  return validateJsonSafeValue(block, { requireObjectRoot: true, rejectSymbolKeys: true });
}

function validateSchemaDocument(value: unknown, options: { requireObjectRoot?: boolean } = {}): JsonSafeValidationResult {
  if (!isNonArrayObject(value)) return { ok: false, message: 'schema document root must be an object' };
  if (options.requireObjectRoot && value.type !== 'object') return { ok: false, message: 'schema document root type must be "object"' };
  const jsonSafe = validateJsonSafeValue(value, { requireObjectRoot: true, rejectSymbolKeys: false });
  if (!jsonSafe.ok) return jsonSafe;
  return validateTypeBoxSchemaDocument(value);
}

function validateTypeBoxSchemaDocument(value: Record<string, unknown>): JsonSafeValidationResult {
  try {
    safeParseWithSchema(value as TSchema, {});
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error && err.message.trim().length > 0 ? err.message : 'schema cannot be evaluated by TypeBox';
    return { ok: false, message: `schema must be TypeBox-compatible: ${message}` };
  }
}

function hasOnlyAllowedBlockFields(block: Record<string, unknown>): boolean {
  const allowed = new Set(['rendererId', 'title', 'content']);
  if (block.rendererId === 'status-badge') allowed.add('status');
  if (block.rendererId === 'link') allowed.add('href');
  if (ACTION_RENDERERS.has(String(block.rendererId))) allowed.add('action');
  return Object.keys(block).every((key) => allowed.has(key));
}

function isSafeUrlString(value: string, allowedSchemes: Set<string>): boolean {
  if (/[\u0000-\u001f\u007f]/u.test(value)) return false;
  const schemeMatch = /^([a-z][a-z0-9+.-]*:)/iu.exec(value.trim());
  return schemeMatch !== null && allowedSchemes.has(schemeMatch[1].toLowerCase());
}

function isSafeConsoleHref(value: string): boolean {
  if (/[\u0000-\u001f\u007f]/u.test(value)) return false;
  if (value.startsWith('/console/')) return true;
  return isSafeUrlString(value, SAFE_CONSOLE_LINK_SCHEMES);
}

function isValidActionBindingSpec(value: unknown): value is ExtensionActionBindingSpec {
  if (!isNonArrayObject(value)) return false;
  if (!isValidExtensionLocalContributionId(value.actionId)) return false;
  if (value.inputDefaults !== undefined && !isNonArrayObject(value.inputDefaults)) return false;
  if (value.inputDefaults !== undefined && !validateJsonSafeValue(value.inputDefaults, { requireObjectRoot: true, rejectSymbolKeys: true }).ok) return false;
  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isNonArrayObject(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function fail(id: string | undefined, message: string): RegistrationValidationResult<never> {
  return { ok: false, id, message };
}
