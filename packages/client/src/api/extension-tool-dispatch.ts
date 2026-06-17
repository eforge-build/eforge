import type {
  ExtensionDemoteRequest,
  ExtensionDemoteResponse,
  ExtensionInstallRequest,
  ExtensionInstallResponse,
  ExtensionListResponse,
  ExtensionNewRequest,
  ExtensionNewResponse,
  ExtensionPromoteRequest,
  ExtensionPromoteResponse,
  ExtensionReloadResponse,
  ExtensionRemoveRequest,
  ExtensionRemoveResponse,
  ExtensionScaffoldScope,
  ExtensionScaffoldTemplate,
  ExtensionShowResponse,
  ExtensionTestRequest,
  ExtensionTestResponse,
  ExtensionTrustRequest,
  ExtensionTrustResponse,
  ExtensionUntrustRequest,
  ExtensionUntrustResponse,
  ExtensionUpdateRequest,
  ExtensionUpdateResponse,
  ExtensionValidateResponse,
} from '../types.js';

export const EFORGE_EXTENSION_ACTIONS = ['list', 'show', 'validate', 'test', 'new', 'reload', 'trust', 'untrust', 'install', 'update', 'remove', 'promote', 'demote'] as const;

export type EforgeExtensionAction = (typeof EFORGE_EXTENSION_ACTIONS)[number];

export interface EforgeExtensionActionParams {
  action: EforgeExtensionAction;
  name?: string;
  path?: string;
  fixture?: string;
  run?: string;
  event?: string;
  scope?: ExtensionScaffoldScope;
  template?: ExtensionScaffoldTemplate;
  force?: boolean;
  trustedBy?: string;
  source?: string;
  trust?: boolean;
  version?: string;
}

type HelperResult<T> = Promise<{ data: T; port: number } | null> | { data: T; port: number } | null;

export interface EforgeExtensionActionHelpers {
  list(opts: { cwd: string }): HelperResult<ExtensionListResponse>;
  show(opts: { cwd: string; name: string }): HelperResult<ExtensionShowResponse>;
  validate(opts: { cwd: string; name?: string; path?: string }): HelperResult<ExtensionValidateResponse>;
  test(opts: { cwd: string; body: ExtensionTestRequest }): HelperResult<ExtensionTestResponse>;
  'new'(opts: { cwd: string; body: ExtensionNewRequest }): HelperResult<ExtensionNewResponse>;
  reload(opts: { cwd: string }): HelperResult<ExtensionReloadResponse>;
  trust(opts: { cwd: string; body: ExtensionTrustRequest }): HelperResult<ExtensionTrustResponse>;
  untrust(opts: { cwd: string; body: ExtensionUntrustRequest }): HelperResult<ExtensionUntrustResponse>;
  install(opts: { cwd: string; body: ExtensionInstallRequest }): HelperResult<ExtensionInstallResponse>;
  update(opts: { cwd: string; body: ExtensionUpdateRequest }): HelperResult<ExtensionUpdateResponse>;
  remove(opts: { cwd: string; body: ExtensionRemoveRequest }): HelperResult<ExtensionRemoveResponse>;
  promote(opts: { cwd: string; body: ExtensionPromoteRequest }): HelperResult<ExtensionPromoteResponse>;
  demote(opts: { cwd: string; body: ExtensionDemoteRequest }): HelperResult<ExtensionDemoteResponse>;
}

type DispatchResult = Awaited<ReturnType<EforgeExtensionActionHelpers[EforgeExtensionAction]>>;
type DispatchContext = { cwd: string; params: EforgeExtensionActionParams; helpers: EforgeExtensionActionHelpers };
type ActionSpec = (ctx: DispatchContext) => Promise<DispatchResult>;

function hasTestOnlyParams(params: EforgeExtensionActionParams): boolean {
  return params.fixture !== undefined || params.run !== undefined || params.event !== undefined;
}

function hasPackageOnlyParams(params: EforgeExtensionActionParams): boolean {
  return params.source !== undefined || params.trust !== undefined;
}

