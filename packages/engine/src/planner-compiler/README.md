# Planner compiler architecture

This directory contains the bounded planner compiler. It turns normalized build source into atom-level planning work, reduces the atom outputs into final planning artifacts, and reports any coverage that cannot be safely converted into executable work.

The compiler is repository-agnostic. It uses deterministic repository indexing and optional caller-provided hints; it must not bake in product-specific layouts such as route, client, or extension package names for a particular project.

## Pipeline responsibilities

### Source inventory

`source-inventory.ts` parses the build source before atom planning. It records source metadata such as headings, acceptance criteria, evidence path candidates, subsystem hints, interface keys, and global localization needs.

Inventory output is the root for traceability. Later stages should keep links back to original criterion ids, aspect ids, source need ids, and source paths when reporting gaps or diagnostics.

### Source localization

`source-localization.ts` maps inventory and atom graph needs to concrete repository candidates. Localization uses repository signals, source hints, and bounded file indexing to resolve needs such as literal paths, directories, interfaces, manifests, entrypoints, commands, routes, APIs, UI surfaces, extensions, configuration, tests, documentation, and consumer surfaces.

Localization records include status, candidate owner paths, confidence, linked criterion/aspect ids, assigned atom ids, rationale, diagnostics, and budget notes. Directory-only or broad matches are localization signals, not executable implementation work by themselves.

A bounded repository exploration agent may add a structured `RepositoryExplorationOutcome` before compiler localization proceeds. Every outcome status contributes its validated hints as normalized `SourceLocalizationInputHints` - a `budget-exhausted` or `ambiguous` scope's confirmed evidence is still evidence - while `needs-rescope`, `budget-exhausted`, and `ambiguous` outcomes additionally preserve unresolved need ids, reasons, attempted queries, candidate paths, rescope hints, notes, and tool-use counts for diagnostics. A hint that echoes a known need id and carries confirmed paths attaches those paths as witnesses to that need, resolving it at literal-path strength. Echoed need, criterion, and aspect ids are checked against the deterministic source inventory/localization baseline, and unknown ids are dropped with machine-readable diagnostics instead of rejecting the whole outcome.

### Adaptive rescoping

`adaptive-rescope.ts` (stage-integration layer) wraps exploration in a bounded pre-map rescope loop. Exploration budgets scale with unresolved-need count (`planningUnitMaxLocalExplorationToolUses` stays the per-scope clamp, and the turn ceiling scales with the derived budget). When deterministic signals already show a risky collapsed root atom (low high-confidence share, subsystem diversity beyond one planning unit, or unresolved concrete interface/entrypoint needs), the loop splits before spending a broad repository-exploration pass. The cross-run ledger scales to cover scoped passes, reserves shallow budget for later scopes, and prioritizes scoped reruns by critical/unresolved need count rather than alphabetically. Submit-only grace prompts include prior read-only observations so budget-exhausted outcomes can preserve partial evidence.

The loop derives deterministic `PlanningRescopeDirective`s, splits the atom graph (`reason: 'rescope-split'`), reruns exploration only for unresolved scopes, and preserves scopes that already localize. The same directives are threaded into `runBoundedPlannerCompiler` so both layers derive the identical graph. Per-scope rerun outcomes are merged (most-degraded status wins) so a completed scope cannot mask a budget-exhausted sibling in diagnostics.

Terminal outcomes: exhausted attempts with genuinely critical needs unresolved may throw `AdaptiveRescopeFailClosedError` and fail the compile closed, persisting the rescope state to `rescope-fail-closed.json` in the plan-set directory (the main diagnostics artifact is never written on that path, and any stale `compiler-diagnostics.json` from a prior run is removed; a later successful diagnostics write removes a stale `rescope-fail-closed.json` symmetrically). Critical needs are intentionally narrow: only source-derived entrypoint needs can block compile. Needs minted from exploration-agent hints (source `project-hint`) never block - agent claims resolve through the witness paths they carry (confirmed paths resolve the hinted need at literal-path strength) or degrade with warnings, so compile outcomes depend on the PRD, not on run-to-run agent phrasing. Interface summaries and generic surface words such as config, route, schema, docs, and tests are rescope signals, not compile-abort triggers by themselves. Critical needs with no linked criteria cannot be targeted by scoped reruns and are excluded from the fail-closed gate with a warning. Budget-starved scopes proceed degraded (`exhausted-proceeded`) with low-confidence localization warnings instead of failing closed solely because the exploration budget skipped a scope or generic interface/surface signals remained unresolved. Already-decomposed graphs and no-split-signal sources keep warning-only degradation. On successful compiles, rescope state lands in the `rescope` section of compiler diagnostics.

### Localized shared brief ownership

`shared-brief.ts` derives the shared planning brief and ownership records from the atom graph and localization bundle. Ownership data decides which localized evidence is delivered to which atom prompts and records the localization need ids, status, confidence, candidate rank, and rationale for each owned path.

When localization records change, shared-brief ownership must be rebuilt before source evidence materialization so atom prompts and diagnostics use the current owner paths.

### Evidence materialization

