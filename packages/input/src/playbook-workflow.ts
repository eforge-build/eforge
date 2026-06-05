import { analyzeAcceptanceCriteria, formatAcDiagnostics } from './acceptance-criteria-quality.js';
import {
  copyPlaybookToScope,
  listPlaybooks,
  loadPlaybook,
  movePlaybook,
  playbookFrontmatterSchema,
  playbookToBuildSource,
  validatePlaybook,
  writePlaybook,
  PlaybookModeMismatchError,
  type CopyPlaybookToScopeOpts,
  type CopyPlaybookToScopeResult,
  type ListPlaybooksOpts,
  type LoadPlaybookOpts,
  type MovePlaybookOpts,
  type Playbook,
  type PlaybookBody,
  type PlaybookFrontmatter,
  type PlaybookScope,
  type SessionPlanInput,
  type WritePlaybookOpts,
} from './playbook.js';
import {
  createSessionPlanFile,
  createSessionPlanFromPlaybookSeed,
  resolveSessionPlanPath,
  type SessionPlan,
} from './session-plan.js';

export const PLAYBOOK_WORKFLOW_ADAPTER_DESCRIPTOR = {
  id: 'builtin:playbooks',
  kind: 'workflow-input-adapter',
  sourceScopes: ['project-local', 'project-team', 'user'],
} as const;

export interface PlaybookWorkflowSaveOptions {
  configDir: string;
  cwd: string;
  scope: PlaybookScope;
  frontmatter: unknown;
  body: unknown;
}

export interface PlaybookWorkflowPromoteDemoteOptions {
  configDir: string;
  cwd: string;
  name: string;
}

export interface PlaybookWorkflowSeedPlanningSessionPlanOptions {
  configDir: string;
  cwd: string;
  name: string;
  session?: string;
  topic?: string;
}

export interface PlaybookWorkflowSeedPlanningSessionPlanResult {
  plan: SessionPlan;
  session: string;
  path: string;
}

export type PlaybookWorkflowListResult = Awaited<ReturnType<typeof listPlaybooks>>;
export type PlaybookWorkflowLoadResult = Awaited<ReturnType<typeof loadPlaybook>>;
export type PlaybookWorkflowWriteResult = Awaited<ReturnType<typeof writePlaybook>>;
export type PlaybookWorkflowMoveResult = Awaited<ReturnType<typeof movePlaybook>>;
export type PlaybookWorkflowRawValidationResult = ReturnType<typeof validatePlaybook>;

export class PlaybookWorkflowValidationError extends Error {
  readonly code = 'playbook-workflow-validation' as const;
  readonly errors?: string[];

  constructor(message: string, errors?: string[]) {
    super(message);
    this.name = 'PlaybookWorkflowValidationError';
    this.errors = errors;
  }
}

export class PlaybookWorkflowSessionPlanExistsError extends Error {
  readonly code = 'playbook-workflow-session-plan-exists' as const;
  readonly session: string;
  readonly path: string;

  constructor(session: string, path: string) {
    super(`Session plan already exists: ${session}`);
    this.name = 'PlaybookWorkflowSessionPlanExistsError';
    this.session = session;
    this.path = path;
  }
}

export function isPlaybookWorkflowValidationError(err: unknown): err is PlaybookWorkflowValidationError {
  return err instanceof PlaybookWorkflowValidationError;
}

export function isPlaybookWorkflowSessionPlanExistsError(err: unknown): err is PlaybookWorkflowSessionPlanExistsError {
  return err instanceof PlaybookWorkflowSessionPlanExistsError;
}

export function isPlaybookWorkflowModeMismatchError(err: unknown): err is PlaybookModeMismatchError {
  return err instanceof PlaybookModeMismatchError;
}

export interface PlaybookWorkflowAdapter {
  descriptor: typeof PLAYBOOK_WORKFLOW_ADAPTER_DESCRIPTOR;
  scoped: {
    list(opts: ListPlaybooksOpts): Promise<PlaybookWorkflowListResult>;
    load(opts: LoadPlaybookOpts): Promise<PlaybookWorkflowLoadResult>;
    save(opts: PlaybookWorkflowSaveOptions): Promise<PlaybookWorkflowWriteResult>;
    write(opts: WritePlaybookOpts): Promise<PlaybookWorkflowWriteResult>;
    move(opts: MovePlaybookOpts): Promise<PlaybookWorkflowMoveResult>;
    promote(opts: PlaybookWorkflowPromoteDemoteOptions): Promise<PlaybookWorkflowMoveResult>;
    demote(opts: PlaybookWorkflowPromoteDemoteOptions): Promise<PlaybookWorkflowMoveResult>;
    copy(opts: CopyPlaybookToScopeOpts): Promise<CopyPlaybookToScopeResult>;
    validateRaw(raw: string): PlaybookWorkflowRawValidationResult;
    compileAutonomous(playbook: Playbook): SessionPlanInput;
    seedPlanningSessionPlan(opts: PlaybookWorkflowSeedPlanningSessionPlanOptions): Promise<PlaybookWorkflowSeedPlanningSessionPlanResult>;
  };
}

