import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import chalk from 'chalk';
import type { ClarificationQuestion } from '@eforge-build/engine/events';

/**
 * Create a clarification callback for the engine.
 * Auto mode returns defaults without prompting; interactive mode uses readline.
 */
export function createClarificationHandler(
  auto: boolean,
): (questions: ClarificationQuestion[]) => Promise<Record<string, string>> {
  if (auto) {
    return async (questions) => {
      const answers: Record<string, string> = {};
      for (const q of questions) {
        answers[q.id] = q.default ?? '';
      }
      return answers;
    };
  }

  return async (questions) => {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    const answers: Record<string, string> = {};
    try {
      for (const q of questions) {
        const prompt = q.default ? `${q.question} [${q.default}]: ` : `${q.question}: `;
        const answer = await rl.question(prompt);
        answers[q.id] = answer || (q.default ?? '');
      }
    } finally {
      rl.close();
    }
    return answers;
  };
}

/**
 * Create an approval callback for the engine.
 * Auto mode always approves; interactive mode prompts y/N via readline.
 */
export function createApprovalHandler(
  auto: boolean,
): (action: string, details: string) => Promise<boolean> {
  if (auto) {
    return async () => true;
  }

  return async (_action, _details) => {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    try {
      const answer = await rl.question('Approve? [y/N]: ');
      return answer.toLowerCase() === 'y';
    } finally {
      rl.close();
    }
  };
}

// --- eforge:region plan-04-ux-init-build-and-docs ---

/** Possible outcomes from the trunk landing confirmation prompt. */
export type TrunkLandingChoice = 'switch-to-pr' | 'cancel' | 'feature-branch' | 'solo-dev';

/**
 * Interactive confirmation prompt shown when the CLI detects that the user is
 * building from trunk with merge-to-base-branch and allowLocalMergeToTrunk is
 * not enabled. Presents four options and returns the user's choice.
 */
export async function confirmTrunkLanding(trunkBranch: string): Promise<TrunkLandingChoice> {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    console.error('');
    console.error(chalk.yellow.bold(`  ⚠  Building from trunk (${trunkBranch}) with merge-to-base-branch`));
    console.error('');
    console.error(`  eforge protects trunk from direct local merges by default.`);
    console.error(`  merge-to-base-branch on ${chalk.bold(trunkBranch)} requires build.allowLocalMergeToTrunk: true.`);
    console.error('');
    console.error(`  Options:`);
    console.error(`    1. Switch to ${chalk.bold('issue-pr')} — open a GitHub PR from the build branch [default]`);
    console.error(`    2. ${chalk.bold('Cancel')} — abort this build`);
    console.error(`    3. ${chalk.bold('Feature branch')} — print steps to switch to a feature branch first`);
    console.error(`    4. ${chalk.bold('Solo-dev opt-in')} — print steps to enable local trunk merges`);
    console.error('');
    const answer = await rl.question('  Choose 1, 2, 3, or 4 [1]: ');
    const choice = answer.trim() || '1';
    switch (choice) {
      case '2': return 'cancel';
      case '3': return 'feature-branch';
      case '4': return 'solo-dev';
      default: return 'switch-to-pr';
    }
  } finally {
    rl.close();
  }
}

// --- eforge:endregion plan-04-ux-init-build-and-docs ---
