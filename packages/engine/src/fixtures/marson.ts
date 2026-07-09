import type {
  Scenario,
  Claim,
  DatasetMeta,
  FieldSpec,
  CheckId,
  Check1Config,
  Check2Config,
  Check3Config,
  Check4Config,
  CheckConfigMap,
  UnitProfile,
} from '@redline/contracts';
import { buildSteps, cit, groupInt, iv, type FullCheck } from './shared.js';

// ---------------------------------------------------------------------------
// Scenario `marson` - the HERO (default). A naive-foil analysis constructed on
// the Marson/Pritchard CD4+ T-cell Perturb-seq data (Zhu, Dann et al. 2025). The
// published authors did their analysis rigorously; Redline audits the naive
// analysis a less-experienced scientist would run, never the authors' own work,
// and never implies they erred. All prose here is authored fresh under the voice
// rules: no em dashes, direct and concrete. (En dashes appear only inside numeric
// ranges such as 0.8-1.2, which is standard typography, not prose punctuation.)
// ---------------------------------------------------------------------------

const dataset: DatasetMeta = {
  file: 'cd4_tcell_perturbseq_subset.h5ad',
  label: 'cd4_tcell_perturbseq_subset',
  title: 'CD4+ T cells · IL2RA knockdown vs non-targeting · Perturb-seq',
  cells: 51842,
  genes: 3200,
  replicates: 4,
  replicateLabel: 'donors',
  fieldCount: 9,
  sizeGB: 2.4,
};

const claims: Claim[] = [
  {
    id: 'c1',
    text: 'IL2RA knockdown significantly upregulates FOXP3 across CD4 T cells (p < 0.001).',
    check: 1,
  },
  {
    id: 'c2',
    text: 'An activated Treg-like state defined by 4 markers, enriched under knockdown.',
    check: 2,
  },
  { id: 'c3', text: 'A distinct knockdown-responsive T-cell state.', check: 3 },
  {
    id: 'c4',
    text: 'Differential expression between knockdown and non-targeting control.',
    check: 4,
  },
];

const fields: FieldSpec[] = [
  {
    id: 'donor_id',
    dtype: 'categorical',
    levels: 4,
    missing: 0,
    sample: 'D1 · D2 · D3 · D4',
    role: 'unit',
    confidence: 'high',
    reason:
      '4 unique values. The perturbation is delivered per donor and cells are nested inside it, so this is the true replicate.',
  },
  {
    id: 'condition',
    dtype: 'categorical',
    levels: 2,
    missing: 0,
    sample: 'IL2RA-KD · non-targeting',
    role: 'grouping',
    confidence: 'high',
    reason: 'Two levels. This is the contrast your analysis compares.',
  },
  {
    id: 'cell_barcode',
    dtype: 'identifier',
    levels: 51842,
    missing: 0,
    role: 'observation',
    confidence: 'high',
    reason: 'One per row, ~13,000 per donor. Rows are measurements, not independent samples.',
  },
  {
    id: 'lane',
    dtype: 'categorical',
    levels: 2,
    missing: 0,
    sample: 'Lane-A · Lane-B',
    role: 'nuisance',
    confidence: 'medium',
    reason:
      'Technical variable. Its two levels line up with condition, a possible confound flagged to Check 4.',
  },
  {
    id: 'guide_id',
    dtype: 'categorical',
    levels: 4,
    missing: 0,
    sample: 'IL2RA-g1 · IL2RA-g2 · NT-g1 · NT-g2',
    role: 'derived',
    confidence: 'medium',
    reason:
      'The CRISPR guide assignment. A finer grouping derived from the perturbation design, related to condition.',
  },
  {
    id: 'n_genes',
    dtype: 'numeric',
    levels: null,
    missing: 0,
    role: 'covariate',
    confidence: 'high',
    reason: 'Per-cell quality covariate.',
  },
  {
    id: 'pct_mito',
    dtype: 'numeric',
    levels: null,
    missing: 0,
    role: 'covariate',
    confidence: 'high',
    reason: 'Per-cell quality covariate.',
  },
  {
    id: 'leiden',
    dtype: 'categorical',
    levels: 14,
    missing: 0,
    role: 'derived',
    confidence: 'medium',
    reason: 'Cluster labels you computed. A derived grouping, not a measured field.',
  },
  {
    id: 'phase',
    dtype: 'categorical',
    levels: 3,
    missing: 0,
    sample: 'G1 · S · G2M',
    role: 'nuisance',
    confidence: 'low',
    reason:
      'Cell-cycle phase. Often balanced across condition, so it may not matter. Confirm whether to adjust for it or ignore it.',
  },
];

