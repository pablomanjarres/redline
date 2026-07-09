import type {
  Scenario,
  Claim,
  DatasetMeta,
  FieldSpec,
  CheckConfigMap,
  CheckId,
  ScenarioId,
} from '@redline/contracts';
import type { FullCheck } from './shared.js';

// ---------------------------------------------------------------------------
// Verification foils (`pfc`, `clean`, `nocounts`). Unlike `marson`/`ketamine`,
// these have NO locked fixture numbers. They only run against the real `local`
// compute target, which reads the matching foil `.h5ad` and recomputes every
// statistic. Here we describe just the structural surface the intake and fields
// screens need (dataset metadata, the load-bearing claims, and the resolved obs
// roles) plus each scenario's default knob state. Any attempt to draw fixture
// numbers for them throws (see `verifyFull`/`verifyReasoning`).
//
// Voice: no em dashes. The middot `·` is a separator, not punctuation.
// ---------------------------------------------------------------------------

// --- pfc: PFC psilocybin, the generalization foil (renamed columns) ----------

const pfcDataset: DatasetMeta = {
  file: 'caseB_pfc_foil.h5ad',
  label: 'pfc',
  title: 'Prefrontal cortex · psilocybin vs vehicle · snRNA-seq',
  cells: 1140,
  genes: 241,
  replicates: 6,
  replicateLabel: 'patients',
  fieldCount: 8,
  sizeGB: 0.01,
};

const pfcClaims: Claim[] = [
  {
    id: 'c1',
    text: 'Psilocybin significantly upregulates GENEX across cortical cells (p < 0.001).',
    check: 1,
  },
  { id: 'c2', text: 'A reactive glial state defined by 4 markers, enriched after psilocybin.', check: 2 },
  { id: 'c3', text: 'A distinct psilocybin-responsive cell state.', check: 3 },
  { id: 'c4', text: 'Differential expression between psilocybin and vehicle.', check: 4 },
];

const pfcFields: FieldSpec[] = [
  {
    id: 'patient',
    dtype: 'categorical',
    levels: 6,
    missing: 0,
    sample: 'P1 · P2 · P3 · P4 · P5 · P6',
    role: 'unit',
    confidence: 'high',
    reason: '6 unique values. Psilocybin is given per patient and cells nest inside, so this is the true replicate.',
  },
  {
    id: 'treatment',
    dtype: 'categorical',
    levels: 2,
    missing: 0,
    sample: 'vehicle · psilocybin',
    role: 'grouping',
    confidence: 'high',
    reason: 'Two levels, vehicle and psilocybin. This is the contrast the analysis compares.',
  },
  {
    id: 'batch',
    dtype: 'categorical',
    levels: 2,
    missing: 0,
    sample: 'batch-1 · batch-2',
    role: 'nuisance',
    confidence: 'medium',
    reason: 'Technical processing batch. Its two levels may track treatment, so Check 4 tests it for confounding.',
  },
  {
    id: 'sample',
    dtype: 'identifier',
    levels: 1140,
    missing: 0,
    role: 'observation',
    confidence: 'high',
    reason: 'One per nucleus, roughly 190 per patient. Rows are measurements, not independent samples.',
  },
  {
    id: 'cell_state',
    dtype: 'categorical',
    levels: 3,
    missing: 0,
    role: 'derived',
    confidence: 'medium',
    reason: 'Cluster labels computed after the fact. A derived grouping, not a measured field.',
  },
  {
    id: 'phase',
    dtype: 'categorical',
    levels: 3,
    missing: 0,
    sample: 'G1 · S · G2M',
    role: 'nuisance',
    confidence: 'low',
    reason: 'Cell-cycle phase. Often balanced across treatment, so confirm whether to adjust for it.',
  },
  {
    id: 'n_genes',
    dtype: 'numeric',
    levels: null,
    missing: 0,
    role: 'covariate',
    confidence: 'high',
    reason: 'Per-nucleus quality covariate.',
  },
  {
    id: 'pct_mito',
    dtype: 'numeric',
    levels: null,
    missing: 0,
    role: 'covariate',
    confidence: 'high',
    reason: 'Per-nucleus quality covariate.',
  },
];

