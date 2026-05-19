---
title: Investigation-First Planning Playbook Invocation Semantics
created: 2026-05-19
profile: gpt-claude-combo
---

# Investigation-First Planning Playbook Invocation Semantics

## Problem / Motivation

Current `mode: planning` playbook invocation is semantically wrong in two related ways:

1. Pi native `/eforge:playbook` Run calls the daemon directly and, when the daemon returns `kind: "planning"`, only reports that a session file was created. It does not start or continue the interactive planning conversation.
2. The daemon creates that session file by mechanically copying the playbook's Goal/Out of scope/Acceptance criteria/Notes into the plan. For investigation-oriented planning playbooks such as `complexity-hotspot-reduction`, that means the plan file describes the investigation process instead of containing the investigation results and concrete action items.

User-stated requirement: planning playbooks imply user interactivity and agent judgment. Running a planning playbook should not be a daemon-only operation. The agent should read the playbook, perform the investigation it describes, then use the findings to seed/start interactive `/eforge:plan` planning.

Evidence gathered during planning:

- Project architecture/conventions from `AGENTS.md` say reusable input artifacts live in `@eforge-build/input`, daemon HTTP contracts live in `@eforge-build/client`, and wrapper-app workflow orchestration belongs outside the engine. This strongly suggests planning-playbook invocation semantics should be defined at the daemon/client/Pi/Claude integration boundary, not in the engine build pipeline.
- Roadmap alignment: `docs/roadmap.md` has a future **Low-fidelity input handling** item for launching exploration agents before compiling plans. Planning playbooks are a more explicit, reusable variant of that same integration/maturity gap: the user provides a reusable investigation recipe, and the agent should explore before producing the plan.
- Current Pi native `/eforge:playbook` Run flow (`packages/pi-eforge/extensions/eforge/playbook-commands.ts`) always calls `apiPlaybookRunIfRunning`. When the daemon returns `kind: "planning"`, it only displays “Open `/eforge:plan` to continue” and does not start `/skill:eforge-plan --resume` or run any investigation.
- Current daemon route `POST /api/playbook/run` (`packages/monitor/src/server.ts`) handles `mode: planning` by calling `createSessionPlanFromPlaybookSeed` and writing a session plan immediately. It performs no agent work, code exploration, or command execution.
- Current `POST /api/session-plan/create-from-playbook` uses the same static seed helper, so both direct playbook-run and plan-seed paths can create a plan whose body is the playbook instructions rather than investigation results.
- `createSessionPlanFromPlaybookSeed` in `packages/input/src/session-plan.ts` is intentionally mechanical: it copies Goal, Out of scope, Acceptance criteria, and Notes for the planner into a session plan with `planning_type: unknown`, empty dimension lists, and `seeded_from_playbook`.
- `playbookToPlanSeed` in `packages/input/src/playbook.ts` likewise only maps playbook sections into seed sections. It has no concept of an investigation transcript, selected targets, evidence, or action items.
- The bundled `eforge/playbooks/complexity-hotspot-reduction.md` demonstrates the mismatch: its Goal says to run `pnpm complexity:scan`, inspect top hotspot source, apply a decision rule, and produce a concrete refactor plan. Static seeding turns those instructions into the session file instead of executing them first.
- Current Pi/Claude playbook skill docs describe planning mode as “daemon creates a session-plan file with playbook content pre-populated,” then the user drives planning. That under-specifies the needed agent investigation phase.

Additional evidence:

- `packages/monitor/src/server.ts` currently handles planning mode in `POST /api/playbook/run` by calling `createSessionPlanFromPlaybookSeed` and writing a session plan immediately.
- `packages/input/src/session-plan.ts` documents and implements `createSessionPlanFromPlaybookSeed` as a static section-copy operation.
- `packages/pi-eforge/extensions/eforge/playbook-commands.ts` currently treats `kind: "planning"` as success and displays a prompt to open `/eforge:plan`, but performs no agent investigation.
- `eforge_playbook { action: "run" }` in both Pi and Claude tool layers calls `POST /api/playbook/run`, so skill instructions must change if the route becomes autonomous-only.
- `eforge_session_plan { action: "create-from-playbook" }` also calls a daemon static-seed route and has the same semantic problem when used as the primary planning-playbook flow.
- `eforge/playbooks/complexity-hotspot-reduction.md` explicitly asks the planner to run `pnpm complexity:scan`, inspect hotspots, apply a decision rule, and produce targeted refactor acceptance criteria. Static seeding cannot satisfy that workflow.

