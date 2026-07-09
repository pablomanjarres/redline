import { enforceClaimHonesty } from '@redline/contracts';
import type {
  ScenarioId,
  CheckId,
  CheckConfigMap,
  DatasetInventory,
  ExtractedClaim,
} from '@redline/contracts';
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

/**
 * The "show the agent working" copy streamed while Claim Extraction runs (spec
 * section 6). Same reveal-on-a-timer pattern as reasoningLines, so the extractor
 * reads as live on the fixture path. Each line is truthful about what the agent
 * is doing at that moment: reading the inventory, inspecting the stored uns
 * results, enumerating claims, and routing each claim to the checks that can test
 * it. The counts match the curated extractedClaims for each scenario (three
 * auditable claims and one that sits outside the four checks).
 */
const EXTRACTION_LINES: Record<ScenarioId, string[]> = {
  marson: [
    'Reading the analysis: 51,842 cells, 3,200 genes, 9 resolved fields.',
    'Inspecting stored results under uns: a marker table over the leiden clusters and a differential-expression result by condition.',
    'The DE result reports FOXP3 up under IL2RA knockdown. That is a significance claim.',
    'Routing FOXP3 significance to Check 1 (pseudoreplication) and Check 4 (confounding).',
    'The marker table defines an activated Treg-like state by TNFRSF9, ICOS, TIGIT, and CTLA4.',
    'Routing the marker-defined state to Check 2 (double dipping) and Check 3 (fragility).',
    'Reading a second knockdown-responsive state, the Effector cluster, routed to Check 3.',
    'Found 3 auditable claims. One pseudotime claim falls outside the four checks; it is labeled and set aside.',
  ],
  ketamine: [
    'Reading the analysis: 48,213 cells, 2,431 genes, 8 resolved fields.',
    'Inspecting stored results under uns: a marker table over the leiden clusters and a differential-expression result by condition.',
    'The DE result reports Bdnf up under ketamine. That is a significance claim.',
    'Routing Bdnf significance to Check 1 (pseudoreplication) and Check 4 (confounding).',
    'The marker table defines an activated-microglia state by Il1b, Tnf, Ccl4, and Nfkbia.',
    'Routing the marker-defined state to Check 2 (double dipping) and Check 3 (fragility).',
    'Reading a ketamine-responsive Responder cluster, routed to Check 3.',
    'Found 3 auditable claims. One ligand-receptor claim falls outside the four checks; it is labeled and set aside.',
  ],
};

/** The streamed Claim Extraction copy for one scenario (spec section 6). */
export function extractionLines(scenarioId: ScenarioId): string[] {
  return EXTRACTION_LINES[scenarioId];
}

/**
 * The single curated claim list for a built-in scenario, honesty-checked against
 * the given inventory. This is the one definition the whole app shares when no
 * model backend is wired: the /api/audit/claims route returns it, and the session
 * store falls back to it if that POST fails, so both paths show the same claims
 * and the two can never drift. The claims live on each Scenario
 * (SCENARIOS[id].extractedClaims) and run through enforceClaimHonesty, so a
 * curated claim can never reference data the inventory does not carry: a route
 * naming an absent column is pruned, a claim citing an unknown gene is demoted.
 */
export function curatedClaimsFor(
  scenarioId: ScenarioId,
  inventory: DatasetInventory,
): ExtractedClaim[] {
  return enforceClaimHonesty(inventory, SCENARIOS[scenarioId].extractedClaims ?? []);
}
