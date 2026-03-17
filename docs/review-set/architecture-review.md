# eforge Architecture Review

## Context

High-level architecture review of the eforge codebase (~9,400 LOC in src/). Looking for structural strengths, weaknesses, and smells - not nitpicking individual lines.

---

## Strengths

### 1. The AsyncGenerator<EforgeEvent> spine is excellent

The entire architecture hangs off a single pattern: every engine method returns `AsyncGenerator<EforgeEvent>`, consumers iterate. This is the right call. It gives you:
- Natural backpressure (consumers pull, not push)
- Composable middleware (session stamping, recording, hooks) that wraps generators transparently
- Clean separation between engine and rendering - CLI, monitor, and future CI consumers all use the same stream
- Testability - StubBackend feeds canned events, tests collect and assert

The middleware chain (`withSessionId` → `withHooks` → `withRecording`) composes cleanly without callbacks or pub/sub complexity.

### 2. Backend abstraction is tight and well-enforced

`AgentBackend` is a single-method interface (3 lines). The SDK import is isolated to one file (`backends/claude-sdk.ts`). Agent runners never touch the SDK. This is textbook dependency inversion - when you swap providers or add a local model backend, you touch one file.

### 3. Layer boundaries are clean

- Engine: 0 stdout calls. Pure event emission.
- CLI: thin Commander wiring + display switch. No plan parsing, no dependency resolution, no agent logic.
- Monitor: decoupled subprocess, communicates via SQLite polling. Only imports `EforgeEvent` type from engine.
- Plugin: thin skill wrappers that shell out to the CLI. No engine reimplementation.

The 9:1 engine-to-surface LOC ratio confirms this isn't just aspirational - it's real.

### 4. Profile-driven pipeline composition

Profiles declare which stages run and in what order. Stages are registered in a global map and looked up by name. This is a simple, effective way to make the pipeline configurable without a complex plugin system. Extension chains with cycle detection are well-implemented.

### 5. Orchestrator design

Wave-based parallel execution with dependency graph resolution, failure propagation (BFS to block dependents), atomic state writes (write-to-temp-then-rename), and worktree isolation. The validation-fixer retry loop is a pragmatic addition. State is resumable on interruption.

---

## Weaknesses & Smells

### 1. `eforge.ts` is a god object in disguise (~742 LOC)

`EforgeEngine` has three public methods (`compile`, `build`, `adopt`) that each contain substantial orchestration logic, plus a static factory that handles config loading, MCP discovery, and plugin discovery (~80 LOC). `adopt()` alone is ~200 lines and duplicates PipelineContext creation and plan review logic from `compile()`.

**Why it matters:** When you add a new entry point (e.g., `resume`, `validate`, headless CI mode), this file grows further. The factory's auto-discovery logic (MCP servers, plugins) is infrastructure that doesn't belong in the engine coordinator.

**Recommendation:** Extract `adopt()` into its own module or refactor it to reuse the compile pipeline with an "adopt" flag. Move MCP/plugin discovery out of `EforgeEngine.create()` into a separate `resolveBackendOptions()` helper.

### 2. Inconsistent error handling across agents

Three different patterns exist:
- **Builder:** yields `build:failed` event, returns gracefully (no throw)
- **Plan evaluator:** yields zero-count completion event, then re-throws
- **Validation fixer:** swallows non-abort errors, doesn't yield completion event

Consumers can't predict whether an agent failure will arrive as an event, an exception, or silence. This makes the pipeline stages' error handling defensive and ad-hoc.

**Recommendation:** Pick one pattern and enforce it. The builder's approach (yield a typed failure event, return cleanly) is the most consumer-friendly since it keeps error handling in the event stream where everything else lives. Reserve thrown exceptions for truly unrecoverable situations (abort signals, backend crashes).

### 3. Repeated "run backend → accumulate text → parse XML" boilerplate

Every agent does this:

```typescript
let fullText = '';
for await (const event of backend.run(...)) {
  if (isAlwaysYieldedAgentEvent(event) || verbose) yield event;
  if (event.type === 'agent:message' && event.content) fullText += event.content;
}
// parse fullText for structured output
```

