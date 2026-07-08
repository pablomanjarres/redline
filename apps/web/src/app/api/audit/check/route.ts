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
  type CheckState,
  type Citation,
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
      return e;
    }
    case 'fragility':
      return {
        chartKind: chart.kind,
        track: chart.track,
        stability: chart.stability,
        presentMin: chart.present[0],
        presentMax: chart.present[1],
        stepCount: chart.steps.length,
      };
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

/** The method paper behind each check, for the honest generic fallback. */
const FALLBACK_CITATION: Record<CheckId, Citation> = {
  1: { authors: 'Squair et al.', year: 2021, venue: 'Nature Communications', note: 'Pseudoreplication inflates single-cell differential expression. Aggregate to the replicate and re-test.' },
  2: { authors: 'Neufeld et al.', year: 2024, venue: 'Biostatistics', note: 'Count splitting tests markers on data that did not define the group. ClusterDE is the stronger method.' },
  3: { authors: 'Luecken and Theis', year: 2019, venue: 'Molecular Systems Biology', note: 'Clustering resolution is a free parameter. A real group is stable across it.' },
  4: { authors: 'Hicks et al.', year: 2018, venue: 'Biostatistics', note: 'A biological effect confounded with a technical variable cannot be separated.' },
};

const FAILURE_MODE: Record<CheckId, string> = {
  1: 'Pseudoreplication',
  2: 'Double dipping (post-clustering marker testing)',
  3: 'Clustering fragility',
  4: 'Technical-biological confounding',
};

/**
 * An honest, scenario-agnostic narrative built from the COMPUTED state. Used
 * only as the last-resort fallback (a scenario with no curated fixture narrative
 * when the model call did not land), so the app always renders a finding that
 * agrees with the numbers it just computed, never a fabricated or crashing one.
 */
function genericNarrative(checkId: CheckId, state: CheckState, claim: string | null): Narrative {
  const citation = FALLBACK_CITATION[checkId];
  const mode = FAILURE_MODE[checkId];
  if (state === 'clean') {
    return { error: null, citation, original: null, corrected: 'The check ran and the result holds under the correct method. There is no problem to fix here.' };
  }
  if (state === 'flag_only') {
    return { error: mode, citation, original: claim, corrected: 'This check could not be completed on the data provided.', missing: 'The inputs this check needs are not present (for example, raw integer counts).' };
  }
  if (state === 'hard_stop') {
    return { error: mode, citation, original: claim, corrected: 'No valid test is possible here. The design does not have enough independent replicates.' };
  }
  return { error: mode, citation, original: claim, corrected: 'The reported result does not survive the correct method. Read the corrected numbers beside it.' };
}

/** Try the curated fixture narrative; if the scenario has none, fall back to an
 *  honest narrative built from the computed state so the route never throws. */
function safeCurated(
  scenarioId: ScenarioId,
  checkId: CheckId,
  config: unknown,
  compute: ComputeResult,
): Narrative {
  try {
    return curatedNarrative(scenarioId, checkId, config);
  } catch {
    const claim = SCENARIOS[scenarioId]?.claims.find((c) => c.check === checkId)?.text ?? null;
    return genericNarrative(checkId, compute.state, claim);
  }
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
    let source: 'bedrock' | 'anthropic' | 'curated';
    if (!reasoner.available) {
      narrative = safeCurated(body.scenarioId, body.checkId, body.config, compute);
      source = 'curated';
    } else {
      try {
        narrative = await reasoner.narrate(buildRequest(body.scenarioId, compute));
        source = reasoner.backend ?? 'curated';
      } catch {
        narrative = safeCurated(body.scenarioId, body.checkId, body.config, compute);
        source = 'curated';
      }
    }

    const result = CheckResult.parse({ ...compute, ...narrative, source });
    return Response.json(result);
  } catch {
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
