import { describe, expect, it } from "vitest";
import { buildAnalyzeAllPrompt, buildAnalyzePrompt } from "./prompts";

describe("backlog prompt builders", () => {
	it("treats freshness-only checks as metadata updates, not evidence logs", () => {
		const prompt = buildAnalyzePrompt("backlog-2026-06-08-example");

		expect(prompt).toContain("update only lastChecked and staleAfter");
		expect(prompt).toContain("do not add Evidence just to say it was rechecked");
		expect(prompt).toContain("add Evidence only for durable signal");
		expect(prompt).toContain("one concise bullet per item");
		expect(prompt).not.toContain("use backlog_update with evidence for any status");
	});

	it("keeps analyze-all recommendations while preserving low-noise freshness guidance", () => {
		const prompt = buildAnalyzeAllPrompt();

		expect(prompt).toContain("backlog_write_recommendations");
		expect(prompt).toContain("when the item is still valid and nothing material changed");
		expect(prompt).toContain("do not add Evidence just to say it was rechecked");
	});
});
