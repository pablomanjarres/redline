/**
 * The four verification cases. Each maps a loadable app scenario to its foil
 * oracle and the descriptor the driver uses to set the right knobs. The
 * expected numbers come from the oracle at run time, never hardcoded here.
 */
export type CaseId = 'A' | 'B' | 'C' | 'D';

export interface CaseDef {
  caseId: CaseId;
  scenarioId: 'marson' | 'pfc' | 'clean' | 'nocounts';
  oracleKey: string; // caseA / caseB / caseC / caseD
  label: string;
  unit: string;
  grouping: string;
  nuisance: string;
  /** The near-unique column, for the foundation "unit -> observation" probe (2B). */
  observation: string;
  spurious: string; // the check-3 group the oracle tracks as spurious
  stable: string | null; // the check-3 group the oracle tracks as stable
  focusGene: string;
}

export const CASES: CaseDef[] = [
  {
    caseId: 'A',
    scenarioId: 'marson',
    oracleKey: 'caseA',
    label: 'Marson CD4 T-cell Perturb-seq — naive foil (canonical)',
    unit: 'donor_id',
    grouping: 'condition',
    nuisance: 'lane',
    observation: 'cell_barcode',
    spurious: 'Effector',
    stable: 'Naive',
    focusGene: 'FOXP3',
  },
  {
    caseId: 'B',
    scenarioId: 'pfc',
    oracleKey: 'caseB',
    label: 'PFC psilocybin — generalization (renamed columns)',
    unit: 'patient',
    grouping: 'treatment',
    nuisance: 'batch',
    observation: 'sample',
    spurious: 'Reactive',
    stable: 'Neuron',
    focusGene: 'GENEX',
  },
  {
    caseId: 'C',
    scenarioId: 'clean',
    oracleKey: 'caseC',
    label: 'Clean analysis — never cry wolf',
    unit: 'donor',
    grouping: 'condition',
    nuisance: 'batch',
    observation: 'cell_barcode',
    spurious: 'Rare',
    stable: 'Rare',
    focusGene: 'REAL1',
  },
  {
    caseId: 'D',
    scenarioId: 'nocounts',
    oracleKey: 'caseD',
    label: 'Normalized only — no raw counts (graceful degradation)',
    unit: 'donor_id',
    grouping: 'condition',
    nuisance: 'lane',
    observation: 'cell_barcode',
    spurious: 'Naive',
    stable: null,
    focusGene: 'FOXP3',
  },
];

export const CHECK_NAMES: Record<number, string> = {
  1: 'Pseudoreplication',
  2: 'Double dipping',
  3: 'Clustering fragility',
  4: 'Confounding',
};
