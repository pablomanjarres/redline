'use client';

import { Kicker } from '@redline/ui';
import { useSession } from '@/state/session';
import { CheckCard } from '@/components/workbench/CheckCard';

/**
 * Workbench route: four independent instruments in a 2-column grid. "Re-run all
 * four" fires every check; each card opens its own panel.
 */
export default function WorkbenchPage() {
  const { runAll } = useSession();

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '40px 48px 64px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24 }}>
        <div>
          <Kicker>Workbench</Kicker>
          <h1
            style={{
              margin: '12px 0 0',
              font: '500 27px/1.15 var(--serif)',
              letterSpacing: '-.01em',
              color: 'var(--ink)',
            }}
          >
            Four checks. Operate each one.
          </h1>
          <p
            style={{
              margin: '9px 0 0',
              maxWidth: 620,
              font: '400 14.5px/1.5 var(--sans)',
              color: 'var(--ink2)',
            }}
          >
            Each is an independent instrument with its own knobs. Open one to run it and mark up your
            chart. The dot shows what it found:{' '}
            <span style={{ color: 'var(--red)', fontWeight: 600 }}>red</span> flagged,{' '}
            <span style={{ color: 'var(--pass)', fontWeight: 600 }}>green</span> clean,{' '}
            <span style={{ color: 'var(--amber)', fontWeight: 600 }}>amber</span> needs input.
          </p>
        </div>
        <button
          onClick={() => runAll()}
          style={{
            flex: 'none',
            font: '600 13px/1 var(--sans)',
            color: 'var(--ink)',
            background: 'var(--panel)',
            border: '1px solid var(--line2)',
            padding: '12px 18px',
            borderRadius: 9,
            cursor: 'pointer',
          }}
        >
          Re-run all four
        </button>
      </div>

      <div style={{ marginTop: 30, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {([1, 2, 3, 4] as const).map((id) => (
          <CheckCard key={id} checkId={id} />
        ))}
      </div>
    </div>
  );
}
