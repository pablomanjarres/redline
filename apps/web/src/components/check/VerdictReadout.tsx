'use client';

import type { CheckId, CheckResult, CheckState } from '@redline/contracts';
import { signalColor } from '@redline/ui';

/* The verdict readout: the marked-up conclusion for a finding, on the dark
   surface. A signal-colored rule down the left edge, the failure mode named
   large, the scientist's claim struck through, and the defensible rewrite with
   the redline caret. The method citation sits underneath. */

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

export function VerdictReadout({ result, checkId }: { result: CheckResult; checkId: CheckId }) {
  const { state } = result;
  const c = signalColor(state);

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
        <div style={{ marginTop: 12, font: '800 22px/1.15 var(--display)', letterSpacing: '-.01em', color: 'var(--ink)' }}>{result.error}</div>
      )}

      <div style={{ marginTop: 18, font: '600 9.5px/1 var(--mono)', letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
        {conclusionLabel(state, checkId)}
      </div>

      {result.original && (
        <p style={{ margin: '11px 0 0', font: '400 16px/1.5 var(--sans)', color: 'var(--ink-4)', textDecoration: 'line-through', textDecorationColor: 'var(--red)', textDecorationThickness: 2 }}>
          {result.original}
        </p>
      )}
      <p style={{ margin: '11px 0 0', font: '400 16px/1.55 var(--sans)', color: 'var(--ink)', display: 'flex', gap: 10 }}>
        <span style={{ color: 'var(--red)', fontWeight: 800, flex: 'none' }}>▸</span>
        <span>{result.corrected}</span>
      </p>

      {result.missing && (
        <div style={{ marginTop: 16, display: 'inline-flex', alignItems: 'center', gap: 10, background: 'var(--amber-soft)', border: '1px solid color-mix(in srgb, var(--amber) 32%, transparent)', borderRadius: 8, padding: '10px 13px' }}>
          <span style={{ font: '700 9px/1 var(--mono)', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--amber)' }}>Missing</span>
          <span style={{ font: '500 12.5px/1.4 var(--sans)', color: 'var(--ink-2)' }}>{result.missing}</span>
        </div>
      )}

      <div style={{ marginTop: 18, paddingTop: 15, borderTop: '1px solid var(--edge)', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
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
    </div>
  );
}
