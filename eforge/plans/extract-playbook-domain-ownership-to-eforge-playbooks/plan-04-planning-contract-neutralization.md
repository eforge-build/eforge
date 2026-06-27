---
id: plan-04-planning-contract-neutralization
name: Remove playbookDraft and playbook-specific planning capability/contracts
  from client, monitor, and eforge-plan planning task surfaces.
branch: extract-playbook-domain-ownership-to-eforge-playbooks/planning-contract-neutralization
---

# Planning Contract Neutralization

## Architecture Reference

This module implements the `Module: planning-contract-neutralization` section, `Core architectural principles` items 5 and 6, the `planning-contract-neutralization → playbook-domain-extraction` integration contract, and technical decisions 4, 5, and 6 from the architecture.

Key constraints from architecture:
- Remove `playbookDraft` from client, monitor, eforge-plan task, and eforge-plan workstation contracts; do not replace it with a generic artifact envelope in this module.
- Remove the playbook-named `eforge.plan.planning-mode-playbook` capability from eforge-plan; eforge-plan exposes only generic planning entry/workstation capability metadata.
- Depend on `playbook-domain-extraction` having moved eforge-playbooks planning-mode checks to the generic `eforge.plan.planning-workstation >=1.0.0` capability.
- Bump the daemon API version because removing `playbookDraft` is a breaking daemon/client task wire-contract change.
- Keep this module inside the architecture-owned file set: `packages/client/src/extension-agent-tasks.ts`, the client API version constant, monitor agent-task helpers, and `eforge/extensions/eforge-plan/**`.
- Leave source-wide boundary allowlists, public docs regeneration, host facades, and eforge-playbooks domain behavior to their owning modules.

## Scope

### In Scope
- Remove the `playbookDraft` requested-output literal, schema, result alternatives, optional result properties, type export, and output-section helper branch from `@eforge-build/client` extension-agent-task contracts.
- Bump `DAEMON_API_VERSION` and record the version-history reason for the breaking removal.
- Remove monitor output counting for `playbookDraft` and rely on the updated client parser for daemon task storage validation.
- Remove `playbookDraft` from eforge-plan action input schemas, agent-task submission tool schema, prompt template guidance, list compaction logic, workstation types, workstation fixture data, and workstation auto-apply checks.
- Remove eforge-plan's `eforge.plan.planning-mode-playbook` package capability and replace planning-entry descriptions with generic planning workstation wording.
- Update module-owned tests for accepted planning result variants, rejection of the removed draft field, output-section counts, list compaction, workstation behavior, and generic capability registration.
- Update `eforge/extensions/eforge-plan/README.md` for the capability and planning-entry wording owned by this module.

### Out of Scope
- Updating `eforge/extensions/eforge-playbooks/**`; the dependency module owns switching playbooks to `eforge.plan.planning-workstation`.
- Deleting playbook helpers from `@eforge-build/input`; that belongs to `input-neutrality`.
- Removing CLI, MCP, Pi, Claude plugin, Console, or docs-generator host playbook facades; that belongs to `host-surface-neutrality`.
- Adding a new generic artifact draft envelope or preserving a compatibility shim for removed `playbookDraft` task records.
- Adding source-wide boundary tests, public website content updates, generated reference artifacts, or neutral-example sweeps outside this module's file set; that belongs to `boundary-docs-validation`.
- Renaming eforge-plan action IDs such as `planning-draft`, `session-plan-creation`, `open-planning-entry`, or `planning-workstation`.

## Implementation Approach

### Overview

Remove the task field at the wire-contract owner first, then update each producer and consumer that still emits, accepts, counts, or displays it. The sequence is:

1. Narrow `@eforge-build/client` schemas and types so stale producers receive TypeScript and runtime validation failures.
2. Bump the daemon API version in the browser-safe version constant.
3. Remove monitor counting of the deleted output; monitor persistence already validates through the client parser, so completed records carrying the removed field fail validation instead of being stored as successful task results.
4. Remove eforge-plan producer paths: action schemas, submit-tool schema, prompt text, task contribution descriptions, list compaction checks, package capabilities, README capability docs, integration command/deep-link descriptions, and workstation TypeScript/fixtures/UI checks.
5. Update module-owned tests using split-string construction for removed field names where a test must assert rejection, so source-wide literal searches for `playbookDraft` and `planning-mode-playbook` can return zero after this module.

