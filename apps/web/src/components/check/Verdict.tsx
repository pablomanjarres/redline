'use client';

import type { CSSProperties } from 'react';
import type { CheckId, CheckResult, CheckState } from '@redline/contracts';

/* The verdict block: the marked-up conclusion for a finding, styled by state.
   Flagged is red, clean is green, could-not-verify is amber, a hard stop gets a
   heavy dark border. The scientist's original claim is struck through and the
   defensible rewrite sits beneath it, with the method citation underneath. */

const WRAP: Record<CheckState, CSSProperties> = {
  flagged: { background: 'var(--red-soft)', border: '1px solid var(--red-line)' },
  clean: { background: 'var(--pass-soft)', border: '1px solid rgba(46,125,91,.30)' },
  flag_only: { background: 'var(--amber-soft)', border: '1px solid rgba(169,116,26,.32)' },
  hard_stop: { background: 'var(--panel)', border: '2px solid var(--stop)' },
};

const MARK: Record<CheckState, string> = {
  flagged: 'var(--red)',
  clean: 'var(--pass)',
  flag_only: 'var(--amber)',
  hard_stop: 'var(--stop)',
};

const KICKER: Record<CheckState, string> = {
  flagged: 'Finding',
  clean: 'Verified. This result holds',
  flag_only: 'Could not verify',
  hard_stop: 'Hard stop. No valid result',
};

function errColor(state: CheckState): string {
  if (state === 'clean') return 'var(--pass)';
  if (state === 'flag_only') return 'var(--amber)';
  if (state === 'hard_stop') return 'var(--stop)';
  return 'var(--red-deep)';
}

function conclusionLabel(state: CheckState, checkId: CheckId): string {
  if (state === 'clean') return 'Verified conclusion';
  if (state === 'flag_only') return 'What Redline can and cannot say';
  if (state === 'hard_stop') return 'Why no valid result is possible';
  return checkId === 1 ? 'Your conclusion, corrected' : 'Your conclusion, rewritten as evidence';
}

export function Verdict({ result, checkId }: { result: CheckResult; checkId: CheckId }) {
  const { state } = result;
  const kickerStyle: CSSProperties =
    state === 'hard_stop'
      ? {
          font: '600 10.5px/1 var(--mono)',
          letterSpacing: '.14em',
          textTransform: 'uppercase',
          color: '#fff',
          background: 'var(--stop)',
          padding: '5px 9px',
          borderRadius: 5,
        }
      : {
          font: '600 10.5px/1 var(--mono)',
          letterSpacing: '.14em',
          textTransform: 'uppercase',
          color: errColor(state),
        };

  return (
    <div style={{ marginTop: 16, borderRadius: 13, padding: '22px 24px', ...WRAP[state] }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          style={{
            width: 11,
            height: 11,
            borderRadius: 3,
            flex: 'none',
            background: MARK[state],
          }}
        />
        <span style={kickerStyle}>{KICKER[state]}</span>
      </div>

      {result.error ? (
        <div style={{ marginTop: 8, font: '600 17px/1.3 var(--sans)', color: errColor(state) }}>
          {result.error}
        </div>
      ) : null}

      <div
        style={{
          marginTop: 16,
          font: '600 10.5px/1 var(--mono)',
          letterSpacing: '.14em',
          color: 'var(--ink3)',
          textTransform: 'uppercase',
        }}
      >
        {conclusionLabel(state, checkId)}
      </div>

      {result.original ? (
        <p
          style={{
            margin: '11px 0 0',
            font: '400 17px/1.5 var(--serif)',
            color: 'var(--ink3)',
            textDecoration: 'line-through',
            textDecorationColor: 'var(--red)',
            textDecorationThickness: '1.5px',
          }}
        >
          {result.original}
        </p>
      ) : null}

      <p
        style={{
          margin: '12px 0 0',
          font: '400 17px/1.55 var(--serif)',
          color: 'var(--ink)',
          display: 'flex',
          gap: 9,
        }}
      >
        <span style={{ color: 'var(--red)', fontWeight: 600, flex: 'none' }}>‸</span>
        <span>{result.corrected}</span>
      </p>

      {result.missing ? (
        <div
          style={{
            marginTop: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'var(--amber-soft)',
            borderRadius: 8,
            padding: '11px 14px',
          }}
        >
          <span
            style={{
              font: '600 10.5px/1 var(--mono)',
              letterSpacing: '.1em',
              textTransform: 'uppercase',
              color: 'var(--amber)',
            }}
          >
            Missing
          </span>
          <span style={{ font: '500 13px/1.4 var(--sans)', color: 'var(--ink)' }}>
            {result.missing}
          </span>
        </div>
      ) : null}

      <div
        style={{
          marginTop: 18,
          paddingTop: 15,
          borderTop: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
        }}
      >
        <span
          style={{
            font: '600 10.5px/1 var(--mono)',
            letterSpacing: '.1em',
            textTransform: 'uppercase',
            color: 'var(--ink3)',
            flex: 'none',
            marginTop: 2,
          }}
        >
          Method
        </span>
        <div>
          <div style={{ font: '500 13px/1.4 var(--sans)', color: 'var(--ink)' }}>
            {result.citation.url ? (
              <a href={result.citation.url} target="_blank" rel="noreferrer">
                {result.citation.authors} ({result.citation.year}) · {result.citation.venue}
              </a>
            ) : (
              <>
                {result.citation.authors} ({result.citation.year}) · {result.citation.venue}
              </>
            )}
          </div>
          <div style={{ marginTop: 3, font: '400 13px/1.45 var(--serif)', color: 'var(--ink2)' }}>
            {result.citation.note}
          </div>
        </div>
      </div>
    </div>
  );
}
