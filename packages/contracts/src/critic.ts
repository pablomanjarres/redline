import { z } from 'zod';
import { CheckId, CheckState } from './primitives.js';

/**
 * @redline/contracts/critic - the actor-critic layer. After a check (the actor)
 * produces a candidate finding, a separate Claude call (the critic) re-examines
 * it against the numbers and can confirm, downgrade, or veto it. Only a finding
 * the critic confirms surfaces as FLAGGED. These shapes are the strict contract
 * for that second pass and for what it attaches to a finding.
 *
 * This module imports only primitives, so `checks.ts` can attach a
 * `CriticAssessment` to `CheckResult` without a circular import.
 */

/**
 * The critic's ruling on one candidate finding:
 * - confirm: the flag is warranted, it stays FLAGGED.
 * - downgrade: the flag rests on a borderline or underpowered test, it is lowered
 *   to a soft advisory (still shown, with the reason) rather than a hard finding.
 * - veto: the numbers do not support the flag, it is suppressed and the check
 *   reports clean for that item.
 */
export const CriticVerdict = z.enum(['confirm', 'downgrade', 'veto']);
export type CriticVerdict = z.infer<typeof CriticVerdict>;

/** How sure the critic is about its ruling. */
export const CriticConfidence = z.enum(['high', 'medium', 'low']);
export type CriticConfidence = z.infer<typeof CriticConfidence>;

/** The load-bearing numbers behind a candidate finding, as label -> value pairs. */
export const CriticEvidence = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()]),
);
export type CriticEvidence = z.infer<typeof CriticEvidence>;

/**
 * The strict JSON the critic model returns. Keys match the wire contract exactly
 * (`keys_on` snake_case) so the parse is a direct validation of the model reply.
 */
export const CriticJudgment = z.object({
  verdict: CriticVerdict,
  /** The specific number or field the ruling keys on, quoted from the evidence. */
  keys_on: z.string(),
  /** One sentence on why the flag is or is not warranted. */
  justification: z.string(),
  confidence: CriticConfidence,
});
export type CriticJudgment = z.infer<typeof CriticJudgment>;

/**
 * What the critic sees for one candidate finding: the check, the actor's verdict,
 * the claim under audit, the dataset, the numbers, and (optionally) the method
 * that ran, the resolved design, and the check's own reasoning. The critic keys
 * its ruling on these numbers, so they are the whole context it needs.
 */
export const CriticRequest = z.object({
  checkId: CheckId,
  /** The actor's pre-critic verdict. The critic only runs on `flagged`. */
  computeState: CheckState,
  claim: z.string(),
  datasetTitle: z.string(),
  evidence: CriticEvidence,
  /** The real method that produced the numbers, e.g. "Welch t on per-unit means". */
  method: z.string().optional(),
  /** The resolved roles, e.g. "unit=donor_id, grouping=condition, nuisance=lane". */
  design: z.string().optional(),
  /** The check's own one-line reason for firing, if the actor supplies one. */
  checkReasoning: z.string().optional(),
});
export type CriticRequest = z.infer<typeof CriticRequest>;

/** Where a critic assessment came from. `curated` marks the fail-safe path. */
export const CriticSource = z.enum(['bedrock', 'anthropic', 'curated']);
export type CriticSource = z.infer<typeof CriticSource>;

/**
 * The resolved critic assessment attached to a finding and logged for the harness.
 * `unverified` is true when the critic call failed or its reply did not parse: the
 * finding is then shown by default (fail safe toward showing, never toward hiding
 * a real problem) and this flag says the second pass did not actually run.
 */
export const CriticAssessment = z.object({
  verdict: CriticVerdict,
  keysOn: z.string(),
  justification: z.string(),
  confidence: CriticConfidence,
  unverified: z.boolean(),
  source: CriticSource,
});
export type CriticAssessment = z.infer<typeof CriticAssessment>;
