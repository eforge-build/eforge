#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const normalizedArgs = [];

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  const nextArg = args[index + 1];

  if (arg === '--silent' && nextArg && !nextArg.startsWith('-')) {
    normalizedArgs.push('--silent=true');
    continue;
  }

  normalizedArgs.push(arg);
}

const vitestEntry = join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs');

if (!existsSync(vitestEntry)) {
  console.error(`Unable to find Vitest entry point at ${vitestEntry}`);
  process.exit(1);
}

const child = spawn(process.execPath, [vitestEntry, ...normalizedArgs], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
