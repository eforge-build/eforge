import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createBacklogHtmlModel, findDependencyCycles, renderBacklogHtml, writeBacklogHtml } from "./html";
import { createItem, type BacklogItem, type BacklogStatus } from "./store";
import { writeRecommendations } from "./recommendations";
import type { BacklogEpic } from "./epic-store";

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

function epic(input: Partial<BacklogEpic> & { id: string; title: string }): BacklogEpic {
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
		body: input.body ?? `# ${input.title}\n\n## Goal\n\nTBD\n`,
	};
}

describe("backlog HTML view", () => {
	it("builds dependency-aware stats and references", () => {
		const dependency = item({ id: "backlog-2026-06-04-foundation", title: "Foundation", status: "planned" });
		const dependent = item({ id: "backlog-2026-06-04-dashboard", title: "Dashboard", depends_on: [dependency.id, "missing-dep"], tags: ["ui"] });
		const shipped = item({ id: "backlog-2026-06-04-done", title: "Done", status: "shipped" });

		const model = createBacklogHtmlModel([dependent, dependency, shipped], [dependent, dependency, shipped], {}, []);

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
		], undefined, {}, []);

		const html = renderBacklogHtml(model);

		expect(html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
		expect(html).toContain("&lt;script&gt;alert(&#39;bad&#39;)&lt;/script&gt;");
		expect(html).not.toContain("<script>alert('bad')</script>");
	});

	it("renders local epic context and missing epic markers", () => {
		const knownEpic = epic({ id: "backlog-epic-2026-06-04-platform", title: "Platform work", status: "active" });
		const linked = item({ id: "backlog-2026-06-04-linked", title: "Linked item", epic: knownEpic.id });
		const missing = item({ id: "backlog-2026-06-04-missing", title: "Missing epic item", epic: "backlog-epic-2026-06-04-missing" });

		const model = createBacklogHtmlModel([linked, missing], [linked, missing], {}, [knownEpic]);
		const html = renderBacklogHtml(model);

		expect(model.items[0]?.epic).toMatchObject({ id: knownEpic.id, title: "Platform work", missing: false });
		expect(model.items[1]?.epic).toMatchObject({ id: "backlog-epic-2026-06-04-missing", missing: true });
		expect(html).toContain("Epic: Platform work");
		expect(html).toContain(`title="backlog-epic-2026-06-04-platform (active)"`);
		expect(html).toContain("Missing epic: backlog-epic-2026-06-04-missing");
		expect(html).toContain("epic-tag missing");
		expect(html).toContain(`title="Missing: backlog-epic-2026-06-04-missing"`);
	});

	it("builds epic groups and renders epic board, panel, and filter controls", () => {
		const platform = epic({ id: "backlog-epic-2026-06-04-platform", title: "Platform work", status: "active" });
		const linkedA = item({ id: "backlog-2026-06-04-a", title: "A", epic: platform.id });
		const linkedB = item({ id: "backlog-2026-06-04-b", title: "B", epic: platform.id });
		const orphan = item({ id: "backlog-2026-06-04-c", title: "C", epic: "backlog-epic-2026-06-04-missing" });
		const unassigned = item({ id: "backlog-2026-06-04-d", title: "D" });
		const items = [linkedA, linkedB, orphan, unassigned];

		const model = createBacklogHtmlModel(items, items, {}, [platform]);
		const html = renderBacklogHtml(model);

		// Groups: real epics first (by title), missing last; counts reflect linked items.
		expect(model.epics).toMatchObject([
			{ id: platform.id, title: "Platform work", missing: false, count: 2 },
			{ id: "backlog-epic-2026-06-04-missing", missing: true, count: 1 },
		]);
		expect(model.unassignedCount).toBe(1);

		// Feature 1: epic filter control with one option per epic.
		expect(html).toContain(`<select id="epic-filter"`);
		expect(html).toContain(`<option value="backlog-epic-2026-06-04-platform">Platform work (2)</option>`);

		// Feature 2: group-by-epic toggle plus an empty epic board with one column per group and a "No epic" column.
		expect(html).toContain(`data-group="epic"`);
		expect(html).toContain(`data-board="epic"`);
		expect(html).toContain(`data-epic-col="backlog-epic-2026-06-04-platform"`);
		expect(html).toContain(`data-epic-col=""`);

		// Feature 3: epics summary panel with clickable chips and a non-actionable unassigned count.
		expect(html).toContain(`data-epic-filter="backlog-epic-2026-06-04-platform"`);
		expect(html).toContain("epic-summary-none");

		// Cards carry their epic id so the client can regroup and filter them.
		expect(html).toContain(`data-epic="backlog-epic-2026-06-04-platform"`);
		expect(html).toContain(`data-epic=""`);
	});

	it("omits epic board, panel, and controls when no items are linked to epics", () => {
		const items = [item({ id: "backlog-2026-06-04-a", title: "A" })];
		const html = renderBacklogHtml(createBacklogHtmlModel(items, items, {}, []));

		expect(html).not.toContain(`data-board="epic"`);
		expect(html).not.toContain(`id="epic-filter"`);
		expect(html).not.toContain(`<section class="epic-panel"`);
		expect(html).not.toContain(`data-group="epic"`);
	});

	it("reports dependency cycles", () => {
		const a = item({ id: "backlog-2026-06-04-a", title: "A", depends_on: ["backlog-2026-06-04-b"] });
		const b = item({ id: "backlog-2026-06-04-b", title: "B", depends_on: ["backlog-2026-06-04-a"] });

		expect(findDependencyCycles([a, b])).toEqual([["backlog-2026-06-04-a", "backlog-2026-06-04-b", "backlog-2026-06-04-a"]]);
	});

	it("includes structured recommendations in the generated view", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "backlog-html-recommendations-"));
		try {
			const created = await createItem(cwd, { title: "Portable backlog item" });
			await writeRecommendations(cwd, {
				schemaVersion: 1,
				refreshedAt: "2026-06-05",
				summary: "Recommended plan",
				activeWork: [],
				readyCandidates: [],
				recommendedNextSequence: [{ rank: 1, id: created.id, title: created.title, rationale: "ready" }],
				safeParallelizableGroups: [{ name: "Storage lane", itemIds: [created.id], rationale: "independent" }],
				blockedChains: [],
				rationaleAndAssumptions: ["Generated from tests"],
			});

			const result = await writeBacklogHtml(cwd);
			const html = await readFile(result.path, "utf8");

			expect(html).toContain("Recommended plan");
			expect(html).toContain("Recommended next sequence");
			expect(html).toContain(`#item-${created.id}`);
			// Approach C: the recommended grouping mode and per-card signals.
			expect(html).toContain('data-group="recommended"');
			expect(html).toContain('data-board="recommended"');
			expect(html).toContain('badge-rec">Next 1</span>');
			expect(html).toContain('class="tag lane-tag"');
			expect(html).toContain('data-rec-col="next"');
			expect(html).toContain('data-rec-rank="1"');
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
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
