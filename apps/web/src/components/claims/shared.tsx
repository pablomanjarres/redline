import type { CheckId, Confidence } from '@redline/contracts';

/**
 * Shared, presentational parts for the Claim Review screen. Kept in one place so
 * the in-scope card, the out-of-scope card, and the routing editor all read the
 * same check names, the same confidence lights, and the same curated notice. The
 * screen deliberately parallels design resolution, so these mirror the field
 * matrix row: same confidence colors, same "Low, please check" wording.
 */

/** The real check names, shown on every routing chip (01..04). */
export const CHECK_NAMES: Record<CheckId, string> = {
  1: 'Pseudoreplication',
  2: 'Double dipping',
  3: 'Fragility',
  4: 'Confounding',
};

export const CHECK_IDS: CheckId[] = [1, 2, 3, 4];

/** The confidence light color: green holds, amber checks, red is unsure. */
export const CONF_COLOR: Record<Confidence, string> = {
  high: 'var(--green)',
  medium: 'var(--amber)',
  low: 'var(--red)',
};

export const CONF_LABEL: Record<Confidence, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low · please check',
};

/**
 * Shown prominently whenever the claim list is the curated built-in reference
 * rather than a live model reading. A curated fallback must never look like a
 * live reading of the scientist's data (honesty invariant c).
 */
export const CURATED_CLAIMS_NOTICE =
  'No Claude backend answered, so Redline is showing its curated reference claims for this dataset instead of a live reading. Wire a backend to extract claims from your own analysis.';

/** The confidence light for a claim, identical in form to the field matrix row. */
export function ConfidenceLight({ confidence }: { confidence: Confidence }) {
  const color = CONF_COLOR[confidence];
  const low = confidence === 'low';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 8, height: 8, flex: 'none', borderRadius: 8, background: color, boxShadow: `0 0 8px ${color}` }} />
      <span
        style={{
          font: '600 10px/1 var(--mono)',
          letterSpacing: '.14em',
          textTransform: 'uppercase',
          color: low ? 'var(--amber)' : 'var(--ink-3)',
        }}
      >
        {CONF_LABEL[confidence]}
      </span>
    </span>
  );
}

/** A read-only routing chip: which check will test the claim, by its real name. */
export function CheckChip({ id }: { id: CheckId }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        font: '600 10px/1 var(--mono)',
        letterSpacing: '.04em',
        color: 'var(--ink-2)',
        background: 'var(--panel-2)',
        border: '1px solid var(--edge-2)',
        padding: '6px 10px',
        borderRadius: 7,
      }}
    >
      <span style={{ color: 'var(--ink-4)' }}>0{id}</span>
      <span>{CHECK_NAMES[id]}</span>
    </span>
  );
}
