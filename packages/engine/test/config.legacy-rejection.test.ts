/**
 * Tests that configYamlSchema rejects legacy top-level fields (backend:, pi:, claudeSdk:)
 * with a migration-pointer message pointing to agentRuntimes + defaultAgentRuntime,
 * and that any other unrecognized top-level key is rejected with a clear message.
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

describe('configYamlSchema unknown-key rejection', () => {
  it('rejects an unrecognized top-level key (e.g. profiles:) with the recognized-key list', () => {
    const result = configYamlSchema.safeParse({
      profiles: { docs: { extends: 'errand' } },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'profiles');
      expect(issue).toBeDefined();
      expect(issue!.message).toMatch(/Unrecognized key "profiles"/);
      expect(issue!.message).toMatch(/Recognized keys/);
      // Spot-check a couple of known keys appear in the recognized list.
      expect(issue!.message).toMatch(/agentRuntimes/);
      expect(issue!.message).toMatch(/build/);
    }
  });

  it('rejects a misspelled top-level key (e.g. agent: instead of agents:)', () => {
    const result = configYamlSchema.safeParse({ agent: { maxTurns: 30 } });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'agent');
      expect(issue).toBeDefined();
      expect(issue!.message).toMatch(/Unrecognized key "agent"/);
    }
  });

  it('accepts a config containing only known top-level keys', () => {
    const result = configYamlSchema.safeParse({
      maxConcurrentBuilds: 2,
      build: { postMergeCommands: ['pnpm install'] },
      agents: { maxTurns: 30 },
      prdQueue: { dir: 'eforge/queue' },
    });
    expect(result.success).toBe(true);
  });
});
