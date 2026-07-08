import type { CheckId, CriticRequest } from '@redline/contracts';
import type { PromptPair } from './prompts.js';

/**
 * The critic's system prompt. The critic is the second, adversarial pass over a
 * candidate finding the deterministic actor already flagged. It fixes the output
 * contract (strict JSON that validates against CriticJudgment) and the standing
 * order: look for the reason this flag is wrong. Confirm only when the numbers
 * clearly warrant it; veto or downgrade when they do not.
 */
export const CRITIC_SYSTEM_PROMPT = [
  'You are the critic in Redline, a statistical-rigor auditor for single-cell RNA-seq.',
  'A deterministic check (the actor) has already produced a candidate finding: a FLAG on a',
  "scientist's analysis, with the numbers behind it. You are the independent second pass.",
  '',
  'Your job is adversarial. Decide whether this flag is actually warranted, or whether the',
  'check over-fired. Read the numbers and look for the reason the flag is WRONG. You can and',
  'should overturn a flag the numbers do not support. A critic that confirms everything is',
  'worse than no critic, because it fakes rigor. A critic that vetoes a real problem is worse',
  'still, because it hides it. Rule on the numbers in front of you, nothing else.',
  '',
  'Return ONLY a single JSON object. No text around it, no markdown fences. Fields:',
  '  verdict:       "confirm" | "downgrade" | "veto".',
  '    confirm   -> the flag is warranted; the finding stays flagged.',
  '    downgrade -> the flag rests on a borderline or underpowered test; lower it to a soft',
  '                 advisory, still shown, with your reason. Use this when the signal is weak',
  '                 or the test lacks the power to support a hard finding.',
  '    veto      -> the numbers do not support the flag; suppress it and report the check',
  '                 clean for this item. Use this when the flag is a mis-read of the design.',
  '  keys_on:       the specific number or field you ruled on, quoted from the evidence',
  '                 (for example "honestP=4.8e-06" or "held-out cells=14"). Never vague.',
  '  justification: one plain sentence on why the flag is or is not warranted.',
  '  confidence:    "high" | "medium" | "low".',
  '',
  'Style: plain, direct, concrete English. No em dashes. No "not X, but Y" phrasing. Report',
  'the number and say what it means.',
].join('\n');

interface CriticRemit {
  title: string;
  remit: string;
}

/**
 * The per-check remit: what the critic weighs for each pillar, and the concrete
 * conditions under which it should veto or downgrade rather than confirm. Grounded
 * in the same statistics the actor computed, so the ruling keys on real numbers.
 */
const CRITIC_REMIT: Record<CheckId, CriticRemit> = {
  1: {
    title: 'Pseudoreplication (unit of analysis)',
    remit: [
      'The actor flagged the cell-level test as pseudoreplicated because the honest,',
      'replicate-level test was not significant. Weigh three things: is the replicate unit',
      'the right one for this design, is n truly the count of independent replicates, and is',
      'the effect genuinely gone at the replicate level or just under the threshold. Use',
      'alpha = 0.05 as the significance threshold unless the evidence names another alpha.',
      'VETO if the honest or pseudobulk p-value is itself significant (below 0.05), because',
      'then the effect survives the replicate-level test and this is not pseudoreplication',
      '(the actor mis-identified the replicate). DOWNGRADE if the honest p sits just above',
      'alpha (roughly 0.05 to 0.15) on very few replicates, where the collapse is as much low',
      'power as a real null. CONFIRM when the naive p is tiny, the honest p is clearly above',
      '0.05, and n is a small number of real biological replicates.',
    ].join(' '),
  },
  2: {
    title: 'Double dipping (selective inference after clustering)',
    remit: [
      'The actor flagged the markers because their separation collapsed on a held-out split.',
      'Weigh whether the held-out drop is real separation loss or an artifact of an',
      'underpowered split. DOWNGRADE if the held-out half is small (too few cells) or the',
      'marker count is tiny, because then a low held-out AUC is expected from noise, not from',
      'the group being spurious. VETO if the held-out AUC actually stays high (the markers',
      'hold out of sample). CONFIRM when the held-out AUC drops toward chance on an adequately',
      'sized held-out half. This is evidence about robustness, never a certified FDR',
      'correction.',
    ].join(' '),
  },
  3: {
    title: 'Cluster stability across resolution',
    remit: [
      'The actor flagged the tracked group as a resolution artifact because it was a discrete',
      'cluster in only a narrow window of the resolution sweep. The stability is the fraction',
      'of swept settings where the group is a discrete cluster: 0 means it never forms, 1 means',
      'it forms at every setting, and the settings count out of totalSettings says the same.',
      'A high stability means the group is a stable cluster, so the fragility flag is wrong.',
      'VETO when stability is high (roughly 0.8 or above, present in most or all settings).',
      'CONFIRM when stability is low and the group appears only at a boundary or in a thin',
      'window, so the claim depends on that arbitrary setting. DOWNGRADE in the middle, or when',
      'the sweep range or step is too coarse or too narrow to trust.',
    ].join(' '),
  },
  4: {
    title: 'Technical confounding',
    remit: [
      "The actor flagged the comparison as confounded because the grouping and a technical",
      "variable are collinear (high Cramer's V or a rank-deficient design). Weigh whether the",
      'overlap is total or partial. CONFIRM when the collinearity is total (V at or near 1.00,',
      'or the design is rank deficient), because then the biological and technical effects',
      'cannot be separated at all. DOWNGRADE when the overlap is partial, since a qualified',
      'conclusion may still hold with the technical variable in the model. VETO if the',
      "variables are in fact separable (low Cramer's V, full-rank design).",
    ].join(' '),
  },
};

function formatEvidence(evidence: CriticRequest['evidence']): string {
  const lines = Object.entries(evidence).map(
    ([label, value]) => `  ${label}: ${String(value)}`,
  );
  return lines.length > 0 ? lines.join('\n') : '  (none provided)';
}

/** Build the strict critic prompt for one candidate finding. */
export function buildCriticPrompt(req: CriticRequest): PromptPair {
  const guide = CRITIC_REMIT[req.checkId];
  const context: string[] = [
    `Check ${req.checkId}: ${guide.title}`,
    `Dataset: ${req.datasetTitle}`,
    `Actor verdict: ${req.computeState} (a candidate flag awaiting your ruling)`,
    `Claim under audit: "${req.claim}"`,
  ];
  if (req.method) context.push(`Method that ran: ${req.method}`);
  if (req.design) context.push(`Resolved design: ${req.design}`);
  if (req.checkReasoning) context.push(`The check's own reason: ${req.checkReasoning}`);

  const user = [
    ...context,
    '',
    'Evidence (the numbers behind the flag):',
    formatEvidence(req.evidence),
    '',
    guide.remit,
    '',
    'Rule on this flag now. Return the JSON object.',
  ].join('\n');
  return { system: CRITIC_SYSTEM_PROMPT, user };
}
