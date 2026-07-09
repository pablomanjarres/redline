import { z } from 'zod';
import { BodyTooLarge, readJsonBounded } from '@/lib/body';
import {
  ScenarioId,
  DatasetInventory,
  FieldSpec,
  ClaimExtractionResponse,
  type ClaimExtractionRequest,
  type ExtractedClaim,
} from '@redline/contracts';
import { SCENARIOS, curatedClaimsFor } from '@redline/engine';
import { createReasoner } from '@redline/reasoning';

export const runtime = 'nodejs';

/**
 * Request body: a scenario, the inspected inventory, the resolved fields, and
 * the optional notebook / prose the scientist attached. The extraction agent
 * reads all of it and proposes the auditable claims (spec sections 4, 6).
 */
const ClaimsRequest = z.object({
  scenarioId: ScenarioId,
  inventory: DatasetInventory,
  fields: z.array(FieldSpec),
  notebook: z.string().optional(),
  prose: z.string().optional(),
});

// One reasoner per process: Claude via the first-party API or Bedrock (per env),
// with a curated fallback when no backend is wired. Constructing it never touches
// the network, so this is safe at module scope and reused across requests.
const reasoner = createReasoner();

/**
 * POST /api/audit/claims extracts the auditable claims from the inspected
 * analysis. When a reasoning backend is wired, Claude reads the inventory (plus
 * any notebook / prose) and proposes claims adapted to this data; the honesty
 * backstop has already run inside the reasoner. With no backend, or on any
 * error, fall back to the curated reference claims for the built-in scenario.
 *
 * `source` is load-bearing: `model` means a live reading of this upload,
 * `curated` means the built-in reference list. A curated list is never passed
 * off as a live reading, so the UI can say which one the user is looking at.
 *
 * A successful model call that returns zero claims stays `source: 'model'` with
 * an empty list. We never fill an empty result with curated claims, because
 * "no auditable claims found" is a real answer the user must see (spec 8, 11).
 * The curated fallback fires only when the reasoner is unavailable or errors.
 *
 * Body-shape errors are 400, anything else 500.
 */
export async function POST(req: Request) {
  let body: z.infer<typeof ClaimsRequest>;
  try {
    body = ClaimsRequest.parse(await readJsonBounded(req));
  } catch (err) {
    // The body is forwarded into a paid model call and re-sent on retry, and this
    // route is unauthenticated. Refuse an oversized payload before parsing it.
    if (err instanceof BodyTooLarge) {
      return Response.json({ error: 'Request body too large' }, { status: 413 });
    }
    if (err instanceof z.ZodError) {
      return Response.json({ error: 'Invalid request', issues: err.issues }, { status: 400 });
    }
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const scenario = SCENARIOS[body.scenarioId];
    let claims: ExtractedClaim[];
    let source: 'model' | 'curated';

    if (!reasoner.available) {
      claims = curatedClaimsFor(body.scenarioId, body.inventory);
      source = 'curated';
    } else {
      const extractionRequest: ClaimExtractionRequest = {
        datasetTitle: scenario.dataset.title,
        inventory: body.inventory,
        fields: body.fields,
        notebook: body.notebook,
        prose: body.prose,
      };
      try {
        claims = await reasoner.extractClaims(extractionRequest);
        source = 'model';
      } catch {
        claims = curatedClaimsFor(body.scenarioId, body.inventory);
        source = 'curated';
      }
    }

    // Validate the claim list against the contract before it leaves the route.
    const validated = ClaimExtractionResponse.parse({ claims });
    return Response.json({ claims: validated.claims, source });
  } catch {
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
