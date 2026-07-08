'use client';

import type { CheckId } from '@redline/contracts';
import { useSession } from '@/state/session';
import { CheckTile } from '@/components/workbench/CheckTile';

const IDS: CheckId[] = [1, 2, 3, 4];

/**
 * Workbench: the audit board. Four checks as dark tiles, each a live instrument
 * you open and operate. "Re-run all four" fires every check at once.
 */
export default function WorkbenchPage() {
  const { runAll } = useSession();

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '36px 40px 72px' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ font: '600 11px/1 var(--mono)', letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
            Workbench
          </div>
          <h1 style={{ margin: '14px 0 0', font: '800 30px/1.05 var(--display)', letterSpacing: '-.02em', color: 'var(--ink)' }}>
            Four checks. Operate each one.
          </h1>
          <p style={{ margin: '12px 0 0', maxWidth: 640, font: '400 13.5px/1.6 var(--sans)', color: 'var(--ink-3)' }}>
            Each check is an independent instrument with its own knobs.{' '}
            <span style={{ color: 'var(--red)', fontWeight: 600 }}>Red</span> flags a problem,{' '}
            <span style={{ color: 'var(--green)', fontWeight: 600 }}>green</span> verifies it holds,{' '}
            <span style={{ color: 'var(--amber)', fontWeight: 600 }}>amber</span> needs your input.
          </p>
        </div>
        <button
          onClick={() => runAll()}
          style={{
            flex: 'none',
            font: '700 11px/1 var(--sans)',
            letterSpacing: '.08em',
            textTransform: 'uppercase',
            color: 'var(--ink)',
            background: 'var(--panel-2)',
            border: '1px solid var(--edge-2)',
            padding: '12px 18px',
            borderRadius: 10,
            cursor: 'pointer',
          }}
        >
          Re-run all four
        </button>
      </div>

      {/* audit board */}
      <div style={{ marginTop: 30, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20 }}>
        {IDS.map((id) => (
          <CheckTile key={id} checkId={id} />
        ))}
      </div>
    </div>
  );
}