const testOnlyParamErrorByAction = {
  list: () => { throw new Error('"list" does not accept fixture, run, or event'); },
  show: () => { throw new Error('"show" does not accept fixture, run, or event'); },
  validate: () => { throw new Error('"validate" does not accept fixture, run, or event'); },
  new: () => { throw new Error('"new" does not accept fixture, run, or event'); },
  reload: () => { throw new Error('"reload" does not accept fixture, run, or event'); },
  trust: () => { throw new Error('"trust" does not accept fixture, run, or event'); },
  untrust: () => { throw new Error('"untrust" does not accept fixture, run, or event'); },
  install: () => { throw new Error('"install" does not accept fixture, run, or event'); },
  update: () => { throw new Error('"update" does not accept fixture, run, or event'); },
  remove: () => { throw new Error('"remove" does not accept fixture, run, or event'); },
  promote: () => { throw new Error('"promote" does not accept fixture, run, or event'); },
  demote: () => { throw new Error('"demote" does not accept fixture, run, or event'); },
} satisfies Partial<Record<EforgeExtensionAction, () => never>>;

const requireNameErrorByAction = {
  show: () => { throw new Error('"name" is required when action is "show"'); },
  new: () => { throw new Error('"name" is required when action is "new"'); },
} satisfies Partial<Record<EforgeExtensionAction, () => never>>;

const requireNameOrPathErrorByAction = {
  trust: () => { throw new Error('"name" or "path" is required when action is "trust"'); },
  untrust: () => { throw new Error('"name" or "path" is required when action is "untrust"'); },
  update: () => { throw new Error('"name" or "path" is required when action is "update"'); },
  remove: () => { throw new Error('"name" or "path" is required when action is "remove"'); },
  promote: () => { throw new Error('"name" or "path" is required when action is "promote"'); },
  demote: () => { throw new Error('"name" or "path" is required when action is "demote"'); },
} satisfies Partial<Record<EforgeExtensionAction, () => never>>;

const namePathExclusiveErrorByAction = {
  validate: () => { throw new Error('Specify only one of "name" or "path" for validate'); },
  test: () => { throw new Error('Specify only one of "name" or "path" for test'); },
  trust: () => { throw new Error('Specify only one of "name" or "path" for trust'); },
  untrust: () => { throw new Error('Specify only one of "name" or "path" for untrust'); },
  update: () => { throw new Error('Specify only one of "name" or "path" for update'); },
  remove: () => { throw new Error('Specify only one of "name" or "path" for remove'); },
  promote: () => { throw new Error('Specify only one of "name" or "path" for promote'); },
  demote: () => { throw new Error('Specify only one of "name" or "path" for demote'); },
} satisfies Partial<Record<EforgeExtensionAction, () => never>>;

function validateNoTestOnlyParams(action: keyof typeof testOnlyParamErrorByAction, params: EforgeExtensionActionParams): void {
  if (hasTestOnlyParams(params)) testOnlyParamErrorByAction[action]();
}

function requireName(action: keyof typeof requireNameErrorByAction, params: EforgeExtensionActionParams): string {
  const { name } = params;
  if (!name) {
    requireNameErrorByAction[action]();
    throw new Error('unreachable');
  }
  return name;
}

function requireNameOrPath(action: keyof typeof requireNameOrPathErrorByAction, params: EforgeExtensionActionParams): void {
  if (!params.name && !params.path) requireNameOrPathErrorByAction[action]();
}

function validateNamePathExclusive(action: keyof typeof namePathExclusiveErrorByAction, params: EforgeExtensionActionParams): void {
  if (params.name !== undefined && params.path !== undefined) namePathExclusiveErrorByAction[action]();
}

function validateLookupAction(action: 'trust' | 'untrust' | 'update' | 'remove' | 'promote' | 'demote', params: EforgeExtensionActionParams): void {
  requireNameOrPath(action, params);
  validateNamePathExclusive(action, params);
}

function addNamePath<T extends { name?: string; path?: string }>(body: T, params: EforgeExtensionActionParams): T {
  if (params.name !== undefined) body.name = params.name;
  if (params.path !== undefined) body.path = params.path;
  return body;
}

function validateList(params: EforgeExtensionActionParams): void {
  if (params.name !== undefined || params.path !== undefined || params.scope !== undefined || params.template !== undefined || params.force !== undefined) throw new Error('"list" does not accept name, path, scope, template, or force');
  validateNoTestOnlyParams('list', params);
  if (params.trustedBy !== undefined) throw new Error('"list" does not accept trustedBy');
  if (hasPackageOnlyParams(params)) throw new Error('"list" does not accept source or trust');
}

function validateShow(params: EforgeExtensionActionParams): string {
  const name = requireName('show', params);
  if (params.path !== undefined || params.scope !== undefined || params.template !== undefined || params.force !== undefined) throw new Error('"show" does not accept path, scope, template, or force');
  validateNoTestOnlyParams('show', params);
  if (params.trustedBy !== undefined) throw new Error('"show" does not accept trustedBy');
  if (hasPackageOnlyParams(params)) throw new Error('"show" does not accept source or trust');
  return name;
}

