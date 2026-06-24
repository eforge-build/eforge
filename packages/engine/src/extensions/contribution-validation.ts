import { safeParseWithSchema, type ExtensionActionSideEffect } from '@eforge-build/client';
import type { TSchema } from '@sinclair/typebox';

import { isValidExtensionLocalContributionId } from './ids.js';
import { validateWorkstationFrameBundleSource } from './workstation-bundle-paths.js';
import type {
  ConsoleContributionBlockSpec,
  ConsoleContributionSpec,
  ConsoleWorkstationSpec,
  ConsoleWorkstationSubviewSpec,
  ExtensionActionBindingSpec,
  ExtensionActionSpec,
  NativeExtensionContributionRequirements,
  ExtensionActionOutputProfile,
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
const OUTPUT_PROFILES = new Set<ExtensionActionOutputProfile>([
  'agent-compact',
  'agent-paginated',
  'markdown',
  'ui-rich',
  'debug-rich',
]);
const BROAD_ACTION_TERMS = ['list', 'search', 'board'];
const SINGLE_RECORD_ACTION_PREFIXES = ['get-', 'preview-', 'remove-'];
const BROAD_WARNING_SUPPRESSING_SIDE_EFFECTS = new Set<ExtensionActionSideEffect>(['local-write', 'network', 'daemon-state', 'build-queue']);
const LIMIT_CONTROL_NAMES = new Set(['limit', 'maxlimit', 'maxresults', 'pagesize', 'perpage', 'first', 'take']);
const CURSOR_CONTROL_NAMES = new Set(['cursor', 'offset', 'page', 'pagetoken', 'nexttoken', 'after', 'before']);
const PROJECTION_CONTROL_TERMS = ['field', 'projection', 'select', 'include', 'exclude', 'summary', 'compact', 'detail', 'body', 'raw', 'format'];
const RENDERERS = new Set(['text', 'markdown', 'status-badge', 'link', 'action-button', 'action-form']);
const ACTION_RENDERERS = new Set(['action-button', 'action-form']);
const SAFE_CONSOLE_LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:']);
const SAFE_DEEP_LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'eforge:']);
const URL_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/u;

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
  if (spec.outputProfile !== undefined && (typeof spec.outputProfile !== 'string' || !OUTPUT_PROFILES.has(spec.outputProfile as ExtensionActionOutputProfile))) {
    return fail(base.id, 'registerAction outputProfile must be one of agent-compact, agent-paginated, markdown, ui-rich, or debug-rich');
  }
  let normalizedRequirements: NativeExtensionContributionRequirements | undefined;
  if (spec.requirements !== undefined) {
    const requirementsResult = validateContributionRequirements(spec.requirements, 'registerAction requirements');
    if (!requirementsResult.ok) return fail(base.id, requirementsResult.message ?? 'registerAction requirements are invalid');
    normalizedRequirements = requirementsResult.value;
  }
  if (typeof spec.handler !== 'function') return fail(base.id, 'registerAction requires a handler function');
  return { ok: true, id: base.id, value: { ...(value as ExtensionActionSpec), ...(normalizedRequirements !== undefined && { requirements: normalizedRequirements }) } };
}

