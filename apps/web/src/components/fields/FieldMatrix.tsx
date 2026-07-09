import type { CSSProperties } from 'react';
import { ROLE_OPTIONS, type Confidence, type FieldRole, type FieldSpec } from '@redline/contracts';

/**
 * One row of the design matrix, a dark instrument card for a single resolved
 * `obs` column. Left: the column id (mono), its dtype/levels/missing meta, the
 * model's reasoning, and a confidence light. Right: the role <select> from
 * ROLE_OPTIONS. A low-confidence row carries an amber left-rule so the eye lands
 * on the fields that still need a human decision. Fully dark; the only white in
 * Redline lives on a lightbox plate, and a matrix row has no figure.
 */

/** The confidence light color: green holds, amber checks, red is unsure. */
const CONF_COLOR: Record<Confidence, string> = {
  high: 'var(--green)',
  medium: 'var(--amber)',
  low: 'var(--red)',
};

const CONF_LABEL: Record<Confidence, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low · please check',
};

function metaLine(f: FieldSpec): string {
  const levels = f.levels != null ? ` · ${f.levels} levels` : '';
  const missing = f.missing ? ` · ${f.missing} missing` : ' · 0 missing';
  return `${f.dtype}${levels}${missing}`;
}

export function FieldMatrixRow({
  field,
  onRole,
  tourId,
  tourRoleId,
}: {
  field: FieldSpec;
  onRole: (role: FieldRole) => void;
  /** Set by the page on the one row the guided tour spotlights. */
  tourId?: string;
  tourRoleId?: string;
}) {
  const c = field.confidence;
  const color = CONF_COLOR[c];
  const low = c === 'low';

  const card: CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 22,
    background: 'var(--panel)',
    border: '1px solid var(--edge)',
    borderRadius: 12,
    padding: '18px 20px',
    // Longhand after the shorthand: the amber rule wins on the left edge only.
    ...(low ? { borderLeft: '3px solid var(--amber)' } : {}),
  };

  const sel: CSSProperties = {
    width: '100%',
    ...(field.edited ? { borderColor: 'var(--signal)', color: 'var(--signal)' } : {}),
  };

  return (
    <div data-tour={tourId} style={card}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ font: '600 15px/1.2 var(--mono)', color: 'var(--ink)' }}>{field.id}</span>
          <span style={{ font: '400 11.5px/1 var(--mono)', color: 'var(--ink-4)' }}>{metaLine(field)}</span>
          {field.edited ? (
            <span
              style={{
                font: '600 9px/1 var(--mono)',
                letterSpacing: '.14em',
                textTransform: 'uppercase',
                color: 'var(--signal)',
                background: 'var(--signal-soft)',
                border: '1px solid color-mix(in srgb, var(--signal) 30%, transparent)',
                padding: '3px 7px',
                borderRadius: 4,
              }}
            >
              edited
            </span>
          ) : null}
        </div>

        <p style={{ margin: '9px 0 0', maxWidth: 600, font: '400 13px/1.55 var(--sans)', color: 'var(--ink-2)' }}>
          {field.reason}
        </p>

        <div style={{ marginTop: 13, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, flex: 'none', borderRadius: 8, background: color, boxShadow: `0 0 8px ${color}` }} />
          <span
            style={{
              font: '600 10px/1 var(--mono)',
              letterSpacing: '.14em',
              textTransform: 'uppercase',
              color: low ? 'var(--amber)' : 'var(--ink-3)',
            }}
          >
            {CONF_LABEL[c]}
          </span>
        </div>
      </div>

      <div style={{ width: 250, flex: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span
          style={{
            font: '600 9.5px/1 var(--mono)',
            letterSpacing: '.14em',
            textTransform: 'uppercase',
            color: 'var(--ink-4)',
          }}
        >
          Meaning this field carries
        </span>
        <select
          data-testid={`field-role-${field.id}`}
          data-tour={tourRoleId}
          aria-label={`Meaning for ${field.id}`}
          value={field.role}
          onChange={(e) => onRole(e.target.value as FieldRole)}
          style={sel}
        >
          {ROLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
