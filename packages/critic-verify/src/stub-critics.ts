import type { CriticConfidence, CriticJudgment, CriticRequest, CriticVerdict } from '@redline/contracts';
import type { Reasoner } from '@redline/reasoning';

/**
 * Offline stand-in critics for the deterministic tests. These prove the harness
 * mechanics (the runner threads a ruling through the gate, computes green, and
 * catches a rubber-stamp) WITHOUT a network call. The real model's judgment is
 * proven separately by the live leg (`verify.ts`), which uses a real Bedrock
 * reasoner. A stand-in is never used to claim the product's critic works.
 */

const nope = async (): Promise<never> => {
  throw new Error(
    'narrate / proposeFields / extractClaims / mapClaim are not used by the critic harness',
  );
};

/** Wrap a critique function as a full Reasoner (available, bedrock-shaped source). */
export function reasonerFrom(
  critique: (req: CriticRequest) => Promise<CriticJudgment>,
): Reasoner {
  return {
    available: true,
    backend: 'bedrock',
    narrate: nope,
    proposeFields: nope,
    extractClaims: nope,
    mapClaim: nope,
    critique,
  };
}

function j(
  verdict: CriticVerdict,
  keys_on: string,
  justification: string,
  confidence: CriticConfidence,
): CriticJudgment {
  return { verdict, keys_on, justification, confidence };
}

function num(evidence: CriticRequest['evidence'], key: string): number {
  const v = evidence[key];
  return typeof v === 'number' ? v : Number(v);
}

/**
 * A rule-based critic that encodes the documented per-check remit as code. It is a
 * competent-critic stand-in: it vetoes a flag the numbers contradict and downgrades
 * an underpowered one. Used to prove the runner + gate produce the right effective
 * verdicts and green offline. It is NOT the product's critic.
 */
export const ruleBasedReasoner: Reasoner = reasonerFrom(async (req) => {
  const e = req.evidence;
  switch (req.checkId) {
    case 1: {
      const honestP = num(e, 'honestP');
      if (Number.isFinite(honestP) && honestP < 0.05) {
        return j('veto', `honestP=${e.honestP}`, 'The honest p is significant, so the effect survives the replicate-level test.', 'high');
      }
      return j('confirm', `honestP=${e.honestP}`, 'The honest p is not significant, so the cell-level significance does not survive the replicate-level test.', 'high');
    }
    case 2: {
      const hold = num(e, 'holdAUC');
      const cells = num(e, 'Held-out cells');
      if (Number.isFinite(hold) && hold >= 0.62) {
        return j('veto', `holdAUC=${e.holdAUC}`, 'The markers still separate the group on the held-out half.', 'high');
      }
      if (Number.isFinite(cells) && cells < 20) {
        return j('downgrade', `Held-out cells=${e['Held-out cells']}`, 'The held-out half is too small to tell a real collapse from noise.', 'medium');
      }
      return j('confirm', `holdAUC=${e.holdAUC}`, 'The markers collapse on an adequately sized held-out half.', 'high');
    }
    case 3: {
      const stab = num(e, 'stability');
      if (Number.isFinite(stab) && stab >= 0.8) {
        return j('veto', `stability=${e.stability}`, 'The group is a discrete cluster across most of the sweep.', 'high');
      }
      return j('confirm', `stability=${e.stability}`, 'The group forms a cluster in only a narrow window of the sweep.', 'high');
    }
    case 4: {
      const v = num(e, 'cramersV');
      const separable = e['Separable'] === 'yes';
      if (separable || (Number.isFinite(v) && v < 0.9)) {
        return j('veto', `cramersV=${e.cramersV}`, 'The grouping and the technical variable are separable.', 'high');
      }
      return j('confirm', `cramersV=${e.cramersV}`, 'The grouping and the technical variable are collinear and cannot be separated.', 'high');
    }
  }
  return j('confirm', '', 'No remit for this check; the flag is shown by default.', 'low');
});

/**
 * The self-honesty foil: a critic that rubber-stamps every flag as confirm. The
 * harness must catch this (it fails to veto the over-fires and to downgrade the
 * underpowered split). A harness that passes a rubber-stamp is decorative.
 */
export const rubberStampReasoner: Reasoner = reasonerFrom(async () =>
  j('confirm', 'n/a', 'Looks fine to me.', 'high'),
);

/** A critic whose call always throws, to exercise the fail-safe (critic-unverified) path. */
export const throwingReasoner: Reasoner = reasonerFrom(async () => {
  throw new Error('backend exploded');
});
