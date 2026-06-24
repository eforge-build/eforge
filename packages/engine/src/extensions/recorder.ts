import {
  collectActionSpecWarnings,
  validateActionBindingJson,
  validateActionSpec,
  validateAgentTaskSpec,
  validateConsoleContributionSpec,
  validateConsoleWorkstationSpec,
  validateDeepLinkSpec,
  validateIntegrationCommandSpec,
} from './contribution-validation.js';
import { buildDuplicateContributionDiagnostic, resolveExtensionContributionId } from './ids.js';
import type {
  ActionRegistration,
  ConsoleContributionRegistration,
  ConsoleWorkstationRegistration,
  DeepLinkRegistration,
  EforgeExtensionAPIShape,
  EventPattern,
  ExtensionHandler,
  ExtensionTool,
  IntegrationCommandRegistration,
  InputSourceAdapter,
  NativeExtensionDiagnostic,
  NativeExtensionRecorderState,
  PolicyGateKind,
  PolicyGateMethod,
  PrdEnricherSpec,
  ProfileRouterSpec,
  ReviewerPerspectiveSpec,
  ValidationProviderSpec,
} from './types.js';

export function createExtensionRecorder(extensionName: string, extensionPath: string): {
  api: EforgeExtensionAPIShape;
  state: NativeExtensionRecorderState;
} {
  const state: NativeExtensionRecorderState = {
    eventHooks: [],
    agentRunHooks: [],
    policyGates: [],
    profileRouters: [],
    inputSources: [],
    reviewerPerspectives: [],
    validationProviders: [],
    tools: [],
    prdEnrichers: [],
    actions: [],
    // --- eforge:region plan-01-agent-task-contribution-contract ---
    agentTasks: [],
    // --- eforge:endregion plan-01-agent-task-contribution-contract ---
    consoleContributions: [],
    consoleWorkstations: [],
    integrationCommands: [],
    deepLinks: [],
    diagnostics: [],
  };

  const addDiagnostic = (message: string, code = 'extension:invalid-registration', name?: string, severity: NativeExtensionDiagnostic['severity'] = 'error'): void => {
    state.diagnostics.push({
      severity,
      code,
      message,
      name,
      path: extensionPath,
      extensionName,
    });
  };

  let policyGateRegistrationIndex = 0;
  const recordPolicyGate = (method: PolicyGateMethod, gateKind: PolicyGateKind, handler: unknown): void => {
    if (typeof handler !== 'function') {
      addDiagnostic(`${method} requires a handler function`);
      return;
    }
    state.policyGates.push({
      kind: 'policyGate',
      extensionName,
      extensionPath,
      gateKind,
      method,
      registrationIndex: policyGateRegistrationIndex,
      value: handler as ExtensionHandler,
    });
    policyGateRegistrationIndex += 1;
  };

  const api: EforgeExtensionAPIShape = {
    onEvent(pattern: EventPattern, handler: unknown): void {
      if (!isNonEmptyString(pattern)) {
        addDiagnostic('onEvent requires a non-empty string pattern');
        return;
      }
      if (typeof handler !== 'function') {
        addDiagnostic(`onEvent("${pattern}") requires a handler function`);
        return;
      }
      state.eventHooks.push({
        kind: 'eventHook',
        extensionName,
        extensionPath,
        value: { pattern, handler: handler as ExtensionHandler },
      });
    },
    onAgentRun(handler: unknown): void {
      if (typeof handler !== 'function') {
        addDiagnostic('onAgentRun requires a handler function');
        return;
      }
      state.agentRunHooks.push({ kind: 'agentRunHook', extensionName, extensionPath, value: handler as ExtensionHandler });
    },
    beforeQueueDispatch(handler: unknown): void {
      recordPolicyGate('beforeQueueDispatch', 'queue-dispatch', handler);
    },
    beforePlanMerge(handler: unknown): void {
      recordPolicyGate('beforePlanMerge', 'plan-merge', handler);
    },
    beforeFinalMerge(handler: unknown): void {
      recordPolicyGate('beforeFinalMerge', 'final-merge', handler);
    },
    registerProfileRouter(spec: unknown): void {
      if (
        !isObject(spec) ||
        !isNonEmptyString(spec.name) ||
        (typeof spec.selectBuildProfile !== 'function' && typeof spec.resolve !== 'function')
      ) {
        addDiagnostic(
          'registerProfileRouter requires { name: string, selectBuildProfile: function } (or deprecated { resolve: function })',
          'extension:invalid-registration',
          isObject(spec) && typeof spec.name === 'string' ? spec.name : undefined,
        );
        return;
      }
      state.profileRouters.push({ kind: 'profileRouter', extensionName, extensionPath, name: spec.name, value: spec as unknown as ProfileRouterSpec });
    },
    registerInputSource(adapter: unknown): void {
      if (!isObject(adapter) || !isNonEmptyString(adapter.name) || !isNonEmptyString(adapter.description) || typeof adapter.fetch !== 'function') {
        addDiagnostic('registerInputSource requires { name: string, description: string, fetch: function }', 'extension:invalid-registration', isObject(adapter) && typeof adapter.name === 'string' ? adapter.name : undefined);
        return;
      }
      state.inputSources.push({ kind: 'inputSource', extensionName, extensionPath, name: adapter.name, value: adapter as unknown as InputSourceAdapter });
    },
    registerPrdEnricher(enricher: unknown): void {
      if (!isObject(enricher) || !isNonEmptyString(enricher.name) || !isNonEmptyString(enricher.description) || typeof enricher.enrich !== 'function') {
        addDiagnostic('registerPrdEnricher requires { name: string, description: string, enrich: function }', 'extension:invalid-registration', isObject(enricher) && typeof enricher.name === 'string' ? enricher.name : undefined);
        return;
      }
      state.prdEnrichers.push({ kind: 'prdEnricher', extensionName, extensionPath, name: enricher.name, value: enricher as unknown as PrdEnricherSpec });
    },
    registerReviewerPerspective(spec: unknown): void {
      if (!isObject(spec) || !isNonEmptyString(spec.key) || !isNonEmptyString(spec.label) || !isNonEmptyString(spec.description) || !isNonEmptyString(spec.promptFragment)) {
        addDiagnostic('registerReviewerPerspective requires { key: string, label: string, description: string, promptFragment: string }', 'extension:invalid-registration', isObject(spec) && typeof spec.key === 'string' ? spec.key : undefined);
        return;
      }
      if (!isSafeReviewerPerspectiveKey(spec.key)) {
        addDiagnostic(`registerReviewerPerspective key "${spec.key}" is invalid: must match ^[a-z][a-z0-9-]{0,63}$ and not be a built-in perspective name (code, security, api, docs, test, verify)`, 'extension:invalid-registration', spec.key);
        return;
      }
      if (spec.appliesTo !== undefined && !isValidApplicabilityShape(spec.appliesTo)) {
        addDiagnostic(`registerReviewerPerspective appliesTo for "${spec.key}" is invalid: must be an object with optional fileGlobs, paths, extensions, categories, minChangedFiles, minChangedLines, fn fields`, 'extension:invalid-registration', spec.key);
        return;
      }
      state.reviewerPerspectives.push({ kind: 'reviewerPerspective', extensionName, extensionPath, name: spec.key, value: spec as unknown as ReviewerPerspectiveSpec });
    },
    registerValidationProvider(spec: unknown): void {
      if (!isObject(spec) || !isNonEmptyString(spec.name) || !isNonEmptyString(spec.description)) {
        addDiagnostic('registerValidationProvider requires { name: string, description: string, validate: function } or { name: string, description: string, commands: string[] }', 'extension:invalid-registration', isObject(spec) && typeof spec.name === 'string' ? spec.name : undefined);
        return;
      }
      const hasValidate = typeof spec.validate === 'function';
      const hasCommandsField = spec.commands !== undefined;
      const hasCommands = Array.isArray(spec.commands) && spec.commands.length > 0 && spec.commands.every((c) => isNonEmptyString(c));
      if (hasValidate && hasCommandsField) {
        addDiagnostic(`registerValidationProvider "${spec.name}": provide either validate or commands, not both`, 'extension:invalid-registration', spec.name);
        return;
      }
      if (hasCommandsField && !hasCommands) {
        addDiagnostic(`registerValidationProvider "${spec.name}": commands must be a non-empty array of non-empty strings`, 'extension:invalid-registration', spec.name);
        return;
      }
      if (!hasValidate && !hasCommands) {
        addDiagnostic(`registerValidationProvider "${spec.name}": provide exactly one of validate (function) or commands (non-empty string array)`, 'extension:invalid-registration', spec.name);
        return;
      }
      state.validationProviders.push({ kind: 'validationProvider', extensionName, extensionPath, name: spec.name, value: spec as unknown as ValidationProviderSpec });
    },
    registerTool(tool: unknown): void {
      if (!isObject(tool) || !isNonEmptyString(tool.name) || !isNonEmptyString(tool.description) || !isObject(tool.inputSchema) || typeof tool.handler !== 'function') {
        addDiagnostic('registerTool requires { name: string, description: string, inputSchema: object, handler: function }', 'extension:invalid-registration', isObject(tool) && typeof tool.name === 'string' ? tool.name : undefined);
        return;
      }
      if (!isObjectRootInputSchema(tool.inputSchema)) {
        addDiagnostic('registerTool inputSchema must be an object-root schema (type: "object")', 'extension:invalid-registration', tool.name);
        return;
      }
      state.tools.push({ kind: 'tool', extensionName, extensionPath, name: tool.name, value: tool as unknown as ExtensionTool });
    },
    // --- eforge:region plan-01-agent-task-contribution-contract ---
    registerAgentTask(task: unknown): void {
      const result = validateAgentTaskSpec(task);
      if (!result.ok || result.value === undefined || result.id === undefined) {
        addDiagnostic(result.message ?? 'registerAgentTask registration is invalid', 'extension:invalid-registration', result.id);
        return;
      }
      const id = resolveExtensionContributionId(extensionName, result.id);
      state.agentTasks.push({ kind: 'agentTask', extensionName, extensionPath, localId: result.id, id, value: result.value, ...(result.value.requirements !== undefined && { requirements: result.value.requirements }) });
    },
    // --- eforge:endregion plan-01-agent-task-contribution-contract ---
    registerAction(action: unknown): void {
      const result = validateActionSpec(action);
      if (!result.ok || result.value === undefined || result.id === undefined) {
        addDiagnostic(result.message ?? 'registerAction registration is invalid', 'extension:invalid-registration', result.id);
        return;
      }
      const id = resolveExtensionContributionId(extensionName, result.id);
      state.actions.push({ kind: 'action', extensionName, extensionPath, localId: result.id, id, value: result.value, ...(result.value.requirements !== undefined && { requirements: result.value.requirements }) });
      for (const warning of collectActionSpecWarnings(result.value, { localId: result.id, effectiveId: id })) {
        addDiagnostic(warning.message, warning.code, warning.name, 'warning');
      }
    },
    registerConsoleContribution(contribution: unknown): void {
      const result = validateConsoleContributionSpec(contribution);
      if (!result.ok || result.value === undefined || result.id === undefined) {
        addDiagnostic(result.message ?? 'registerConsoleContribution registration is invalid', 'extension:invalid-registration', result.id);
        return;
      }
      state.consoleContributions.push({ kind: 'consoleContribution', extensionName, extensionPath, localId: result.id, id: resolveExtensionContributionId(extensionName, result.id), value: result.value, ...(result.value.requirements !== undefined && { requirements: result.value.requirements }) });
    },
    registerConsoleWorkstation(workstation: unknown): void {
      const result = validateConsoleWorkstationSpec(workstation);
      if (!result.ok || result.value === undefined || result.id === undefined) {
        addDiagnostic(result.message ?? 'registerConsoleWorkstation registration is invalid', 'extension:invalid-registration', result.id);
        return;
      }
      state.consoleWorkstations.push({ kind: 'consoleWorkstation', extensionName, extensionPath, localId: result.id, id: resolveExtensionContributionId(extensionName, result.id), value: result.value, ...(result.value.requirements !== undefined && { requirements: result.value.requirements }) });
    },
    registerIntegrationCommand(command: unknown): void {
      const result = validateIntegrationCommandSpec(command);
      if (!result.ok || result.value === undefined || result.id === undefined) {
        addDiagnostic(result.message ?? 'registerIntegrationCommand registration is invalid', 'extension:invalid-registration', result.id);
        return;
      }
      state.integrationCommands.push({ kind: 'integrationCommand', extensionName, extensionPath, localId: result.id, id: resolveExtensionContributionId(extensionName, result.id), value: result.value, ...(result.value.requirements !== undefined && { requirements: result.value.requirements }) });
    },
    registerDeepLink(deepLink: unknown): void {
      const result = validateDeepLinkSpec(deepLink);
      if (!result.ok || result.value === undefined || result.id === undefined) {
        addDiagnostic(result.message ?? 'registerDeepLink registration is invalid', 'extension:invalid-registration', result.id);
        return;
      }
      state.deepLinks.push({ kind: 'deepLink', extensionName, extensionPath, localId: result.id, id: resolveExtensionContributionId(extensionName, result.id), value: result.value, ...(result.value.requirements !== undefined && { requirements: result.value.requirements }) });
    },
  };

  return { api, state };
}