// donor -> UnitProfile[] (2 non-targeting, 2 knockdown; donor-level FOXP3 means).
// The four donor n's sum to 51,842, matching the naive cell count and the
// confound grid so every chart tells one coherent story.
const MAR_UNITS: UnitProfile[] = [
  { id: 'N1', group: 'non-targeting', n: 12904, value: 1.12 },
  { id: 'N2', group: 'non-targeting', n: 13011, value: 1.28 },
  { id: 'K1', group: 'knockdown', n: 12847, value: 1.19 },
  { id: 'K2', group: 'knockdown', n: 13080, value: 1.34 },
];

// CHECK 1 - a cell-level p-value collapses to non-significance across 4 donors.
function m1(cfg: Check1Config): FullCheck {
  const alpha = cfg.alpha;
  const naive = { n: 51842, p: 6.2e-11, log10p: 10.21, sig: true };
  const honest = { n: 4, p: 0.21, log10p: 0.68, sig: false };

  // The litter_id-analogue: a guide_batch with 2 levels, one per condition.
  if (cfg.unit === 'guide_batch') {
    return {
      checkId: 1,
      state: 'hard_stop',
      headline: 'No valid test is possible.',
      error: 'Too few independent units',
      citation: cit('c1', true),
      original: 'IL2RA knockdown significantly increased FOXP3 expression (p < 0.001).',
      corrected:
        '‘guide_batch’ has 2 values, one per condition. With no replication inside either group, no test can separate knockdown from that single batch. Assign a field with replicate units, or collect more.',
      stats: [
        { label: 'Independent units', value: '2' },
        { label: 'Per group', value: '1' },
        { label: 'Minimum needed', value: '≥ 3 / group' },
      ],
      chart: { kind: 'hardstop', units: 2, perGroup: 1, profiles: MAR_UNITS },
    };
  }

  const badUnit = cfg.unit === 'cell_barcode';
  return {
    checkId: 1,
    state: 'flagged',
    headline: badUnit
      ? 'The significant result comes from counting cells, not donors.'
      : 'The significant result does not survive an honest re-test.',
    error: 'Fake significance from non-independent data (pseudoreplication)',
    citation: cit('c1', true),
    original: 'IL2RA knockdown significantly increased FOXP3 expression (p < 0.001, n = 51,842).',
    corrected:
      "IL2RA knockdown did not significantly change FOXP3 expression at the donor level (Welch's t, p = 0.21, n = 4 donors). The original p-value counts 51,842 correlated cells as independent replicates.",
    stats: [
      { label: 'Original p', value: '6.2×10⁻¹¹', bad: true },
      { label: 'Honest p (donor-level)', value: '0.21' },
      { label: 'True n', value: '4 donors' },
      { label: 'Intra-donor corr.', value: 'ICC 0.19' },
    ],
    chart: { kind: 'significance', naive, honest, alpha, units: MAR_UNITS, badUnit },
  };
}

