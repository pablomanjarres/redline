import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CheckId, CriticRequest, CriticVerdict } from '@redline/contracts';

/**
 * The candidate findings the critic is graded on. Two kinds:
 *
 * - **genuine** flags lifted straight from the committed oracle answer key over the
 *   Case A and Case B foils (real actor output). A competent critic must CONFIRM
 *   these: the numbers clearly warrant the flag.
 * - **adversarial** injections that a competent critic must overturn:
 *   - **over-fire** flags on the clean Case C foil (the actor wrongly flagged a
 *     finding whose numbers are clean). The critic must VETO each, which is what
 *     produces green on the never-cry-wolf case.
 *   - an **underpowered** double-dipping split where the held-out half is tiny, so
 *     the marker collapse is a power artifact rather than real separation loss. The
 *     critic must DOWNGRADE it, not confirm.
 *
 * The genuine numbers come from the oracle so the harness is grounded in the real
 * actor, not a re-encoding of the answer. The adversarial numbers are grounded in
 * the same foils (Case C is genuinely clean; the underpowered split uses a
 * realistically tiny held-out count).
 */

export type CriticCaseKind = 'genuine' | 'over-fire' | 'underpowered';

export interface CriticCase {
  caseId: 'A' | 'B' | 'C' | 'D';
  checkId: CheckId;
  label: string;
  kind: CriticCaseKind;
  expected: CriticVerdict;
  request: CriticRequest;
}

interface OracleCheck1 {
  naiveP: number | null;
  honestP: number | null;
  n: number;
  icc: number | null;
  perGroup?: number;
  verdict: string;
}
interface OracleCheck2 {
  discAUC: number | null;
  holdAUC: number | null;
  markersHolding: number;
  nMarkers: number;
  verdict: string;
}
interface OracleCheck3Track {
  group: string;
  stability: number | null;
  settings: number;
  totalSettings: number;
  presentRange: [number | null, number | null];
  verdict: string;
}
interface OracleCase {
  caseId: string;
  checks: {
    '1': OracleCheck1;
    '2': OracleCheck2 & Record<string, unknown>;
    '3': { spurious: OracleCheck3Track; stable?: OracleCheck3Track } & Record<string, unknown>;
    '4': { cramersV: number | null; rankDeficient: boolean; separable: boolean; verdict: string };
  };
}