function validateValidate(params: EforgeExtensionActionParams): void {
  if (params.scope !== undefined || params.template !== undefined || params.force !== undefined) throw new Error('"validate" does not accept scope, template, or force');
  validateNoTestOnlyParams('validate', params);
  if (params.trustedBy !== undefined) throw new Error('"validate" does not accept trustedBy');
  if (hasPackageOnlyParams(params)) throw new Error('"validate" does not accept source or trust');
  validateNamePathExclusive('validate', params);
}

function validateTest(params: EforgeExtensionActionParams): void {
  if (params.scope !== undefined || params.template !== undefined || params.force !== undefined) throw new Error('"test" does not accept scope, template, or force');
  if (params.trustedBy !== undefined) throw new Error('"test" does not accept trustedBy');
  if (hasPackageOnlyParams(params)) throw new Error('"test" does not accept source or trust');
  validateNamePathExclusive('test', params);
}

function buildTestBody(params: EforgeExtensionActionParams): ExtensionTestRequest {
  validateTest(params);
  const body = addNamePath<ExtensionTestRequest>({}, params);
  if (params.fixture !== undefined) body.fixture = params.fixture;
  if (params.run !== undefined) body.run = params.run;
  if (params.event !== undefined) body.event = params.event;
  return body;
}

function buildNewBody(params: EforgeExtensionActionParams): ExtensionNewRequest {
  const body: ExtensionNewRequest = { name: requireName('new', params) };
  if (params.path !== undefined) throw new Error('"path" is not supported when action is "new"');
  validateNoTestOnlyParams('new', params);
  if (params.trustedBy !== undefined) throw new Error('"new" does not accept trustedBy');
  if (hasPackageOnlyParams(params)) throw new Error('"new" does not accept source or trust');
  if (params.scope !== undefined) body.scope = params.scope;
  if (params.template !== undefined) body.template = params.template;
  if (params.force !== undefined) body.force = params.force;
  return body;
}

function buildTrustBody(params: EforgeExtensionActionParams): ExtensionTrustRequest {
  validateLookupAction('trust', params);
  if (params.scope !== undefined || params.template !== undefined || params.force !== undefined) throw new Error('"trust" does not accept scope, template, or force');
  validateNoTestOnlyParams('trust', params);
  if (hasPackageOnlyParams(params)) throw new Error('"trust" does not accept source or trust');
  const body = addNamePath<ExtensionTrustRequest>({}, params);
  if (params.trustedBy !== undefined) body.trustedBy = params.trustedBy;
  return body;
}

function buildUntrustBody(params: EforgeExtensionActionParams): ExtensionUntrustRequest {
  validateLookupAction('untrust', params);
  if (params.scope !== undefined || params.template !== undefined || params.force !== undefined) throw new Error('"untrust" does not accept scope, template, or force');
  validateNoTestOnlyParams('untrust', params);
  if (params.trustedBy !== undefined) throw new Error('"untrust" does not accept trustedBy');
  if (hasPackageOnlyParams(params)) throw new Error('"untrust" does not accept source or trust');
  return addNamePath<ExtensionUntrustRequest>({}, params);
}

function buildInstallBody(params: EforgeExtensionActionParams): ExtensionInstallRequest {
  if (params.source === undefined) throw new Error('"source" is required when action is "install"');
  if (params.path !== undefined) throw new Error('"install" does not accept path');
  validateNoTestOnlyParams('install', params);
  if (params.template !== undefined) throw new Error('"install" does not accept template');
  const body: ExtensionInstallRequest = { source: params.source };
  if (params.scope !== undefined) body.scope = params.scope;
  if (params.name !== undefined) body.name = params.name;
  if (params.force !== undefined) body.force = params.force;
  if (params.trust !== undefined) body.trust = params.trust;
  if (params.trustedBy !== undefined) body.trustedBy = params.trustedBy;
  return body;
}

function buildUpdateBody(params: EforgeExtensionActionParams): ExtensionUpdateRequest {
  validateLookupAction('update', params);
  if (params.scope !== undefined || params.template !== undefined || params.source !== undefined) throw new Error('"update" does not accept scope, template, or source');
  if (params.force !== undefined) throw new Error('"update" does not accept force');
  validateNoTestOnlyParams('update', params);
  const body = addNamePath<ExtensionUpdateRequest>({}, params);
  if (params.trust !== undefined) body.trust = params.trust;
  if (params.trustedBy !== undefined) body.trustedBy = params.trustedBy;
  if (params.version !== undefined) body.version = params.version;
  return body;
}

