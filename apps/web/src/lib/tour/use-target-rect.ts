'use client';

import { useEffect, useRef, useState } from 'react';
import { anchorSelector, type TourAnchor } from './anchors';

/** A viewport-space rectangle. Plain numbers, so React can compare it cheaply. */
export interface TourRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export type TargetStatus = 'idle' | 'searching' | 'found' | 'missing';

/** How long to wait for a target before giving up and floating the card. A check
 *  on the fixture target resolves in milliseconds, so three seconds is generous. */
const GIVE_UP_MS = 3000;

/** Sub-pixel jitter should not re-render. */
function same(a: TourRect | null, b: TourRect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Track a `data-tour` element's viewport rectangle.
 *
 * A single `requestAnimationFrame` loop reading one `getBoundingClientRect` is
 * both the cheapest and the most complete tracker available here. The app scrolls
 * inside a clipped `<main class="rl-scroll">` rather than the window, charts mount
 * after a check resolves, and the pipeline rail scrolls sideways on narrow screens.
 * A scroll listener plus a ResizeObserver plus a MutationObserver would cover those
 * three cases and still miss a CSS transition; the frame loop covers all of them and
 * only re-renders when the rectangle actually moves.
 *
 * If the element never appears within `GIVE_UP_MS`, the status flips to `missing`
 * and the caller floats the coach mark in the center instead of blocking the app.
 */
export function useTargetRect(
  target: TourAnchor | null,
  active: boolean,
): { rect: TourRect | null; status: TargetStatus } {
  const [rect, setRect] = useState<TourRect | null>(null);
  const [status, setStatus] = useState<TargetStatus>('idle');
  const rectRef = useRef<TourRect | null>(null);
  const scrolledFor = useRef<string | null>(null);

  useEffect(() => {
    if (!active || !target) {
      rectRef.current = null;
      setRect(null);
      setStatus('idle');
      return;
    }

    setStatus('searching');
    scrolledFor.current = null;
    let raf = 0;
    let deadline = 0;
    const selector = anchorSelector(target);

    const tick = (now: number) => {
      if (deadline === 0) deadline = now + GIVE_UP_MS;
      const el = document.querySelector<HTMLElement>(selector);

      if (el) {
        // Bring the target into view once per step, not on every frame.
        if (scrolledFor.current !== target) {
          scrolledFor.current = target;
          el.scrollIntoView({
            block: 'center',
            inline: 'nearest',
            behavior: prefersReducedMotion() ? 'auto' : 'smooth',
          });
        }
        const r = el.getBoundingClientRect();
        const next: TourRect = { top: r.top, left: r.left, width: r.width, height: r.height };
        if (!same(rectRef.current, next)) {
          rectRef.current = next;
          setRect(next);
        }
        setStatus('found');
      } else if (now > deadline) {
        rectRef.current = null;
        setRect(null);
        setStatus('missing');
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, active]);

  return { rect, status };
}