// CHECK 2 - a spurious "Activated Treg-like" state; 0 of 4 markers survive.
function m2(cfg: Check2Config): FullCheck {
  const markers = [
    { gene: 'TNFRSF9', disc: 0.9, hold: 0.57 },
    { gene: 'ICOS', disc: 0.88, hold: 0.55 },
    { gene: 'TIGIT', disc: 0.87, hold: 0.6 },
    { gene: 'CTLA4', disc: 0.89, hold: 0.56 },
  ];
  const holdoutCells = Math.round(dataset.cells * cfg.split);

  if (cfg.split < 0.15) {
    return {
      checkId: 2,
      state: 'flag_only',
      headline: 'The held-out set is too small to validate the groups.',
      error: 'Could not verify, held-out split below minimum',
      citation: cit('c2', true),
      original: 'An activated Treg-like state defined by 4 markers, enriched under knockdown.',
      corrected:
        'At a ' +
        Math.round(cfg.split * 100) +
        '% split the held-out set is ' +
        groupInt(holdoutCells) +
        ' cells, under the 500-per-group minimum for a stable AUC. Raise the split to test whether the state replicates.',
      missing: 'Held-out set ≥ 500 cells per group.',
      stats: [
        { label: 'Held-out cells', value: groupInt(holdoutCells), bad: true },
        { label: 'Minimum', value: '≥ 1,000' },
      ],
      chart: { kind: 'groups', markers, split: cfg.split, verified: false },
    };
  }

  const discAUC = 0.9;
  const holdAUC = 0.57;
  // Distributions over 200 independent count-splits (illustrative reference; see
  // shared.ts `iv`). The held-out AUC lands near chance every split; discovery
  // stays high because the markers were chosen on those same cells.
  const holdDist = iv(0.57, 0.54, 0.61, 200);
  const discDist = iv(0.9, 0.87, 0.92, 200);
  const holdingDist = iv(0, 0, 1, 200);
  return {
    checkId: 2,
    state: 'flagged',
    headline: 'The group separates in the data it was defined on, and nowhere else.',
    error: 'Fake groups, separation does not replicate out of sample',
    citation: cit('c2', true),
    original: 'A distinct activated Treg-like state, defined by TNFRSF9, ICOS, TIGIT and CTLA4.',
    corrected:
      'On a held-out ' +
      Math.round((1 - cfg.split) * 100) +
      '/' +
      Math.round(cfg.split * 100) +
      ' split the four markers separate the group at AUC 0.57 (95% interval 0.54–0.61 over 200 splits), near chance. The state is an artifact of choosing the markers and the cluster on the same cells.',
    stats: [
      { label: 'Discovery AUC', value: discAUC.toFixed(2), interval: discDist },
      { label: 'Held-out AUC', value: holdAUC.toFixed(2), bad: true, interval: holdDist },
      { label: 'Markers holding', value: '0 / 4', interval: holdingDist },
    ],
    chart: {
      kind: 'groups',
      markers,
      split: cfg.split,
      verified: true,
      discAUC,
      holdAUC,
      holdAUCDist: holdDist,
      discAUCDist: discDist,
      markersHoldingDist: holdingDist,
    },
  };
}

