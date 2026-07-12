import { z } from 'zod';
import { BodyTooLarge, readJsonBounded } from '@/lib/body';
import {
  ScenarioId,
  DatasetInventory,
  FieldSpec,
  CheckId,
  ClaimImprovementResponse,
  MAX_CLAIM_TEXT_LENGTH,
  type ClaimImprovementRequest,
} from '@redline/contracts';
import { SCENARIOS } from '@redline/engine';
import { createReasoner } from '@redline/reasoning';

export const runtime = 'nodejs';

/** Request body: the current wording plus the context needed to sharpen it. */
const ImproveRequest = z.object({
  scenarioId: ScenarioId,
  inventory: DatasetInventory,
  fields: z.array(FieldSpec),
  text: z.string().min(1).max(MAX_CLAIM_TEXT_LENGTH),
  restsOn: z.string().max(2_000).optional(),
  checks: z.array(CheckId).optional(),
});

// One reasoner per process (see the claims route). Constructing it is free.
const reasoner = createReasoner();

/**
 * POST /api/audit/claims/improve backs the "Improve with AI" affordance on the
 * Claim Review screen. The scientist has one claim in the edit field; the agent
 * rewrites it into sharper, more testable language grounded in this data. It
 * never re-routes the claim (routing is a separate, explicit action), so this
 * returns only the rewritten text.
 *
 * There is no curated fallback here, for the same reason manual mapping has none:
 * rewriting a specific sentence is only honest when a real model reads it against
 * this data. With no backend, or on any failure, we return 503 { error:
 * 'reasoning_unavailable' } and the UI leaves the scientist's wording untouched
 * rather than guessing one.
 *
 * Body-shape errors are 400; an oversized payload is 413.
 */
export async function POST(req: Request) {
  let body: z.infer<typeof ImproveRequest>;
  try {
    body = ImproveRequest.parse(await readJsonBounded(req));
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

  if (!reasoner.available) {
    return Response.json({ error: 'reasoning_unavailable' }, { status: 503 });
  }

  try {
    const scenario = SCENARIOS[body.scenarioId];
    const improvementRequest: ClaimImprovementRequest = {
      datasetTitle: scenario.dataset.title,
      inventory: body.inventory,
      fields: body.fields,
      text: body.text,
      restsOn: body.restsOn,
      checks: body.checks,
    };
    const text = await reasoner.improveClaim(improvementRequest);
    // Validate against the contract before it leaves the route.
    const validated = ClaimImprovementResponse.parse({ text });
    return Response.json({ text: validated.text });
  } catch {
    // improveClaim wraps every failure (no backend, network, unparseable reply, or
    // an empty rewrite) as ReasonerUnavailable. A wording we cannot improve
    // honestly is left untouched: report the failure, the UI changes nothing.
    return Response.json({ error: 'reasoning_unavailable' }, { status: 503 });
  }
}
