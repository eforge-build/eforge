import { describe, expect, it } from 'vitest';

import { piHarnessInternalsForTest } from '../packages/engine/src/harnesses/pi.js';

describe('PiHarness tool infrastructure classification', () => {
  it('does not classify successful tool output containing theme-init text as infrastructure failure', () => {
    expect(piHarnessInternalsForTest.isPiToolExecutionInfrastructureError({
      type: 'tool_execution_end',
      toolCallId: 'call-1',
      toolName: 'bash',
      result: 'test fixture: Theme not initialized. Call initTheme() first.',
      isError: false,
    })).toBe(false);
  });

  it('classifies failed tool execution output with theme-init text as infrastructure failure', () => {
    expect(piHarnessInternalsForTest.isPiToolExecutionInfrastructureError({
      type: 'tool_execution_end',
      toolCallId: 'call-1',
      toolName: 'bash',
      result: 'Theme not initialized. Call initTheme() first.',
      isError: true,
    })).toBe(true);
  });

  it('does not classify ordinary failed tool output as infrastructure failure', () => {
    expect(piHarnessInternalsForTest.isPiToolExecutionInfrastructureError({
      type: 'tool_execution_end',
      toolCallId: 'call-1',
      toolName: 'bash',
      result: 'grep exited with code 1',
      isError: true,
    })).toBe(false);
  });
});

describe('PiHarness result text extraction', () => {
  it('extracts streamed delta text from OpenAI Responses-style message_update events', () => {
    const event = {
      type: 'message_update',
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: '{"ok":true}',
      },
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: '{"ok":true}' }],
      },
    };

    expect(piHarnessInternalsForTest.extractMessageUpdateText(event)).toEqual({
      fullText: '{"ok":true}',
    });
  });

  it('falls back to delta text when partial/message content is absent', () => {
    const event = {
      type: 'message_update',
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: 'hello',
      },
    };

    expect(piHarnessInternalsForTest.extractMessageUpdateText(event)).toEqual({
      delta: 'hello',
    });
  });

  it('extracts the last assistant text from final agent_end messages', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'prompt' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'first' }] },
      { role: 'assistant', content: [{ type: 'output_text', text: 'final' }] },
    ];

    expect(piHarnessInternalsForTest.extractLastAssistantMessageText(messages)).toBe('final');
  });

  it('ignores non-text content blocks', () => {
    const message = {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'toolu_1' },
        { type: 'text', text: 'visible' },
      ],
    };

    expect(piHarnessInternalsForTest.extractAssistantMessageText(message)).toBe('visible');
  });
});
