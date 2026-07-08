/**
 * @redline/critic-verify — the actor-critic acceptance harness. It runs the critic
 * over genuine oracle findings plus adversarial injections and grades whether it
 * confirms, downgrades, and vetoes correctly, whether a real model call fired per
 * finding, and whether a rubber-stamp critic is caught. The offline tests use
 * stand-in critics to prove the mechanics; `verify.ts` runs the real Bedrock model.
 */
export { buildCriticCases } from './cases.js';
export type { CriticCase, CriticCaseKind } from './cases.js';
export {
  runCritic,
  assembleVerification,
  rubberStampSelfTest,
  failSafeSelfTest,
} from './runner.js';
export type { RunOptions } from './runner.js';
export {
  reasonerFrom,
  ruleBasedReasoner,
  rubberStampReasoner,
  throwingReasoner,
} from './stub-critics.js';