export function validateConsoleContributionSpec(value: unknown): RegistrationValidationResult<ConsoleContributionSpec> {
  if (!isNonArrayObject(value)) return fail(undefined, 'registerConsoleContribution requires an object spec');
  const id = typeof value.id === 'string' ? value.id : undefined;
  if (!isValidExtensionLocalContributionId(value.id)) return fail(id, 'registerConsoleContribution id must match ^[a-z][a-z0-9-]{0,63}$');
  if (!isNonBlankString(value.title)) return fail(id, 'registerConsoleContribution title must be a non-empty string');
  if (value.description !== undefined && typeof value.description !== 'string') return fail(id, 'registerConsoleContribution description must be a string');
  if (!Array.isArray(value.blocks) || value.blocks.length === 0) return fail(id, 'registerConsoleContribution requires a non-empty blocks array');
  let normalizedRequirements: NativeExtensionContributionRequirements | undefined;
  if (value.requirements !== undefined) {
    const requirementsResult = validateContributionRequirements(value.requirements, 'registerConsoleContribution requirements');
    if (!requirementsResult.ok) return fail(id, requirementsResult.message ?? 'registerConsoleContribution requirements are invalid');
    normalizedRequirements = requirementsResult.value;
  }
  for (const block of value.blocks) {
    const blockResult = validateConsoleContributionBlock(block);
    if (!blockResult.ok) return fail(id, blockResult.message ?? 'registerConsoleContribution block is invalid');
  }
  return { ok: true, id, value: { ...(value as unknown as ConsoleContributionSpec), ...(normalizedRequirements !== undefined && { requirements: normalizedRequirements }) } };
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
  if (hasFrameBundle) {
    const frameBundleResult = validateWorkstationFrameBundleSource(value.frameBundle);
    if (!frameBundleResult.ok) return fail(id, `registerConsoleWorkstation ${frameBundleResult.message}`);
  }
  if (value.allowedActions !== undefined) {
    if (!Array.isArray(value.allowedActions)) return fail(id, 'registerConsoleWorkstation allowedActions must be an array of local action ids');
    if (!value.allowedActions.every((actionId) => isValidExtensionLocalContributionId(actionId))) return fail(id, 'registerConsoleWorkstation allowedActions must contain only local action ids matching ^[a-z][a-z0-9-]{0,63}$');
  }
  const subviewsResult = validateConsoleWorkstationSubviews(value.subviews);
  if (!subviewsResult.ok) return fail(id, subviewsResult.message ?? 'registerConsoleWorkstation subviews are invalid');
  let normalizedRequirements: NativeExtensionContributionRequirements | undefined;
  if (value.requirements !== undefined) {
    const requirementsResult = validateContributionRequirements(value.requirements, 'registerConsoleWorkstation requirements');
    if (!requirementsResult.ok) return fail(id, requirementsResult.message ?? 'registerConsoleWorkstation requirements are invalid');
    normalizedRequirements = requirementsResult.value;
  }
  const jsonSafe = validateJsonSafeValue(value, { requireObjectRoot: true, rejectSymbolKeys: true });
  if (!jsonSafe.ok) return fail(id, `registerConsoleWorkstation spec must be JSON-safe: ${jsonSafe.message}`);
  return { ok: true, id, value: { ...(value as unknown as ConsoleWorkstationSpec), ...(normalizedRequirements !== undefined && { requirements: normalizedRequirements }) } };
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
  let normalizedRequirements: NativeExtensionContributionRequirements | undefined;
  if (spec.requirements !== undefined) {
    const requirementsResult = validateContributionRequirements(spec.requirements, 'registerIntegrationCommand requirements');
    if (!requirementsResult.ok) return fail(base.id, requirementsResult.message ?? 'registerIntegrationCommand requirements are invalid');
    normalizedRequirements = requirementsResult.value;
  }
  return { ok: true, id: base.id, value: { ...(value as IntegrationCommandSpec), ...(normalizedRequirements !== undefined && { requirements: normalizedRequirements }) } };
}

export function validateDeepLinkSpec(value: unknown): RegistrationValidationResult<ExtensionDeepLinkSpec> {
  const base = validateBase(value, 'registerDeepLink', 'label');
  if (!base.ok) return base as RegistrationValidationResult<ExtensionDeepLinkSpec>;
  const spec = value as Record<string, unknown>;
  if (spec.urlTemplate !== undefined && !isNonBlankString(spec.urlTemplate)) return fail(base.id, 'registerDeepLink urlTemplate must be a non-empty string');
  if (typeof spec.urlTemplate === 'string' && !isSafeDeepLinkUrlString(spec.urlTemplate)) return fail(base.id, 'registerDeepLink urlTemplate must use a safe URL scheme');
  if (spec.action !== undefined && !isValidActionBindingSpec(spec.action)) return fail(base.id, 'registerDeepLink action must be a valid action binding');
  if (spec.urlTemplate === undefined && spec.action === undefined) return fail(base.id, 'registerDeepLink requires urlTemplate or an action binding');
  let normalizedRequirements: NativeExtensionContributionRequirements | undefined;
  if (spec.requirements !== undefined) {
    const requirementsResult = validateContributionRequirements(spec.requirements, 'registerDeepLink requirements');
    if (!requirementsResult.ok) return fail(base.id, requirementsResult.message ?? 'registerDeepLink requirements are invalid');
    normalizedRequirements = requirementsResult.value;
  }
  return { ok: true, id: base.id, value: { ...(value as ExtensionDeepLinkSpec), ...(normalizedRequirements !== undefined && { requirements: normalizedRequirements }) } };
}

