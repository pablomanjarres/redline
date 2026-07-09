import { z } from 'zod';
import { FieldSpec } from './fields.js';
import { Narrative } from './checks.js';
import { Feasibility, Recommendation } from './correction.js';
import { CheckId, CheckState, MethodRef } from './primitives.js';

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
 * Input to the reasoning layer for the recommend step (Capability 2, the prose
 * half). The deterministic engine has already decided every `feasibility`, one
 * per recommendation slot, and passes them in `feasibilities`. The model fills
 * in the prose (action, rationale, changes) and echoes each feasibility back
 * unchanged; it never decides whether a finding is fixable. `fields` is the list
 * of resolved field names for this dataset, so every action can name them and
 * the generality test can prove the recommendation is not canned. `method` is
 * the citation the finding already carries.
 */
export const RecommendationRequest = z.object({
  checkId: CheckId,
  state: CheckState,
  claim: z.string(),
  datasetTitle: z.string(),
  evidence: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  /** The engine's verdict for each recommendation slot, in order. */
  feasibilities: z.array(Feasibility),
  /** The resolved field names of this dataset, so actions can name them. */
  fields: z.array(z.string()),
  method: MethodRef,
});
export type RecommendationRequest = z.infer<typeof RecommendationRequest>;

export const RecommendationResponse = z.object({
  recommendations: z.array(Recommendation),
});
export type RecommendationResponse = z.infer<typeof RecommendationResponse>;

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
