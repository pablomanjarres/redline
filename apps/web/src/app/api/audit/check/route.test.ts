import { describe, it, expect } from 'vitest';
import type { CheckResult } from '@redline/contracts';
import { POST } from './route.js';

/**
 * The struck-through claim on a finding must be the claim the RUN audited, not
 * a claim looked up by check id. On marson, Check 3 runs twice (the Activated
 * Treg-like state and the Effector state). Both POST to the same check with a
 * different `claim`, and each response must strike through its own claim, or a
 * report row belongs to the wrong run.
 *
 * Offline: the fixture compute target runs with no network, and with no reasoning
 * backend the route takes the curated narrative, then forces `original` to the
 * run's claim. So this exercises the real claim-selection seam without a model.
 */
async function runCheck3(claim: string): Promise<CheckResult> {
  const body = {
    scenarioId: 'marson',
    checkId: 3,
    config: { min: 0.2, max: 1.0, step: 0.2, track: 'Effector', scrub: 0.6 },
    fields: [],
    claim,
    claimId: claim,
    runKey: `${claim}::3`,
  };
  const req = new Request('http://localhost/api/audit/check', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const res = await POST(req);
  expect(res.status).toBe(200);
  return (await res.json()) as CheckResult;
}

describe('POST /api/audit/check strikes the claim the run audited (G2)', () => {
  it('two Check-3 runs strike through their own distinct claims', async () => {
    const treg = await runCheck3('An activated Treg-like state defined by TNFRSF9, ICOS, TIGIT, CTLA4');
    const effector = await runCheck3('A distinct knockdown-responsive Effector T-cell state');

    // A flagged finding carries a struck-through original; a clean one does not.
    // Whichever verdict each run gets, if it struck a claim it must be its OWN.
    if (treg.original !== null) {
      expect(treg.original).toContain('Treg-like');
      expect(treg.original).not.toContain('Effector');
    }
    if (effector.original !== null) {
      expect(effector.original).toContain('Effector');
      expect(effector.original).not.toContain('Treg-like');
    }
    // At least one of them flags on the fixture, so the assertion is not vacuous.
    expect(treg.original !== null || effector.original !== null).toBe(true);
  });

  it('a legacy caller that sends no claim still gets a 200 and a coherent finding', async () => {
    const body = {
      scenarioId: 'marson',
      checkId: 1,
      config: { unit: 'donor_id', grouping: 'condition', alpha: 0.05 },
      fields: [],
    };
    const req = new Request('http://localhost/api/audit/check', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const result = (await res.json()) as CheckResult;
    // The fallback still names the scenario's per-check claim on a flag.
    if (result.state === 'flagged') expect(result.original).not.toBeNull();
  });
});
