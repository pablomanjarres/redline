'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { CheckId } from '@redline/contracts';
import { signalColor } from '@redline/ui';
import { useSession } from '@/state/session';

/**
 * The pipeline: a horizontal rail of stations (design resolution, the four
 * checks, the report) with a verdict light on each. This IS the navigation, in
 * place of a sidebar of links. The rail line runs behind the nodes so the audit
 * reads as one flow left to right.
 */
const IDS: CheckId[] = [1, 2, 3, 4];

export function Pipeline() {
  const path = usePathname();
  const { results, running, fieldsConfirmed } = useSession();

  const stations: { href: string; n: string; label: string; active: boolean; light: string; pulse: boolean; locked: boolean }[] = [];
  stations.push({
    href: '/fields',
    n: '00',
    label: 'Design',
    active: path === '/fields',
    light: fieldsConfirmed ? 'var(--green)' : 'var(--amber)',
    pulse: false,
    locked: false,
  });
  IDS.forEach((id) => {
    const r = results[id];
    const run = running[id];
    stations.push({
      href: `/checks/${id}`,
      n: `0${id}`,
      label: ['Pseudoreplication', 'Double dipping', 'Fragility', 'Confounding'][id - 1]!,
      active: path === `/checks/${id}`,
      light: run ? '#58C7FF' : r ? signalColor(r.state) : 'var(--ink-4)',
      pulse: run,
      locked: !fieldsConfirmed,
    });
  });
  stations.push({
    href: '/report',
    n: '',
    label: 'Report',
    active: path === '/report',
    light: 'var(--ink-4)',
    pulse: false,
    locked: !fieldsConfirmed,
  });

  return (
    <nav
      aria-label="Audit pipeline"
      className="rl-scroll"
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 0,
        height: 58,
        padding: '0 20px',
        borderBottom: '1px solid var(--edge)',
        background: 'var(--panel)',
        overflowX: 'auto',
        flex: 'none',
      }}
    >
      {stations.map((s, i) => (
        <div key={s.href} style={{ display: 'flex', alignItems: 'center', flex: 'none' }}>
          {i > 0 && <span aria-hidden style={{ width: 26, height: 1, background: 'var(--edge-2)', flex: 'none' }} />}
          <Link
            href={s.locked ? path : s.href}
            aria-current={s.active ? 'page' : undefined}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              padding: '0 14px',
              height: '100%',
              textDecoration: 'none',
              cursor: s.locked ? 'not-allowed' : 'pointer',
              opacity: s.locked ? 0.4 : 1,
              borderBottom: s.active ? '2px solid var(--red)' : '2px solid transparent',
            }}
          >
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: 9,
                flex: 'none',
                background: s.light,
                boxShadow: s.light === 'var(--ink-4)' ? 'none' : `0 0 8px ${s.light}`,
                animation: s.pulse ? 'rl-pulse 1s infinite' : undefined,
              }}
            />
            {s.n && (
              <span style={{ font: '600 10px/1 var(--mono)', color: s.active ? 'var(--ink)' : 'var(--ink-4)' }}>{s.n}</span>
            )}
            <span
              style={{
                font: `${s.active ? 700 : 500} 11px/1 var(--sans)`,
                letterSpacing: '.04em',
                textTransform: 'uppercase',
                color: s.active ? 'var(--ink)' : 'var(--ink-3)',
                whiteSpace: 'nowrap',
              }}
            >
              {s.label}
            </span>
          </Link>
        </div>
      ))}
    </nav>
  );
}
