# eforge-plan Prompt Source Audit

Migration artifact for `plan-03-backlog-curation-prompts-and-engine-removal`.

## Original engine prompt files

- `packages/engine/src/prompts/eforge-plan-planning-draft.md` — original model-facing prompt for planning drafts, revision turns, session-plan creation drafts, recommendation refreshes, and generic backlog curation output.
- `packages/engine/src/prompts/eforge-plan-backlog-curation-item-audit.md` — original map item-audit prompt for one bounded backlog item packet.
- `packages/engine/src/prompts/eforge-plan-backlog-curation-reducer.md` — original map/reduce reducer prompt for compact curation outcomes.

## Original engine/daemon selection and loading paths

- `packages/engine/src/agents/extension-planning-task.ts` — selected `eforge-plan-planning-draft` and loaded it with `loadPrompt(...)` while wiring the planning submit/progress tools.
- `packages/engine/src/agents/backlog-curation-map-reduce.ts` — selected and loaded `eforge-plan-backlog-curation-item-audit` and `eforge-plan-backlog-curation-reducer`, owned item finding submission validation, reducer input compaction, reducer submit validation, repair retry, and bounded `needs-input` fallback behavior.
- `packages/monitor/src/routes/extensions/agent-task-service.ts` — dispatched legacy `eforge-plan.planning-draft` requests, resolved deferred source providers, and routed structured curation sources to the map/reduce runner.
- `packages/monitor/src/routes/extensions/backlog-curation-map-reduce-runner.ts` — imported the old engine curation runners for item audit and reducer attempts.

## eforge-plan action paths that selected planning task kinds

- `eforge/extensions/eforge-plan/agent-task-actions.ts` — selected owner-scoped planning task contribution ids for generic planning task starts and redrafts.
- `eforge/extensions/eforge-plan/recommendation-refresh.ts` — selected the recommendation refresh planning contribution.
- `eforge/extensions/eforge-plan/backlog-curation-actions.ts` — selected the backlog curation source provider and requested curation/recommendation output sections.
- `eforge/extensions/eforge-plan/plan-revision-actions.ts` — selected plan-revision planning task starts for revision turns.

## Relocated asset owners

- `eforge/extensions/eforge-plan/prompts/eforge-plan-planning-draft.md`
- `eforge/extensions/eforge-plan/prompts/eforge-plan-backlog-curation-item-audit.md`
- `eforge/extensions/eforge-plan/prompts/eforge-plan-backlog-curation-reducer.md`

After this migration, model-facing eforge-plan prompts are extension-owned assets resolved through registered task contributions. The engine prompt directory must not contain `eforge-plan-*.md`, and engine agent code must not load `eforge-plan` prompt ids.
