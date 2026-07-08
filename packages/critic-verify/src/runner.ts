import type {
  CriticFindingOutcome,
  CriticSelfTest,
  CriticVerification,
} from '@redline/contracts';
import { applyCriticGate, unverifiedAssessment } from '@redline/engine';
import { ReasonerUnavailable, type Reasoner } from '@redline/reasoning';
import type { CriticCase } from './cases.js';
import { rubberStampReasoner, throwingReasoner } from './stub-critics.js';

export interface RunOptions {
  /** True when the reasoner makes real model calls (the live leg), false for stubs. */
  realModelCalls: boolean;
}

/** Run every candidate through the critic and the gate, one outcome per finding. */
export async function runCritic(
  reasoner: Reasoner,
  cases: CriticCase[],
  opts: RunOptions,
): Promise<CriticFindingOutcome[]> {
  const outcomes: CriticFindingOutcome[] = [];
  for (const c of cases) {
    try {
      const judgment = await reasoner.critique(c.request);
      const gated = applyCriticGate(c.request.computeState, judgment, reasoner.backend ?? 'curated');
      outcomes.push({
        caseId: c.caseId,
        checkId: c.checkId,
        label: c.label,
        computeState: c.request.computeState,
        verdict: gated.assessment.verdict,
        expected: c.expected,
        keysOn: gated.assessment.keysOn,
        justification: gated.assessment.justification,
        confidence: gated.assessment.confidence,
        effectiveState: gated.state,
        realModelCall: opts.realModelCalls,
        passed: gated.assessment.verdict === c.expected,
      });
    } catch (err) {
      // Fail safe toward showing: the finding stays flagged, marked unverified.
      const a = unverifiedAssessment(
        err instanceof ReasonerUnavailable ? err.message : 'the critic call failed',
      );
      outcomes.push({
        caseId: c.caseId,
        checkId: c.checkId,
        label: c.label,
        computeState: c.request.computeState,
        verdict: a.verdict,
        expected: c.expected,
        keysOn: a.keysOn,
        justification: a.justification,
        confidence: a.confidence,
        effectiveState: c.request.computeState,
        realModelCall: false,
        passed: false, // a finding the critic could not verify never counts as passed
      });
    }
  }
  return outcomes;
}

interface Pair {
  c: CriticCase;
  o: CriticFindingOutcome;
}

function zip(cases: CriticCase[], outcomes: CriticFindingOutcome[]): Pair[] {
  const pairs: Pair[] = [];
  for (let i = 0; i < cases.length; i += 1) {
    const c = cases[i];
    const o = outcomes[i];
    if (c && o) pairs.push({ c, o });
  }
  return pairs;
}

/** Every over-fired false flag on the clean case must end clean for the case to be green. */
function computeCleanCaseGreen(pairs: Pair[]): boolean {
  const overfires = pairs.filter((p) => p.c.kind === 'over-fire');
  return overfires.length > 0 && overfires.every((p) => p.o.effectiveState === 'clean');
}

/**
 * The self-honesty foil: run the same candidates through a rubber-stamp critic
 * (always confirm) and confirm the harness would NOT pass it. A rubber-stamp
 * leaves the over-fires flagged and the underpowered split confirmed, so a
 * trustworthy harness reports it not ready.
 */
export async function rubberStampSelfTest(cases: CriticCase[]): Promise<CriticSelfTest> {
  const outcomes = await runCritic(rubberStampReasoner, cases, { realModelCalls: false });
  const pairs = zip(cases, outcomes);
  const green = computeCleanCaseGreen(pairs);
  const downgraded = pairs
    .filter((p) => p.c.kind === 'underpowered')
    .every((p) => p.o.verdict === 'downgrade');
  const rubberStampPasses = green && downgraded;
  return {
    name: 'rubber-stamp critic is caught',
    caught: !rubberStampPasses,
    detail: rubberStampPasses
      ? 'A rubber-stamp critic passed acceptance. The harness is decorative.'
      : 'A rubber-stamp critic failed to veto the over-fires and downgrade the underpowered split, so the harness rejects it.',
  };
}

/**
 * The fail-safe foil: a critic whose call always throws must leave genuine flags
 * shown (still flagged, marked unverified), never hidden.
 */
export async function failSafeSelfTest(cases: CriticCase[]): Promise<CriticSelfTest> {
  const outcomes = await runCritic(throwingReasoner, cases, { realModelCalls: false });
  const pairs = zip(cases, outcomes);
  const genuineShown = pairs
    .filter((p) => p.c.kind === 'genuine')
    .every((p) => p.o.effectiveState === 'flagged');
  return {
    name: 'a failed critic call fails safe toward showing',
    caught: genuineShown,
    detail: genuineShown
      ? 'When the critic call throws, genuine findings stay flagged (shown by default), never hidden.'
      : 'A failed critic call hid a genuine finding. Fail-safe is broken.',
  };
}

/** Assemble the graded actor-critic verification from outcomes + the self-tests. */
export function assembleVerification(
  model: string,
  cases: CriticCase[],
  outcomes: CriticFindingOutcome[],
  selfTests: CriticSelfTest[],
  requireRealCalls: boolean,
): CriticVerification {
  const pairs = zip(cases, outcomes);
  const allPassed = outcomes.length > 0 && outcomes.every((o) => o.passed);
  const cleanCaseGreen = computeCleanCaseGreen(pairs);
  const realModelCalls = outcomes.filter((o) => o.realModelCall).length;
  const realCallsComplete = realModelCalls === outcomes.length;
  const selfTestsCaught = selfTests.length > 0 && selfTests.every((t) => t.caught);
  const ready =
    allPassed && cleanCaseGreen && selfTestsCaught && (!requireRealCalls || realCallsComplete);
  return { ready, model, realModelCalls, cleanCaseGreen, outcomes, selfTests };
}
