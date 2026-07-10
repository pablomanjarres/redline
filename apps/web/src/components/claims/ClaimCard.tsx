'use client';

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import type { CheckRoute, ClaimStatus, ExtractedClaim } from '@redline/contracts';
import { CheckChip, ConfidenceLight } from './shared';
import { RoutingEditor } from './RoutingEditor';

/** Visually hidden, still in the accessibility tree: a real bound label for the
 *  inline edit field, which has no visible label of its own. */
const SR_ONLY: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

/**
 * One in-scope claim on the Claim Review screen (spec section 6). It parallels a
 * design-matrix row: the claim text, what it rests on, which checks will test it,
 * and the confidence light (green holds, amber checks, red is unsure; a low claim
 * also draws an amber left rule so the eye lands on it). The controls confirm the
 * claim as-is, edit the wording, edit the routing, or remove it. A removed claim
 * collapses to a single undo line so the removal stays honest and reversible.
 */

const STATUS_BADGE: Partial<Record<ClaimStatus, { label: string; color: string; bg: string; border: string }>> = {
  confirmed: {
    label: 'confirmed',
    color: 'var(--green)',
    bg: 'var(--green-soft)',
    border: 'color-mix(in srgb, var(--green) 30%, transparent)',
  },
  edited: {
    label: 'edited',
    color: 'var(--signal)',
    bg: 'var(--signal-soft)',
    border: 'color-mix(in srgb, var(--signal) 30%, transparent)',
  },
  user_added: {
    label: 'added by you',
    color: 'var(--signal)',
    bg: 'var(--signal-soft)',
    border: 'color-mix(in srgb, var(--signal) 30%, transparent)',
  },
};

/** A small control button. `active` tints it with the blue interaction signal. */
function ctrlStyle(active = false): CSSProperties {
  return {
    font: '700 10px/1 var(--sans)',
    letterSpacing: '.06em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    padding: '9px 12px',
    borderRadius: 8,
    border: `1px solid ${active ? 'var(--signal)' : 'var(--edge-2)'}`,
    background: active ? 'var(--signal-soft)' : 'var(--panel)',
    color: active ? 'var(--signal)' : 'var(--ink-2)',
  };
}

