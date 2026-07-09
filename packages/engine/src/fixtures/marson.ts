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
  Check5Config,
  Check6Config,
  Check7Config,
  Check8Config,
  CheckConfigMap,
  UnitProfile,
} from '@redline/contracts';
import {
  buildSteps,
  buildResolutionSteps,
  cit,
  fdr,
  groupInt,
  mkCode,
  rec,
  script1,
  script2,
  script3,
  script4,
  script5,
  script6,
  script7,
  script8,
  volcanoPair,
  type FullCheck,
} from './shared.js';

// ---------------------------------------------------------------------------
// Scenario `marson` - the HERO (default). A naive-foil analysis constructed on
// the Marson/Pritchard CD4+ T-cell Perturb-seq data (Zhu, Dann et al. 2025). The
// published authors did their analysis rigorously; Redline audits the naive
// analysis a less-experienced scientist would run, never the authors' own work,
// and never implies they erred. All prose here is authored fresh under the voice
// rules: no em dashes, direct and concrete. (En dashes appear only inside numeric
// ranges such as 0.8-1.2, which is standard typography, not prose punctuation.)
// ---------------------------------------------------------------------------

const H5AD = 'cd4_tcell_perturbseq_subset.h5ad';
const REF = 'non-targeting';
const ALT = 'IL2RA-KD';

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
      // Unsalvageable: n=1 per group. No honest re-analysis exists, so there is
      // no corrected code and the preview is the dead end (after = null).
      recommendations: [
        rec(
          'Collect a design with at least 3 replicate units per group.',
          '‘guide_batch’ resolves to 2 units, one per condition, so no test can separate the perturbation from that single batch.',
          'A valid donor-level differential-expression test becomes possible.',
          'needs_new_data',
          cit('c1', true),
        ),
      ],
      preview: {
        methodLabel: 'no valid test (n=1 per group)',
        unsalvageable: true,
        before: { kind: 'hardstop', units: 2, perGroup: 1, profiles: MAR_UNITS },
        after: null,
      },
    };
  }

  const badUnit = cfg.unit === 'cell_barcode';
  const p1 = {
    h5ad: H5AD,
    unit: 'donor_id',
    grouping: 'condition',
    ref: REF,
    alt: ALT,
    gene: 'FOXP3',
    covariates: ['n_genes', 'pct_mito'],
    alpha,
  };
  const v1 = volcanoPair('naive per-cell test, ~ condition', 'pseudobulk + PyDESeq2, ~ condition', alpha, 1.0, [
    { gene: 'FOXP3', fc: 0.9, before: 10.21, after: 0.68, sigBefore: true, sigAfter: false, claimed: true },
    { gene: 'IL2RA', fc: -1.4, before: 8.1, after: 2.0, sigBefore: true, sigAfter: true },
    { gene: 'CTLA4', fc: 0.7, before: 6.4, after: 0.5, sigBefore: true, sigAfter: false },
    { gene: 'IKZF2', fc: 0.5, before: 4.2, after: 0.3, sigBefore: true, sigAfter: false },
    { gene: 'TNFRSF18', fc: 0.3, before: 3.1, after: 0.2, sigBefore: true, sigAfter: false },
    { gene: 'SELL', fc: -0.2, before: 1.2, after: 0.4, sigBefore: false, sigAfter: false },
  ]);
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
    correctedCode: mkCode('01_pseudoreplication.py', script1(p1), p1),
    recommendations: [
      rec(
        'Aggregate cells to donor_id and re-test with pseudobulk (PyDESeq2).',
        'The per-cell p-value (6.2e-11) treats 51,842 correlated cells as independent; at the donor level (n=4) the effect is p = 0.21.',
        'FOXP3 drops below significance; only the directly perturbed IL2RA remains.',
        'fixable_now',
        cit('c1', true),
      ),
    ],
    preview: {
      methodLabel: 'pseudobulk + PyDESeq2',
      unsalvageable: false,
      before: v1.before,
      after: v1.after,
    },
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
  const p2 = {
    h5ad: H5AD,
    grouping: 'leiden',
    target_group: 'Activated-Treg',
    markers: ['TNFRSF9', 'ICOS', 'TIGIT', 'CTLA4'],
    split: cfg.split,
    seed: 0,
  };
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
      ' split the four markers separate the group at AUC 0.57, near chance. The state is an artifact of choosing the markers and the cluster on the same cells.',
    stats: [
      { label: 'Discovery AUC', value: discAUC.toFixed(2) },
      { label: 'Held-out AUC', value: holdAUC.toFixed(2), bad: true },
      { label: 'Markers holding', value: '0 / 4' },
    ],
    chart: { kind: 'groups', markers, split: cfg.split, verified: true, discAUC, holdAUC },
    correctedCode: mkCode('02_double_dipping.py', script2(p2), p2),
    recommendations: [
      rec(
        'Validate the markers on cells held out from the clustering.',
        'The four markers separate the group at AUC 0.90 on the cells they were chosen on and 0.57 (near chance) on held-out cells.',
        'The activated Treg-like state does not survive out of sample.',
        'fixable_now',
        cit('c2', true),
      ),
      rec(
        'Use ClusterDE for a calibrated test of the cluster.',
        'Count splitting is evidence, not a certified FDR correction. ClusterDE is the stronger method.',
        'A false-discovery-controlled marker set for the claimed state.',
        'fixable_now',
        cit('c2', true),
      ),
    ],
    preview: {
      methodLabel: 'held-out marker test (count split)',
      caveat: 'Count splitting is evidence, not a certified FDR correction. ClusterDE is the stronger method.',
      unsalvageable: false,
      before: { kind: 'groups', markers, split: cfg.split, verified: true, discAUC },
      after: { kind: 'groups', markers, split: cfg.split, verified: true, discAUC, holdAUC },
    },
  };
}

