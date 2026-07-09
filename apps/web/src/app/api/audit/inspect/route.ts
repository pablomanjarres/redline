import { z } from 'zod';
import { ScenarioId, DatasetInventory } from '@redline/contracts';
import { getComputeTarget } from '@redline/engine/server';

export const runtime = 'nodejs';

/** Request body: which scenario's `.h5ad` to inspect (spec section 3). */
const InspectRequest = z.object({ scenarioId: ScenarioId });

/**
 * POST /api/audit/inspect runs the thin inspection step (spec section 3). The
 * compute target surfaces the raw material the extraction agent reads: the obs
 * columns and their types, the stored uns results, the cluster fields, and
 * whether raw counts are present. The fixture returns the hand-written
 * inventory; a real target reads it from the file. Body-shape errors are 400,
 * anything else 500.
 */
export async function POST(req: Request) {
  let scenarioId: ScenarioId;
  try {
    scenarioId = InspectRequest.parse(await req.json()).scenarioId;
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json({ error: 'Invalid request', issues: err.issues }, { status: 400 });
    }
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const target = getComputeTarget();
    // Validate the target's output against the contract before it leaves the
    // route, so a malformed inventory fails here rather than downstream.
    const inventory = DatasetInventory.parse(await target.inspect({ scenarioId }));
    return Response.json({ inventory });
  } catch {
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