export function mergeRecorderState(target: NativeExtensionRecorderState, source: NativeExtensionRecorderState): NativeExtensionDiagnostic[] {
  const diagnostics: NativeExtensionDiagnostic[] = [];
  target.eventHooks.push(...source.eventHooks);
  target.agentRunHooks.push(...source.agentRunHooks);
  target.policyGates.push(...source.policyGates);
  const immediateDiagnostics = source.diagnostics.filter((diagnostic) => !isActionSpecWarningDiagnostic(diagnostic));
  target.diagnostics.push(...immediateDiagnostics);
  diagnostics.push(...immediateDiagnostics);

  mergeNamedRegistrations(target.profileRouters, source.profileRouters, 'profile router', diagnostics, target.diagnostics);
  mergeNamedRegistrations(target.inputSources, source.inputSources, 'input source', diagnostics, target.diagnostics);
  mergeNamedRegistrations(target.prdEnrichers, source.prdEnrichers, 'PRD enricher', diagnostics, target.diagnostics);
  mergeNamedRegistrations(target.reviewerPerspectives, source.reviewerPerspectives, 'reviewer perspective', diagnostics, target.diagnostics);
  mergeNamedRegistrations(target.validationProviders, source.validationProviders, 'validation provider', diagnostics, target.diagnostics);
  const acceptedActionRegistrations = mergeIdRegistrations(target.actions, source.actions, 'action', diagnostics, target.diagnostics);
  // --- eforge:region plan-01-agent-task-contribution-contract ---
  mergeIdRegistrations(target.agentTasks, source.agentTasks, 'agent task', diagnostics, target.diagnostics);
  // --- eforge:endregion plan-01-agent-task-contribution-contract ---
  const acceptedActionWarnings = acceptedActionRegistrations.flatMap((registration) => collectActionSpecWarnings(registration.value, { localId: registration.localId, effectiveId: registration.id }).map((warning) => ({
    severity: 'warning' as const,
    code: warning.code,
    message: warning.message,
    name: warning.name,
    path: registration.extensionPath,
    extensionName: registration.extensionName,
  })));
  target.diagnostics.push(...acceptedActionWarnings);
  diagnostics.push(...acceptedActionWarnings);
  const acceptedActions = new Set(target.actions.map(actionLookupKey));
  mergeBoundIdRegistrations(target.consoleContributions, source.consoleContributions, 'Console contribution', acceptedActions, diagnostics, target.diagnostics);
  mergeConsoleWorkstationRegistrations(target.consoleWorkstations, source.consoleWorkstations, acceptedActions, diagnostics, target.diagnostics);
  mergeBoundIdRegistrations(target.integrationCommands, source.integrationCommands, 'integration command', acceptedActions, diagnostics, target.diagnostics);
  mergeBoundIdRegistrations(target.deepLinks, source.deepLinks, 'deep link', acceptedActions, diagnostics, target.diagnostics);
  mergeNamedRegistrations(target.tools, source.tools, 'tool', diagnostics, target.diagnostics);
  return diagnostics;
}


