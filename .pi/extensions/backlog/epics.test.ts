import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEpic, epicPath, filterEpics, listEpics, readEpic, serializeEpic, validateLocalEpic, writeEpic } from "./epic-store";
import { createItem, filterItems, formatSummaryList, readItem } from "./store";

async function withTempBacklog<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
	const cwd = await mkdtemp(join(tmpdir(), "backlog-epics-"));
	try {
		return await fn(cwd);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
}

describe("backlog local epics", () => {
	it("creates and reads markdown-backed epic records", async () => {
		await withTempBacklog(async (cwd) => {
			const epic = await createEpic(cwd, { title: "Platform work", goal: "Unify backlog planning", tags: ["planning"] });
			const raw = await readFile(epicPath(cwd, epic.id), "utf8");
			const parsed = await readEpic(cwd, epic.id);

			expect(epic.id).toMatch(/^backlog-epic-\d{4}-\d{2}-\d{2}-platform-work$/);
			expect(raw).toContain("status: candidate");
			expect(raw).toContain("## Goal");
			expect(parsed.title).toBe("Platform work");
			expect(parsed.tags).toEqual(["planning"]);
		});
	});

	it("links one backlog item to one local epic", async () => {
		await withTempBacklog(async (cwd) => {
			const epic = await createEpic(cwd, { title: "Platform work" });
			const item = await createItem(cwd, { title: "Build epic support", epic: epic.id });
			const parsed = await readItem(cwd, item.id);

			expect(parsed.epic).toBe(epic.id);
			expect(filterItems([parsed], { epic: epic.id })).toHaveLength(1);
			expect(formatSummaryList([parsed])).toContain(`  epic: ${epic.id}`);
		});
	});

	it("rejects unknown local epic ids during validation", async () => {
		await withTempBacklog(async (cwd) => {
			await expect(validateLocalEpic(cwd, "backlog-epic-2026-06-04-missing")).rejects.toThrow("Unknown backlog epic id");
		});
	});

	it("serializes updated epic metadata", async () => {
		await withTempBacklog(async (cwd) => {
			const epic = await createEpic(cwd, { title: "Platform work" });
			epic.status = "active";
			epic.priority = "high";
			await writeEpic(cwd, epic);

			const parsed = await readEpic(cwd, epic.id);
			const serialized = serializeEpic(parsed);

			expect(parsed.status).toBe("active");
			expect(parsed.priority).toBe("high");
			expect(serialized).toContain("priority: high");
		});
	});

	it("filters local epics by status, tag, and query", async () => {
		await withTempBacklog(async (cwd) => {
			const platform = await createEpic(cwd, { title: "Platform work", tags: ["core"] });
			const docs = await createEpic(cwd, { title: "Docs work", tags: ["docs"] });
			docs.status = "shipped";
			await writeEpic(cwd, docs);

			const epics = await listEpics(cwd);

			expect(filterEpics(epics, { tag: "core" }).map((epic) => epic.id)).toEqual([platform.id]);
			expect(filterEpics(epics, { query: "docs", includeClosed: true }).map((epic) => epic.id)).toEqual([docs.id]);
			expect(filterEpics(epics, {}).map((epic) => epic.id)).toEqual([platform.id]);
		});
	});
});
