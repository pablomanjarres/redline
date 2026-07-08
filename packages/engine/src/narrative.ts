import type { ScenarioId, CheckId, Narrative } from '@redline/contracts';
import { fixtureNarrative } from './fixtures/index.js';

/**
 * The curated prose for one finding: the named failure mode, the citation, and
 * the defensible rewrite. This is the single source of the demo copy, sliced from
 * the same fixture table that produces the numbers, so prose and numbers can never
 * disagree. The reasoning layer uses it as its fallback whenever Bedrock is
 * unavailable or errors, which keeps the live and fallback copy identical.
 */
export function curatedNarrative(
  scenarioId: ScenarioId,
  checkId: CheckId,
  config: unknown,
): Narrative {
  return fixtureNarrative(scenarioId, checkId, config);
}
