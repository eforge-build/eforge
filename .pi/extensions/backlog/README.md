# backlog Pi extension

Project-local lightweight backlog capture for any project.

This is intentionally a Pi extension first: it records and curates issues without requiring an `eforge:plan` session or an `eforge:build`. Items can later be promoted into session plans, linked to local backlog epics, moved into roadmap updates, or discarded as stale.

## Storage

Backlog items and local epics are Markdown files under:

```text
.backlog/items/<id>.md
.backlog/epics/<epic-id>.md
```

`.backlog/` is gitignored, so this is local working memory by default. The item and epic formats are frontmatter plus human-readable sections. `/backlog analyze-all` also asks the agent to refresh the volatile structured recommendation artifact `.backlog/recommendations.json` after each full semantic analysis pass, then automatically regenerates and opens the same HTML dashboard produced by `/backlog html` with those recommendations included.

Item frontmatter supports dependency tracking with `depends_on`, an array of backlog item IDs. An item is shown as blocked until each dependency is `shipped` or `superseded`.

Item frontmatter also supports one primary local epic link with `epic: <epic-id>`. Epic IDs point to records in `.backlog/epics/`; commands and agent tools validate the epic exists before writing links. Existing orphaned links are tolerated when reading and shown as missing in generated views.

`stale_after` is treated as an analysis/review reminder, not as an automatic stale verdict. Use `/backlog analyze` or `/backlog analyze-all` for agent-assisted staleness analysis.

Item human-readable sections:

- `Claim`
- `Evidence`
- `Recheck`
- `Promotion Paths`

Epic human-readable sections:

- `Goal`
- `Evidence`
- `Recheck`
- `Notes`

## Commands

```text
/backlog                         Show an interactive open-item browser
/backlog list [query]            Show an interactive open-item browser, optionally filtered by text
/backlog ready [query]           Show only ready items not blocked by dependencies
/backlog blocked [query]         Show only items blocked by dependencies
/backlog graph [query]           Show a dependency tree for backlog items
/backlog html [flags] [query]    Generate and open .backlog/view/index.html; flags: --include-closed --no-open
/backlog add <title>             Capture a new candidate item
/backlog show <id>               Show one item with markdown formatting
/backlog status <id> <status>    Set status: candidate|planned|active|shipped|stale|superseded
/backlog stale <id> [reason]     Mark an item stale and append evidence
/backlog depends <id> <dep...>   Add dependency backlog item IDs; use --clear to remove all
/backlog epic list [query]       List local backlog epics
/backlog epic add <title>        Create a local backlog epic
/backlog epic show <epic-id>     Show one local backlog epic
/backlog epic status <epic-id> <status> [reason]
/backlog epic link <id> <epic-id>
/backlog epic unlink <id>
/backlog review                  Show open, blocked, and analysis-due counts
/backlog analyze <id>            Ask the agent to analyze one item against git/docs/code evidence
/backlog analyze-all             Ask the agent to analyze every open item, refresh .backlog/recommendations.json, then regenerate/open the HTML view
/backlog promote <id>            Prefill the editor with an /eforge:plan prompt
/backlog curate                  Ask the agent to review and curate backlog items without enqueuing builds
```

Slash-command completions are registered for the top-level subcommands above and for the status value in `/backlog status <id> <status>`.

The list browser supports `↑↓/j/k` navigation, `enter` to view the selected item with markdown formatting, `b`/`←` to return from detail view, `/` to search from the list view, `r` to toggle ready-only filtering, `a` to analyze the selected item, `p` to promote it, `s` to choose a status, `!` to choose a priority, and `q`/`esc` to close. Status and priority changes use in-browser pickers and keep the current detail view open after saving.

The HTML view is a self-contained, offline dashboard with summary counts, client-side search/filtering, local epic chips, dependency/dependent cards, blocked and ready highlighting, missing epic/dependency markers, and cycle warnings when detected. Cards can be grouped three ways via the `Status` / `Epic` / `Recommended` toggle. When `.backlog/recommendations.json` is present it also renders a recommendations panel (summary plus a numbered next-up rail, with parallel lanes, blocked chains, and rationale in a collapsible disclosure) and projects those recommendations onto the board: a `Next N` rank badge and parallel-lane chips on each card, the unblock action on blocked cards, and a `Recommended` grouping mode with Next up / Blocked / Other open / Closed columns. It is written under `.backlog/view/`, opened automatically by default, and remains local/gitignored with the rest of `.backlog/`.

## Tests

The extension keeps its tests alongside its source so it can be copied to other projects independently:

```bash
pnpm exec vitest run --config .pi/extensions/backlog/vitest.config.ts
```

## Agent tools

The extension also registers tools for agent-assisted backlog maintenance:

- `backlog_add`
- `backlog_list`
- `backlog_show`
- `backlog_update`
- `backlog_epic_add`
- `backlog_epic_list`
- `backlog_epic_show`
- `backlog_epic_update`
- `backlog_epic_link`
- `backlog_write_recommendations`

Use these for lightweight capture and curation only. `backlog_list` accepts `readyOnly`, `blockedOnly`, and `epic`; `backlog_add` accepts `dependsOn` and `epic`; `backlog_update` accepts `dependsOn`, `addDependsOn`, `removeDependsOn`, and `epic`. `backlog_epic_link` links one item to one local epic or unlinks it when no epic ID is provided. `backlog_write_recommendations` is only for the volatile `.backlog/recommendations.json` artifact and should be used at the end of `/backlog analyze-all`. Promote an item to `/eforge:plan` when it becomes buildable work.
