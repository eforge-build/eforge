import { describe, it, expect } from 'vitest';
import { runIntake, IntakeSubmissionError, MAX_INVALID_INTAKE_SUBMISSIONS, type IntakeResult } from '@eforge-build/engine/agents/intake';
import type { EforgeEvent } from '@eforge-build/engine/events';
import { StubHarness, type StubScriptedEvent } from './stub-harness.js';
import { intakeSubmissionCall, intakeResponse, type IntakeCriterionInput } from './intake-test-helpers.js';

const FORMATTED_BODY = [
  '# Add Health Check Endpoint',
  '',
  '## Problem / Motivation',
  '',
  'Load balancers need a health probe.',
  '',
  '## Acceptance Criteria',
  '',
  '- A test verifies that GET /health returns HTTP 200.',
  '- A test verifies that the GET /health response body has status "ok".',
].join('\n');

const VALID_CRITERIA: IntakeCriterionInput[] = [
  { text: 'A test verifies that GET /health returns HTTP 200.', sourceQuote: 'A test verifies that GET /health returns HTTP 200.', confidence: 0.95 },
  { text: 'A test verifies that the GET /health response body has status "ok".', sourceQuote: 'A test verifies that the GET /health response body has status "ok".', confidence: 0.9 },
];

async function collect(harness: StubHarness, options: Partial<Parameters<typeof runIntake>[0]> = {}): Promise<{ events: EforgeEvent[]; result: IntakeResult }> {
  const events: EforgeEvent[] = [];
  const gen = runIntake({ harness, cwd: process.cwd(), sourceContent: 'raw input', verbose: true, ...options });
  let iteration = await gen.next();
  while (!iteration.done) {
    events.push(iteration.value);
    iteration = await gen.next();
  }
  return { events, result: iteration.value };
}

function toolResults(events: EforgeEvent[]): string[] {
  return events
    .filter((event): event is Extract<EforgeEvent, { type: 'agent:tool_result' }> => event.type === 'agent:tool_result')
    .map((event) => String(event.output));
}