// CHECK 3 - track "Effector" (spurious, res 0.8-1.2) -> flagged; "Naive" -> clean.
function m3(cfg: Check3Config): FullCheck {
  const present: [number, number] = cfg.track === 'Effector' ? [0.8, 1.2] : [0.0, 9.9];
  const steps = buildSteps(cfg.min, cfg.max, cfg.step, present);
  const nPresent = steps.filter((s) => s.present).length;
  const stability = steps.length ? nPresent / steps.length : 0;
  const pct = Math.round(stability * 100);

  if (cfg.track === 'Effector') {
    const p3 = {
      h5ad: H5AD,
      track: 'Effector',
      track_column: 'leiden',
      min: cfg.min,
      max: cfg.max,
      step: cfg.step,
      seed: 0,
    };
    const stableSteps = buildSteps(cfg.min, cfg.max, cfg.step, [0.0, 9.9]);
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
        ' settings tested (' +
        pct +
        '%). It is a boundary of the algorithm, not a discrete population.',
      stats: [
        { label: 'Stability', value: pct + '%', bad: true },
        { label: 'Appears in', value: nPresent + ' / ' + steps.length + ' settings' },
        { label: 'Present range', value: present[0].toFixed(1) + '–' + present[1].toFixed(1) },
      ],
      chart: { kind: 'fragility', steps, present, track: cfg.track, stability },
      correctedCode: mkCode('03_fragility.py', script3(p3), p3),
      recommendations: [
        rec(
          'Report the cluster stability across resolutions, or drop the subcluster.',
          "The 'Effector' subcluster appears in only " +
            nPresent +
            ' of ' +
            steps.length +
            ' resolution settings and is absent elsewhere.',
          'The knockdown-responsive state is reported as a clustering artifact, not a population.',
          'fixable_now',
          cit('c3', true),
        ),
      ],
      preview: {
        methodLabel: 'cluster-stability report',
        unsalvageable: false,
        before: { kind: 'fragility', steps, present, track: cfg.track, stability },
        after: {
          kind: 'fragility',
          steps: stableSteps,
          present: [cfg.min, cfg.max],
          track: 'CD4 T (stable parent)',
          stability: 1,
        },
      },
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
      '%). It is stable to the clustering parameter and safe to report as a discrete population.',
    stats: [
      { label: 'Stability', value: pct + '%', good: true },
      { label: 'Appears in', value: nPresent + ' / ' + steps.length + ' settings' },
    ],
    chart: { kind: 'fragility', steps, present, track: cfg.track, stability },
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

  const p4 = { h5ad: H5AD, interest: 'condition', technical: 'lane', separable: false };
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
    // Unsalvageable: a full confound. The corrected code proves the dead end
    // (it prints unsalvageable), and the preview carries no corrected artifact.
    correctedCode: mkCode('04_confounding.py', script4(p4), p4),
    recommendations: [
      rec(
        'Do not report a perturbation effect from this comparison.',
        "Every knockdown sample ran on Lane-A and every non-targeting sample on Lane-B (Cramér's V = 1.00), so the two variables are one split.",
        'The confounded contrast is withdrawn rather than reported.',
        'unsalvageable',
        cit('c4', true),
      ),
      rec(
        'Collect a design where condition and lane vary independently.',
        'With perturbation balanced across lanes, the lane effect can be separated from the perturbation effect.',
        'A separable effect that a model can estimate.',
        'needs_new_data',
        cit('c4', true),
      ),
    ],
    preview: {
      methodLabel: 'no separable effect (full confound)',
      caveat: 'Condition and lane are one split. No model can attribute a difference to the perturbation.',
      unsalvageable: true,
      before: { kind: 'confound', grid, cramersV: 1.0, verified: true },
      after: null,
    },
  };
}

