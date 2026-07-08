import type { ScenarioId } from '@redline/contracts';

/**
 * Scenario-aware knob options for the check panel. These mirror exactly what the
 * engine fixtures branch on per scenario (the proposed independent unit, the
 * observation-level id, and a two-level batch that triggers the hard stop; the
 * claimed vs stable group to track; the nuisance candidates for the confound
 * check). Kept beside the UI because they describe what choices to *offer*; the
 * engine decides what each choice *means*.
 */
export interface KnobOption {
  value: string;
  label: string;
}

export interface ScenarioKnobs {
  units: KnobOption[];
  tracks: KnobOption[];
  nuisance: KnobOption[];
}

const KNOBS: Record<ScenarioId, ScenarioKnobs> = {
  marson: {
    units: [
      { value: 'donor_id', label: 'donor_id · 4 units (proposed)' },
      { value: 'cell_barcode', label: 'cell_barcode · 51,842' },
      { value: 'guide_batch', label: 'guide_batch · 2 units' },
    ],
    tracks: [
      { value: 'Effector', label: 'Effector (the claimed group)' },
      { value: 'Naive', label: 'Naive (a stable group)' },
    ],
    nuisance: [
      { value: 'lane', label: 'lane' },
      { value: 'phase', label: 'phase' },
      { value: 'n_genes', label: 'n_genes' },
    ],
  },
  ketamine: {
    units: [
      { value: 'mouse_id', label: 'mouse_id · 6 units (proposed)' },
      { value: 'cell_barcode', label: 'cell_barcode · 48,213' },
      { value: 'litter_id', label: 'litter_id · 2 units' },
    ],
    tracks: [
      { value: 'Responder', label: 'Responder (the claimed group)' },
      { value: 'Homeostatic', label: 'Homeostatic (a stable group)' },
    ],
    nuisance: [
      { value: 'seq_batch', label: 'seq_batch' },
      { value: 'sex', label: 'sex' },
      { value: 'n_genes', label: 'n_genes' },
    ],
  },
};

export function knobsFor(id: ScenarioId): ScenarioKnobs {
  return KNOBS[id];
}
