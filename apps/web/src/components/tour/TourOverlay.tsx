'use client';

import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTour } from '@/state/tour';
import { useTargetRect, type TourRect } from '@/lib/tour/use-target-rect';
import { CoachMark } from '@/components/tour/CoachMark';
import { Spotlight } from '@/components/tour/Spotlight';

/**
 * The tour overlay. Portaled to <body> so it escapes the app shell, which is a
 * fixed-height clipped flex column, and so it sits above the masthead's own
 * stacking context.
 *
 * The whole thing is wrapped in a boundary that renders nothing on error. A
 * broken tour must never take the demo down with it.
 */

class TourBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    console.error('Guided tour failed and was dismissed', error);
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

function useViewport(): { w: number; h: number } {
  const [vp, setVp] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const read = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);
  return vp;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const read = () => setReduced(mq.matches);
    read();
    mq.addEventListener('change', read);
    return () => mq.removeEventListener('change', read);
  }, []);
  return reduced;
}

/**
 * True for the moment after the step changes.
 *
 * The scrim, the ring, and the card transition their geometry only inside this
 * window. Leaving the transition on permanently would make all three lag behind
 * the page while the reader scrolls, because the rectangle is re-read every
 * frame. Motion belongs to the step change, not to the tracking.
 */
function useStepTween(stepId: string, durationMs: number): boolean {
  const [tween, setTween] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false; // the opening step has no previous hole to travel from
      return;
    }
    setTween(true);
    const t = setTimeout(() => setTween(false), durationMs);
    return () => clearTimeout(t);
  }, [stepId, durationMs]);

  return tween;
}

/** Matches --rl-tour-glide, plus a frame of slack so the transition can finish. */
const GLIDE_MS = 380;

function TourOverlayInner() {
  const tour = useTour();
  const viewport = useViewport();
  const reducedMotion = useReducedMotion();
  const { rect, status } = useTargetRect(tour.step.target, tour.active);
  const tween = useStepTween(tour.step.id, GLIDE_MS);

  // Hold the last hole while the next target is being found.
  //
  // Every step change passes through `searching` for at least a frame. Dropping
  // to a full scrim there would unmount the four panels and mount four fresh
  // ones at the new position, and a brand new element cannot transition, so the
  // hole would snap rather than glide (and the scrim would flash opaque between
  // steps). Keeping the previous rectangle preserves element identity, so the
  // light stays lit and travels to the next control.
  const held = useRef<TourRect | null>(null);
  if (!tour.active || !tour.step.target || status === 'missing') held.current = null;
  else if (status === 'found' && rect) held.current = rect;

  // A target that never arrived floats the card in the middle instead of
  // spotlighting a hole that is not there.
  const holeRect = status === 'found' ? rect : held.current;

  if (!tour.active || viewport.w === 0) return null;

  return (
    // The root spans the viewport but must never intercept a pointer: the scrim
    // panels and the coach mark opt back in individually. Without this, the root
    // would sit over the hole and swallow the very click the step asks for.
    <div
      className="rl-tour-root rl-no-print"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        pointerEvents: 'none',
        // The room dims once, when the tour opens.
        animation: reducedMotion ? undefined : 'rl-tour-in 280ms ease both',
      }}
    >
      <Spotlight
        rect={holeRect}
        viewport={viewport}
        onScrimClick={() => {}}
        reducedMotion={reducedMotion}
        tween={tween}
      />

      {/* the announcement a screen reader hears when the step changes */}
      <div aria-live="polite" style={SR_ONLY}>
        {`Step ${tour.index + 1} of ${tour.total}. ${tour.step.headline}. ${tour.step.what}`}
      </div>

      <CoachMark
        step={tour.step}
        index={tour.index}
        total={tour.total}
        mode={tour.mode}
        paused={tour.paused}
        rect={holeRect}
        viewport={viewport}
        reducedMotion={reducedMotion}
        tween={tween}
        progress={tour.progress}
        onNext={tour.next}
        onBack={tour.back}
        onSkip={tour.stop}
        onTogglePause={tour.togglePause}
        onStartGuided={() => {
          tour.setMode('guided');
          tour.next();
        }}
        onStartPresenter={() => {
          tour.setMode('presenter');
          tour.next();
        }}
      />
    </div>
  );
}

const SR_ONLY = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;

export function TourOverlay() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <TourBoundary>
      <TourOverlayInner />
    </TourBoundary>,
    document.body,
  );
}
