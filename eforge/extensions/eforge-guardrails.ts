import type {
  AgentRunContext,
  EforgeExtensionAPI,
  ValidationProviderResult,
} from '../../packages/extension-sdk/src/index';

const BUILD_ROLES = new Set([
  'builder',
  'reviewer',
  'review-fixer',
  'evaluator',
  'validation-fixer',
  'doc-author',
  'doc-syncer',
  'test-writer',
  'tester',
]);

const BUILD_STAGES = new Set([
  'implement',
  'review',
  'review-fix',
  'evaluate',
  'test',
  'test-write',
  'doc-author',
  'doc-sync',
]);

const ARCHITECTURE_REVIEW_PATHS = [
  'packages/engine/**',
  'packages/client/**',
  'packages/monitor/**',
  'packages/console-ui/**',
  'packages/pi-eforge/**',
  'packages/extension-sdk/**',
  'eforge-plugin/**',
  'docs/extensions*.md',
  'docs/config.md',
  'docs/hooks.md',
  'docs/roadmap.md',
  'examples/extensions/**',
];

function shouldAugmentAgentRun(ctx: AgentRunContext): boolean {
  if (ctx.phase !== 'build') {
    return false;
  }

  if (!BUILD_ROLES.has(ctx.role)) {
    return false;
  }

  return ctx.stage === undefined || BUILD_STAGES.has(ctx.stage);
}

function pathSpecificReminders(changedFiles: readonly string[] | undefined): string[] {
  if (!changedFiles || changedFiles.length === 0) {
    return [];
  }

  const reminders: string[] = [];

  if (changedFiles.some((file) => file.startsWith('packages/client/'))) {
    reminders.push('- Client/API changes: route constants, daemon wire shapes, SSE helpers, and response types belong in `@eforge-build/client`; avoid inline `/api/...` literals and local wire-shape redeclarations.');
  }

  if (changedFiles.some((file) => file.startsWith('packages/engine/'))) {
    reminders.push('- Engine changes: emit typed events rather than stdout; mutate plan lifecycle state only through `mutateState`; emit build decisions through `emitBuildDecision*`; use `forgeCommit`/`composeCommitMessage` for engine commits.');
  }

  const touchesPi = changedFiles.some((file) => file.startsWith('packages/pi-eforge/'));
  const touchesClaude = changedFiles.some((file) => file.startsWith('eforge-plugin/'));
  if (touchesPi || touchesClaude) {
    reminders.push('- Integration changes: keep `packages/pi-eforge/` and `eforge-plugin/` behavior in sync when technically feasible. Bump only `eforge-plugin/.claude-plugin/plugin.json` when changing the Claude plugin; do not bump `packages/pi-eforge/package.json`.');
  }

  if (changedFiles.some((file) => file.startsWith('packages/extension-sdk/') || file.startsWith('docs/extensions') || file.startsWith('examples/extensions/'))) {
    reminders.push('- Extension-system changes: keep SDK types, docs, examples, management output, and runtime-support claims aligned. Remember extensions are trusted unsandboxed code.');
  }

  return reminders;
}

function roleSpecificReminders(ctx: AgentRunContext): string[] {
  switch (ctx.role) {
    case 'builder':
    case 'review-fixer':
    case 'validation-fixer':
      return [
        '- Keep the plan first; treat these guardrails as tie-breakers, not extra scope.',
        '- Prefer bounded, focused edits; preserve engine/client/integration ownership boundaries when touched.',
      ];
    case 'reviewer':
      return [
        '- Give concrete findings only; check architecture/client/integration/maintainability guardrails when the diff actually touches them.',
      ];
    case 'test-writer':
    case 'tester':
      return [
        '- Exercise real code and targeted behavior; avoid mocks unless existing project policy explicitly allows them.',
      ];
    case 'doc-author':
    case 'doc-syncer':
      return [
        '- Keep docs consistent with shipped behavior; roadmap content should remain future-focused.',
      ];
    case 'evaluator':
      return [
        '- Judge acceptance criteria, validation, and unresolved review issues; do not expand implementation scope.',
      ];
    default:
      return [];
  }
}

