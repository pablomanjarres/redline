/**
 * Small, shared display formatters. Numbers render the same way on every
 * Redline surface so the report and the workbench never disagree.
 */

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
