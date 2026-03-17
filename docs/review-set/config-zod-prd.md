# Config Validation with Zod

Replace the hand-rolled config parsing in `config.ts` with zod schemas. This is the single highest-value application of zod in the project - the current ~165 LOC of manual field validation is correct but verbose, produces poor error messages, and drifts out of sync when config fields are added.

## Problem

`parseRawConfig()` in `src/engine/config.ts` manually validates every config field:

```typescript
if (typeof raw.langfuse?.enabled === 'boolean') { ... }
if (raw.agents?.maxTurns !== undefined) {
  const val = Number(raw.agents.maxTurns);
  if (!isNaN(val) && val > 0) { ... }
}
if (raw.agents?.permissionMode !== undefined) {
  if (['bypass', 'default'].includes(raw.agents.permissionMode)) { ... }
}
// ... ~165 more lines
```

Issues:
- Adding a new config field requires writing validation logic, updating the type, and updating defaults in three separate places
- Error messages are absent - invalid values silently fall through to defaults with no user feedback
- Enum validation is stringly-typed (`includes()` checks against arrays)
- Profile extension resolution has its own validation layer on top

## Design

### Zod Schemas Replace Manual Parsing

Define zod schemas that mirror the existing TypeScript types. The schemas handle parsing, validation, defaults, and error messages in one declaration:

```typescript
const agentProfileSchema = z.object({
  maxTurns: z.number().positive().optional(),
  prompt: z.string().optional(),
  tools: z.enum(['coding', 'none']).optional(),
  model: z.string().optional(),
});

const reviewProfileSchema = z.object({
  strategy: z.enum(['auto', 'single', 'parallel']).default('auto'),
  perspectives: z.array(z.string()).default(['code']),
  maxRounds: z.number().positive().default(1),
  autoAcceptBelow: z.enum(['suggestion', 'warning']).optional(),
  evaluatorStrictness: z.enum(['strict', 'standard', 'lenient']).default('standard'),
});

const partialProfileSchema = z.object({
  description: z.string().optional(),
  extends: z.string().optional(),
  compile: z.array(z.string()).optional(),
  build: z.array(z.string()).optional(),
  agents: z.record(z.enum([...AGENT_ROLES]), agentProfileSchema).optional(),
  review: reviewProfileSchema.partial().optional(),
});

const eforgeConfigSchema = z.object({
  langfuse: z.object({
    enabled: z.boolean().default(false),
    publicKey: z.string().optional(),
    secretKey: z.string().optional(),
    host: z.string().default('https://cloud.langfuse.com'),
  }).default({}),
  agents: z.object({
    maxTurns: z.number().positive().default(30),
    permissionMode: z.enum(['bypass', 'default']).default('bypass'),
    settingSources: z.array(z.string()).optional(),
  }).default({}),
  build: z.object({
    parallelism: z.number().positive().default(availableParallelism()),
    worktreeDir: z.string().optional(),
    postMergeCommands: z.array(z.string()).optional(),
    maxValidationRetries: z.number().nonnegative().default(2),
    cleanupPlanFiles: z.boolean().default(false),
  }).default({}),
  plan: z.object({
    outputDir: z.string().default('plans'),
  }).default({}),
  plugins: z.object({
    enabled: z.boolean().default(true),
    include: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
    paths: z.array(z.string()).optional(),
  }).default({}),
  hooks: z.array(z.object({
    event: z.string(),
    command: z.string(),
    timeout: z.number().default(5000),
  })).default([]),
  profiles: z.record(z.string(), partialProfileSchema).default({}),
});
```

### TypeScript Types Derived from Schemas

Instead of maintaining types and schemas separately:

```typescript
export type PartialEforgeConfig = z.input<typeof eforgeConfigSchema>;
export type EforgeConfig = z.output<typeof eforgeConfigSchema>;
export type PartialProfileConfig = z.input<typeof partialProfileSchema>;
```

This eliminates the `PartialEforgeConfig` type alias with its manual conditional mapped type.

### `parseRawConfig` Becomes a One-Liner

```typescript
function parseRawConfig(raw: unknown): PartialEforgeConfig {
  return eforgeConfigSchema.partial().parse(raw);
}
```

With zod's error formatting, invalid config produces clear messages:

```
Invalid eforge config:
  agents.maxTurns: Expected number, received string
  agents.permissionMode: Invalid enum value. Expected 'bypass' | 'default', received 'skip'
```

### Merge Logic Stays

The config merge function (`mergeConfigs`) stays as-is - its merge strategy (shallow merge for objects, concatenate for hooks, replace for arrays) is business logic that zod doesn't handle. The merge operates on already-validated `PartialEforgeConfig` objects.

Profile extension resolution also stays - it's graph traversal logic, not validation. But it benefits from zod because the resolved profile is validated against `resolvedProfileSchema` after extension, catching misconfigurations that the current code silently accepts.

## Implementation

### Files to modify

- **`package.json`**: Add `zod` as a dependency
- **`src/engine/config.ts`**: Replace `parseRawConfig()` (~165 LOC) with zod schemas. Derive types from schemas. Keep `mergeConfigs()`, `resolveProfileExtensions()`, `loadConfig()`, and related functions.
- **`tsup.config.ts`**: No changes needed - zod is a pure JS library, bundles fine

### What stays the same

- `EforgeConfig` shape (fields, nesting, defaults) - identical behavior
- Config merge strategy - unchanged
- Profile extension resolution - unchanged
- Config file locations and loading order - unchanged
- CLI config overrides - unchanged

### What improves

- Error messages on invalid config (currently silent, now descriptive)
- Type safety (types derived from schemas, can't drift)
- ~100 fewer lines in config.ts
- Adding new config fields requires only schema changes (types auto-derive)

## Verification

- `pnpm test` passes (existing config tests in `config.test.ts` and `config-profiles.test.ts`)
- `pnpm type-check` passes
- Invalid config produces clear error messages (add test cases for bad values)
- Valid config produces identical `EforgeConfig` objects to the current implementation (snapshot comparison)
- Profile extension chains resolve identically
- `eforge run` with default config works unchanged
- `eforge run` with custom `eforge.yaml` works unchanged