Classification: this is a **feature / focused** change with high confidence. It changes user-facing invocation semantics and API/tool contracts for planning-mode playbooks, but the scope is cohesive: define the contract, update shared route/client types, and update the Pi/Claude integrations and skills consistently.

## Goal

Planning playbooks should be investigation-first and agent-driven: the agent loads the playbook, performs the investigation it describes, then creates or updates an interactive planning session with concrete findings and action items.

The daemon should no longer treat planning-mode playbooks as daemon-runnable; `POST /api/playbook/run` should only enqueue autonomous playbooks and should return a typed `requires-agent` response for planning playbooks.

## Approach

### Core design decisions

1. **`POST /api/playbook/run` becomes autonomous-only in practice.**
   - If the resolved playbook has `mode: "autonomous"`, keep current behavior: convert to build source, enqueue, and return `{ kind: "enqueued", id }`.
   - If the resolved playbook has `mode: "planning"`, do **not** create a session plan and do **not** enqueue. Return a typed `requires-agent` response explaining that planning playbooks must be run by an interactive agent/client.
   - Preferred response shape: `{ kind: "requires-agent", mode: "planning", name, message }`.
   - This is clearer than a generic 400 because the playbook and request are valid; the daemon is just not the correct executor.

2. **The playbook skill becomes the canonical planning-mode runner.**
   - For planning playbooks, the skill should load the playbook (`show`), perform the investigation in the conversation, create a session plan (`eforge_session_plan create`), write concrete findings via `set-section`, and continue interactive planning.
   - The skill should not call `eforge_playbook { action: "run" }` for planning playbooks except as a defensive fallback path that handles `requires-agent`.

3. **Native Pi `/eforge:playbook` may still provide selection UI, but delegates planning mode.**
   - Native Run can list/select playbooks. To branch before calling daemon run, list/show data must expose `mode` to the client.
   - If selected mode is `planning`, Pi should call `/skill:eforge-playbook run <name>` rather than `apiPlaybookRunIfRunning`.
   - If a stale/third-party client calls run anyway and receives `requires-agent`, surface guidance instead of claiming a session is ready.

4. **`create-from-playbook` should be removed from the happy-path skill docs for planning playbooks.**
   - The current `eforge_session_plan { action: "create-from-playbook" }` route statically copies playbook instructions into a session plan.
   - That may remain temporarily as a low-level compatibility helper, but `/eforge:plan` and `/eforge:playbook` skills should not use it as the main planning-playbook flow.
   - If kept, docs should label it as a scratch/template operation, not “run planning playbook.”

5. **No new daemon exploration-agent system in this slice.**
   - The roadmap’s low-fidelity input handling may eventually add exploration agents, but this change should not introduce daemon-side agent orchestration.
   - Investigation happens in Pi/Claude skill context using existing read/bash/tool capabilities.

### Early assumptions / unknowns

- Assumption: planning playbook investigation should run in the conversational agent process, not in the daemon. Evidence: daemon/engine boundaries explicitly keep richer workflow orchestration in wrapper apps, and the daemon lacks an agent runtime invocation model for arbitrary interactive investigation. Confidence high.
- Assumption: `mode` needs to be available when listing playbooks so native Pi can decide whether to handle a run directly or delegate to the skill. Current list entries do not expose mode in the client type; this may require a wire-shape addition. Confidence high.
- Design question: should daemon `POST /api/playbook/run` reject/redirect planning playbooks with a new `requires-agent` response, or keep static seeding for backward compatibility while clients avoid it? This needs an explicit decision because it affects `DAEMON_API_VERSION`, CLI behavior, tests, and docs.
- Design question: should `POST /api/session-plan/create-from-playbook` remain as a low-level “create scratch seed” primitive for `/eforge:plan` path (c), or should it also be deprecated/reframed as “create investigation draft only”? This impacts both Pi and Claude plan skills.

### Code impact

Expected source changes:

- `packages/client/src/routes.ts`
  - Add a `PlaybookRunRequiresAgentResponse` union member, likely `{ kind: 'requires-agent'; mode: 'planning'; name: string; message: string }`.
  - Update `PlaybookRunResponse` to include it.
  - Bump `DAEMON_API_VERSION` in `packages/client/src/api-version.ts` because the wire response union changes.

- `packages/client/src/api/playbook.ts`
  - Expose playbook `mode` on `PlaybookListEntry` / `PlaybookData` types if not already present in the client surface.
  - Ensure save frontmatter types continue to require `mode`.

- `packages/input/src/playbook.ts`
  - Add `mode` to `PlaybookEntry` returned by `listPlaybooks` so `/api/playbook/list` can tell clients which mode each playbook uses.
  - Preserve existing validation behavior for invalid/unreadable playbooks.

