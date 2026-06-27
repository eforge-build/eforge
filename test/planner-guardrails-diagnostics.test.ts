import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';

import {
  architectureSubmissionSchema,
  planSetSubmissionSchema,
  validateArchitectureSubmission,
  validatePlanSetSubmission,
  type ArchitectureSubmission,
  type PlanSetSubmission,
} from '@eforge-build/engine/schemas';
import { runPlanner } from '@eforge-build/engine/agents/planner';
import {
  DEFAULT_BOUNDED_DIAGNOSTIC_OPTIONS,
  formatPlannerToolSchemaValidationError,
  formatPlannerToolSemanticValidationError,
  formatPlannerToolValidationDiagnostic,
} from '@eforge-build/engine/compile-resilience/diagnostics';
import { safeParseWithSchema } from '@eforge-build/client';
import { StubHarness } from './stub-harness.js';
import { collectEvents, filterEvents } from './test-events.js';
import { useTempDir } from './test-tmpdir.js';

function hugeInvalidPayload(): unknown {
  return {
    description: 'Huge invalid plan set',
    plans: [{ frontmatter: { id: 123, name: 'Huge' }, body: 'x'.repeat(80_000) + 'SENTINEL_BEYOND_EXCERPT' }],
    orchestration: { validate: [], plans: [{ id: 'plan-01-huge', dependsOn: [] }] },
  };
}

function semanticInvalidPayload(): PlanSetSubmission {
  return {
    description: 'semantic invalid',
    plans: [{ frontmatter: { id: 'plan-01-a', name: 'A' }, body: '# A' }],
    orchestration: { validate: [], plans: [{ id: 'plan-01-b', dependsOn: [] }] },
  };
}

function hugeInvalidArchitecturePayload(): unknown {
  return {
    architecture: 'x'.repeat(80_000) + 'ARCH_SENTINEL_BEYOND_EXCERPT',
    modules: [{ id: 'module-a', description: { raw: 'not a string' }, dependsOn: [] }],
    index: { name: 'huge', description: 'huge architecture', mode: 'expedition', validate: [], modules: { 'module-a': { description: 'A', depends_on: [] } } },
  };
}

function semanticInvalidArchitecturePayload(): ArchitectureSubmission {
  return {
    architecture: '# Architecture',
    modules: [{ id: 'module-a', description: 'A', dependsOn: ['missing-module'] }],
    index: { name: 'semantic-architecture', description: 'semantic invalid', mode: 'expedition', validate: [], modules: { 'module-a': { description: 'A', depends_on: [] } } },
  };
}

