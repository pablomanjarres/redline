import { z } from 'zod';
import { Confidence, Dtype, FieldRole } from './primitives.js';

/**
 * One resolved `obs` column. Produced by the foundation step (model-inferred,
 * user-confirmable). A wrong role makes every downstream flag wrong, which is
 * why this is a structural gate, not a convenience.
 */
export const FieldSpec = z.object({
  id: z.string(),
  dtype: Dtype,
  /** Cardinality for categoricals; null for numeric columns. */
  levels: z.number().int().nullable(),
  missing: z.number().int().nonnegative(),
  role: FieldRole,
  confidence: Confidence,
  /** Plain-English reasoning for the proposed role (shown to the scientist). */
  reason: z.string(),
  /** A couple of example values, for legibility. */
  sample: z.string().optional(),
  /** True once the scientist has corrected the proposed role. */
  edited: z.boolean().optional(),
});
export type FieldSpec = z.infer<typeof FieldSpec>;

export const RoleOption = z.object({ value: FieldRole, label: z.string() });
export type RoleOption = z.infer<typeof RoleOption>;
