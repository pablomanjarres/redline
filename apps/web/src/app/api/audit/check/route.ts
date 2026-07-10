import { z } from 'zod';
import {
  ScenarioId,
  CheckId,
  Check1Config,
  Check2Config,
  Check3Config,
  Check4Config,
  Check5Config,
  Check6Config,
  Check7Config,
  Check8Config,
  FieldSpec,
  CheckResult,
  type Chart,
  type CheckState,
  type Citation,
  type ComputeResult,
  type CriticAssessment,
  type CriticRequest,
  type EngineResult,
  type Narrative,
  type NarrativeRequest,
  type Recommendation,
} from '@redline/contracts';
import {
  applyCriticGate,
  curatedNarrative,
  SCENARIOS,
  unverifiedAssessment,
} from '@redline/engine';
import { getComputeTarget } from '@redline/engine/server';
import { createReasoner } from '@redline/reasoning';

export const runtime = 'nodejs';

/** Request body: a scenario, a check, its knob config, and the resolved fields. */
const CheckRequest = z.object({
  scenarioId: ScenarioId,
  checkId: CheckId,
  config: z.union([
    Check1Config,
    Check2Config,
    Check3Config,
    Check4Config,
    Check5Config,
    Check6Config,
    Check7Config,
    Check8Config,
  ]),
  fields: z.array(FieldSpec),
  // The (claim, check) run's identity, sent by the session store. `claim` is the
  // exact claimText whose route params drove this run; `claimId` and `runKey`
  // (`${claimId}::${checkId}`) name the run. The reasoning layer and the critic
  // judge THIS claim, never one looked up by check id: one check can hold several
  // runs (on marson both the Activated Treg-like and the Effector claim route to
  // Check 3), and each must narrate and be critiqued against its own claim, or the
  // struck-through conclusion belongs to a different run of the same check.
  //
  // All three are optional so a legacy numbers-only caller still validates (200,
  // not 400): the verification harness and the critic oracle send none. On that
  // path the route falls back to the scenario's single per-check claim, which is
  // honest because that path probes one check at a time with one claim per check.
  claim: z.string().optional(),
  claimId: z.string().optional(),
  runKey: z.string().optional(),
  // The verification harness sets this on liveness / re-run probes that only
  // need the numbers, so a sweep of knob changes does not throttle the model.
  noReason: z.boolean().optional(),
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
    case 'volcano':
      return {
        chartKind: chart.kind,
        label: chart.label,
        alpha: chart.alpha,
        fcThreshold: chart.fcThreshold,
        nSig: chart.nSig,
        pointCount: chart.points.length,
      };
    case 'fdr':
      return {
        chartKind: chart.kind,
        tests: chart.tests,
        alpha: chart.alpha,
        rawHits: chart.rawHits,
        adjustedHits: chart.adjustedHits,
        method: chart.method,
      };
  }
}

/** The full load-bearing evidence for a finding: the stat readouts + the chart numbers. */
function computeEvidence(
  compute: ComputeResult,
): Record<string, string | number | boolean> {
  const statsEvidence: Record<string, string> = Object.fromEntries(
    compute.stats.map((s): [string, string] => [s.label, s.value]),
  );
  return { ...statsEvidence, ...chartEvidence(compute.chart) };
}

/** The scenario's single per-check claim, or an empty string. The fallback for a
 *  legacy numbers-only caller that sends no run claim (see CheckRequest). */
function claimFor(scenarioId: ScenarioId, checkId: CheckId): string {
  return SCENARIOS[scenarioId].claims.find((c) => c.check === checkId)?.text ?? '';
}

/** Assemble the reasoning-layer request from the run's claim + computed numbers. */
function buildRequest(
  scenarioId: ScenarioId,
  compute: ComputeResult,
  state: CheckState,
  claim: string,
): NarrativeRequest {
  return {
    checkId: compute.checkId,
    state,
    claim,
    datasetTitle: SCENARIOS[scenarioId].dataset.title,
    evidence: computeEvidence(compute),
  };
}

/** The real method a check ran, so the critic knows what produced the numbers. */
const CRITIC_METHOD: Record<Chart['kind'], string> = {
  significance: 'pseudobulk aggregation to the replicate unit, Welch t on per-unit means',
  hardstop: 'replicate count per group (no valid test below two replicates)',
  groups: 'Poisson count-split, held-out marker AUC',
  fragility: 'Leiden resolution sweep, cluster persistence across settings',
  confound: "design-matrix rank and Cramer's V on the resolved columns",
  volcano: 'Benjamini-Hochberg false-discovery correction across the tested genes',
  fdr: 'discoveries surviving false-discovery control at the stated alpha',
};

