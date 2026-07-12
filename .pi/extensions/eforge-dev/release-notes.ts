import { readFile } from "node:fs/promises";
import { join } from "node:path";

export function extractChangelogReleaseNotes(changelog: string, version: string): string | undefined {
	const escaped = version.replace(/\./g, "\\.");
	const match = new RegExp(
		`^## \\[${escaped}\\][^\n]*\n\n([\\s\\S]*?)(?=\n## \\[|\n---|(?![\\s\\S]))`,
		"m",
	).exec(changelog);
	return match?.[1]?.trim();
}

export async function readChangelogReleaseNotes(cwd: string, version: string): Promise<string | undefined> {
	try {
		const changelog = await readFile(join(cwd, "CHANGELOG.md"), "utf8");
		return extractChangelogReleaseNotes(changelog, version);
	} catch {
		return undefined;
	}
}
