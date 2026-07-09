import type {
  CheckState,
  CriticAssessment,
  CriticJudgment,
  CriticSource,
} from '@redline/contracts';

/**
 * The gate between the critic's ruling and what the user sees. It is a pure
 * function of the actor's verdict and the critic's judgment, so it is client-safe
 * and testable without a backend.
 *
 * The critic only rules on a `flagged` candidate (the route enforces this). The
 * gate then decides the effective verdict:
 * - confirm   -> stays flagged.
 * - downgrade -> stays flagged but is marked a soft advisory in the assessment; it
 *                is lowered, not suppressed, so the finding is still shown.
 * - veto      -> flips to clean; the check reports Verified for this item.
 */
export interface CriticGateResult {
  /** The effective, post-critic verdict the UI and report should use. */
  state: CheckState;
  assessment: CriticAssessment;
}

export function applyCriticGate(
  computeState: CheckState,
  judgment: CriticJudgment,
  source: CriticSource,
): CriticGateResult {
  const assessment: CriticAssessment = {
    verdict: judgment.verdict,
    keysOn: judgment.keys_on,
    justification: judgment.justification,
    confidence: judgment.confidence,
    unverified: false,
    source,
  };
  // A veto suppresses the flag: the finding reports clean for this item. Confirm
  // and downgrade both keep the finding surfaced (downgrade softens it via the
  // assessment, it does not hide it).
  const state: CheckState = judgment.verdict === 'veto' ? 'clean' : computeState;
  return { state, assessment };
}

/**
 * The fail-safe assessment for when the critic could not run: no backend, a call
 * error, or an unparseable reply. The finding stays flagged and is marked
 * critic-unverified. Fail toward showing a real problem, never toward hiding it.
 */
export function unverifiedAssessment(reason?: string): CriticAssessment {
  return {
    verdict: 'confirm',
    keysOn: '',
    justification:
      reason ?? 'The critic did not run; this finding is shown by default.',
    confidence: 'low',
    unverified: true,
    source: 'curated',
  };
}
