#!/usr/bin/env node
// Build a structured result.json from eval scenario output.
// Usage: node build-result.mjs <output> <scenario> <version> <commit> <exitCode> <duration> <logFile> <validationJson>

import { readFileSync, writeFileSync } from 'fs';

const [, , outputFile, scenario, forgeVersion, forgeCommit, exitCodeStr, durationStr, logFile, validationJson] =
  process.argv;

// Parse the forge log to extract the run ID
let langfuseTraceId = undefined;
try {
  const log = readFileSync(logFile, 'utf8');
  const match = log.match(/Run:\s+([a-f0-9-]+)/);
  if (match) langfuseTraceId = match[1];
} catch {
  // Log file may not exist if forge failed to start
}

// Parse validation results
let validation = {};
try {
  validation = JSON.parse(validationJson);
} catch {
  // Empty or malformed validation
}

const result = {
  scenario,
  timestamp: new Date().toISOString(),
  forgeVersion,
  forgeCommit,
  forgeExitCode: parseInt(exitCodeStr, 10),
  validation,
  durationSeconds: parseInt(durationStr, 10),
  ...(langfuseTraceId && { langfuseTraceId }),
};

writeFileSync(outputFile, JSON.stringify(result, null, 2) + '\n');
