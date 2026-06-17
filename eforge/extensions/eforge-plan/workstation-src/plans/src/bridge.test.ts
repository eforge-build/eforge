import { describe, expect, it } from 'vitest';
import { getBridge } from './bridge';

describe('mock bridge roadmap recommendations refresh', () => {
  it('overlays the active roadmap refresh task onto recommendation responses', async () => {
    delete (window as Window & { eforge?: unknown }).eforge;
    const bridge = getBridge();

    const refresh = await bridge.invokeAction<{ task: { taskId: string } }>('refresh-recommendations');
    const recommendations = await bridge.invokeAction<{ activeRefreshTask?: { taskId: string } }>('get-recommendations');

    expect(recommendations.activeRefreshTask?.taskId).toBe(refresh.task.taskId);
  });

  it('omits mock planning artifact board data unless explicitly requested', async () => {
    delete (window as Window & { eforge?: unknown }).eforge;
    const bridge = getBridge();

    const defaultOutput = await bridge.invokeAction<{ artifacts: unknown[]; board?: unknown }>('list-planning-artifacts');
    const compactOutput = await bridge.invokeAction<{ artifacts: unknown[]; board?: unknown }>('list-planning-artifacts', { includeBoard: false });
    const richOutput = await bridge.invokeAction<{ artifacts: unknown[]; board?: unknown }>('list-planning-artifacts', { includeBoard: true });

    expect(defaultOutput.artifacts.length).toBeGreaterThan(0);
    expect(defaultOutput.board).toBeUndefined();
    expect(compactOutput.artifacts.length).toBeGreaterThan(0);
    expect(compactOutput.board).toBeUndefined();
    expect(richOutput.artifacts.length).toBeGreaterThan(0);
    expect(richOutput.board).toEqual(expect.any(Object));
  });
});
