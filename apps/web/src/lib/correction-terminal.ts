import type { StatReadout } from '@redline/contracts';

/**
 * Turn a computed finding into the terminal reveal shown under the corrected
 * code: the command that reproduces it, one line per computed stat, and the
 * verdict. This is presentation only. Every number comes from the result the
 * ComputeTarget produced, so the reveal can never assert a figure the audit did
 * not compute.
 *
 * The input is the narrow view this reveal reads, not the whole CheckResult, so
 * the derivation stays testable with plain objects. A real CheckResult satisfies
 * it structurally.
 */
export interface CorrectionResultView {
  headline: string;
  stats: ReadonlyArray<Pick<StatReadout, 'label' | 'value' | 'bad' | 'good'>>;
  correctedCode?: { entrypoint: string } | undefined;
  preview?: { unsalvageable?: boolean; after?: unknown } | undefined;
  provenance?: { target?: string } | undefined;
}

export type TermTone = 'bad' | 'good' | 'plain';

export interface TermLine {
  label: string;
  value: string;
  tone: TermTone;
}

export interface CorrectionTerminal {
  /** The command that reproduces this result, or '' when there is no fix to run. */
  command: string;
  /** One line per computed stat, in the result's order. */
  lines: TermLine[];
  /** The finding's headline, shown as the closing verdict line. */
  verdict: string;
  /** True when no valid corrected result exists, so none is shown. */
  unsalvageable: boolean;
  /** The compute seam that produced the numbers (fixture / cloudrun / ...), for the label. */
  target: string | null;
}

function toneOf(s: Pick<StatReadout, 'bad' | 'good'>): TermTone {
  if (s.bad) return 'bad';
  if (s.good) return 'good';
  return 'plain';
}

export function correctionTerminal(result: CorrectionResultView): CorrectionTerminal {
  const unsalvageable =
    result.preview?.unsalvageable === true ||
    (result.preview !== undefined && result.preview.after === null);

  return {
    command: result.correctedCode?.entrypoint ?? '',
    lines: result.stats.map((s) => ({ label: s.label, value: s.value, tone: toneOf(s) })),
    verdict: result.headline,
    unsalvageable,
    target: result.provenance?.target ?? null,
  };
}
