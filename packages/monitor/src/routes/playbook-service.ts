import { API_ROUTES } from '@eforge-build/client';

async function getPlaybookAdapter() {
  const input = await import('@eforge-build/input');
  return {
    adapter: input.createPlaybookWorkflowAdapter(),
    isValidationError: input.isPlaybookWorkflowValidationError,
    isSeedCollisionError: input.isPlaybookWorkflowSessionPlanExistsError,
    isModeMismatchError: input.isPlaybookWorkflowModeMismatchError,
    analyzeAcceptanceCriteriaInBody: input.analyzeAcceptanceCriteriaInBody,
    formatAcDiagnostics: input.formatAcDiagnostics,
  };
}

export async function listPlaybooksWire(cwd: string) { const { getConfigDir } = await import('@eforge-build/engine/config'); const { adapter } = await getPlaybookAdapter(); const configDir = await getConfigDir(cwd); const result = await adapter.scoped.list({ configDir: configDir ?? cwd, cwd }); for (const w of result.warnings) process.stderr.write(`${w}\n`); return result; }
export async function showPlaybook(cwd: string, name: string) { const { getConfigDir } = await import('@eforge-build/engine/config'); const { adapter } = await getPlaybookAdapter(); const configDir = await getConfigDir(cwd); if (!configDir) throw Object.assign(new Error('No eforge config directory found'), { statusCode: 404 }); return adapter.scoped.load({ configDir, cwd, name }); }
export async function savePlaybook(cwd: string, body: any) { const { getConfigDir } = await import('@eforge-build/engine/config'); const { adapter, isValidationError } = await getPlaybookAdapter(); const configDir = await getConfigDir(cwd); try { const result = await adapter.scoped.save({ configDir: configDir ?? cwd, cwd, scope: body.scope, frontmatter: body.playbook.frontmatter, body: body.playbook.body }); return { path: result.path }; } catch (err) { if (isValidationError(err)) { const mapped: any = Object.assign(new Error(err.message), { statusCode: 400 }); if (err.errors) mapped.body = { error: err.message, errors: err.errors }; throw mapped; } throw err; } }
const REQUIRED_PLANNING_CAPABILITY = { name: 'eforge.plan.planning-mode-playbook', version: '>=1.0.0' } as const;
const PLANNING_ENTRY = {
  actionId: 'eforge-plan:open-planning-entry',
  integrationCommandId: 'eforge-plan:open-planning-entry',
  deepLinkId: 'eforge-plan:planning-workstation',
  workstationId: 'eforge-plan:planning-workstation',
  workstationUrl: '/console/workstations/eforge-plan%3Aplanning-workstation',
} as const;

type PlanningCapabilityResolution = {
  available: boolean;
  diagnostics: Array<Record<string, unknown>>;
  planningEntry?: typeof PLANNING_ENTRY;
};

type PlanningManifestEntry = {
  id: string;
  availability?: { available?: boolean; message?: string; diagnostics?: Array<Record<string, unknown>> };
};

function unavailablePlanningEntryDiagnostics(kind: string, entry: PlanningManifestEntry): Array<Record<string, unknown>> {
  if (entry.availability?.available !== false) return [];
  if (entry.availability.diagnostics?.length) return entry.availability.diagnostics;
  return [{
    code: 'extension:planning-entry-unavailable',
    message: entry.availability.message ?? `eforge-plan planning ${kind} contribution ${entry.id} is unavailable.`,
    contributionKind: kind,
    contributionId: entry.id,
  }];
}

