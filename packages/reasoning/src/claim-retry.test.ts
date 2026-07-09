import { describe, expect, it } from 'vitest';
import { createReasoner } from './reasoner.js';
import type { ClaimMappingRequest } from '@redline/contracts';

const inventory = {
  file: 'a.h5ad',
  nCells: 10,
  nGenes: 2,
  obs: [{ name: 'leiden', dtype: 'categorical' as const, levels: 2, missing: 0, sample: ['0', '1'] }],
  uns: [],
  clusterFields: ['leiden'],
  varNamesSample: ['FOXP3'],
  layers: [],
  obsm: [],
  hasRawCounts: true,
  countsSource: 'X',
};

const req = { claimText: 'FOXP3 is up', inventory, fields: [] } as unknown as ClaimMappingRequest;

/** A reply whose claim cites an obs column the inventory does not have. */
const fabricated = JSON.stringify({
  claim: {
    id: 'c1',
    text: 'FOXP3 is up',
    source: 'user_added',
    restsOn: 'a stored result that does not exist',
    evidenceRefs: { obsColumns: ['a_column_that_does_not_exist'], unsKeys: [], genes: [] },
    checks: [],
    confidence: 'high',
    status: 'proposed',
  },
});

describe('mapClaim does not sample until the honesty backstop passes', () => {
  it('a rejected claim costs exactly one model call, not REASON_RETRIES', async () => {
    let calls = 0;
    const reasoner = createReasoner({
      invoke: async () => {
        calls += 1;
        return fabricated;
      },
    });

    await expect(reasoner.mapClaim(req)).rejects.toThrow();
    // Retrying a deterministic verdict re-rolls the model until it happens to
    // produce something the backstop accepts. That defeats the backstop.
    expect(calls).toBe(1);
  });

  it('a malformed reply IS retried, because that is transient', async () => {
    let calls = 0;
    const reasoner = createReasoner({
      invoke: async () => {
        calls += 1;
        return 'not json at all';
      },
    });

    await expect(reasoner.mapClaim(req)).rejects.toThrow();
    expect(calls).toBeGreaterThan(1);
  });

  it('claim calls are pinned to temperature 0, so routing is reproducible', async () => {
    const temps: (number | undefined)[] = [];
    const reasoner = createReasoner({
      invoke: async (args) => {
        temps.push(args.temperature);
        return fabricated;
      },
    });
    await expect(reasoner.mapClaim(req)).rejects.toThrow();
    expect(temps).toEqual([0]);
  });
});