// CHECK 5 - significance claimed on raw p-values across ~2,000 genes.
function m5(cfg: Check5Config): FullCheck {
  const alpha = cfg.alpha;
  const method = cfg.method;
  const p5 = {
    h5ad: H5AD,
    unit: 'donor_id',
    grouping: 'condition',
    ref: REF,
    alt: ALT,
    alpha,
    method,
    tests: 2000,
  };
  const top = [
    { gene: 'IL2RA', p: 2e-8, q: 4e-5, survives: true },
    { gene: 'CTLA4', p: 1e-5, q: 0.004, survives: true },
    { gene: 'FOXP3', p: 3e-4, q: 0.06, survives: false },
    { gene: 'IKZF2', p: 2e-3, q: 0.11, survives: false },
    { gene: 'TNFRSF9', p: 4e-3, q: 0.14, survives: false },
  ];
  const v5 = volcanoPair('raw p, ~2,000 genes', method.toUpperCase() + ' at q < ' + alpha, alpha, 1.0, [
    { gene: 'IL2RA', fc: -1.4, before: 7.7, after: 4.4, sigBefore: true, sigAfter: true, claimed: true },
    { gene: 'CTLA4', fc: 0.7, before: 5.0, after: 2.4, sigBefore: true, sigAfter: true },
    { gene: 'FOXP3', fc: 0.9, before: 3.5, after: 1.2, sigBefore: true, sigAfter: false, claimed: true },
    { gene: 'IKZF2', fc: 0.4, before: 2.7, after: 0.96, sigBefore: true, sigAfter: false },
    { gene: 'TNFRSF9', fc: 0.3, before: 2.4, after: 0.85, sigBefore: true, sigAfter: false },
    { gene: 'SELL', fc: -0.1, before: 0.6, after: 0.3, sigBefore: false, sigAfter: false },
  ]);
  return {
    checkId: 5,
    state: 'flagged',
    headline: 'Significance was claimed on raw p-values across roughly 2,000 genes.',
    error: 'Uncorrected multiple testing',
    citation: cit('c5', true),
    original: '412 genes are differentially expressed between knockdown and non-targeting (p < 0.05).',
    corrected:
      'Of 412 genes significant on raw p, 23 survive Benjamini-Hochberg control at q < ' +
      alpha +
      ' across 2,000 tests. The other 389 are expected false positives at this test count.',
    stats: [
      { label: 'Raw hits', value: '412', bad: true },
      { label: 'Survive BH (q<' + alpha + ')', value: '23' },
      { label: 'Tests', value: '2,000' },
    ],
    chart: fdr(2000, alpha, 412, 23, method, top),
    correctedCode: mkCode('05_multiple_testing.py', script5(p5), p5),
    recommendations: [
      rec(
        'Apply Benjamini-Hochberg across all 2,000 tested genes.',
        '412 genes pass a raw p threshold; only 23 survive FDR control at q < ' + alpha + '.',
        'The differential-expression list shrinks from 412 to 23 defensible genes.',
        'fixable_now',
        cit('c5', true),
      ),
    ],
    preview: {
      methodLabel: 'Benjamini-Hochberg (BH)',
      unsalvageable: false,
      before: v5.before,
      after: v5.after,
    },
  };
}

