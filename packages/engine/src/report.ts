import type { AuditReport, CheckResult, CheckState, DatasetMeta } from '@redline/contracts';

const NEED_INPUT: CheckState[] = ['flag_only', 'hard_stop'];

/**
 * Assemble the printable audit from the per-check results. Counts flagged, clean,
 * and needs-input verdicts and writes a one-line summary. The verdict is plain and
 * concrete: it never softens a flag or claims a check ran that did not, and it
 * derives every count from the results present, never from a fixed check total.
 */
export function assembleReport(dataset: DatasetMeta, results: CheckResult[]): AuditReport {
  const flagged = results.filter((r) => r.state === 'flagged').length;
  const clean = results.filter((r) => r.state === 'clean').length;
  const needInput = results.filter((r) => NEED_INPUT.includes(r.state)).length;
  return {
    dataset,
    results,
    flagged,
    clean,
    needInput,
    verdict: verdictLine(results.length, flagged, clean, needInput),
  };
}

function plural(n: number, noun: string): string {
  return n === 1 ? noun : noun + 's';
}

function verdictLine(total: number, flagged: number, clean: number, needInput: number): string {
  if (total === 0) return 'No checks have run yet.';
  const parts: string[] = [];
  if (flagged > 0) parts.push(`${flagged} ${plural(flagged, 'check')} flagged a rigor problem`);
  if (clean > 0) parts.push(`${clean} passed clean`);
  if (needInput > 0) parts.push(`${needInput} need more input to assess`);
  if (parts.length === 0) return `${total} ${plural(total, 'check')} ran.`;
  const line = parts.join(', ');
  return `${line.charAt(0).toUpperCase()}${line.slice(1)}.`;
}
