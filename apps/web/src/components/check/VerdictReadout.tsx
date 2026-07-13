'use client';

import { useEffect, useState } from 'react';
import type { CheckId, CheckResult, CheckState, CriticAssessment } from '@redline/contracts';
import { signalColor } from '@redline/ui';

/* The verdict readout: the marked-up conclusion for a finding on the light
   instrument surface. A signal-colored rule down the left edge, the failure mode
   named large, the scientist's claim struck through by a redline that draws
   across it, then the defensible rewrite dropping in with the redline caret. The
   method citation sits underneath. */

const KICKER: Record<CheckState, string> = {
  flagged: 'Finding',
  clean: 'Verified — holds',
  flag_only: 'Could not verify',
  hard_stop: 'Hard stop',
};

function conclusionLabel(state: CheckState, checkId: CheckId): string {
  if (state === 'clean') return 'Verified conclusion';
  if (state === 'flag_only') return 'What Redline can and cannot say';
  if (state === 'hard_stop') return 'Why no valid result is possible';
  return checkId === 1 ? 'Your conclusion, corrected' : 'Your conclusion, rewritten as evidence';
}

/** The critic strip: how the independent second pass ruled on this finding. */
function criticPresentation(a: CriticAssessment): { label: string; color: string } {
  if (a.unverified) return { label: 'Unverified, shown by default', color: 'var(--ink-4)' };
  if (a.verdict === 'veto') return { label: 'Vetoed the flag', color: 'var(--green)' };
  if (a.verdict === 'downgrade') return { label: 'Downgraded to advisory', color: 'var(--amber)' };
  return { label: 'Confirmed the flag', color: 'var(--ink-3)' };
}