- `packages/monitor/src/server.ts`
  - In `POST /api/playbook/run`, replace the planning-mode branch that calls `createSessionPlanFromPlaybookSeed` + `writeSessionPlan` with the `requires-agent` response.
  - Leave autonomous mode behavior unchanged.
  - Keep `POST /api/session-plan/create-from-playbook` only if intentionally retained as a compatibility/template helper; do not use it for playbook Run.

- `packages/pi-eforge/extensions/eforge/playbook-commands.ts`
  - When the selected playbook mode is `planning`, call `pi.sendUserMessage('/skill:eforge-playbook run <name>')` instead of `apiPlaybookRunIfRunning`.
  - Handle a `requires-agent` response defensively with guidance/delegation.

- `packages/pi-eforge/extensions/eforge/index.ts`
  - Update the `eforge_playbook` tool description/rendering for `run` to mention `requires-agent` for planning playbooks.
  - The tool can continue to proxy `run`; the skill should avoid using it for planning mode.
  - Update `eforge_session_plan` tool docs if `create-from-playbook` remains but is reframed as template/scratch.

- `packages/eforge/src/cli/mcp-proxy.ts`
  - Update MCP tool description and return handling/types for `requires-agent`.
  - Update session-plan `create-from-playbook` wording if retained.

- `packages/eforge/src/cli/playbook.ts`
  - Update `eforge playbook run` output for `requires-agent`: explain that planning playbooks must be run from an interactive agent (`/eforge:playbook` in Pi/Claude) rather than claiming a session was created.

- `packages/pi-eforge/skills/eforge-playbook/SKILL.md` and `eforge-plugin/skills/playbook/playbook.md`
  - Change planning mode semantics to investigation-first.
  - In Run branch, load/show the playbook, perform investigation, create/update session plan, and continue planning instead of calling `run` blindly.

- `packages/pi-eforge/skills/eforge-plan/SKILL.md` and `eforge-plugin/skills/plan/plan.md`
  - Change “Seed from planning-mode playbook” path to investigation-first and avoid `create-from-playbook` as the happy path.

Expected tests:

- `test/playbook.test.ts`: list entries include mode; existing mode validation/roundtrip tests remain.
- `test/playbook-api.test.ts`: `POST /api/playbook/run` returns `kind: 'enqueued'` for autonomous and `kind: 'requires-agent'` for planning, and does not create a session plan for planning.
- `test/daemon-session-plan-routes.test.ts` / `test/session-plan-from-playbook.test.ts`: update expectations if `create-from-playbook` is retained/reframed; if retained, tests should describe it as static seed/template rather than running a playbook.
- Pi/CLI type-check coverage should catch unhandled `PlaybookRunResponse` union members.

Validation commands:

```bash
pnpm type-check
pnpm test -- test/playbook.test.ts test/playbook-api.test.ts test/session-plan-from-playbook.test.ts test/daemon-session-plan-routes.test.ts
pnpm docs:check
```

Run `pnpm docs:check` if generated reference docs include route/tool descriptions.

### Assumptions and validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| Planning playbook investigation should run in the conversational agent/skill, not in the daemon. | `AGENTS.md` says wrapper-app workflow orchestration belongs outside the engine/daemon; daemon route currently has no mechanism to run arbitrary interactive investigation. User confirmed planning playbooks imply user interactivity and YAGNI for third-party daemon planning API. | high | low | Keep implementation in Pi/Claude skills and leave daemon response as `requires-agent`. | Medium: daemon-side implementation would add unnecessary architecture and runtime complexity. |
| A typed `requires-agent` response is better than a generic error for planning-mode `run`. | The playbook and request are valid; only executor choice is wrong. Client union already uses discriminated `kind` responses. | high | low | Implement union member and let type-check force handling in clients. | Low/medium: generic errors would work but produce worse UX and weaker client contracts. |
| Playbook list/show should expose `mode` to first-party clients. | Pi native Run needs to branch before calling daemon run. Existing `show` loads full playbook including mode, while list currently appears to expose only name/description/scope/source/shadows/path. | high | low | Add/list mode and test. Alternatively call show after selection; but list mode gives cleaner UX. | Low: without list mode, clients need an extra show call before branching. |
| Retaining `create-from-playbook` temporarily is safer than removing it immediately. | It is already in API/tool contracts and tests. Removing it would be a larger breaking change. The key bug is first-party happy paths using it as if it completed planning. | medium | low | Reframe docs and avoid in skill happy paths; decide later whether to deprecate/remove. | Medium: retaining it could continue confusing clients unless documentation and naming are clear. |
| Skill instructions are sufficient to make the agent perform investigation-first behavior. | Skills already govern conversational flows and can use read/bash/tools. However, skill behavior depends on model compliance, so instructions must be explicit and examples like complexity scan should be included. | medium | medium | Update both Pi and Claude skill docs; manually smoke the complexity playbook flow. | Medium: vague instructions could regress to static template creation. |
| Existing route tests can cover the daemon/client contract change without large new infrastructure. | Current tests already cover playbook API and session-plan-from-playbook behavior. | high | low | Update `test/playbook-api.test.ts` and related session-plan tests. | Low: if coverage is insufficient, type-check and small new tests can close gaps. |

