import { z } from 'zod';
import {
  ScenarioId,
  DatasetInventory,
  FieldSpec,
  ClaimMappingResponse,
  type ClaimMappingRequest,
} from '@redline/contracts';
import { SCENARIOS } from '@redline/engine';
import { createReasoner } from '@redline/reasoning';

export const runtime = 'nodejs';

/** Request body: the user's typed claim, plus the context needed to map it. */
const MapRequest = z.object({
  scenarioId: ScenarioId,
  inventory: DatasetInventory,
  fields: z.array(FieldSpec),
  text: z.string(),
});

// One reasoner per process (see the claims route). Constructing it is free.
const reasoner = createReasoner();

/**
 * POST /api/audit/claims/map handles manual claim entry (spec section 7). The user
 * types one sentence; the agent classifies it, routes it to the applicable
 * checks, and extracts the params from the data, exactly as it does for an
 * extracted claim.
 *
 * There is no curated fallback here. Mapping a specific typed sentence to a
 * routing is only honest when a real model reads it against this data. With no
 * backend, or on any mapping failure, we return 503 { error:
 * 'reasoning_unavailable' } and the UI adds nothing. Fabricating a routing would
 * silently mis-route the claim and produce a confident wrong audit (spec 11).
 *
 * Body-shape errors are 400.
 */
export async function POST(req: Request) {
  let body: z.infer<typeof MapRequest>;
  try {
    body = MapRequest.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json({ error: 'Invalid request', issues: err.issues }, { status: 400 });
    }
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!reasoner.available) {
    return Response.json({ error: 'reasoning_unavailable' }, { status: 503 });
  }

  try {
    const scenario = SCENARIOS[body.scenarioId];
    const mappingRequest: ClaimMappingRequest = {
      datasetTitle: scenario.dataset.title,
      inventory: body.inventory,
      fields: body.fields,
      text: body.text,
    };
    const claim = await reasoner.mapClaim(mappingRequest);
    // Validate against the contract before it leaves the route.
    const validated = ClaimMappingResponse.parse({ claim });
    return Response.json({ claim: validated.claim });
  } catch {
    // mapClaim wraps every failure (no backend, network, unparseable reply, or a
    // backstop rejection) as ReasonerUnavailable. A claim we cannot map honestly
    // is not audited: report the failure, the UI adds nothing.
    return Response.json({ error: 'reasoning_unavailable' }, { status: 503 });
  }
}
