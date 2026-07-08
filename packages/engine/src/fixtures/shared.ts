import type {
  Citation,
  RoleOption,
  FragilityStep,
  CheckResult,
  ComputeResult,
  Narrative,
} from '@redline/contracts';

/**
 * The full per-(scenario, check, cfg) finding: numbers and prose from one table.
 * `computeCheck` slices its ComputeResult half; `curatedNarrative` slices its
 * Narrative half. Building both from one object is what keeps the demo numbers
 * and the demo copy from ever drifting apart.
 */
export type FullCheck = CheckResult;

/** Thousands-grouped integer, locale-independent so it is identical on any runtime. */
export function groupInt(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * The resolution sweep shared by every scenario's Check 3. A group is "present"
 * at a setting when the setting falls inside its present-range; the tracked
 * artifact appears in a narrow band, a stable population appears everywhere.
 */
export function buildSteps(
  min: number,
  max: number,
  step: number,
  present: [number, number],
): FragilityStep[] {
  const steps: FragilityStep[] = [];
  for (let r = min; r <= max + 1e-9; r += step) {
    const v = Math.round(r * 100) / 100;
    steps.push({
      r: v,
      present: v >= present[0] - 1e-9 && v <= present[1] + 1e-9,
      clusters: Math.max(4, Math.round(4 + v * 5)),
    });
  }
  return steps;
}

/** Role choices for the field editor. Every value is a real FieldRole. */
export const ROLE_OPTIONS: RoleOption[] = [
  { value: 'unit', label: 'Independent unit' },
  { value: 'grouping', label: 'Grouping compared' },
  { value: 'observation', label: 'Observation (not independent)' },
  { value: 'nuisance', label: 'Nuisance / technical' },
  { value: 'covariate', label: 'Technical covariate' },
  { value: 'derived', label: 'Derived grouping' },
  { value: 'ignore', label: 'Ignore' },
];

type CitKey = 'c1' | 'c2' | 'c3' | 'c4';

// The method papers each pillar cites. Author, year, venue, and note are the
// locked reference copy (identical for both scenarios).
const CIT_BASE: Record<CitKey, Omit<Citation, 'url'>> = {
  c1: {
    authors: 'Squair et al.',
    year: 2021,
    venue: 'Nature Communications',
    note: 'Aggregate correlated cells to the independent unit (pseudobulk) before testing.',
  },
  c2: {
    authors: 'Gao, Bien & Witten',
    year: 2022,
    venue: 'J. Amer. Stat. Assoc.',
    note: 'Features chosen to define a cluster must be validated on data held out from that choice.',
  },
  c3: {
    authors: 'Luecken & Theis',
    year: 2019,
    venue: 'Molecular Systems Biology',
    note: 'Report cluster stability across resolutions; unstable clusters are not discrete populations.',
  },
  c4: {
    authors: 'Hicks et al.',
    year: 2018,
    venue: 'Biostatistics',
    note: 'An effect perfectly aligned with a technical variable is not identifiable; balance the design.',
  },
};

// A URL is attached only when it points to the cited paper itself (honest
// sourcing). Squair et al. 2021 is in the master-brief reference list; the other
// three have no matching link there, so they carry no url rather than a mismatch.
const CIT_URL: Partial<Record<CitKey, string>> = {
  c1: 'https://www.researchgate.net/publication/350039694_Confronting_false_discoveries_in_single-cell_differential_expression',
};

/** A fresh Citation, optionally enriched with its reference-list URL. */
export function cit(key: CitKey, withUrl = false): Citation {
  const base = CIT_BASE[key];
  const url = withUrl ? CIT_URL[key] : undefined;
  return url ? { ...base, url } : { ...base };
}

/** Slice the compute half (numbers, chart, verdict) out of a full finding. */
export function toCompute(full: FullCheck): ComputeResult {
  return {
    checkId: full.checkId,
    state: full.state,
    headline: full.headline,
    stats: full.stats,
    chart: full.chart,
  };
}

/** Slice the prose half (failure mode, citation, rewrite) out of a full finding. */
export function toNarrative(full: FullCheck): Narrative {
  const base: Narrative = {
    error: full.error,
    citation: full.citation,
    original: full.original,
    corrected: full.corrected,
  };
  return full.missing !== undefined ? { ...base, missing: full.missing } : base;
}
