# Eforge Roadmap

## Planning Intelligence

**Goal**: Go from rough idea to refined, reviewed plans entirely within Claude Code.

- **Plan iteration** — Review and refine generated plans in-conversation, re-run review cycle
- **Plan templates** — Common patterns (API endpoint, migration, refactor, feature flag)

---

## Monitor & Observability

**Goal**: Rich real-time visibility into eforge runs, sessions, and trends.

- **Session-aware monitor UI** — Group runs by session in the sidebar so plan+build phases from `eforge run` appear as a single unit. Surface session-level status, duration, and cost rollups. Plumbing is in place (DB stores `session_id`, `getRunsBySession()` exists) - needs API response updates and UI changes.

---

## Integration & Maturity

**Goal**: Full lifecycle coverage, CI support, provider flexibility.

- **Headless/CI** — `--json` CLI output flag, webhook notifications
- **Provider abstraction** — Second `AgentBackend` implementation for non-SDK environments
- **npm distribution** — Publish CLI + library to npm, configure exports and files field
- **Plugin consolidation** — Deprecate orchestrate + EEE plugins, migration guide
