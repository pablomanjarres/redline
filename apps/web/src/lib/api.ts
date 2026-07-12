/**
 * Typed client for the audit route handlers. Every response is parsed with the
 * contracts' Zod schemas, so a malformed payload fails loudly here instead of
 * corrupting the session store. The route handlers themselves are owned by the
 * api agent (apps/web/src/app/api/audit/*).
 */
import { z } from 'zod';
import {
  CheckResult,
  DatasetInventory,
  ExtractedClaim,
  type ExtractionAssessment,
  FieldSpec,
  type CheckConfigMap,
  type CheckId,
  type ScenarioId,
} from '@redline/contracts';

const FieldsResponse = z.object({ fields: z.array(FieldSpec) });
const InspectResponse = z.object({ inventory: DatasetInventory });
const ExtractionAssessmentSchema = z.object({
  auditableClaims: z.number(),
  evidenceKeys: z.array(z.string()),
  suspiciouslyEmpty: z.boolean(),
});
const ClaimsResponse = z.object({
  claims: z.array(ExtractedClaim),
  source: z.enum(['model', 'curated']),
  // Optional so an older server (or the curated path) still parses.
  assessment: ExtractionAssessmentSchema.optional(),
});
const MapResponse = z.object({ claim: ExtractedClaim });
const ImproveResponse = z.object({ text: z.string() });

/** The extraction result: the claims plus whether they are a live model reading
 * or the curated built-in list. `source` is load-bearing for honest UI copy. */
export interface ClaimsResult {
  claims: ExtractedClaim[];
  source: 'model' | 'curated';
  /** Whether the extraction looks suppressed: nothing to audit on a dataset that
   *  carries testable stored results. Absent on the curated path. */
  assessment?: ExtractionAssessment;
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      /* body already consumed or unavailable */
    }
    throw new Error(`POST ${url} failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
  return res.json();
}

/**
 * Foundation step: resolve the scenario's `obs` columns into typed field roles.
 * POST /api/audit/fields with `{ scenarioId }` -> `{ fields: FieldSpec[] }`.
 */
export async function postFields(body: { scenarioId: ScenarioId }): Promise<FieldSpec[]> {
  const json = await postJson('/api/audit/fields', body);
  return FieldsResponse.parse(json).fields;
}

/**
 * Run one check: numbers from the compute target, prose from the reasoner,
 * merged into a `CheckResult`. POST /api/audit/check.
 *
 * `noReason` runs the numbers-only path: the compute target still produces the
 * real statistics and correction, but the model narration is skipped. The
 * corrected-code "Run" reveal uses it so replaying the corrected result is a
 * genuine compute round-trip that does not wait on (or throttle) the reasoner.
 */
export async function postCheck(body: {
  scenarioId: ScenarioId;
  checkId: CheckId;
  config: CheckConfigMap[CheckId];
  fields: FieldSpec[];
  // The run's claim and its identity. The route narrates and critiques THIS
  // claim, so two runs on one check strike their own conclusion, never a
  // per-check claim looked up by id. `claim` is required because every run the
  // session executes has one; the numbers-only verification harness posts to
  // /api/verify/run, not here, so it never reaches this client.
  claim: string;
  claimId?: string;
  runKey?: string;
  // Numbers-only path: the corrected-code "Run" reveal posts this so replaying a
  // finding's corrected result is a genuine compute round-trip that skips (and
  // does not throttle) the reasoner.
  noReason?: boolean;
}): Promise<CheckResult> {
  const json = await postJson('/api/audit/check', body);
  return CheckResult.parse(json);
}

/**
 * Inspection step (spec section 3): the thin inventory of a scenario's `.h5ad`.
 * POST /api/audit/inspect with `{ scenarioId }` -> `{ inventory }`.
 */
export async function postInspect(body: { scenarioId: ScenarioId }): Promise<DatasetInventory> {
  const json = await postJson('/api/audit/inspect', body);
  return InspectResponse.parse(json).inventory;
}

/**
 * Claim Extraction (spec sections 4, 6): read the inventory (plus any notebook /
 * prose) and propose the auditable claims, with a `source` telling the caller
 * whether they are a live model reading or the curated built-in list.
 * POST /api/audit/claims.
 */
export async function postClaims(body: {
  scenarioId: ScenarioId;
  inventory: DatasetInventory;
  fields: FieldSpec[];
  notebook?: string;
  prose?: string;
}): Promise<ClaimsResult> {
  const json = await postJson('/api/audit/claims', body);
  return ClaimsResponse.parse(json);
}

/**
 * Manual claim entry (spec section 7): map one typed sentence to its checks and
 * params. POST /api/audit/claims/map -> `{ claim }`. The route returns 503 when
 * no honest mapping is possible; `postJson` throws on that, and the caller adds
 * nothing rather than fabricating a routing.
 */
export async function postMapClaim(body: {
  scenarioId: ScenarioId;
  inventory: DatasetInventory;
  fields: FieldSpec[];
  text: string;
}): Promise<ExtractedClaim> {
  const json = await postJson('/api/audit/claims/map', body);
  return MapResponse.parse(json).claim;
}

/**
 * Improve a claim's wording (Claim Review, the "Improve with AI" affordance): send
 * the current wording plus its routing context, get back a sharper rewrite.
 * POST /api/audit/claims/improve -> `{ text }`. The route returns 503 when no
 * honest rewrite is possible; `postJson` throws on that, and the caller leaves
 * the scientist's wording untouched rather than fabricating one.
 */
export async function postImproveClaim(body: {
  scenarioId: ScenarioId;
  inventory: DatasetInventory;
  fields: FieldSpec[];
  text: string;
  restsOn?: string;
  checks?: CheckId[];
}): Promise<string> {
  const json = await postJson('/api/audit/claims/improve', body);
  return ImproveResponse.parse(json).text;
}