### Key Decisions

1. **Delete the field instead of genericizing it.** The source architecture states that no non-playbook artifact draft feature is needed. The remaining accepted result sections are `recommendations`, `backlogCurationDraft`, `handoffDraft`, `handoffDrafts`, `planDrafts`, `sessionPlanPatch`, `sessionPlanCreationDraft`, and `planRevisionTurn`.
2. **No migration for stale task records.** Existing daemon task JSON containing the removed field is outside the new contract. `readAgentTaskRecord` and `writeAgentTaskRecord` already validate through `parseExtensionAgentTaskRecord`; after the client schema change, stale records fail validation or appear stale through eforge-plan list flows that catch task-read failures.
3. **Bump the actual version constant file.** The architecture names `packages/client/src/api-version.ts`, but the numeric constant now lives in `packages/client/src/api-version-const.ts` and is re-exported by `api-version.ts`. Update `api-version-const.ts`.
4. **Keep eforge-plan planning entry generic.** Package capabilities list only `eforge.plan.planning-workstation`; integration command and deep-link descriptions mention planning entry/workstation continuation without any playbook-named wording.
5. **Keep eforge-plan start-action section restrictions.** `StartPlanningAgentRequestedOutputSectionSchema` remains the narrower host-facing set for `start-planning-agent-task`; remove only the deleted section literal and leave curation/revision starts on their existing dedicated paths.
6. **Avoid raw removed tokens in new/updated tests.** When a test must construct the deleted property name, use `['play', 'book', 'Draft'].join('')`; also construct the deleted type export and capability names from segments. This keeps simple source audits useful.

## Files

### Create
- `packages/client/src/__tests__/extension-agent-task-contract-neutrality.test.ts` — focused client contract tests that construct the removed draft field and type-export names from split strings, assert `requestedOutputSections` rejects the field, assert results carrying only that field or carrying it in addition to accepted sections fail parsing, assert completed records with the field fail validation, and assert runtime client exports omit the removed type name.
- `eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts` — focused eforge-plan tests that construct the removed section name from split strings, assert `StartPlanningAgentTaskInputSchema` rejects it, assert `createPlanningDraftSubmitTool()` rejects a submission carrying it, and assert rendered planning prompt text omits the removed output section.