This appears 8+ times across planner, builder, reviewer, plan-reviewer, plan-evaluator, parallel-reviewer, cohesion-reviewer, and validation-fixer. It's not complex per instance, but it's the kind of boilerplate that invites subtle inconsistencies (and already has - some agents check `options.verbose`, others check just `verbose`).

**Recommendation:** Extract a `collectAgentOutput(backend, options)` helper that returns `{ fullText: string }` and yields the filtered events. Agents call it and then parse. This also centralizes the verbose-filtering logic.

### 4. XML parsing is regex-based and fragile

All structured communication between agents and the engine (scope, profile, clarifications, modules, review issues, evaluation verdicts) goes through hand-rolled regex parsers in `common.ts`, `reviewer.ts`, and `builder.ts`. These work, but:
- Attribute parsing (`attrs.match(/id="([^"]+)"/)`) breaks on single quotes, extra whitespace, or attribute reordering
- Nested XML (clarification questions with options and context) gets increasingly gnarly
- No error reporting - malformed blocks silently return null/empty

This isn't a crisis today since the LLM output is reasonably consistent, but it's the most brittle part of the system. One model version that outputs slightly different XML formatting breaks silently.

**Can structured outputs eliminate this?** No - the claude-agent-sdk runs Claude Code subprocess agents that produce free-text conversation output. There's no way to pass an output schema through `AgentBackend.run()`. The agents explore codebases, write files, and use tools; the XML blocks are signaling conventions embedded in the agent's conversational text. You can't avoid the "parse structured data from free text" step.

**Could we switch from XML to JSON blocks?** It's a wash. JSON is easier to parse once extracted (`JSON.parse()` + zod validate vs. nested regex), but JSON embedded in free text has escaping problems - code snippets, quotes in descriptions, and multi-line content all need escaping. XML handles mixed content more naturally because it doesn't need to escape quotes inside element bodies. XML is also more forgiving for LLMs to produce inline - they write prose, drop a `<scope assessment="errand">` block, and continue. JSON blocks interrupt the flow more and models sometimes break the structure.

**Recommendation:** Keep XML for agent output signaling. The real problem is silent failure - blocks that don't parse return null/empty with no warning. Fix that by (a) adding a lightweight wrapper that handles attribute variations (whitespace, quote styles), and (b) logging warnings when expected blocks aren't found so failures are visible instead of silent.

### 5. Clarification loop is planner-specific, not reusable

The multi-turn clarification loop (parse questions → callback → reformat → restart agent) is ~90 lines embedded directly in the planner agent runner. If any other agent needs to ask clarifying questions (module-planner during expedition planning, builder encountering ambiguity), there's no way to reuse this.

**Recommendation:** Extract clarification handling into a middleware or wrapper that any agent runner can opt into. The pattern is: wrap `backend.run()`, watch for clarification XML in output, invoke callback, restart with accumulated answers.

### 6. Config validation is ~165 LOC of hand-rolled field checks

`parseRawConfig()` manually validates every field with individual `typeof` checks, `includes()` for enums, and explicit fallbacks. This is correct but verbose and easy to get out of sync when adding new config fields.

