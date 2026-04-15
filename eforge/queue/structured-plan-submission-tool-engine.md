---
title: Structured Plan Submission Tool (Engine)
created: 2026-04-15
---

# Structured Plan Submission Tool (Engine)

## Problem / Motivation

The planner agent currently writes plan files (`*.md`, `orchestration.yaml`, `architecture.md`, `index.yaml`) by calling the Write tool N times from inside its agent loop. This pattern fails silently with weaker models: a recent eval run with `gemma-4` rendered the full plan set as fenced markdown blocks in chat output but never invoked Write. The engine scanned `eforge/plans/<set>/`, found it empty, and emitted `plan:skip` with reason *"No plans generated"* — exit code 0, silent success.

The failure surface is the "serialize to markdown, then call Write" indirection. Every plan file is one more opportunity for the model to render instead of invoke. There is no contract forcing the agent to persist what it produced.

## Goal

Replace the N-Write-calls pattern with a single schematized submission tool the planner must call to complete its turn. The engine writes files from the validated payload. Missing submission becomes a loud error (`plan:error`, non-zero engine exit), not a silent skip.

## Approach

Introduce two in-process custom tools, `submit_plan_set` (errand/excursion) and `submit_architecture` (expedition). Extend the `AgentBackend` interface so both the Claude SDK backend and the Pi backend can register custom tools alongside the existing coding tool preset. Define Zod schemas for the submission payloads in `packages/engine/src/schemas.ts`, reusing existing `planFileFrontmatterSchema`, `expeditionModuleSchema`, and `pipelineCompositionSchema` pieces. The planner agent injects these tools per run, captures the validated payload in a handler closure, and the engine writes files via new `writePlanSet` / `writeArchitecture` helpers in `plan.ts`.

### Schema scope principle (load-bearing)

The submission schemas validate **only what the engine mechanically consumes**: plan IDs, dependency graph, frontmatter fields, orchestration machinery. Plan *content* — architecture context, decisions, scope narrative, file lists, verification criteria — flows through a freeform `body: string` field (for plan files) and a freeform markdown string (for architecture.md).

This is deliberate. A maximal schema (`architecture_context`, `key_decisions[]`, `in_scope[]`, `files_create[]`, `verification[]` as typed fields) would bias the planner toward filling boxes, drop sections the schema didn't anticipate (risk discussion, perf trade-offs, cross-cutting refactors), and duplicate the plan-reviewer's job. Content quality is the plan-reviewer's responsibility downstream. The schema catches "the file was never written" and "the dependency graph has a cycle" — not "this verification criterion is vague."

This matches the existing style in `schemas.ts`: `planFileFrontmatterSchema`, `expeditionModuleSchema`, and `pipelineCompositionSchema` all validate mechanical fields and leave descriptive content as free strings.

Concrete shape:

```ts
submit_plan_set({
  orchestration: { name, description, base_branch, mode, validate, plans[] },
  plans: [{
    frontmatter: { id, name, dependsOn, branch, migrations? },
    body: string
  }]
})

submit_architecture({
  architecture: string,
  index: { name, description, mode, validate, modules: {...} },
  modules: [{ id, description, dependsOn }]
})
```

Validation rules (enforced engine-side during handler execution):

- Plan IDs unique within the set
- `dependsOn` references resolve to plan IDs that exist in the same submission
- Dependency graph is a DAG (no cycles)
- `orchestration.plans[].id` matches the submitted `plans[].frontmatter.id` set exactly
- Migration timestamps parse as `YYYYMMDDHHMMSS`

What the schema deliberately does **not** enforce: presence of sections in `body`, specificity of verification criteria, file-level create/modify bookkeeping, prose quality.

### Implementation order

