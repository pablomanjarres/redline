'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { CheckId } from '@redline/contracts';
import { signalColor } from '@redline/ui';
import { useSession } from '@/state/session';

/**
 * The pipeline: a horizontal rail of stations (design resolution, claim review,
 * the four checks, the report) with a verdict light on each. This IS the
 * navigation, in place of a sidebar of links. The rail line runs behind the
 * nodes so the audit reads as one flow left to right: 00, 00b, 01, 02, 03, 04,
 * report. Claims sits at 00b (between design 00 and check 01) because the check
 * numbers 01-04 are canonical ids shown across the whole app, so renumbering
 * them to make room would desync that mental model.
 *
 * Each station gates the one after it. Confirming the design opens Claims;
 * confirming the claim list opens the four checks and the report. Nothing
 * downstream of Claims is reachable until claimsConfirmed, and after that a
 * check no confirmed claim routes to stays locked as well, because it has
 * nothing to audit (its board tile says the same). A station whose target has
 * nothing real to show stays locked instead of posing as a live control.
 */
const IDS: CheckId[] = [1, 2, 3, 4];

export function Pipeline() {
  const path = usePathname();
  const { results, running, fieldsConfirmed, claimsConfirmed, routedChecks } = useSession();
  const routedSet = new Set(routedChecks);

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
  stations.push({
    href: '/claims',
    n: '00b',
    label: 'Claims',
    active: path === '/claims',
    light: claimsConfirmed ? 'var(--green)' : 'var(--amber)',
    pulse: false,
    locked: !fieldsConfirmed,
  });
  IDS.forEach((id) => {
    const r = results[id];
    const run = running[id];
    stations.push({
      href: `/checks/${id}`,
      n: `0${id}`,
      label: ['Pseudoreplication', 'Double dipping', 'Fragility', 'Confounding'][id - 1]!,
      active: path === `/checks/${id}`,
      light: run ? '#2563EB' : r ? signalColor(r.state) : 'var(--ink-4)',
      pulse: run,
      locked: !claimsConfirmed || !routedSet.has(id),
    });
  });
  stations.push({
    href: '/report',
    n: '',
    label: 'Report',
    active: path === '/report',
    light: 'var(--ink-4)',
    pulse: false,
    locked: !claimsConfirmed,
  });
  // The self-verification surface: an internal QA station, always reachable, set
  // apart from the audit flow by its signal-blue light.
  stations.push({
    href: '/verifications',
    n: '',
    label: 'Verify',
    active: path === '/verifications',
    light: 'var(--signal)',
    pulse: false,
    locked: false,
  });

  return (
    <nav
      data-tour="shell.pipeline"
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
