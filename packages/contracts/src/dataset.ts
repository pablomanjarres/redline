import { z } from 'zod';
import { FieldSpec } from './fields.js';
import { CheckId } from './primitives.js';

export const DatasetMeta = z.object({
  file: z.string(),
  label: z.string(),
  title: z.string(),
  cells: z.number().int(),
  genes: z.number().int(),
  /** Number of independent biological replicates. */
  replicates: z.number().int(),
  /** What one replicate is called for this dataset ("mice", "donors"). */
  replicateLabel: z.string(),
  fieldCount: z.number().int(),
  sizeGB: z.number(),
});
export type DatasetMeta = z.infer<typeof DatasetMeta>;

/** A load-bearing claim Redline extracted from the analysis, mapped to a check. */
export const Claim = z.object({
  id: z.string(),
  text: z.string(),
  check: CheckId,
});
export type Claim = z.infer<typeof Claim>;

export const ScenarioId = z.enum(['marson', 'ketamine']);
export type ScenarioId = z.infer<typeof ScenarioId>;

/**
 * A built-in, self-contained audit scenario. `marson` is the hero (a naive
 * foil constructed on the Marson/Pritchard CD4+ T-cell Perturb-seq data —
 * never the authors' own rigorous analysis). `ketamine` is a locked fallback.
 */
export const Scenario = z.object({
  id: ScenarioId,
  name: z.string(),
  dataset: DatasetMeta,
  claims: z.array(Claim),
  fields: z.array(FieldSpec),
});
export type Scenario = z.infer<typeof Scenario>;
