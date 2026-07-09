import { z } from 'zod';

/**
 * A per-replicate aggregated profile (one row per independent unit), the
 * substrate for the pseudoreplication chart. `group` is the resolved grouping
 * label (e.g. "ketamine"/"saline" or "stim"/"unstim"); never assume "mouse".
 */
export const UnitProfile = z.object({
  id: z.string(),
  group: z.string(),
  n: z.number().int(),
  value: z.number(),
});
export type UnitProfile = z.infer<typeof UnitProfile>;

export const SignificanceLevel = z.object({
  n: z.number().int(),
  p: z.number(),
  log10p: z.number(),
  sig: z.boolean(),
});
export type SignificanceLevel = z.infer<typeof SignificanceLevel>;

/**
 * Check 1 (pseudoreplication): naive vs honest re-test. Also carries checks 6
 * and 8, which have the same shape: a claimed statistic beside the statistic a
 * correctly specified model produces.
 */
export const SignificanceChart = z.object({
  kind: z.literal('significance'),
  naive: SignificanceLevel,
  honest: SignificanceLevel,
  alpha: z.number(),
  units: z.array(UnitProfile),
  badUnit: z.boolean(),
});

/** Check 1 hard branch: too few independent units for any valid test. */
export const HardStopChart = z.object({
  kind: z.literal('hardstop'),
  units: z.number().int(),
  perGroup: z.number().int(),
  profiles: z.array(UnitProfile),
});

export const Marker = z.object({
  gene: z.string(),
  disc: z.number(), // separation (AUC) on the discovery split
  hold: z.number(), // separation (AUC) on the held-out split
});
export type Marker = z.infer<typeof Marker>;

/** Check 2 (double dipping): do markers survive a held-out test. */
export const GroupsChart = z.object({
  kind: z.literal('groups'),
  markers: z.array(Marker),
  split: z.number(),
  verified: z.boolean(),
  discAUC: z.number().optional(),
  holdAUC: z.number().optional(),
});

export const FragilityStep = z.object({
  r: z.number(), // resolution setting
  present: z.boolean(), // is the tracked group a discrete cluster here
  clusters: z.number().int(),
  /** Cluster-quality score at this setting. Check 7 fills it; check 3 omits it. */
  silhouette: z.number().optional(),
});
export type FragilityStep = z.infer<typeof FragilityStep>;

/**
 * Check 3 (clustering fragility): appears/vanishes across a resolution sweep.
 * Check 7 reuses it for the whole-clustering stability profile, where `track`
 * names the criterion rather than a tracked group.
 */
export const FragilityChart = z.object({
  kind: z.literal('fragility'),
  steps: z.array(FragilityStep),
  present: z.tuple([z.number(), z.number()]), // [minRes, maxRes] where it exists
  track: z.string(),
  stability: z.number(), // fraction of settings where the group is present
  /** Check 7: the resolution the analysis actually used, marked on the sweep. */
  chosen: z.number().optional(),
  /** Check 7: the resolution range a stability or quality criterion supports. */
  supported: z.tuple([z.number(), z.number()]).optional(),
});

export const ConfoundGrid = z.object({
  rows: z.array(z.string()), // grouping levels
  cols: z.array(z.string()), // technical-variable levels
  cells: z.array(z.array(z.number())), // occupancy counts
});
export type ConfoundGrid = z.infer<typeof ConfoundGrid>;

/** Check 4 (confounding): is the grouping separable from the technical variable? */
export const ConfoundChart = z.object({
  kind: z.literal('confound'),
  grid: ConfoundGrid,
  cramersV: z.number().nullable(),
  verified: z.boolean(),
});

/**
 * One gene on a volcano. `claimed` marks a gene the scientist called
 * significant, so the corrected volcano can show which claims survive.
 */
export const VolcanoPoint = z.object({
  gene: z.string(),
  log2fc: z.number(),
  negLog10P: z.number(),
  sig: z.boolean(),
  claimed: z.boolean().optional(),
});
export type VolcanoPoint = z.infer<typeof VolcanoPoint>;

/**
 * The corrected downstream artifact for any differential-expression finding:
 * the volcano the honest model produces. Used by the fix-and-preview surface
 * for checks 1, 6, and 8, never as a check's own evidence chart.
 */
export const VolcanoChart = z.object({
  kind: z.literal('volcano'),
  points: z.array(VolcanoPoint),
  alpha: z.number(),
  fcThreshold: z.number(),
  nSig: z.number().int(),
  /** What produced these points, e.g. "pseudobulk + PyDESeq2, ~ condition". */
  label: z.string(),
});

export const FdrGene = z.object({
  gene: z.string(),
  p: z.number(), // raw p-value
  q: z.number(), // adjusted p-value
  survives: z.boolean(),
});
export type FdrGene = z.infer<typeof FdrGene>;

/** Check 5 (multiple testing): how many raw "hits" survive FDR control. */
export const FdrChart = z.object({
  kind: z.literal('fdr'),
  tests: z.number().int(), // how many genes were tested
  alpha: z.number(), // the q threshold
  rawHits: z.number().int(), // significant on raw p
  adjustedHits: z.number().int(), // significant after adjustment
  method: z.enum(['bh', 'by']),
  top: z.array(FdrGene), // the strongest genes, raw p ascending
});

/** The chart payload a check returns: the numbers a figure draws. */
export type SignificanceChart = z.infer<typeof SignificanceChart>;
export type HardStopChart = z.infer<typeof HardStopChart>;
export type GroupsChart = z.infer<typeof GroupsChart>;
export type FragilityChart = z.infer<typeof FragilityChart>;
export type ConfoundChart = z.infer<typeof ConfoundChart>;
export type VolcanoChart = z.infer<typeof VolcanoChart>;
export type FdrChart = z.infer<typeof FdrChart>;

export const Chart = z.discriminatedUnion('kind', [
  SignificanceChart,
  HardStopChart,
  GroupsChart,
  FragilityChart,
  ConfoundChart,
  VolcanoChart,
  FdrChart,
]);
export type Chart = z.infer<typeof Chart>;
