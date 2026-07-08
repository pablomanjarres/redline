import { z } from 'zod';

/**
 * A per-replicate aggregated profile (one row per independent unit) — the
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

/** Check 1 (pseudoreplication): naive vs honest re-test. */
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

/**
 * A stochastic statistic reported as a distribution over repeated runs, not one
 * point. `median` is the central estimate, `lo`/`hi` bound the `level` interval
 * (e.g. 0.95), `n` is the repetition count behind it, and `samples` carries the
 * per-run values a strip or density draws. Real numbers only: an interval is
 * emitted only when the check actually repeated its stochastic step, never
 * fabricated around a point estimate. Every consumer treats it as optional, so
 * single-run payloads and the locked fixtures still parse.
 */
export const Interval = z.object({
  median: z.number(),
  lo: z.number(),
  hi: z.number(),
  level: z.number(), // interval mass, e.g. 0.95
  n: z.number().int(), // repetitions behind the interval
  samples: z.array(z.number()).optional(), // per-run values, for the strip/density
});
export type Interval = z.infer<typeof Interval>;

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
  discAUC: z.number().optional(), // median discovery AUC across repeated splits
  holdAUC: z.number().optional(), // median held-out AUC across repeated splits
  // Distributions over repeated count-splits (Add-on 3). The scalars above carry
  // the median; these carry the spread the figure and cards draw.
  holdAUCDist: Interval.optional(),
  discAUCDist: Interval.optional(),
  markersHoldingDist: Interval.optional(), // surviving-marker count per split
});

export const FragilityStep = z.object({
  r: z.number(), // resolution setting
  present: z.boolean(), // is the tracked group a discrete cluster here (at the median run)
  clusters: z.number().int(),
  presence: z.number().optional(), // fraction of repeated runs present here, 0..1 (Add-on 3)
});
export type FragilityStep = z.infer<typeof FragilityStep>;

/** Check 3 (clustering fragility): appears/vanishes across a resolution sweep. */
export const FragilityChart = z.object({
  kind: z.literal('fragility'),
  steps: z.array(FragilityStep),
  present: z.tuple([z.number(), z.number()]), // [minRes, maxRes] where it exists
  track: z.string(),
  stability: z.number(), // median stability fraction across repeated runs
  stabilityDist: Interval.optional(), // distribution of the stability fraction (Add-on 3)
});

export const ConfoundGrid = z.object({
  rows: z.array(z.string()), // grouping levels
  cols: z.array(z.string()), // technical-variable levels
  cells: z.array(z.array(z.number())), // occupancy counts
});
export type ConfoundGrid = z.infer<typeof ConfoundGrid>;

/** Check 4 (confounding): grouping ≡ technical variable? */
export const ConfoundChart = z.object({
  kind: z.literal('confound'),
  grid: ConfoundGrid,
  cramersV: z.number().nullable(),
  verified: z.boolean(),
});

/** The chart payload a check returns — the numbers a figure draws. */
export type SignificanceChart = z.infer<typeof SignificanceChart>;
export type HardStopChart = z.infer<typeof HardStopChart>;
export type GroupsChart = z.infer<typeof GroupsChart>;
export type FragilityChart = z.infer<typeof FragilityChart>;
export type ConfoundChart = z.infer<typeof ConfoundChart>;

export const Chart = z.discriminatedUnion('kind', [
  SignificanceChart,
  HardStopChart,
  GroupsChart,
  FragilityChart,
  ConfoundChart,
]);
export type Chart = z.infer<typeof Chart>;
