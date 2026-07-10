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
  ExtractedClaim,
} from '@redline/contracts';
import {
  buildSteps,
  buildResolutionSteps,
  cit,
  fdr,
  groupInt,
  iv,
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
import { KETAMINE_INVENTORY } from '../inventories.js';

// ---------------------------------------------------------------------------
// Scenario `ketamine` - the LOCKED fallback. Checks 1 to 4 are an exact
// reproduction of project/redline-engine.js mapped into the contract shapes
// (mice -> profiles / units, cond -> group, mean -> value). Their numbers and
// copy are the reference; do not alter them. The em dashes and curly quotes in
// checks 1 to 4 are part of that locked reference and are reproduced verbatim.
//
// The correction payloads and checks 5 to 8 are NEW and follow the voice rules
// (no em dashes). Case B carries different field names, genes, numbers, and
// resolutions from Case A on purpose: that is the generality test.
// ---------------------------------------------------------------------------

const H5AD = 'pfc_ketamine_scRNAseq.h5ad';
const REF = 'saline';
const ALT = 'ketamine';

const dataset: DatasetMeta = {
  file: 'pfc_ketamine_scRNAseq.h5ad',
  label: 'pfc_ketamine_scRNAseq',
  title: 'Prefrontal cortex · ketamine vs. saline · scRNA-seq',
  cells: 48213,
  genes: 2431,
  replicates: 6,
  replicateLabel: 'mice',
  fieldCount: 8,
  sizeGB: 1.9,
};

const claims: Claim[] = [
  { id: 'c1', text: 'Ketamine significantly upregulates Bdnf in microglia (p < 0.001).', check: 1 },
  { id: 'c2', text: 'An activated-microglia state defined by 4 markers, enriched in ketamine.', check: 2 },
  { id: 'c3', text: 'A distinct ketamine-responsive microglia subcluster.', check: 3 },
  { id: 'c4', text: 'Differential expression between ketamine and saline.', check: 4 },
];

const fields: FieldSpec[] = [
  {
    id: 'mouse_id',
    dtype: 'categorical',
    levels: 6,
    missing: 0,
    role: 'unit',
    confidence: 'high',
    reason:
      '6 unique values. Treatment is assigned at this level and cells are nested inside it — this is the true replicate.',
  },
  {
    id: 'condition',
    dtype: 'categorical',
    levels: 2,
    missing: 0,
    sample: 'ketamine · saline',
    role: 'grouping',
    confidence: 'high',
    reason: 'Two levels. This is the contrast your analysis compares.',
  },
  {
    id: 'cell_barcode',
    dtype: 'identifier',
    levels: 48213,
    missing: 0,
    role: 'observation',
    confidence: 'high',
    reason: 'One per row, ~8,000 per mouse. Rows are measurements, not independent samples.',
  },
  {
    id: 'seq_batch',
    dtype: 'categorical',
    levels: 2,
    missing: 0,
    sample: '2024-11-03 · 2024-11-05',
    role: 'nuisance',
    confidence: 'medium',
    reason:
      'Technical variable. Its two levels line up with condition — a possible confound flagged to Check 4.',
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
    levels: 12,
    missing: 0,
    role: 'derived',
    confidence: 'medium',
    reason: 'Cluster labels you computed. A derived grouping, not a measured field.',
  },
  {
    id: 'sex',
    dtype: 'categorical',
    levels: 2,
    missing: 0,
    sample: 'M · F',
    role: 'nuisance',
    confidence: 'low',
    reason:
      'Balanced across condition, so it may not matter. Confirm whether to adjust for it or ignore it.',
  },
];

// mice -> UnitProfile[] (3 saline, 3 ketamine; mouse-level Bdnf means, log-norm).
const KET_UNITS: UnitProfile[] = [
  { id: 'S1', group: 'saline', n: 8123, value: 1.02 },
  { id: 'S2', group: 'saline', n: 7788, value: 1.19 },
  { id: 'S3', group: 'saline', n: 8210, value: 0.94 },
  { id: 'K1', group: 'ketamine', n: 7960, value: 1.28 },
  { id: 'K2', group: 'ketamine', n: 8041, value: 1.07 },
  { id: 'K3', group: 'ketamine', n: 8091, value: 1.35 },
];

// CHECK 1 - fake significance from non-independent data.
function k1(cfg: Check1Config): FullCheck {
  const alpha = cfg.alpha;
  const naive = { n: 48213, p: 3.1e-9, log10p: 8.5, sig: true };
  const honest = { n: 6, p: 0.34, log10p: 0.47, sig: false };

  if (cfg.unit === 'litter_id') {
    return {
      checkId: 1,
      state: 'hard_stop',
      headline: 'No valid test is possible.',
      error: 'Too few independent units',
      citation: cit('c1'),
      original: 'Ketamine significantly increased Bdnf expression (p < 0.001).',
      corrected:
        '‘litter_id’ has 2 values — one per condition. With no replication inside either group, no test can separate ketamine from that single litter. Assign a field with replicate units, or collect more.',
      stats: [
        { label: 'Independent units', value: '2' },
        { label: 'Per group', value: '1' },
        { label: 'Minimum needed', value: '≥ 3 / group' },
      ],
      chart: { kind: 'hardstop', units: 2, perGroup: 1, profiles: KET_UNITS },
      recommendations: [
        rec(
          'Collect a design with at least 3 replicate units per group.',
          "'litter_id' resolves to 2 units, one per condition, so no test can separate the drug from that single litter.",
          'A valid mouse-level differential-expression test becomes possible.',
          'needs_new_data',
          cit('c1'),
        ),
      ],
      preview: {
        methodLabel: 'no valid test (n=1 per group)',
        unsalvageable: true,
        before: { kind: 'hardstop', units: 2, perGroup: 1, profiles: KET_UNITS },
        after: null,
      },
    };
  }

  const badUnit = cfg.unit === 'cell_barcode';
  const p1 = {
    h5ad: H5AD,
    unit: 'mouse_id',
    grouping: 'condition',
    ref: REF,
    alt: ALT,
    gene: 'Bdnf',
    covariates: ['n_genes', 'pct_mito'],
    alpha,
  };
  const v1 = volcanoPair('naive per-cell test, ~ condition', 'pseudobulk + PyDESeq2, ~ condition', alpha, 1.0, [
    { gene: 'Bdnf', fc: 0.8, before: 8.5, after: 0.47, sigBefore: true, sigAfter: false, claimed: true },
    { gene: 'Fos', fc: 1.1, before: 6.9, after: 1.9, sigBefore: true, sigAfter: true },
    { gene: 'Arc', fc: 0.7, before: 5.2, after: 0.6, sigBefore: true, sigAfter: false },
    { gene: 'Il1b', fc: 0.5, before: 3.8, after: 0.4, sigBefore: true, sigAfter: false },
    { gene: 'Nfkbia', fc: 0.3, before: 2.6, after: 0.3, sigBefore: true, sigAfter: false },
    { gene: 'Gfap', fc: -0.2, before: 1.0, after: 0.35, sigBefore: false, sigAfter: false },
  ]);
  return {
    checkId: 1,
    state: 'flagged',
    headline: badUnit
      ? 'The significant result comes from counting cells, not animals.'
      : 'The significant result does not survive an honest re-test.',
    error: 'Fake significance from non-independent data (pseudoreplication)',
    citation: cit('c1'),
    original: 'Ketamine significantly increased Bdnf expression (p < 0.001, n = 48,213).',
    corrected:
      "Ketamine did not significantly change Bdnf expression at the mouse level (Welch's t, p = 0.34, n = 6 mice). The original p-value counts 48,213 correlated cells as independent replicates.",
    stats: [
      { label: 'Original p', value: '3.1×10⁻⁹', bad: true },
      { label: 'Honest p (mouse-level)', value: '0.34' },
      { label: 'True n', value: '6 mice' },
      { label: 'Intra-mouse corr.', value: 'ICC 0.18' },
    ],
    chart: { kind: 'significance', naive, honest, alpha, units: KET_UNITS, badUnit },
    correctedCode: mkCode('01_pseudoreplication.py', script1(p1), p1),
    recommendations: [
      rec(
        'Aggregate cells to mouse_id and re-test with pseudobulk (PyDESeq2).',
        'The per-cell p-value (3.1e-9) treats 48,213 correlated cells as independent; at the mouse level (n=6) the effect is p = 0.34.',
        'Bdnf drops below significance once the true replicate is the mouse.',
        'fixable_now',
        cit('c1'),
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

// CHECK 2 - fake groups (do not replicate on a held-out split).
function k2(cfg: Check2Config): FullCheck {
  const markers = [
    { gene: 'Il1b', disc: 0.9, hold: 0.58 },
    { gene: 'Tnf', disc: 0.88, hold: 0.55 },
    { gene: 'Ccl4', disc: 0.86, hold: 0.61 },
    { gene: 'Nfkbia', disc: 0.89, hold: 0.57 },
  ];
  const holdoutCells = Math.round(dataset.cells * cfg.split);

  if (cfg.split < 0.15) {
    return {
      checkId: 2,
      state: 'flag_only',
      headline: 'The held-out set is too small to validate the groups.',
      error: 'Could not verify — held-out split below minimum',
      citation: cit('c2'),
      original: 'An activated-microglia state defined by 4 markers, enriched in ketamine.',
      corrected:
        'At a ' +
        Math.round(cfg.split * 100) +
        '% split the held-out set is ' +
        groupInt(holdoutCells) +
        ' cells — under the 500-per-group minimum for a stable AUC. Raise the split to test whether the state replicates.',
      missing: 'Held-out set ≥ 500 cells per group.',
      stats: [
        { label: 'Held-out cells', value: groupInt(holdoutCells), bad: true },
        { label: 'Minimum', value: '≥ 1,000' },
      ],
      chart: { kind: 'groups', markers, split: cfg.split, verified: false },
    };
  }

  const discAUC = 0.9;
  const holdAUC = 0.58;
  // Distributions over 200 independent count-splits (illustrative reference).
  const holdDist = iv(0.58, 0.55, 0.62, 200);
  const discDist = iv(0.9, 0.87, 0.92, 200);
  const holdingDist = iv(0, 0, 1, 200);
  const p2 = {
    h5ad: H5AD,
    grouping: 'leiden',
    target_group: 'Activated-Microglia',
    markers: ['Il1b', 'Tnf', 'Ccl4', 'Nfkbia'],
    split: cfg.split,
    seed: 0,
  };
  return {
    checkId: 2,
    state: 'flagged',
    headline: 'The group separates in the data it was defined on, and nowhere else.',
    error: 'Fake groups — separation does not replicate out of sample',
    citation: cit('c2'),
    original: 'A distinct activated-microglia state, defined by Il1b, Tnf, Ccl4 and Nfkbia.',
    corrected:
      'On a held-out ' +
      Math.round((1 - cfg.split) * 100) +
      '/' +
      Math.round(cfg.split * 100) +
      ' split the four markers separate the group at AUC 0.58 (95% interval 0.55–0.62 over 200 splits), near chance. The state is an artifact of choosing the markers and the cluster on the same cells.',
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
    correctedCode: mkCode('02_double_dipping.py', script2(p2), p2),
    recommendations: [
      rec(
        'Validate the markers on cells held out from the clustering.',
        'The four markers separate the group at AUC 0.90 on the cells they were chosen on and 0.58 (near chance) on held-out cells.',
        'The activated-microglia state does not survive out of sample.',
        'fixable_now',
        cit('c2'),
      ),
      rec(
        'Use ClusterDE for a calibrated test of the cluster.',
        'Count splitting is evidence, not a certified FDR correction. ClusterDE is the stronger method.',
        'A false-discovery-controlled marker set for the claimed state.',
        'fixable_now',
        cit('c2'),
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

// CHECK 3 - fragile conclusions (appear/vanish across a parameter).
function k3(cfg: Check3Config): FullCheck {
  const isSpurious = cfg.track === 'Responder';
  const present: [number, number] = isSpurious ? [0.8, 1.2] : [0.0, 9.9];
  const steps0 = buildSteps(cfg.min, cfg.max, cfg.step, present);
  const nPresent = steps0.filter((s) => s.present).length;
  const stability = steps0.length ? nPresent / steps0.length : 0;
  const pct = Math.round(stability * 100);

  // Per-setting presence probability over 40 re-seeded sweeps (illustrative
  // reference); a stable group is present nearly always.
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
    const p3 = {
      h5ad: H5AD,
      track: 'Responder',
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
      error: 'Fragile conclusion — result depends on an arbitrary parameter',
      citation: cit('c3'),
      original: 'A distinct ketamine-responsive microglia subcluster.',
      corrected:
        'The ‘Responder’ subcluster appears only at clustering resolution ' +
        present[0].toFixed(1) +
        '–' +
        present[1].toFixed(1) +
        ' — ' +
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
      correctedCode: mkCode('03_fragility.py', script3(p3), p3),
      recommendations: [
        rec(
          'Report the cluster stability across resolutions, or drop the subcluster.',
          "The 'Responder' subcluster appears in only " +
            nPresent +
            ' of ' +
            steps.length +
            ' resolution settings and is absent elsewhere.',
          'The ketamine-responsive state is reported as a clustering artifact, not a population.',
          'fixable_now',
          cit('c3'),
        ),
      ],
      preview: {
        methodLabel: 'cluster-stability report',
        unsalvageable: false,
        before: { kind: 'fragility', steps, present, track: cfg.track, stability, stabilityDist },
        after: {
          kind: 'fragility',
          steps: stableSteps,
          present: [cfg.min, cfg.max],
          track: 'Microglia (stable parent)',
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
    citation: cit('c3'),
    original: null,
    corrected:
      'The ‘Homeostatic’ microglia group is present in ' +
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

// CHECK 4 - confounded comparison.
function k4(cfg: Check4Config): FullCheck {
  const hasBatch = cfg.nuisance.indexOf('seq_batch') !== -1;
  const grid = {
    rows: ['ketamine', 'saline'],
    cols: ['2024-11-03', '2024-11-05'],
    cells: [
      [24106, 0],
      [0, 24107],
    ],
  };

  if (!hasBatch) {
    return {
      checkId: 4,
      state: 'flag_only',
      headline: 'You told Redline to ignore the one variable that aligns with condition.',
      error: 'Could not verify — nuisance variable excluded',
      citation: cit('c4'),
      original: 'Differential expression between ketamine and saline.',
      corrected:
        "‘seq_batch’ is not in the nuisance set, so confounding can't be assessed — yet its levels line up exactly with condition. Add it to test whether treatment and batch can be separated.",
      missing: 'Add seq_batch as a nuisance variable.',
      stats: [
        { label: 'Nuisance vars', value: String(cfg.nuisance.length) },
        { label: 'Assessed', value: '—' },
      ],
      chart: { kind: 'confound', grid, cramersV: null, verified: false },
    };
  }

  const p4 = { h5ad: H5AD, interest: 'condition', technical: 'seq_batch', separable: false };
  return {
    checkId: 4,
    state: 'flagged',
    headline: 'Treatment and sequencing batch are the same variable here.',
    error: 'Confounded comparison — effects are not separable',
    citation: cit('c4'),
    original: 'Differential expression between ketamine and saline reflects the drug.',
    corrected:
      "Every ketamine sample was run on 2024-11-03 and every saline sample on 2024-11-05 (Cramér's V = 1.00). Any difference is treatment or batch — the data cannot tell which. No treatment effect can be claimed from this comparison.",
    stats: [
      { label: "Cramér's V", value: '1.00', bad: true },
      { label: 'Overlap', value: '0%' },
      { label: 'Separable', value: 'No' },
    ],
    chart: { kind: 'confound', grid, cramersV: 1.0, verified: true },
    correctedCode: mkCode('04_confounding.py', script4(p4), p4),
    recommendations: [
      rec(
        'Do not report a treatment effect from this comparison.',
        'Every ketamine sample ran on 2024-11-03 and every saline sample on 2024-11-05, so condition and seq_batch are one split.',
        'The confounded contrast is withdrawn rather than reported.',
        'unsalvageable',
        cit('c4'),
      ),
      rec(
        'Collect a design where condition and seq_batch vary independently.',
        'With treatment balanced across batches, the batch effect can be separated from the drug effect.',
        'A separable effect that a model can estimate.',
        'needs_new_data',
        cit('c4'),
      ),
    ],
    preview: {
      methodLabel: 'no separable effect (full confound)',
      caveat: 'Condition and seq_batch are one split. No model can attribute a difference to the drug.',
      unsalvageable: true,
      before: { kind: 'confound', grid, cramersV: 1.0, verified: true },
      after: null,
    },
  };
}

// CHECK 5 - significance claimed on raw p-values across ~1,800 genes.
function k5(cfg: Check5Config): FullCheck {
  const alpha = cfg.alpha;
  const method = cfg.method;
  const p5 = {
    h5ad: H5AD,
    unit: 'mouse_id',
    grouping: 'condition',
    ref: REF,
    alt: ALT,
    alpha,
    method,
    tests: 1800,
  };
  const top = [
    { gene: 'Fos', p: 1e-7, q: 6e-5, survives: true },
    { gene: 'Arc', p: 3e-5, q: 0.009, survives: true },
    { gene: 'Bdnf', p: 5e-4, q: 0.08, survives: false },
    { gene: 'Il1b', p: 2e-3, q: 0.12, survives: false },
    { gene: 'Nfkbia', p: 5e-3, q: 0.16, survives: false },
  ];
  const v5 = volcanoPair('raw p, ~1,800 genes', method.toUpperCase() + ' at q < ' + alpha, alpha, 1.0, [
    { gene: 'Fos', fc: 1.1, before: 7.0, after: 4.2, sigBefore: true, sigAfter: true, claimed: true },
    { gene: 'Arc', fc: 0.7, before: 4.5, after: 2.0, sigBefore: true, sigAfter: true },
    { gene: 'Bdnf', fc: 0.8, before: 3.3, after: 1.1, sigBefore: true, sigAfter: false, claimed: true },
    { gene: 'Il1b', fc: 0.4, before: 2.7, after: 0.92, sigBefore: true, sigAfter: false },
    { gene: 'Nfkbia', fc: 0.3, before: 2.3, after: 0.8, sigBefore: true, sigAfter: false },
    { gene: 'Gfap', fc: -0.1, before: 0.5, after: 0.3, sigBefore: false, sigAfter: false },
  ]);
  return {
    checkId: 5,
    state: 'flagged',
    headline: 'Significance was claimed on raw p-values across roughly 1,800 genes.',
    error: 'Uncorrected multiple testing',
    citation: cit('c5', true),
    original: '356 genes are differentially expressed between ketamine and saline (p < 0.05).',
    corrected:
      'Of 356 genes significant on raw p, 17 survive Benjamini-Hochberg control at q < ' +
      alpha +
      ' across 1,800 tests. The other 339 are expected false positives at this test count.',
    stats: [
      { label: 'Raw hits', value: '356', bad: true },
      { label: 'Survive BH (q<' + alpha + ')', value: '17' },
      { label: 'Tests', value: '1,800' },
    ],
    chart: fdr(1800, alpha, 356, 17, method, top),
    correctedCode: mkCode('05_multiple_testing.py', script5(p5), p5),
    recommendations: [
      rec(
        'Apply Benjamini-Hochberg across all 1,800 tested genes.',
        '356 genes pass a raw p threshold; only 17 survive FDR control at q < ' + alpha + '.',
        'The differential-expression list shrinks from 356 to 17 defensible genes.',
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

// CHECK 6 - a separable covariate (sex) left out of the model.
function k6(cfg: Check6Config): FullCheck {
  const alpha = cfg.alpha;
  const naive = { n: 6, p: 0.012, log10p: 1.92, sig: true };
  const honest = { n: 6, p: 0.14, log10p: 0.85, sig: false };
  const p6 = {
    h5ad: H5AD,
    interest: 'condition',
    covariate: 'sex',
    ref: REF,
    alt: ALT,
    unit: 'mouse_id',
    alpha,
  };
  const v6 = volcanoPair('~ condition', '~ condition + sex', alpha, 1.0, [
    { gene: 'Bdnf', fc: 0.8, before: 1.92, after: 0.85, sigBefore: true, sigAfter: false, claimed: true },
    { gene: 'Fos', fc: 1.1, before: 3.6, after: 3.0, sigBefore: true, sigAfter: true },
    { gene: 'Xist', fc: -0.9, before: 3.0, after: 0.3, sigBefore: true, sigAfter: false },
    { gene: 'Ddx3y', fc: 0.7, before: 2.5, after: 0.2, sigBefore: true, sigAfter: false },
    { gene: 'Il1b', fc: 0.4, before: 1.5, after: 0.8, sigBefore: true, sigAfter: false },
  ]);
  return {
    checkId: 6,
    state: 'flagged',
    headline: 'A separable batch variable (sex) was left out of the model.',
    error: 'Unmodeled separable covariate',
    citation: cit('c6'),
    original: 'Ketamine changes the microglial program (p = 0.012), adjusting for nothing else.',
    corrected:
      "‘sex’ is not as balanced across condition as assumed (Cramér's V = 0.24) and shifts the estimate. With sex in the model the condition effect is p = 0.14, no longer significant at " +
      alpha +
      '. Sex belongs in the model.',
    stats: [
      { label: 'Effect p (no covariate)', value: '0.012', bad: true },
      { label: 'Effect p (+ sex)', value: '0.14' },
      { label: 'sex vs condition', value: "Cramér's V 0.24" },
    ],
    chart: { kind: 'significance', naive, honest, alpha, units: KET_UNITS, badUnit: false },
    correctedCode: mkCode('06_unmodeled_covariate.py', script6(p6), p6),
    recommendations: [
      rec(
        'Add sex as a covariate in the mouse-level model.',
        "sex is separable from condition (Cramér's V = 0.24) and moves the effect from p = 0.012 to p = 0.14.",
        'The condition effect is reported with sex controlled, and is no longer significant.',
        'fixable_now',
        cit('c6'),
      ),
    ],
    preview: {
      methodLabel: 'pseudobulk + PyDESeq2, ~ condition + sex',
      unsalvageable: false,
      before: v6.before,
      after: v6.after,
    },
  };
}

// CHECK 7 - resolution chosen WITH a criterion: the chosen setting is supported,
// so this reports CLEAN. The never-cry-wolf path, exercised by a rigor check.
function k7(cfg: Check7Config): FullCheck {
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

  if (!chosenInside) {
    const afterSteps = steps.map((s) => ({ ...s }));
    return {
      checkId: 7,
      state: 'flagged',
      headline: 'The clustering resolution was chosen without a stability criterion.',
      error: 'Arbitrary resolution choice',
      citation: cit('c7'),
      original: 'Analysis clustered at resolution ' + cfg.chosen.toFixed(1) + ', giving 12 clusters.',
      corrected:
        'Silhouette peaks across resolution ' +
        supported[0].toFixed(1) +
        '–' +
        supported[1].toFixed(1) +
        '; the chosen ' +
        cfg.chosen.toFixed(1) +
        ' sits outside that window. A criterion-selected resolution gives more stable clusters.',
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
          'The chosen ' + cfg.chosen.toFixed(1) + ' scores below the 0.4 to 0.8 window.',
          'More stable clusters that a criterion supports.',
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
      ' supports. The cluster count is defensible and safe to report.',
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

// CHECK 8 - a t-test run on raw, overdispersed counts.
function k8(cfg: Check8Config): FullCheck {
  const alpha = cfg.alpha;
  const naive = { n: 6, p: 0.006, log10p: 2.22, sig: true };
  const honest = { n: 6, p: 0.15, log10p: 0.82, sig: false };
  const p8 = {
    h5ad: H5AD,
    grouping: 'condition',
    ref: REF,
    alt: ALT,
    unit: 'mouse_id',
    claimed_test: cfg.claimedTest,
    alpha,
  };
  const v8 = volcanoPair('t-test on raw counts', 'Wilcoxon rank-sum', alpha, 1.0, [
    { gene: 'Bdnf', fc: 0.8, before: 2.22, after: 0.82, sigBefore: true, sigAfter: false, claimed: true },
    { gene: 'Fos', fc: 1.1, before: 3.5, after: 2.3, sigBefore: true, sigAfter: true },
    { gene: 'Arc', fc: 0.6, before: 1.9, after: 0.6, sigBefore: true, sigAfter: false },
    { gene: 'Il1b', fc: 0.4, before: 1.6, after: 0.5, sigBefore: true, sigAfter: false },
    { gene: 'Gfap', fc: -0.2, before: 0.6, after: 0.3, sigBefore: false, sigAfter: false },
  ]);
  return {
    checkId: 8,
    state: 'flagged',
    headline: 'A t-test was run on raw counts, which it does not fit.',
    error: 'Violated test assumptions',
    citation: cit('c8', true),
    original: 'A t-test on raw counts gives p = 0.006 for the ketamine effect.',
    corrected:
      'Raw counts are overdispersed (variance/mean = 5.4), so a t-test overstates significance. A Wilcoxon rank-sum test on the same mouse-level values gives p = 0.15, not significant at ' +
      alpha +
      '.',
    stats: [
      { label: 't-test p (raw counts)', value: '0.006', bad: true },
      { label: 'Wilcoxon p', value: '0.15' },
      { label: 'Overdispersion', value: '5.4×' },
    ],
    chart: { kind: 'significance', naive, honest, alpha, units: KET_UNITS, badUnit: false },
    correctedCode: mkCode('08_test_assumptions.py', script8(p8), p8),
    recommendations: [
      rec(
        'Re-test with a count-aware test (Wilcoxon or negative binomial).',
        'Raw counts are overdispersed (variance/mean = 5.4); the t-test p = 0.006 becomes p = 0.15 under Wilcoxon.',
        'The ketamine effect is no longer significant once the test matches the data.',
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

function kr1(cfg: Check1Config): string[] {
  const lines = [
    'Reading grouping ‘condition’ — ketamine vs. saline.',
    'Counting independent units under ‘' + cfg.unit + '’.',
  ];
  if (cfg.unit === 'cell_barcode') {
    lines.push(
      '‘cell_barcode’ gives 48,213 units — but ~8,000 share each mouse.',
      'Cells within a mouse are correlated (ICC ≈ 0.18); they are not independent.',
      'Variance is underestimated → the p-value is inflated.',
    );
  } else if (cfg.unit === 'litter_id') {
    lines.push(
      '‘litter_id’ resolves to 2 units — one per condition.',
      'No replication within either group. No valid test exists.',
    );
  } else {
    lines.push(
      '‘mouse_id’ gives 6 units — 3 per group.',
      'Original test treated 48,213 cells as independent (ICC ≈ 0.18).',
      "Aggregating to 6 mouse-level means and re-testing (Welch's t).",
    );
  }
  return lines;
}

function kr2(cfg: Check2Config): string[] {
  return [
    'Splitting cells into discovery / held-out at ' + Math.round(cfg.split * 100) + '%.',
    'Fitting the 4 claimed markers on discovery cells.',
    'Scoring the same markers on held-out cells they never saw.',
    'Comparing separation (AUC) between the two splits.',
  ];
}

function kr3(cfg: Check3Config): string[] {
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

function kr4(cfg: Check4Config): string[] {
  return [
    'Cross-tabulating ‘' + cfg.interest + '’ against nuisance variables.',
    "Measuring alignment (Cramér's V) for each.",
    'Testing whether the comparison can be separated from technical structure.',
  ];
}

function kr5(cfg: Check5Config): string[] {
  return [
    'Testing every gene at the mouse level, ketamine vs. saline.',
    'Counting how many pass a raw p < ' + cfg.alpha + ' threshold.',
    'Applying ' + cfg.method.toUpperCase() + ' across roughly 1,800 tests.',
    'Reporting how many survive q < ' + cfg.alpha + '.',
  ];
}

function kr6(cfg: Check6Config): string[] {
  return [
    "Cross-tabulating ‘condition’ against ‘" + cfg.covariate + "’ (Cramér's V).",
    'Fitting the mouse-level effect without ' + cfg.covariate + ', then with it.',
    'Comparing the two p-values to see whether ' + cfg.covariate + ' belongs in the model.',
  ];
}

function kr7(cfg: Check7Config): string[] {
  return [
    'Sweeping resolution ' + cfg.min.toFixed(1) + ' to ' + cfg.max.toFixed(1) + ' (step ' + cfg.step.toFixed(1) + ').',
    'Scoring each setting by ' + cfg.criterion + '.',
    'Reading the chosen ' + cfg.chosen.toFixed(1) + ' against the supported window.',
  ];
}

function kr8(cfg: Check8Config): string[] {
  return [
    'Aggregating to mouse-level values, ketamine vs. saline.',
    'Measuring overdispersion (variance / mean) of the raw counts.',
    'Re-testing with Wilcoxon and comparing to the claimed ' + cfg.claimedTest + '.',
  ];
}

export function ketamineFull(checkId: CheckId, cfg: unknown): FullCheck {
  switch (checkId) {
    case 1:
      return k1(cfg as Check1Config);
    case 2:
      return k2(cfg as Check2Config);
    case 3:
      return k3(cfg as Check3Config);
    case 4:
      return k4(cfg as Check4Config);
    case 5:
      return k5(cfg as Check5Config);
    case 6:
      return k6(cfg as Check6Config);
    case 7:
      return k7(cfg as Check7Config);
    default:
      return k8(cfg as Check8Config);
  }
}

export function ketamineReasoning(checkId: CheckId, cfg: unknown): string[] {
  switch (checkId) {
    case 1:
      return kr1(cfg as Check1Config);
    case 2:
      return kr2(cfg as Check2Config);
    case 3:
      return kr3(cfg as Check3Config);
    case 4:
      return kr4(cfg as Check4Config);
    case 5:
      return kr5(cfg as Check5Config);
    case 6:
      return kr6(cfg as Check6Config);
    case 7:
      return kr7(cfg as Check7Config);
    default:
      return kr8(cfg as Check8Config);
  }
}

export const KETAMINE_DEFAULTS: CheckConfigMap = {
  1: { unit: 'mouse_id', grouping: 'condition', alpha: 0.05 },
  2: { split: 0.3, grouping: 'leiden' },
  3: { min: 0.2, max: 2.0, step: 0.2, track: 'Responder', scrub: 0.9 },
  4: { interest: 'condition', nuisance: ['seq_batch'] },
  5: { alpha: 0.05, method: 'bh' },
  6: { interest: 'condition', covariate: 'sex', alpha: 0.05 },
  7: { min: 0.2, max: 2.0, step: 0.2, criterion: 'silhouette', chosen: 0.6 },
  8: { grouping: 'condition', claimedTest: 'ttest', alpha: 0.05 },
};

// ---------------------------------------------------------------------------
// The curated extracted claims (spec section 5) for the fallback scenario. Same
// fan-out shape as Marson but built on this dataset's own genes and columns, so
// the two claim lists are never identical (the anti-faking guard). Each claim
// passes enforceClaimHonesty against KETAMINE_INVENTORY unchanged. Authored
// under the voice rules (no em dashes), even though the locked fixture copy
// above reproduces the reference verbatim.
// ---------------------------------------------------------------------------
export const KETAMINE_CLAIMS: ExtractedClaim[] = [
  {
    id: 'ketamine-bdnf-significance',
    text: 'Ketamine significantly upregulates Bdnf in microglia (p < 0.001).',
    source: 'stored_result',
    restsOn:
      'The stored differential-expression result de_ket_vs_sal, comparing ketamine against saline on the condition field.',
    evidenceRefs: {
      obsColumns: ['condition', 'mouse_id', 'seq_batch'],
      unsKeys: ['de_ket_vs_sal'],
      genes: ['Bdnf'],
    },
    checks: [
      {
        check: 1,
        params: {
          grouping: 'condition',
          unit: 'mouse_id',
          gene: 'Bdnf',
          reported: 'p = 3.1e-9',
        },
      },
      { check: 4, params: { interest: 'condition', nuisance: 'seq_batch' } },
    ],
    confidence: 'high',
    status: 'proposed',
  },
  {
    id: 'ketamine-activated-microglia-state',
    text: 'An activated-microglia state defined by Il1b, Tnf, Ccl4, and Nfkbia, enriched in ketamine.',
    source: 'stored_result',
    restsOn:
      'The stored marker table rank_genes_groups, which defines the Activated microglia state over the leiden clustering.',
    evidenceRefs: {
      obsColumns: ['leiden', 'condition'],
      unsKeys: ['rank_genes_groups'],
      genes: ['Il1b', 'Tnf', 'Ccl4', 'Nfkbia'],
    },
    checks: [
      {
        check: 2,
        params: {
          grouping: 'leiden',
          cluster: 'Activated microglia',
          markers: ['Il1b', 'Tnf', 'Ccl4', 'Nfkbia'],
        },
      },
      { check: 3, params: { cluster: 'Activated microglia' } },
    ],
    confidence: 'high',
    status: 'proposed',
  },
  {
    id: 'ketamine-responder-state',
    text: 'A distinct ketamine-responsive Responder microglia subcluster.',
    source: 'stored_result',
    restsOn: 'The Responder cluster in the leiden clustering.',
    evidenceRefs: {
      obsColumns: ['leiden'],
      unsKeys: [],
      genes: [],
    },
    checks: [{ check: 3, params: { cluster: 'Responder' } }],
    confidence: 'medium',
    status: 'proposed',
  },
  {
    id: 'ketamine-ligand-receptor',
    text: 'Ketamine rewires microglia to neuron ligand-receptor signaling.',
    source: 'stored_result',
    restsOn: 'A ligand-receptor interaction score computed between cell types.',
    evidenceRefs: {
      obsColumns: [],
      unsKeys: [],
      genes: [],
    },
    checks: [],
    confidence: 'medium',
    status: 'out_of_scope',
    outOfScopeReason:
      "Redline's four checks cover pseudoreplication, double dipping, clustering fragility, and technical confounding. A cell-cell communication claim needs interaction-specific validation these checks do not provide, so it is labeled and set aside.",
  },
];

export const ketamineScenario: Scenario = {
  id: 'ketamine',
  name: 'Ketamine vs. saline (PFC)',
  dataset,
  claims,
  fields,
  inventory: KETAMINE_INVENTORY,
  extractedClaims: KETAMINE_CLAIMS,
};
