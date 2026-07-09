import { z } from 'zod';
import { FieldSpec } from './fields.js';
import { Narrative } from './checks.js';
import { CheckId, CheckState } from './primitives.js';

/**
 * Input to the reasoning layer for one finding. The compute layer has already
 * produced the numbers; Claude turns them into the named failure mode, the
 * citation, and the defensible rewrite.
 */
export const NarrativeRequest = z.object({
  checkId: CheckId,
  state: CheckState,
  claim: z.string(),
  datasetTitle: z.string(),
  /** The load-bearing numbers from the ComputeResult, as label→value pairs. */
  evidence: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});
export type NarrativeRequest = z.infer<typeof NarrativeRequest>;

export const NarrativeResponse = Narrative;
export type NarrativeResponse = z.infer<typeof NarrativeResponse>;

/**
 * Input to the reasoning layer for the foundation step: raw column summaries in,
 * proposed roles + reasoning + confidence out.
 */
export const FieldProposalRequest = z.object({
  datasetTitle: z.string(),
  columns: z.array(
    z.object({
      id: z.string(),
      dtype: z.string(),
      levels: z.number().int().nullable(),
      missing: z.number().int(),
      sample: z.string().optional(),
    }),
  ),
});
export type FieldProposalRequest = z.infer<typeof FieldProposalRequest>;

export const FieldProposalResponse = z.object({ fields: z.array(FieldSpec) });
export type FieldProposalResponse = z.infer<typeof FieldProposalResponse>;

// ── Claim extraction I/O (spec sections 5, 7) ────────────────────────────────
// packages/reasoning imports its I/O shapes from ./reasoning.js by convention.
// The claim envelopes live in ./claims.js (next to the ExtractedClaim shape they
// wrap); re-export them here so the extraction and manual-mapping calls follow
// the same convention. These are the same bindings, so the barrel stays clean.
export {
  ClaimExtractionRequest,
  ClaimExtractionResponse,
  ClaimMappingRequest,
  ClaimMappingResponse,
} from './claims.js';