### Modify
- `packages/client/src/extension-agent-tasks.ts` — remove the deleted requested-output literal, `EforgePlanPlanningPlaybookDraftSchema`, all `playbookDraft` result properties and the pure draft result variant, the `EforgePlanPlanningPlaybookDraft` type export, and the helper branch in `hasEforgePlanPlanningDraftOutputSection` `[region: planning-contract-neutralization, planning draft task schema and helper block]`.
- `packages/client/src/api-version-const.ts` — bump `DAEMON_API_VERSION` from `77` to `78` and add a v78 history note for removing the planning-task `playbookDraft` wire field `[region: planning-contract-neutralization, DAEMON_API_VERSION history and constant]`.
- `packages/client/src/__tests__/extension-agent-tasks.test.ts` — update accepted-result coverage to enumerate only remaining result sections and, if not covered by the new focused test, add split-string rejection assertions for the removed requested-output section `[region: planning-contract-neutralization, extension agent task contract tests]`.
- `packages/monitor/src/routes/extensions/agent-task-service-helpers.ts` — remove the `playbookDraft` contribution from `countOutputSections`; keep counts for recommendations, backlog curation, handoff drafts, plan drafts, session-plan patches, session-plan creation drafts, and plan revision turns `[region: planning-contract-neutralization, countOutputSections]`.
- `packages/monitor/src/__tests__/routes-extension-agent-tasks.test.ts` — add a daemon task test that submits a result containing the removed draft field name via split-string construction, waits for `status: "failed"`, verifies `result` is absent, and verifies the persisted error comes from schema validation `[region: planning-contract-neutralization, extension agent task route tests]`.
- `eforge/extensions/eforge-plan/planning-agent-task-schemas.ts` — remove the deleted literal from `StartPlanningAgentRequestedOutputSectionSchema`; downstream `PlanningAgentRequestedOutputSectionSchema` narrows automatically through the client import. Keep apply-selection schemas unchanged because eforge-plan never had an apply path for this draft field.
- `eforge/extensions/eforge-plan/planning-agent-tools.ts` — remove the deleted property from `planningDraftSubmissionToolSchema`; `parseEforgePlanPlanningDraftResult` then rejects submitted payloads containing the field through `additionalProperties: false`.
- `eforge/extensions/eforge-plan/agent-task-contributions.ts` — update the `planning-draft` contribution description to list generic planning outputs without the removed draft type.
- `eforge/extensions/eforge-plan/agent-task-actions.ts` — remove the `record.playbookDraft` branch from `shouldOmitTaskResultFromList`; keep omission for large recommendation, backlog-curation, and plan-draft payloads.
- `eforge/extensions/eforge-plan/prompts/eforge-plan-planning-draft.md` — remove the `playbookDraft` bullet from the output contract and keep the ready-result guidance focused on the remaining result sections.
- `eforge/extensions/eforge-plan/package.json` — remove the `eforge.plan.planning-mode-playbook` capability declaration; keep `eforge.plan.planning-workstation` version `1.0.0` as the sole declared capability.
- `eforge/extensions/eforge-plan/index.ts` — change the `open-planning-entry` integration command and `planning-workstation` deep-link descriptions from planning-mode playbook continuation wording to generic planning entry/workstation wording.
- `eforge/extensions/eforge-plan/README.md` — update the overview if it mentions playbooks, change the declared capability section to one generic planning workstation capability, and replace planning-mode playbook host guidance with generic contribution/deep-link guidance.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts` — delete `PlanningTaskPlaybookDraft` and the `PlanningTaskResult.playbookDraft` property.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/fixtures/mock-data.ts` — remove the draft fixture from `mockPlanningTask.result` and adjust any fixture `outputSectionCount` or snapshot expectations affected by the new count.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/use-planning-task-workflows.ts` — remove the deleted field from `hasOtherApplyableResultOutputs` so auto-apply eligibility depends only on remaining result outputs.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/use-planning-task-workflows.test.tsx` — remove the non-eligible playbook-draft case and keep non-eligible coverage for recommendations, curation, handoff, patch, plan revision, plan drafts, malformed drafts, applied tasks, stale tasks, and multi-output creation tasks.
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` — expect only `eforge.plan.planning-workstation` in package metadata and assert the removed capability name is absent using split-string construction; update description expectations if they inspect integration commands or deep links.
- `eforge/extensions/eforge-plan/__tests__/planner-agent-task-actions.test.ts` — remove the `playbookDraft` compaction case and narrow the local requested-output-section test type to the remaining sections used by the cases.

### Shared File and Region Notes

The architecture assigns `packages/client/src/extension-agent-tasks.ts`, monitor agent-task helpers, and `eforge/extensions/eforge-plan/**` exclusively to this module, so source edit region markers are not required for implementation. The `[region: planning-contract-neutralization, ...]` tags above document ownership for parallel builders.

`packages/client/src/api-version-const.ts` is the current home of `DAEMON_API_VERSION`; it is adjacent to the architecture-listed `api-version.ts` re-export and belongs to this module's API-version bump. If another module changes the API version before implementation, keep a single numeric bump above the merged previous value and preserve both version-history notes.

No `pnpm-lock.yaml` change is expected because this module does not add or remove package dependencies.

## Testing Strategy

### Unit Tests
- Client contract tests cover accepted requested-output sections, rejected removed requested-output section, accepted result variants without the removed field, rejected result payloads that include the removed field, rejected completed task records that include the field, and absence of the removed type export from runtime barrels.
- Eforge-plan schema/tool tests cover `StartPlanningAgentTaskInputSchema` rejection of the removed requested-output section and submit-tool rejection of payloads containing the removed field.
- eforge-plan registration tests cover the single generic planning workstation capability and absence of the removed capability.
- Workstation hook tests cover auto-apply eligibility after removing the deleted field from the "other outputs" check.

### Integration Tests
- Monitor route tests cover a background task whose submitted result contains the removed field, ending in a failed task record with no stored `result`.
- Existing eforge-plan action tests cover list projection and compact-result behavior for remaining heavy outputs.
- Existing eforge-plan workstation tests cover fixture rendering after the removed field disappears from `PlanningTaskResult`.

## Verification

- [ ] `rg "playbookDraft|PlanningPlaybookDraft|planning-mode-playbook" packages/client packages/monitor eforge/extensions/eforge-plan -g '*.ts' -g '*.tsx' -g '*.md' -g 'package.json'` prints no lines.
- [ ] `rg "DAEMON_API_VERSION = 78|v78" packages/client/src/api-version-const.ts` prints both the updated constant and a v78 history note.
- [ ] `pnpm vitest run packages/client/src/__tests__/extension-agent-tasks.test.ts packages/client/src/__tests__/extension-agent-task-contract-neutrality.test.ts packages/client/src/__tests__/extension-agent-task-creation-draft.test.ts packages/client/src/__tests__/extension-agent-task-curation-draft.test.ts packages/client/src/__tests__/extension-agent-task-plan-revision.test.ts` exits 0.
- [ ] `pnpm vitest run packages/monitor/src/__tests__/routes-extension-agent-tasks.test.ts packages/monitor/src/__tests__/routes-extension-agent-task-plan-revision.test.ts` exits 0.
- [ ] `pnpm vitest run eforge/extensions/eforge-plan/__tests__/registration.test.ts eforge/extensions/eforge-plan/__tests__/planner-agent-task-actions.test.ts eforge/extensions/eforge-plan/__tests__/planning-agent-task-contract-neutrality.test.ts` exits 0.
- [ ] `pnpm --filter @eforge-build/eforge-plan-workstation test` exits 0.
- [ ] `pnpm --filter @eforge-build/client type-check` exits 0.
- [ ] `pnpm --filter @eforge-build/monitor type-check` exits 0.
- [ ] `pnpm --filter @eforge-build/eforge-plan type-check` exits 0.
- [ ] `pnpm --filter @eforge-build/eforge-plan-workstation type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.

<build-config>
{
  "build": ["test-write", ["implement", "doc-author"], "test-cycle", "doc-sync", "review-cycle"],
  "review": {
    "strategy": "auto",
    "perspectives": ["code", "api"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>

## Recovery Guidance

- Failed PRD: "extract-playbook-domain-ownership-to-eforge-playbooks"
- Root failed plan: "[REDACTED_HIGH_ENTROPY]"
- Failure summary: "Compiled plan artifacts are eligible for continue-and-repair for extract-playbook-domain-ownership-to-eforge-playbooks. artifact source: feature-branch; 8 landed commit(s); failing plan: [REDACTED_HIGH_ENTROPY]; feature branch: eforge/extract-playbook-domain-ownership-to-eforge-playbooks. Queue the failed PRD through the compiled-artifact recovery path so preserved work is reused and the remaining build can be repaired without generating a successor PRD."
- Failure detail: "Review cycle exhausted 3 round(s) without a final evaluation verdict."
- Failure detail: "Review cycle exhausted 3 round(s) without a final evaluation verdict."
- Recommended action: "Continue and repair build (Continue build): run `eforge continue-repair extract-playbook-domain-ownership-to-eforge-playbooks`. This queues the failed PRD through the compiled-artifact repair path and reuses preserved work; do not generate a successor PRD."
- Remaining work:
  - "Repair and complete [REDACTED_HIGH_ENTROPY] using preserved compiled artifacts."
  - "Unblock and run plan-05-boundary-docs-validation after plan-04 is repaired."
  - "Run required validation: pnpm type-check, pnpm build, pnpm test, and pnpm maintainability:check."
- Retry/resume guidance: Continue [REDACTED_HIGH_ENTROPY] for failed PRD extract-playbook-domain-ownership-to-eforge-playbooks from the preserved compiled artifacts; do not restart dependency-satisfied work that is already landed or complete.
- Sidecar generated at: 2026-06-27T01:21:54.048Z
- Source sidecar: .eforge/queue/failed/extract-playbook-domain-ownership-to-eforge-playbooks.recovery.json
- Source identity: prdId=extract-playbook-domain-ownership-to-eforge-playbooks; setName=extract-playbook-domain-ownership-to-eforge-playbooks; featureBranch=eforge/extract-playbook-domain-ownership-to-eforge-playbooks; baseBranch=main
