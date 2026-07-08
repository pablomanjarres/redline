import { z } from 'zod';
import { Chart } from './charts.js';
import { CheckId, CheckState } from './primitives.js';

export const Citation = z.object({
  authors: z.string(),
  year: z.number().int(),
  venue: z.string(),
  note: z.string(),
  url: z.string().url().optional(),
});
export type Citation = z.infer<typeof Citation>;

export const StatReadout = z.object({
  label: z.string(),
  value: z.string(),
  bad: z.boolean().optional(),
  good: z.boolean().optional(),
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

/** What the UI renders per check: numbers ⊕ narrative. */
export const CheckResult = ComputeResult.merge(Narrative);
export type CheckResult = z.infer<typeof CheckResult>;

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

/** The full knob state, keyed by check id. */
export const CheckConfigMap = z.object({
  1: Check1Config,
  2: Check2Config,
  3: Check3Config,
  4: Check4Config,
});
export type CheckConfigMap = z.infer<typeof CheckConfigMap>;

export type CheckConfigFor<Id extends CheckId> = Id extends 1
  ? Check1Config
  : Id extends 2
    ? Check2Config
    : Id extends 3
      ? Check3Config
      : Check4Config;
