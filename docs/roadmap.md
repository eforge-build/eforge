# Eforge Roadmap

## Planning Intelligence

**Goal**: Go from rough idea to refined, reviewed plans entirely within Claude Code.

- **Plan iteration** — Review and refine generated plans in-conversation, re-run review cycle
- **Plan templates** — Common patterns (API endpoint, migration, refactor, feature flag)

---

## Configurable Workflow Profiles

**Goal**: Make the agent pipeline a tunable, config-driven system where profiles define how work gets planned, built, and reviewed - and eval data drives refinement over time.

- **Profile engine** — Declarative workflow configs that define the agent pipeline: which agents run, in what order, with what prompts and constraints. Expedition/excursion/errand become built-in profiles alongside user-defined ones (migration, security-audit, refactor-only, etc.)
- **Pluggable review strategies** — Review cycle parameters as config: number of rounds, severity thresholds for auto-accept, evaluator strictness, specialized reviewer prompts (correctness vs style vs security)
- **Eval-driven tuning** — Extend the eval framework to compare profiles head-to-head on the same PRDs. Track pass rate, code quality, token cost, and time. Use outcome data to refine profiles from intuition toward evidence.

---

## Integration & Maturity

**Goal**: Full lifecycle coverage, CI support, provider flexibility.

- **Headless/CI** — `--json` CLI output flag, webhook notifications
- **Provider abstraction** — Second `AgentBackend` implementation for non-SDK environments
- **npm distribution** — Publish CLI + library to npm, configure exports and files field
- **Plugin consolidation** — Deprecate orchestrate + EEE plugins, migration guide

---

## Marketing Site (eforge.run)

**Goal**: Public-facing site for docs, demos, and project visibility.

- **Next.js app** — `web/` directory, deployed to Vercel at eforge.run
- **Landing page** — Value prop, feature overview, getting-started guide
- **Documentation** — Usage docs, configuration reference, examples