// CHECK 6 - a separable covariate (phase) left out of the model.
function m6(cfg: Check6Config): FullCheck {
  const alpha = cfg.alpha;
  const naive = { n: 4, p: 0.008, log10p: 2.1, sig: true };
  const honest = { n: 4, p: 0.09, log10p: 1.05, sig: false };
  const p6 = {
    h5ad: H5AD,
    interest: 'condition',
    covariate: 'phase',
    ref: REF,
    alt: ALT,
    unit: 'donor_id',
    alpha,
  };
  const v6 = volcanoPair('~ condition', '~ condition + phase', alpha, 1.0, [
    { gene: 'FOXP3', fc: 0.9, before: 2.1, after: 1.05, sigBefore: true, sigAfter: false, claimed: true },
    { gene: 'IL2RA', fc: -1.4, before: 4.0, after: 3.4, sigBefore: true, sigAfter: true },
    { gene: 'MKI67', fc: 0.6, before: 3.2, after: 0.4, sigBefore: true, sigAfter: false },
    { gene: 'TOP2A', fc: 0.5, before: 2.8, after: 0.3, sigBefore: true, sigAfter: false },
    { gene: 'CTLA4', fc: 0.4, before: 1.6, after: 0.9, sigBefore: true, sigAfter: false },
  ]);
  return {
    checkId: 6,
    state: 'flagged',
    headline: 'A separable batch variable (phase) was left out of the model.',
    error: 'Unmodeled separable covariate',
    citation: cit('c6'),
    original: 'Knockdown changes the activation program (p = 0.008), adjusting for nothing else.',
    corrected:
      "Cell-cycle ‘phase’ is separable from condition (Cramér's V = 0.31) and shifts the estimate. With phase in the model the condition effect is p = 0.09, no longer significant at " +
      alpha +
      '. Phase belongs in the model.',
    stats: [
      { label: 'Effect p (no covariate)', value: '0.008', bad: true },
      { label: 'Effect p (+ phase)', value: '0.09' },
      { label: 'phase vs condition', value: "Cramér's V 0.31" },
    ],
    chart: { kind: 'significance', naive, honest, alpha, units: MAR_UNITS, badUnit: false },
    correctedCode: mkCode('06_unmodeled_covariate.py', script6(p6), p6),
    recommendations: [
      rec(
        'Add phase as a covariate in the donor-level model.',
        "phase is separable from condition (Cramér's V = 0.31) and moves the effect from p = 0.008 to p = 0.09.",
        'The condition effect is reported with phase controlled, and is no longer significant.',
        'fixable_now',
        cit('c6'),
      ),
    ],
    preview: {
      methodLabel: 'pseudobulk + PyDESeq2, ~ condition + phase',
      unsalvageable: false,
      before: v6.before,
      after: v6.after,
    },
  };
}

