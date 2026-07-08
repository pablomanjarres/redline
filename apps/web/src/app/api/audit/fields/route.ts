import { z } from 'zod';
import { ScenarioId } from '@redline/contracts';
import { getComputeTarget } from '@redline/engine/server';

export const runtime = 'nodejs';

/** Request body: which scenario's obs columns to resolve into fields. */
const FieldsRequest = z.object({ scenarioId: ScenarioId });

/**
 * POST /api/audit/fields — resolve a scenario's obs columns into FieldSpec[].
 * Thin: the compute target does the work (fixture returns the scenario's fields;
 * a real target reads the .h5ad). Body-shape errors are 400, anything else 500.
 */
export async function POST(req: Request) {
  let scenarioId: ScenarioId;
  try {
    scenarioId = FieldsRequest.parse(await req.json()).scenarioId;
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json({ error: 'Invalid request', issues: err.issues }, { status: 400 });
    }
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const target = getComputeTarget();
    const fields = await target.inferFields({ scenarioId });
    return Response.json({ fields });
  } catch {
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
