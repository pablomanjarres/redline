import type { FieldSpec, ComputeResult, ScenarioId, DatasetInventory } from '@redline/contracts';
import type { ComputeInput, ComputeTarget } from '../compute-target.js';
import { fixtureCompute, fixtureFields } from '../fixtures/index.js';
import { INVENTORIES } from '../inventories.js';

/**
 * The deterministic fixture target. Reproduces the locked demo numbers with no
 * network or subprocess, so it is always available and identical on every run.
 * `inferFields` returns the scenario's resolved fields; `computeCheck` returns
 * the ComputeResult slice of the fixture finding.
 */
export class FixtureTarget implements ComputeTarget {
  readonly id = 'fixture' as const;
  readonly available = true;

  async inspect(input: { scenarioId: ScenarioId }): Promise<DatasetInventory> {
    const inventory = INVENTORIES[input.scenarioId];
    if (!inventory) {
      // The verification foils carry no locked inventory. Refuse, the way
      // `verifyFull` refuses to fabricate their numbers, rather than hand back
      // undefined and let it surface as a dataset description of nothing.
      throw new Error(
        `scenario '${input.scenarioId}' has no fixture inventory; inspect it on REDLINE_COMPUTE_TARGET=local`,
      );
    }
    return inventory;
  }

  async inferFields(input: { scenarioId: ScenarioId }): Promise<FieldSpec[]> {
    return fixtureFields(input.scenarioId);
  }

  async computeCheck(input: ComputeInput): Promise<ComputeResult> {
    const result = await fixtureCompute(input.scenarioId, input.checkId, input.config);
    return { ...result, provenance: { target: 'fixture' } };
  }
}

/** The shared fixture-target singleton (stateless, safe to reuse). */
export const fixtureTarget: ComputeTarget = new FixtureTarget();