1. Add `customTools?: CustomTool[]` plumbing to `AgentBackend` in `packages/engine/src/backend.ts` and both backend implementations. No-op for existing callers.
2. Define `planSetSubmissionSchema` and `architectureSubmissionSchema` in `packages/engine/src/schemas.ts` per the Schema Scope Principle.
3. Implement submission handlers as in-memory tools whose handler captures the validated payload into a closure-owned variable. Handler returns a brief success message to the agent so its turn ends cleanly.
4. Implement `writePlanSet` and `writeArchitecture` in `packages/engine/src/plan.ts`. These are the sole writers of plan files; the agent no longer writes plan markdown.
5. Refactor `packages/engine/src/agents/planner.ts`: inject submission tools, remove the disk-scan fallback at lines 185-209, replace the implicit `plan:skip` (line 207) with `plan:error` when neither `<skip>` XML block nor a submission tool call fired. The explicit `<skip>` path is unchanged.
6. Add a `plan:submission` event type to `packages/engine/src/events.ts` for diagnostics (the tool was invoked, here's the shape).
7. Update `packages/engine/src/prompts/planner.md`: rewrite "Output" and "Phase 3: Plan Generation" sections. Replace "Write `{path}`" instructions with "call `submit_plan_set` once with the plan set payload" / "call `submit_architecture` once with the architecture payload". Keep the markdown format in the prompt as the shape of the `plans[].body` string, not as instructions to write files. Add one imperative paragraph: *"Your only way to complete this turn is to call `submit_plan_set` (or `submit_architecture` for expeditions). Rendering plans as chat output does not count - the files are written from your tool call."*
8. Backend integration: translate `customTools` to SDK in-memory tool format in `packages/engine/src/backends/claude-sdk.ts` (around lines 59-63) and to Pi `AgentTool[]` in `packages/engine/src/backends/pi.ts` (around lines 310-345; `customTools` already exists there).

## Scope

### In scope

- Planner agent (errand/excursion/expedition architecture phase)
- `AgentBackend` interface and both backend implementations (Claude SDK + Pi)
- New submission schemas in `schemas.ts`
- Engine-side file writers in `plan.ts`
- Planner prompt rewrite (`planner.md`)
- New `plan:submission` event type and `plan:error` replacing the implicit-skip path
- Unit tests for submission schema validation (duplicate IDs, dangling deps, cycles, orchestration mismatch)
- Integration test via `test/stub-backend.ts` patterns

### Out of scope

- Module planner agents spawned during expedition execution (separate follow-up)
- Reviewer, evaluator, tester, pipeline-composer agents (they use XML block output today; migrate later if the pattern proves out)
- The `<skip>` XML block mechanism — explicit skip stays unchanged
- Zod → TypeBox migration (schemas stay Zod, consistent with the rest of `schemas.ts`)
- Eval harness changes (tracked as a separate PRD against the eval repo)

## Acceptance Criteria

- `packages/engine/src/backend.ts` exposes a `customTools` field on `AgentRunOptions`; both backends accept and forward it.
- `planSetSubmissionSchema` and `architectureSubmissionSchema` exist in `packages/engine/src/schemas.ts` and export `getSchemaYaml()` helpers following the existing pattern.
- Engine-side validation rejects payloads with duplicate plan IDs, dangling `dependsOn` references, dependency cycles, or orchestration-to-plans ID mismatch — each with a specific error.
- `writePlanSet` and `writeArchitecture` in `plan.ts` produce output byte-identical to what the current "agent writes markdown" path produces for equivalent inputs.
- Planner agent no longer scans the plans directory. Instead, it reads the captured submission payload. If neither `<skip>` nor a submission tool call fires, the planner emits `plan:error` and the engine exits non-zero.
- `planner.md` no longer instructs the agent to Write plan files; it instructs the agent to call `submit_plan_set` or `submit_architecture` exactly once.
- `plan:submission` event appears in the monitor DB when the tool is invoked, with a redacted payload shape (sizes/counts, not full body text).
- `pnpm build && pnpm type-check && pnpm test` pass in the engine package.
- A manual run against a small PRD produces a non-empty `eforge/plans/<set>/` directory via the new path, with no `plan:skip` event, and `plan:submission` recorded.
- Integration test in `test/` uses `StubBackend` to emit a submission tool call and verifies the engine writes the expected files and emits `plan:complete`.
