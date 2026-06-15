# @eforge-build/pi-eforge

Pi package for [eforge](https://eforge.build).

Install in Pi:

```bash
pi install npm:@eforge-build/pi-eforge
```

Or install for the current project only:

```bash
pi install -l npm:@eforge-build/pi-eforge
```

Then, in your project:

```text
/eforge:init
```

## What this package provides

- Native Pi tools for eforge daemon operations, including `eforge_extension_contribution` for discovering and invoking extension-provided actions, integration commands, and action-backed deep links with bounded Markdown/JSON output formatting
- Native Pi commands for agent runtime profile management (`/eforge:profile`, `/eforge:profile:new`), config viewing (`/eforge:config`), status dashboards (`/eforge:status`), safe daemon restarts (`/eforge:restart`), build source review (`/eforge:build`), extension contribution browsing (`/eforge:extensions`), and playbook management (`/eforge:playbook`) with interactive TUI panels and selectors
- Slash commands for build operations (`/eforge:build`, `/eforge:init`, `/eforge:update`)
- The `/eforge:plan` skill for structured handoff planning before build execution
- The `/eforge:extend` skill for assisted eforge TypeScript extension authoring
- The `/eforge:playbook` skill for creating, editing, running, and managing reusable automation playbooks
- The `/eforge:recover` skill for reviewing and acting on failed-PRD recovery verdicts
- The `/eforge:stack:sync` skill and `eforge_stack_sync` tool for manually synchronizing the git-spice stack, previewing with `--dry-run`, interpreting sync reports (including deferred outcomes and retry-deferred triggers when active builds overlap the stack), and recovering from manual sync conflicts (requires git-spice installed and `git-spice repo init` run in the repository)
- The `/eforge:workflow` skill for configuring the eforge workflow preset (landing action, stacking, PR settings, and daemon-owned after-build sync via `stacking.sync.afterBuild`) through a native Pi select-overlay wizard, including `/eforge:workflow:init` (initial setup) and `/eforge:workflow:reconfigure` (change the active preset)
- Ambient status display showing active profile, queue count, and build progress (passive — does not start the daemon)
- Orchestrator decision events (`plan:build:decision`) flow through the daemon event stream unchanged. Rich live rendering (timeline track, decision detail, and build activity) lives in Console.

## Requirements

- Node.js 22+
- [Pi](https://github.com/earendil-works/pi-mono)
- An LLM provider credential supported by your chosen eforge harness

## Relationship to the `@eforge-build/eforge` npm package

`@eforge-build/pi-eforge` is the Pi integration package.

The main [`@eforge-build/eforge`](https://www.npmjs.com/package/@eforge-build/eforge) npm package is the standalone CLI and daemon runtime that this Pi package invokes via `npx -y @eforge-build/eforge`.

For project docs and full setup guidance, see the main repository:

- GitHub: https://github.com/eforge-build/eforge
- Docs: https://eforge.build
