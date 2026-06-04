import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createBacklogHtmlModel, findDependencyCycles, renderBacklogHtml, writeBacklogHtml } from "./html";
import { createItem, type BacklogItem, type BacklogStatus } from "./store";

function item(input: Partial<BacklogItem> & { id: string; title: string; depends_on?: string[]; status?: BacklogStatus }): BacklogItem {
	return {
		id: input.id,
		title: input.title,
		status: input.status ?? "candidate",
		priority: input.priority ?? "medium",
		source: input.source ?? "manual",
		created: input.created ?? "2026-06-04",
		updated: input.updated ?? "2026-06-04",
		last_checked: input.last_checked,
		stale_after: input.stale_after,
		tags: input.tags ?? [],
		depends_on: input.depends_on ?? [],
		epic: input.epic,
		body: input.body ?? `# ${input.title}\n\n## Claim\n\nTBD\n\n## Evidence\n\n- captured\n`,
	};
}

describe("backlog HTML view", () => {
	it("builds dependency-aware stats and references", () => {
		const dependency = item({ id: "backlog-2026-06-04-foundation", title: "Foundation", status: "planned" });
		const dependent = item({ id: "backlog-2026-06-04-dashboard", title: "Dashboard", depends_on: [dependency.id, "missing-dep"], tags: ["ui"] });
		const shipped = item({ id: "backlog-2026-06-04-done", title: "Done", status: "shipped" });

		const model = createBacklogHtmlModel([dependent, dependency, shipped], [dependent, dependency, shipped]);

		expect(model.stats.total).toBe(3);
		expect(model.stats.open).toBe(2);
		expect(model.stats.blocked).toBe(1);
		expect(model.stats.closed).toBe(1);
		expect(model.items[0]?.blocked).toBe(true);
		expect(model.items[0]?.dependencies.map((ref) => [ref.id, ref.blocking, ref.missing])).toEqual([
			[dependency.id, true, false],
			["missing-dep", true, true],
		]);
		expect(model.items[1]?.dependents[0]?.id).toBe(dependent.id);
	});

	it("escapes item content in the rendered HTML", () => {
		const model = createBacklogHtmlModel([
			item({
				id: "backlog-2026-06-04-xss",
				title: "Render <script>alert('x')</script>",
				body: "# Render <script>alert('x')</script>\n\n## Claim\n\n<script>alert('bad')</script>\n",
			}),
		]);

		const html = renderBacklogHtml(model);

		expect(html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
		expect(html).toContain("&lt;script&gt;alert(&#39;bad&#39;)&lt;/script&gt;");
		expect(html).not.toContain("<script>alert('bad')</script>");
	});

	it("reports dependency cycles", () => {
		const a = item({ id: "backlog-2026-06-04-a", title: "A", depends_on: ["backlog-2026-06-04-b"] });
		const b = item({ id: "backlog-2026-06-04-b", title: "B", depends_on: ["backlog-2026-06-04-a"] });

		expect(findDependencyCycles([a, b])).toEqual([["backlog-2026-06-04-a", "backlog-2026-06-04-b", "backlog-2026-06-04-a"]]);
	});

	it("writes items and the generated view under .backlog", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "backlog-html-"));
		try {
			await createItem(cwd, { title: "Portable backlog item", claim: "Use the project-local backlog root" });

			const result = await writeBacklogHtml(cwd);
			const html = await readFile(result.path, "utf8");

			expect(result.path).toBe(join(cwd, ".backlog", "view", "index.html"));
			expect(result.total).toBe(1);
			expect(html).toContain("Portable backlog item");
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
