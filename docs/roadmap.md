# Eforge Roadmap

## Daemon & MCP Server

**Goal**: Extend the daemon as the single orchestration authority with richer controls and safety checks.

- **Queue reordering & priority** — MCP tool and web UI controls for changing priority on queued PRDs at runtime (priority field exists in frontmatter and affects execution order, but there's no way to modify it after enqueue)
- **Re-guidance** — Build interruption with amended context, daemon-to-worker IPC for mid-build guidance changes
- **Plugin-engine version compatibility** — Add `version` to the daemon health endpoint and `minEngineVersion` to plugin.json. The MCP proxy checks compatibility at startup and warns (or refuses) if the installed eforge version is too old for the plugin.

---

## Multimodal Input

**Goal**: Let users attach images and PDFs alongside text to give agents richer context - wireframes, bug screenshots, design specs.

- **CLI `--attach` support** - Accept image/PDF file paths on `eforge run` and `eforge enqueue`, save to temp dir, inject prompt hints so planner and builder agents read them
- **Queue attachment storage** - Companion directory alongside PRD files so attachments persist through enqueue-then-run workflows
- **Plugin skill forwarding** - Update `/eforge:build` skill to accept and forward `--attach` arguments

---

## Integration & Maturity

**Goal**: Full lifecycle coverage, CI support, provider flexibility.

- **Pi backend with Codex auth** — Test PiBackend using OpenAI Codex subscription for authentication (analogous to ClaudeSDKBackend with Claude Max subscription auth, which is well-tested and works)
- **Low-fidelity input handling** — When the user provides a high-level prompt with minimal detail, eforge should perform thorough codebase exploration before compiling plans. May require a new exploration agent (or parallel exploratory agents) that activates for low-fidelity input and is bypassed for detailed PRDs.
- **Specialty agents** — Identify and implement domain-specific agents for common use cases beyond the current plan-build-review pipeline
- **Plugin skill coverage** — Add skills for common scenarios, e.g. `/eforge:update-docs` with flags like `--architecture`, `--readme`, `--claude-md` for targeted documentation updates
- **Model class tuning** — Evaluate whether `evaluator`, `formatter`, `doc-updater`, and `test-writer` roles should default to `balanced` or `fast` instead of `max`, based on usage data and quality metrics
- **Monorepo** — Extend pnpm workspaces (currently only monitor UI) so the engine, eforge-plugin, and marketing site each get their own package with isolated deps and build configs

---

## Marketing Site (eforge.build)

**Goal**: Public-facing site for docs, demos, and project visibility.

- **Next.js app** — `web/` directory, deployed to Vercel at eforge.build
- **Landing page** — Value prop, feature overview, getting-started guide
- **Documentation** — Usage docs, configuration reference, examples