No low-confidence/high-impact assumption is unresolved. The main medium-confidence risk is retaining `create-from-playbook`; mitigate by removing it from first-party happy-path skill instructions and clearly labeling it as static/template-only if it remains.

### Profile signal

Recommended profile: **Excursion**.

Rationale: this is a cohesive user-facing/API contract change that touches several packages: client route types, daemon route behavior, Pi extension, CLI/MCP proxy, and Pi/Claude skill docs. It does not need delegated module planning. A single planner can enumerate the contract, implementation sites, tests, and compatibility decisions.

It is not an Errand because it changes a daemon wire union and multiple integration surfaces. It is not an Expedition because no independently planned subsystems are needed; all changes follow from one central contract decision: planning playbooks require an interactive agent and daemon run returns `requires-agent`.

## Scope

### In scope

- Change the daemon/client route contract for `POST /api/playbook/run` so planning-mode playbooks return a typed `requires-agent` result and do not create a session plan.
- Update shared client route types and API versioning for the new `PlaybookRunResponse` union member.
- Ensure playbook list/show data exposes `mode` so clients can branch before trying to run a playbook.
- Update Pi native `/eforge:playbook` Run flow to delegate planning-mode playbooks to `/skill:eforge-playbook run <name>` rather than calling daemon run.
- Update Pi and Claude playbook skills so planning-mode Run performs the investigation first, then creates/updates a session plan with concrete findings and continues interactive planning.
- Update Pi and Claude plan skills so “seed from planning-mode playbook” follows the same investigation-first flow and does not treat static playbook text as a complete plan.
- Update CLI/MCP/Pi tool rendering and guidance to handle `requires-agent` if a planning playbook is passed to `run`.
- Update tests covering playbook run API responses, list/show mode exposure, and skill/tool-facing behavior where practical.

### Out of scope

- Building a daemon-side exploration-agent or planning-agent orchestration system.
- Adding a third-party planning-playbook execution API beyond the simple `requires-agent` response.
- Changing autonomous playbook enqueue behavior, queue dependency behavior, or post-merge behavior.
- Changing playbook storage scopes or shadowing semantics.
- Reworking the full playbook schema into separate `Investigation`, `Decision rules`, or `Plan seed requirements` sections in this slice. Skill documentation can clarify semantics without requiring a schema migration.
- Removing `create-from-playbook` immediately if doing so would create unnecessary compatibility churn. It can be deprecated/reframed first, but first-party skills should stop using it as the happy path for planning playbooks.

## Acceptance Criteria

- Running an autonomous playbook through `POST /api/playbook/run` still enqueues a PRD and returns `{ kind: 'enqueued', id }`; existing queue dependency behavior via `afterQueueId` remains unchanged.
- Running a planning-mode playbook through `POST /api/playbook/run` does not create or modify any `.eforge/session-plans/*.md` file and does not enqueue work.
- Planning-mode daemon run returns a typed `requires-agent` response with enough information for clients to display actionable guidance, at minimum kind, mode/name, and message.
- Shared client route types include the new response union member, and all first-party consumers handle it explicitly.
- Playbook list/show responses expose `mode` so native clients can branch before calling run.
- Pi native `/eforge:playbook` Run delegates planning-mode playbooks to the playbook skill instead of calling daemon run.
- Pi and Claude playbook skills describe and follow investigation-first behavior for planning playbooks: load the playbook, perform its investigation, create/update a planning session with concrete findings/action items, and continue interactive planning.
- Pi and Claude plan skills no longer present static `create-from-playbook` seeding as the happy path for planning playbooks; any retained helper is described as a template/scratch primitive only.
- CLI/MCP/Pi tool output for `requires-agent` is clear and does not claim a planning session was created.
- Tests cover autonomous run, planning run `requires-agent`, no session-plan file created for planning run, mode exposure in list/show, and updated static-seed behavior if `create-from-playbook` is retained.
- `pnpm type-check` and the targeted playbook/session-plan route tests pass.