export function validateActionBindingJson(binding: ExtensionActionBindingSpec): JsonSafeValidationResult {
  if (!isValidExtensionLocalContributionId(binding.actionId)) return { ok: false, message: `action binding references invalid local action id "${String(binding.actionId)}"` };
  if (binding.inputDefaults === undefined) return { ok: true };
  if (!isNonArrayObject(binding.inputDefaults)) return { ok: false, message: 'action binding inputDefaults must be JSON-safe object data' };
  return validateJsonSafeValue(binding.inputDefaults, { requireObjectRoot: true, rejectSymbolKeys: true });
}

export function validateContributionRequirements(value: unknown, label = 'contribution requirements'): RegistrationValidationResult<NativeExtensionContributionRequirements> {
  if (!isNonArrayObject(value)) return fail(undefined, `${label} must be an object`);
  if (value.dependencies !== undefined && !Array.isArray(value.dependencies)) return fail(undefined, `${label}.dependencies must be an array`);
  if (value.capabilities !== undefined && !Array.isArray(value.capabilities)) return fail(undefined, `${label}.capabilities must be an array`);
  const dependencies = Array.isArray(value.dependencies) ? value.dependencies : [];
  const capabilities = Array.isArray(value.capabilities) ? value.capabilities : [];
  const normalizedDependencies: NativeExtensionContributionRequirements['dependencies'] = [];
  const normalizedCapabilities: NativeExtensionContributionRequirements['capabilities'] = [];
  for (const dependency of dependencies) {
    const result = normalizeDependencyRequirement(dependency, `${label}.dependencies`);
    if (!result.ok) return fail(undefined, result.message ?? `${label}.dependencies is invalid`);
    normalizedDependencies.push(result.value!);
  }
  for (const capability of capabilities) {
    const result = normalizeCapabilityRequirement(capability, `${label}.capabilities`);
    if (!result.ok) return fail(undefined, result.message ?? `${label}.capabilities is invalid`);
    normalizedCapabilities.push(result.value!);
  }
  return {
    ok: true,
    value: {
      ...(normalizedDependencies.length > 0 && { dependencies: normalizedDependencies }),
      ...(normalizedCapabilities.length > 0 && { capabilities: normalizedCapabilities }),
    },
  };
}

