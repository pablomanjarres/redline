import { describe, expect, it } from 'vitest';
import { buildCriticCases, type CriticCase } from './cases.js';
import {
  assembleVerification,
  failSafeSelfTest,
  rubberStampSelfTest,
  runCritic,
} from './runner.js';
import { ruleBasedReasoner, rubberStampReasoner } from './stub-critics.js';
import type { CriticFindingOutcome } from '@redline/contracts';

/**
 * These prove the harness MECHANICS offline: given correct rulings, the runner and
 * gate produce green, the over-fires flip to clean, the underpowered split is
 * downgraded, and a rubber-stamp critic is caught. The real model's judgment is
 * proven by the live leg (`verify.ts`), not here.
 */

function pair(cases: CriticCase[], outcomes: CriticFindingOutcome[]) {
  return cases.map((c, i) => ({ c, o: outcomes[i]! }));
}

describe('critic acceptance mechanics (rule-based stand-in critic)', () => {
  it('confirms genuine flags, vetoes over-fires, downgrades the underpowered split', async () => {
    const cases = buildCriticCases();
    const outcomes = await runCritic(ruleBasedReasoner, cases, { realModelCalls: false });
    for (const o of outcomes) {
      expect(o.passed, `${o.label}: got ${o.verdict}, expected ${o.expected}`).toBe(true);
    }
  });

  it('flips every over-fired flag on the clean case to clean (green)', async () => {
    const cases = buildCriticCases();
    const outcomes = await runCritic(ruleBasedReasoner, cases, { realModelCalls: false });
    const overfires = pair(cases, outcomes).filter((x) => x.c.kind === 'over-fire');
    expect(overfires.length).toBeGreaterThan(0);
    for (const { o } of overfires) {
      expect(o.verdict).toBe('veto');
      expect(o.effectiveState).toBe('clean');
    }
  });

  it('downgrades the underpowered split rather than confirming it', async () => {
    const cases = buildCriticCases();
    const outcomes = await runCritic(ruleBasedReasoner, cases, { realModelCalls: false });
    const under = pair(cases, outcomes).find((x) => x.c.kind === 'underpowered');
    expect(under).toBeDefined();
    expect(under!.o.verdict).toBe('downgrade');
    expect(under!.o.effectiveState).toBe('flagged'); // lowered, not suppressed
  });

  it('assembles a ready verification when rulings are correct (real calls not required offline)', async () => {
    const cases = buildCriticCases();
    const outcomes = await runCritic(ruleBasedReasoner, cases, { realModelCalls: false });
    const selfTests = [await rubberStampSelfTest(cases), await failSafeSelfTest(cases)];
    const v = assembleVerification('offline-stub', cases, outcomes, selfTests, false);
    expect(v.cleanCaseGreen).toBe(true);
    expect(v.ready).toBe(true);
  });

  it('catches a rubber-stamp critic: it is not ready', async () => {
    const cases = buildCriticCases();
    const outcomes = await runCritic(rubberStampReasoner, cases, { realModelCalls: false });
    const selfTests = [await rubberStampSelfTest(cases)];
    const v = assembleVerification('rubber-stamp', cases, outcomes, selfTests, false);
    expect(v.ready).toBe(false);
  });

  it('the rubber-stamp self-test reports caught', async () => {
    const st = await rubberStampSelfTest(buildCriticCases());
    expect(st.caught).toBe(true);
  });

  it('the fail-safe self-test reports caught (genuine flags stay shown on a critic error)', async () => {
    const st = await failSafeSelfTest(buildCriticCases());
    expect(st.caught).toBe(true);
  });

  it('requires a real model call per finding when real calls are required', async () => {
    const cases = buildCriticCases();
    const outcomes = await runCritic(ruleBasedReasoner, cases, { realModelCalls: false });
    const selfTests = [await rubberStampSelfTest(cases), await failSafeSelfTest(cases)];
    const v = assembleVerification('offline-stub', cases, outcomes, selfTests, true);
    expect(v.ready).toBe(false); // stubs made no real calls
  });

  it('every candidate is a flagged finding carrying its numbers', () => {
    for (const c of buildCriticCases()) {
      expect(c.request.computeState).toBe('flagged');
      expect(Object.keys(c.request.evidence).length).toBeGreaterThan(0);
    }
  });
});
