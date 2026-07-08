import { z } from 'zod';
import {
  ScenarioId,
  CheckId,
  Check1Config,
  Check2Config,
  Check3Config,
  Check4Config,
  FieldSpec,
  CheckResult,
  type Chart,
  type ComputeResult,
  type Narrative,
  type NarrativeRequest,
} from '@redline/contracts';
import { curatedNarrative, SCENARIOS } from '@redline/engine';
import { getComputeTarget } from '@redline/engine/server';
import { createReasoner } from '@redline/reasoning';

export const runtime = 'nodejs';

/** Request body: a scenario, a pillar, its knob config, and the resolved fields. */
const CheckRequest = z.object({
  scenarioId: ScenarioId,
  checkId: CheckId,
  config: z.union([Check1Config, Check2Config, Check3Config, Check4Config]),
  fields: z.array(FieldSpec),
});

// One reasoner per process: Claude via the first-party API or Bedrock (per env),
// with a curated fallback when no backend is wired. Constructing it never touches
// the network, so this is safe at module scope and reused across requests.
const reasoner = createReasoner();

/** Pull the load-bearing numbers out of a chart payload, keyed by chart kind. */
function chartEvidence(chart: Chart): Record<string, string | number | boolean> {
  switch (chart.kind) {
    case 'significance':
      return {
        chartKind: chart.kind,
        naiveP: chart.naive.p,
        naiveLog10p: chart.naive.log10p,
        naiveN: chart.naive.n,
        naiveSig: chart.naive.sig,
        honestP: chart.honest.p,
        honestLog10p: chart.honest.log10p,
        honestN: chart.honest.n,
        honestSig: chart.honest.sig,
        alpha: chart.alpha,
        badUnit: chart.badUnit,
        unitCount: chart.units.length,
      };
    case 'hardstop':
      return {
        chartKind: chart.kind,
        units: chart.units,
        perGroup: chart.perGroup,
        profileCount: chart.profiles.length,
      };
    case 'groups': {
      const e: Record<string, string | number | boolean> = {
        chartKind: chart.kind,
        split: chart.split,
        verified: chart.verified,
        markerCount: chart.markers.length,
      };
      if (chart.discAUC !== undefined) e.discAUC = chart.discAUC;
      if (chart.holdAUC !== undefined) e.holdAUC = chart.holdAUC;
      // The held-out AUC as a distribution over repeated splits, so the model can
      // cite the interval and the repetition count, not a single point.
      if (chart.holdAUCDist) {
        e.holdAUCMedian = chart.holdAUCDist.median;
        e.holdAUCCILow = chart.holdAUCDist.lo;
        e.holdAUCCIHigh = chart.holdAUCDist.hi;
        e.splitReps = chart.holdAUCDist.n;
      }
      if (chart.discAUCDist) {
        e.discAUCCILow = chart.discAUCDist.lo;
        e.discAUCCIHigh = chart.discAUCDist.hi;
      }
      if (chart.markersHoldingDist) {
        e.markersHoldingCILow = chart.markersHoldingDist.lo;
        e.markersHoldingCIHigh = chart.markersHoldingDist.hi;
      }
      return e;
    }
    case 'fragility': {
      const e: Record<string, string | number | boolean> = {
        chartKind: chart.kind,
        track: chart.track,
        stability: chart.stability,
        presentMin: chart.present[0],
        presentMax: chart.present[1],
        stepCount: chart.steps.length,
      };
      if (chart.stabilityDist) {
        e.stabilityMedian = chart.stabilityDist.median;
        e.stabilityCILow = chart.stabilityDist.lo;
        e.stabilityCIHigh = chart.stabilityDist.hi;
        e.sweepReps = chart.stabilityDist.n;
      }
      return e;
    }
    case 'confound': {
      const e: Record<string, string | number | boolean> = {
        chartKind: chart.kind,
        verified: chart.verified,
        rowCount: chart.grid.rows.length,
        colCount: chart.grid.cols.length,
      };
      if (chart.cramersV !== null) e.cramersV = chart.cramersV;
      return e;
    }
  }
}

/** Assemble the reasoning-layer request from the scenario claim + computed numbers. */
function buildRequest(scenarioId: ScenarioId, compute: ComputeResult): NarrativeRequest {
  const scenario = SCENARIOS[scenarioId];
  const claim = scenario.claims.find((c) => c.check === compute.checkId)?.text ?? '';
  const statsEvidence: Record<string, string> = Object.fromEntries(
    compute.stats.map((s): [string, string] => [s.label, s.value]),
  );
  return {
    checkId: compute.checkId,
    state: compute.state,
    claim,
    datasetTitle: scenario.dataset.title,
    evidence: { ...statsEvidence, ...chartEvidence(compute.chart) },
  };
}

/**
 * POST /api/audit/check — run one pillar. The compute target produces the numbers
 * + chart + verdict; the reasoning layer (or curated fallback) produces the prose.
 * Merge them into a CheckResult. Body-shape errors are 400, anything else 500.
 */
export async function POST(req: Request) {
  let body: z.infer<typeof CheckRequest>;
  try {
    body = CheckRequest.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json({ error: 'Invalid request', issues: err.issues }, { status: 400 });
    }
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const target = getComputeTarget();
    const compute = await target.computeCheck(body);

    // When a reasoning backend is wired — the Claude API for the public path, or
    // Bedrock for the internal demo — Claude narrates the finding from the
    // computed numbers, even on the fixture target. With no backend, or on any
    // error, fall back to the curated copy (kept in exact agreement with the
    // fixture numbers) so a finding always renders.
    let narrative: Narrative;
    if (!reasoner.available) {
      narrative = curatedNarrative(body.scenarioId, body.checkId, body.config);
    } else {
      try {
        narrative = await reasoner.narrate(buildRequest(body.scenarioId, compute));
      } catch {
        narrative = curatedNarrative(body.scenarioId, body.checkId, body.config);
      }
    }

    const result = CheckResult.parse({ ...compute, ...narrative });
    return Response.json(result);
  } catch {
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
