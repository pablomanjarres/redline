import { z } from 'zod';
import { ScenarioId } from '@redline/contracts';
import { getComputeTarget } from '@redline/engine/server';
import { createReasoner } from '@redline/reasoning';

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
    // Raw column summaries: id, dtype, cardinality, a sample value. The compute
    // target reads them (fixture from the scenario, a real target from the .h5ad).
    const base = await target.inferFields({ scenarioId });

    // When a reasoning backend is wired, Claude proposes the roles from the raw
    // columns, so the foundation step is a real model call that adapts to the
    // dataset's own columns. With no backend, fall back to the target's heuristic
    // roles and label the source honestly.
    const reasoner = createReasoner();
    if (reasoner.available) {
      try {
        const fields = await reasoner.proposeFields({
          datasetTitle: scenarioId,
          columns: base.map((f) => ({
            id: f.id,
            dtype: f.dtype,
            levels: f.levels,
            missing: f.missing,
            sample: f.sample,
          })),
        });
        return Response.json({ fields, source: reasoner.backend });
      } catch {
        return Response.json({ fields: base, source: 'heuristic' });
      }
    }
    return Response.json({ fields: base, source: 'heuristic' });
  } catch {
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
