/**
 * File categorization and review perspective heuristics for parallel review.
 * Ported from the review plugin's categorization patterns.
 */

export type ReviewPerspective = 'code' | 'security' | 'api' | 'docs' | 'test' | 'verify';

// --- eforge:region plan-01-dynamic-perspective-contracts ---
/** The built-in review perspective names as a tuple for runtime use. */
const BUILT_IN_PERSPECTIVES: readonly ReviewPerspective[] = [
  'code', 'security', 'api', 'docs', 'test', 'verify',
];

/**
 * Returns true when the given string is one of the six built-in review
 * perspective names. Use this to guard lookups into built-in-only maps
 * (e.g. PERSPECTIVE_PROMPTS, PERSPECTIVE_SCHEMA_YAML in parallel-reviewer).
 */
export function isBuiltInReviewPerspective(key: string): key is ReviewPerspective {
  return (BUILT_IN_PERSPECTIVES as readonly string[]).includes(key);
}
// --- eforge:endregion plan-01-dynamic-perspective-contracts ---

export interface FileCategories {
  code: string[];
  api: string[];
  docs: string[];
  config: string[];
  deps: string[];
  test: string[];
}

export interface DiffStats {
  lines: number;
}

/** Parallelization threshold: 10+ files OR 500+ changed lines */
export const FILE_COUNT_THRESHOLD = 10;
export const LINE_COUNT_THRESHOLD = 500;

// ---------------------------------------------------------------------------
// Security risk signals
// ---------------------------------------------------------------------------

/**
 * Path/name terms that indicate security-sensitive code.
 * Covers authentication, secrets, network boundaries, subprocess execution,
 * file-system access, and crypto/permission patterns.
 */
const SECURITY_SENSITIVE_TERMS: readonly string[] = [
  'auth', 'session', 'token', 'secret', 'credential', 'crypto',
  'encrypt', 'permission', 'sandbox', 'webhook', 'request',
  'http', 'client', 'server', 'shell', 'exec', 'spawn',
  'filesystem', 'fs', 'path-traversal', 'cors', 'csrf', 'jwt', 'oauth',
];

/**
 * Returns true when the file path contains a security-sensitive term at a
 * component/name boundary (as prefix, whole name, or hyphen/underscore-separated part).
 * Checked per path segment to avoid cross-segment false positives.
 */
export function isSecuritySensitivePath(file: string): boolean {
  const lower = file.toLowerCase();
  return lower.split('/').some(component => {
    if (component === '.env' || component.startsWith('.env.')) return true;
    // Remove file extension for name-only matching
    const name = component.replace(/\.[^.]+$/, '');
    return SECURITY_SENSITIVE_TERMS.some(term => {
      if (name === term) return true;
      if (name.startsWith(term + '-') || name.startsWith(term + '_')) return true;
      if (name.endsWith('-' + term) || name.endsWith('_' + term)) return true;
      if (
        name.includes('-' + term + '-') || name.includes('_' + term + '_') ||
        name.includes('-' + term + '_') || name.includes('_' + term + '-')
      ) return true;
      // Also match prefix (authentication → auth, filesystem → filesystem, executor → exec)
      if (name.startsWith(term)) return true;
      return false;
    });
  });
}

// ---------------------------------------------------------------------------
// Risk-based perspective ranking
// ---------------------------------------------------------------------------

/** Risk rank for auto-inferred built-in perspectives (lower = higher risk). */
const RISK_RANK: Record<ReviewPerspective, number> = {
  security: 0,
  verify: 1,
  api: 2,
  code: 3,
  test: 4,
  docs: 5,
};

function sortByRisk(perspectives: ReviewPerspective[]): ReviewPerspective[] {
  return [...perspectives].sort((a, b) => RISK_RANK[a] - RISK_RANK[b]);
}

// ---------------------------------------------------------------------------
// Initial perspective selection API
// ---------------------------------------------------------------------------

export interface InitialPerspectiveSelection {
  /** Perspectives selected after budget/ranking, in risk-descending order. */
  perspectives: ReviewPerspective[];
  /** Active file categories detected in the changeset. */
  categories: string[];
  /** Rule strings that fired during inference, including the budget rule. */
  rules: string[];
  /** Risk signals that elevated the budget or triggered security inference. */
  riskSignals: string[];
  /** Budget cap applied (2 for normal risk, 3 for security-critical or large). */
  budget: number;
  /** Human-readable summary of inferred perspectives and budget. */
  rationale: string;
}

