import { z } from 'zod';

/** Column data types Redline resolves in the foundation step. */
export const Dtype = z.enum(['categorical', 'numeric', 'identifier']);
export type Dtype = z.infer<typeof Dtype>;

/**
 * The meaning a field carries once resolved. This is the load-bearing
 * abstraction: every pillar operates on a *role*, never a hardcoded column
 * name and never "cell type". The grouping variable is configurable.
 */
export const FieldRole = z.enum([
  'unit', // the independent biological replicate (donor / mouse / patient)
  'grouping', // the comparison of interest (condition / state / perturbation)
  'observation', // a measurement, not an independent sample (a cell)
  'nuisance', // a technical variable to test for confounding
  'covariate', // a per-observation quality covariate
  'derived', // a computed grouping (cluster labels)
  'ignore', // not used by any check
]);
export type FieldRole = z.infer<typeof FieldRole>;

/** How sure the foundation step is about a proposed role. */
export const Confidence = z.enum(['high', 'medium', 'low']);
export type Confidence = z.infer<typeof Confidence>;

/**
 * A persisted check verdict. `ready` and `running` are UI-only transient
 * states and are deliberately NOT part of the engine's return contract.
 */
export const CheckState = z.enum(['flagged', 'clean', 'flag_only', 'hard_stop']);
export type CheckState = z.infer<typeof CheckState>;

/**
 * Every registered check. 1 to 4 are the founding pillars; 5 to 8 are the rigor
 * checks built on the same module interface. The list is closed here and
 * described in `registry.ts`. Adding a check means adding a literal here, a row
 * there, and a module in the Python engine. Nothing else enumerates checks.
 */
export const CheckId = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
  z.literal(8),
]);
export type CheckId = z.infer<typeof CheckId>;

/**
 * A reference to the method paper that fixes a class of error. Redline never
 * asserts a correction without naming the method behind it, so every finding,
 * every recommendation, and every corrected script carries one. `MethodRef` is
 * the name the check-module interface uses for this same shape.
 */
export const Citation = z.object({
  authors: z.string(),
  year: z.number().int(),
  venue: z.string(),
  note: z.string(),
  url: z.string().url().optional(),
});
export type Citation = z.infer<typeof Citation>;

export const MethodRef = Citation;
export type MethodRef = Citation;
