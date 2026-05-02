/**
 * Shared helpers for the eforge lockstep version scheme.
 *
 * All public @eforge-build/* packages ship at the same version. The version
 * in packages/eforge/package.json is the source of truth; the other lockstep
 * packages are kept in sync by propagation (done once in git before tagging,
 * and again at publish time as a safety net).
 */

import { readFileSync, writeFileSync } from "node:fs";

export const SOURCE_OF_TRUTH = "packages/eforge/package.json";

export const LOCKSTEP_PACKAGE_PATHS = [
  "packages/client/package.json",
  "packages/engine/package.json",
  "packages/input/package.json",
  "packages/monitor/package.json",
  "packages/pi-eforge/package.json",
  "packages/scopes/package.json",
];

export const ALL_PACKAGE_PATHS = [SOURCE_OF_TRUTH, ...LOCKSTEP_PACKAGE_PATHS];

// The plugin's MCP proxy hardcodes a published-fallback pin (`@eforge-build/eforge@^X.Y.0`)
// so marketplace users always pull a CLI matching the contract the plugin expects.
// The pin lives as a literal in JS, so we rewrite it in lockstep with the source-of-truth
// version. Stale pin = silently broken tools for every marketplace user (see issue with
// 0.5.0 pin shipping past the 0.7 backend → profile/harness rename).
export const EFORGE_MCP_PROXY = "eforge-plugin/bin/eforge-mcp-proxy.mjs";

// Anchored to the package name so it can't accidentally match an unrelated versioned literal.
function eforgePinRe() {
  return /@eforge-build\/eforge@\^\d+\.\d+\.\d+/g;
}

function pinFloor(version) {
  const [maj, min] = version.split(".").map(Number);
  if (Number.isNaN(maj) || Number.isNaN(min)) {
    throw new Error(`Invalid semver for pin floor: ${version}`);
  }
  return `^${maj}.${min}.0`;
}

export function expectedProxyPinLiteral(version) {
  return `@eforge-build/eforge@${pinFloor(version)}`;
}

// Reads the proxy file and returns every `@eforge-build/eforge@^X.Y.Z` literal it
// finds, throwing if none are present (catches refactors that delete the pin
// without removing the lockstep wiring).
function readProxyPinMatches() {
  const current = readFileSync(EFORGE_MCP_PROXY, "utf8");
  const matches = current.match(eforgePinRe());
  if (!matches || matches.length === 0) {
    throw new Error(
      `${EFORGE_MCP_PROXY}: expected at least one @eforge-build/eforge@^X.Y.Z literal; found none`,
    );
  }
  return { current, matches };
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function readSourceVersion() {
  const pkg = readJson(SOURCE_OF_TRUTH);
  if (!pkg.version) {
    throw new Error(`Missing version in ${SOURCE_OF_TRUTH}`);
  }
  return pkg.version;
}

export function propagateVersion(version, { log = console.log } = {}) {
  for (const path of LOCKSTEP_PACKAGE_PATHS) {
    const pkg = readJson(path);
    if (pkg.version !== version) {
      log(`  ${path}: ${pkg.version} -> ${version}`);
      pkg.version = version;
      writeJson(path, pkg);
    } else {
      log(`  ${path}: already at ${version}`);
    }
  }
  propagateProxyPin(version, { log });
}

export function propagateProxyPin(version, { log = console.log } = {}) {
  const expectedLiteral = expectedProxyPinLiteral(version);
  const { current, matches } = readProxyPinMatches();
  const next = current.replace(eforgePinRe(), expectedLiteral);
  if (next === current) {
    log(`  ${EFORGE_MCP_PROXY}: pin already at ${expectedLiteral}`);
    return;
  }
  // Report every distinct stale literal that's about to be rewritten, so multi-pin
  // drift doesn't get hidden behind a misleading single-value log line.
  const distinctBefore = [...new Set(matches)].filter((m) => m !== expectedLiteral);
  log(`  ${EFORGE_MCP_PROXY}: ${distinctBefore.join(", ")} -> ${expectedLiteral}`);
  writeFileSync(EFORGE_MCP_PROXY, next);
}

export function verifyAllAtVersion(version) {
  for (const path of ALL_PACKAGE_PATHS) {
    const pkg = readJson(path);
    if (pkg.version !== version) {
      throw new Error(
        `Version mismatch: ${path} is ${pkg.version}, expected ${version}`,
      );
    }
  }
  verifyProxyPin(version);
}

export function verifyProxyPin(version) {
  const expectedLiteral = expectedProxyPinLiteral(version);
  const { matches } = readProxyPinMatches();
  for (const match of matches) {
    if (match !== expectedLiteral) {
      throw new Error(
        `Proxy pin mismatch in ${EFORGE_MCP_PROXY}: found '${match}', expected '${expectedLiteral}' for version ${version}. ` +
          `Run propagateVersion() (e.g. via 'pnpm publish-all --dry-run') to update.`,
      );
    }
  }
}

export function bumpSemver(version, bumpType) {
  const parts = version.split(".").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    throw new Error(`Invalid semver: ${version}`);
  }
  const [maj, min, pat] = parts;
  switch (bumpType) {
    case "major": return `${maj + 1}.0.0`;
    case "minor": return `${maj}.${min + 1}.0`;
    case "patch": return `${maj}.${min}.${pat + 1}`;
    default: throw new Error(`Unknown bump type: ${bumpType}`);
  }
}
