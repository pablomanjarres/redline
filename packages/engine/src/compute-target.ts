import type {
  ScenarioId,
  CheckId,
  FieldSpec,
  EngineResult,
  AnyCheckConfig,
  PreviewArtifact,
} from '@redline/contracts';
import { fixtureTarget } from './targets/fixture.js';
import { createRemoteTarget } from './targets/remote.js';

/** The input to one check: a scenario, a pillar, its knob config, and the fields. */
export interface ComputeInput {
  scenarioId: ScenarioId;
  checkId: CheckId;
  config: AnyCheckConfig;
  fields: FieldSpec[];
}

/**
 * The compute seam. The fixture target is deterministic and always available; the
 * remote targets shell out to (or fetch) the real Python engine and return the
 * SAME EngineResult shape (statistics plus whatever correction the check could
 * produce). A remote target whose env is unwired reports `available: false` so a
 * dead control is never presented as live.
 */
export interface ComputeTarget {
  readonly id: 'fixture' | 'local' | 'cloudrun' | 'endpoint';
  readonly available: boolean;
  inferFields(input: { scenarioId: ScenarioId }): Promise<FieldSpec[]>;
  computeCheck(input: ComputeInput): Promise<EngineResult>;
  /**
   * The heavier fix-and-preview render, kept separate so the overview can load
   * fast and a card can fetch its preview on demand. Optional: a target that
   * does not render previews (or is unwired) returns null, and the card shows
   * the corrected code and recommendations it already has.
   */
  preview?(input: ComputeInput): Promise<PreviewArtifact | null>;
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
