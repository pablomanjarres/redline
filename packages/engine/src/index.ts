/**
 * @redline/engine - the locked demo fixtures, the scenarios, the curated prose,
 * and the report assembler. Every shape it produces is a @redline/contracts type;
 * it never redefines one.
 *
 * This entry is CLIENT-SAFE: it pulls in no Node builtins, so the session store
 * and other client components can import from it. The compute seam that resolves
 * and dispatches to a real target (and therefore touches child_process / fetch)
 * lives in `@redline/engine/server` and must only be imported from server code.
 */

// The compute seam - TYPES ONLY here (the runtime resolver is in ./server).
export type { ComputeTarget, ComputeInput } from './compute-target.js';

// Scenarios, defaults, roles, and the streamed reasoning copy.
export {
  SCENARIOS,
  SCENARIO_DEFAULTS,
  ROLE_OPTIONS,
  DEFAULT_SCENARIO,
  DEFAULT_CONFIG,
  defaultConfigFor,
  reasoningLines,
  extractionLines,
  curatedClaimsFor,
} from './scenarios.js';

// The dataset inventories (spec section 3) and the curated extracted claims
// (spec section 5) for the fixture path, so intake and extraction run with no
// credentials and no .h5ad. All client-safe (pure data), so they belong here.
export { MARSON_INVENTORY, KETAMINE_INVENTORY, INVENTORIES } from './inventories.js';
export { MARSON_CLAIMS } from './fixtures/marson.js';
export { KETAMINE_CLAIMS } from './fixtures/ketamine.js';

// The curated prose and the assembled report.
export { curatedNarrative } from './narrative.js';
export { assembleReport } from './report.js';

// Claim -> check routing: the pure decision layer shared by the session store
// and the acceptance harness (which of the four checks run, and with what
// config, given the confirmed claims). Client-safe: no React, no Node builtins.
//
// The (claim, check) run model (runsFrom + configForRun) is the current path;
// the ownerClaimByCheck / mergeRoutedConfig / claimTextForCheck functions are
// @deprecated single-owner shims kept only until apps/web migrates.
export {
  runKeyOf,
  runsFrom,
  configForRun,
  configForRunWithOutcome,
  routedChecksFrom,
  ownerClaimByCheck,
  ownerRouteParams,
  ROUTE_PARAM_ALIASES,
  NON_KNOB_PARAMS,
  aliasParams,
  mergeRouteParams,
  mergeRoutedConfig,
  mergeRoutedConfigWithOutcome,
  claimTextForCheck,
} from './routing.js';
export type {
  RunKey,
  RunDescriptor,
  MergeOutcome,
  RunConfigOutcome,
  RoutedConfigOutcome,
} from './routing.js';
// The actor-critic gate: maps the critic's ruling to the effective verdict.
export { applyCriticGate, unverifiedAssessment } from './critic-gate.js';
export type { CriticGateResult } from './critic-gate.js';