function mergeIdRegistrations<T extends { id: string; extensionName: string; extensionPath: string }>(
  target: T[],
  source: T[],
  label: string,
  diagnostics: NativeExtensionDiagnostic[],
  allDiagnostics: NativeExtensionDiagnostic[],
): T[] {
  const accepted: T[] = [];
  const existing = new Map(target.map((entry) => [entry.id, entry]));
  for (const registration of source) {
    const duplicate = existing.get(registration.id);
    if (duplicate) {
      const diagnostic = buildDuplicateContributionDiagnostic(label, registration, duplicate);
      diagnostics.push(diagnostic);
      allDiagnostics.push(diagnostic);
      continue;
    }
    target.push(registration);
    accepted.push(registration);
    existing.set(registration.id, registration);
  }
  return accepted;
}

function isActionSpecWarningDiagnostic(diagnostic: NativeExtensionDiagnostic): boolean {
  return diagnostic.severity === 'warning' && diagnostic.code.startsWith('extension:action-');
}

function mergeConsoleWorkstationRegistrations(
  target: ConsoleWorkstationRegistration[],
  source: ConsoleWorkstationRegistration[],
  acceptedActions: Set<string>,
  diagnostics: NativeExtensionDiagnostic[],
  allDiagnostics: NativeExtensionDiagnostic[],
): void {
  const filtered: ConsoleWorkstationRegistration[] = [];
  for (const registration of source) {
    const invalidAction = findInvalidWorkstationAllowedAction(registration, acceptedActions);
    if (invalidAction !== undefined) {
      const diagnostic: NativeExtensionDiagnostic = {
        severity: 'error',
        code: 'extension:invalid-registration',
        message: `Console workstation "${registration.id}" references unknown local action "${invalidAction}" from extension "${registration.extensionName}"`,
        name: registration.id,
        path: registration.extensionPath,
        extensionName: registration.extensionName,
      };
      diagnostics.push(diagnostic);
      allDiagnostics.push(diagnostic);
      continue;
    }
    filtered.push(registration);
  }
  mergeIdRegistrations(target, filtered, 'Console workstation', diagnostics, allDiagnostics);
}

