'use client';

/**
 * The workbench top bar (58px). Wordmark, the loaded-dataset readout, a live
 * bench summary, and a shortcut to the report. Faithful to the app-shell top
 * bar in the design source.
 */

import Link from 'next/link';
import { useSession } from '@/state/session';
import { fmt } from '@/lib/format';

export function TopBar() {
  const { dataset, fieldsConfirmed, results } = useSession();

  const states = ([1, 2, 3, 4] as const).map((id) => results[id]?.state).filter(Boolean);
  const flagged = states.filter((s) => s === 'flagged').length;
  const clean = states.filter((s) => s === 'clean').length;
  const soft = states.filter((s) => s === 'flag_only' || s === 'hard_stop').length;
  const summary = fieldsConfirmed
    ? `${flagged} flagged · ${clean} clean${soft ? ` · ${soft} need input` : ''}`
    : 'awaiting fields';

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '0 22px',
        height: 58,
        borderBottom: '1px solid var(--line)',
        background: 'var(--panel)',
        flex: 'none',
        zIndex: 5,
      }}
    >
      <span style={{ font: '600 16px/1 var(--sans)', letterSpacing: '-.01em', color: 'var(--ink)' }}>
        Redline
      </span>
      <span aria-hidden style={{ width: 1, height: 24, background: 'var(--line2)' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
        <span aria-hidden style={{ width: 7, height: 7, flex: 'none', borderRadius: 2, background: 'var(--ink3)' }} />
        <span
          style={{
            font: '500 13px/1 var(--mono)',
            color: 'var(--ink2)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {dataset.label}
        </span>
        <span style={{ font: '400 12px/1 var(--sans)', color: 'var(--ink4)', whiteSpace: 'nowrap' }}>
          {fmt(dataset.cells)} cells · {dataset.replicates} {dataset.replicateLabel}
        </span>
      </div>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            border: '1px solid var(--line2)',
            borderRadius: 20,
          }}
        >
          <span
            style={{
              font: '500 11px/1 var(--mono)',
              letterSpacing: '.06em',
              color: 'var(--ink3)',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            }}
          >
            {summary}
          </span>
        </div>
        <Link
          href="/report"
          style={{
            font: '600 12.5px/1 var(--sans)',
            color: 'var(--ink)',
            background: 'var(--panel2)',
            border: '1px solid var(--line2)',
            padding: '9px 15px',
            borderRadius: 8,
            cursor: 'pointer',
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          Report →
        </Link>
      </div>
    </header>
  );
}