/**
 * Select initial review perspectives for auto-inferred parallel review.
 *
 * Applies risk-signal detection, a default budget of 2 (raised to 3 for
 * security-critical or large changesets), and risk-based ranking to determine
 * which built-in perspectives to launch.
 *
 * Explicit planner-configured perspectives bypass this function entirely —
 * they are passed through without budget trimming.
 */
export function selectInitialReviewPerspectives({
  changedFiles,
  changedLines,
}: {
  changedFiles: string[];
  changedLines: number;
}): InitialPerspectiveSelection {
  const categories = categorizeFiles(changedFiles);
  const { perspectives: raw, rules, riskSignals } = buildCandidatePerspectives(categories);

  const hasSecuritySignal = riskSignals.length > 0;
  const isLargeChange = changedFiles.length >= FILE_COUNT_THRESHOLD || changedLines >= LINE_COUNT_THRESHOLD;

  // Budget: 2 by default; raised to 3 for security-critical or large changes
  const budget = (hasSecuritySignal || isLargeChange) ? 3 : 2;
  const budgetRule = hasSecuritySignal
    ? 'security-critical change — budget raised to 3'
    : isLargeChange
      ? 'large changeset — budget raised to 3'
      : 'normal-risk change — budget 2';

  const ranked = sortByRisk(raw);
  const perspectives = ranked.slice(0, budget);

  const activeCategories = Object.entries(categories)
    .filter(([, files]) => files.length > 0)
    .map(([cat]) => cat);

  const droppedByBudget = ranked.slice(budget);
  const rationaleFragments = ranked.length > 0
    ? [...rules, budgetRule]
    : ['No perspectives inferred', budgetRule];
  if (droppedByBudget.length > 0) {
    rationaleFragments.push(`Dropped by budget cap (${budget}): ${droppedByBudget.join(', ')}`);
  }

  return {
    perspectives,
    categories: activeCategories,
    rules: [...rules, budgetRule],
    riskSignals,
    budget,
    rationale: rationaleFragments.join('; '),
  };
}

/**
 * Compute all candidate perspectives for the given categories without applying
 * any budget cap. Used by `selectInitialReviewPerspectives` and the
 * compatibility wrappers below.
 */
function buildCandidatePerspectives(
  categories: FileCategories,
): { perspectives: ReviewPerspective[]; rules: string[]; riskSignals: string[] } {
  const perspectives = new Set<ReviewPerspective>();
  const rules: string[] = [];
  const riskSignals: string[] = [];

  if (categories.code.length > 0) {
    perspectives.add('code');
    rules.push('code-files → code');
  }

  if (categories.api.length > 0) {
    perspectives.add('api');
    rules.push('api-files → api');
  }

  if (categories.docs.length > 0) {
    perspectives.add('docs');
    rules.push('docs-files → docs');
  }

  if (categories.test.length > 0) {
    perspectives.add('test');
    perspectives.add('verify');
    rules.push('test-files → test+verify');
  }

  if (categories.deps.length > 0) {
    perspectives.add('security');
    perspectives.add('verify');
    rules.push('dep-files → security+verify');
    riskSignals.push('dependency-files: supply-chain security risk');
  }

  if (categories.config.length > 0) {
    perspectives.add('verify');
    rules.push('config-files → verify');
    // Security-sensitive config names also infer security
    const secConfigFiles = categories.config.filter(isSecuritySensitivePath);
    if (secConfigFiles.length > 0) {
      perspectives.add('security');
      rules.push(`security-sensitive-config → security (${secConfigFiles.join(', ')})`);
      riskSignals.push(`security-sensitive-config: ${secConfigFiles.join(', ')}`);
    }
  }

  // Apply security path signals to code, api, and test files
  const checkableFiles = [...categories.code, ...categories.api, ...categories.test];
  const secFiles = checkableFiles.filter(isSecuritySensitivePath);
  if (secFiles.length > 0) {
    perspectives.add('security');
    rules.push(`security-sensitive-paths → security (${secFiles.join(', ')})`);
    riskSignals.push(`security-sensitive-paths: ${secFiles.join(', ')}`);
  }

  return { perspectives: Array.from(perspectives), rules, riskSignals };
}

/**
 * Categorize a list of changed file paths into buckets.
 * A file can appear in at most one category (first match wins).
 */
export function categorizeFiles(files: string[]): FileCategories {
  const categories: FileCategories = {
    code: [],
    api: [],
    docs: [],
    config: [],
    deps: [],
    test: [],
  };

  for (const file of files) {
    if (isDeps(file)) {
      categories.deps.push(file);
    } else if (isDocs(file)) {
      categories.docs.push(file);
    } else if (isConfig(file)) {
      categories.config.push(file);
    } else if (isTest(file)) {
      categories.test.push(file);
    } else if (isApi(file)) {
      categories.api.push(file);
    } else if (isCode(file)) {
      categories.code.push(file);
    }
  }

  return categories;
}

