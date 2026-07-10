import { afterEach, describe, expect, it, vi } from 'vitest';
import { postCheck } from './api.js';

/**
 * The run request must carry the run's own claim. The route narrates and
 * critiques `body.claim`, so if the client drops it, two runs on one check both
 * fall back to the scenario's per-check claim and strike the same conclusion
 * (the G2 bug). This locks the client half: `postCheck` forwards the run's
 * claim (and its identity) in the request body.
 */
describe('postCheck forwards the run claim to /api/audit/check', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('puts the run claim, claimId, and runKey in the request body', async () => {
    let sentBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        sentBody = JSON.parse(init.body) as Record<string, unknown>;
        // Empty 200 body: postCheck's CheckResult.parse will reject, which we
        // swallow below. This test asserts only what the client SENT.
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      }),
    );

    await postCheck({
      scenarioId: 'marson',
      checkId: 3,
      config: { min: 0.2, max: 1.0, step: 0.2, track: 'Effector', scrub: 0.6 },
      fields: [],
      claim: 'A distinct knockdown-responsive Effector T-cell state.',
      claimId: 'c4',
      runKey: 'c4::3',
    }).catch(() => undefined); // the response shape is irrelevant to this test

    expect(sentBody).toMatchObject({
      claim: 'A distinct knockdown-responsive Effector T-cell state.',
      claimId: 'c4',
      runKey: 'c4::3',
    });
  });
});
