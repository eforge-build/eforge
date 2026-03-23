# Eforge Roadmap

## Hardening

**Goal**: Stabilize what exists before building new features - expand eval coverage, tune profiles with evidence, and fix rough edges in the monitor.

- **Eval scenario breadth** - More fixtures and scenarios across all three profiles (errand, excursion, expedition) so regressions surface before they ship
- **Profile tuning** - Use eval results and Langfuse traces to refine agent parameters, stage composition, and review strategies in built-in profiles

---

## Eval & Observability

**Goal**: Use evaluation data and runtime observability to drive continuous improvement of workflow profiles and agent behavior.

- **Comparative profile tuning** — Run profiles head-to-head on the same PRDs (the scenario harness already tracks pass/fail, token usage, cost, and duration per scenario). Add code quality metrics. Use outcome data to refine profiles from intuition toward evidence.

---

## Parallel Execution Reliability

**Goal**: Verify requirement fulfillment in multi-plan builds.

- **Requirement-level validation coverage** — The test-writer and tester agents now generate and run acceptance tests from PRD criteria. Extend this to measure coverage gaps: detect PRD requirements that lack corresponding test cases and flag builds where acceptance coverage is incomplete.

---

## Daemon & MCP Server

**Goal**: Make the daemon the single orchestration authority. Everything flows through the queue; the daemon watches and auto-builds; the web UI is the control surface.

- **Queue-first architecture** — `eforge run` becomes enqueue + daemon auto-build. The daemon starts in watch mode by default, polling the queue and building PRDs as they arrive. No more foreground CLI builds — the daemon owns all execution.
- **Auto-build toggle** — Auto-build is on by default. Users can pause/resume via web UI toggle or MCP tool. When paused, PRDs accumulate in the queue until resumed.
- **Web UI control plane** — Dashboard controls for: auto-build on/off, build cancellation, queue reordering/priority, session status. The web UI becomes the primary management interface alongside MCP tools.
- **Re-guidance** — Build interruption with amended context, daemon-to-worker IPC for mid-build guidance changes

---

## Multimodal Input

**Goal**: Let users attach images and PDFs alongside text to give agents richer context - wireframes, bug screenshots, design specs.

- **CLI `--attach` support** - Accept image/PDF file paths on `eforge run` and `eforge enqueue`, save to temp dir, inject prompt hints so planner and builder agents read them
- **Queue attachment storage** - Companion directory alongside PRD files so attachments persist through enqueue-then-run workflows
- **Plugin skill forwarding** - Update `/eforge:run` and `/eforge:enqueue` skills to accept and forward `--attach` arguments

---

## Integration & Maturity

**Goal**: Full lifecycle coverage, CI support, provider flexibility.

- **OpenRouter backend** — `AgentBackend` implementation using the `openai` npm package pointed at OpenRouter's API, unlocking 400+ models (GPT-4, Gemini, Llama, etc.) as the second provider. Requires a self-managed agent loop and tool executors since OpenRouter is a chat completion API, not an agentic framework.
- **Monorepo** — Extend pnpm workspaces (currently only monitor UI) so the engine, eval harness, eforge-plugin, and marketing site each get their own package with isolated deps and build configs

---

## Marketing Site (eforge.run)

**Goal**: Public-facing site for docs, demos, and project visibility.

- **Next.js app** — `web/` directory, deployed to Vercel at eforge.run
- **Landing page** — Value prop, feature overview, getting-started guide
- **Documentation** — Usage docs, configuration reference, examples
