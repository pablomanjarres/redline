import type {
  ScenarioId,
  CheckId,
  Scenario,
  CheckConfigMap,
  ComputeResult,
  Narrative,
  FieldSpec,
} from '@redline/contracts';
import { toCompute, toNarrative, type FullCheck } from './shared.js';
import { ketamineScenario, ketamineFull, ketamineReasoning, KETAMINE_DEFAULTS } from './ketamine.js';
import { marsonScenario, marsonFull, marsonReasoning, MARSON_DEFAULTS } from './marson.js';
import {
  pfcScenario,
  cleanScenario,
  nocountsScenario,
  pfcDefaults,
  cleanDefaults,
  nocountsDefaults,
  verifyFull,
  verifyReasoning,
} from './verify-cases.js';

interface FixtureScenario {
  scenario: Scenario;
  full(checkId: CheckId, cfg: unknown): FullCheck;
  reasoning(checkId: CheckId, cfg: unknown): string[];
  defaults: CheckConfigMap;
}

// One registry row per scenario. Marson first: it is the default the app loads.
const REGISTRY: Record<ScenarioId, FixtureScenario> = {
  marson: {
    scenario: marsonScenario,
    full: marsonFull,
    reasoning: marsonReasoning,
    defaults: MARSON_DEFAULTS,
  },
  ketamine: {
    scenario: ketamineScenario,
    full: ketamineFull,
    reasoning: ketamineReasoning,
    defaults: KETAMINE_DEFAULTS,
  },
  // Verification foils: local-only (no locked fixture; `full`/`reasoning` throw).
  pfc: {
    scenario: pfcScenario,
    full: verifyFull('pfc'),
    reasoning: verifyReasoning('pfc'),
    defaults: pfcDefaults,
  },
  clean: {
    scenario: cleanScenario,
    full: verifyFull('clean'),
    reasoning: verifyReasoning('clean'),
    defaults: cleanDefaults,
  },
  nocounts: {
    scenario: nocountsScenario,
    full: verifyFull('nocounts'),
    reasoning: verifyReasoning('nocounts'),
    defaults: nocountsDefaults,
  },
};

export const SCENARIOS: Record<ScenarioId, Scenario> = {
  marson: marsonScenario,
  ketamine: ketamineScenario,
  pfc: pfcScenario,
  clean: cleanScenario,
  nocounts: nocountsScenario,
};

export const SCENARIO_DEFAULTS: Record<ScenarioId, CheckConfigMap> = {
  marson: MARSON_DEFAULTS,
  ketamine: KETAMINE_DEFAULTS,
  pfc: pfcDefaults,
  clean: cleanDefaults,
  nocounts: nocountsDefaults,
};

/** The full finding (numbers ⊕ prose) for one scenario/check/cfg. */
export function fixtureFull(scenarioId: ScenarioId, checkId: CheckId, cfg: unknown): FullCheck {
  return REGISTRY[scenarioId].full(checkId, cfg);
}

/** The compute half only (what a ComputeTarget returns). */
export function fixtureCompute(
  scenarioId: ScenarioId,
  checkId: CheckId,
  cfg: unknown,
): ComputeResult {
  return toCompute(REGISTRY[scenarioId].full(checkId, cfg));
}

/** The prose half only (what curatedNarrative returns). */
export function fixtureNarrative(
  scenarioId: ScenarioId,
  checkId: CheckId,
  cfg: unknown,
): Narrative {
  return toNarrative(REGISTRY[scenarioId].full(checkId, cfg));
}

/** The streamed reasoning lines for one scenario/check/cfg. */
export function fixtureReasoning(scenarioId: ScenarioId, checkId: CheckId, cfg: unknown): string[] {
  return REGISTRY[scenarioId].reasoning(checkId, cfg);
}

/** A fresh copy of a scenario's resolved fields (callers may edit roles). */
export function fixtureFields(scenarioId: ScenarioId): FieldSpec[] {
  return REGISTRY[scenarioId].scenario.fields.map((f) => ({ ...f }));
}
