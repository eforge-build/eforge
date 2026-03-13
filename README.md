# aroh-forge

Autonomous plan-build-review CLI for code generation, built on the [Claude Agent SDK](https://docs.anthropic.com/en/docs/agents-and-tools/claude-agent-sdk).

aroh-forge extracts battle-tested workflows from Claude Code plugins into a standalone tool that runs independently — no Claude Code required.

## How it works

```
PRD / prompt  →  Planner Agent  →  Plan files
                                       ↓
                                 Builder Agent  →  Code commits
                                       ↓
                                 Reviewer Agent  →  Blind review + fixes
                                       ↓
                                 Builder (turn 2)  →  Evaluate fixes → Final commit
```

For multi-plan sets, an orchestrator resolves dependencies, computes execution waves, and runs plans in parallel using git worktrees.

## Install

```bash
pnpm install
pnpm run build
```

## Usage

```bash
# Generate plans from a PRD or description
aroh-forge plan docs/my-feature.md
aroh-forge plan "Add a health check endpoint"

# Execute plans (implement + review loop)
aroh-forge build my-plan-set

# Review existing code against plans
aroh-forge review my-plan-set

# Check running builds
aroh-forge status
```

### Flags

| Flag | Description |
|------|-------------|
| `--auto` | Bypass approval gates |
| `--verbose` | Stream agent output |
| `--dry-run` | Validate without executing |

## Development

```bash
pnpm run dev          # Run via tsx (pass args after --)
pnpm run build        # Bundle with tsup
pnpm run type-check   # Type check
```

## License

UNLICENSED