/** The resolved roles behind the audit, so the critic can judge the design. */
function resolveDesign(fields: FieldSpec[]): string {
  const byRole = (role: string): string | undefined =>
    fields.find((f) => f.role === role)?.id;
  const parts: string[] = [];
  for (const role of ['unit', 'grouping', 'nuisance', 'derived'] as const) {
    const id = byRole(role);
    if (id) parts.push(`${role}=${id}`);
  }
  return parts.join(', ');
}

/** Assemble the critic request from the candidate finding + numbers + resolved
 *  design. The critic judges the run's own claim, so it can never confirm or veto
 *  a flag against a claim that belongs to a different run of the same check. */
function buildCriticRequest(
  scenarioId: ScenarioId,
  compute: ComputeResult,
  fields: FieldSpec[],
  claim: string,
): CriticRequest {
  const design = resolveDesign(fields);
  return {
    checkId: compute.checkId,
    computeState: compute.state,
    claim,
    datasetTitle: SCENARIOS[scenarioId].dataset.title,
    evidence: computeEvidence(compute),
    method: CRITIC_METHOD[compute.chart.kind],
    ...(design ? { design } : {}),
    checkReasoning: compute.headline,
  };
}

/**
 * On a veto the finding is cleared, so the compute half must read coherently too:
 * drop the red "bad" alarms and replace the flag headline. The stat values and the
 * figure stay as the evidence the critic examined, and the critic strip explains why
 * the flag was overturned. The narrative carries no headline or stats, so the gate
 * seam is the only place that can heal them.
 */
function clearComputeForVeto(
  compute: ComputeResult,
): Pick<ComputeResult, 'headline' | 'stats'> {
  return {
    headline: 'The critic overturned this flag on review.',
    stats: compute.stats.map((s) => (s.bad ? { ...s, bad: false } : s)),
  };
}

/** The method paper behind each check, for the honest generic fallback. */
const FALLBACK_CITATION: Record<CheckId, Citation> = {
  1: { authors: 'Squair et al.', year: 2021, venue: 'Nature Communications', note: 'Pseudoreplication inflates single-cell differential expression. Aggregate to the replicate and re-test.' },
  2: { authors: 'Neufeld et al.', year: 2024, venue: 'Biostatistics', note: 'Count splitting tests markers on data that did not define the group. ClusterDE is the stronger method.' },
  3: { authors: 'Luecken and Theis', year: 2019, venue: 'Molecular Systems Biology', note: 'Clustering resolution is a free parameter. A real group is stable across it.' },
  4: { authors: 'Hicks et al.', year: 2018, venue: 'Biostatistics', note: 'A biological effect confounded with a technical variable cannot be separated.' },
  5: { authors: 'Benjamini and Hochberg', year: 1995, venue: 'J. R. Stat. Soc. B', note: 'Control the false discovery rate across many tests. A raw p-value is not a discovery.' },
  6: { authors: 'Hicks et al.', year: 2018, venue: 'Biostatistics', note: 'A technical variable separable from the effect belongs in the model. Leaving it out biases the estimate.' },
  7: { authors: 'Luecken and Theis', year: 2019, venue: 'Molecular Systems Biology', note: 'Choose clustering resolution by a stability or quality criterion, not by eye.' },
  8: { authors: 'Soneson and Robinson', year: 2018, venue: 'Nature Methods', note: 'Match the test to the count distribution. A t-test on raw counts violates its own assumptions.' },
};

