#!/usr/bin/env node

/**
 * Bump the lockstep version, propagate across all lockstep package.jsons,
 * commit the bump, and optionally create an annotated tag.
 *
 * Does NOT push. In protected-branch release flows, pass `--no-tag`, merge the
 * release PR into main, then tag the resulting main commit and push only the tag.
 *
 * Usage: node scripts/bump-version.mjs <patch|minor|major> [--no-tag]
 */

import { execSync } from "node:child_process";
import {
  ALL_PACKAGE_PATHS,
  bumpSemver,
  EFORGE_MCP_PROXY,
  propagateVersion,
  readJson,
  readSourceVersion,
  SOURCE_OF_TRUTH,
  verifyAllAtVersion,
  writeJson,
} from "./lib/lockstep-version.mjs";

const bumpType = process.argv[2];
const noTag = process.argv.includes("--no-tag");
if (!["patch", "minor", "major"].includes(bumpType)) {
  console.error("Usage: node scripts/bump-version.mjs <patch|minor|major> [--no-tag]");
  process.exit(1);
}

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

// Refuse to run with a dirty index, so the `X.Y.Z` commit contains only the
// lockstep package.json bumps (and not whatever else happened to be staged).
const staged = execSync("git diff --cached --name-only", { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
if (staged.length > 0) {
  console.error(
    "Refusing to bump: the git index has staged changes. Commit or unstage them first.",
  );
  console.error("Staged files:");
  for (const path of staged) console.error(`  ${path}`);
  process.exit(1);
}

const previous = readSourceVersion();
const next = bumpSemver(previous, bumpType);

// 1. Write next version to source of truth.
const sourcePkg = readJson(SOURCE_OF_TRUTH);
sourcePkg.version = next;
writeJson(SOURCE_OF_TRUTH, sourcePkg);
console.log(`${SOURCE_OF_TRUTH}: ${previous} -> ${next}`);

// 2. Propagate to the other lockstep packages.
propagateVersion(next);

// 3. Verify.
verifyAllAtVersion(next);

// 4. Commit, and optionally tag. The proxy pin is also rewritten by
//    propagateVersion(); stage it so the bump commit captures every
//    lockstep-version surface in one atomic move.
run(`git add ${ALL_PACKAGE_PATHS.join(" ")} ${EFORGE_MCP_PROXY}`);
run(`git commit -m "${next}"`);

if (!noTag) {
  run(`git tag -a v${next} -m "v${next}"`);
  console.log(`\nBumped ${previous} -> ${next} and tagged v${next}.`);
  console.log(`Push with: git push origin HEAD --follow-tags`);
} else {
  console.log(`\nBumped ${previous} -> ${next} without creating a tag.`);
  console.log(`Merge this commit to main, then tag the merged main commit with: git tag -a v${next} -m "v${next}"`);
}
