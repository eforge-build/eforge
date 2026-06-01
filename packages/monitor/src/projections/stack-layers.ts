import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { safeParseWithSchema, StackLayerWireSchema, type StackLayerWire } from '@eforge-build/client';

export function stackLayersToWire(cwd: string): StackLayerWire[] {
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(resolve(cwd, '.eforge', 'stacks', 'layers.json'), 'utf-8')); } catch { return []; }
  const layerItems = parsed !== null && typeof parsed === 'object' && (parsed as { version?: unknown }).version === 1 && Array.isArray((parsed as { layers?: unknown }).layers)
    ? (parsed as { layers: unknown[] }).layers
    : [];
  const layers: StackLayerWire[] = [];
  for (const item of layerItems) {
    const result = safeParseWithSchema(StackLayerWireSchema, item);
    if (!result.success) return [];
    layers.push(result.data);
  }
  return layers;
}