function buildRemoveBody(params: EforgeExtensionActionParams): ExtensionRemoveRequest {
  validateLookupAction('remove', params);
  if (params.scope !== undefined || params.template !== undefined || params.source !== undefined || params.trust !== undefined || params.trustedBy !== undefined) throw new Error('"remove" does not accept scope, template, source, trust, or trustedBy');
  validateNoTestOnlyParams('remove', params);
  const body = addNamePath<ExtensionRemoveRequest>({}, params);
  if (params.force !== undefined) body.force = params.force;
  return body;
}

function buildPromoteBody(params: EforgeExtensionActionParams): ExtensionPromoteRequest {
  validateLookupAction('promote', params);
  if (params.scope !== undefined || params.template !== undefined || params.source !== undefined) throw new Error('"promote" does not accept scope, template, or source');
  validateNoTestOnlyParams('promote', params);
  const body = addNamePath<ExtensionPromoteRequest>({}, params);
  if (params.force !== undefined) body.force = params.force;
  if (params.trust !== undefined) body.trust = params.trust;
  if (params.trustedBy !== undefined) body.trustedBy = params.trustedBy;
  return body;
}

function buildDemoteBody(params: EforgeExtensionActionParams): ExtensionDemoteRequest {
  validateLookupAction('demote', params);
  if (params.scope !== undefined || params.template !== undefined || params.source !== undefined || params.trust !== undefined || params.trustedBy !== undefined) throw new Error('"demote" does not accept scope, template, source, trust, or trustedBy');
  validateNoTestOnlyParams('demote', params);
  const body = addNamePath<ExtensionDemoteRequest>({}, params);
  if (params.force !== undefined) body.force = params.force;
  return body;
}

function validateReload(params: EforgeExtensionActionParams): void {
  if (params.name !== undefined || params.path !== undefined || params.scope !== undefined || params.template !== undefined || params.force !== undefined) throw new Error('"reload" does not accept name, path, scope, template, or force');
  if (params.source !== undefined) throw new Error('"reload" does not accept source');
  if (params.trust !== undefined) throw new Error('"reload" does not accept trust');
  validateNoTestOnlyParams('reload', params);
  if (params.trustedBy !== undefined) throw new Error('"reload" does not accept trustedBy');
}

const ACTION_SPECS: Record<EforgeExtensionAction, ActionSpec> = {
  list: async ({ cwd, params, helpers }) => { validateList(params); return helpers.list({ cwd }); },
  show: async ({ cwd, params, helpers }) => helpers.show({ cwd, name: validateShow(params) }),
  validate: async ({ cwd, params, helpers }) => {
    validateValidate(params);
    const request: { cwd: string; name?: string; path?: string } = { cwd };
    return helpers.validate(addNamePath(request, params));
  },
  test: async ({ cwd, params, helpers }) => helpers.test({ cwd, body: buildTestBody(params) }),
  new: async ({ cwd, params, helpers }) => helpers['new']({ cwd, body: buildNewBody(params) }),
  reload: async ({ cwd, params, helpers }) => { validateReload(params); return helpers.reload({ cwd }); },
  trust: async ({ cwd, params, helpers }) => helpers.trust({ cwd, body: buildTrustBody(params) }),
  untrust: async ({ cwd, params, helpers }) => helpers.untrust({ cwd, body: buildUntrustBody(params) }),
  install: async ({ cwd, params, helpers }) => helpers.install({ cwd, body: buildInstallBody(params) }),
  update: async ({ cwd, params, helpers }) => helpers.update({ cwd, body: buildUpdateBody(params) }),
  remove: async ({ cwd, params, helpers }) => helpers.remove({ cwd, body: buildRemoveBody(params) }),
  promote: async ({ cwd, params, helpers }) => helpers.promote({ cwd, body: buildPromoteBody(params) }),
  demote: async ({ cwd, params, helpers }) => helpers.demote({ cwd, body: buildDemoteBody(params) }),
};

export function dispatchEforgeExtensionAction(ctx: DispatchContext): Promise<DispatchResult> {
  if (ctx.params.action !== 'update' && ctx.params.version !== undefined) return Promise.reject(new Error(`"${ctx.params.action}" does not accept version`));
  return ACTION_SPECS[ctx.params.action](ctx);
}
