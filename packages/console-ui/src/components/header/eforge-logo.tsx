import * as React from 'react';
import { useEffect, useState } from 'react';

type ForgeState = 'idle' | 'igniting' | 'lit';

interface EforgeLogoProps {
  /** Pixel size of the square mark. */
  size?: number;
  /** Accessible label. */
  title?: string;
  /**
   * Number of builds currently running. Zero = idle green mark. One or more =
   * the forge ignites and runs hot; the workpiece's white-hot heartbeat beats
   * faster the more builds are running, while the ring keeps its steady breath.
   */
  activeBuilds?: number;
}

const RING_PATH = 'M 37.1 33.2 A 16 16 0 1 1 37.1 14.8';
const CROSSBAR = 'M 15 24 H 31';

/** Workpiece pulse period: ~1.6s for one build, quickening to a 0.6s floor. */
function pulseDuration(activeBuilds: number): number {
  return Math.max(0.6, 1.6 - (activeBuilds - 1) * 0.32);
}

/**
 * The eforge "e" rendered as a little forge: the ring is the hearth, the
 * crossbar is the workpiece, and the ring's interior is the glowing cavity.
 * Idle = the familiar green mark; building = ignite, then run hot with a
 * white-hot workpiece pulsing faster the more builds run. The ring keeps the
 * brand green throughout -- the heat (amber) stays inside the hearth.
 */
export function EforgeLogo({ size = 24, title = 'eforge', activeBuilds = 0 }: EforgeLogoProps) {
  const active = activeBuilds > 0;
  const [state, setState] = useState<ForgeState>(active ? 'igniting' : 'idle');

  // Drive the forge off build activity: idle -> igniting -> lit when a build
  // starts; back to idle when none are running. Re-igniting from `lit` is a
  // no-op so the warm state isn't interrupted while builds keep running.
  useEffect(() => {
    setState((prev) => (active ? (prev === 'lit' ? 'lit' : 'igniting') : 'idle'));
  }, [active]);

  return (
    <span
      className="relative inline-flex items-center justify-center"
      style={
        {
          width: size,
          height: size,
          ['--eforge-pulse' as string]: `${pulseDuration(activeBuilds)}s`,
        } as React.CSSProperties
      }
    >
      <span
        className="eforge-cavity"
        data-state={state}
        aria-hidden
        style={{ width: size * 0.62, height: size * 0.62 }}
      />
      <svg
        className="relative"
        viewBox="0 0 48 48"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={4}
        strokeLinecap="round"
        role="img"
        aria-label={title}
      >
        {/* ring = the forge: ignites, then a warm hot-forge breath */}
        <path
          className="eforge-ring"
          data-state={state}
          d={RING_PATH}
          onAnimationEnd={() => setState((s) => (s === 'igniting' ? 'lit' : s))}
        />
        {/* crossbar = the workpiece: idle green, then a white-hot heartbeat */}
        <path className="eforge-bar" data-state={state} d={CROSSBAR} />
      </svg>
    </span>
  );
}
