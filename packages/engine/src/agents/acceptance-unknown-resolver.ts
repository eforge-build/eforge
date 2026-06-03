import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Type } from '@sinclair/typebox';
import { safeParseWithSchema } from '@eforge-build/client';

import type { AgentHarness, CustomTool, SdkPassthroughConfig } from '../harness.js';
import { pickSdkOptions } from '../harness.js';
import { isAlwaysYieldedAgentEvent, type EforgeEvent } from '../events.js';
import { loadPrompt } from '../prompts.js';
import { DEFAULT_TIER_MAX_TURNS } from '../config.js';
import type { ExpectedAcceptanceCriterion } from '../validation/acceptance-criteria.js';
import {
  parseAcceptanceUnknownResolverOutput,
  type AcceptanceUnknownResolution,
  type ValidationCommandEvidence,
} from '../validation/acceptance-unknown-resolution.js';
import { formatValidationCommandEvidence } from './prd-validator.js';
import { validateReadOnlyArgv } from '../validation/read-only-command-validation.js';

const exec = promisify(execFile);
const MAX_COMMAND_OUTPUT_BYTES = 1_000_000;
const READ_ONLY_COMMAND_TIMEOUT_MS = 10_000;
const READ_ONLY_COMMAND_ENV = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_EXTERNAL_DIFF: '',
  GIT_PAGER: 'cat',
  PAGER: 'cat',
};

const readOnlyCommandSchema = Type.Object({
  argv: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
});

export interface AcceptanceUnknownResolverOptions extends SdkPassthroughConfig {
  harness: AgentHarness;
  cwd: string;
  unknownCriteria: ExpectedAcceptanceCriterion[];
  acceptanceVerdicts: Array<{ criterion: string; verdict: string; evidence: string }>;
  validationCommandEvidence?: ValidationCommandEvidence[];
  implementationDiffContext: string;
  verbose?: boolean;
  abortController?: AbortController;
  maxTurns?: number;
}

export async function* runAcceptanceUnknownResolver(
  options: AcceptanceUnknownResolverOptions,
): AsyncGenerator<EforgeEvent, AcceptanceUnknownResolution[], void> {
  const commandEvidence: ValidationCommandEvidence[] = [];
  const readOnlyTool = createReadOnlyCommandTool(options.cwd, commandEvidence);
  const effectiveToolName = options.harness.effectiveCustomToolName(readOnlyTool.name);
  const prompt = await loadPrompt('acceptance-unknown-resolver', {
    unknownCriteria: formatUnknownCriteria(options.unknownCriteria),
    existingVerdicts: JSON.stringify(options.acceptanceVerdicts, null, 2),
    validationEvidence: formatValidationCommandEvidence(options.validationCommandEvidence),
    implementationDiffContext: options.implementationDiffContext,
    readOnlyToolName: effectiveToolName,
  }, options.promptAppend);

  let accumulatedText = '';
  for await (const event of options.harness.run(
    {
      prompt,
      cwd: options.cwd,
      maxTurns: options.maxTurns ?? DEFAULT_TIER_MAX_TURNS.implementation,
      tools: 'read-only',
      abortSignal: options.abortController?.signal,
      customTools: [readOnlyTool],
      ...pickSdkOptions(options),
    },
    'prd-validator',
  )) {
    if (isAlwaysYieldedAgentEvent(event) || options.verbose) {
      yield event;
    }
    if (event.type === 'agent:message' && 'content' in event) {
      accumulatedText += event.content;
    }
  }

  return parseAcceptanceUnknownResolverOutput(accumulatedText, options.unknownCriteria, {
    cwd: options.cwd,
    implementationDiffContext: options.implementationDiffContext,
    commandEvidence,
  });
}

export function createReadOnlyCommandTool(cwd: string, commandEvidence?: ValidationCommandEvidence[]): CustomTool {
  return {
    name: 'acceptance_read_only_command',
    description: 'Run a safe read-only inspection or comparison command. Input: {"argv":["git","diff",...]}. Mutating commands are rejected.',
    inputSchema: readOnlyCommandSchema,
    handler: async (input: unknown) => {
      const parsed = safeParseWithSchema(readOnlyCommandSchema, input);
      if (!parsed.success) {
        throw new Error('Read-only command input must be an object with a non-empty argv string array');
      }
      const argv = parsed.data.argv.map((arg) => arg.trim());
      validateReadOnlyArgv(argv, cwd);
      const [command, ...args] = argv;
      const execArgs = command === 'git' ? ['--no-pager', ...gitReadOnlyArgs(args)] : args;
      try {
        const result = await exec(command, execArgs, {
          cwd,
          env: READ_ONLY_COMMAND_ENV,
          timeout: READ_ONLY_COMMAND_TIMEOUT_MS,
          maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
        });
        const output = JSON.stringify({ exitCode: 0, stdout: result.stdout, stderr: result.stderr }, null, 2);
        commandEvidence?.push({ command: argv.join(' '), exitCode: 0, output });
        return output;
      } catch (err) {
        const execErr = err as { code?: number | string; stdout?: string; stderr?: string; killed?: boolean; signal?: string };
        if (execErr.killed || execErr.signal) throw err;
        const exitCode = typeof execErr.code === 'number' ? execErr.code : 1;
        const output = JSON.stringify({ exitCode, stdout: execErr.stdout ?? '', stderr: execErr.stderr ?? '' }, null, 2);
        commandEvidence?.push({ command: argv.join(' '), exitCode, output });
        return output;
      }
    },
  };
}

function gitReadOnlyArgs(args: string[]): string[] {
  const [subcommand, ...rest] = args;
  if (subcommand === 'diff' || subcommand === 'show' || subcommand === 'log') {
    return [subcommand, '--no-ext-diff', '--no-textconv', ...rest];
  }
  return args;
}

function formatUnknownCriteria(criteria: ExpectedAcceptanceCriterion[]): string {
  return criteria.map((criterion) => `- ${criterion.id}: ${criterion.text}`).join('\n');
}