async function resolvePlanningCapability(cwd: string, configDir: string): Promise<PlanningCapabilityResolution> {
  const { loadConfig } = await import('@eforge-build/engine/config');
  const { loadNativeExtensions, buildExtensionContributionManifest, versionSatisfies } = await import('@eforge-build/engine/extensions/index');
  const { config, warnings } = await loadConfig(cwd);
  for (const warning of warnings) process.stderr.write(`${warning}\n`);
  if (!config.extensions.enabled) {
    return { available: false, diagnostics: [{ code: 'extension:disabled', message: 'Native extensions are disabled; eforge-plan planning-mode playbook capability is unavailable.', capabilityName: REQUIRED_PLANNING_CAPABILITY.name, requiredVersion: REQUIRED_PLANNING_CAPABILITY.version }] };
  }
  const loadResult = await loadNativeExtensions({ cwd, configDir, config: config.extensions });
  const provider = loadResult.registry.extensions.find((extension: any) => extension.name === 'eforge-plan');
  const providerCapability = provider?.capabilities?.find((capability: { name: string; version?: string }) => capability.name === REQUIRED_PLANNING_CAPABILITY.name);
  if (providerCapability && versionSatisfies(providerCapability.version, REQUIRED_PLANNING_CAPABILITY.version)) {
    const manifest = buildExtensionContributionManifest(loadResult.registry);
    const action = manifest.actions.find((entry) => entry.id === PLANNING_ENTRY.actionId);
    const command = manifest.integrationCommands.find((entry) => entry.id === PLANNING_ENTRY.integrationCommandId && entry.action.actionId === PLANNING_ENTRY.actionId);
    const deepLink = manifest.deepLinks.find((entry) => entry.id === PLANNING_ENTRY.deepLinkId && entry.urlTemplate === PLANNING_ENTRY.workstationUrl && entry.action?.actionId === PLANNING_ENTRY.actionId);
    const workstation = manifest.consoleWorkstations.find((entry) => entry.id === PLANNING_ENTRY.workstationId);
    if (!action || !command || !deepLink || !workstation) {
      return { available: false, diagnostics: [{ code: 'extension:planning-entry-missing', message: 'eforge-plan is loaded, but its generic planning entry contribution, deep link, or workstation is unavailable.', capabilityName: REQUIRED_PLANNING_CAPABILITY.name, providerName: 'eforge-plan' }] };
    }
    const unavailableDiagnostics = [
      ...unavailablePlanningEntryDiagnostics('action', action),
      ...unavailablePlanningEntryDiagnostics('integration-command', command),
      ...unavailablePlanningEntryDiagnostics('deep-link', deepLink),
      ...unavailablePlanningEntryDiagnostics('workstation', workstation),
    ];
    if (unavailableDiagnostics.length === 0) return { available: true, diagnostics: [], planningEntry: PLANNING_ENTRY };
    return { available: false, diagnostics: unavailableDiagnostics, planningEntry: PLANNING_ENTRY };
  }

  if (provider) {
    const actualVersion = providerCapability?.version;
    return {
      available: false,
      diagnostics: [{
        code: 'extension:dependency-capability-incompatible',
        message: providerCapability
          ? `eforge-plan capability ${REQUIRED_PLANNING_CAPABILITY.name} does not satisfy ${REQUIRED_PLANNING_CAPABILITY.version}.`
          : `eforge-plan is loaded, but does not declare required capability ${REQUIRED_PLANNING_CAPABILITY.name} (${REQUIRED_PLANNING_CAPABILITY.version}).`,
        capabilityName: REQUIRED_PLANNING_CAPABILITY.name,
        requiredVersion: REQUIRED_PLANNING_CAPABILITY.version,
        providerName: 'eforge-plan',
        ...(actualVersion !== undefined && { actualVersion }),
      }],
    };
  }

  const candidate = loadResult.candidates.find((entry: any) => entry.name === 'eforge-plan');
  const diagnostics: Array<Record<string, unknown>> = candidate?.diagnostics?.length
    ? candidate.diagnostics.map((entry: any) => ({ code: entry.code, message: entry.message, severity: entry.severity, capabilityName: entry.capabilityName, dependencyName: entry.dependencyName, providerName: entry.providerName, requiredVersion: entry.requiredVersion, actualVersion: entry.actualVersion }))
    : [{
      code: candidate ? `extension:${candidate.status}` : 'extension:dependency-missing',
      message: candidate
        ? `eforge-plan is ${candidate.status}; capability ${REQUIRED_PLANNING_CAPABILITY.name} is unavailable.`
        : `eforge-plan is not loaded; capability ${REQUIRED_PLANNING_CAPABILITY.name} is unavailable.`,
      capabilityName: REQUIRED_PLANNING_CAPABILITY.name,
      requiredVersion: REQUIRED_PLANNING_CAPABILITY.version,
      providerName: candidate?.name,
    }] as Array<Record<string, unknown>>;
  return { available: false, diagnostics };
}

function planningRequiresAgentResponse(name: string, planningEntry: typeof PLANNING_ENTRY) {
  return {
    kind: 'requires-agent',
    mode: 'planning',
    name,
    requiredCapability: REQUIRED_PLANNING_CAPABILITY,
    planningEntry,
    message: `Playbook "${name}" is planning-mode. Continue through the generic eforge-plan planning entry contribution or open ${planningEntry.workstationUrl}.`,
  };
}

function planningUnavailableResponse(name: string, resolution: Awaited<ReturnType<typeof resolvePlanningCapability>>) {
  return {
    kind: 'planning-unavailable',
    mode: 'planning',
    name,
    requiredCapability: REQUIRED_PLANNING_CAPABILITY,
    diagnostics: resolution.diagnostics,
    ...(resolution.planningEntry !== undefined && { planningEntry: resolution.planningEntry }),
    message: `Playbook "${name}" is planning-mode, but required capability ${REQUIRED_PLANNING_CAPABILITY.name} (${REQUIRED_PLANNING_CAPABILITY.version}) is unavailable. Load, trust, and reload eforge-plan, then use the generic planning entry contribution or workstation deep link.`,
  };
}

