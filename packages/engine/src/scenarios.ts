import type { ScenarioId, CheckId, CheckConfigMap } from '@redline/contracts';
import { SCENARIOS, SCENARIO_DEFAULTS, fixtureReasoning } from './fixtures/index.js';
import { ROLE_OPTIONS } from './fixtures/shared.js';

export { SCENARIOS, SCENARIO_DEFAULTS, ROLE_OPTIONS };

/** The scenario the app loads first. Marson is the hero demo. */
export const DEFAULT_SCENARIO: ScenarioId = 'marson';

/**
 * The initial knob state. This is the default scenario's config (marson). Switch
 * scenarios with `defaultConfigFor(id)` to get that scenario's field names, since
 * a single map cannot name both donor_id and mouse_id.
 */
export const DEFAULT_CONFIG: CheckConfigMap = SCENARIO_DEFAULTS.marson;

/** The knob defaults for a specific scenario. */
export function defaultConfigFor(scenarioId: ScenarioId): CheckConfigMap {
  return SCENARIO_DEFAULTS[scenarioId];
}

/**
 * Infer which scenario a config belongs to, from the field names only the caller
 * can have set. Used when reasoningLines is called without an explicit scenario
 * (the session store calls it with two args); falls back to the default scenario.
 */
function inferScenario(id: CheckId, cfg: unknown): ScenarioId {
  const c = (cfg ?? {}) as Record<string, unknown>;
  if (id === 1) {
    if (c.unit === 'mouse_id' || c.unit === 'litter_id') return 'ketamine';
    if (c.unit === 'donor_id' || c.unit === 'guide_batch') return 'marson';
  }
  if (id === 3) {
    if (c.track === 'Responder' || c.track === 'Homeostatic') return 'ketamine';
    if (c.track === 'Effector' || c.track === 'Naive') return 'marson';
  }
  if (id === 4 && Array.isArray(c.nuisance)) {
    if (c.nuisance.includes('seq_batch')) return 'ketamine';
    if (c.nuisance.includes('lane')) return 'marson';
  }
  return DEFAULT_SCENARIO;
}

/**
 * The short technical lines streamed while a check runs. `scenarioId` is optional
 * so the two-arg call site in the session store keeps working; when omitted, the
 * scenario is inferred from the config's field names.
 */
export function reasoningLines(id: CheckId, cfg: unknown, scenarioId?: ScenarioId): string[] {
  const sid = scenarioId ?? inferScenario(id, cfg);
  return fixtureReasoning(sid, id, cfg);
}
