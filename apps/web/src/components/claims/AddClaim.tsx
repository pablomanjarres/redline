'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useSession } from '@/state/session';

/**
 * Manual claim entry (spec section 7). The user types one sentence and Redline
 * maps it: it classifies the claim, routes it to the applicable checks, and
 * extracts the params from the data, exactly as extraction does. The user never
 * picks a check by hand. If the mapping call fails (503 reasoning_unavailable),
 * Redline says so plainly and adds nothing, because guessing a routing would
 * produce a confident wrong audit (spec sections 7, 11). The failure reads amber,
 * a needs-input state, because red is reserved for statistical findings.
 */
export function AddClaim() {
  const { addClaim, addingClaim, addClaimError, extractedClaims } = useSession();
  const [text, setText] = useState('');
  const inputId = useId();
  const descId = `${inputId}-desc`;

  // Clear the input only when the claim list actually grows, so a successful add
  // resets the field while a failed one keeps the sentence for a retry.
  const count = extractedClaims?.length ?? 0;
  const prevCount = useRef(count);
  useEffect(() => {
    if (count > prevCount.current) setText('');
    prevCount.current = count;
  }, [count]);

  const canSubmit = !addingClaim && text.trim() !== '';
  function submit() {
    if (!canSubmit) return;
    void addClaim(text.trim());
  }

  return (
    <section
      data-tour="claims.add"
      aria-label="Add a claim manually"
      style={{ background: 'var(--panel)', border: '1px solid var(--edge)', borderRadius: 12, padding: '18px 20px' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span aria-hidden style={{ width: 6, height: 6, borderRadius: 2, background: 'var(--signal)', boxShadow: '0 0 8px var(--signal)' }} />
        <label
          htmlFor={inputId}
          style={{ font: '700 10px/1 var(--mono)', letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--ink-3)' }}
        >
          Add a claim
        </label>
      </div>
      <p id={descId} style={{ margin: '10px 0 0', maxWidth: 560, font: '400 12.5px/1.55 var(--sans)', color: 'var(--ink-3)' }}>
        Type a claim your analysis makes. Redline routes it to the checks that can test it and pulls the specifics from your
        data. You do not pick a check by hand.
      </p>
      <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <input
          id={inputId}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="e.g. IL2RA knockdown raises FOXP3 across CD4 T cells"
          aria-describedby={descId}
          disabled={addingClaim}
          style={{
            flex: 1,
            minWidth: 260,
            font: '500 13px/1.4 var(--sans)',
            color: 'var(--ink)',
            background: 'var(--void)',
            border: '1px solid var(--edge-2)',
            borderRadius: 9,
            padding: '11px 13px',
          }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          style={{
            flex: 'none',
            font: '700 11px/1 var(--sans)',
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            color: 'var(--surface)',
            background: 'var(--signal)',
            border: 'none',
            borderRadius: 9,
            padding: '11px 18px',
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            opacity: canSubmit ? 1 : 0.5,
          }}
        >
          {addingClaim ? 'Mapping…' : 'Add claim'}
        </button>
      </div>
      {addClaimError && (
        <div
          role="alert"
          style={{
            marginTop: 12,
            display: 'flex',
            gap: 9,
            background: 'var(--amber-soft)',
            border: '1px solid color-mix(in srgb, var(--amber) 32%, transparent)',
            borderRadius: 9,
            padding: '10px 12px',
          }}
        >
          <span style={{ width: 7, height: 7, marginTop: 4, flex: 'none', borderRadius: 7, background: 'var(--amber)' }} />
          <p style={{ margin: 0, font: '400 12px/1.5 var(--sans)', color: 'var(--ink-2)' }}>{addClaimError}</p>
        </div>
      )}
    </section>
  );
}
