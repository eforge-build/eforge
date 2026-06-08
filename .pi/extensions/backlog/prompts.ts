import { buildRecommendationInstructions } from "./recommendations";
import { sectionContent, today, type BacklogItem } from "./store";

const ANALYZE_ALL_SCOPE = "Analyze every open backlog item.";

export function buildPromotePrompt(item: BacklogItem): string {
	const claim = sectionContent(item.body, "Claim");
	return `/eforge:plan ${item.title}\n\nBacklog source: ${item.id}\n\nClaim:\n${claim || "TBD"}\n\nUse the backlog item at .backlog/items/${item.id}.md as context. Validate assumptions before marking the plan ready.`;
}

function buildAnalyzeInstructions(scope: string): string {
	return `${scope}\n\nAnalyze backlog staleness semantically, not by date alone. The stale_after field is only a review reminder.\n\nFor each item you analyze:\n- call backlog_show before changing it;\n- use last_checked, updated, or created as the start point for git/history inspection;\n- inspect recent git history, docs, and relevant code when cheap;\n- decide whether the item is still valid, shipped, superseded, genuinely stale, blocked, or needs claim/tag/dependency/status updates;\n- use backlog_update for any status, claim, tag, dependency, lastChecked, or staleAfter changes;\n- when the item is still valid and nothing material changed, update only lastChecked and staleAfter; do not add Evidence just to say it was rechecked;\n- add Evidence only for durable signal: shipped/superseded/stale decisions, changed blockers/dependencies/tags/claims, or meaningful newly discovered implementation state;\n- keep any fresh Evidence to one concise bullet per item, and do not repeat older evidence or generic \"still valid\" boilerplate;\n- if still valid, set lastChecked to ${today()} and choose a future staleAfter/review date;\n- do not enqueue builds.\n\nStart with backlog_list includeClosed=false unless a specific item ID is provided.`;
}

export function buildAnalyzePrompt(id: string): string {
	return buildAnalyzeInstructions(`Analyze backlog item ${id}.`);
}

export function buildAnalyzeAllPrompt(): string {
	return `${buildAnalyzeInstructions(ANALYZE_ALL_SCOPE)}\n\n${buildRecommendationInstructions()}\n\nAfter the analysis turn completes, the backlog extension will automatically run the equivalent of /backlog html to refresh and open the local HTML view.`;
}

export function messagesContainAnalyzeAllPrompt(messages: unknown): boolean {
	return textFromUnknown(messages).includes(ANALYZE_ALL_SCOPE);
}

function textFromUnknown(value: unknown): string {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) return value.map(textFromUnknown).join("\n");
	if (!value || typeof value !== "object") return "";
	const record = value as Record<string, unknown>;
	return [record.text, record.content, record.message].map(textFromUnknown).filter(Boolean).join("\n");
}