function buildPromptAppend(ctx: AgentRunContext): string {
  const targeted = pathSpecificReminders(ctx.changedFiles);
  const reminders = [...roleSpecificReminders(ctx), ...targeted];

  return [
    '## Eforge guardrails',
    ...reminders,
    `(role=${ctx.role}, stage=${ctx.stage ?? 'unknown'}, plan=${ctx.planId ?? 'unknown'})`,
  ].join('\n');
}

export default function eforgeGuardrails(eforge: EforgeExtensionAPI): void {
  eforge.onAgentRun((ctx) => {
    if (!shouldAugmentAgentRun(ctx)) {
      return undefined;
    }

    return {
      promptAppend: buildPromptAppend(ctx),
    };
  });

  eforge.registerReviewerPerspective({
    key: 'eforge-architecture',
    label: 'Eforge Architecture Review',
    description:
      'Reviews changes against eforge repository architecture, integration sync, daemon API ownership, extension-system, and maintainability guardrails.',
    promptFragment: `
## Eforge architecture review

Review the diff against eforge's project-specific architecture and agent-maintainability rules. Focus on high-signal findings with file references.

Check these areas:

- **Engine boundaries**: the engine should remain headless; it emits typed events and should not print user-facing output. Scheduling, approvals, notifications, and rich workflow UX belong in daemon clients, wrappers, or integration packages rather than engine internals.
- **State and decision discipline**: lifecycle state mutations should flow through \`mutateState(state, event)\`; build decisions should flow through \`emitBuildDecision(ctx, decision)\` or \`emitBuildDecisionForPlan(planId, decision)\`.
- **Git commit discipline**: engine-generated commits should use \`forgeCommit()\` and model-aware messages should use \`composeCommitMessage(...)\` where agents were invoked.
- **Daemon API ownership**: route constants, daemon wire shapes, SSE helpers, and run/queue/session/auto-build response contracts belong in \`@eforge-build/client\`; avoid local \`/api/...\` literals and duplicate interfaces in monitor or integration packages unless the documented browser-bundle exception applies.
- **Integration parity**: when user-facing commands, skills, MCP tools, CLI behavior, or extension UX changes, confirm \`packages/pi-eforge/\` and \`eforge-plugin/\` are kept in sync where technically feasible. Claude plugin changes should bump \`eforge-plugin/.claude-plugin/plugin.json\`; Pi package version should not be bumped manually.
- **Extension-system accuracy**: SDK types, runtime behavior, docs, examples, management commands, and runtime-support claims should agree. Extension code remains trusted and unsandboxed; secrets should come from environment variables.
- **Maintainability policy**: new implementation files should stay under 600 lines, new test files under 1,200 lines, large files need balanced \`// --- eforge:region ... ---\` markers, and oversized legacy files should receive bounded exact edits. When the diff touches oversized or large files, run \`pnpm maintainability:check\` as a read-only review aid and report any violations as actionable findings.
- **Testing policy**: prefer real-code tests grouped by logical unit. Avoid mocks and infra/harness implementation tests unless the existing project conventions explicitly call for them.

Return findings as critical / warning / suggestion. If no issue is found, explicitly state that the diff respects the eforge guardrails you checked.
`.trim(),
    appliesTo: {
      fileGlobs: ARCHITECTURE_REVIEW_PATHS,
    },
  });

  eforge.registerValidationProvider({
    name: 'agent-maintainability-gate',
    description:
      'Runs pnpm maintainability:check as a required eforge agent-friendly file-size and region-marker policy check.',
    validate: async (planOutputDir, ctx): Promise<ValidationProviderResult> => {
      if (!ctx) {
        return {
          status: 'failed',
          message: 'eforge guardrails validation did not receive a validation context.',
        };
      }

      ctx.logger.info('Running eforge agent maintainability gate', { planId: ctx.planId });

      const result = await ctx.exec.run('pnpm', ['maintainability:check'], {
        cwd: planOutputDir,
      });

      if (result.exitCode !== 0) {
        const output = result.stderr.trim() || result.stdout.trim();
        return {
          status: 'failed',
          message: `Agent maintainability check failed:\n${output}`,
          details: output,
        };
      }

      return {
        status: 'passed',
        message: 'Agent maintainability check passed',
      };
    },
  });
}