function normalizeDependencyRequirement(value: unknown, label: string): RegistrationValidationResult<NonNullable<NativeExtensionContributionRequirements['dependencies']>[number]> {
  if (typeof value === 'string' && value.trim().length > 0) return { ok: true, value: { name: value.trim() } };
  if (!isNonArrayObject(value)) return fail(undefined, `${label} entries must be objects or non-empty provider name strings`);
  const providerName = value.name ?? value.provider;
  if (providerName !== undefined && !isNonBlankString(providerName)) return fail(undefined, `${label}.name must be a non-empty string when present`);
  const version = value.version ?? value.providerVersion;
  if (version !== undefined && (typeof version !== 'string' || !isVersionConstraint(version))) return fail(undefined, `${label}.version must be an exact semantic version or supported comparator constraint`);
  const normalizedCapabilities: NonNullable<NativeExtensionContributionRequirements['dependencies']>[number]['capabilities'] = [];
  if (value.capabilities !== undefined) {
    if (!Array.isArray(value.capabilities)) return fail(undefined, `${label}.capabilities must be an array`);
    for (const capability of value.capabilities) {
      const result = normalizeCapabilityRequirement(capability, `${label}.capabilities`);
      if (!result.ok) return fail(undefined, result.message ?? `${label}.capabilities is invalid`);
      normalizedCapabilities.push(result.value!);
    }
  }
  if (providerName === undefined && normalizedCapabilities.length === 0) return fail(undefined, `${label} entries must declare a provider name or capability requirement`);
  const jsonSafe = validateJsonSafeValue(value, { requireObjectRoot: true, rejectSymbolKeys: true });
  if (!jsonSafe.ok) return fail(undefined, jsonSafe.message ?? `${label} entries must be JSON-safe`);
  return {
    ok: true,
    value: {
      ...(providerName !== undefined && { name: providerName as string }),
      ...(version !== undefined && { version: version as string }),
      ...(normalizedCapabilities.length > 0 && { capabilities: normalizedCapabilities }),
    },
  };
}

function validateCapabilityRequirement(value: unknown, label: string): JsonSafeValidationResult {
  const result = normalizeCapabilityRequirement(value, label);
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}

function normalizeCapabilityRequirement(value: unknown, label: string): RegistrationValidationResult<NonNullable<NativeExtensionContributionRequirements['capabilities']>[number]> {
  if (!isNonArrayObject(value) || !isNonBlankString(value.name)) return fail(undefined, `${label} entries require a non-empty name`);
  if (value.version !== undefined && (typeof value.version !== 'string' || !isVersionConstraint(value.version))) return fail(undefined, `${label}.version must be an exact semantic version or supported comparator constraint`);
  const jsonSafe = validateJsonSafeValue(value, { requireObjectRoot: true, rejectSymbolKeys: true });
  if (!jsonSafe.ok) return fail(undefined, jsonSafe.message ?? `${label} entries must be JSON-safe`);
  return { ok: true, value: { name: value.name, ...(value.version !== undefined && { version: value.version as string }) } };
}

