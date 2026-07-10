/**
 * Drive one case through fields resolution and the four checks, running each
 * probe against the live app. Paced so Bedrock does not throttle. The primary
 * run of every check uses real reasoning; the liveness / re-run probes set
 * noReason so a sweep of knob changes stays fast and numbers-only.
 *
 * Liveness is detected as a string change in the recomputed value: the real
 * engine returns a different number when a live knob moves, a static fixture
 * returns the identical one. The probe is skipped when a check legitimately
 * cannot compute (flag_only / hard_stop), so graceful degradation is not
 * mistaken for a dead control.
 */
import type { CheckResult, FieldSpec } from '@redline/contracts';
import { postCheck, postFields } from './api.js';
import type { CaseDef } from './cases.js';
import { PACE_MS, sleep } from './config.js';
import { confirmFields, demoteUnit, displayedFor } from './helpers.js';
import type { CaseProbe, CheckProbe, Provenance } from './types.js';

function prov(r: CheckResult): Provenance {
  return (r.provenance ?? {}) as Provenance;
}

function computed(state: string): boolean {
  return state === 'flagged' || state === 'clean';
}

export async function driveCase(c: CaseDef): Promise<CaseProbe> {
  const out: CaseProbe = { caseId: c.caseId, scenarioId: c.scenarioId, label: c.label, fieldRoles: {}, checks: [] };
  try {
    const fr = await postFields(c.scenarioId);
    out.fieldsSource = fr.source;
    out.fieldRoles = Object.fromEntries(fr.fields.map((f) => [f.id, f.role]));
    const fields = confirmFields(fr.fields, c);
    await sleep(PACE_MS);
    out.checks.push(await driveCheck1(c, fields));
    await sleep(PACE_MS);
    out.checks.push(await driveCheck2(c, fields));
    await sleep(PACE_MS);
    out.checks.push(await driveCheck3(c, fields));
    await sleep(PACE_MS);
    out.checks.push(await driveCheck4(c, fields));
  } catch (err) {
    out.error = err instanceof Error ? err.message : String(err);
  }
  return out;
}

async function driveCheck1(c: CaseDef, fields: FieldSpec[]): Promise<CheckProbe> {
  const p: CheckProbe = { checkId: 1, ok: false, displayed: {} };
  try {
    const base = await postCheck(c.scenarioId, 1, { unit: c.unit, grouping: c.grouping, alpha: 0.05 }, fields);
    p.ok = true;
    p.displayed = displayedFor(base);
    p.provenance = prov(base);
    p.reasoningSource = base.source;
    p.correctedText = base.corrected;
    if (computed(p.displayed.state)) {
      await sleep(PACE_MS);
      // Foundation probe (2B): demote the replicate unit and aim it at the near-unique column.
      const f2b = demoteUnit(fields, c.unit);
      const alt = await postCheck(c.scenarioId, 1, { unit: c.observation, grouping: c.grouping, alpha: 0.05 }, f2b, true);
      const d2 = displayedFor(alt);
      const before = `n=${p.displayed.n} badUnit=${p.displayed.badUnit} ${p.displayed.state}`;
      const after = `n=${d2.n} badUnit=${d2.badUnit} ${d2.state}`;
      const changed = before !== after;
      p.twoB = { before, after, changed };
      p.livenessKnob = 'unit-role';
      p.livenessBefore = before;
      p.livenessAfter = after;
      p.livenessChanged = changed;
      p.rerunNonce = prov(alt).nonce;
    }
  } catch (err) {
    p.error = err instanceof Error ? err.message : String(err);
  }
  return p;
}

async function driveCheck2(c: CaseDef, fields: FieldSpec[]): Promise<CheckProbe> {
  const p: CheckProbe = { checkId: 2, ok: false, displayed: {} };
  try {
    const base = await postCheck(c.scenarioId, 2, { split: 0.5, grouping: 'cell_state' }, fields);
    p.ok = true;
    p.displayed = displayedFor(base);
    p.provenance = prov(base);
    p.reasoningSource = base.source;
    p.correctedText = base.corrected;
    if (computed(p.displayed.state)) {
      await sleep(PACE_MS);
      const alt = await postCheck(c.scenarioId, 2, { split: 0.3, grouping: 'cell_state' }, fields, true);
      const d2 = displayedFor(alt);
      p.livenessKnob = 'split';
      p.livenessBefore = p.displayed.holdAUC ?? '?';
      p.livenessAfter = d2.holdAUC ?? '?';
      p.livenessChanged = (p.displayed.holdAUC ?? '') !== (d2.holdAUC ?? '');
      p.rerunNonce = prov(alt).nonce;
    }
  } catch (err) {
    p.error = err instanceof Error ? err.message : String(err);
  }
  return p;
}

async function driveCheck3(c: CaseDef, fields: FieldSpec[]): Promise<CheckProbe> {
  const p: CheckProbe = { checkId: 3, ok: false, displayed: {} };
  try {
    const spur = await postCheck(c.scenarioId, 3, { min: 0.2, max: 2.0, step: 0.2, track: c.spurious, scrub: 1.0 }, fields);
    p.ok = true;
    p.displayed = displayedFor(spur);
    p.provenance = prov(spur);
    p.reasoningSource = spur.source;
    p.correctedText = spur.corrected;
    await sleep(PACE_MS);
    if (c.stable) {
      const stab = await postCheck(c.scenarioId, 3, { min: 0.2, max: 2.0, step: 0.2, track: c.stable, scrub: 1.0 }, fields, true);
      p.stableDisplayed = displayedFor(stab);
      await sleep(PACE_MS);
    }
    // Liveness: coarsen the step; the sweep length recomputes.
    const alt = await postCheck(c.scenarioId, 3, { min: 0.2, max: 2.0, step: 0.5, track: c.spurious, scrub: 1.0 }, fields, true);
    const d2 = displayedFor(alt);
    p.livenessKnob = 'step';
    p.livenessBefore = `${p.displayed.steps} settings`;
    p.livenessAfter = `${d2.steps} settings`;
    p.livenessChanged = (p.displayed.steps ?? '') !== (d2.steps ?? '');
    p.rerunNonce = prov(alt).nonce;
  } catch (err) {
    p.error = err instanceof Error ? err.message : String(err);
  }
  return p;
}

async function driveCheck4(c: CaseDef, fields: FieldSpec[]): Promise<CheckProbe> {
  const p: CheckProbe = { checkId: 4, ok: false, displayed: {} };
  try {
    const base = await postCheck(c.scenarioId, 4, { interest: c.grouping, nuisance: [c.nuisance] }, fields);
    p.ok = true;
    p.displayed = displayedFor(base);
    p.provenance = prov(base);
    p.reasoningSource = base.source;
    p.correctedText = base.corrected;
    await sleep(PACE_MS);
    // Liveness: swap the nuisance column to a non-confounded one; Cramer's V recomputes.
    const alt = await postCheck(c.scenarioId, 4, { interest: c.grouping, nuisance: ['phase'] }, fields, true);
    const d2 = displayedFor(alt);
    const before = p.displayed.cramersV ?? p.displayed.verified ?? p.displayed.state;
    const after = d2.cramersV ?? d2.verified ?? d2.state;
    p.livenessKnob = 'nuisance';
    p.livenessBefore = `V=${before}`;
    p.livenessAfter = `V=${after}`;
    p.livenessChanged = String(before) !== String(after);
    p.rerunNonce = prov(alt).nonce;
  } catch (err) {
    p.error = err instanceof Error ? err.message : String(err);
  }
  return p;
}
