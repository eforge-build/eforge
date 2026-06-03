import { realpathSync } from 'node:fs';
import path from 'node:path';

export function validateReadOnlyArgv(argv: string[], cwd?: string): void {
  if (argv.length === 0) throw new Error('Read-only command argv cannot be empty');
  if (argv.some((arg) => arg.includes('\0'))) throw new Error('Read-only command argv cannot contain NUL bytes');
  const command = argv[0];
  if (command.includes('/') || command.includes('\\')) {
    throw new Error(`Unsafe read-only command path: ${command}`);
  }
  const args = argv.slice(1);
  if (command === 'git') {
    validateGitArgs(args, cwd);
    return;
  }
  if (command === 'rg') return validateSearchArgs('rg', args, cwd);
  if (command === 'grep') return validateSearchArgs('grep', args, cwd);
  if (command === 'ls') return validateLsArgs(args, cwd);
  if (command === 'cat') return validatePlainFileArgs('cat', args, cwd);
  if (command === 'head' || command === 'tail') return validateHeadTailArgs(command, args, cwd);
  if (command === 'wc') return validatePlainFileArgs('wc', args, cwd);
  throw new Error(`Unsafe read-only command: ${command}`);
}

function validateGitArgs(args: string[], cwd?: string): void {
  if (args.length === 0) throw new Error('git read-only command requires a subcommand');
  const subcommand = args[0];
  if (subcommand.startsWith('-')) {
    throw new Error(`Unsafe git global option for acceptance resolver: ${subcommand}`);
  }
  const allowedSubcommands = new Set(['status', 'diff', 'show', 'grep', 'ls-files', 'log', 'rev-parse', 'merge-base']);
  if (!allowedSubcommands.has(subcommand)) {
    throw new Error(`Unsafe git subcommand for acceptance resolver: ${subcommand || '(missing)'}`);
  }
  const unsafeOptions = [
    /^--output(?:=|$)/,
    /^--ext-diff$/,
    /^--textconv$/,
    /^--exec(?:=|$)/,
    /^--upload-pack(?:=|$)/,
    /^--receive-pack(?:=|$)/,
    /^--open-files-in-pager(?:=|$)/,
    /^--paginate$/,
    /^--pager(?:=|$)/,
    /^--config-env(?:=|$)/,
    /^--exec-path(?:=|$)/,
    /^--git-dir(?:=|$)/,
    /^--work-tree(?:=|$)/,
    /^-c$/,
    /^-p$/,
    /^-O(?:$|.)/,
  ];
  for (const arg of args) {
    if (unsafeOptions.some((pattern) => pattern.test(arg))) throw new Error(`Unsafe git option for acceptance resolver: ${arg}`);
  }
  const pathSeparatorIndex = args.indexOf('--');
  if (pathSeparatorIndex !== -1) validatePathArgs(args.slice(pathSeparatorIndex + 1), cwd);
  for (const arg of args.slice(1)) {
    if (!arg.startsWith('-') && looksLikeUnsafePath(arg)) validatePathArg(arg, cwd);
  }
}

function validateSearchArgs(command: 'rg' | 'grep', args: string[], cwd?: string): void {
  if (args.length < 1) throw new Error(`${command} requires a pattern`);
  if (args.some((arg) => arg.startsWith('-'))) {
    throw new Error(`${command} options are not allowed for acceptance resolver searches`);
  }
  validatePathArgs(args.slice(1), cwd);
}

function validateLsArgs(args: string[], cwd?: string): void {
  const paths: string[] = [];
  for (const arg of args) {
    if (arg.startsWith('-')) {
      if (!/^-[A-Za-z1]*$/.test(arg) || /[R]/.test(arg)) throw new Error(`Unsafe ls option for acceptance resolver: ${arg}`);
    } else {
      paths.push(arg);
    }
  }
  validatePathArgs(paths, cwd);
}

function validatePlainFileArgs(command: string, args: string[], cwd?: string): void {
  if (args.length === 0) throw new Error(`${command} requires at least one file path`);
  if (args.some((arg) => arg.startsWith('-'))) throw new Error(`${command} options are not allowed for acceptance resolver`);
  validatePathArgs(args, cwd);
}

function validateHeadTailArgs(command: string, args: string[], cwd?: string): void {
  const paths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (/^-[0-9]+$/.test(arg)) continue;
    if (arg === '-n' || arg === '-c') { i++; continue; }
    if (arg.startsWith('-')) throw new Error(`${command} option is not allowed for acceptance resolver: ${arg}`);
    paths.push(arg);
  }
  validatePathArgs(paths, cwd);
}

function validatePathArgs(args: string[], cwd?: string): void {
  for (const arg of args) validatePathArg(arg, cwd);
}

export function validateReadOnlyPathArg(arg: string, cwd?: string): void {
  validatePathArg(arg, cwd);
}

function validatePathArg(arg: string, cwd?: string): void {
  if (arg === '' || arg.startsWith('~') || path.isAbsolute(arg) || arg.split(/[\\/]+/).includes('..')) {
    throw new Error(`Unsafe read-only command path argument: ${arg}`);
  }
  if (!cwd) return;
  const root = realpathSync(cwd);
  const resolved = path.resolve(root, arg);
  if (!isInside(root, resolved)) throw new Error(`Read-only command path escapes worktree: ${arg}`);
  try {
    const real = realpathSync(resolved);
    if (!isInside(root, real)) throw new Error(`Read-only command path escapes worktree: ${arg}`);
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT') return;
    throw err;
  }
}

function looksLikeUnsafePath(arg: string): boolean {
  return arg.startsWith('~') || path.isAbsolute(arg) || arg.split(/[\\/]+/).includes('..');
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
