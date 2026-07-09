'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { TourMode, TourStep } from '@/lib/tour/types';
import type { TourRect } from '@/lib/tour/use-target-rect';

/**
 * The coach mark: the card beside the spotlight. It carries what the control
 * does, what to put there, and why it matters, plus the controls that move the
 * tour. It is the only interactive thing on the scrim, and it is where focus
 * lives while a step is open.
 */

const CARD_W = 396;
const GAP = 16;
const MARGIN = 16;
/** A working estimate before the card measures itself; only used for the first frame. */
const CARD_H_GUESS = 260;

export interface CoachMarkProps {
  step: TourStep;
  index: number;
  total: number;
  mode: TourMode;
  paused: boolean;
  /** Null when the target is missing or the step is a centered card. */
  rect: TourRect | null;
  viewport: { w: number; h: number };
  reducedMotion: boolean;
  /** 0 to 1, presenter mode only. */
  progress: number;
  onNext(): void;
  onBack(): void;
  onSkip(): void;
  onTogglePause(): void;
  onStartGuided(): void;
  onStartPresenter(): void;
}

type Side = 'top' | 'bottom' | 'left' | 'right' | 'center';

/**
 * Pick the side with room, honoring an explicit placement when it fits.
 *
 * When nothing fits, which happens on a region taller than the viewport (the
 * design matrix, the audit board), fall back to the side with the most room
 * rather than to the center. A centered card would sit squarely on top of the
 * region it is describing.
 */
function choose(step: TourStep, rect: TourRect | null, vp: { w: number; h: number }, cardH: number): Side {
  if (!rect) return 'center';
  const room = {
    bottom: vp.h - (rect.top + rect.height) - GAP - MARGIN,
    top: rect.top - GAP - MARGIN,
    right: vp.w - (rect.left + rect.width) - GAP - MARGIN,
    left: rect.left - GAP - MARGIN,
  };
  const wanted = step.placement && step.placement !== 'auto' ? step.placement : null;
  if (wanted === 'bottom' && room.bottom >= cardH) return 'bottom';
  if (wanted === 'top' && room.top >= cardH) return 'top';
  if (wanted === 'right' && room.right >= CARD_W) return 'right';
  if (wanted === 'left' && room.left >= CARD_W) return 'left';

  if (room.bottom >= cardH) return 'bottom';
  if (room.top >= cardH) return 'top';
  if (room.right >= CARD_W) return 'right';
  if (room.left >= CARD_W) return 'left';

  // Nothing fits. Score the horizontal sides against the card width and the
  // vertical ones against its height, then take the roomiest.
  const scored: [Side, number][] = [
    ['right', room.right - CARD_W],
    ['left', room.left - CARD_W],
    ['bottom', room.bottom - cardH],
    ['top', room.top - cardH],
  ];
  scored.sort((a, b) => b[1] - a[1]);
  return scored[0]![0];
}

function position(side: Side, rect: TourRect | null, vp: { w: number; h: number }, cardH: number): CSSProperties {
  const clampX = (x: number) => Math.min(vp.w - CARD_W - MARGIN, Math.max(MARGIN, x));
  const clampY = (y: number) => Math.min(vp.h - cardH - MARGIN, Math.max(MARGIN, y));

  if (side === 'center' || !rect) {
    return { top: clampY((vp.h - cardH) / 2), left: clampX((vp.w - CARD_W) / 2) };
  }
  const cx = rect.left + rect.width / 2 - CARD_W / 2;
  const cy = rect.top + rect.height / 2 - cardH / 2;

  switch (side) {
    case 'bottom':
      return { top: clampY(rect.top + rect.height + GAP), left: clampX(cx) };
    case 'top':
      return { top: clampY(rect.top - GAP - cardH), left: clampX(cx) };
    case 'right':
      return { top: clampY(cy), left: clampX(rect.left + rect.width + GAP) };
    case 'left':
      return { top: clampY(cy), left: clampX(rect.left - GAP - CARD_W) };
  }
}

const kicker: CSSProperties = {
  font: '600 9.5px/1 var(--mono)',
  letterSpacing: '.2em',
  textTransform: 'uppercase',
};

const ghostBtn: CSSProperties = {
  font: '700 10.5px/1 var(--sans)',
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  background: 'transparent',
  border: '1px solid var(--edge-2)',
  padding: '10px 13px',
  borderRadius: 8,
  cursor: 'pointer',
};

const primaryBtn: CSSProperties = {
  font: '800 11px/1 var(--sans)',
  letterSpacing: '.07em',
  textTransform: 'uppercase',
  color: 'var(--surface)',
  background: 'var(--signal)',
  border: 'none',
  padding: '11px 16px',
  borderRadius: 8,
  cursor: 'pointer',
};

