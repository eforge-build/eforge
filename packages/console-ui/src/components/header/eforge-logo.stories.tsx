import * as React from 'react';
import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { EforgeLogo } from './eforge-logo';

/**
 * The animated eforge "e", rendered as a little forge. The ring is the hearth,
 * the crossbar is the workpiece, and the ring's interior is the glowing cavity.
 *
 * It is driven by build activity via the `activeBuilds` count:
 * - **0** — idle: the familiar green mark
 * - **1+** — a build is running: the forge ignites (ring heats up), then settles
 *   into a warm hot-forge glow with a white-hot, pulsing workpiece and a
 *   throbbing amber cavity. The workpiece heartbeat **quickens** the more builds
 *   run (≈1.6s at one build, down to a 0.6s floor), while the ring keeps its
 *   steady forge breath.
 *
 * Respects `prefers-reduced-motion`: animations are suppressed and each state
 * renders as a static frame.
 */
const meta = {
  title: 'Header/EforgeLogo',
  component: EforgeLogo,
  parameters: { layout: 'centered' },
  argTypes: {
    size: { control: { type: 'range', min: 16, max: 160, step: 4 } },
    activeBuilds: { control: { type: 'range', min: 0, max: 6, step: 1 } },
    title: { control: 'text' },
  },
} satisfies Meta<typeof EforgeLogo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Idle — no build running. The familiar green mark, unlit. */
export const Idle: Story = {
  args: { size: 24, activeBuilds: 0 },
};

/** Active — one build running. Ignites on mount, then runs hot. */
export const Active: Story = {
  args: { size: 24, activeBuilds: 1 },
};

/** Large active render — inspect the white-hot workpiece, warm ring, and amber cavity. */
export const Large: Story = {
  args: { size: 120, activeBuilds: 1 },
};

/** The header context: idle mark beside the wordmark. */
export const InHeader: Story = {
  args: { size: 24, activeBuilds: 0 },
  render: (args) => (
    <div className="flex items-center gap-2">
      <EforgeLogo {...args} />
      <span className="font-semibold text-foreground">eforge</span>
    </div>
  ),
};

/** Idle vs active, side by side, at a few sizes. */
export const States: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-6">
      {[
        { label: 'idle (no build)', activeBuilds: 0 },
        { label: 'active (building)', activeBuilds: 1 },
      ].map((row) => (
        <div key={row.label} className="flex items-center gap-8">
          <span className="w-32 text-xs text-muted-foreground">{row.label}</span>
          {[16, 24, 48, 96].map((size) => (
            <EforgeLogo key={size} size={size} activeBuilds={row.activeBuilds} />
          ))}
        </div>
      ))}
    </div>
  ),
};

/** Pulse cadence by build count — watch the workpiece heartbeat speed up. */
export const PulseCadence: StoryObj = {
  render: () => (
    <div className="flex items-end gap-8">
      {[1, 2, 3, 5].map((n) => (
        <div key={n} className="flex flex-col items-center gap-2">
          <EforgeLogo size={72} activeBuilds={n} />
          <span className="text-xs text-muted-foreground">
            {n} build{n > 1 ? 's' : ''}
          </span>
        </div>
      ))}
    </div>
  ),
};

/** Interactive: add/remove builds to watch the ignite and the quickening pulse. */
export const Toggle: StoryObj = {
  render: () => {
    const [count, setCount] = useState(0);
    return (
      <div className="flex flex-col items-center gap-4">
        <EforgeLogo size={96} activeBuilds={count} />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setCount((c) => Math.max(0, c - 1))}
            className="rounded border border-border px-3 py-1 text-sm text-foreground hover:bg-muted"
          >
            – build
          </button>
          <span className="w-24 text-center text-sm text-muted-foreground">
            {count} active
          </span>
          <button
            type="button"
            onClick={() => setCount((c) => c + 1)}
            className="rounded border border-border px-3 py-1 text-sm text-foreground hover:bg-muted"
          >
            + build
          </button>
        </div>
      </div>
    );
  },
};
