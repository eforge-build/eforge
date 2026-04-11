#!/usr/bin/env node

// Dispatches `eforge mcp-proxy` to the local workspace build when this plugin
// lives inside an eforge monorepo checkout, otherwise falls back to
// `npx -y @eforge-build/eforge mcp-proxy` for marketplace-installed users.
//
// Local dev loop: edit code, `pnpm --filter @eforge-build/eforge build`,
// restart Claude Code. The wrapper re-resolves on every launch.

import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// Expected layout when running from an eforge monorepo checkout:
//   <repo>/eforge-plugin/bin/eforge-mcp-proxy.mjs   <- this file
//   <repo>/pnpm-workspace.yaml
//   <repo>/packages/eforge/package.json             (name: @eforge-build/eforge)
//   <repo>/packages/eforge/dist/cli.js
//
// We require ALL of those markers before trusting the workspace path, so a
// stray `packages/eforge/dist/cli.js` two levels up in an unrelated repo can't
// accidentally shadow the published CLI.
const workspaceRoot = resolve(here, "../..");
const workspaceCli = resolve(workspaceRoot, "packages/eforge/dist/cli.js");
const workspaceMarker = resolve(workspaceRoot, "pnpm-workspace.yaml");
const workspaceEforgePkg = resolve(workspaceRoot, "packages/eforge/package.json");

function isEforgeWorkspace() {
  if (!existsSync(workspaceCli)) return false;
  if (!existsSync(workspaceMarker)) return false;
  if (!existsSync(workspaceEforgePkg)) return false;
  try {
    const pkg = JSON.parse(readFileSync(workspaceEforgePkg, "utf8"));
    return pkg?.name === "@eforge-build/eforge";
  } catch {
    return false;
  }
}

const forwardedArgs = process.argv.slice(2);
const useWorkspace = isEforgeWorkspace();
const debug = process.env.EFORGE_DEBUG === "1" || /\beforge\b/.test(process.env.DEBUG ?? "");

// Published fallback pins ^0.5.0 so the plugin can't silently pull in an older
// major where the mcp-proxy subcommand or its contract has changed.
const [command, args] = useWorkspace
  ? ["node", [workspaceCli, "mcp-proxy", ...forwardedArgs]]
  : ["npx", ["-y", "@eforge-build/eforge@^0.5.0", "mcp-proxy", ...forwardedArgs]];

if (debug) {
  process.stderr.write(
    useWorkspace
      ? `eforge-mcp-proxy: workspace build at ${workspaceCli}\n`
      : `eforge-mcp-proxy: npx -y @eforge-build/eforge@^0.5.0 (no workspace detected)\n`,
  );
}

const child = spawn(command, args, { stdio: "inherit" });

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on("error", (err) => {
  process.stderr.write(`eforge-mcp-proxy: failed to spawn ${command}: ${err.message}\n`);
  process.exit(127);
});