export async function runPlaybook(cwd: string, options: { queueDir?: string }, notify: () => void, body: any) { const { getConfigDir, getConventionalConfigDir, loadConfig, loadProfile } = await import('@eforge-build/engine/config'); const input = await getPlaybookAdapter(); const configDir = await getConfigDir(cwd); if (!configDir) throw Object.assign(new Error('No eforge config directory found'), { statusCode: 404 }); const { playbook } = await input.adapter.scoped.load({ configDir, cwd, name: body.name }); if (playbook.mode === 'planning') { const resolution = await resolvePlanningCapability(cwd, configDir); return resolution.available && resolution.planningEntry ? planningRequiresAgentResponse(body.name, resolution.planningEntry) : planningUnavailableResponse(body.name, resolution); } if (body.landingAutoMerge === true) { const { config } = await loadConfig(cwd); const effective = body.landingAction ?? (config as any).landing?.action ?? 'merge'; if (effective !== 'pr') throw Object.assign(new Error(`Invalid field: landingAutoMerge can only be true when the effective landing action is 'pr' (got '${effective}')`), { statusCode: 400 }); if ((config as any).landing?.pr?.autoMerge === 'never') throw Object.assign(new Error("landingAutoMerge: true is not allowed when landing.pr.autoMerge is 'never' in project config"), { statusCode: 400 }); } const plan = input.adapter.scoped.compileAutonomous(playbook); const ac = input.analyzeAcceptanceCriteriaInBody(plan.source); if (ac && !ac.valid) throw Object.assign(new Error(`Playbook acceptance criteria quality gate failed:\n${input.formatAcDiagnostics(ac.diagnostics)}`), { statusCode: 400 }); const { deriveAcceptanceCriteriaInventoryFromPrdBody } = await import('@eforge-build/engine/validation/acceptance-criteria-inventory'); let acceptanceCriteriaInventory; try { acceptanceCriteriaInventory = deriveAcceptanceCriteriaInventoryFromPrdBody(plan.source); } catch (e) { throw Object.assign(new Error(e instanceof Error ? e.message : String(e)), { statusCode: 400 }); } if (playbook.profile) { const cfgDir = await getConfigDir(cwd) ?? getConventionalConfigDir(cwd); if (!await loadProfile(cfgDir, playbook.profile, cwd)) throw Object.assign(new Error(`Playbook profile '${playbook.profile}' not found`), { statusCode: 400 }); }
  const { enqueuePrd, inferTitle, classifyAfterQueueId } = await import('@eforge-build/engine/prd-queue'); const queueDir = options.queueDir ?? '.eforge/queue'; let depends_on: string[] | undefined; let intoWaiting = false; if (body.afterQueueId) { try { const p = await classifyAfterQueueId(body.afterQueueId, queueDir, cwd); depends_on = p.dependsOn; intoWaiting = p.intoWaiting; } catch (e) { throw Object.assign(new Error(e instanceof Error ? e.message : `Invalid afterQueueId: ${body.afterQueueId}`), { statusCode: 404 }); } } const result = await enqueuePrd({ body: plan.source, title: inferTitle(plan.source, plan.name), queueDir, cwd, depends_on, intoWaiting, postMerge: plan.postMerge, profile: plan.profile, acceptanceCriteriaInventory, ...(body.landingAction !== undefined && { landingAction: body.landingAction }), ...(body.landingAutoMerge !== undefined && { landingAutoMerge: body.landingAutoMerge }) }); notify(); return { kind: 'enqueued', id: result.id }; }
export async function movePlaybookWire(cwd: string, name: string, promote: boolean) { const { getConfigDir } = await import('@eforge-build/engine/config'); const { adapter } = await getPlaybookAdapter(); const configDir = await getConfigDir(cwd); if (!configDir) throw Object.assign(new Error('No eforge config directory found'), { statusCode: 404 }); const result = promote ? await adapter.scoped.promote({ configDir, cwd, name }) : await adapter.scoped.demote({ configDir, cwd, name }); return { path: result.path }; }
export async function validatePlaybookRaw(raw: string) { const { adapter } = await getPlaybookAdapter(); const result = adapter.scoped.validateRaw(raw); return result.ok ? { ok: true } : { ok: false, errors: result.errors }; }
export async function copyPlaybookWire(cwd: string, body: any) { const { getConfigDir } = await import('@eforge-build/engine/config'); const { adapter } = await getPlaybookAdapter(); const configDir = await getConfigDir(cwd); if (!configDir) throw Object.assign(new Error('No eforge config directory found'), { statusCode: 404 }); const r = await adapter.scoped.copy({ configDir, cwd, name: body.name, targetScope: body.targetScope }); return { sourcePath: r.sourcePath, targetPath: r.targetPath, targetScope: r.targetScope }; }
export async function createFromPlaybook(cwd: string, body: any) { const { getConfigDir } = await import('@eforge-build/engine/config'); const { adapter, isSeedCollisionError, isModeMismatchError } = await getPlaybookAdapter(); const configDir = await getConfigDir(cwd); if (!configDir) throw Object.assign(new Error('No eforge config directory found'), { statusCode: 404 }); try { const result = await adapter.scoped.seedPlanningSessionPlan({ configDir, cwd, name: body.playbook_name, session: typeof body.session === 'string' ? body.session : undefined, topic: typeof body.topic === 'string' ? body.topic : undefined }); return { session: result.session, path: result.path }; } catch (err) { if (isModeMismatchError(err)) throw Object.assign(new Error(`Playbook "${body.playbook_name}" is autonomous — use POST ${API_ROUTES.playbookRun} to enqueue it`), { statusCode: 400 }); if (isSeedCollisionError(err)) throw Object.assign(new Error(err.message), { statusCode: 409 }); throw err; } }