describe('runIntake wiring', () => {
  it('runs under the formatter role with tools none and the submission tool registered', async () => {
    const harness = new StubHarness([intakeResponse(FORMATTED_BODY, VALID_CRITERIA)]);
    const { events, result } = await collect(harness);

    expect(harness.calls[0].tools).toBe('none');
    expect(harness.calls[0].customTools?.map((tool) => tool.name)).toEqual(['submit_intake']);
    expect(events.find((event) => event.type === 'agent:start')?.agent).toBe('formatter');
    expect(harness.prompts[0]).toContain('submit_intake');
    expect(harness.prompts[0]).toContain('raw input');
    expect(result.body).toBe(FORMATTED_BODY);
    expect(result.inventory.criteria.map((criterion) => criterion.id)).toEqual(['ac-001', 'ac-002']);
  });

  it('feeds validation errors back to the model and accepts a corrected resubmission', async () => {
    // Reproduces the eval failure: a sourceQuote stitched from a parent list
    // line plus a non-adjacent child bullet is not contiguous source text.
    const stitched: IntakeCriterionInput[] = [
      VALID_CRITERIA[0],
      { ...VALID_CRITERIA[1], sourceQuote: '## Acceptance Criteria - A test verifies that the GET /health response body has status "ok".' },
    ];
    const harness = new StubHarness([{
      events: [
        intakeSubmissionCall(FORMATTED_BODY, stitched),
        intakeSubmissionCall(FORMATTED_BODY, VALID_CRITERIA),
      ],
      text: 'Corrected and resubmitted.',
    }]);

    const { events, result } = await collect(harness);
    const outputs = toolResults(events);
    expect(outputs[0]).toContain('[ungrounded-source-quote]');
    expect(outputs[0]).toContain('call the submission tool again');
    expect(outputs[1]).toBe('Intake submitted successfully.');
    expect(result.inventory.criteria).toHaveLength(2);
  });

  it('hints when an ungrounded quote matches the raw input instead of formattedBody', async () => {
    const rawOnlyQuote: IntakeCriterionInput[] = [
      { ...VALID_CRITERIA[0], sourceQuote: 'only present in the raw source' },
    ];
    const harness = new StubHarness([{
      events: [
        intakeSubmissionCall(FORMATTED_BODY, rawOnlyQuote),
        intakeSubmissionCall(FORMATTED_BODY, [VALID_CRITERIA[0]]),
      ],
      text: 'done',
    }]);

    const { events } = await collect(harness, { sourceContent: 'Context: only present in the raw source.' });
    expect(toolResults(events)[0]).toContain('appears in the raw input but not in your formattedBody');
  });

  it('accepts quotes that differ only by smart quotes and backticks', async () => {
    const cosmetic: IntakeCriterionInput[] = [
      { text: 'A test verifies that the GET /health response body has status "ok".', sourceQuote: 'A test verifies that the GET /health response body has status “ok”.', confidence: 0.9 },
    ];
    const harness = new StubHarness([intakeResponse(FORMATTED_BODY, cosmetic)]);
    const { result } = await collect(harness);
    expect(result.inventory.criteria).toHaveLength(1);
  });

  it('returns schema validation errors for malformed payloads without consuming the submission', async () => {
    const malformed: StubScriptedEvent = { kind: 'tool_call', tool: 'submit_intake', toolUseId: 'bad-1', input: { criteria: 'nope' }, output: '' };
    const harness = new StubHarness([{
      events: [malformed, intakeSubmissionCall(FORMATTED_BODY, VALID_CRITERIA)],
      text: 'done',
    }]);
    const { events, result } = await collect(harness);
    expect(toolResults(events)[0]).toContain('did not validate against the schema');
    expect(result.inventory.criteria).toHaveLength(2);
  });

  it('counts schema-invalid payloads against the budget and surfaces them when intake fails', async () => {
    const malformed: StubScriptedEvent = { kind: 'tool_call', tool: 'submit_intake', toolUseId: 'bad-1', input: { criteria: 'nope' }, output: '' };
    const harness = new StubHarness([{ events: [malformed], text: 'gave up' }]);
    await expect(collect(harness)).rejects.toThrow(/1 invalid attempt.*invalid-schema/s);
  });

  it('rejects a second valid submission', async () => {
    const harness = new StubHarness([{
      events: [
        intakeSubmissionCall(FORMATTED_BODY, VALID_CRITERIA),
        intakeSubmissionCall(FORMATTED_BODY, [VALID_CRITERIA[0]]),
      ],
      text: 'done',
    }]);
    const { events, result } = await collect(harness);
    expect(toolResults(events)[1]).toContain('already submitted');
    expect(result.inventory.criteria).toHaveLength(2);
  });

  it('fails closed when the agent never submits', async () => {
    const harness = new StubHarness([{ text: 'Here is the PRD as plain text instead.' }]);
    await expect(collect(harness)).rejects.toThrow(IntakeSubmissionError);
    await expect(collect(new StubHarness([{ text: 'still no tool call' }]))).rejects.toThrow(/without a valid submission/);
  });

  it('fails closed with the last diagnostics when every submission is invalid', async () => {
    const ungrounded: IntakeCriterionInput[] = [
      { ...VALID_CRITERIA[0], sourceQuote: 'not anywhere in the body' },
    ];
    const harness = new StubHarness([{
      events: [intakeSubmissionCall(FORMATTED_BODY, ungrounded)],
      text: 'gave up',
    }]);
    await expect(collect(harness)).rejects.toThrow(/1 invalid attempt.*ungrounded-source-quote/s);
  });

  it('tells the model to stop once the invalid-submission budget is exhausted', async () => {
    const ungrounded: IntakeCriterionInput[] = [
      { ...VALID_CRITERIA[0], sourceQuote: 'not anywhere in the body' },
    ];
    const attempts = Array.from({ length: MAX_INVALID_INTAKE_SUBMISSIONS }, () => intakeSubmissionCall(FORMATTED_BODY, ungrounded));
    const harness = new StubHarness([{ events: attempts, text: 'exhausted' }]);

    const events: EforgeEvent[] = [];
    const gen = runIntake({ harness, cwd: process.cwd(), sourceContent: 'raw input', verbose: true });
    const drain = async () => {
      let iteration = await gen.next();
      while (!iteration.done) {
        events.push(iteration.value);
        iteration = await gen.next();
      }
    };
    await expect(drain()).rejects.toThrow(IntakeSubmissionError);

    const outputs = toolResults(events);
    expect(outputs).toHaveLength(MAX_INVALID_INTAKE_SUBMISSIONS);
    expect(outputs[MAX_INVALID_INTAKE_SUBMISSIONS - 1]).toContain('Submission budget exhausted');
    expect(outputs[MAX_INVALID_INTAKE_SUBMISSIONS - 1]).not.toContain('call the submission tool again');
  });

  it('rejects empty criteria unless allowNoAcceptanceCriteria is set', async () => {
    const emptyThenNothing = new StubHarness([{ events: [intakeSubmissionCall(FORMATTED_BODY, [])], text: 'done' }]);
    await expect(collect(emptyThenNothing)).rejects.toThrow(/empty/i);

    const allowed = new StubHarness([{ events: [intakeSubmissionCall(FORMATTED_BODY, [], ['No acceptance criteria found'])], text: 'done' }]);
    const { result } = await collect(allowed, { allowNoAcceptanceCriteria: true });
    expect(result.inventory.criteria).toEqual([]);
    expect(result.inventory.warnings).toEqual(['No acceptance criteria found']);
  });
});
