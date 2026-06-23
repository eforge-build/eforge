import type {
  ConsoleWorkstationManifestEntry,
  ConsoleWorkstationSubviewManifestEntry,
  ExtensionActionSideEffect,
  ExtensionContributionManifestResponse,
  ExtensionJsonObject,
} from '@eforge-build/client/browser';
import { buildNavItems, toConsolePath, toConsoleWorkstationSubviewPath } from '@/lib/navigation';
import { sortWorkstations } from '@/views/workstations/workstation-selectors';

export type CommandPaletteGroup = 'Navigation' | 'Workstations' | 'Workstation subviews' | 'Extension commands';
export type CommandSideEffectClass = ExtensionActionSideEffect | 'unknown';

interface BaseCommandDescriptor {
  id: string;
  label: string;
  group: CommandPaletteGroup;
  description?: string;
  keywords?: string[];
}

export interface NavigationCommandDescriptor extends BaseCommandDescriptor {
  kind: 'navigation';
  href: string;
}

export interface OpenWorkstationCommandDescriptor extends BaseCommandDescriptor {
  kind: 'open-workstation';
}

export interface WorkstationCommandDescriptor extends BaseCommandDescriptor {
  kind: 'workstation';
  href: string;
  workstationId: string;
  extensionName: string;
}

export interface WorkstationSubviewCommandDescriptor extends BaseCommandDescriptor {
  kind: 'workstation-subview';
  href: string;
  workstationId: string;
  subviewId: string;
  extensionName: string;
}

export interface ExtensionCommandDescriptor extends BaseCommandDescriptor {
  kind: 'extension-command';
  actionId: string;
  extensionName: string;
  input: ExtensionJsonObject;
  sideEffectClasses: CommandSideEffectClass[];
  requiresConfirmation: boolean;
}

export type CommandDescriptor =
  | NavigationCommandDescriptor
  | OpenWorkstationCommandDescriptor
  | WorkstationCommandDescriptor
  | WorkstationSubviewCommandDescriptor
  | ExtensionCommandDescriptor;

export interface CommandPaletteModel {
  navigationCommands: NavigationCommandDescriptor[];
  openWorkstationCommand: OpenWorkstationCommandDescriptor;
  workstationCommands: WorkstationCommandDescriptor[];
  workstationSubviewCommands: WorkstationSubviewCommandDescriptor[];
  extensionCommands: ExtensionCommandDescriptor[];
}

export function buildCommandPaletteModel(manifest: ExtensionContributionManifestResponse | undefined): CommandPaletteModel {
  const workstations = sortWorkstations(manifest?.consoleWorkstations ?? []);
  return {
    navigationCommands: buildNavigationCommands(),
    openWorkstationCommand: buildOpenWorkstationCommand(),
    workstationCommands: buildWorkstationCommands(workstations),
    workstationSubviewCommands: buildWorkstationSubviewCommands(workstations),
    extensionCommands: buildExtensionIntegrationCommands(manifest),
  };
}

export function buildNavigationCommands(): NavigationCommandDescriptor[] {
  return buildNavItems().map((item) => ({
    kind: 'navigation',
    id: `nav:${item.id}`,
    label: item.label,
    group: 'Navigation',
    href: item.href,
  }));
}

export function buildOpenWorkstationCommand(): OpenWorkstationCommandDescriptor {
  return {
    kind: 'open-workstation',
    id: 'open-workstation',
    label: 'Open Workstation',
    group: 'Workstations',
    description: 'Open a registered Console workstation.',
  };
}

export function buildWorkstationCommands(workstations: ConsoleWorkstationManifestEntry[]): WorkstationCommandDescriptor[] {
  return sortWorkstations(workstations).map((workstation) => ({
    kind: 'workstation',
    id: `workstation:${workstation.id}`,
    label: `Open ${workstation.title}`,
    group: 'Workstations',
    description: workstation.description ?? workstation.extensionName,
    href: toConsolePath({ id: 'workstationDetail', workstationId: workstation.id }),
    workstationId: workstation.id,
    extensionName: workstation.extensionName,
    keywords: [workstation.title, workstation.extensionName, workstation.id],
  }));
}

export function buildWorkstationSubviewCommands(workstations: ConsoleWorkstationManifestEntry[]): WorkstationSubviewCommandDescriptor[] {
  return sortWorkstations(workstations).flatMap((workstation) => (
    (workstation.subviews ?? []).map((subview) => buildSubviewCommand(workstation, subview))
  ));
}

function buildSubviewCommand(
  workstation: ConsoleWorkstationManifestEntry,
  subview: ConsoleWorkstationSubviewManifestEntry,
): WorkstationSubviewCommandDescriptor {
  return {
    kind: 'workstation-subview',
    id: `workstation-subview:${workstation.id}:${subview.id}`,
    label: `${workstation.title}: ${subview.label}`,
    group: 'Workstation subviews',
    description: subview.description ?? workstation.extensionName,
    href: toConsoleWorkstationSubviewPath(workstation.id, subview),
    workstationId: workstation.id,
    subviewId: subview.id,
    extensionName: workstation.extensionName,
    keywords: [workstation.title, workstation.extensionName, subview.label, subview.id],
  };
}

export function buildExtensionIntegrationCommands(
  manifest: ExtensionContributionManifestResponse | undefined,
): ExtensionCommandDescriptor[] {
  if (!manifest) return [];
  const actionLookup = new Map(manifest.actions.map((action) => [action.id, action]));
  return manifest.integrationCommands.flatMap((command) => {
    const boundAction = actionLookup.get(command.action.actionId);
    if (!boundAction) return [];
    if (command.availability?.available === false || boundAction.availability?.available === false) return [];
    const input = { ...(command.action.inputDefaults ?? {}) };
    const inputSchema = command.inputSchema ?? boundAction.inputSchema;
    if (!hasSatisfiedRequiredInput(inputSchema, input)) return [];
    const sideEffects = classifySideEffects(boundAction.sideEffects);
    return [{
      kind: 'extension-command' as const,
      id: command.id,
      label: command.label,
      group: 'Extension commands' as const,
      description: command.description ?? boundAction.description,
      actionId: boundAction.id,
      extensionName: command.extensionName,
      input,
      ...sideEffects,
      keywords: [command.extensionName, command.id, boundAction.id],
    }];
  });
}

export function classifySideEffects(sideEffects: ExtensionActionSideEffect[] | undefined): {
  sideEffectClasses: CommandSideEffectClass[];
  requiresConfirmation: boolean;
} {
  const sideEffectClasses: CommandSideEffectClass[] = sideEffects && sideEffects.length > 0
    ? [...new Set(sideEffects)]
    : ['unknown'];
  return {
    sideEffectClasses,
    requiresConfirmation: sideEffectClasses.some((sideEffect) => sideEffect === 'unknown' || !isReadOnlySideEffect(sideEffect)),
  };
}

export function hasSatisfiedRequiredInput(
  inputSchema: ExtensionJsonObject | undefined,
  input: ExtensionJsonObject,
): boolean {
  return requiredInputKeys(inputSchema).every((key) => Object.hasOwn(input, key));
}

export function requiredInputKeys(inputSchema: ExtensionJsonObject | undefined): string[] {
  const required = inputSchema?.required;
  return Array.isArray(required) ? required.filter((key): key is string => typeof key === 'string') : [];
}

function isReadOnlySideEffect(sideEffect: CommandSideEffectClass): boolean {
  return sideEffect === 'none' || sideEffect === 'local-read';
}
