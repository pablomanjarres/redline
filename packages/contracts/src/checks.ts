import { z } from 'zod';
import { Chart, Interval } from './charts.js';
import { CriticAssessment } from './critic.js';
import { CorrectedCode, PreviewArtifact, Recommendation } from './correction.js';
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
 * What the UI renders per check: numbers ⊕ narrative, plus the correction half
 * and the actor-critic layer.
 *
 * `Correction.shape` adds the corrected code, recommendations, and preview.
 * `computeState` preserves the actor's pre-critic verdict for audit while
 * `state` carries the effective, post-critic one (a veto flips a flag to
 * clean); `critic` carries the second pass so the card can show
 * "confirmed / downgraded / vetoed". Every added key is optional, so fixture
 * and pre-critic/pre-correction payloads still parse.
 */
export const CheckResult = ComputeResult.merge(Narrative)
  .extend(Correction.shape)
  .extend({
    computeState: CheckState.optional(),
    critic: CriticAssessment.optional(),
  });
export type CheckResult = z.infer<typeof CheckResult>;

/**
 * What a ComputeTarget returns: the statistics plus whatever correction the
 * check could produce. The prose is added afterwards by the reasoning layer.
 */
export const EngineResult = ComputeResult.extend(Correction.shape);
export type EngineResult = z.infer<typeof EngineResult>;

// ── Per-check knob configs ───────────────────────────────────────────────────
//
// Every knob name here is the EXACT string the Python engine reads via
// `cfg_get` in `services/rigor/redline/pillars/*`, because the config crosses
// the wire to that engine as JSON and the pillar looks each knob up by name. A
// knob whose name does not match what the pillar reads is ignored on the far
// side. The identifying knobs (gene, markers, target_group, grouping) are
// OPTIONAL: they carry the specifics an extracted claim's route params identify
// (which gene, which markers, which state), so a config that omits them still
// parses and every base config keeps working. `mergeRouteParams` layers a
// route's params over whichever knobs the config exposes, so a knob that does
// not exist here is a param it can never write. Adding these is what lets a
// route param reach the pillar instead of being dropped.
export const Check1Config = z.object({
  unit: z.string(),
  grouping: z.string(),
  alpha: z.number(),
  /** The claimed gene whose significance is under audit. Pillar 1 reads `gene`. */
  gene: z.string().optional(),
});
export type Check1Config = z.infer<typeof Check1Config>;

export const Check2Config = z.object({
  split: z.number(),
  grouping: z.string(),
  /** The claimed marker set for the state. Pillar 2 reads `markers`. */
  markers: z.array(z.string()).optional(),
  /**
   * The claimed cluster or state label being audited. Named `target_group`
   * because that is the exact knob Pillar 2 reads (double_dipping.py). The
   * extraction model emits this state under the route-param key `cluster`, so
   * an engine-side alias maps `cluster` onto `target_group` (see the routing
   * handoff in the stage report).
   */
  target_group: z.string().optional(),
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
  /**
   * The between-condition comparison column, when a claim identifies it under
   * the `grouping` key rather than `interest`. Pillar 4 reads `interest` first
   * and falls back to `grouping` (confounding.py), so this optional knob lets a
   * `grouping` route param reach the confounding check.
   */
  grouping: z.string().optional(),
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

/** The value shape of one knob, as far as a claim's route param needs to know. */
export type KnobKind = 'string' | 'number' | 'string[]';

/** Strip the optional and nullable wrappers off a knob to reach its value type. */
function knobKind(schema: z.ZodTypeAny): KnobKind | null {
  let cur: z.ZodTypeAny = schema;
  while (cur instanceof z.ZodOptional || cur instanceof z.ZodNullable) cur = cur.unwrap();
  if (cur instanceof z.ZodDefault) cur = cur.removeDefault();
  if (cur instanceof z.ZodArray) return 'string[]';
  if (cur instanceof z.ZodNumber) return 'number';
  if (cur instanceof z.ZodString) return 'string';
  return null;
}

function knobsOf(schema: z.ZodObject<z.ZodRawShape>): Record<string, KnobKind> {
  const out: Record<string, KnobKind> = {};
  for (const [key, value] of Object.entries(schema.shape)) {
    const kind = knobKind(value);
    if (kind) out[key] = kind;
  }
  return out;
}

/**
 * Every knob each check accepts, with its value type, derived from the schema
 * above rather than restated by hand.
 *
 * A claim's route params are merged over a check's config before the check runs.
 * Deciding which params are knobs by reading the keys of a *config value* only
 * works for knobs that value happens to carry, so an optional knob (`gene`,
 * `markers`, `target_group`) is absent from the defaults and can never be
 * written. The check then audits its default target while the interface names
 * the scientist's claim. Read the knobs off the schema instead: the schema
 * declares every knob a check accepts, present or not.
 */
export const CHECK_KNOBS: Record<CheckId, Record<string, KnobKind>> = {
  1: knobsOf(Check1Config),
  2: knobsOf(Check2Config),
  3: knobsOf(Check3Config),
  4: knobsOf(Check4Config),
  5: knobsOf(Check5Config),
  6: knobsOf(Check6Config),
  7: knobsOf(Check7Config),
  8: knobsOf(Check8Config),
};
