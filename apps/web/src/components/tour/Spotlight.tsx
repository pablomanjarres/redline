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
 *
 * ## Why the hole can glide
 *
 * Each panel's geometry is an affine function of the hole rectangle: the top
 * panel's height is the hole's top, the left panel's width is the hole's left,
 * and so on. Interpolating all four independently with the same easing and the
 * same duration therefore yields, on every intermediate frame, exactly the four
 * panels of an intermediate hole. The tiling stays gap-free for the whole
 * transition, so the light can travel between controls without leaking a bright
 * seam at any point.
 *
 * `tween` is true only for the moment after a step changes. During ordinary
 * rectangle tracking (the reader scrolls, a chart mounts) it is false, because a
 * transition there would leave the scrim lagging behind the page.
 */

const PAD = 8;
const RADIUS = 12;

const GLIDE = [
  'top var(--rl-tour-glide) var(--rl-tour-ease)',
  'left var(--rl-tour-glide) var(--rl-tour-ease)',
  'width var(--rl-tour-glide) var(--rl-tour-ease)',
  'height var(--rl-tour-glide) var(--rl-tour-ease)',
].join(', ');

/** A scrim panel. Fixed, dark, and it eats pointer events so nobody wanders off. */
function Panel({ style, onClick, tween }: { style: CSSProperties; onClick: () => void; tween: boolean }) {
  return (
    <div
      aria-hidden
      onClick={onClick}
      onPointerDown={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        background: 'var(--rl-tour-scrim)',
        pointerEvents: 'auto',
        transition: tween ? GLIDE : undefined,
        ...style,
      }}
    />
  );
}

export function Spotlight({
  rect,
  viewport,
  onScrimClick,
  reducedMotion,
  tween,
}: {
  /** The target rectangle in viewport space, or null for a full scrim with no hole. */
  rect: TourRect | null;
  viewport: { w: number; h: number };
  onScrimClick: () => void;
  reducedMotion: boolean;
  /** True for the moment after a step change, when the hole is travelling. */
  tween: boolean;
}) {
  const glide = tween && !reducedMotion;

  if (!rect) {
    return <Panel tween={false} onClick={onScrimClick} style={{ inset: 0 }} />;
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
      <Panel tween={glide} onClick={onScrimClick} style={{ top: 0, left: 0, right: 0, height: top }} />
      <Panel tween={glide} onClick={onScrimClick} style={{ top: bottom, left: 0, right: 0, bottom: 0 }} />
      <Panel tween={glide} onClick={onScrimClick} style={{ top, left: 0, width: left, height }} />
      <Panel tween={glide} onClick={onScrimClick} style={{ top, left: right, right: 0, height }} />

      {/* The ring on the hole edge. Never intercepts a pointer.
          Deliberately not keyed per target: it must keep its identity across a
          step change so it travels with the panels. It mounts once, when a hole
          first opens, which is exactly when the arrival flare should play. */}
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
          transition: glide ? GLIDE : undefined,
          // Land, then breathe. The halo waits out the landing before it starts.
          animation: reducedMotion
            ? undefined
            : 'rl-tour-land var(--rl-tour-glide) var(--rl-tour-ease) both, rl-tour-halo 2s ease-in-out 340ms infinite',
        }}
      />
    </>
  );
}
