/**
 * Tests that configYamlSchema rejects legacy top-level fields (backend:, pi:, claudeSdk:)
 * with a migration-pointer message pointing to agentRuntimes + defaultAgentRuntime.
 */
import { describe, it, expect } from 'vitest';
import { configYamlSchema } from '@eforge-build/engine/config';

describe('configYamlSchema legacy field rejection', () => {
  it('rejects scalar backend: with agentRuntimes + defaultAgentRuntime migration pointer', () => {
    const result = configYamlSchema.safeParse({ backend: 'claude-sdk' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join('\n');
      expect(messages).toMatch(/agentRuntimes/);
      expect(messages).toMatch(/defaultAgentRuntime/);
    }
  });

  it('rejects scalar backend: pi with agentRuntimes + defaultAgentRuntime migration pointer', () => {
    const result = configYamlSchema.safeParse({ backend: 'pi' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join('\n');
      expect(messages).toMatch(/agentRuntimes/);
      expect(messages).toMatch(/defaultAgentRuntime/);
    }
  });

  it('rejects top-level pi: with agentRuntimes + defaultAgentRuntime migration pointer', () => {
    const result = configYamlSchema.safeParse({ pi: { thinkingLevel: 'high' } });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join('\n');
      expect(messages).toMatch(/agentRuntimes/);
      expect(messages).toMatch(/defaultAgentRuntime/);
    }
  });

  it('rejects top-level claudeSdk: with agentRuntimes + defaultAgentRuntime migration pointer', () => {
    const result = configYamlSchema.safeParse({ claudeSdk: { disableSubagents: true } });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join('\n');
      expect(messages).toMatch(/agentRuntimes/);
      expect(messages).toMatch(/defaultAgentRuntime/);
    }
  });

  it('accepts valid agentRuntimes config without legacy fields', () => {
    const result = configYamlSchema.safeParse({
      agentRuntimes: { main: { harness: 'claude-sdk' } },
      defaultAgentRuntime: 'main',
    });
    expect(result.success).toBe(true);
  });
});
