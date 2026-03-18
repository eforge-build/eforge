---
id: plan-01-docs-refresh
name: Documentation Refresh
depends_on: []
branch: documentation-refresh/docs-refresh
---

# Documentation Refresh

## Architecture Context

The codebase has grown significantly since docs were last updated. The engine now has 16 agents (up from 8 documented), additional CLI commands (`queue list`, `queue run`, `monitor`), registered pipeline stages, built-in workflow profiles, and a `prdQueue` config section - none of which are reflected in CLAUDE.md or README.md. The roadmap lists features that have already shipped. The `plans/forge-v1/` key reference in CLAUDE.md points to a directory that no longer exists.

## Implementation

### Overview

Update three documentation files to match the current codebase state: README.md (opening, diagram, CLI commands, plugin skills, config example), CLAUDE.md (agent inventory, pipeline stages, profiles, project structure, CLI commands, key references, config merge strategy), and docs/roadmap.md (remove shipped items, restructure sections).

### Key Decisions

1. CLAUDE.md project structure switches from exhaustive per-file listings to directory-level descriptions. Individual files change frequently - directory purposes are stable. Top-level entry points and config files keep file-level detail.
2. README.md opening leads with the developer experience ("you plan, eforge builds") rather than methodology. The EEE etymology line moves after the value prop instead of being the first thing a reader sees.
3. Roadmap removals are based on verified code evidence: `BUILTIN_PROFILES` object confirms profile engine shipped, `ReviewProfileConfig` confirms pluggable review strategies, `--generate-profile` flag confirms dynamic profile generation, `merge-conflict-resolver.ts` confirms merge conflict resolver agent.

## Scope

### In Scope
- README.md: reframe opening, rework "Why eforge?", update Mermaid diagram (add `doc-update` parallel with `implement`, add `review-fix`), add missing plugin skills (`/eforge:roadmap`, `/eforge:roadmap-init`, `/eforge:roadmap-prune`), add missing CLI commands (`queue list`, `queue run [name]`, `monitor`), add `--generate-profile` flag, add `prdQueue` to eforge.yaml example
- CLAUDE.md: fix agent loop description (stage-driven pipeline, not linear sequence), add 8 missing agents (assessor, staleness-assessor, cohesion-reviewer, cohesion-evaluator, parallel-reviewer, review-fixer, doc-updater, merge-conflict-resolver; formatter is already documented), simplify project structure to directory-level, add CLI commands, remove stale key references, document pipeline stages, document built-in profiles, add `prdQueue` to config merge strategy
- docs/roadmap.md: remove profile engine, pluggable review strategies, dynamic profile generation, merge conflict resolver, edit region markers; restructure remaining sections

### Out of Scope
- docs/hooks.md (verified accurate)
- Code changes of any kind
- New documentation files
- API documentation

## Files

### Modify
- `README.md` — Reframe opening (lines 1-5), rework "Why eforge?" section (lines 11-25), update Mermaid diagram (lines 29-62) to add `doc-update` and `review-fix`, add `/eforge:roadmap`, `/eforge:roadmap-init`, `/eforge:roadmap-prune` to plugin skills table (lines 95-101), add `queue list`, `queue run [name]`, `monitor` to CLI section and `--generate-profile` to flags table (lines 104-136), add `prdQueue` config to eforge.yaml example (lines 147-180)
- `CLAUDE.md` — Fix agent loop description (~line 34), add 9 missing agents to the agent list (~lines 46-53), simplify project structure to directory-level descriptions (~lines 65-138), add `queue list`, `queue run`, `monitor` to CLI commands and `--generate-profile` to flags (~lines 200-211), remove `plans/forge-v1/architecture.md` and `plans/forge-v1/index.yaml` from key references (~lines 226-228), add pipeline stage documentation (new section after "Pipeline stages" paragraph), add built-in profile details (new section), add `prdQueue` to config merge strategy (~line 165-167)
- `docs/roadmap.md` — Remove shipped items from "Configurable Workflow Profiles" section (profile engine, pluggable review strategies, dynamic profile generation), rename to "Eval & Observability" keeping only "Eval-driven tuning". Remove merge conflict resolver and edit region markers from "Parallel Execution Reliability", keeping only acceptance validation agent.

## Verification

- [ ] Every CLI command registered in `src/cli/index.ts` (`enqueue`, `run`, `status`, `queue list`, `queue run`, `monitor`, `config validate`, `config show`) appears in both CLAUDE.md and README.md CLI sections
- [ ] The `--generate-profile` flag documented in README.md matches the flag name in `src/cli/index.ts` line 190
- [ ] CLAUDE.md lists all 16 agent files from `src/engine/agents/` (excluding `common.ts` utility): assessor, builder, cohesion-evaluator, cohesion-reviewer, doc-updater, formatter, merge-conflict-resolver, module-planner, parallel-reviewer, plan-evaluator, planner, plan-reviewer, reviewer, review-fixer, staleness-assessor, validation-fixer
- [ ] CLAUDE.md does not contain the strings `plans/forge-v1/architecture.md` or `plans/forge-v1/index.yaml`
- [ ] CLAUDE.md documents all 5 compile stages: `planner`, `plan-review-cycle`, `module-planning`, `cohesion-review-cycle`, `compile-expedition`
- [ ] CLAUDE.md documents all 7 build stages: `implement`, `review`, `review-fix`, `evaluate`, `review-cycle`, `validate`, `doc-update`
- [ ] CLAUDE.md documents the three built-in profiles with their compile and build stage arrays matching `BUILTIN_PROFILES` in `src/engine/config.ts` lines 151-173
- [ ] CLAUDE.md config merge strategy section mentions `prdQueue` with `dir` and `autoRevise` fields
- [ ] CLAUDE.md project structure section uses directory-level descriptions for `src/engine/agents/`, `src/engine/prompts/`, `src/monitor/`, `src/cli/` rather than listing every file
- [ ] docs/roadmap.md does not contain "Profile engine", "Pluggable review strategies", "Dynamic profile generation", "Merge conflict resolver", or "Edit region markers"
- [ ] docs/roadmap.md "Configurable Workflow Profiles" section is renamed and contains only eval-related items
- [ ] README.md opening paragraph (first non-heading line) mentions developer experience before methodology
- [ ] README.md Mermaid diagram contains `doc-update` as a node name and `review-fix` as a node name
- [ ] README.md plugin skills table includes rows for `/eforge:roadmap`, `/eforge:roadmap-init`, `/eforge:roadmap-prune`
- [ ] README.md eforge.yaml example block contains `prdQueue:` with `dir:` and `autoRevise:` fields