const FAILURE_MODE: Record<CheckId, string> = {
  1: 'Pseudoreplication',
  2: 'Double dipping (post-clustering marker testing)',
  3: 'Clustering fragility',
  4: 'Technical-biological confounding',
  5: 'Uncorrected multiple testing',
  6: 'Unmodeled covariate',
  7: 'Unjustified resolution choice',
  8: 'Violated test assumptions',
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
    // The compute target now returns statistics AND the optional correction
    // (corrected code, recommendations, before/after preview). Both flow to the
    // client untouched; a model failure below can never drop them.
    const compute: EngineResult = await target.computeCheck(body);

    // The claim this run audits. The session sends the run's exact claimText
    // (whose route params produced these numbers); a legacy numbers-only caller
    // sends none, so fall back to the scenario's single per-check claim. Trim so
    // an empty string never becomes a struck-through blank or an empty prompt.
    const auditedClaim =
      body.claim && body.claim.trim() !== ''
        ? body.claim
        : claimFor(body.scenarioId, body.checkId);

    // The actor-critic pass. A candidate finding (state 'flagged') is never shown
    // on one pass: when a reasoning backend is wired, an independent critic call
    // re-examines it and can confirm, downgrade, or veto it. A veto flips the
    // finding to clean; a downgrade keeps it as a soft advisory; confirm leaves it
    // flagged. If the critic errors or its reply does not parse, fail safe toward
    // showing the finding, marked critic-unverified. The critic never runs on a
    // clean / flag_only / hard_stop verdict.
    let effectiveState: CheckState = compute.state;
    let critic: CriticAssessment | undefined;
    if (compute.state === 'flagged' && reasoner.available) {
      try {
        const judgment = await reasoner.critique(
          buildCriticRequest(body.scenarioId, compute, body.fields, auditedClaim),
        );
        const gated = applyCriticGate(compute.state, judgment, reasoner.backend ?? 'bedrock');
        effectiveState = gated.state;
        critic = gated.assessment;
      } catch {
        critic = unverifiedAssessment(
          'The critic call failed; this finding is shown by default.',
        );
      }
    }

    // When a reasoning backend is wired — the Claude API for the public path, or
    // Bedrock for the internal demo — Claude narrates the finding from the
    // computed numbers, even on the fixture target. With no backend, or on any
    // error, fall back to the curated copy (kept in exact agreement with the
    // fixture numbers) so a finding always renders. Narrate for the effective
    // state so a vetoed finding reads as the clean verdict it now is.
    let narrative: Narrative;
    let source: 'bedrock' | 'anthropic' | 'curated';
    if (body.noReason) {
      // Numbers-only probe: skip the model call, keep the finding renderable.
      narrative = safeCurated(body.scenarioId, body.checkId, body.config, compute);
      source = 'curated';
    } else if (!reasoner.available) {
      narrative = safeCurated(body.scenarioId, body.checkId, body.config, compute);
      source = 'curated';
    } else {
      try {
        narrative = await reasoner.narrate(
          buildRequest(body.scenarioId, compute, effectiveState, auditedClaim),
        );
        source = reasoner.backend ?? 'curated';
      } catch {
        narrative = safeCurated(body.scenarioId, body.checkId, body.config, compute);
        source = 'curated';
      }
    }

    // Never-cry-wolf backstop at the gate seam: a vetoed finding must read clean.
    // The narrative heals here; the compute half (flag headline + red "bad" stats)
    // is neutralized below, so a cleared finding never renders as a clean verdict
    // that still asserts the flag.
    if (effectiveState === 'clean' && narrative.error) {
      narrative = { ...narrative, error: null, original: null };
    }

    // The struck-through claim on a flag must be the exact claim this run audited,
    // on every path (model or curated), so a report row never strikes a claim that
    // belongs to a different run of the same check. On a clean verdict there is no
    // struck claim (original stays null), so this only touches a flag / flag_only /
    // hard_stop that already carries a struck original.
    if (effectiveState !== 'clean' && narrative.original !== null && auditedClaim !== '') {
      narrative = { ...narrative, original: auditedClaim };
    }

    const vetoed = critic?.verdict === 'veto';

    // The engine's own recommendations carry the DETERMINISTIC feasibilities
    // (fixable_now / needs_new_data / unsalvageable), decided by the compute
    // layer and never by the model. When a reasoner is wired, ask it only to
    // improve the prose, handing it those fixed feasibilities. On any failure,
    // keep the engine's curated recommendations. A model failure never drops the
    // correction payload.
    let recommendations: Recommendation[] | undefined = compute.recommendations;
    if (reasoner.available && recommendations && recommendations.length > 0) {
      try {
        const prose = await reasoner.recommend({
          ...buildRequest(body.scenarioId, compute, effectiveState, auditedClaim),
          // The feasibility slots the engine already decided. The model fills in
          // prose against them and cannot change them; `enforceRecommendationHonesty`
          // overwrites whatever it returns.
          feasibilities: recommendations.map((r) => r.feasibility),
          fields: body.fields.map((f) => f.id),
          method: recommendations[0]?.citation ?? narrative.citation,
        });
        if (prose.length > 0) recommendations = prose;
      } catch {
        recommendations = compute.recommendations;
      }
    }

    const result = CheckResult.parse({
      ...compute,
      ...(vetoed ? clearComputeForVeto(compute) : {}),
      ...narrative,
      ...(recommendations ? { recommendations } : {}),
      source,
      state: effectiveState,
      ...(critic ? { computeState: compute.state, critic } : {}),
    });
    return Response.json(result);
  } catch {
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
