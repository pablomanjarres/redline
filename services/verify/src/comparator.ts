/**
 * Turn the driver's captured probe data into graded verdicts. A check is WIRED
 * only when it matches the oracle within tolerance AND responds to its probes;
 * anything else is STATIC / BROKEN / TEMPLATED / MISSING.
 */
import type {
  AiWiring,
  CaseVerdict,
  CheckId,
  CheckVerdict,
  ProbeOutcome,
  Verdict,
  ValueComparison,
} from '@redline/contracts';
import { CHECK_NAMES } from './cases.js';
import { TOL } from './config.js';
import { carriesNumber } from './helpers.js';
import { log10pClose, num, type OracleCase, type OracleCheck } from './oracle.js';
import type { CaseProbe, CheckProbe } from './types.js';

function vc(key: string, displayed: unknown, oracle: unknown, within: boolean): ValueComparison {
  return { key, displayed: String(displayed), oracle: String(oracle), withinTolerance: within };
}

/** Compare a check's displayed numbers to the oracle. Returns the per-value
 *  comparisons and whether every one is within tolerance. */
function compareCheck(
  checkId: number,
  probe: CheckProbe,
  oc: OracleCheck,
): { comparisons: ValueComparison[]; matches: boolean } {
  const d = probe.displayed;
  const comps: ValueComparison[] = [];

  if (checkId === 1) {
    const dhp = num(d.honestP),
      ohp = num(oc.honestP as number);
    comps.push(vc('honestP', d.honestP, oc.honestP, dhp != null && ohp != null && log10pClose(dhp, ohp, TOL.log10p)));
    comps.push(vc('n', d.n, oc.n, String(d.n) === String(oc.n)));
    comps.push(vc('verdict', d.state, oc.verdict, String(d.state) === String(oc.verdict)));
  } else if (checkId === 2) {
    const dh = num(d.holdAUC),
      oh = num(oc.holdAUC as number);
    if (dh != null && oh != null) comps.push(vc('holdAUC', d.holdAUC, oc.holdAUC, Math.abs(dh - oh) <= TOL.auc));
    const dd = num(d.discAUC),
      od = num(oc.discAUC as number);
    if (dd != null && od != null) comps.push(vc('discAUC', d.discAUC, oc.discAUC, Math.abs(dd - od) <= TOL.auc));
    comps.push(vc('verdict', d.state, oc.verdict, String(d.state) === String(oc.verdict)));
  } else if (checkId === 3) {
    const spur = oc.spurious as Record<string, unknown> | undefined;
    const stab = oc.stable as Record<string, unknown> | undefined;
    if (spur) {
      const ds = num(d.stability),
        os = num(spur.stability as number);
      if (ds != null && os != null) comps.push(vc('spurious.stability', d.stability, spur.stability, Math.abs(ds - os) <= TOL.stability));
      comps.push(vc('spurious.verdict', d.state, spur.verdict, String(d.state) === String(spur.verdict)));
    }
    if (stab && probe.stableDisplayed) {
      const dt = num(probe.stableDisplayed.stability),
        ot = num(stab.stability as number);
      if (dt != null && ot != null) comps.push(vc('stable.stability', probe.stableDisplayed.stability, stab.stability, Math.abs(dt - ot) <= TOL.stability));
      comps.push(vc('stable.verdict', probe.stableDisplayed.state, stab.verdict, String(probe.stableDisplayed.state) === String(stab.verdict)));
    }
  } else if (checkId === 4) {
    const dv = num(d.cramersV),
      ov = num(oc.cramersV as number);
    if (dv != null && ov != null) comps.push(vc('cramersV', d.cramersV, oc.cramersV, Math.abs(dv - ov) <= TOL.cramersV));
    comps.push(vc('verdict', d.state, oc.verdict, String(d.state) === String(oc.verdict)));
  }

  const matches = comps.length > 0 && comps.every((c) => c.withinTolerance);
  return { comparisons: comps, matches };
}

function assignVerdict(probe: CheckProbe, matches: boolean): { verdict: Verdict; probes: ProbeOutcome[] } {
  const probes: ProbeOutcome[] = [];
  if (!probe.ok) {
    probes.push({ name: 'compute', passed: false, detail: probe.error ?? 'the check did not return a result' });
    return { verdict: 'MISSING', probes };
  }
  probes.push({ name: 'matches-oracle', passed: matches, detail: matches ? 'displayed values within tolerance of the oracle' : 'displayed values differ from the oracle' });

  const p = probe.provenance;
  const realCompute = p?.target === 'local' && (p?.elapsedMs ?? 0) > 0 && Boolean(p?.ran);
  probes.push({ name: 'real-compute', passed: realCompute, detail: `${p?.target ?? 'none'} / ${p?.ran ?? 'n/a'} / ${p?.elapsedMs ?? 0}ms` });

  if (probe.rerunNonce) {
    const fresh = probe.rerunNonce !== p?.nonce;
    probes.push({ name: 'fresh-nonce', passed: fresh, detail: fresh ? 'a fresh compute nonce on re-run' : 'identical nonce (a cached swap)' });
  }
  if (probe.livenessKnob) {
    probes.push({ name: `liveness:${probe.livenessKnob}`, passed: Boolean(probe.livenessChanged), detail: `${probe.livenessBefore} -> ${probe.livenessAfter}` });
  }
  if (probe.twoB) {
    probes.push({ name: 'foundation-drives-audit', passed: probe.twoB.changed, detail: `unit demoted to observation: n ${probe.twoB.before} -> ${probe.twoB.after}` });
  }
  const aiReal = probe.reasoningSource === 'bedrock' || probe.reasoningSource === 'anthropic';
  probes.push({ name: 'reasoning-source', passed: aiReal, detail: `source = ${probe.reasoningSource ?? 'none'}` });

  const flagged = probe.displayed.state === 'flagged';
  const templated = !aiReal || (flagged && !carriesNumber(probe.correctedText));

  let verdict: Verdict;
  if (!matches) verdict = 'BROKEN';
  else if (probe.livenessKnob && probe.livenessChanged === false) verdict = 'STATIC';
  else if (templated) verdict = 'TEMPLATED';
  else verdict = 'WIRED';
  return { verdict, probes };
}

