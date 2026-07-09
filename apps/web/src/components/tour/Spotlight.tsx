'use client';

import type { CSSProperties } from 'react';
import type { TourRect } from '@/lib/tour/use-target-rect';

/**
 * The spotlight: everything goes dark except the one control the reader should
 * touch next.
 *
 * The scrim is four rectangles (above, below, left of, right of the target), not
 * one element with a hole cut in it. The hole is therefore a real gap in the
 * document with nothing over it, so the spotlighted control keeps its own hit
 * testing, hover, and focus for free. A `clip-path` hole or a huge `box-shadow`
 * would both paint the same picture while leaving hit testing up to the browser.
 *
 * The scrim swallows every click that lands on it, so a reader cannot wander off
 * mid-step. The ring is `pointer-events: none` and sits on top of the hole edge.
 */

const PAD = 8;
const RADIUS = 12;

/** A scrim panel. Fixed, dark, and it eats pointer events so nobody wanders off. */
function Panel({ style, onClick }: { style: CSSProperties; onClick: () => void }) {
  return (
    <div
      aria-hidden
      onClick={onClick}
      onPointerDown={(e) => e.preventDefault()}
      style={{ position: 'fixed', background: 'var(--rl-tour-scrim)', pointerEvents: 'auto', ...style }}
    />
  );
}

export function Spotlight({
  rect,
  viewport,
  onScrimClick,
  reducedMotion,
}: {
  /** The target rectangle in viewport space, or null for a full scrim with no hole. */
  rect: TourRect | null;
  viewport: { w: number; h: number };
  onScrimClick: () => void;
  reducedMotion: boolean;
}) {
  if (!rect) {
    return (
      <Panel
        onClick={onScrimClick}
        style={{ inset: 0, transition: reducedMotion ? undefined : 'opacity .2s ease' }}
      />
    );
  }

  // Inflate, then clamp to the viewport so a target that is partly offscreen
  // still produces four well-formed panels instead of negative dimensions.
  const top = Math.max(0, rect.top - PAD);
  const left = Math.max(0, rect.left - PAD);
  const right = Math.min(viewport.w, rect.left + rect.width + PAD);
  const bottom = Math.min(viewport.h, rect.top + rect.height + PAD);
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);

  return (
    <>
      <Panel onClick={onScrimClick} style={{ top: 0, left: 0, right: 0, height: top }} />
      <Panel onClick={onScrimClick} style={{ top: bottom, left: 0, right: 0, bottom: 0 }} />
      <Panel onClick={onScrimClick} style={{ top, left: 0, width: left, height }} />
      <Panel onClick={onScrimClick} style={{ top, left: right, right: 0, height }} />

      {/* the ring on the hole edge. Never intercepts a pointer. */}
      <div
        aria-hidden
        className="rl-tour-ring"
        style={{
          position: 'fixed',
          top,
          left,
          width,
          height,
          borderRadius: RADIUS,
          border: '2px solid var(--red)',
          pointerEvents: 'none',
          animation: reducedMotion ? undefined : 'rl-tour-halo 2s ease-in-out infinite',
        }}
      />
    </>
  );
}
