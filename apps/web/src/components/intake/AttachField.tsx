'use client';

import { useId, useState } from 'react';
import { fmt } from '@/lib/format';

/**
 * One optional attach point on Intake: a labeled textarea the scientist can
 * paste text into (a notebook or script, or claims / prose). It is text, so it
 * feeds the extraction model directly and needs no compute, which is why it
 * works in every mode, fixture included.
 *
 * Accessibility: a real <label> is bound to the field by id, the hint reaches
 * the field through aria-describedby, and the character count is live. The focus
 * ring is the interaction blue, matching the inputs in tokens.css (which ring on
 * :focus, so both a mouse and a keyboard focus show it).
 */
export function AttachField({
  label,
  hint,
  placeholder,
  value,
  onChange,
  rows = 4,
}: {
  label: string;
  hint: string;
  placeholder: string;
  value: string;
  onChange: (text: string) => void;
  rows?: number;
}) {
  const fieldId = useId();
  const hintId = `${fieldId}-hint`;
  const [focused, setFocused] = useState(false);
  const count = value.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <label
          htmlFor={fieldId}
          style={{
            font: '600 10.5px/1 var(--mono)',
            letterSpacing: '.1em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
          }}
        >
          {label}
        </label>
        <span style={{ font: '400 10px/1 var(--mono)', color: 'var(--ink-4)' }}>
          {count === 0 ? 'optional' : `${fmt(count)} characters`}
        </span>
      </div>
      <textarea
        id={fieldId}
        aria-describedby={hintId}
        placeholder={placeholder}
        value={value}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="rl-scroll"
        style={{
          resize: 'vertical',
          width: '100%',
          minHeight: 84,
          font: '400 12.5px/1.55 var(--mono)',
          color: 'var(--ink)',
          background: 'var(--void)',
          border: `1px solid ${focused ? 'var(--signal)' : 'var(--edge-2)'}`,
          borderRadius: 9,
          padding: '11px 12px',
          outline: 'none',
          boxShadow: focused ? '0 0 0 3px var(--signal-soft)' : 'none',
          transition: 'border-color .12s ease, box-shadow .12s ease',
        }}
      />
      <p id={hintId} style={{ margin: 0, font: '400 11.5px/1.5 var(--sans)', color: 'var(--ink-4)' }}>
        {hint}
      </p>
    </div>
  );
}
