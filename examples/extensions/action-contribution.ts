/**
 * Example: Action-backed Console and host contributions.
 *
 * This extension registers one typed action and exposes it through a declarative
 * Console contribution, a host integration command, and an action-backed deep
 * link. eforge resolves the local action ID used below to an effective
 * namespaced manifest ID at runtime. The example intentionally avoids raw HTTP
 * routes, browser code, network calls, and filesystem writes.
 */

import {
  Type,
  defineConsoleContribution,
  defineEforgeExtension,
  defineExtensionAction,
  defineExtensionDeepLink,
  defineIntegrationCommand,
} from '@eforge-build/extension-sdk';

const echoStatusAction = defineExtensionAction({
  id: 'echo-status',
  title: 'Echo status',
  description: 'Return a JSON-safe status object derived from caller input.',
  inputSchema: Type.Object({
    message: Type.String({ description: 'Short status message to echo back.' }),
    dryRun: Type.Optional(Type.Boolean({ description: 'Whether the caller is previewing the action.' })),
  }),
  outputSchema: Type.Object({
    ok: Type.Boolean(),
    message: Type.String(),
    dryRun: Type.Boolean(),
  }),
  sideEffects: ['none'],
  handler: ({ message, dryRun = true }) => ({
    ok: true,
    message,
    dryRun,
  }),
});

const systemPanel = defineConsoleContribution({
  id: 'echo-status-panel',
  title: 'Echo status panel',
  description: 'A deterministic action-backed panel for /console/system.',
  blocks: [
    {
      rendererId: 'markdown',
      title: 'Action-backed contribution',
      content: 'Use the controls below to invoke the local `echo-status` action through eforge.',
    },
    {
      rendererId: 'status-badge',
      title: 'Runtime',
      content: 'Ready',
      status: 'ok',
    },
    {
      rendererId: 'action-button',
      title: 'Echo default status',
      content: 'Send a safe default payload.',
      action: {
        actionId: 'echo-status',
        inputDefaults: { message: 'Console button invoked echo-status', dryRun: true },
      },
    },
    {
      rendererId: 'action-form',
      title: 'Echo custom status',
      content: 'Hosts render this form from the action input schema; the extension ships no browser bundle.',
      action: {
        actionId: 'echo-status',
        inputDefaults: { message: 'Console form invoked echo-status', dryRun: true },
      },
    },
  ],
});

const echoStatusCommand = defineIntegrationCommand({
  id: 'echo-status-command',
  label: 'Echo status',
  description: 'Host-discoverable command bound to the echo-status action.',
  inputSchema: Type.Object({
    message: Type.String({ description: 'Status message supplied by the host.' }),
    dryRun: Type.Optional(Type.Boolean()),
  }),
  action: {
    actionId: 'echo-status',
    inputDefaults: { message: 'Integration command invoked echo-status', dryRun: true },
  },
});

const echoStatusDeepLink = defineExtensionDeepLink({
  id: 'echo-status-deep-link',
  label: 'Echo status deep link',
  description: 'Action-backed deep link; generic hosts can invoke the bound action.',
  action: {
    actionId: 'echo-status',
    inputDefaults: { message: 'Deep link invoked echo-status', dryRun: true },
  },
});

export default defineEforgeExtension((eforge) => {
  eforge.registerAction(echoStatusAction);
  eforge.registerConsoleContribution(systemPanel);
  eforge.registerIntegrationCommand(echoStatusCommand);
  eforge.registerDeepLink(echoStatusDeepLink);
});
