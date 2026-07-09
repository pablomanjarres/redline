/**
 * Small, shared display formatters. Numbers render the same way on every
 * Redline surface so the report and the workbench never disagree.
 */

import type { Interval } from '@redline/contracts';

/** Thousands-separated integer, e.g. 52000 -> "52,000". */
export function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

/** A 0..1 fraction as a whole-number percent, e.g. 0.15 -> "15%". */
export function pct(x: number, digits = 0): string {
  return `${(x * 100).toFixed(digits)}%`;
}

/** Count with a unit label, singular-aware, e.g. plural(1, 'donor') -> "1 donor". */
export function plural(n: number, word: string, suffix = 's'): string {
  return `${fmt(n)} ${word}${n === 1 ? '' : suffix}`;
}

/** A significance-threshold label, e.g. 0.05 -> "α = 0.05". */
export function alphaLabel(a: number): string {
  return `α = ${a.toFixed(2)}`;
}

/** "N of M" for report tallies, e.g. counts(2, 4) -> "2 of 4". */
export function counts(n: number, total: number): string {
  return `${n} of ${total}`;
}

// ── Repeat intervals (Add-on 3) ───────────────────────────────────────────────

/**
 * Format an interval bound the way its stat card shows the value, inferred from
 * the displayed string: a percent ("40%"), an integer count ("0 / 4"), else a
 * two-decimal number ("0.57"). Keeps the bound and the median in one format.
 */
export function formatLike(x: number, valueStr: string): string {
  if (valueStr.trim().endsWith('%')) return `${Math.round(x * 100)}%`;
  if (valueStr.includes('/')) return `${Math.round(x)}`;
  return x.toFixed(2);
}

/** The interval bounds as a range, e.g. "0.54–0.61" or "20–45%". En dash is
 *  numeric-range typography, allowed by the prose rules. */
export function ciRange(iv: Interval, valueStr = ''): string {
  return `${formatLike(iv.lo, valueStr)}–${formatLike(iv.hi, valueStr)}`;
}

/** The full interval clause, e.g. "95% interval 0.54–0.61". */
export function ciLabel(iv: Interval, valueStr = ''): string {
  return `${Math.round(iv.level * 100)}% interval ${ciRange(iv, valueStr)}`;
}

/** The repetition-count clause, e.g. "over 200 runs". */
export function repsLabel(iv: Interval, word = 'runs'): string {
  return `over ${fmt(iv.n)} ${word}`;
}
