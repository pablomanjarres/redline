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
});
export type FragilityStep = z.infer<typeof FragilityStep>;

/** Check 3 (clustering fragility): appears/vanishes across a resolution sweep. */
export const FragilityChart = z.object({
  kind: z.literal('fragility'),
  steps: z.array(FragilityStep),
  present: z.tuple([z.number(), z.number()]), // [minRes, maxRes] where it exists
  track: z.string(),
  stability: z.number(), // fraction of settings where the group is present
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
export const Chart = z.discriminatedUnion('kind', [
  SignificanceChart,
  HardStopChart,
  GroupsChart,
  FragilityChart,
  ConfoundChart,
]);
export type Chart = z.infer<typeof Chart>;