// CHECK 3 - track "Effector" (spurious, res 0.8-1.2) -> flagged; "Naive" -> clean.
function m3(cfg: Check3Config): FullCheck {
  const isSpurious = cfg.track === 'Effector';
  const present: [number, number] = isSpurious ? [0.8, 1.2] : [0.0, 9.9];
  const steps0 = buildSteps(cfg.min, cfg.max, cfg.step, present);
  const nPresent = steps0.filter((s) => s.present).length;
  const stability = steps0.length ? nPresent / steps0.length : 0;
  const pct = Math.round(stability * 100);

  // Per-setting presence probability over 40 re-seeded sweeps (illustrative
  // reference): a present setting shows in most runs, its immediate neighbours
  // flicker, the rest almost never. A stable group is present nearly always.
  const presentP = isSpurious ? 0.82 : 0.97;
  const steps = steps0.map((s) => {
    const nearBand =
      !s.present &&
      (Math.abs(s.r - present[0]) <= cfg.step + 1e-9 || Math.abs(s.r - present[1]) <= cfg.step + 1e-9);
    return { ...s, presence: s.present ? presentP : nearBand ? 0.26 : 0.04 };
  });
  const stabilityDist = isSpurious ? iv(stability, 0.2, 0.45, 40) : iv(stability, 0.95, 1.0, 40);
  const sCI = Math.round(stabilityDist.lo * 100) + '–' + Math.round(stabilityDist.hi * 100) + '%';

  if (isSpurious) {
    return {
      checkId: 3,
      state: 'flagged',
      headline: 'The subcluster exists at one setting and disappears at the next.',
      error: 'Fragile conclusion, result depends on an arbitrary parameter',
      citation: cit('c3', true),
      original: 'A distinct knockdown-responsive T-cell state.',
      corrected:
        'The ‘Effector’ subcluster appears only at clustering resolution ' +
        present[0].toFixed(1) +
        '–' +
        present[1].toFixed(1) +
        ', ' +
        nPresent +
        ' of ' +
        steps.length +
        ' settings tested (stability ' +
        pct +
        '%, 95% interval ' +
        sCI +
        ' over 40 runs). It is a boundary of the algorithm, not a discrete population.',
      stats: [
        { label: 'Stability', value: pct + '%', bad: true, interval: stabilityDist },
        { label: 'Appears in', value: nPresent + ' / ' + steps.length + ' settings' },
        { label: 'Present range', value: present[0].toFixed(1) + '–' + present[1].toFixed(1) },
      ],
      chart: { kind: 'fragility', steps, present, track: cfg.track, stability, stabilityDist },
    };
  }

  return {
    checkId: 3,
    state: 'clean',
    headline: 'This grouping holds at every setting tested.',
    error: null,
    citation: cit('c3', true),
    original: null,
    corrected:
      'The ‘Naive’ T-cell group is present in ' +
      nPresent +
      ' of ' +
      steps.length +
      ' resolution settings (' +
      pct +
      '%, 95% interval ' +
      sCI +
      ' over 40 runs). It is stable to the clustering parameter and safe to report as a discrete population.',
    stats: [
      { label: 'Stability', value: pct + '%', good: true, interval: stabilityDist },
      { label: 'Appears in', value: nPresent + ' / ' + steps.length + ' settings' },
    ],
    chart: { kind: 'fragility', steps, present, track: cfg.track, stability, stabilityDist },
  };
}

// CHECK 4 - condition confounded with technical `lane` (KD on A, NT on B).
function m4(cfg: Check4Config): FullCheck {
  const hasLane = cfg.nuisance.indexOf('lane') !== -1;
  const grid = {
    rows: ['knockdown', 'non-targeting'],
    cols: ['Lane-A', 'Lane-B'],
    cells: [
      [25927, 0],
      [0, 25915],
    ],
  };

  if (!hasLane) {
    return {
      checkId: 4,
      state: 'flag_only',
      headline: 'You told Redline to ignore the one variable that aligns with condition.',
      error: 'Could not verify, nuisance variable excluded',
      citation: cit('c4', true),
      original: 'Differential expression between knockdown and non-targeting control.',
      corrected:
        "‘lane’ is not in the nuisance set, so confounding can't be assessed, yet its levels line up exactly with condition. Add it to test whether perturbation and lane can be separated.",
      missing: 'Add lane as a nuisance variable.',
      stats: [
        { label: 'Nuisance vars', value: String(cfg.nuisance.length) },
        { label: 'Assessed', value: 'no' },
      ],
      chart: { kind: 'confound', grid, cramersV: null, verified: false },
    };
  }

  return {
    checkId: 4,
    state: 'flagged',
    headline: 'Perturbation and sequencing lane are the same variable here.',
    error: 'Confounded comparison, effects are not separable',
    citation: cit('c4', true),
    original: 'Differential expression between knockdown and non-targeting reflects the perturbation.',
    corrected:
      "Every knockdown sample ran on Lane-A and every non-targeting sample on Lane-B (Cramér's V = 1.00). Any difference is perturbation or lane, the data cannot tell which. No perturbation effect can be claimed from this comparison.",
    stats: [
      { label: "Cramér's V", value: '1.00', bad: true },
      { label: 'Overlap', value: '0%' },
      { label: 'Separable', value: 'No' },
    ],
    chart: { kind: 'confound', grid, cramersV: 1.0, verified: true },
  };
}

