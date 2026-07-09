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
  ExtractedClaim,
} from '@redline/contracts';
import { buildSteps, cit, groupInt, type FullCheck } from './shared.js';
import { KETAMINE_INVENTORY } from '../inventories.js';

// ---------------------------------------------------------------------------
// Scenario `ketamine` - the LOCKED fallback. This is an exact reproduction of
// project/redline-engine.js mapped into the contract shapes (mice -> profiles /
// units, cond -> group, mean -> value). Its numbers and copy are the reference;
// do not alter them. The em dashes and curly quotes below are part of that
// locked reference and are reproduced verbatim.
// ---------------------------------------------------------------------------

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
    };
  }

  const badUnit = cfg.unit === 'cell_barcode';
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
      ' split the four markers separate the group at AUC 0.58, near chance. The state is an artifact of choosing the markers and the cluster on the same cells.',
    stats: [
      { label: 'Discovery AUC', value: discAUC.toFixed(2) },
      { label: 'Held-out AUC', value: holdAUC.toFixed(2), bad: true },
      { label: 'Markers holding', value: '0 / 4' },
    ],
    chart: { kind: 'groups', markers, split: cfg.split, verified: true, discAUC, holdAUC },
  };
}

// CHECK 3 - fragile conclusions (appear/vanish across a parameter).
function k3(cfg: Check3Config): FullCheck {
  const present: [number, number] = cfg.track === 'Responder' ? [0.8, 1.2] : [0.0, 9.9];
  const steps = buildSteps(cfg.min, cfg.max, cfg.step, present);
  const nPresent = steps.filter((s) => s.present).length;
  const stability = steps.length ? nPresent / steps.length : 0;
  const pct = Math.round(stability * 100);

  if (cfg.track === 'Responder') {
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
        ' settings tested (' +
        pct +
        '%). It is a boundary of the algorithm, not a discrete population.',
      stats: [
        { label: 'Stability', value: pct + '%', bad: true },
        { label: 'Appears in', value: nPresent + ' / ' + steps.length + ' settings' },
        { label: 'Present range', value: present[0].toFixed(1) + '–' + present[1].toFixed(1) },
      ],
      chart: { kind: 'fragility', steps, present, track: cfg.track, stability },
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
      '%). It is stable to the clustering parameter and safe to report as a discrete population.',
    stats: [
      { label: 'Stability', value: pct + '%', good: true },
      { label: 'Appears in', value: nPresent + ' / ' + steps.length + ' settings' },
    ],
    chart: { kind: 'fragility', steps, present, track: cfg.track, stability },
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

export function ketamineFull(checkId: CheckId, cfg: unknown): FullCheck {
  switch (checkId) {
    case 1:
      return k1(cfg as Check1Config);
    case 2:
      return k2(cfg as Check2Config);
    case 3:
      return k3(cfg as Check3Config);
    default:
      return k4(cfg as Check4Config);
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
    default:
      return kr4(cfg as Check4Config);
  }
}

export const KETAMINE_DEFAULTS: CheckConfigMap = {
  1: { unit: 'mouse_id', grouping: 'condition', alpha: 0.05 },
  2: { split: 0.3, grouping: 'leiden' },
  3: { min: 0.2, max: 2.0, step: 0.2, track: 'Responder', scrub: 0.9 },
  4: { interest: 'condition', nuisance: ['seq_batch'] },
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
