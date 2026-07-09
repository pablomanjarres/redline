import { z } from 'zod';
import { CriticConfidence, CriticVerdict } from './critic.js';
import { CheckId } from './primitives.js';

/**
 * @redline/contracts/verification — the shapes the verification harness emits
 * when it drives the running app and grades each surface against an oracle.
 * These are diagnostic types about the app, separate from the app's own audit
 * results (checks.ts). The harness proves a control is wired to real compute,
 * pins the AI channels as real or curated, and lists any dead controls.
 */

/**
 * The wiring verdict for one displayed value or control:
 * - WIRED: driven by real compute, changes when inputs change.
 * - STATIC: a hardcoded constant that never moves.
 * - BROKEN: a control that should act but does nothing.
 * - TEMPLATED: a formatted string that looks live but is fixed copy.
 * - MISSING: expected surface is absent.
 */
export const Verdict = z.enum(['WIRED', 'STATIC', 'BROKEN', 'TEMPLATED', 'MISSING']);
export type Verdict = z.infer<typeof Verdict>;

/** One probe the harness ran against a surface, with its pass/fail and a detail line. */
export const ProbeOutcome = z.object({
  name: z.string(),
  passed: z.boolean(),
  detail: z.string(),
});
export type ProbeOutcome = z.infer<typeof ProbeOutcome>;

/** One displayed value checked against the oracle value, flagged in or out of tolerance. */
export const ValueComparison = z.object({
  key: z.string(),
  displayed: z.string(),
  oracle: z.string(),
  withinTolerance: z.boolean(),
});
export type ValueComparison = z.infer<typeof ValueComparison>;

/**
 * The full verdict for one check id: what the UI showed, what the oracle says,
 * and every value comparison and probe behind the call.
 */
export const CheckVerdict = z.object({
  checkId: CheckId,
  verdict: Verdict,
  displayed: z.record(z.string()),
  oracle: z.record(z.string()),
  comparisons: z.array(ValueComparison),
  probes: z.array(ProbeOutcome),
  note: z.string().optional(),
});
export type CheckVerdict = z.infer<typeof CheckVerdict>;

/** The demo cases the harness walks, one letter each. */
export const CaseId = z.enum(['A', 'B', 'C', 'D']);
export type CaseId = z.infer<typeof CaseId>;

/** Every check verdict for one demo case, tied to the scenario it ran. */
export const CaseVerdict = z.object({
  caseId: CaseId,
  scenarioId: z.string(),
  label: z.string(),
  checks: z.array(CheckVerdict),
  notes: z.string().optional(),
});
export type CaseVerdict = z.infer<typeof CaseVerdict>;

/** One AI channel: where it resolved from, whether that call was real, and a detail line. */
export const AiChannel = z.object({
  source: z.string(),
  real: z.boolean(),
  detail: z.string(),
});
export type AiChannel = z.infer<typeof AiChannel>;

/**
 * The two AI channels the app leans on, plus whether field resolution actually
 * varies across cases. A field resolver that returns the same roles for every
 * dataset is a tell that the channel is fixed, so the harness tracks it.
 */
export const AiWiring = z.object({
  fieldResolution: AiChannel,
  reasoning: AiChannel,
  fieldResolutionAdaptsAcrossCases: z.boolean(),
});
export type AiWiring = z.infer<typeof AiWiring>;

/** A control the harness located and clicked: a button or link that does nothing. */
export const DeadControl = z.object({
  location: z.string(),
  selector: z.string(),
  label: z.string().nullable(),
  dead: z.boolean(),
});
export type DeadControl = z.infer<typeof DeadControl>;

/**
 * One candidate finding put through the critic: which case and check it came from,
 * the actor's pre-critic verdict, the critic's ruling and the number it keyed on,
 * whether that critic call was a real model call, and the effective verdict after
 * the gate. `expected` is the ruling the harness required, so a run is graded.
 */
export const CriticFindingOutcome = z.object({
  caseId: CaseId,
  checkId: CheckId,
  label: z.string(),
  computeState: z.string(),
  verdict: CriticVerdict,
  expected: CriticVerdict,
  keysOn: z.string(),
  justification: z.string(),
  confidence: CriticConfidence,
  effectiveState: z.string(),
  realModelCall: z.boolean(),
  passed: z.boolean(),
});
export type CriticFindingOutcome = z.infer<typeof CriticFindingOutcome>;

/**
 * The self-honesty injection: a rubber-stamp critic (always confirm) is run over
 * the adversarial cases. A trustworthy harness must catch it (report it unable to
 * veto or downgrade). If `caught` is false the harness itself is decorative.
 */
export const CriticSelfTest = z.object({
  name: z.string(),
  caught: z.boolean(),
  detail: z.string(),
});
export type CriticSelfTest = z.infer<typeof CriticSelfTest>;

/**
 * The actor-critic slice of the self-verification harness: whether a real model
 * call fired per finding, whether the critic vetoed the over-fired flag on the
 * clean case (green), whether it downgraded the underpowered split, the
 * per-finding outcomes, and the rubber-stamp self-test.
 */
export const CriticVerification = z.object({
  ready: z.boolean(),
  model: z.string(),
  realModelCalls: z.number().int(),
  cleanCaseGreen: z.boolean(),
  outcomes: z.array(CriticFindingOutcome),
  selfTests: z.array(CriticSelfTest),
});
export type CriticVerification = z.infer<typeof CriticVerification>;

/**
 * The whole harness run: readiness, the per-case verdicts, the AI wiring status,
 * the dead controls found, the actor-critic slice, and any failure strings
 * collected along the way. `critic` is optional so a base-harness run that has
 * not built the critic slice still parses.
 */
export const VerificationRun = z.object({
  ready: z.boolean(),
  timestamp: z.string(),
  cases: z.array(CaseVerdict),
  aiWiring: AiWiring,
  deadControls: z.array(DeadControl),
  failures: z.array(z.string()),
  critic: CriticVerification.optional(),
});
export type VerificationRun = z.infer<typeof VerificationRun>;
