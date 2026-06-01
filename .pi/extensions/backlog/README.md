# backlog Pi extension

Project-local lightweight backlog capture for eforge development.

This is intentionally a Pi extension first: it records and curates issues without requiring an `eforge:plan` session or an `eforge:build`. Items can later be promoted into session plans, Schaake OS epics, roadmap updates, or discarded as stale.

## Storage

Backlog items are Markdown files under:

```text
.eforge/backlog/items/<id>.md
```

`.eforge/` is gitignored, so this is local working memory by default. The item format is frontmatter plus human-readable sections.

Frontmatter supports dependency tracking with `depends_on`, an array of backlog item IDs. An item is shown as blocked until each dependency is `shipped` or `superseded`.

`stale_after` is treated as an analysis/review reminder, not as an automatic stale verdict. Use `/backlog analyze` or `/backlog analyze-all` for agent-assisted staleness analysis.

Human-readable sections:

- `Claim`
- `Evidence`
- `Recheck`
- `Promotion Paths`

## Commands

```text
/backlog                         Show open backlog items
/backlog list [query]            Show open items, optionally filtered by text
/backlog add <title>             Capture a new candidate item
/backlog show <id>               Show one item
/backlog status <id> <status>    Set status: candidate|planned|active|shipped|stale|superseded
/backlog stale <id> [reason]     Mark an item stale and append evidence
/backlog depends <id> <dep...>   Add dependency backlog item IDs; use --clear to remove all
/backlog review                  Show open, blocked, and analysis-due counts
/backlog analyze <id>            Ask the agent to analyze one item against git/docs/code evidence
/backlog analyze-all             Ask the agent to analyze every open item
/backlog promote <id>            Prefill the editor with an /eforge:plan prompt
/backlog curate                  Ask the agent to review and curate backlog items without enqueuing builds
```

Slash-command completions are registered for the subcommands above and for the status value in `/backlog status <id> <status>`.

## Agent tools

The extension also registers tools for agent-assisted backlog maintenance:

- `backlog_add`
- `backlog_list`
- `backlog_show`
- `backlog_update`

Use these for lightweight capture and curation only. `backlog_add` accepts `dependsOn`; `backlog_update` accepts `dependsOn`, `addDependsOn`, and `removeDependsOn`. Promote an item to `/eforge:plan` when it becomes buildable work.
