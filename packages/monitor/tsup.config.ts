import { defineConfig } from "tsup";
import { existsSync } from "node:fs";
import { cp, readdir, readFile, writeFile } from "node:fs/promises";
import { globSync } from "node:fs";

export default defineConfig({
  entry: globSync("src/**/*.ts"),
  format: ["esm"],
  target: "node22",
  clean: true,
  dts: true,
  external: [/^@eforge-build\//],
  async onSuccess() {
    // node:sqlite prefix is stripped by esbuild; restore it after build
    const files = await readdir("dist");
    for (const f of files) {
      if (!f.endsWith(".js")) continue;
      const path = `dist/${f}`;
      const content = await readFile(path, "utf-8");
      if (content.includes('from "sqlite"')) {
        await writeFile(path, content.replace(/from "sqlite"/g, 'from "node:sqlite"'));
      }
    }
    // Copy monitor-ui dist into monitor's dist for serving
    if (existsSync("../monitor-ui/dist")) {
      await cp("../monitor-ui/dist", "dist/monitor-ui", { recursive: true });
    }
  },
});
