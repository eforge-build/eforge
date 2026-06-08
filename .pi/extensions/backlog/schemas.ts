import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { PRIORITY_VALUES, SOURCE_VALUES, STATUS_VALUES } from "./store";

export const AddParams = Type.Object({
	title: Type.String({ description: "Short title for the backlog item" }),
	claim: Type.Optional(Type.String({ description: "What should be remembered or investigated" })),
	evidence: Type.Optional(Type.String({ description: "Evidence, source, or why this matters" })),
	tags: Type.Optional(Type.Array(Type.String())),
	dependsOn: Type.Optional(Type.Array(Type.String(), { description: "Backlog item IDs this item depends on" })),
	epic: Type.Optional(Type.String({ description: "Local backlog epic ID this item belongs to" })),
	priority: Type.Optional(StringEnum(PRIORITY_VALUES)),
	source: Type.Optional(StringEnum(SOURCE_VALUES)),
	staleAfter: Type.Optional(Type.String({ description: "YYYY-MM-DD date when this item should be rechecked" })),
});

export const ListParams = Type.Object({
	status: Type.Optional(StringEnum(STATUS_VALUES)),
	query: Type.Optional(Type.String()),
	tag: Type.Optional(Type.String()),
	epic: Type.Optional(Type.String({ description: "Only include items linked to this local backlog epic ID" })),
	includeClosed: Type.Optional(Type.Boolean()),
	readyOnly: Type.Optional(Type.Boolean({ description: "Only include open items not blocked by dependencies" })),
	blockedOnly: Type.Optional(Type.Boolean({ description: "Only include open items blocked by dependencies" })),
});

export const ShowParams = Type.Object({ id: Type.String() });

const RecommendationItemRefParams = Type.Object({
	id: Type.String({ description: "Backlog item ID" }),
	title: Type.Optional(Type.String()),
	rationale: Type.Optional(Type.String()),
}, { additionalProperties: false });

export const RecommendationsParams = Type.Object({
	recommendations: Type.Object({
		schemaVersion: Type.Literal(1),
		refreshedAt: Type.String({ description: "YYYY-MM-DD date or ISO timestamp" }),
		summary: Type.Optional(Type.String()),
		activeWork: Type.Array(RecommendationItemRefParams),
		readyCandidates: Type.Array(RecommendationItemRefParams),
		recommendedNextSequence: Type.Array(Type.Object({
			id: Type.String({ description: "Backlog item ID" }),
			rank: Type.Integer({ minimum: 1 }),
			title: Type.Optional(Type.String()),
			rationale: Type.Optional(Type.String()),
			dependenciesSatisfied: Type.Optional(Type.Array(Type.String())),
		}, { additionalProperties: false })),
		safeParallelizableGroups: Type.Array(Type.Object({
			name: Type.String(),
			itemIds: Type.Array(Type.String()),
			rationale: Type.Optional(Type.String()),
			cautions: Type.Optional(Type.Array(Type.String())),
		}, { additionalProperties: false })),
		blockedChains: Type.Array(Type.Object({
			itemId: Type.String(),
			blockedBy: Type.Array(Type.String()),
			nextUnblockAction: Type.Optional(Type.String()),
			rationale: Type.Optional(Type.String()),
		}, { additionalProperties: false })),
		rationaleAndAssumptions: Type.Array(Type.String()),
	}, { additionalProperties: false }),
});

export const UpdateParams = Type.Object({
	id: Type.String(),
	status: Type.Optional(StringEnum(STATUS_VALUES)),
	priority: Type.Optional(StringEnum(PRIORITY_VALUES)),
	claim: Type.Optional(Type.String()),
	addEvidence: Type.Optional(Type.String({ description: "Concise durable evidence only; omit for freshness-only rechecks." })),
	addRecheck: Type.Optional(Type.String()),
	tags: Type.Optional(Type.Array(Type.String())),
	dependsOn: Type.Optional(Type.Array(Type.String(), { description: "Replace dependency list with these backlog item IDs" })),
	addDependsOn: Type.Optional(Type.Array(Type.String(), { description: "Add backlog item IDs as dependencies" })),
	removeDependsOn: Type.Optional(Type.Array(Type.String(), { description: "Remove backlog item IDs from dependencies" })),
	epic: Type.Optional(Type.String({ description: "Local backlog epic ID to set; pass an empty string to clear" })),
	lastChecked: Type.Optional(Type.String({ description: "YYYY-MM-DD date" })),
	staleAfter: Type.Optional(Type.String({ description: "YYYY-MM-DD date" })),
});

export const EpicAddParams = Type.Object({
	title: Type.String({ description: "Short title for the local backlog epic" }),
	goal: Type.Optional(Type.String({ description: "What the epic should accomplish" })),
	evidence: Type.Optional(Type.String({ description: "Evidence, source, or why this epic matters" })),
	tags: Type.Optional(Type.Array(Type.String())),
	priority: Type.Optional(StringEnum(PRIORITY_VALUES)),
	source: Type.Optional(StringEnum(SOURCE_VALUES)),
	staleAfter: Type.Optional(Type.String({ description: "YYYY-MM-DD date when this epic should be rechecked" })),
});

export const EpicListParams = Type.Object({
	status: Type.Optional(StringEnum(STATUS_VALUES)),
	query: Type.Optional(Type.String()),
	tag: Type.Optional(Type.String()),
	includeClosed: Type.Optional(Type.Boolean()),
});

export const EpicShowParams = Type.Object({ id: Type.String() });

export const EpicUpdateParams = Type.Object({
	id: Type.String(),
	status: Type.Optional(StringEnum(STATUS_VALUES)),
	priority: Type.Optional(StringEnum(PRIORITY_VALUES)),
	goal: Type.Optional(Type.String()),
	addEvidence: Type.Optional(Type.String()),
	addRecheck: Type.Optional(Type.String()),
	tags: Type.Optional(Type.Array(Type.String())),
	lastChecked: Type.Optional(Type.String({ description: "YYYY-MM-DD date" })),
	staleAfter: Type.Optional(Type.String({ description: "YYYY-MM-DD date" })),
});

export const EpicLinkParams = Type.Object({
	itemId: Type.String({ description: "Backlog item ID to link or unlink" }),
	epicId: Type.Optional(Type.String({ description: "Local backlog epic ID to link; omit or pass empty string to unlink" })),
});
