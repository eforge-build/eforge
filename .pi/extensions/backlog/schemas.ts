import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { PRIORITY_VALUES, SOURCE_VALUES, STATUS_VALUES } from "./store";

export const AddParams = Type.Object({
	title: Type.String({ description: "Short title for the backlog item" }),
	claim: Type.Optional(Type.String({ description: "What should be remembered or investigated" })),
	evidence: Type.Optional(Type.String({ description: "Evidence, source, or why this matters" })),
	tags: Type.Optional(Type.Array(Type.String())),
	dependsOn: Type.Optional(Type.Array(Type.String(), { description: "Backlog item IDs this item depends on" })),
	priority: Type.Optional(StringEnum(PRIORITY_VALUES)),
	source: Type.Optional(StringEnum(SOURCE_VALUES)),
	staleAfter: Type.Optional(Type.String({ description: "YYYY-MM-DD date when this item should be rechecked" })),
});

export const ListParams = Type.Object({
	status: Type.Optional(StringEnum(STATUS_VALUES)),
	query: Type.Optional(Type.String()),
	tag: Type.Optional(Type.String()),
	includeClosed: Type.Optional(Type.Boolean()),
	readyOnly: Type.Optional(Type.Boolean({ description: "Only include open items not blocked by dependencies" })),
	blockedOnly: Type.Optional(Type.Boolean({ description: "Only include open items blocked by dependencies" })),
});

export const ShowParams = Type.Object({ id: Type.String() });

export const UpdateParams = Type.Object({
	id: Type.String(),
	status: Type.Optional(StringEnum(STATUS_VALUES)),
	priority: Type.Optional(StringEnum(PRIORITY_VALUES)),
	claim: Type.Optional(Type.String()),
	addEvidence: Type.Optional(Type.String()),
	addRecheck: Type.Optional(Type.String()),
	tags: Type.Optional(Type.Array(Type.String())),
	dependsOn: Type.Optional(Type.Array(Type.String(), { description: "Replace dependency list with these backlog item IDs" })),
	addDependsOn: Type.Optional(Type.Array(Type.String(), { description: "Add backlog item IDs as dependencies" })),
	removeDependsOn: Type.Optional(Type.Array(Type.String(), { description: "Remove backlog item IDs from dependencies" })),
	epic: Type.Optional(Type.String()),
	lastChecked: Type.Optional(Type.String({ description: "YYYY-MM-DD date" })),
	staleAfter: Type.Optional(Type.String({ description: "YYYY-MM-DD date" })),
});
