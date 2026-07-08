import type { CSSProperties } from 'react';
import { ROLE_OPTIONS, type FieldSpec, type FieldRole } from '@redline/contracts';

/**
 * One resolved-field row on the Foundation route. Left column: the column id,
 * its dtype/levels/missing meta, an optional "edited" tag, the model's reasoning
 * (serif), and a confidence pill. Right column: the role <select>, populated from
 * the contracts' ROLE_OPTIONS. A low-confidence row gets the amber inset rail so
 * the eye lands on the fields that need a human check. Pixel-faithful to the
 * fields block in Redline.dc.html.
 */

const CONF_LABEL: Record<FieldSpec['confidence'], string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low, please check',
};

function confPillStyle(c: FieldSpec['confidence']): CSSProperties {
  const low = c === 'low';
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    font: '500 11px/1 var(--sans)',
    padding: '5px 9px',
    borderRadius: 14,
    color: low ? 'var(--amber)' : 'var(--ink3)',
    background: low ? 'var(--amber-soft)' : 'var(--panel2)',
  };
}

function confDotStyle(c: FieldSpec['confidence']): CSSProperties {
  return {
    width: 7,
    height: 7,
    flex: 'none',
    borderRadius: '50%',
    background: c === 'low' ? 'var(--amber)' : c === 'high' ? 'var(--ink2)' : 'var(--ink4)',
  };
}

function metaLine(f: FieldSpec): string {
  const levels = f.levels != null ? ` · ${f.levels} levels` : '';
  const missing = f.missing ? ` · ${f.missing} missing` : ' · 0 missing';
  return `${f.dtype}${levels}${missing}`;
}

export function FieldRow({
  field,
  onRoleChange,
}: {
  field: FieldSpec;
  onRoleChange: (role: FieldRole) => void;
}) {
  const low = field.confidence === 'low';

  const rowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 20,
    background: 'var(--panel)',
    border: '1px solid var(--line2)',
    borderRadius: 11,
    padding: '18px 20px',
    ...(low ? { boxShadow: 'inset 3px 0 0 var(--amber)' } : {}),
  };

  const selStyle: CSSProperties = {
    width: '100%',
    ...(field.edited ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}),
  };

  return (
    <div style={rowStyle}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ font: '600 15px/1.2 var(--mono)', color: 'var(--ink)' }}>{field.id}</span>
          <span style={{ font: '400 11.5px/1 var(--mono)', color: 'var(--ink4)' }}>
            {metaLine(field)}
          </span>
          {field.edited ? (
            <span
              style={{
                font: '600 9px/1 var(--mono)',
                letterSpacing: '.1em',
                textTransform: 'uppercase',
                color: 'var(--accent)',
                background: 'var(--accent-soft)',
                padding: '3px 6px',
                borderRadius: 4,
              }}
            >
              edited
            </span>
          ) : null}
        </div>

        <div
          style={{
            marginTop: 9,
            maxWidth: 600,
            font: '400 13.5px/1.5 var(--serif)',
            color: 'var(--ink2)',
          }}
        >
          {field.reason}
        </div>

        <div style={{ marginTop: 12 }}>
          <span style={confPillStyle(field.confidence)}>
            <span style={confDotStyle(field.confidence)} />
            {CONF_LABEL[field.confidence]}
          </span>
        </div>
      </div>

      <div style={{ width: 252, flex: 'none', display: 'flex', flexDirection: 'column', gap: 7 }}>
        <span
          style={{
            font: '500 10px/1 var(--mono)',
            letterSpacing: '.12em',
            color: 'var(--ink4)',
            textTransform: 'uppercase',
          }}
        >
          Meaning this field carries
        </span>
        <select
          aria-label={`Meaning for ${field.id}`}
          value={field.role}
          onChange={(e) => onRoleChange(e.target.value as FieldRole)}
          style={selStyle}
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
