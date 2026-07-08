'use client';

import Link from 'next/link';
import { useSession } from '@/state/session';
import { fmt } from '@/lib/format';

/**
 * The masthead: the redline wordmark (a red rule struck through it), the
 * specimen identity, the running verdict tally, and the report action. Full
 * width, dark. No nav lives here — the pipeline below carries navigation.
 */
export function Masthead() {
  const { dataset, report, fieldsConfirmed } = useSession();
  const tally = [
    { n: report.flagged, label: 'flagged', c: 'var(--red)' },
    { n: report.clean, label: 'verified', c: 'var(--green)' },
    { n: report.needInput, label: 'need input', c: 'var(--amber)' },
  ];

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 22,
        height: 62,
        padding: '0 26px',
        borderBottom: '1px solid var(--edge)',
        background: 'linear-gradient(180deg, rgba(20,23,28,.7), rgba(11,13,18,.5))',
        backdropFilter: 'blur(8px)',
        flex: 'none',
        position: 'relative',
        zIndex: 10,
      }}
    >
      <Link href="/" aria-label="Redline home" style={{ position: 'relative', textDecoration: 'none' }}>
        <span style={{ font: '900 20px/1 var(--display)', letterSpacing: '-.03em', color: 'var(--ink)' }}>REDLINE</span>
        <span
          style={{
            position: 'absolute',
            left: -2,
            right: -2,
            top: '54%',
            height: 2.5,
            background: 'var(--red)',
            borderRadius: 2,
            boxShadow: '0 0 10px rgba(255,77,78,.6)',
          }}
        />
      </Link>
      <span
        style={{
          font: '500 9.5px/1 var(--mono)',
          letterSpacing: '.22em',
          color: 'var(--ink-3)',
          border: '1px solid var(--edge-2)',
          padding: '5px 9px',
          borderRadius: 5,
        }}
      >
        STATISTICAL AUDITOR
      </span>

      <div style={{ marginLeft: 8, display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <span style={{ width: 6, height: 6, borderRadius: 6, background: 'var(--green)', flex: 'none', boxShadow: '0 0 8px var(--green)' }} />
        <span style={{ font: '500 12px/1 var(--mono)', color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {dataset.label}
        </span>
        <span style={{ font: '400 11.5px/1 var(--mono)', color: 'var(--ink-4)', whiteSpace: 'nowrap' }}>
          {fmt(dataset.cells)} cells · {dataset.replicates} {dataset.replicateLabel}
        </span>
      </div>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 18 }}>
        {fieldsConfirmed ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {tally.map((t) => (
              <div key={t.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ font: '700 14px/1 var(--mono)', color: t.n > 0 ? t.c : 'var(--ink-4)' }}>{t.n}</span>
                <span style={{ font: '400 9px/1 var(--mono)', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>{t.label}</span>
              </div>
            ))}
          </div>
        ) : (
          <span style={{ font: '500 10px/1 var(--mono)', letterSpacing: '.14em', color: 'var(--amber)', textTransform: 'uppercase' }}>
            awaiting design
          </span>
        )}
        <Link
          href="/report"
          style={{
            font: '700 11px/1 var(--sans)',
            letterSpacing: '.06em',
            color: 'var(--ink)',
            textTransform: 'uppercase',
            border: '1px solid var(--edge-2)',
            background: 'var(--panel-2)',
            padding: '9px 14px',
            borderRadius: 8,
            textDecoration: 'none',
          }}
        >
          Report →
        </Link>
      </div>
    </header>
  );
}
