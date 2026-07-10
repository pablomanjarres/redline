import { z } from 'zod';
import { Chart, Interval } from './charts.js';
import { CorrectedCode, PreviewArtifact, Recommendation } from './correction.js';
import { CriticAssessment } from './critic.js';
import { CheckId, CheckState, Citation } from './primitives.js';

export const StatReadout = z.object({
  label: z.string(),
  value: z.string(), // the median (or point) value, formatted
  bad: z.boolean().optional(),
  good: z.boolean().optional(),
  interval: Interval.optional(), // the median+CI distribution behind this stat (Add-on 3)
});
export type StatReadout = z.infer<typeof StatReadout>;

/**
 * Where a ComputeResult's numbers came from. Optional so older payloads and the
 * locked fixtures still parse. `target` names the seam that ran (fixture / local
 * / cloudrun / endpoint); `engine`, `ran`, `nonce`, and `elapsedMs` let the
 * verification harness prove the numbers were freshly computed, not replayed.
 */
export const ComputeProvenance = z.object({
  target: z.enum(['fixture', 'local', 'cloudrun', 'endpoint']),
  engine: z.string().optional(),
  ran: z.string().optional(),
  nonce: z.string().optional(),
  elapsedMs: z.number().optional(),
});
export type ComputeProvenance = z.infer<typeof ComputeProvenance>;

/**
 * Numbers + chart + verdict. Produced by a ComputeTarget (the locked fixture,
 * or the real Python rigor engine). This is the half of a finding that is
 * statistics, not prose.
 */
export const ComputeResult = z.object({
  checkId: CheckId,
  state: CheckState,
  headline: z.string(),
  stats: z.array(StatReadout),
  chart: Chart,
  provenance: ComputeProvenance.optional(), // where these numbers came from; absent on older payloads
});
export type ComputeResult = z.infer<typeof ComputeResult>;

/**
 * The prose half of a finding. Produced by the reasoning layer (Claude via
 * Bedrock) or the curated fallback: names the failure mode, cites the fixing
 * method, and rewrites the conclusion in defensible language.
 */
export const Narrative = z.object({
  error: z.string().nullable(), // failure-mode name; null on a clean verdict
  citation: Citation,
  original: z.string().nullable(), // the scientist's claim, struck through
  corrected: z.string(), // the defensible rewrite (or clean verdict)
  missing: z.string().optional(), // what's needed when a check can't run
  source: z.enum(['bedrock', 'anthropic', 'curated', 'fixture']).optional(), // which reasoner produced this prose
});
export type Narrative = z.infer<typeof Narrative>;

/**
 * The correction half of a finding: the runnable script that reproduces the
 * honest re-analysis, what to do about it, and the corrected result rendered
 * beside the claimed one. Every field is optional, so a check that cannot
 * correct, or a compute target that does not run a preview, simply omits it and
 * the card renders what it has.
 */
export const Correction = z.object({
  correctedCode: CorrectedCode.optional(),
  recommendations: z.array(Recommendation).optional(),
  preview: PreviewArtifact.optional(),
});
export type Correction = z.infer<typeof Correction>;

/**
 * What the UI renders per check: numbers, narrative, correction, and the
 * actor-critic layer.
 *
 * `state` is the effective, post-critic verdict (a veto flips a flag to clean).
 * `computeState` preserves the actor's pre-critic verdict for audit, and `critic`
 * carries the second pass so the card can show "confirmed / downgraded / vetoed".
 * The correction keys carry the runnable script, the recommended actions, and the
 * before/after preview. All of them are optional, so fixture, pre-critic, and
 * uncorrectable payloads still parse.
 */
export const CheckResult = ComputeResult.merge(Narrative).extend({
  computeState: CheckState.optional(),
  critic: CriticAssessment.optional(),
  ...Correction.shape,
});
export type CheckResult = z.infer<typeof CheckResult>;

/**
 * What a ComputeTarget returns: the statistics plus whatever correction the
 * check could produce. The prose is added afterwards by the reasoning layer.
 */
export const EngineResult = ComputeResult.extend(Correction.shape);
export type EngineResult = z.infer<typeof EngineResult>;

// ── Per-check knob configs ───────────────────────────────────────────────────
export const Check1Config = z.object({
  unit: z.string(),
  grouping: z.string(),
  alpha: z.number(),
});
export type Check1Config = z.infer<typeof Check1Config>;

export const Check2Config = z.object({
  split: z.number(),
  grouping: z.string(),
});
export type Check2Config = z.infer<typeof Check2Config>;

export const Check3Config = z.object({
  min: z.number(),
  max: z.number(),
  step: z.number(),
  track: z.string(),
  scrub: z.number(),
});
export type Check3Config = z.infer<typeof Check3Config>;

export const Check4Config = z.object({
  interest: z.string(),
  nuisance: z.array(z.string()),
});
export type Check4Config = z.infer<typeof Check4Config>;

/** Check 5 (multiple testing): the q threshold and the adjustment method. */
export const Check5Config = z.object({
  alpha: z.number(),
  method: z.enum(['bh', 'by']),
});
export type Check5Config = z.infer<typeof Check5Config>;

/** Check 6 (unmodeled covariate): the effect of interest and the batch to add. */
export const Check6Config = z.object({
  interest: z.string(),
  covariate: z.string(),
  alpha: z.number(),
});
export type Check6Config = z.infer<typeof Check6Config>;

/** Check 7 (resolution choice): the sweep, the criterion, and the chosen value. */
export const Check7Config = z.object({
  min: z.number(),
  max: z.number(),
  step: z.number(),
  criterion: z.enum(['silhouette', 'ari']),
  chosen: z.number(),
});
export type Check7Config = z.infer<typeof Check7Config>;

/** Check 8 (test assumptions): the grouping and the test the analysis used. */
export const Check8Config = z.object({
  grouping: z.string(),
  claimedTest: z.enum(['ttest', 'wilcoxon', 'unknown']),
  alpha: z.number(),
});
export type Check8Config = z.infer<typeof Check8Config>;

/** The full knob state, keyed by check id. */
export const CheckConfigMap = z.object({
  1: Check1Config,
  2: Check2Config,
  3: Check3Config,
  4: Check4Config,
  5: Check5Config,
  6: Check6Config,
  7: Check7Config,
  8: Check8Config,
});
export type CheckConfigMap = z.infer<typeof CheckConfigMap>;

/** The config a given check id carries. Derived, so a new check needs no branch. */
export type CheckConfigFor<Id extends CheckId> = CheckConfigMap[Id];

/** Any check's config, for the seams that take whichever one applies. */
export type AnyCheckConfig = CheckConfigMap[CheckId];
