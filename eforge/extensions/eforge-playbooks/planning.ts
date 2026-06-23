import type { ExtensionActionContext, ExtensionAvailabilityDiagnostic } from '@eforge-build/extension-sdk';
import type { PlaybookPlanSeed } from '@eforge-build/input';
import {
  EXTENSION_NAME,
  PLANNING_ENTRY_ACTION_ID,
  PLANNING_ENTRY_COMMAND_ID,
  PLANNING_ENTRY_DEEP_LINK_ID,
  PLANNING_MODE_CAPABILITY,
  PLANNING_MODE_CAPABILITY_PROVIDER,
  PLANNING_MODE_CAPABILITY_VERSION,
  PLANNING_WORKSTATION_ID,
  PLANNING_WORKSTATION_URL,
} from './constants.js';
import { omitUndefined, projectPlanSeed } from './json-safe.js';

export const EFORGE_PLAN_DRIFT_CONSTANTS = {
  capability: PLANNING_MODE_CAPABILITY,
  version: '1.0.0',
  actionId: PLANNING_ENTRY_ACTION_ID,
  integrationCommandId: PLANNING_ENTRY_COMMAND_ID,
  deepLinkId: PLANNING_ENTRY_DEEP_LINK_ID,
  workstationId: PLANNING_WORKSTATION_ID,
  workstationUrl: PLANNING_WORKSTATION_URL,
} as const;

export function requiredPlanningCapability() {
  return { provider: PLANNING_MODE_CAPABILITY_PROVIDER, id: PLANNING_MODE_CAPABILITY, range: PLANNING_MODE_CAPABILITY_VERSION } as const;
}

export function planningEntry(seed: PlaybookPlanSeed) {
  return {
    contributionId: PLANNING_ENTRY_ACTION_ID,
    actionId: PLANNING_ENTRY_ACTION_ID,
    integrationCommandId: PLANNING_ENTRY_COMMAND_ID,
    deepLinkId: PLANNING_ENTRY_DEEP_LINK_ID,
    workstationId: PLANNING_WORKSTATION_ID,
    workstationUrl: PLANNING_WORKSTATION_URL,
    seed: projectPlanSeed(seed),
    source: { extension: EXTENSION_NAME, playbook: seed.seededFrom },
  } as const;
}

export function planningRunResult(ctx: ExtensionActionContext, name: string, seed: PlaybookPlanSeed) {
  const availability = ctx.capabilities.get(PLANNING_MODE_CAPABILITY, PLANNING_MODE_CAPABILITY_VERSION);
  const eforgePlanProvider = availability.providers.find((provider) => provider.extensionName === PLANNING_MODE_CAPABILITY_PROVIDER);
  if (availability.available && eforgePlanProvider) {
    return {
      kind: 'requires-agent' as const,
      mode: 'planning' as const,
      name,
      requiredCapability: requiredPlanningCapability(),
      planningEntry: planningEntry(seed),
      message: 'Continue this planning-mode playbook with the eforge-plan planning entry.',
    };
  }
  return {
    kind: 'planning-unavailable' as const,
    mode: 'planning' as const,
    name,
    requiredCapability: requiredPlanningCapability(),
    diagnostics: normalizeDiagnostics(providerScopedDiagnostics(availability.diagnostics)),
    planningEntry: planningEntry(seed),
    message: 'The optional eforge-plan planning capability is unavailable. Install/load eforge-plan, trust project-team extensions when needed, and reload extensions before retrying.',
  };
}

function providerScopedDiagnostics(diagnostics: ExtensionAvailabilityDiagnostic[]) {
  if (diagnostics.length > 0) return diagnostics.map((diagnostic) => ({
    ...diagnostic,
    providerName: diagnostic.providerName ?? PLANNING_MODE_CAPABILITY_PROVIDER,
    capabilityName: diagnostic.capabilityName ?? PLANNING_MODE_CAPABILITY,
    requiredVersion: diagnostic.requiredVersion ?? PLANNING_MODE_CAPABILITY_VERSION,
  }));
  return [{
    code: 'extension:dependency-capability-incompatible',
    message: 'eforge-plan is not loaded with capability eforge.plan.planning-mode-playbook >=1.0.0. Install/load it, trust project-team extensions if prompted, and reload extensions.',
    severity: 'warning' as const,
    dependencyName: PLANNING_MODE_CAPABILITY_PROVIDER,
    providerName: PLANNING_MODE_CAPABILITY_PROVIDER,
    capabilityName: PLANNING_MODE_CAPABILITY,
    requiredVersion: PLANNING_MODE_CAPABILITY_VERSION,
  }];
}

function normalizeDiagnostics(diagnostics: ExtensionAvailabilityDiagnostic[]) {
  const base = diagnostics.map((diagnostic) => omitUndefined({
    code: diagnostic.code,
    message: diagnostic.message,
    severity: diagnostic.severity,
    dependencyName: diagnostic.dependencyName,
    providerName: diagnostic.providerName,
    capabilityName: diagnostic.capabilityName,
    requiredVersion: diagnostic.requiredVersion,
    actualVersion: diagnostic.actualVersion,
  })).filter((diagnostic) => diagnostic.code && diagnostic.message);
  if (base.length > 0) return base;
  return [{
    code: 'extension:dependency-missing',
    message: 'eforge-plan is not loaded with capability eforge.plan.planning-mode-playbook >=1.0.0. Install/load it, trust project-team extensions if prompted, and reload extensions.',
    severity: 'warning' as const,
    dependencyName: 'eforge-plan',
    providerName: PLANNING_MODE_CAPABILITY_PROVIDER,
    capabilityName: PLANNING_MODE_CAPABILITY,
    requiredVersion: PLANNING_MODE_CAPABILITY_VERSION,
  }];
}