// --- clean: a rigorous analysis that must NOT be flagged (never cry wolf) -----

const cleanDataset: DatasetMeta = {
  file: 'caseC_clean.h5ad',
  label: 'clean',
  title: 'Rigorous analysis · control vs treated · scRNA-seq',
  cells: 1140,
  genes: 109,
  replicates: 6,
  replicateLabel: 'donors',
  fieldCount: 8,
  sizeGB: 0.01,
};

const cleanClaims: Claim[] = [
  { id: 'c1', text: 'Treated significantly changes REAL1 across cells (donor-consistent).', check: 1 },
  { id: 'c2', text: 'A cell state defined by 4 markers that hold out of sample.', check: 2 },
  { id: 'c3', text: 'A cell state robust across the resolution sweep.', check: 3 },
  { id: 'c4', text: 'Differential expression between treated and control.', check: 4 },
];

const cleanFields: FieldSpec[] = [
  {
    id: 'donor',
    dtype: 'categorical',
    levels: 6,
    missing: 0,
    sample: 'D1 · D2 · D3 · D4 · D5 · D6',
    role: 'unit',
    confidence: 'high',
    reason: '6 unique values. Treatment is applied per donor and cells nest inside, so this is the true replicate.',
  },
  {
    id: 'condition',
    dtype: 'categorical',
    levels: 2,
    missing: 0,
    sample: 'control · treated',
    role: 'grouping',
    confidence: 'high',
    reason: 'Two levels, control and treated. This is the contrast the analysis compares.',
  },
  {
    id: 'batch',
    dtype: 'categorical',
    levels: 2,
    missing: 0,
    sample: 'batch-1 · batch-2',
    role: 'nuisance',
    confidence: 'medium',
    reason: 'Technical batch with two levels. Check 4 tests whether it separates cleanly from condition.',
  },
  {
    id: 'cell_barcode',
    dtype: 'identifier',
    levels: 1140,
    missing: 0,
    role: 'observation',
    confidence: 'high',
    reason: 'One per cell, roughly 190 per donor. Rows are measurements, not independent samples.',
  },
  {
    id: 'cell_state',
    dtype: 'categorical',
    levels: 2,
    missing: 0,
    role: 'derived',
    confidence: 'medium',
    reason: 'Cluster labels computed from the data. A derived grouping, not a measured field.',
  },
  {
    id: 'phase',
    dtype: 'categorical',
    levels: 3,
    missing: 0,
    sample: 'G1 · S · G2M',
    role: 'nuisance',
    confidence: 'low',
    reason: 'Cell-cycle phase. Usually balanced across condition, so confirm whether to adjust for it.',
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
];

// --- nocounts: normalized values only, no raw integer counts -----------------

const nocountsDataset: DatasetMeta = {
  file: 'caseD_nocounts.h5ad',
  label: 'nocounts',
  title: 'Normalized values only · no raw counts · scRNA-seq',
  cells: 720,
  genes: 87,
  replicates: 4,
  replicateLabel: 'donors',
  fieldCount: 8,
  sizeGB: 0.01,
};

const nocountsClaims: Claim[] = [
  { id: 'c1', text: 'Treatment significantly upregulates GENEX across cells (p < 0.001).', check: 1 },
  { id: 'c2', text: 'A treatment-enriched cell state defined by 4 markers.', check: 2 },
  { id: 'c3', text: 'A distinct treatment-responsive cell state.', check: 3 },
  { id: 'c4', text: 'Differential expression between treated and control.', check: 4 },
];

const nocountsFields: FieldSpec[] = [
  {
    id: 'donor_id',
    dtype: 'categorical',
    levels: 4,
    missing: 0,
    sample: 'D1 · D2 · D3 · D4',
    role: 'unit',
    confidence: 'high',
    reason: '4 unique values. Treatment is applied per donor and cells nest inside, so this is the true replicate.',
  },
  {
    id: 'condition',
    dtype: 'categorical',
    levels: 2,
    missing: 0,
    sample: 'control · treated',
    role: 'grouping',
    confidence: 'high',
    reason: 'Two levels, control and treated. This is the contrast the analysis compares.',
  },
  {
    id: 'lane',
    dtype: 'categorical',
    levels: 2,
    missing: 0,
    sample: 'Lane-A · Lane-B',
    role: 'nuisance',
    confidence: 'medium',
    reason: 'Sequencing lane, a technical variable. Check 4 tests whether it aligns with condition.',
  },
  {
    id: 'cell_barcode',
    dtype: 'identifier',
    levels: 720,
    missing: 0,
    role: 'observation',
    confidence: 'high',
    reason: 'One per cell, roughly 180 per donor. Rows are measurements, not independent samples.',
  },
  {
    id: 'cell_state',
    dtype: 'categorical',
    levels: 2,
    missing: 0,
    role: 'derived',
    confidence: 'medium',
    reason: 'Cluster labels computed after the fact. A derived grouping, not a measured field.',
  },
  {
    id: 'phase',
    dtype: 'categorical',
    levels: 3,
    missing: 0,
    sample: 'G1 · S · G2M',
    role: 'nuisance',
    confidence: 'low',
    reason: 'Cell-cycle phase. Often balanced across condition, so confirm whether to adjust for it.',
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
];

// --- defaults ----------------------------------------------------------------

/**
 * The shared default knob state for a verification foil. Check 2 always splits
 * 50/50 on the derived `cell_state`, and Check 3 sweeps the same resolution
 * grid; only the resolved unit, the compared grouping, the tracked group, and
 * the nuisance candidates differ per scenario. Check 4's variable of interest is
 * the grouping itself (the confound check asks whether that grouping is
 * separable from the technical columns).
 */
export function verifyDefaults(opts: {
  unit: string;
  grouping: string;
  track: string;
  nuisance: string[];
}): CheckConfigMap {
  return {
    1: { unit: opts.unit, grouping: opts.grouping, alpha: 0.05 },
    2: { split: 0.5, grouping: 'cell_state' },
    3: { min: 0.2, max: 2.0, step: 0.2, track: opts.track, scrub: 1.0 },
    4: { interest: opts.grouping, nuisance: opts.nuisance },
  };
}

export const pfcDefaults: CheckConfigMap = verifyDefaults({
  unit: 'patient',
  grouping: 'treatment',
  track: 'Reactive',
  nuisance: ['batch'],
});

export const cleanDefaults: CheckConfigMap = verifyDefaults({
  unit: 'donor',
  grouping: 'condition',
  track: 'Rare',
  nuisance: ['batch'],
});

export const nocountsDefaults: CheckConfigMap = verifyDefaults({
  unit: 'donor_id',
  grouping: 'condition',
  track: 'Naive',
  nuisance: ['lane'],
});

// --- scenarios ---------------------------------------------------------------

export const pfcScenario: Scenario = {
  id: 'pfc',
  name: 'PFC psilocybin (generalization foil)',
  dataset: pfcDataset,
  claims: pfcClaims,
  fields: pfcFields,
};

export const cleanScenario: Scenario = {
  id: 'clean',
  name: 'Clean analysis (never cry wolf)',
  dataset: cleanDataset,
  claims: cleanClaims,
  fields: cleanFields,
};

export const nocountsScenario: Scenario = {
  id: 'nocounts',
  name: 'Normalized only (no raw counts)',
  dataset: nocountsDataset,
  claims: nocountsClaims,
  fields: nocountsFields,
};

// --- local-only stubs --------------------------------------------------------

/** These foils carry no locked fixture numbers; the real numbers only exist on `local`. */
function noFixture(id: ScenarioId): never {
  throw new Error(`scenario '${id}' has no fixture; run it on REDLINE_COMPUTE_TARGET=local`);
}

/** A `full` implementation that refuses to fabricate fixture numbers for a verify foil. */
export function verifyFull(id: ScenarioId): (checkId: CheckId, cfg: unknown) => FullCheck {
  return () => noFixture(id);
}

/** A `reasoning` implementation that refuses to fabricate fixture prose for a verify foil. */
export function verifyReasoning(id: ScenarioId): (checkId: CheckId, cfg: unknown) => string[] {
  return () => noFixture(id);
}