`source-evidence-materialization.ts` reads bounded evidence excerpts for localized ownership records. It records whether each path was materialized, missing, directory-only, non-actionable, too large, read-error, or budget-exceeded.

Materialization failures are coverage inputs. A concrete path that exceeds an evidence budget may still be represented later only when the resulting residue is product-scoped and validated against original PRD criteria. Missing owners, directory-only evidence, and ambiguous localization remain repair inputs first.

### Atom planning

`atom-map-runner.ts` runs tool-less atom planners over the graph, shared brief, and materialized evidence. Atom outputs carry fragments, module candidates, aspect updates, and reduce digests. Atom prompts should receive repository evidence only through compiler-provided briefs and materialized excerpts.

Repair reruns should target affected atoms when gap metadata identifies atom ids. If atom ids are missing, the resolver should fall back through source need ids, criterion ids, aspect ids, interface keys, and localized paths. Unaffected atom outputs are reused, and merged outputs keep deterministic ordering before reduce.

### Reduce

`reduce-runner.ts` and `reducer-agent.ts` run tool-less reducers over atom and child reduce outputs. Reducers synthesize coherent final fragments and module candidates, report conflicts, and report gaps.

Reduce gaps that point to missing source or localization evidence must be structured as repair gaps, not as implementation-plan candidates. New reducer output should include machine-readable fields for the issue kind, source/localization signal, source need ids, affected atom ids, owner paths, criterion/aspect ids, and product-scoped validation references. Older or partial reducer output should be normalized through deterministic post-reduce classification.

### Repair loop

`source-localization-repair.ts` owns bounded source/localization repair orchestration. The repair loop classifies reducer gaps that indicate:

- missing owner paths
- missing contract, entrypoint, configuration, or consumer-surface evidence
- directory-only evidence
- missing materialized source
- localization ambiguity

The shared localization issue vocabulary also includes exploration-only reasons such as `too-broad` and `tool-budget`; those reasons do not change the reduce-gap repair trigger or semantics.

For classified gaps, a repair attempt adds focused localization needs, reruns localization, rebuilds localized shared-brief ownership, rematerializes evidence, reruns affected atom planners, reruns affected reducers, and merges updated outputs with unaffected outputs.

Repair attempts must be low-budget and capped. Diagnostics should record the configured limit, attempt number, status, gap ids, classifications, source need ids, affected atom ids, criterion/aspect ids, localized owner paths, owner status, evidence materialization status, unresolved reason, and whether residue synthesis was blocked. Exhausted repair returns incomplete or failed compiler diagnostics with coverage transparency rather than creating vague meta-planning branches.

### Residue

`residue-synthesis.ts` and `residue-contracts.ts` turn unresolved coverage into residue only when it is safe to make executable. Source/localization-derived residue is repair-only until it has concrete localized owner paths, product-scoped expected outputs, and validation tied to original PRD criteria. These invariants are enforced structurally during residue synthesis on the candidate's `sourceLocalizationDerived` flag (`validatePlanningResidueCandidates` in `residue-contracts.ts`) — never by inspecting plan prose, which cannot distinguish a negated mention from a positive classification.

Unresolved source/localization gaps must not become executable `candidate-reduce-gap` plans. Reduce gaps that are not source/localization-derived and are not `representationRequired` are informational advice: they produce no residue candidate and surface only as machine-readable compiler diagnostics (`resolution: informational`), including coverage status for affected criteria, aspects, and source needs.

## Repository-agnostic defaults and hints

Default localization is based on generic signals: normalized relative paths, directory names, manifests, entrypoints, docs, tests, configuration, commands, routes, APIs, UI surfaces, extensions, consumer surfaces, subsystem hints, interface keys, and keywords derived from the build source.

Project-specific knowledge belongs in optional hints supplied through `SourceLocalizationInputHints` or completed repository exploration outcomes, not in compiler defaults. Hints may provide ignored prefixes/globs and focused project hints with kind, query, paths, keywords, subsystem hints, interface keys, criterion ids, aspect ids, and atom ids. Exploration hints may also echo source need ids for diagnostics. Hints are validated, bounded, and treated as additional signals rather than mutation-capable tools.

## Diagnostics and events

Compiler diagnostics should be machine-readable and stable enough for tests and callers to inspect. They include repository exploration outcome status, unresolved needs, shared reasons, attempted queries, candidate paths, rescope hints, notes, unknown-id drops, and tool-use count when exploration runs. Prefer returning diagnostics through compiler results. Add planning events only when existing observable results cannot carry the required repair or exploration diagnostics; event wire shapes are owned by `@eforge-build/client`.

## Invariants

- Atom planners and reducers remain tool-less; repository access is performed by deterministic compiler internals.
- Source inventory, localization, shared-brief ownership, materialization, atom map, reduce, repair, and residue keep traceability to original criteria and aspects.
- Repair reruns only affected atoms when possible and preserves prior outputs for unaffected atoms.
- Exhausted source/localization repair fails closed with diagnostics instead of vague executable residue.
- Product-specific layout assumptions are expressed through caller hints or fixtures, not hard-coded compiler defaults.