export function CoachMark(props: CoachMarkProps) {
  const { step, index, total, mode, paused, rect, viewport, reducedMotion, progress } = props;
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(CARD_H_GUESS);
  const headingId = `rl-tour-h-${step.id}`;
  const bodyId = `rl-tour-b-${step.id}`;

  // Move focus to the card on every step so a keyboard reader follows the tour.
  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
  }, [step.id]);

  // Measure before paint, so the card is placed against its real height rather
  // than the estimate. Copy length varies enough per step to matter.
  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight ?? 0;
    if (h > 0) setCardH((prev) => (Math.abs(prev - h) > 1 ? h : prev));
  }, [step.id, rect, viewport.w, viewport.h, mode, paused]);

  const side = choose(step, rect, viewport, cardH);
  const isWelcome = index === 0 && step.target === null;
  const waitingOnClick = step.advance === 'click';

  return (
    <div
      ref={cardRef}
      role="dialog"
      // Deliberately not a modal dialog. The whole point of a step is that the
      // reader reaches past the card and operates the spotlighted control, so
      // the rest of the page stays available to assistive technology.
      aria-modal="false"
      aria-labelledby={headingId}
      aria-describedby={bodyId}
      tabIndex={-1}
      className="rl-tour-card"
      // Read by the end-to-end driver so it can assert the card and the
      // spotlight agree on which control they are describing.
      data-tour-step={step.id}
      data-tour-target={step.target ?? ''}
      style={{
        position: 'fixed',
        // The overlay root is pointer-events:none. The card opts back in.
        pointerEvents: 'auto',
        width: CARD_W,
        maxWidth: `calc(100vw - ${MARGIN * 2}px)`,
        background: 'var(--panel)',
        border: '1px solid var(--edge-2)',
        borderRadius: 14,
        boxShadow: '0 30px 70px -24px rgba(16,24,40,.45), 0 0 0 1px rgba(255,255,255,.6) inset',
        padding: '20px 22px 16px',
        outline: 'none',
        animation: reducedMotion ? undefined : 'rl-rise .22s ease both',
        ...position(side, rect, viewport, cardH),
      }}
    >
      {/* chapter + counter */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span aria-hidden style={{ width: 6, height: 6, borderRadius: 2, background: 'var(--red)', boxShadow: '0 0 8px var(--red)' }} />
        <span style={{ ...kicker, color: 'var(--red)' }}>{step.chapter}</span>
        <span style={{ marginLeft: 'auto', ...kicker, color: 'var(--ink-4)' }}>
          {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
        </span>
      </div>

      <h2
        id={headingId}
        style={{ margin: '13px 0 0', font: '800 21px/1.15 var(--display)', letterSpacing: '-.015em', color: 'var(--ink)' }}
      >
        {step.headline}
      </h2>

      <div id={bodyId}>
        <p style={{ margin: '10px 0 0', font: '400 13.5px/1.6 var(--sans)', color: 'var(--ink-2)' }}>{step.what}</p>

        {step.why && (
          <p
            style={{
              margin: '13px 0 0',
              paddingLeft: 12,
              borderLeft: '2px solid var(--red-line)',
              font: '400 13px/1.6 var(--sans)',
              color: 'var(--ink-3)',
            }}
          >
            {step.why}
          </p>
        )}

        {step.cite && (
          <div style={{ marginTop: 12, font: '400 10.5px/1.5 var(--mono)', color: 'var(--ink-4)' }}>{step.cite}</div>
        )}
      </div>

      {/* the welcome card offers three doors; every other step offers the rail */}
      {isWelcome ? (
        <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" onClick={props.onStartGuided} style={primaryBtn}>
            {step.primaryCta ?? 'Start the walkthrough'}
          </button>
          <button type="button" onClick={props.onStartPresenter} style={ghostBtn}>
            {step.secondaryCta ?? 'Watch it run'}
          </button>
          <button type="button" onClick={props.onSkip} style={{ ...ghostBtn, border: 'none', color: 'var(--ink-4)' }}>
            {step.tertiaryCta ?? 'Skip'}
          </button>
        </div>
      ) : (
        <>
          {waitingOnClick && (
            <div
              style={{
                marginTop: 15,
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                background: 'var(--signal-soft)',
                border: '1px solid color-mix(in srgb, var(--signal) 28%, transparent)',
                borderRadius: 9,
                padding: '10px 12px',
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 7,
                  background: 'var(--signal)',
                  animation: reducedMotion ? undefined : 'rl-pulse 1.2s infinite',
                  flex: 'none',
                }}
              />
              <span style={{ font: '500 11.5px/1.4 var(--mono)', color: 'var(--signal)' }}>
                Your turn. Use the control in the light.
              </span>
            </div>
          )}

          <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--edge)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" onClick={props.onSkip} style={{ ...ghostBtn, border: 'none', paddingLeft: 0, color: 'var(--ink-4)' }}>
              End tour
            </button>

            {mode === 'presenter' && (
              <button type="button" onClick={props.onTogglePause} style={{ ...ghostBtn, border: 'none', color: 'var(--ink-3)' }} aria-pressed={paused}>
                {paused ? 'Resume' : 'Pause'}
              </button>
            )}

            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              <button type="button" onClick={props.onBack} disabled={index === 0} style={{ ...ghostBtn, opacity: index === 0 ? 0.4 : 1, cursor: index === 0 ? 'not-allowed' : 'pointer' }}>
                Back
              </button>
              <button type="button" onClick={props.onNext} style={primaryBtn}>
                {index === total - 1 ? 'Finish' : 'Next'}
              </button>
            </div>
          </div>

          {/* presenter progress; a quiet rule, no numbers to read */}
          {mode === 'presenter' && (
            <div aria-hidden style={{ marginTop: 12, height: 2, borderRadius: 2, background: 'var(--edge)', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`,
                  background: 'var(--red)',
                }}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