// CHECK 7 - clustering resolution chosen without a stability criterion.
function m7(cfg: Check7Config): FullCheck {
  const supported: [number, number] = [0.4, 0.8];
  const steps = buildResolutionSteps(cfg.min, cfg.max, cfg.step, supported);
  const nInside = steps.filter((s) => s.present).length;
  const stability = steps.length ? nInside / steps.length : 0;
  const chosenInside = cfg.chosen >= supported[0] - 1e-9 && cfg.chosen <= supported[1] + 1e-9;
  const p7 = {
    h5ad: H5AD,
    min: cfg.min,
    max: cfg.max,
    step: cfg.step,
    criterion: cfg.criterion,
    chosen: cfg.chosen,
    seed: 0,
  };

  if (chosenInside) {
    return {
      checkId: 7,
      state: 'clean',
      headline: 'The chosen resolution sits inside the supported window.',
      error: null,
      citation: cit('c7'),
      original: null,
      corrected:
        'Resolution ' +
        cfg.chosen.toFixed(1) +
        ' falls inside the ' +
        supported[0].toFixed(1) +
        '–' +
        supported[1].toFixed(1) +
        ' window that ' +
        cfg.criterion +
        ' supports. The cluster count is defensible.',
      stats: [
        { label: 'Chosen resolution', value: cfg.chosen.toFixed(1), good: true },
        { label: 'Supported window', value: supported[0].toFixed(1) + ' to ' + supported[1].toFixed(1) },
      ],
      chart: {
        kind: 'fragility',
        steps,
        present: supported,
        track: cfg.criterion,
        stability,
        chosen: cfg.chosen,
        supported,
      },
    };
  }

  const afterSteps = steps.map((s) => ({ ...s }));
  return {
    checkId: 7,
    state: 'flagged',
    headline: 'The clustering resolution was chosen without a stability criterion.',
    error: 'Arbitrary resolution choice',
    citation: cit('c7'),
    original: 'Analysis clustered at resolution ' + cfg.chosen.toFixed(1) + ', giving 14 clusters.',
    corrected:
      'Silhouette peaks across resolution ' +
      supported[0].toFixed(1) +
      '–' +
      supported[1].toFixed(1) +
      '; the chosen ' +
      cfg.chosen.toFixed(1) +
      ' sits outside that window and oversplits the data. A criterion-selected resolution gives fewer, more stable clusters.',
    stats: [
      { label: 'Chosen resolution', value: cfg.chosen.toFixed(1), bad: true },
      { label: 'Supported window', value: supported[0].toFixed(1) + ' to ' + supported[1].toFixed(1) },
      { label: 'Criterion', value: cfg.criterion },
    ],
    chart: {
      kind: 'fragility',
      steps,
      present: supported,
      track: cfg.criterion,
      stability,
      chosen: cfg.chosen,
      supported,
    },
    correctedCode: mkCode('07_resolution_choice.py', script7(p7), p7),
    recommendations: [
      rec(
        'Select the resolution by ' + cfg.criterion + ', inside 0.4 to 0.8.',
        'The chosen ' + cfg.chosen.toFixed(1) + ' scores below the 0.4 to 0.8 window and oversplits into 14 clusters.',
        'Fewer, more stable clusters that a criterion supports.',
        'fixable_now',
        cit('c7'),
      ),
    ],
    preview: {
      methodLabel: 'silhouette-selected resolution',
      unsalvageable: false,
      before: {
        kind: 'fragility',
        steps,
        present: supported,
        track: cfg.criterion,
        stability,
        chosen: cfg.chosen,
        supported,
      },
      after: {
        kind: 'fragility',
        steps: afterSteps,
        present: supported,
        track: cfg.criterion,
        stability,
        chosen: 0.6,
        supported,
      },
    },
  };
}

