import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';
import type { CheckState } from '@redline/contracts';
import { stateColor, stateLabel } from './tokens.js';

/* Presentational primitives shared across every Redline surface. They carry no
   state and no 'use client' directive — the interactive boundary lives in the
   consumer, so these render in both server and client trees. Layout stays inline
   (faithful to the design source); these capture the repeated, load-bearing bits. */

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

const BUTTON_BASE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 9,
  fontFamily: 'var(--sans)',
  fontWeight: 600,
  cursor: 'pointer',
  borderRadius: 9,
  lineHeight: 1,
  border: '1px solid transparent',
};

const BUTTON_VARIANTS: Record<ButtonVariant, CSSProperties> = {
  primary: { background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)' },
  secondary: { background: 'var(--panel)', color: 'var(--ink)', border: '1px solid var(--line2)' },
  ghost: { background: 'none', color: 'var(--accent)', border: '1px solid transparent' },
};

export function Button({
  variant = 'primary',
  style,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      {...rest}
      style={{
        ...BUTTON_BASE,
        ...BUTTON_VARIANTS[variant],
        fontSize: 13.5,
        padding: '12px 18px',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/** The uppercase mono kicker used above every section title. */
export function Kicker({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        font: '600 11px/1 var(--mono)',
        letterSpacing: '.16em',
        color: 'var(--ink3)',
        textTransform: 'uppercase',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** A verdict pill. Filled with the state color; muted grey when not yet run. */
export function Badge({
  state,
  label,
  running = false,
}: {
  state: CheckState | 'ready' | 'running';
  label?: string;
  running?: boolean;
}) {
  const s = running ? 'running' : state;
  const ready = s === 'ready';
  const col = stateColor(s);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        font: '600 11px/1 var(--sans)',
        padding: '6px 11px',
        borderRadius: 20,
        color: ready ? 'var(--ink3)' : '#fff',
        background: ready ? 'var(--panel2)' : col,
        border: `1px solid ${ready ? 'var(--line2)' : col}`,
      }}
    >
      {label ?? stateLabel(s)}
    </span>
  );
}

/** A small square status dot. */
export function Dot({ color, pulse = false }: { color: string; pulse?: boolean }) {
  return (
    <span
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

/** A quick numeric readout tile (the row under each chart). */
export function StatTile({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'bad' | 'good';
}) {
  const color =
    tone === 'bad' ? 'var(--red-deep)' : tone === 'good' ? 'var(--pass)' : 'var(--ink)';
  return (
    <div
      style={{
        flex: 1,
        minWidth: 120,
        background: 'var(--panel2)',
        border: '1px solid var(--line)',
        borderRadius: 9,
        padding: '12px 14px',
      }}
    >
      <div style={{ font: `600 20px/1 var(--mono)`, color }}>{value}</div>
      <div style={{ marginTop: 5, font: '400 11px/1.2 var(--sans)', color: 'var(--ink3)' }}>
        {label}
      </div>
    </div>
  );
}

/** A white bordered card — the base surface for panels. */
export function Panel({
  children,
  style,
  className,
}: {
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <div
      className={className}
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line2)',
        borderRadius: 13,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