function CriticStrip({ critic }: { critic: CriticAssessment }) {
  const { label, color } = criticPresentation(critic);
  return (
    <div
      style={{
        marginTop: 16,
        paddingTop: 15,
        borderTop: '1px solid var(--edge)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
      }}
    >
      <span
        style={{
          font: '700 9px/1 var(--mono)',
          letterSpacing: '.14em',
          textTransform: 'uppercase',
          color: 'var(--ink-4)',
          flex: 'none',
          marginTop: 2,
        }}
      >
        Critic
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ width: 8, height: 8, borderRadius: 8, background: color, boxShadow: `0 0 7px ${color}`, flex: 'none' }} />
          <span style={{ font: '700 11px/1.2 var(--sans)', letterSpacing: '.02em', color }}>{label}</span>
          {!critic.unverified && (
            <span style={{ font: '500 9.5px/1 var(--mono)', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
              {critic.confidence} confidence
            </span>
          )}
        </div>
        <div style={{ marginTop: 6, font: '400 12.5px/1.5 var(--sans)', color: 'var(--ink-3)' }}>
          {critic.justification}
        </div>
        {critic.keysOn && (
          <div style={{ marginTop: 6, font: '500 11px/1.3 var(--mono)', color: 'var(--ink-4)' }}>
            keys on {critic.keysOn}
          </div>
        )}
      </div>
    </div>
  );
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

export function VerdictReadout({ result, checkId }: { result: CheckResult; checkId: CheckId }) {
  const { state } = result;
  const c = signalColor(state);

  // The verdict beat: the struck claim draws its redline left-to-right, then the
  // corrected conclusion drops in beside it. One play per finding. Parked at the
  // finished state (struck + shown, no motion) when the viewer asked for it.
  const reduced = useReducedMotion();
  const hasOriginal = !!result.original;
  const sig = `${checkId}|${state}|${result.original ?? ''}|${result.corrected}`;
  const [struck, setStruck] = useState(false);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (reduced) {
      setStruck(true);
      setShown(true);
      return;
    }
    setStruck(false);
    setShown(false);
    const t1 = window.setTimeout(() => setStruck(true), hasOriginal ? 260 : 0);
    const t2 = window.setTimeout(() => setShown(true), hasOriginal ? 720 : 200);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [reduced, sig, hasOriginal]);

  return (
    <div
      style={{
        marginTop: 16,
        borderRadius: 12,
        border: '1px solid var(--edge)',
        borderLeft: `3px solid ${c}`,
        background: `linear-gradient(180deg, color-mix(in srgb, ${c} 7%, transparent), transparent), var(--panel)`,
        padding: '20px 24px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ width: 9, height: 9, borderRadius: 2, background: c, boxShadow: `0 0 8px ${c}` }} />
        <span style={{ font: '700 10px/1 var(--mono)', letterSpacing: '.18em', textTransform: 'uppercase', color: c }}>{KICKER[state]}</span>
      </div>

      {result.error && (
        <div data-testid="verdict-error" style={{ marginTop: 12, font: '800 22px/1.15 var(--display)', letterSpacing: '-.01em', color: 'var(--ink)' }}>{result.error}</div>
      )}

      <div style={{ marginTop: 18, font: '600 9.5px/1 var(--mono)', letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
        {conclusionLabel(state, checkId)}
      </div>

      {result.original && (
        <div style={{ position: 'relative', margin: '11px 0 0' }}>
          <p style={{ margin: 0, font: '400 16px/1.5 var(--sans)', color: struck ? 'var(--ink-4)' : 'var(--ink-2)', transition: 'color 320ms ease' }}>
            {result.original}
          </p>
          {/* the redline itself: the same claim, transparent glyphs, struck in red,
              wiped left-to-right so the strike reads as it is drawn across it */}
          <p
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              margin: 0,
              font: '400 16px/1.5 var(--sans)',
              color: 'transparent',
              textDecoration: 'line-through',
              textDecorationColor: 'var(--red)',
              textDecorationThickness: 2,
              clipPath: struck ? 'inset(0 0 0 0)' : 'inset(0 100% 0 0)',
              transition: 'clip-path 440ms cubic-bezier(0.22,0.61,0.36,1)',
              pointerEvents: 'none',
            }}
          >
            {result.original}
          </p>
        </div>
      )}
      <p
        data-testid="verdict-corrected"
        style={{
          margin: '11px 0 0',
          font: '400 16px/1.55 var(--sans)',
          color: 'var(--ink)',
          display: 'flex',
          gap: 10,
          opacity: shown ? 1 : 0,
          transform: shown ? 'translateY(0)' : 'translateY(-6px)',
          transition: 'opacity 300ms ease, transform 300ms cubic-bezier(0.22,0.61,0.36,1)',
        }}
      >
        <span style={{ color: 'var(--red)', fontWeight: 800, flex: 'none' }}>▸</span>
        <span>{result.corrected}</span>
      </p>

      {result.missing && (
        <div style={{ marginTop: 16, display: 'inline-flex', alignItems: 'center', gap: 10, background: 'var(--amber-soft)', border: '1px solid color-mix(in srgb, var(--amber) 32%, transparent)', borderRadius: 8, padding: '10px 13px' }}>
          <span style={{ font: '700 9px/1 var(--mono)', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--amber)' }}>Missing</span>
          <span style={{ font: '500 12.5px/1.4 var(--sans)', color: 'var(--ink-2)' }}>{result.missing}</span>
        </div>
      )}

      <div data-testid="verdict-citation" style={{ marginTop: 18, paddingTop: 15, borderTop: '1px solid var(--edge)', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <span style={{ font: '700 9px/1 var(--mono)', letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-4)', flex: 'none', marginTop: 2 }}>Method</span>
        <div>
          <div style={{ font: '600 12.5px/1.4 var(--mono)', color: 'var(--ink-2)' }}>
            {result.citation.url ? (
              <a href={result.citation.url} target="_blank" rel="noreferrer" style={{ color: 'var(--signal)' }}>
                {result.citation.authors} ({result.citation.year}) · {result.citation.venue}
              </a>
            ) : (
              <>{result.citation.authors} ({result.citation.year}) · {result.citation.venue}</>
            )}
          </div>
          <div style={{ marginTop: 4, font: '400 12.5px/1.5 var(--sans)', color: 'var(--ink-3)' }}>{result.citation.note}</div>
        </div>
      </div>

      {result.critic && <CriticStrip critic={result.critic} />}
    </div>
  );
}
