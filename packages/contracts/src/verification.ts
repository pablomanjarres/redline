import { z } from 'zod';
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
 * The whole harness run: readiness, the per-case verdicts, the AI wiring status,
 * the dead controls found, and any failure strings collected along the way.
 */
export const VerificationRun = z.object({
  ready: z.boolean(),
  timestamp: z.string(),
  cases: z.array(CaseVerdict),
  aiWiring: AiWiring,
  deadControls: z.array(DeadControl),
  failures: z.array(z.string()),
});
export type VerificationRun = z.infer<typeof VerificationRun>;