describe('planner guardrail diagnostics', () => {
  const makeTempDir = useTempDir('eforge-planner-guardrails-diagnostics-');

  it('bounds a huge invalid submitted value and includes wire fields', () => {
    const payload = hugeInvalidPayload();
    const diagnostic = formatPlannerToolValidationDiagnostic({
      toolName: 'submit_plan_set',
      schemaPath: '/plans/0/body',
      expectedType: 'object',
      receivedValue: (payload as { plans: Array<{ body: string }> }).plans[0].body,
      fullPayload: payload,
    });

    expect(Buffer.byteLength(diagnostic.message, 'utf8')).toBeLessThanOrEqual(DEFAULT_BOUNDED_DIAGNOSTIC_OPTIONS.maxMessageBytes);
    expect(diagnostic.schemaPath).toBe('plans.0.body');
    expect(diagnostic.expectedType).toBe('object');
    expect(diagnostic.receivedType).toBe('string');
    expect(diagnostic.payloadBytes).toBeGreaterThan(80_000);
    expect(diagnostic.payloadSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(diagnostic.omittedBytes).toBeGreaterThanOrEqual(0);
    expect(typeof diagnostic.truncated).toBe('boolean');
    expect(diagnostic.message).toContain('schemaPath=plans.0.body');
    expect(diagnostic.message).toContain('expectedType=object');
    expect(diagnostic.message).toContain('receivedType=string');
    expect(diagnostic.message).toContain('payloadBytes=');
    expect(diagnostic.message).toContain('payloadSha256=');
    expect(diagnostic.message).not.toContain('SENTINEL_BEYOND_EXCERPT');
  });

  it('reports additional omitted validation errors in a bounded message', () => {
    const payload = hugeInvalidPayload();
    const diagnostic = formatPlannerToolValidationDiagnostic({
      toolName: 'submit_plan_set',
      schemaPath: '/plans/0/body',
      expectedType: 'string',
      receivedValue: (payload as { plans: Array<{ body: string }> }).plans[0].body,
      fullPayload: payload,
      additionalErrorCount: 3,
    });

    expect(diagnostic.message).toContain('additionalErrors=3');
    expect(Buffer.byteLength(diagnostic.message, 'utf8')).toBeLessThanOrEqual(DEFAULT_BOUNDED_DIAGNOSTIC_OPTIONS.maxMessageBytes);
    expect(diagnostic.message).not.toContain('SENTINEL_BEYOND_EXCERPT');
  });

  it('formats TypeBox schema paths and received value summaries from the failing pointer', () => {
    const payload = { ...hugeInvalidPayload() as Record<string, unknown>, plans: [{ frontmatter: { id: 'p', name: 'P' }, body: { raw: 'not a string' } }] };
    const parsed = safeParseWithSchema(planSetSubmissionSchema, payload);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const output = formatPlannerToolSchemaValidationError({
      toolName: 'submit_plan_set',
      schema: planSetSubmissionSchema,
      errors: parsed.error.errors,
      fullPayload: payload,
    });

    expect(output).toContain('schemaPath=plans.0.body');
    expect(output).toContain('expectedType=string');
    expect(output).toContain('receivedType=object');
  });

  it('formats semantic validation errors with logical path and full payload hash', () => {
    const payload = semanticInvalidPayload();
    const validation = validatePlanSetSubmission(payload);
    expect(validation.success).toBe(false);
    if (validation.success) return;

    const output = formatPlannerToolSemanticValidationError({
      toolName: 'submit_plan_set',
      errors: validation.error.errors,
      fullPayload: payload,
      expectedType: 'valid plan-set submission',
    });

    const expectedHash = createHash('sha256').update(JSON.stringify(sortForJson(payload))).digest('hex');
    expect(output).toContain('schemaPath=orchestration.plans');
    expect(output).toContain('expectedType=valid plan-set submission');
    expect(output).toContain(`payloadSha256=${expectedHash}`);
  });

  it('runPlanner returns bounded diagnostics for huge invalid submit_plan_set payloads', async () => {
    const backend = new StubHarness([{ toolCalls: [{ tool: 'submit_plan_set', toolUseId: 'tu-1', input: hugeInvalidPayload(), output: '' }] }]);

    await expect(collectEvents(runPlanner('Build huge thing', {
      harness: backend,
      cwd: makeTempDir(),
      auto: true,
      scope: 'excursion',
    }))).rejects.toThrow();

    const tools = backend.customToolSets[0] ?? [];
    const output = await tools.find(t => t.name === 'submit_plan_set')!.handler(hugeInvalidPayload());
    expect(Buffer.byteLength(output, 'utf8')).toBeLessThanOrEqual(DEFAULT_BOUNDED_DIAGNOSTIC_OPTIONS.maxMessageBytes);
    expect(output).toContain('schemaPath=');
    expect(output).toContain('expectedType=');
    expect(output).toContain('receivedType=');
    expect(output).toContain('payloadBytes=');
    expect(output).toContain('payloadSha256=');
    expect(output).not.toContain('SENTINEL_BEYOND_EXCERPT');
  });

  it('formats TypeBox and semantic submit_architecture failures without raw payload echo', () => {
    const schemaPayload = hugeInvalidArchitecturePayload();
    const parsed = safeParseWithSchema(architectureSubmissionSchema, schemaPayload);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const output = formatPlannerToolSchemaValidationError({
        toolName: 'submit_architecture',
        schema: architectureSubmissionSchema,
        errors: parsed.error.errors,
        fullPayload: schemaPayload,
      });

      expect(output).toContain('schemaPath=modules.0.description');
      expect(output).toContain('expectedType=string');
      expect(output).toContain('receivedType=object');
      expect(output).toContain('payloadSha256=');
      expect(output).not.toContain('ARCH_SENTINEL_BEYOND_EXCERPT');
    }

    const semanticPayload = semanticInvalidArchitecturePayload();
    const validation = validateArchitectureSubmission(semanticPayload);
    expect(validation.success).toBe(false);
    if (!validation.success) {
      const output = formatPlannerToolSemanticValidationError({
        toolName: 'submit_architecture',
        errors: validation.error.errors,
        fullPayload: semanticPayload,
        expectedType: 'valid architecture submission',
      });
      expect(output).toContain('schemaPath=modules.0.dependsOn');
      expect(output).toContain('expectedType=valid architecture submission');
      expect(output).toContain('payloadBytes=');
    }
  });

  it('runPlanner returns bounded diagnostics for huge invalid submit_architecture payloads', async () => {
    const backend = new StubHarness([{ toolCalls: [{ tool: 'submit_architecture', toolUseId: 'tu-arch', input: hugeInvalidArchitecturePayload(), output: '' }] }]);

    await expect(collectEvents(runPlanner('Build huge expedition thing', {
      harness: backend,
      cwd: makeTempDir(),
      auto: true,
      scope: 'expedition',
    }))).rejects.toThrow();

    const toolResult = backend.customToolSets[0]?.find(t => t.name === 'submit_architecture');
    expect(toolResult).toBeDefined();
    const output = await toolResult!.handler(hugeInvalidArchitecturePayload());
    expect(Buffer.byteLength(output, 'utf8')).toBeLessThanOrEqual(DEFAULT_BOUNDED_DIAGNOSTIC_OPTIONS.maxMessageBytes);
    expect(output).toContain('schemaPath=');
    expect(output).toContain('expectedType=');
    expect(output).toContain('receivedType=');
    expect(output).toContain('payloadSha256=');
    expect(output).not.toContain('ARCH_SENTINEL_BEYOND_EXCERPT');
  });

  it('small valid submit_plan_set payload still completes planning', async () => {
    const payload: PlanSetSubmission = {
      description: 'A small plan set',
      plans: [{ frontmatter: { id: 'plan-01-small', name: 'Small' }, body: '# Small' }],
      orchestration: { validate: [], plans: [{ id: 'plan-01-small', dependsOn: [] }] },
    };
    const backend = new StubHarness([{ toolCalls: [{ tool: 'submit_plan_set', toolUseId: 'tu-1', input: payload, output: '' }] }]);

    const events = await collectEvents(runPlanner('Build small thing', {
      harness: backend,
      cwd: makeTempDir(),
      auto: true,
      scope: 'excursion',
    }));

    expect(filterEvents(events, 'planning:complete')).toHaveLength(1);
  });
});

function sortForJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortForJson(v)]));
  }
  return value;
}
