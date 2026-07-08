'use client';

/**
 * The workbench sidebar (246px). Section nav with live per-check state dots.
 * Steps that depend on confirmed fields (workbench, the four checks, report)
 * are non-navigable until fields are confirmed. Faithful to the app-shell
 * sidebar in the design source.
 *
 * Check display names are canonical pillar names from the build spec. If the
 * engine later exports check metadata, swap CHECK_LABELS for that single source.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { CSSProperties } from 'react';
import { stateColor } from '@redline/ui';
import { useSession } from '@/state/session';

const CHECK_LABELS: Record<1 | 2 | 3 | 4, string> = {
  1: 'Pseudoreplication',
  2: 'Double dipping',
  3: 'Clustering fragility',
  4: 'Confounding',
};

function rowStyle(active: boolean, disabled: boolean, indent: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    padding: indent ? '9px 10px 9px 22px' : '9px 10px',
    borderRadius: 8,
    border: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    background: active ? 'var(--panel)' : 'transparent',
    boxShadow: active ? '0 1px 2px rgba(0,0,0,.05)' : 'none',
    fontFamily: 'var(--sans)',
    fontWeight: active ? 600 : 500,
    fontSize: 13,
    lineHeight: 1,
    color: disabled ? 'var(--ink4)' : active ? 'var(--ink)' : 'var(--ink2)',
    opacity: disabled ? 0.55 : 1,
    textDecoration: 'none',
  };
}

function Dot({ color, pulse = false }: { color: string; pulse?: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        width: 8,
        height: 8,
        flex: 'none',
        borderRadius: 2,
        background: color,
        ...(pulse ? { animation: 'rl-pulse 1s infinite' } : {}),
      }}
    />
  );
}

interface RowProps {
  href: string;
  active: boolean;
  disabled?: boolean;
  indent?: boolean;
  dotColor: string;
  pulse?: boolean;
  label: string;
  tag?: string;
  tagColor?: string;
  style?: CSSProperties;
}

function NavRow({
  href,
  active,
  disabled = false,
  indent = false,
  dotColor,
  pulse = false,
  label,
  tag,
  tagColor,
  style,
}: RowProps) {
  const merged = { ...rowStyle(active, disabled, indent), ...style };
  const inner = (
    <>
      <Dot color={dotColor} pulse={pulse} />
      <span
        style={{
          flex: 1,
          textAlign: 'left',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      {tag ? <span style={{ font: '600 11px/1 var(--mono)', color: tagColor }}>{tag}</span> : null}
    </>
  );

  if (disabled) {
    return (
      <div aria-disabled="true" style={merged}>
        {inner}
      </div>
    );
  }
  return (
    <Link href={href} aria-current={active ? 'page' : undefined} style={merged}>
      {inner}
    </Link>
  );
}

export function Sidebar() {
  const { fieldsConfirmed, results, running } = useSession();
  const pathname = usePathname();
  const gated = !fieldsConfirmed;

  return (
    <nav
      aria-label="Audit sections"
      className="rl-scroll"
      style={{
        width: 246,
        flex: 'none',
        borderRight: '1px solid var(--line)',
        background: 'var(--panel2)',
        padding: '18px 14px',
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
      }}
    >
      <NavRow href="/" active={pathname === '/'} dotColor="var(--ink4)" label="Intake" />

      <NavRow
        href="/fields"
        active={pathname === '/fields'}
        dotColor={fieldsConfirmed ? 'var(--pass)' : 'var(--amber)'}
        label="Field resolution"
        tag={fieldsConfirmed ? '✓' : undefined}
        tagColor="var(--pass)"
      />

      <NavRow
        href="/workbench"
        active={pathname === '/workbench'}
        disabled={gated}
        dotColor="var(--ink4)"
        label="Workbench"
      />

      {([1, 2, 3, 4] as const).map((id) => {
        const r = results[id];
        const isRunning = running[id];
        return (
          <NavRow
            key={id}
            href={`/checks/${id}`}
            active={pathname === `/checks/${id}`}
            disabled={gated}
            indent
            dotColor={isRunning ? 'var(--accent)' : stateColor(r ? r.state : 'ready')}
            pulse={isRunning}
            label={`${id}. ${CHECK_LABELS[id]}`}
            tag={isRunning ? '···' : undefined}
            tagColor="var(--accent)"
          />
        );
      })}

      <NavRow
        href="/report"
        active={pathname === '/report'}
        disabled={gated}
        dotColor="var(--ink4)"
        label="Report"
        style={{ marginTop: 6 }}
      />

      <div style={{ marginTop: 'auto', padding: '14px 10px 4px', borderTop: '1px solid var(--line2)' }}>
        <div style={{ font: '400 11px/1.5 var(--sans)', color: 'var(--ink4)' }}>
          Change any knob inside a check and it re-runs on the spot.
        </div>
        <Link
          href="/environment"
          aria-current={pathname === '/environment' ? 'page' : undefined}
          style={{
            marginTop: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: '5px 0',
            font: '500 11.5px/1.3 var(--sans)',
            color: pathname === '/environment' ? 'var(--ink)' : 'var(--ink3)',
            textAlign: 'left',
            textDecoration: 'none',
          }}
        >
          <span
            aria-hidden
            style={{ width: 7, height: 7, borderRadius: 2, background: 'var(--ink4)', flex: 'none' }}
          />
          Runs in your environment →
        </Link>
      </div>
    </nav>
  );
}