function oracleDisplay(oc: OracleCheck): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(oc)) {
    if (v == null) continue;
    if (typeof v === 'object') {
      const inner = v as Record<string, unknown>;
      for (const [ik, iv] of Object.entries(inner)) {
        if (iv != null && typeof iv !== 'object') out[`${k}.${ik}`] = String(iv);
      }
    } else {
      out[k] = String(v);
    }
  }
  return out;
}

function gradeCheck(probe: CheckProbe, oc: OracleCheck | undefined): CheckVerdict {
  if (!oc) {
    return { checkId: probe.checkId as CheckId, verdict: 'MISSING', displayed: probe.displayed, oracle: {}, comparisons: [], probes: [{ name: 'oracle', passed: false, detail: 'no oracle entry for this check' }] };
  }
  const { comparisons, matches } = compareCheck(probe.checkId, probe, oc);
  const { verdict, probes } = assignVerdict(probe, matches);
  const note = probe.checkId === 3 && probe.stableDisplayed ? `tracked spurious=${probe.displayed.state}, stable=${probe.stableDisplayed.state}` : undefined;
  return { checkId: probe.checkId as CheckId, verdict, displayed: probe.displayed, oracle: oracleDisplay(oc), comparisons, probes, note };
}

export function gradeCase(probe: CaseProbe, oracle: OracleCase): CaseVerdict {
  const checks = probe.checks.map((cp) => gradeCheck(cp, oracle.checks[String(cp.checkId)]));
  return { caseId: probe.caseId as CaseVerdict['caseId'], scenarioId: probe.scenarioId, label: probe.label, checks, notes: probe.error };
}

/** Field resolution should be a real model call whose proposals differ across
 *  the differently-named case A and case B columns. Reasoning likewise real. */
export function gradeAiWiring(caseProbes: CaseProbe[]): AiWiring {
  const a = caseProbes.find((c) => c.caseId === 'A');
  const b = caseProbes.find((c) => c.caseId === 'B');
  const anyReasoning = caseProbes.flatMap((c) => c.checks).find((c) => c.reasoningSource);
  const frReal = caseProbes.some((c) => c.fieldsSource === 'bedrock' || c.fieldsSource === 'anthropic');
  const adapts =
    !!a && !!b && JSON.stringify(a.fieldRoles) !== JSON.stringify(b.fieldRoles) && Object.keys(a.fieldRoles).join(',') !== Object.keys(b.fieldRoles).join(',');
  const rSource = anyReasoning?.reasoningSource ?? 'none';
  return {
    fieldResolution: {
      source: caseProbes.map((c) => c.fieldsSource).find(Boolean) ?? 'none',
      real: frReal,
      detail: frReal ? 'Claude proposed the roles from the raw columns' : 'served the heuristic fallback, not a model call',
    },
    reasoning: {
      source: rSource,
      real: rSource === 'bedrock' || rSource === 'anthropic',
      detail: rSource === 'bedrock' || rSource === 'anthropic' ? 'Claude wrote the finding prose' : 'served the curated fallback',
    },
    fieldResolutionAdaptsAcrossCases: adapts,
  };
}

export function isReady(cases: CaseVerdict[], ai: AiWiring, deadUnlabeled: number): { ready: boolean; failures: string[] } {
  const failures: string[] = [];
  for (const c of cases) {
    for (const chk of c.checks) {
      if (chk.verdict !== 'WIRED') failures.push(`Case ${c.caseId} check ${chk.checkId} (${CHECK_NAMES[chk.checkId]}): ${chk.verdict}`);
    }
  }
  if (!ai.fieldResolution.real) failures.push('Field resolution is not a real model call');
  if (!ai.reasoning.real) failures.push('Reasoning is not a real model call');
  if (!ai.fieldResolutionAdaptsAcrossCases) failures.push('Field resolution did not adapt across cases A and B');
  if (deadUnlabeled > 0) failures.push(`${deadUnlabeled} unlabeled dead control(s)`);
  return { ready: failures.length === 0, failures };
}
