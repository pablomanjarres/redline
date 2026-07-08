'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { CheckId } from '@redline/contracts';
import { signalColor, stateLabel } from '@redline/ui';
import { useSession } from '@/state/session';
import { MiniChart } from '@/components/charts';
import { CHECK_META } from '@/components/check/CheckStage';

/**
 * One station on the audit board: a whole-tile link into a check's stage. Dark
 * panel with a top strip tinted by the verdict signal, the check number + name +
 * failure mode, a verdict badge, the claim under audit, and a MiniChart floating
 * on a small white lightbox plate (the only white on the surface). The headline
 * and any error read as instrument output in mono.
 */
export function CheckTile({ checkId }: { checkId: CheckId }) {
  const { results, running, claims } = useSession();
  const result = results[checkId];
  const isRunning = running[checkId];
  const meta = CHECK_META[checkId];
  const claim = claims.find((c) => c.check === checkId)?.text ?? '';

  const state = isRunning ? 'running' : result ? result.state : 'ready';
  const light = signalColor(state);
  const isReady = !isRunning && !result;
  const badgeLabel = isRunning ? 'Running' : result ? stateLabel(result.state) : 'Not run';

  const headline = result
    ? result.headline
    : isRunning
      ? 'Re-running…'
      : 'Not run yet. Open to run this check.';
  const error = result?.error ?? '';

  let plate: ReactNode;
  if (result && !isRunning) {
    plate = <MiniChart checkId={checkId} result={result} />;
  } else if (isRunning) {
    plate = (
      <div style={{ width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 11 }}>
          <span style={{ width: 7, height: 7, borderRadius: 7, background: '#2563EB', animation: 'rl-pulse 1s infinite' }} />
          <span style={{ font: '600 9.5px/1 var(--mono)', letterSpacing: '.14em', color: '#2563EB' }}>RUNNING CHECK {checkId}…</span>
        </div>
        <div style={{ height: 62, borderRadius: 8, background: 'linear-gradient(100deg,#f1f4f8,#ffffff,#f1f4f8)', backgroundSize: '200% 100%', animation: 'rl-sweep 1.3s linear infinite' }} />
      </div>
    );
  } else {
    plate = (
      <span style={{ font: '500 9.5px/1 var(--mono)', letterSpacing: '.18em', textTransform: 'uppercase', color: '#8792a3' }}>
        Awaiting run
      </span>
    );
  }

  return (
    <Link
      href={`/checks/${checkId}`}
      data-testid={`check-tile-${checkId}`}
      aria-label={`Open check ${checkId}: ${meta.name}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        textAlign: 'left',
        textDecoration: 'none',
        color: 'var(--ink)',
        background: 'var(--panel)',
        border: '1px solid var(--edge)',
        borderRadius: 14,
        overflow: 'hidden',
        minHeight: 336,
      }}
    >
      {/* verdict strip */}
      <div style={{ height: 3, background: light, boxShadow: isReady ? 'none' : `0 0 12px ${light}` }} />

      <div style={{ padding: '19px 21px 21px', display: 'flex', flexDirection: 'column', flex: 1 }}>
        {/* header: number · name · sub · verdict badge */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 13 }}>
          <span style={{ font: '700 12px/1 var(--mono)', color: light, marginTop: 3, flex: 'none' }}>0{checkId}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: '700 17px/1.2 var(--sans)', letterSpacing: '-.01em', color: 'var(--ink)' }}>{meta.name}</div>
            <div style={{ marginTop: 5, font: '400 11px/1.45 var(--mono)', color: 'var(--ink-4)' }}>{meta.sub}</div>
          </div>
          <span
            data-testid={`tile-verdict-${checkId}`}
            style={{
              flex: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              font: '700 9.5px/1 var(--sans)',
              letterSpacing: '.08em',
              textTransform: 'uppercase',
              color: isReady ? 'var(--ink-3)' : light,
              border: `1px solid ${isReady ? 'var(--edge-2)' : light}`,
              background: isReady ? 'transparent' : `color-mix(in srgb, ${light} 12%, transparent)`,
              padding: '6px 10px',
              borderRadius: 7,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 7,
                background: isReady ? 'var(--ink-4)' : light,
                boxShadow: isReady ? 'none' : `0 0 8px ${light}`,
                animation: isRunning ? 'rl-pulse 1s infinite' : undefined,
              }}
            />
            {badgeLabel}
          </span>
        </div>

        {/* claim under audit */}
        {claim && (
          <div style={{ marginTop: 16, font: '400 12px/1.5 var(--mono)' }}>
            <span style={{ color: 'var(--ink-4)' }}>AUDITING — </span>
            <span style={{ color: 'var(--ink-2)' }}>“{claim}”</span>
          </div>
        )}

        {/* lightbox plate — the only white on the surface */}
        <div
          style={{
            marginTop: 16,
            height: 130,
            borderRadius: 10,
            background: 'var(--plate)',
            boxShadow: 'var(--plate-glow)',
            overflow: 'hidden',
            padding: '13px 15px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {plate}
        </div>

        {/* instrument output */}
        <div style={{ marginTop: 16, flex: 1 }}>
          <div style={{ font: '500 12.5px/1.45 var(--mono)', color: 'var(--ink-2)' }}>{headline}</div>
          {error && (
            <div style={{ marginTop: 6, font: '400 11.5px/1.45 var(--mono)', color: 'var(--red)' }}>{error}</div>
          )}
        </div>

        {/* open affordance */}
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--edge)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
          <span style={{ font: '700 11px/1 var(--sans)', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--signal)' }}>Open →</span>
        </div>
      </div>
    </Link>
  );
}