function mergeBoundIdRegistrations<T extends (ConsoleContributionRegistration | IntegrationCommandRegistration | DeepLinkRegistration)>(
  target: T[],
  source: T[],
  label: string,
  acceptedActions: Set<string>,
  diagnostics: NativeExtensionDiagnostic[],
  allDiagnostics: NativeExtensionDiagnostic[],
): void {
  const filtered: T[] = [];
  for (const registration of source) {
    const invalidBinding = findInvalidBinding(registration, acceptedActions);
    if (invalidBinding !== undefined) {
      const diagnostic: NativeExtensionDiagnostic = {
        severity: 'error',
        code: 'extension:invalid-registration',
        message: `${label} "${registration.id}" references unknown local action "${invalidBinding}" from extension "${registration.extensionName}"`,
        name: registration.id,
        path: registration.extensionPath,
        extensionName: registration.extensionName,
      };
      diagnostics.push(diagnostic);
      allDiagnostics.push(diagnostic);
      continue;
    }
    filtered.push(registration);
  }
  mergeIdRegistrations(target, filtered, label, diagnostics, allDiagnostics);
}

function findInvalidWorkstationAllowedAction(registration: ConsoleWorkstationRegistration, acceptedActions: Set<string>): string | undefined {
  if (registration.value.allowedActions === undefined) return undefined;
  for (const actionId of registration.value.allowedActions) {
    if (!acceptedActions.has(`${registration.extensionName}\0${registration.extensionPath}\0${actionId}`)) return actionId;
  }
  return undefined;
}