/**
 * Given file categories, determine which review perspectives apply.
 *
 * Updated policy:
 * - Ordinary code files infer `code` only (not automatic `security`).
 * - Security-sensitive path/name matches infer `security`.
 * - Dep and lockfiles infer `security` and `verify`.
 * - Config/build files infer `verify`; security-sensitive config also infers `security`.
 * - Test files infer `test` and `verify`.
 * - Docs-only changes infer `docs` only.
 *
 * Results are sorted by risk (highest first) for deterministic ordering.
 */
export function determineApplicableReviews(categories: FileCategories): ReviewPerspective[] {
  const { perspectives } = buildCandidatePerspectives(categories);
  return sortByRisk(perspectives);
}

/**
 * Same as `determineApplicableReviews` but also returns rule attribution strings
 * for decision event metadata.
 */
export function determineApplicableReviewsWithRules(categories: FileCategories): {
  perspectives: ReviewPerspective[];
  rules: string[];
} {
  const { perspectives, rules } = buildCandidatePerspectives(categories);
  return { perspectives: sortByRisk(perspectives), rules };
}

/**
 * Decide whether to parallelize the review based on changeset size.
 * Threshold: 10+ files OR 500+ changed lines.
 */
export function shouldParallelizeReview(files: string[], stats: DiffStats): boolean {
  return files.length >= FILE_COUNT_THRESHOLD || stats.lines >= LINE_COUNT_THRESHOLD;
}

// --- Pattern matchers ---

function isDeps(file: string): boolean {
  const base = basename(file);
  return (
    base === 'package.json' ||
    base === 'package-lock.json' ||
    base === 'pnpm-lock.yaml' ||
    base === 'yarn.lock' ||
    base === 'Cargo.lock' ||
    base === 'Cargo.toml' ||
    base === 'go.sum' ||
    base === 'go.mod' ||
    base === 'requirements.txt' ||
    base === 'Pipfile.lock' ||
    base === 'Gemfile.lock'
  );
}

function isDocs(file: string): boolean {
  const base = basename(file);
  const lower = base.toLowerCase();
  return (
    lower === 'readme.md' ||
    lower === 'changelog.md' ||
    lower === 'contributing.md' ||
    lower === 'license.md' ||
    lower === 'license' ||
    file.startsWith('docs/') ||
    file.endsWith('.md')
  );
}

function isConfig(file: string): boolean {
  const base = basename(file);
  return (
    base.startsWith('.') ||
    base === 'tsconfig.json' ||
    base === 'vitest.config.ts' ||
    base === 'jest.config.ts' ||
    base === 'jest.config.js' ||
    base === 'eslint.config.js' ||
    base === '.eslintrc.json' ||
    base === 'prettier.config.js' ||
    base === '.prettierrc' ||
    base === 'Dockerfile' ||
    base === 'docker-compose.yml' ||
    base === 'docker-compose.yaml'
  );
}

function isApi(file: string): boolean {
  return (
    file.includes('/routes/') ||
    file.includes('/api/') ||
    file.includes('/handlers/') ||
    file.includes('/controllers/') ||
    file.includes('/endpoints/') ||
    file.endsWith('.routes.ts') ||
    file.endsWith('.routes.js') ||
    file.endsWith('.controller.ts') ||
    file.endsWith('.controller.js')
  );
}

function isTest(file: string): boolean {
  const base = basename(file);
  // Match *.test.{ts,tsx,js,jsx} and *.spec.{ts,tsx,js,jsx}
  if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(base)) return true;
  // Match files under test/, tests/, or __tests__/ directories
  if (/^(test|tests|__tests__)\//.test(file) || /\/(test|tests|__tests__)\//.test(file)) return true;
  return false;
}

function isCode(file: string): boolean {
  return (
    file.endsWith('.ts') ||
    file.endsWith('.tsx') ||
    file.endsWith('.js') ||
    file.endsWith('.jsx') ||
    file.endsWith('.rs') ||
    file.endsWith('.go') ||
    file.endsWith('.py') ||
    file.endsWith('.rb') ||
    file.endsWith('.java') ||
    file.endsWith('.kt') ||
    file.endsWith('.swift') ||
    file.endsWith('.c') ||
    file.endsWith('.cpp') ||
    file.endsWith('.h')
  );
}

function basename(filePath: string): string {
  const parts = filePath.split('/');
  return parts[parts.length - 1];
}