**Recommendation:** Bring in zod for config validation - this is the clear win for zod in this project. It would cut the parsing code by ~60%, give you typed parsing for free, and produce better error messages. (Note: zod does *not* help with agent output parsing - that's a free-text extraction problem, not a validation problem. See #4 above.) Low priority since the current code works, but it'll pay off as the config surface grows.

### 7. PipelineContext is a mutable grab bag

`PipelineContext` has mutable fields (`plans`, `scopeAssessment`, `expeditionModules`, `profile`) that stages read and write as side effects. The planner stage mutates `ctx.profile`, and downstream stages see the change implicitly. `BuildStageContext` adds more mutable state (`reviewIssues`, `buildFailed`).

This works when the pipeline is linear and sequential, but it's a footgun for anyone adding stages or reordering them. There's no visibility into which stages depend on which mutations.

**Recommendation:** Not suggesting immutability (that fights the generator pattern). But document the data flow explicitly - which stages write which fields, which stages read them. A comment block at the top of the stage registry would suffice. Consider making `buildFailed` a return value rather than a context mutation.

### 8. No structured logging or diagnostics

The engine has tracing (Langfuse) for external observability, but no internal structured logging. When something goes wrong in the pipeline - a stage silently skips, a merge fails, config resolution picks an unexpected profile - there's no diagnostic trail. The CLI renders events, but events are user-facing, not debug-facing.

**Recommendation:** Add a lightweight internal logger (even just `debug` package style) that stages and infrastructure can write to. Gate it behind `--verbose` or a `DEBUG` env var. This is especially valuable for the orchestrator, where concurrent worktree operations and merge sequences are hard to debug from events alone.

---

## Observations (not necessarily problems)

### Event type count is high (~45 variants)

The discriminated union in `events.ts` has ~45 variants. This is a natural consequence of the architecture (everything is an event), but it means every new consumer (display.ts, recorder, monitor UI) needs an exhaustive switch or explicit filtering. `display.ts` is 566 lines, mostly a switch statement.

Not necessarily wrong, but worth watching. If the event count doubles, consider event categories or a hierarchy to avoid N*M scaling.

### Agent count exceeds documentation

CLAUDE.md documents 7 agents, but there are 11 implementations (planner, module-planner, builder, reviewer, plan-reviewer, plan-evaluator, validation-fixer, assessor, parallel-reviewer, review-fixer, cohesion-reviewer). The undocumented ones are real agents doing real work. CLAUDE.md should reflect the actual architecture.

### Monitor mock-server is 944 LOC

Largest file in the project, but it's a dev tool. Fine, just notable.

---

## Summary

| Area | Verdict |
|------|---------|
| Core architecture (events, generators, middleware) | Strong - well-designed, composable |
| Layer separation (engine/CLI/monitor/plugin) | Excellent - clean boundaries, no leaks |
| Backend abstraction | Excellent - single-method interface, SDK isolated |
| Pipeline & profiles | Good - simple and effective |
| Orchestration | Good - proper dependency graphs, failure propagation |
| Agent implementations | Adequate - work well but have consistency issues |
| Error handling | Weak - inconsistent patterns across agents |
| Config system | Adequate - correct but verbose, will scale poorly |
| XML parsing | Fragile - works today, brittle to model changes |
| Internal diagnostics | Missing - no structured logging for debugging |

The architecture is fundamentally sound. The event-driven generator pattern, clean layer boundaries, and backend abstraction are genuinely well-done. The weaknesses are mostly in the "middle layer" - agent implementations that have grown organically and accumulated inconsistencies. None of the issues are urgent, but the error handling inconsistency and XML parsing fragility are the ones most likely to bite you during real usage.

---

## Extracted PRDs

Three PRDs were extracted from this review, each sized for an eforge excursion-level run. They're independent but have a recommended implementation order:

| Order | PRD | Findings addressed | Why this order |
|-------|-----|-------------------|----------------|
| 1 | [`config-zod-prd.md`](config-zod-prd.md) | #6 (config validation) | Zero dependencies, smallest blast radius (one file), gets zod into the dep tree |
| 2 | [`agent-consistency-prd.md`](agent-consistency-prd.md) | #2 (error handling), #3 (boilerplate), #5 (clarification), #7 (context docs) | Touches every agent file - better to land before XML parsing work modifies the same files |
| 3 | [`xml-parsing-resilience-prd.md`](xml-parsing-resilience-prd.md) | #4 (XML parsing) | Integrates cleanly into agent runners that already use `collectAgentOutput` and follow standardized error patterns from PRD #2 |

Findings #1 (eforge.ts god object) and #8 (structured logging) are noted above but not extracted into PRDs. The god object issue will partially resolve as agent consistency work extracts helpers. Structured logging can become its own PRD if debugging becomes a pain point.
