# Acceptance Validation Agent

## Problem

Post-build validation in eforge is purely mechanical - it runs commands like `pnpm type-check` and `pnpm test`. These catch syntax errors and regressions but can't answer the question "did the implementation actually satisfy the PRD?"

The existing reviewer agent checks code quality against the plan content, but its focus is correctness, style, and security - not requirement fulfillment. The evaluator only judges the reviewer's fixes. No agent compares what was built against what was asked for.

This gap showed up concretely during the workflow-profiles build: the PRD specified that profile selection should drive the pipeline, but the implementation hardcoded a fallback and left a TODO comment. Type-check and tests passed. The reviewer didn't flag it. The gap was only caught by manual PRD validation after the build completed.

## Solution

Introduce an **acceptance validation agent** that runs after the build phase (post-merge, alongside or after mechanical validation). It reads the original PRD source, examines the implementation diff, and checks each requirement against the actual code changes. It produces a structured pass/fail assessment per requirement, with evidence.

## Design

### When it runs

The acceptance validator runs in the build pipeline after mechanical validation passes. It's a new build stage (`accept`) that can be included in profile build stage lists:

```yaml
profiles:
  excursion:
    build:
      - implement
      - review
      - review-fix
      - evaluate
      - validate        # mechanical: type-check, tests
      - accept          # new: PRD compliance check
```

Built-in profiles should include it by default. It can be omitted from custom profiles where speed matters more than thoroughness (e.g., a rapid prototyping profile).

### What it does

The acceptance validator is a one-shot query agent that:

1. Reads the original PRD/source content
2. Reads the full diff of changes (base branch to HEAD after merge)
3. Extracts requirements from the PRD (explicit design specifications, behavioral expectations, stated constraints)
4. For each requirement, checks whether the implementation addresses it - looking at actual code, not just file presence
5. Produces a structured assessment

### Output format

The agent emits XML that the engine parses into typed events:

```xml
<acceptance-validation>
  <requirement status="pass">
    <description>Profile config types with description, extends, compile, build, agents, review fields</description>
    <evidence>ResolvedProfileConfig interface in src/engine/config.ts defines all required fields</evidence>
  </requirement>
  <requirement status="fail">
    <description>Profile selection drives subsequent pipeline stages</description>
    <evidence>src/engine/eforge.ts line 163 hardcodes selectedProfile to 'excursion' with a TODO comment instead of using the planner's plan:profile event</evidence>
  </requirement>
  <requirement status="partial">
    <description>Review strategy configuration controls build-phase review</description>
    <evidence>ReviewProfileConfig is defined and parsed but strategy field is not yet wired to control parallel vs single review decision</evidence>
  </requirement>
</acceptance-validation>
```

### Events

New event types:

- `accept:start` - acceptance validation beginning
- `accept:requirement` - per-requirement result with status, description, evidence
- `accept:complete` - final summary with pass/fail/partial counts

### Failure handling

Acceptance validation failures are **informational by default** - they don't fail the build. The build already produced working code (mechanical validation passed). Acceptance failures indicate gaps between intent and implementation, which may be acceptable (deferred work, intentional simplification) or may warrant a fix cycle.

A profile could opt into strict acceptance validation where failures trigger the validation fixer:

```yaml
review:
  acceptanceMode: strict    # fail the build on acceptance failures
  # or
  acceptanceMode: report    # default: report but don't fail
```

### Relationship to existing agents

- **Reviewer** - reviews code quality, not requirement fulfillment. Acceptance validator complements it.
- **Validation fixer** - fixes mechanical validation failures. Could be extended to attempt fixes for acceptance failures in strict mode.
- **Evaluator** - judges reviewer fixes. Not involved in acceptance validation.
- **Planner** - generates the plan that the builder implements. The acceptance validator closes the loop back to the original PRD, which the planner derived from but which may contain requirements the plan didn't fully capture.

### Prompt design

The acceptance validator needs a focused prompt that:

- Receives the original PRD source (not the plan files - those are the planner's interpretation)
- Receives the full diff of what was built
- Instructs the agent to extract requirements from the PRD, not invent them
- Asks for evidence-based assessment (cite specific files, lines, code patterns)
- Distinguishes between "not implemented" (fail) and "partially implemented with acknowledged limitations" (partial)
- Avoids scope creep - the validator checks what the PRD asked for, not what it thinks should have been asked for

## Code changes

- New agent: `src/engine/agents/acceptance-validator.ts`
- New prompt: `src/engine/prompts/acceptance-validator.md`
- New events in `src/engine/events.ts`: `accept:start`, `accept:requirement`, `accept:complete`
- New build stage registered in `src/engine/pipeline.ts`: `accept`
- XML parser for `<acceptance-validation>` blocks in `src/engine/agents/common.ts`
- CLI display rendering for acceptance events in `src/cli/display.ts`
- Monitor UI support for acceptance events
- Built-in profiles updated to include `accept` stage

## Open questions

- Should the acceptance validator have tool access (to read files beyond the diff) or work purely from the diff?
- Should acceptance results feed back into the eval framework as a quality signal for profile tuning?
- Should the planner generate acceptance criteria explicitly during planning, giving the validator a structured checklist rather than requiring it to extract requirements from prose?