function isVersionConstraint(value: string): boolean {
  return value.split(',').map((part) => part.trim()).every((part) => /^(?:[<>]=?|=)?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(part));
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

function validateConsoleWorkstationSubviews(value: unknown): JsonSafeValidationResult {
  if (value === undefined) return { ok: true };
  if (!Array.isArray(value)) return { ok: false, message: 'registerConsoleWorkstation subviews must be an array' };
  const seen = new Set<string>();
  for (const [index, subview] of value.entries()) {
    const result = validateConsoleWorkstationSubview(subview, index, seen);
    if (!result.ok) return result;
  }
  return { ok: true };
}

function validateConsoleWorkstationSubview(value: unknown, index: number, seen: Set<string>): JsonSafeValidationResult {
  const prefix = `registerConsoleWorkstation subviews[${index}]`;
  if (!isNonArrayObject(value)) return { ok: false, message: `${prefix} must be an object` };
  if (!hasOnlyAllowedSubviewFields(value)) return { ok: false, message: `${prefix} includes unsupported fields` };
  if (!isValidExtensionLocalContributionId(value.id)) return { ok: false, message: `${prefix}.id must match ^[a-z][a-z0-9-]{0,63}$` };
  const subviewId = value.id as ConsoleWorkstationSubviewSpec['id'];
  if (seen.has(subviewId)) return { ok: false, message: `${prefix}.id must be unique within the workstation` };
  seen.add(subviewId);
  if (!isNonBlankString(value.label)) return { ok: false, message: `${prefix}.label must be a non-empty string` };
  if (value.description !== undefined && typeof value.description !== 'string') return { ok: false, message: `${prefix}.description must be a string` };
  const hasPath = value.path !== undefined;
  const hasSubPath = value.subPath !== undefined;
  if (hasPath === hasSubPath) return { ok: false, message: `${prefix} requires exactly one of path or subPath` };
  if (hasPath && !isWorkstationInternalRoute(value.path)) return { ok: false, message: `${prefix}.path must be a workstation-internal route` };
  if (hasSubPath && !isWorkstationInternalRoute(value.subPath)) return { ok: false, message: `${prefix}.subPath must be a workstation-internal route` };
  return validateJsonSafeValue(value, { requireObjectRoot: true, rejectSymbolKeys: true });
}

function isWorkstationInternalRoute(value: unknown): value is string {
  if (!isNonBlankString(value)) return false;
  if (value.trim() !== value) return false;
  if (/[\u0000-\u001f\u007f#\\]/u.test(value)) return false;
  if (value.startsWith('?')) return true;
  if (value.startsWith('/') || URL_SCHEME_PATTERN.test(value)) return false;
  const [path = ''] = value.split('?');
  if (path.length === 0) return false;
  return path.split('/').every(isSafeWorkstationInternalRouteSegment);
}

function isSafeWorkstationInternalRouteSegment(segment: string): boolean {
  if (segment.length === 0) return false;
  try {
    const decoded = decodeURIComponent(segment);
    return decoded !== '.' && decoded !== '..';
  } catch {
    return false;
  }
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

function hasOnlyAllowedSubviewFields(subview: Record<string, unknown>): boolean {
  return Object.keys(subview).every((key) => key === 'id' || key === 'label' || key === 'description' || key === 'path' || key === 'subPath');
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

function isSafeDeepLinkUrlString(value: string): boolean {
  if (/[\u0000-\u001f\u007f]/u.test(value)) return false;
  if (value.startsWith('/console/')) return true;
  return isSafeUrlString(value, SAFE_DEEP_LINK_SCHEMES);
}

function isValidActionBindingSpec(value: unknown): value is ExtensionActionBindingSpec {
  if (!isNonArrayObject(value)) return false;
  if (!isValidExtensionLocalContributionId(value.actionId)) return false;
  if (value.inputDefaults !== undefined && !isNonArrayObject(value.inputDefaults)) return false;
  if (value.inputDefaults !== undefined && !validateJsonSafeValue(value.inputDefaults, { requireObjectRoot: true, rejectSymbolKeys: true }).ok) return false;
  return true;
}

export interface ActionSpecWarningContext {
  localId: string;
  effectiveId: string;
}

export interface ActionSpecWarning {
  code: string;
  message: string;
  name: string;
}

export function collectActionSpecWarnings(spec: ExtensionActionSpec, context: ActionSpecWarningContext): ActionSpecWarning[] {
  if (!isBroadContributionAction(spec, context)) return [];
  return [
    ...collectBroadActionControlWarnings(spec, context),
    ...collectLargeOutputProfileWarnings(spec, context),
  ];
}

function collectBroadActionControlWarnings(spec: ExtensionActionSpec, context: ActionSpecWarningContext): ActionSpecWarning[] {
  const propertyNames = collectSchemaPropertyNames(spec.inputSchema).map(normalizeControlName);
  const hasLimitControl = hasControlName(propertyNames, LIMIT_CONTROL_NAMES);
  const hasCursorControl = hasControlName(propertyNames, CURSOR_CONTROL_NAMES);
  const hasBoundedAgentPagination = spec.outputProfile === 'agent-paginated' && hasLimitControl && hasCursorControl;
  return [
    ...(!hasLimitControl ? [warning(context, 'extension:action-missing-limit-control', `Action "${context.effectiveId}" looks like a broad list/search/board action but its input schema does not expose a limit control.`)] : []),
    ...(!hasCursorControl ? [warning(context, 'extension:action-missing-cursor-control', `Action "${context.effectiveId}" looks like a broad list/search/board action but its input schema does not expose a cursor, offset, or page control.`)] : []),
    ...(!hasBoundedAgentPagination && !hasProjectionControl(propertyNames) ? [warning(context, 'extension:action-missing-projection-control', `Action "${context.effectiveId}" looks like a broad list/search/board action but its input schema does not expose projection controls such as fields, include/exclude, or compact/detail options.`)] : []),
  ];
}

function collectLargeOutputProfileWarnings(spec: ExtensionActionSpec, context: ActionSpecWarningContext): ActionSpecWarning[] {
  if (spec.outputProfile !== undefined || !schemaContainsArray(spec.outputSchema)) return [];
  return [warning(context, 'extension:action-output-profile-missing', `Action "${context.effectiveId}" looks like a broad large-output action but does not declare an outputProfile.`)];
}

function warning(context: ActionSpecWarningContext, code: string, message: string): ActionSpecWarning {
  return { code, message, name: context.effectiveId };
}

function isBroadContributionAction(spec: ExtensionActionSpec, context: ActionSpecWarningContext): boolean {
  return !hasBroadWarningSuppressingPrefix(context)
    && !hasBroadWarningSuppressingSideEffect(spec)
    && schemaContainsArray(spec.outputSchema)
    && hasBroadContributionIdShape(context);
}

function hasBroadWarningSuppressingPrefix(context: ActionSpecWarningContext): boolean {
  return contributionIdCandidates(context).some((id) => SINGLE_RECORD_ACTION_PREFIXES.some((prefix) => id.startsWith(prefix)));
}

function hasBroadWarningSuppressingSideEffect(spec: ExtensionActionSpec): boolean {
  return spec.sideEffects?.some((sideEffect) => BROAD_WARNING_SUPPRESSING_SIDE_EFFECTS.has(sideEffect)) ?? false;
}

function hasBroadContributionIdShape(context: ActionSpecWarningContext): boolean {
  return contributionIdCandidates(context).some((id) => BROAD_ACTION_TERMS.some((term) => hasIdSegment(id, term)));
}

function contributionIdCandidates(context: ActionSpecWarningContext): string[] {
  const effectiveLocalId = context.effectiveId.includes(':') ? context.effectiveId.split(':').pop() ?? context.effectiveId : context.effectiveId;
  return [context.localId, effectiveLocalId].map((id) => id.toLowerCase());
}

function hasIdSegment(id: string, segment: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${segment}([^a-z0-9]|$)`, 'u').test(id);
}

function collectSchemaPropertyNames(schema: unknown): string[] {
  if (!isNonArrayObject(schema)) return [];
  const properties = isNonArrayObject(schema.properties) ? schema.properties : {};
  const names = Object.keys(properties);
  const nestedProperties = Object.values(properties).flatMap(collectSchemaPropertyNames);
  const composed = ['allOf', 'anyOf', 'oneOf'].flatMap((key) => Array.isArray(schema[key]) ? schema[key].flatMap(collectSchemaPropertyNames) : []);
  const nestedSchemas = ['items', 'additionalProperties', 'contains', 'not', 'if', 'then', 'else'].flatMap((key) => collectSchemaPropertyNames(schema[key]));
  const dependentSchemas = isNonArrayObject(schema.dependentSchemas) ? Object.values(schema.dependentSchemas).flatMap(collectSchemaPropertyNames) : [];
  return [...names, ...nestedProperties, ...composed, ...nestedSchemas, ...dependentSchemas];
}

function schemaContainsArray(schema: unknown): boolean {
  if (!isNonArrayObject(schema)) return false;
  if (schema.type === 'array') return true;
  return Object.values(schema).some((value) => Array.isArray(value)
    ? value.some(schemaContainsArray)
    : schemaContainsArray(value));
}

function normalizeControlName(value: string): string {
  return value.replace(/[^a-z0-9]/giu, '').toLowerCase();
}

function hasControlName(propertyNames: string[], controls: Set<string>): boolean {
  return propertyNames.some((name) => controls.has(name));
}

function hasProjectionControl(propertyNames: string[]): boolean {
  return propertyNames.some((name) => PROJECTION_CONTROL_TERMS.some((term) => name.includes(term)));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isNonArrayObject(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function fail(id: string | undefined, message: string): RegistrationValidationResult<never> {
  return { ok: false, id, message };
}
