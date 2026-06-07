import type { MonitorContext } from '../../context.js';
import type { RouteDefinition } from '../../http/router.js';
import { createExtensionReadRoutes } from './read.js';
import { createExtensionManagementRoutes } from './management.js';
import { createExtensionReplayRoutes } from './replay.js';
import { createExtensionTrustRoutes } from './trust.js';
import { createExtensionPackageRoutes } from './packages.js';
import { createExtensionContributionRoutes } from './contributions.js';
import { createExtensionWorkstationRoutes } from './workstations.js';
// --- eforge:region extension-agent-task-context ---
import { createExtensionAgentTaskRoutes } from './agent-tasks.js';
import { ExtensionAgentTaskService } from './agent-task-service.js';
// --- eforge:endregion extension-agent-task-context ---

export function createExtensionRoutes(context: MonitorContext): RouteDefinition[] {
  // --- eforge:region extension-agent-task-context ---
  const agentTaskService = new ExtensionAgentTaskService(context);
  // --- eforge:endregion extension-agent-task-context ---
  return [
    ...createExtensionReadRoutes(context),
    ...createExtensionContributionRoutes(context, agentTaskService),
    // --- eforge:region extension-agent-task-context ---
    ...createExtensionAgentTaskRoutes(agentTaskService),
    // --- eforge:endregion extension-agent-task-context ---
    ...createExtensionWorkstationRoutes(context),
    ...createExtensionManagementRoutes(context),
    ...createExtensionReplayRoutes(context),
    ...createExtensionTrustRoutes(context),
    ...createExtensionPackageRoutes(context),
  ];
}
