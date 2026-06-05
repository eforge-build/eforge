import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RECOMMENDATIONS_RELATIVE_PATH, buildRecommendationIndex, buildRecommendationInstructions, normalizeRecommendations, recommendationsPath, renderRecommendationsHtml, writeRecommendations, type BacklogRecommendations } from "./recommendations";

async function withTempBacklog<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
	const cwd = await mkdtemp(join(tmpdir(), "backlog-recommendations-"));
	try {
		return await fn(cwd);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
}

function recommendations(input: Partial<BacklogRecommendations> = {}): BacklogRecommendations {
	return {
		schemaVersion: 1,
		refreshedAt: "2026-06-05",
		activeWork: [],
		readyCandidates: [],
		recommendedNextSequence: [],
		safeParallelizableGroups: [],
		blockedChains: [],
		rationaleAndAssumptions: [],
		...input,
	};
}

describe("backlog recommendations", () => {
	it("writes structured volatile recommendations JSON under .backlog", async () => {
		await withTempBacklog(async (cwd) => {
			const result = await writeRecommendations(cwd, recommendations({
				recommendedNextSequence: [{ rank: 2, id: "backlog-2026-06-05-b" }, { rank: 1, id: "backlog-2026-06-05-a" }],
			}));
			const parsed = JSON.parse(await readFile(recommendationsPath(cwd), "utf8")) as BacklogRecommendations;

			expect(result.relativePath).toBe(RECOMMENDATIONS_RELATIVE_PATH);
			expect(result.path).toBe(join(cwd, ".backlog", "recommendations.json"));
			expect(parsed.schemaVersion).toBe(1);
			expect(parsed.recommendedNextSequence.map((entry) => entry.rank)).toEqual([1, 2]);
		});
	});

	it("normalizes missing optional structured content", () => {
		expect(normalizeRecommendations(recommendations({ refreshedAt: "" })).refreshedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(normalizeRecommendations(recommendations({ summary: "  Custom  " })).summary).toBe("Custom");
	});

	it("builds analyze-all instructions for strict structured recommendations", () => {
		const instructions = buildRecommendationInstructions("2026-06-05");

		expect(instructions).toContain("backlog_write_recommendations");
		expect(instructions).toContain(RECOMMENDATIONS_RELATIVE_PATH);
		expect(instructions).toContain('"safeParallelizableGroups"');
		expect(instructions).toContain('"rationaleAndAssumptions"');
	});

	it("indexes per-item rank, lanes, and unblock actions for board annotations", () => {
		const index = buildRecommendationIndex(recommendations({
			recommendedNextSequence: [{ rank: 2, id: "backlog-2026-06-05-a" }],
			safeParallelizableGroups: [
				{ name: "Lane A", itemIds: ["backlog-2026-06-05-a"] },
				{ name: "Lane B", itemIds: ["backlog-2026-06-05-a", "backlog-2026-06-05-b"] },
			],
			blockedChains: [{ itemId: "backlog-2026-06-05-b", blockedBy: ["backlog-2026-06-05-a"], nextUnblockAction: "Ship A first" }],
		}));

		expect(index.rankById.get("backlog-2026-06-05-a")).toBe(2);
		expect(index.lanesById.get("backlog-2026-06-05-a")).toEqual(["Lane A", "Lane B"]);
		expect(index.unblockById.get("backlog-2026-06-05-b")).toBe("Ship A first");
	});

	it("returns empty index when recommendations are absent", () => {
		const index = buildRecommendationIndex(undefined);
		expect(index.rankById.size).toBe(0);
		expect(index.lanesById.size).toBe(0);
		expect(index.unblockById.size).toBe(0);
	});

	it("renders recommendations for the generated HTML view", () => {
		const html = renderRecommendationsHtml(recommendations({
			summary: "Plan the next work.",
			recommendedNextSequence: [{ rank: 1, id: "backlog-2026-06-05-a", title: "A", rationale: "highest leverage" }],
		}));

		expect(html).toContain("Plan the next work.");
		expect(html).toContain("Recommended next sequence");
		expect(html).toContain("#item-backlog-2026-06-05-a");
	});
});