function mr1(cfg: Check1Config): string[] {
  const lines = [
    'Reading grouping ‘condition’, IL2RA knockdown vs non-targeting.',
    'Counting independent units under ‘' + cfg.unit + '’.',
  ];
  if (cfg.unit === 'cell_barcode') {
    lines.push(
      '‘cell_barcode’ gives 51,842 units, but ~13,000 share each donor.',
      'Cells within a donor are correlated (ICC ≈ 0.19); they are not independent.',
      'Variance is underestimated, so the p-value is inflated.',
    );
  } else if (cfg.unit === 'guide_batch') {
    lines.push(
      '‘guide_batch’ resolves to 2 units, one per condition.',
      'No replication within either group. No valid test exists.',
    );
  } else {
    lines.push(
      '‘donor_id’ gives 4 units, 2 per group.',
      'Original test treated 51,842 cells as independent (ICC ≈ 0.19).',
      "Aggregating to 4 donor-level means and re-testing (Welch's t).",
    );
  }
  return lines;
}

function mr2(cfg: Check2Config): string[] {
  return [
    'Splitting cells into discovery / held-out at ' + Math.round(cfg.split * 100) + '%.',
    'Fitting the 4 claimed markers on discovery cells.',
    'Scoring the same markers on held-out cells they never saw.',
    'Comparing separation (AUC) between the two splits.',
  ];
}

function mr3(cfg: Check3Config): string[] {
  return [
    'Sweeping clustering resolution ' +
      cfg.min.toFixed(1) +
      '–' +
      cfg.max.toFixed(1) +
      ' (step ' +
      cfg.step.toFixed(1) +
      ').',
    'Re-clustering at each setting.',
    'Tracking the ‘' + cfg.track + '’ group across settings.',
    'Measuring how often it appears as a discrete cluster.',
  ];
}

function mr4(cfg: Check4Config): string[] {
  return [
    'Cross-tabulating ‘' + cfg.interest + '’ against nuisance variables.',
    "Measuring alignment (Cramér's V) for each.",
    'Testing whether the comparison can be separated from technical structure.',
  ];
}

export function marsonFull(checkId: CheckId, cfg: unknown): FullCheck {
  switch (checkId) {
    case 1:
      return m1(cfg as Check1Config);
    case 2:
      return m2(cfg as Check2Config);
    case 3:
      return m3(cfg as Check3Config);
    default:
      return m4(cfg as Check4Config);
  }
}

export function marsonReasoning(checkId: CheckId, cfg: unknown): string[] {
  switch (checkId) {
    case 1:
      return mr1(cfg as Check1Config);
    case 2:
      return mr2(cfg as Check2Config);
    case 3:
      return mr3(cfg as Check3Config);
    default:
      return mr4(cfg as Check4Config);
  }
}

export const MARSON_DEFAULTS: CheckConfigMap = {
  1: { unit: 'donor_id', grouping: 'condition', alpha: 0.05 },
  2: { split: 0.3, grouping: 'leiden' },
  3: { min: 0.2, max: 2.0, step: 0.2, track: 'Effector', scrub: 0.9 },
  4: { interest: 'condition', nuisance: ['lane'] },
};

export const marsonScenario: Scenario = {
  id: 'marson',
  name: 'IL2RA knockdown (CD4+ T cells)',
  dataset,
  claims,
  fields,
};
