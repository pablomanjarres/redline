'use client';

import { Component, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTour } from '@/state/tour';
import { useTargetRect } from '@/lib/tour/use-target-rect';
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

function TourOverlayInner() {
  const tour = useTour();
  const viewport = useViewport();
  const reducedMotion = useReducedMotion();
  const { rect, status } = useTargetRect(tour.step.target, tour.active);

  // A target that never arrived floats the card in the middle instead of
  // spotlighting a hole that is not there.
  const holeRect = status === 'found' ? rect : null;

  if (!tour.active || viewport.w === 0) return null;

  return (
    // The root spans the viewport but must never intercept a pointer: the scrim
    // panels and the coach mark opt back in individually. Without this, the root
    // would sit over the hole and swallow the very click the step asks for.
    <div className="rl-tour-root rl-no-print" style={{ position: 'fixed', inset: 0, zIndex: 1000, pointerEvents: 'none' }}>
      <Spotlight rect={holeRect} viewport={viewport} onScrimClick={() => {}} reducedMotion={reducedMotion} />

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
