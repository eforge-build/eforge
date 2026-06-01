import type { EforgeEvent } from '../events.js';
import type { StackBaseContext } from './base-resolver.js';
import type { ProviderCommandResult } from './provider.js';

type ProviderCommandErrorLike = {
  command?: unknown;
  args?: unknown;
  exitCode?: unknown;
};

type ProviderCommandEventResult = Omit<ProviderCommandResult, 'exitCode'> & { exitCode: number | null };

export function stackProviderCommandEvent(
  providerName: StackBaseContext['provider'],
  branch: string,
  result: ProviderCommandEventResult,
  redact: (message: string) => string,
): EforgeEvent {
  return {
    timestamp: new Date().toISOString(),
    type: 'stack:provider:command',
    provider: providerName,
    command: redact(result.command),
    args: result.args.map((arg) => redact(arg)),
    exitCode: result.exitCode,
    branch,
  } as EforgeEvent;
}

export function stackProviderCommandEventFromError(
  providerName: StackBaseContext['provider'],
  branch: string,
  err: unknown,
  redact: (message: string) => string,
): EforgeEvent | undefined {
  if (err === null || typeof err !== 'object') return undefined;
  const candidate = err as ProviderCommandErrorLike;
  if (
    typeof candidate.command !== 'string' ||
    !Array.isArray(candidate.args) ||
    !candidate.args.every((arg): arg is string => typeof arg === 'string') ||
    (typeof candidate.exitCode !== 'number' && candidate.exitCode !== null)
  ) {
    return undefined;
  }

  return stackProviderCommandEvent(providerName, branch, {
    command: candidate.command,
    args: candidate.args,
    stdout: '',
    stderr: '',
    exitCode: candidate.exitCode,
  }, redact);
}