function findInvalidBinding(registration: ConsoleContributionRegistration | IntegrationCommandRegistration | DeepLinkRegistration, acceptedActions: Set<string>): string | undefined {
  const bindings: Array<{ actionId: string; inputDefaults?: Record<string, unknown> }> = [];
  if (registration.kind === 'consoleContribution') {
    for (const block of registration.value.blocks) if ('action' in block) bindings.push(block.action);
  } else if (registration.kind === 'integrationCommand') {
    bindings.push(registration.value.action);
  } else if (registration.value.action !== undefined) {
    bindings.push(registration.value.action);
  }
  for (const binding of bindings) {
    const json = validateActionBindingJson(binding);
    if (!json.ok) return binding.actionId;
    if (!acceptedActions.has(`${registration.extensionName}\0${registration.extensionPath}\0${binding.actionId}`)) return binding.actionId;
  }
  return undefined;
}

function actionLookupKey(action: ActionRegistration): string {
  return `${action.extensionName}\0${action.extensionPath}\0${action.localId}`;
}

function mergeNamedRegistrations<T extends { name: string; extensionName: string; extensionPath: string }>(
  target: T[],
  source: T[],
  label: string,
  diagnostics: NativeExtensionDiagnostic[],
  allDiagnostics: NativeExtensionDiagnostic[],
): void {
  const existing = new Map(target.map((entry) => [entry.name, entry]));
  for (const registration of source) {
    const duplicate = existing.get(registration.name);
    if (duplicate) {
      const diagnostic: NativeExtensionDiagnostic = {
        severity: 'error',
        code: 'extension:duplicate-registration',
        message: `Duplicate ${label} name "${registration.name}" from extension "${registration.extensionName}" conflicts with extension "${duplicate.extensionName}"`,
        name: registration.name,
        path: registration.extensionPath,
      };
      diagnostics.push(diagnostic);
      allDiagnostics.push(diagnostic);
      continue;
    }
    target.push(registration);
    existing.set(registration.name, registration);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isObjectRootInputSchema(value: Record<string, unknown>): boolean {
  return value.type === 'object';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

const BUILT_IN_REVIEWER_PERSPECTIVE_KEYS = new Set(['code', 'security', 'api', 'docs', 'test', 'verify']);
const SAFE_REVIEWER_PERSPECTIVE_KEY_RE = /^[a-z][a-z0-9-]{0,63}$/;

function isSafeReviewerPerspectiveKey(key: string): boolean {
  return SAFE_REVIEWER_PERSPECTIVE_KEY_RE.test(key) && !BUILT_IN_REVIEWER_PERSPECTIVE_KEYS.has(key);
}

const VALID_APPLICABILITY_CATEGORY_VALUES = new Set(['code', 'api', 'docs', 'config', 'deps', 'test']);

function isValidApplicabilityShape(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (value.fileGlobs !== undefined && !isStringArray(value.fileGlobs)) return false;
  if (value.paths !== undefined && !isStringArray(value.paths)) return false;
  if (value.extensions !== undefined && !isStringArray(value.extensions)) return false;
  if (value.categories !== undefined) {
    if (!Array.isArray(value.categories)) return false;
    if (!value.categories.every((c) => typeof c === 'string' && VALID_APPLICABILITY_CATEGORY_VALUES.has(c))) return false;
  }
  if (value.minChangedFiles !== undefined && !isNonNegativeInteger(value.minChangedFiles)) return false;
  if (value.minChangedLines !== undefined && !isNonNegativeInteger(value.minChangedLines)) return false;
  if (value.fn !== undefined && typeof value.fn !== 'function') return false;
  return true;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
