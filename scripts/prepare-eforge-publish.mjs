import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const eforgePackagePath = new URL("../packages/eforge/package.json", import.meta.url);
const clientPackagePath = new URL("../packages/client/package.json", import.meta.url);
const enginePackagePath = new URL("../packages/engine/package.json", import.meta.url);
const monitorPackagePath = new URL("../packages/monitor/package.json", import.meta.url);
const rootLicensePath = new URL("../LICENSE", import.meta.url);

const eforgeDistPath = new URL("../packages/eforge/dist", import.meta.url);
const clientDistPath = new URL("../packages/client/dist", import.meta.url);
const engineDistPath = new URL("../packages/engine/dist", import.meta.url);
const monitorDistPath = new URL("../packages/monitor/dist", import.meta.url);

const stageDirPath = new URL("../tmp/eforge-publish/", import.meta.url);
const stagedPackageJsonPath = new URL("package.json", stageDirPath);
const stagedLicensePath = new URL("LICENSE", stageDirPath);
const stagedDistPath = new URL("dist/", stageDirPath);

// Bundled workspace packages staged under node_modules/
const stagedClientDir = new URL("node_modules/@eforge-build/client/", stageDirPath);
const stagedEngineDir = new URL("node_modules/@eforge-build/engine/", stageDirPath);
const stagedMonitorDir = new URL("node_modules/@eforge-build/monitor/", stageDirPath);

const eforgePackage = JSON.parse(readFileSync(eforgePackagePath, "utf8"));

// Map workspace package names to their actual versions for dependency rewriting
const workspacePackageVersions = {
  "@eforge-build/client": JSON.parse(readFileSync(clientPackagePath, "utf8")).version,
  "@eforge-build/engine": JSON.parse(readFileSync(enginePackagePath, "utf8")).version,
  "@eforge-build/monitor": JSON.parse(readFileSync(monitorPackagePath, "utf8")).version,
};

// Rewrite workspace:* dependencies to concrete versions
if (eforgePackage.dependencies) {
  for (const [dep, ver] of Object.entries(eforgePackage.dependencies)) {
    if (typeof ver === "string" && ver.startsWith("workspace:")) {
      const resolvedVersion = workspacePackageVersions[dep];
      if (!resolvedVersion) {
        throw new Error(
          `No version mapping for workspace dependency "${dep}". Add it to workspacePackageVersions.`,
        );
      }
      eforgePackage.dependencies[dep] = resolvedVersion;
    }
  }
}

// Verify all dist directories exist
for (const [name, distPath] of [
  ["@eforge-build/eforge", eforgeDistPath],
  ["@eforge-build/client", clientDistPath],
  ["@eforge-build/engine", engineDistPath],
  ["@eforge-build/monitor", monitorDistPath],
]) {
  if (!existsSync(distPath)) {
    throw new Error(
      `${name} has not been built. Run \`pnpm build\` before preparing the publish.`,
    );
  }
}

// Clean and create stage directory
rmSync(stageDirPath, { recursive: true, force: true });
mkdirSync(stageDirPath, { recursive: true });

// Copy eforge dist
cpSync(eforgeDistPath, stagedDistPath, { recursive: true });

// Copy LICENSE
cpSync(rootLicensePath, stagedLicensePath);

// Stage bundled workspace packages
function stagePackage(srcDistPath, srcPackagePath, stagedDir) {
  mkdirSync(new URL("dist/", stagedDir), { recursive: true });
  cpSync(srcDistPath, new URL("dist/", stagedDir), { recursive: true });
  cpSync(srcPackagePath, new URL("package.json", stagedDir));
}

stagePackage(clientDistPath, clientPackagePath, stagedClientDir);
stagePackage(engineDistPath, enginePackagePath, stagedEngineDir);
stagePackage(monitorDistPath, monitorPackagePath, stagedMonitorDir);

// Write staged package.json with concrete versions
writeFileSync(stagedPackageJsonPath, `${JSON.stringify(eforgePackage, null, 2)}\n`);

// Validate known subpaths exist
const requiredPaths = [
  new URL("dist/cli.js", stageDirPath),
  new URL("node_modules/@eforge-build/engine/dist/agents/planner.js", stageDirPath),
  new URL("node_modules/@eforge-build/engine/dist/prompts/builder.md", stageDirPath),
  new URL("node_modules/@eforge-build/monitor/dist/server-main.js", stageDirPath),
  new URL("node_modules/@eforge-build/monitor/dist/monitor-ui/index.html", stageDirPath),
];

for (const p of requiredPaths) {
  if (!existsSync(p)) {
    throw new Error(`Expected staged path not found: ${p.pathname}`);
  }
}

console.log(
  `Prepared ${stageDirPath.pathname} for npm publish (version ${eforgePackage.version}).`,
);