// CHECK 8 - a t-test run on raw, overdispersed counts.
function m8(cfg: Check8Config): FullCheck {
  const alpha = cfg.alpha;
  const naive = { n: 4, p: 0.004, log10p: 2.4, sig: true };
  const honest = { n: 4, p: 0.12, log10p: 0.92, sig: false };
  const p8 = {
    h5ad: H5AD,
    grouping: 'condition',
    ref: REF,
    alt: ALT,
    unit: 'donor_id',
    claimed_test: cfg.claimedTest,
    alpha,
  };
  const v8 = volcanoPair('t-test on raw counts', 'Wilcoxon rank-sum', alpha, 1.0, [
    { gene: 'FOXP3', fc: 0.9, before: 2.4, after: 0.92, sigBefore: true, sigAfter: false, claimed: true },
    { gene: 'IL2RA', fc: -1.4, before: 3.9, after: 2.6, sigBefore: true, sigAfter: true },
    { gene: 'CTLA4', fc: 0.6, before: 2.0, after: 0.7, sigBefore: true, sigAfter: false },
    { gene: 'IKZF2', fc: 0.4, before: 1.7, after: 0.5, sigBefore: true, sigAfter: false },
    { gene: 'SELL', fc: -0.2, before: 0.7, after: 0.4, sigBefore: false, sigAfter: false },
  ]);
  return {
    checkId: 8,
    state: 'flagged',
    headline: 'A t-test was run on raw counts, which it does not fit.',
    error: 'Violated test assumptions',
    citation: cit('c8', true),
    original: 'A t-test on raw counts gives p = 0.004 for the knockdown effect.',
    corrected:
      'Raw counts are overdispersed (variance/mean = 6.2), so a t-test overstates significance. A Wilcoxon rank-sum test on the same donor-level values gives p = 0.12, not significant at ' +
      alpha +
      '.',
    stats: [
      { label: 't-test p (raw counts)', value: '0.004', bad: true },
      { label: 'Wilcoxon p', value: '0.12' },
      { label: 'Overdispersion', value: '6.2×' },
    ],
    chart: { kind: 'significance', naive, honest, alpha, units: MAR_UNITS, badUnit: false },
    correctedCode: mkCode('08_test_assumptions.py', script8(p8), p8),
    recommendations: [
      rec(
        'Re-test with a count-aware test (Wilcoxon or negative binomial).',
        'Raw counts are overdispersed (variance/mean = 6.2); the t-test p = 0.004 becomes p = 0.12 under Wilcoxon.',
        'The knockdown effect is no longer significant once the test matches the data.',
        'fixable_now',
        cit('c8', true),
      ),
    ],
    preview: {
      methodLabel: 'Wilcoxon rank-sum',
      unsalvageable: false,
      before: v8.before,
      after: v8.after,
    },
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

function mr5(cfg: Check5Config): string[] {
  return [
    'Testing every gene at the donor level, knockdown vs non-targeting.',
    'Counting how many pass a raw p < ' + cfg.alpha + ' threshold.',
    'Applying ' + cfg.method.toUpperCase() + ' across roughly 2,000 tests.',
    'Reporting how many survive q < ' + cfg.alpha + '.',
  ];
}

function mr6(cfg: Check6Config): string[] {
  return [
    "Cross-tabulating ‘condition’ against ‘" + cfg.covariate + "’ (Cramér's V).",
    'Fitting the donor-level effect without ' + cfg.covariate + ', then with it.',
    'Comparing the two p-values to see whether ' + cfg.covariate + ' belongs in the model.',
  ];
}

function mr7(cfg: Check7Config): string[] {
  return [
    'Sweeping resolution ' + cfg.min.toFixed(1) + ' to ' + cfg.max.toFixed(1) + ' (step ' + cfg.step.toFixed(1) + ').',
    'Scoring each setting by ' + cfg.criterion + '.',
    'Reading the chosen ' + cfg.chosen.toFixed(1) + ' against the supported window.',
  ];
}

function mr8(cfg: Check8Config): string[] {
  return [
    'Aggregating to donor-level values, knockdown vs non-targeting.',
    'Measuring overdispersion (variance / mean) of the raw counts.',
    'Re-testing with Wilcoxon and comparing to the claimed ' + cfg.claimedTest + '.',
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
    case 4:
      return m4(cfg as Check4Config);
    case 5:
      return m5(cfg as Check5Config);
    case 6:
      return m6(cfg as Check6Config);
    case 7:
      return m7(cfg as Check7Config);
    default:
      return m8(cfg as Check8Config);
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
    case 4:
      return mr4(cfg as Check4Config);
    case 5:
      return mr5(cfg as Check5Config);
    case 6:
      return mr6(cfg as Check6Config);
    case 7:
      return mr7(cfg as Check7Config);
    default:
      return mr8(cfg as Check8Config);
  }
}

export const MARSON_DEFAULTS: CheckConfigMap = {
  1: { unit: 'donor_id', grouping: 'condition', alpha: 0.05 },
  2: { split: 0.3, grouping: 'leiden' },
  3: { min: 0.2, max: 2.0, step: 0.2, track: 'Effector', scrub: 0.9 },
  4: { interest: 'condition', nuisance: ['lane'] },
  5: { alpha: 0.05, method: 'bh' },
  6: { interest: 'condition', covariate: 'phase', alpha: 0.05 },
  7: { min: 0.2, max: 2.0, step: 0.2, criterion: 'silhouette', chosen: 1.0 },
  8: { grouping: 'condition', claimedTest: 'ttest', alpha: 0.05 },
};

export const marsonScenario: Scenario = {
  id: 'marson',
  name: 'IL2RA knockdown (CD4+ T cells)',
  dataset,
  claims,
  fields,
};