function loadOracle(caseId: 'A' | 'B' | 'C'): OracleCase {
  const url = new URL(`../fixtures/oracle/${caseId}.json`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as OracleCase;
}

// The resolved design per foil, so the critic can judge whether the unit is right.
const DESIGN: Record<'A' | 'B' | 'C', string> = {
  A: 'unit=donor_id, grouping=condition, nuisance=lane, derived=cell_state',
  B: 'unit=patient, grouping=treatment, nuisance=batch, derived=cell_state',
  C: 'unit=donor, grouping=condition, nuisance=batch, derived=cell_state',
};

const DATASET: Record<'A' | 'B' | 'C', string> = {
  A: 'CD4+ T cells · IL2RA knockdown vs non-targeting · Perturb-seq',
  B: 'Cortical cells · psilocybin vs vehicle · single-cell RNA-seq',
  C: 'Reference cells · treated vs control · single-cell RNA-seq (clean)',
};

// Held-out cell counts for the count-split pillar, from the foil sizes. Case A is
// 4 donors x 280 cells, Case C is 6 donors x 190; the held-out half is about half.
const HELDOUT: Record<'A' | 'B' | 'C', number> = { A: 560, B: 570, C: 570 };

/**
 * This harness grades the four founding pillars, the checks with a hand-built
 * oracle. The rigor checks (5 to 8) the correction layer added have their own
 * coverage; a case here would need an oracle this file does not carry. The key
 * type is derived from METHOD so the compiler holds the harness to the ids it
 * actually has methods for, rather than every registered CheckId.
 */
const METHOD = {
  1: 'pseudobulk aggregation to the replicate unit, Welch t on per-unit means',
  2: 'Poisson count-split, held-out marker AUC',
  3: 'Leiden resolution sweep, cluster persistence across settings',
  4: "design-matrix rank and Cramer's V on the resolved columns",
} as const;

/** The check ids this harness builds oracle cases for. */
type CoreCheckId = keyof typeof METHOD;

/** Semantic evidence, as the oracle reports it. Rewritten below into the shape
 *  the app actually sends. */
type RawEvidence = Record<string, number | string | boolean | null | undefined>;

const num = (v: unknown): number => Number(v ?? 0);
const pval = (v: unknown): string => {
  const n = num(v);
  return n !== 0 && Math.abs(n) < 1e-4 ? n.toExponential(1) : String(n);
};

/**
 * Rewrite the oracle's evidence into the exact shape `POST /api/audit/check`
 * hands the critic: `computeEvidence` merges the stat labels the card displays
 * with the chart's own camelCase fields.
 *
 * The harness used to invent its own keys (`heldoutCells`, `separable`,
 * `markersHolding`), none of which the route ever sends. A green run on a shape
 * production never builds proves nothing about production.
 */
function productionEvidence(checkId: CoreCheckId, e: RawEvidence): CriticRequest['evidence'] {
  const out: Record<string, string | number | boolean> = {};
  if (checkId === 1) {
    out['Naive p'] = pval(e.naiveP);
    out['Honest p'] = pval(e.honestP);
    out['True n'] = `${num(e.n)} donors`;
    if (e.icc != null) out['Intra-unit corr.'] = `ICC ${num(e.icc).toFixed(2)}`;
    Object.assign(out, { chartKind: 'significance', naiveP: num(e.naiveP), honestP: num(e.honestP), honestN: num(e.n) });
  } else if (checkId === 2) {
    out['Discovery AUC'] = num(e.discAUC).toFixed(2);
    out['Held-out AUC'] = num(e.holdAUC).toFixed(2);
    out['Markers holding'] = `${num(e.markersHolding)} / ${num(e.nMarkers)}`;
    if (e.heldoutCells != null) out['Held-out cells'] = String(num(e.heldoutCells));
    Object.assign(out, { chartKind: 'groups', discAUC: num(e.discAUC), holdAUC: num(e.holdAUC), markerCount: num(e.nMarkers) });
  } else if (checkId === 3) {
    out['Stability'] = `${Math.round(num(e.stability) * 100)}%`;
    Object.assign(out, { chartKind: 'fragility', stability: num(e.stability) });
  } else {
    out["Cramer's V"] = num(e.cramersV).toFixed(2);
    out['Separable'] = e.separable ? 'yes' : 'no';
    out['Design'] = e.rankDeficient ? 'rank deficient' : 'full rank';
    Object.assign(out, { chartKind: 'confound', cramersV: num(e.cramersV) });
  }
  return out as CriticRequest['evidence'];
}

function req(caseId: 'A' | 'B' | 'C', checkId: CoreCheckId, claim: string, evidence: RawEvidence): CriticRequest {
  return {
    checkId,
    computeState: 'flagged',
    claim,
    datasetTitle: DATASET[caseId],
    evidence: productionEvidence(checkId, evidence),
    method: METHOD[checkId],
    design: DESIGN[caseId],
  };
}

/** Build the full graded candidate set. */
export function buildCriticCases(): CriticCase[] {
  const A = loadOracle('A');
  const B = loadOracle('B');
  const C = loadOracle('C');
  const cases: CriticCase[] = [];

  // ── Genuine flags (Case A): the critic must confirm ─────────────────────────
  cases.push({
    caseId: 'A',
    checkId: 1,
    label: 'A · pseudoreplication (genuine)',
    kind: 'genuine',
    expected: 'confirm',
    request: req('A', 1, 'IL2RA knockdown significantly upregulates FOXP3 across CD4 T cells.', {
      naiveP: A.checks['1'].naiveP ?? 0,
      honestP: A.checks['1'].honestP ?? 1,
      n: A.checks['1'].n,
      icc: A.checks['1'].icc ?? 0,
    }),
  });
  cases.push({
    caseId: 'A',
    checkId: 2,
    label: 'A · double dipping (genuine)',
    kind: 'genuine',
    expected: 'confirm',
    request: req('A', 2, 'The Effector state is defined by a distinct marker program.', {
      discAUC: A.checks['2'].discAUC ?? 0,
      holdAUC: A.checks['2'].holdAUC ?? 0,
      markersHolding: A.checks['2'].markersHolding,
      nMarkers: A.checks['2'].nMarkers,
      heldoutCells: HELDOUT.A,
    }),
  });
  cases.push({
    caseId: 'A',
    checkId: 3,
    label: 'A · fragility, Effector (genuine)',
    kind: 'genuine',
    expected: 'confirm',
    request: req('A', 3, 'The Effector state is a distinct, reproducible cell state.', {
      stability: A.checks['3'].spurious.stability ?? 0,
      settings: A.checks['3'].spurious.settings,
      totalSettings: A.checks['3'].spurious.totalSettings,
      group: A.checks['3'].spurious.group,
    }),
  });
  cases.push({
    caseId: 'A',
    checkId: 4,
    label: 'A · confounding (genuine)',
    kind: 'genuine',
    expected: 'confirm',
    request: req('A', 4, 'The condition effect is a real biological difference.', {
      cramersV: A.checks['4'].cramersV ?? 0,
      rankDeficient: A.checks['4'].rankDeficient,
      separable: A.checks['4'].separable,
    }),
  });

  // ── Genuine flags (Case B, renamed columns): generalization ────────────────
  cases.push({
    caseId: 'B',
    checkId: 1,
    label: 'B · pseudoreplication (genuine, renamed columns)',
    kind: 'genuine',
    expected: 'confirm',
    request: req('B', 1, 'Psilocybin significantly changes GENEX across cortical cells.', {
      naiveP: B.checks['1'].naiveP ?? 0,
      honestP: B.checks['1'].honestP ?? 1,
      n: B.checks['1'].n,
      icc: B.checks['1'].icc ?? 0,
    }),
  });
  cases.push({
    caseId: 'B',
    checkId: 4,
    label: 'B · confounding (genuine, renamed columns)',
    kind: 'genuine',
    expected: 'confirm',
    request: req('B', 4, 'The treatment effect is a real biological difference.', {
      cramersV: B.checks['4'].cramersV ?? 0,
      rankDeficient: B.checks['4'].rankDeficient,
      separable: B.checks['4'].separable,
    }),
  });

  // ── Over-fire flags on the clean Case C: the critic must veto (→ green) ──────
  cases.push({
    caseId: 'C',
    checkId: 1,
    label: 'C · pseudoreplication (over-fired flag)',
    kind: 'over-fire',
    expected: 'veto',
    request: req('C', 1, 'The treated condition raises REAL1 across donors.', {
      naiveP: C.checks['1'].naiveP ?? 0,
      honestP: C.checks['1'].honestP ?? 1, // 4.8e-06: significant → effect survives pseudobulk
      n: C.checks['1'].n,
      icc: C.checks['1'].icc ?? 0,
    }),
  });
  cases.push({
    caseId: 'C',
    checkId: 2,
    label: 'C · double dipping (over-fired flag)',
    kind: 'over-fire',
    expected: 'veto',
    request: req('C', 2, 'The Rare state is defined by a distinct marker program.', {
      discAUC: C.checks['2'].discAUC ?? 0,
      holdAUC: C.checks['2'].holdAUC ?? 0, // 1.0: markers hold out of sample
      markersHolding: C.checks['2'].markersHolding,
      nMarkers: C.checks['2'].nMarkers,
      heldoutCells: HELDOUT.C,
    }),
  });
  cases.push({
    caseId: 'C',
    checkId: 3,
    label: 'C · fragility (over-fired flag)',
    kind: 'over-fire',
    expected: 'veto',
    request: req('C', 3, 'The Rare state is a distinct, reproducible cell state.', {
      stability: C.checks['3'].spurious.stability ?? 0, // 1.0: stable across the whole sweep
      settings: C.checks['3'].spurious.settings,
      totalSettings: C.checks['3'].spurious.totalSettings,
      group: C.checks['3'].spurious.group,
    }),
  });
  cases.push({
    caseId: 'C',
    checkId: 4,
    label: 'C · confounding (over-fired flag)',
    kind: 'over-fire',
    expected: 'veto',
    request: req('C', 4, 'The condition effect is a real biological difference.', {
      cramersV: C.checks['4'].cramersV ?? 0, // 0.03: separable
      rankDeficient: C.checks['4'].rankDeficient,
      separable: C.checks['4'].separable,
    }),
  });

  // ── The underpowered double-dipping split: the critic must downgrade ────────
  // A marker collapse on a held-out half of only 14 cells is a power artifact, not
  // evidence the group is spurious. This is the acceptance's borderline case.
  cases.push({
    caseId: 'C',
    checkId: 2,
    label: 'C · double dipping (underpowered split)',
    kind: 'underpowered',
    expected: 'downgrade',
    request: req('C', 2, 'A small subcluster is defined by its own marker program.', {
      discAUC: 0.74,
      holdAUC: 0.59, // just under the flag threshold
      markersHolding: 1,
      nMarkers: 2,
      heldoutCells: 14, // too small to trust the collapse
    }),
  });

  return cases;
}
