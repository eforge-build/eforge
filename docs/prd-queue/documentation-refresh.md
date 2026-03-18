---
title: Documentation Refresh
created: 2026-03-17
status: pending
---

## Problem / Motivation

The codebase has grown significantly since documentation was last updated. CLAUDE.md documents ~8 agents but there are now 17. Several prompt files, CLI commands, pipeline stages, and config fields are missing from docs. The `plans/forge-v1/` key reference doesn't exist anymore. The roadmap lists features that have already shipped. The README's opening doesn't capture eforge's core philosophy - that you stay at the planning level and eforge handles everything else.

## Goal

Bring all documentation (README.md, CLAUDE.md, docs/roadmap.md) into alignment with the current codebase - accurate agent inventory, CLI commands, pipeline stages, config fields, and roadmap reflecting only unshipped work.

## Approach

Update four documentation files with targeted, verified changes:

### 1. README.md

- **Reframe the opening** (lines 1-5): Lead with the developer experience - you plan, eforge builds. Queue work during the day, let it run overnight. The EEE etymology line stays but moves after the value prop.
- **Rework "Why eforge?"** (lines 11-25): Restructure into three paragraphs:
  - Para 1: You plan, eforge builds. Queue model lets you batch plans and run async.
  - Para 2: The methodology that makes unattended execution trustworthy - blind review, per-hunk evaluation, validation.
  - Para 3: Battle-tested origins, Claude Code integration.
  - Keep the numbered list but frame as "how eforge maintains quality without you watching."
- **Update Mermaid diagram** (lines 29-62): Add `doc-update` running parallel with `implement` in the build subgraph. Add `review-fix` stage between reviewer and evaluator.
- **Add missing plugin skills to table** (lines 95-101): Add `/eforge:roadmap`, `/eforge:roadmap-init`, `/eforge:roadmap-prune`.
- **Add missing CLI commands** (lines 104-127): Add `queue list`, `queue run [name]`, and `monitor`. Add `--generate-profile` to flags table.
- **Add `prdQueue` config section** (lines 147-180): Add the queue config to the eforge.yaml example.

### 2. CLAUDE.md

- **Fix agent loop description** (~line 34): Replace the inaccurate linear sequence with accurate pipeline description. Profile selection happens within the planner. The pipeline is stage-driven via profiles, not a fixed sequence.
- **Update agent list** (~lines 46-53): Add all 9 missing agents with their type and role:
  - Formatter - one-shot, toolless. Normalizes source input into structured PRD.
  - Assessor - one-shot query. Scope assessment (errand/excursion/expedition).
  - Staleness Assessor - one-shot query (queue only). Checks if queued PRD is stale.
  - Cohesion Reviewer - one-shot query (expedition). Cross-module consistency review.
  - Cohesion Evaluator - one-shot query (expedition). Evaluates cohesion fixes.
  - Parallel Reviewer - orchestrator. Fans out to specialist reviewers (code, API, docs, security).
  - Review Fixer - one-shot coding agent. Applies accepted review fixes.
  - Doc Updater - multi-turn coding agent. Updates docs after implementation.
  - Merge Conflict Resolver - one-shot coding agent. Resolves merge conflicts using plan context.
- **Simplify project structure to directory-level**: Replace exhaustive per-file listings with directory descriptions + brief notes on what lives there. Keep file-level detail only for top-level entry points and config files. For `agents/`, `prompts/`, `monitor/` etc., describe the directory purpose and let the code be the reference for individual files.
- **Update CLI commands section**: Add `queue list`, `queue run`, `monitor`. Add `--generate-profile` flag.
- **Remove stale key references**: Delete `plans/forge-v1/architecture.md` and `plans/forge-v1/index.yaml` - directory doesn't exist. Keep only `docs/roadmap.md`.
- **Add pipeline stage details**: Document the registered compile stages (`planner`, `plan-review-cycle`, `module-planning`, `cohesion-review-cycle`, `compile-expedition`) and build stages (`implement`, `review`, `review-fix`, `evaluate`, `review-cycle`, `validate`, `doc-update`). Note that `implement` and `doc-update` run in parallel by default.
- **Add built-in profile details**: Document errand/excursion/expedition compile and build stage lists.
- **Add `prdQueue` to config merge strategy section**: Add the `prdQueue` config section with `dir` and `autoRevise` fields.

### 3. docs/roadmap.md

- **Remove shipped items**:
  - Profile engine (fully implemented)
  - Pluggable review strategies (fully implemented)
  - Dynamic profile generation (`--generate-profile` exists)
  - Merge conflict resolver agent (implemented)
  - Edit region markers (prompt-level guidance is sufficient)
- **Restructure sections** after removals:
  - "Configurable Workflow Profiles" renamed to "Eval & Observability" - keeps only "Eval-driven tuning"
  - "Parallel Execution Reliability" loses merge conflict resolver + edit region markers - only acceptance validation agent remains

### 4. docs/hooks.md

No changes needed - verified accurate.

## Scope

**In scope:**
- README.md: opening, "Why eforge?", Mermaid diagram, plugin skills table, CLI commands, config example
- CLAUDE.md: agent loop description, agent list, project structure, CLI commands, key references, pipeline stages, profile details, config merge strategy
- docs/roadmap.md: remove shipped items, restructure remaining sections
- Verification that CLI commands match `src/cli/index.ts`, no roadmap items reference shipped features, end-to-end coherence check

**Out of scope:**
- docs/hooks.md (verified accurate, no changes needed)
- Code changes
- New documentation files
- API documentation

## Acceptance Criteria

- CLI commands listed in CLAUDE.md and README.md match what is registered in `src/cli/index.ts`
- No roadmap items reference features that have already shipped (profile engine, pluggable review strategies, dynamic profile generation, merge conflict resolver, edit region markers)
- CLAUDE.md lists all 17 agents with accurate type and role descriptions
- CLAUDE.md project structure uses directory-level descriptions rather than exhaustive per-file listings (except top-level entry points and config files)
- CLAUDE.md key references section no longer references `plans/forge-v1/architecture.md` or `plans/forge-v1/index.yaml`
- CLAUDE.md documents all registered compile and build pipeline stages
- CLAUDE.md documents the three built-in profiles (errand, excursion, expedition) with their stage lists
- CLAUDE.md config merge strategy section includes `prdQueue` with `dir` and `autoRevise` fields
- README.md opening leads with the developer experience value prop, not methodology
- README.md Mermaid diagram includes `doc-update` parallel with `implement` and `review-fix` between reviewer and evaluator
- README.md includes `/eforge:roadmap`, `/eforge:roadmap-init`, `/eforge:roadmap-prune` in the plugin skills table
- README.md includes `queue list`, `queue run [name]`, `monitor` commands and `--generate-profile` flag
- README.md eforge.yaml example includes the `prdQueue` config section
- Each updated file reads coherently end-to-end
