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
} from './scenarios.js';

// The curated prose and the assembled report.
export { curatedNarrative } from './narrative.js';
export { assembleReport } from './report.js';