export function ClaimCard({
  claim,
  tourCardId,
  tourRoutingId,
  onStatus,
  onText,
  onRouting,
  onImprove,
}: {
  claim: ExtractedClaim;
  /** Set by the page on the first card the guided tour spotlights. */
  tourCardId?: string;
  tourRoutingId?: string;
  onStatus: (status: ClaimStatus) => void;
  onText: (text: string) => void;
  onRouting: (checks: CheckRoute[]) => void;
  /**
   * Rewrite the current wording with the reasoner ("Improve with AI"). Resolves
   * to the sharper text, which replaces the edit draft. Rejects when no honest
   * rewrite is possible, and the card leaves the wording untouched. Absent when
   * no reasoning backend is wired, and then the control is not rendered.
   */
  onImprove?: (text: string) => Promise<string>;
}) {
  const [editing, setEditing] = useState(false);
  const [routingOpen, setRoutingOpen] = useState(false);
  const [draft, setDraft] = useState(claim.text);
  const [textFocused, setTextFocused] = useState(false);
  const [improving, setImproving] = useState(false);
  const [improveError, setImproveError] = useState<string | null>(null);
  const editId = useId();
  const improveErrorId = `${editId}-improve-error`;

  // Focus never falls to <body> when a control this card owns unmounts or goes
  // disabled. Removing collapses the card, so focus lands on Restore; restoring
  // re-expands it, so focus lands on the primary action; confirming disables the
  // Confirm button, so focus moves to the next live control instead of nowhere.
  const restoreRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const prevStatus = useRef(claim.status);
  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = claim.status;
    if (prev === claim.status) return;
    if (claim.status === 'removed') restoreRef.current?.focus();
    else if (prev === 'removed') confirmRef.current?.focus();
    else if (claim.status === 'confirmed') editRef.current?.focus();
  }, [claim.status]);

  const prevEditing = useRef(editing);
  useEffect(() => {
    const was = prevEditing.current;
    prevEditing.current = editing;
    if (was === editing) return;
    // Entering edit lands the caret in the field; leaving it (Save or Cancel
    // both unmount those buttons) returns focus to a stable card control.
    if (editing) textareaRef.current?.focus();
    else editRef.current?.focus();
  }, [editing]);

  // Removed: collapse to an undo line. Excluded from the audit, kept visible so
  // the user can restore it (nothing is silently dropped).
  if (claim.status === 'removed') {
    return (
      <div
        data-tour={tourCardId}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          background: 'var(--panel)',
          border: '1px dashed var(--edge-2)',
          borderRadius: 12,
          padding: '14px 18px',
          opacity: 0.72,
        }}
      >
        <span style={{ font: '600 10px/1 var(--mono)', letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
          Removed
        </span>
        <span style={{ flex: 1, minWidth: 0, font: '400 12.5px/1.5 var(--sans)', color: 'var(--ink-4)', textDecoration: 'line-through' }}>
          {claim.text}
        </span>
        <button ref={restoreRef} type="button" onClick={() => onStatus('proposed')} aria-label="Restore this claim to the audit" style={ctrlStyle()}>
          Restore
        </button>
      </div>
    );
  }

  const low = claim.confidence === 'low';
  const badge = STATUS_BADGE[claim.status];

  const card: CSSProperties = {
    background: 'var(--panel)',
    border: '1px solid var(--edge)',
    borderRadius: 12,
    padding: '18px 20px',
    // Longhand after the shorthand: the amber rule wins on the left edge only.
    ...(low ? { borderLeft: '3px solid var(--amber)' } : {}),
  };

  function beginEdit() {
    setDraft(claim.text);
    setImproveError(null);
    setEditing(true);
  }
  function saveText() {
    const next = draft.trim();
    if (next !== '' && next !== claim.text) onText(next);
    setImproveError(null);
    setEditing(false);
  }
  function cancelEdit() {
    setDraft(claim.text);
    setImproveError(null);
    setEditing(false);
  }

  // Ask the reasoner to sharpen the current draft. The rewrite replaces the draft
  // so the scientist reviews it before Save; a failure surfaces amber (a needs-
  // input state, red is reserved for statistical findings) and the wording is left
  // as the scientist had it. It improves what is in the field, falling back to the
  // claim text when the field was cleared.
  async function improve() {
    if (!onImprove || improving) return;
    setImproveError(null);
    setImproving(true);
    try {
      const improved = await onImprove(draft.trim() === '' ? claim.text : draft.trim());
      setDraft(improved);
    } catch {
      setImproveError(
        'Redline could not improve that wording right now, so it is unchanged. Try again, or configure a Claude backend.',
      );
    } finally {
      setImproving(false);
    }
  }

  return (
    <div data-tour={tourCardId} style={card}>
      {/* claim text + status */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {editing ? (
            <>
              <label htmlFor={editId} style={SR_ONLY}>
                Edit the claim wording
              </label>
              <textarea
                ref={textareaRef}
                id={editId}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onFocus={() => setTextFocused(true)}
                onBlur={() => setTextFocused(false)}
                aria-describedby={improveError ? improveErrorId : undefined}
                aria-busy={improving}
                rows={3}
                style={{
                  width: '100%',
                  resize: 'vertical',
                  font: '500 15px/1.5 var(--sans)',
                  color: 'var(--ink)',
                  background: 'var(--void)',
                  border: '1px solid var(--signal)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  outline: 'none',
                  boxShadow: textFocused ? '0 0 0 3px var(--signal-soft)' : 'none',
                }}
              />
              {improveError && (
                <div
                  id={improveErrorId}
                  role="alert"
                  style={{
                    marginTop: 9,
                    display: 'flex',
                    gap: 9,
                    background: 'var(--amber-soft)',
                    border: '1px solid color-mix(in srgb, var(--amber) 32%, transparent)',
                    borderRadius: 9,
                    padding: '9px 11px',
                  }}
                >
                  <span style={{ width: 7, height: 7, marginTop: 4, flex: 'none', borderRadius: 7, background: 'var(--amber)' }} />
                  <p style={{ margin: 0, font: '400 12px/1.5 var(--sans)', color: 'var(--ink-2)' }}>{improveError}</p>
                </div>
              )}
            </>
          ) : (
            <p style={{ margin: 0, font: '600 15px/1.45 var(--sans)', color: 'var(--ink)' }}>{claim.text}</p>
          )}
        </div>
        {badge && !editing && (
          <span
            style={{
              flex: 'none',
              font: '600 9px/1 var(--mono)',
              letterSpacing: '.14em',
              textTransform: 'uppercase',
              color: badge.color,
              background: badge.bg,
              border: `1px solid ${badge.border}`,
              padding: '4px 8px',
              borderRadius: 5,
            }}
          >
            {badge.label}
          </span>
        )}
      </div>

      {/* what it rests on */}
      <div style={{ marginTop: 12 }}>
        <span style={{ font: '600 9.5px/1 var(--mono)', letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
          Rests on
        </span>
        <p style={{ margin: '6px 0 0', font: '400 12.5px/1.55 var(--mono)', color: 'var(--ink-2)' }}>{claim.restsOn}</p>
      </div>

      {/* ambiguous routing: surfaced, never hidden (spec sections 8, 11) */}
      {claim.ambiguousRouting && (
        <div
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
          <span style={{ width: 7, height: 7, marginTop: 4, flex: 'none', borderRadius: 7, background: 'var(--amber)', boxShadow: '0 0 7px var(--amber)' }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ font: '700 9.5px/1 var(--mono)', letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--amber)' }}>
              Routing needs your call
            </div>
            <p style={{ margin: '5px 0 0', font: '400 12px/1.5 var(--sans)', color: 'var(--ink-2)' }}>{claim.ambiguousRouting}</p>
          </div>
        </div>
      )}

      {/* routing: read-only chips, or the toggle editor when open */}
      <div data-tour={tourRoutingId} style={{ marginTop: 14 }}>
        <span style={{ font: '600 9.5px/1 var(--mono)', letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
          Checks that will test this
        </span>
        {routingOpen ? (
          <RoutingEditor routes={claim.checks} onChange={onRouting} />
        ) : claim.checks.length > 0 ? (
          <div style={{ marginTop: 9, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {claim.checks.map((r) => (
              <CheckChip key={r.check} id={r.check} />
            ))}
          </div>
        ) : (
          <p style={{ margin: '9px 0 0', font: '400 12px/1.5 var(--sans)', color: 'var(--amber)' }}>
            No check tests this claim. Edit the routing to select one, or remove the claim.
          </p>
        )}
      </div>

      {/* confidence light + controls */}
      <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <ConfidenceLight confidence={claim.confidence} />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {editing ? (
            <>
              {onImprove && (
                <button
                  type="button"
                  onClick={improve}
                  disabled={improving}
                  aria-label="Improve the claim wording with AI"
                  style={{
                    ...ctrlStyle(),
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    ...(improving ? { opacity: 0.6, cursor: 'default' } : {}),
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 6,
                      height: 6,
                      flex: 'none',
                      borderRadius: 6,
                      background: 'var(--signal)',
                      boxShadow: improving ? 'none' : '0 0 6px var(--signal)',
                      animation: improving ? 'rl-pulse 1s infinite' : undefined,
                    }}
                  />
                  {improving ? 'Improving…' : 'Improve with AI'}
                </button>
              )}
              <button
                type="button"
                onClick={saveText}
                disabled={improving}
                aria-label="Save the edited wording"
                style={{ ...ctrlStyle(true), ...(improving ? { opacity: 0.5, cursor: 'default' } : {}) }}
              >
                Save
              </button>
              <button type="button" onClick={cancelEdit} aria-label="Cancel editing" style={ctrlStyle()}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                ref={confirmRef}
                type="button"
                onClick={() => onStatus('confirmed')}
                disabled={claim.status === 'confirmed'}
                aria-label="Confirm this claim as it stands"
                style={{ ...ctrlStyle(), ...(claim.status === 'confirmed' ? { opacity: 0.5, cursor: 'default' } : {}) }}
              >
                {claim.status === 'confirmed' ? 'Confirmed' : 'Confirm'}
              </button>
              <button ref={editRef} type="button" onClick={beginEdit} aria-label="Edit the claim wording" style={ctrlStyle()}>
                Edit wording
              </button>
              <button
                type="button"
                onClick={() => setRoutingOpen((v) => !v)}
                aria-label="Edit which checks test this claim"
                style={ctrlStyle(routingOpen)}
              >
                {routingOpen ? 'Done routing' : 'Edit routing'}
              </button>
              <button type="button" onClick={() => onStatus('removed')} aria-label="Remove this claim from the audit" style={ctrlStyle()}>
                Remove
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
