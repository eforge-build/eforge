import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const rootPackagePath = new URL("../package.json", import.meta.url);
const piPackagePath = new URL("../pi-package/package.json", import.meta.url);
const rootLicensePath = new URL("../LICENSE", import.meta.url);
const piPackageReadmePath = new URL("../pi-package/README.md", import.meta.url);
const piPackageExtensionsPath = new URL("../pi-package/extensions", import.meta.url);
const piPackageSkillsPath = new URL("../pi-package/skills", import.meta.url);
const stageDirPath = new URL("../tmp/pi-package-publish/", import.meta.url);
const stagedPackageJsonPath = new URL("package.json", stageDirPath);
const stagedLicensePath = new URL("LICENSE", stageDirPath);
const stagedReadmePath = new URL("README.md", stageDirPath);
const stagedExtensionsPath = new URL("extensions", stageDirPath);
const stagedSkillsPath = new URL("skills", stageDirPath);

const rootPackage = JSON.parse(readFileSync(rootPackagePath, "utf8"));
const piPackage = JSON.parse(readFileSync(piPackagePath, "utf8"));

piPackage.version = rootPackage.version;
piPackage.homepage = rootPackage.homepage;
piPackage.repository = rootPackage.repository;
piPackage.publishConfig = { access: "public" };
piPackage.files = ["extensions/", "skills/", "README.md", "LICENSE"];
piPackage.peerDependencies = {
  ...piPackage.peerDependencies,
  "@mariozechner/pi-tui": "*",
};
piPackage.peerDependenciesMeta = {
  ...piPackage.peerDependenciesMeta,
  "@mariozechner/pi-tui": { optional: false },
};

rmSync(stageDirPath, { recursive: true, force: true });
mkdirSync(stageDirPath, { recursive: true });
cpSync(rootLicensePath, stagedLicensePath);
cpSync(piPackageReadmePath, stagedReadmePath);
cpSync(piPackageExtensionsPath, stagedExtensionsPath, { recursive: true });
cpSync(piPackageSkillsPath, stagedSkillsPath, { recursive: true });
writeFileSync(stagedPackageJsonPath, `${JSON.stringify(piPackage, null, 2)}\n`);

console.log(`Prepared ${stageDirPath.pathname} for npm publish (version ${rootPackage.version}).`);
