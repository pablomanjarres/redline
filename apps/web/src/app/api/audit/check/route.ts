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
  type CheckState,
  type ComputeResult,
  type CriticAssessment,
  type CriticRequest,
  type Narrative,
  type NarrativeRequest,
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

/** The full load-bearing evidence for a finding: the stat readouts + the chart numbers. */
function computeEvidence(
  compute: ComputeResult,
): Record<string, string | number | boolean> {
  const statsEvidence: Record<string, string> = Object.fromEntries(
    compute.stats.map((s): [string, string] => [s.label, s.value]),
  );
  return { ...statsEvidence, ...chartEvidence(compute.chart) };
}

/** The scientist's claim under audit for one check, or an empty string. */
function claimFor(scenarioId: ScenarioId, checkId: CheckId): string {
  return SCENARIOS[scenarioId].claims.find((c) => c.check === checkId)?.text ?? '';
}

/** Assemble the reasoning-layer request from the scenario claim + computed numbers. */
function buildRequest(
  scenarioId: ScenarioId,
  compute: ComputeResult,
  state: CheckState,
): NarrativeRequest {
  return {
    checkId: compute.checkId,
    state,
    claim: claimFor(scenarioId, compute.checkId),
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

/** Assemble the critic request from the candidate finding + numbers + resolved design. */
function buildCriticRequest(
  scenarioId: ScenarioId,
  compute: ComputeResult,
  fields: FieldSpec[],
): CriticRequest {
  const design = resolveDesign(fields);
  return {
    checkId: compute.checkId,
    computeState: compute.state,
    claim: claimFor(scenarioId, compute.checkId),
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
          buildCriticRequest(body.scenarioId, compute, body.fields),
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
    if (!reasoner.available) {
      narrative = curatedNarrative(body.scenarioId, body.checkId, body.config);
      source = 'curated';
    } else {
      try {
        narrative = await reasoner.narrate(
          buildRequest(body.scenarioId, compute, effectiveState),
        );
        source = reasoner.backend ?? 'curated';
      } catch {
        narrative = curatedNarrative(body.scenarioId, body.checkId, body.config);
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
    const vetoed = critic?.verdict === 'veto';

    const result = CheckResult.parse({
      ...compute,
      ...(vetoed ? clearComputeForVeto(compute) : {}),
      ...narrative,
      source,
      state: effectiveState,
      ...(critic ? { computeState: compute.state, critic } : {}),
    });
    return Response.json(result);
  } catch {
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
