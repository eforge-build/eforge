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
});