function formatIssues(issues: Array<{ path: PropertyKey[]; message: string }>): string[] {
  return issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return `${path}${issue.message}`;
  });
}

function validateBody(body: unknown): PlaybookBody {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new PlaybookWorkflowValidationError('Playbook validation failed', ['Missing required section: ## Goal']);
  }
  const record = body as Record<string, unknown>;
  if (typeof record.goal !== 'string' || record.goal.length === 0) {
    throw new PlaybookWorkflowValidationError('Playbook validation failed', ['Missing required section: ## Goal']);
  }
  for (const field of ['outOfScope', 'acceptanceCriteria', 'plannerNotes'] as const) {
    if (record[field] !== undefined && typeof record[field] !== 'string') {
      throw new PlaybookWorkflowValidationError(`Invalid field: ${field} must be a string`);
    }
  }
  return {
    goal: record.goal,
    outOfScope: typeof record.outOfScope === 'string' ? record.outOfScope : '',
    acceptanceCriteria: typeof record.acceptanceCriteria === 'string' ? record.acceptanceCriteria : '',
    plannerNotes: typeof record.plannerNotes === 'string' ? record.plannerNotes : '',
  };
}

function validateSavePlaybook(opts: PlaybookWorkflowSaveOptions): Playbook {
  const frontmatter = playbookFrontmatterSchema.safeParse(opts.frontmatter);
  if (!frontmatter.success) {
    throw new PlaybookWorkflowValidationError('Playbook validation failed', formatIssues(frontmatter.error.issues));
  }
  const body = validateBody(opts.body);
  const playbook: Playbook = { ...(frontmatter.data as PlaybookFrontmatter), ...body };
  if (playbook.acceptanceCriteria) {
    const ac = analyzeAcceptanceCriteria(playbook.acceptanceCriteria);
    if (!ac.valid) {
      throw new PlaybookWorkflowValidationError(`Playbook acceptance criteria quality gate failed:\n${formatAcDiagnostics(ac.diagnostics)}`);
    }
  }
  return playbook;
}

async function savePlaybookDraft(opts: PlaybookWorkflowSaveOptions): Promise<PlaybookWorkflowWriteResult> {
  return writePlaybook({ configDir: opts.configDir, cwd: opts.cwd, scope: opts.scope, playbook: validateSavePlaybook(opts) });
}

async function seedPlanningSessionPlan(opts: PlaybookWorkflowSeedPlanningSessionPlanOptions): Promise<PlaybookWorkflowSeedPlanningSessionPlanResult> {
  const { playbook } = await loadPlaybook({ configDir: opts.configDir, cwd: opts.cwd, name: opts.name });
  const plan = createSessionPlanFromPlaybookSeed({
    playbook,
    session: opts.session,
    topic: opts.topic,
  });
  const path = resolveSessionPlanPath({ cwd: opts.cwd, session: plan.session });
  try {
    await createSessionPlanFile({ cwd: opts.cwd, plan });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new PlaybookWorkflowSessionPlanExistsError(plan.session, path);
    }
    throw err;
  }
  return { plan, session: plan.session, path };
}

export function createPlaybookWorkflowAdapter(): PlaybookWorkflowAdapter {
  return {
    descriptor: PLAYBOOK_WORKFLOW_ADAPTER_DESCRIPTOR,
    scoped: {
      list: listPlaybooks,
      load: loadPlaybook,
      save: savePlaybookDraft,
      write: writePlaybook,
      move: movePlaybook,
      promote: (opts) => movePlaybook({ ...opts, fromScope: 'project-local', toScope: 'project-team' }),
      demote: (opts) => movePlaybook({ ...opts, fromScope: 'project-team', toScope: 'project-local' }),
      copy: copyPlaybookToScope,
      validateRaw: validatePlaybook,
      compileAutonomous: playbookToBuildSource,
      seedPlanningSessionPlan,
    },
  };
}
