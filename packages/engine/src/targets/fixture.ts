import type { FieldSpec, EngineResult, ScenarioId, PreviewArtifact } from '@redline/contracts';
import type { ComputeInput, ComputeTarget } from '../compute-target.js';
import { fixtureCompute, fixtureFields } from '../fixtures/index.js';

/**
 * The deterministic fixture target. Reproduces the locked demo numbers with no
 * network or subprocess, so it is always available and identical on every run.
 * `inferFields` returns the scenario's resolved fields; `computeCheck` returns
 * the EngineResult (statistics plus correction) of the fixture finding.
 */
export class FixtureTarget implements ComputeTarget {
  readonly id = 'fixture' as const;
  readonly available = true;

  async inferFields(input: { scenarioId: ScenarioId }): Promise<FieldSpec[]> {
    return fixtureFields(input.scenarioId);
  }

  async computeCheck(input: ComputeInput): Promise<EngineResult> {
    const result = fixtureCompute(input.scenarioId, input.checkId, input.config);
    return { ...result, provenance: { target: 'fixture' } };
  }

  async preview(input: ComputeInput): Promise<PreviewArtifact | null> {
    const result = fixtureCompute(input.scenarioId, input.checkId, input.config);
    return result.preview ?? null;
  }
}

/** The shared fixture-target singleton (stateless, safe to reuse). */
export const fixtureTarget: ComputeTarget = new FixtureTarget();
