import type {
  ScenarioId,
  CheckId,
  FieldSpec,
  ComputeResult,
  Check1Config,
  Check2Config,
  Check3Config,
  Check4Config,
} from '@redline/contracts';
import { fixtureTarget } from './targets/fixture.js';
import { createRemoteTarget } from './targets/remote.js';

/** The input to one check: a scenario, a pillar, its knob config, and the fields. */
export interface ComputeInput {
  scenarioId: ScenarioId;
  checkId: CheckId;
  config: Check1Config | Check2Config | Check3Config | Check4Config;
  fields: FieldSpec[];
}

/**
 * The compute seam. The fixture target is deterministic and always available; the
 * remote targets shell out to (or fetch) the real Python engine and return the
 * SAME ComputeResult shape. A remote target whose env is unwired reports
 * `available: false` so a dead control is never presented as live.
 */
export interface ComputeTarget {
  readonly id: 'fixture' | 'local' | 'cloudrun' | 'endpoint';
  readonly available: boolean;
  inferFields(input: { scenarioId: ScenarioId }): Promise<FieldSpec[]>;
  computeCheck(input: ComputeInput): Promise<ComputeResult>;
}

/**
 * Resolve the active compute target from REDLINE_COMPUTE_TARGET (default
 * 'fixture'). A remote target is only returned when its env is wired; otherwise
 * we fall back to the fixture so the app never holds a dead control.
 */
export function getComputeTarget(): ComputeTarget {
  const raw = (process.env.REDLINE_COMPUTE_TARGET ?? 'fixture').trim().toLowerCase();
  if (raw === 'local' || raw === 'cloudrun' || raw === 'endpoint') {
    const remote = createRemoteTarget(raw);
    return remote.available ? remote : fixtureTarget;
  }
  return fixtureTarget;
}
