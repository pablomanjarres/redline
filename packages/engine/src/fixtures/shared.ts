import type {
  Citation,
  Interval,
  RoleOption,
  FragilityStep,
  CheckResult,
  ComputeResult,
  Narrative,
  Correction,
  CorrectedCode,
  Recommendation,
  Feasibility,
  VolcanoChart,
  VolcanoPoint,
  FdrChart,
  FdrGene,
} from '@redline/contracts';

/**
 * The full per-(scenario, check, cfg) finding: numbers and prose from one table.
 * `computeCheck` slices its ComputeResult half; `curatedNarrative` slices its
 * Narrative half. Building both from one object is what keeps the demo numbers
 * and the demo copy from ever drifting apart.
 */
export type FullCheck = CheckResult;

/**
 * A repeat-interval literal for the fixtures. These demo intervals are
 * illustrative reference values, the same status as the point estimates they
 * surround: the real numbers come from repeating the stochastic check on the
 * built foil (`services/rigor`, `build_ci_reference.py`), which the fixture
 * cannot run. Their widths are calibrated to a real reference run, never
 * invented, and the Environment page states what is real versus reference.
 */
export function iv(median: number, lo: number, hi: number, n: number, level = 0.95): Interval {
  return { median, lo, hi, level, n };
}

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

type CitKey = 'c1' | 'c2' | 'c3' | 'c4' | 'c5' | 'c6' | 'c7' | 'c8';

// The method papers each check cites. Author, year, venue, and note are the
// locked reference copy (identical for both scenarios). c5 to c8 back the rigor
// checks. c6 reuses Hicks et al. 2018 for the separable case (a technical
// variable that can be modeled), distinct from c4 (a full confound). c7 reuses
// Luecken & Theis 2019 for choosing resolution by a criterion.
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
  c5: {
    authors: 'Benjamini & Hochberg',
    year: 1995,
    venue: 'J. R. Stat. Soc. B',
    note: 'Control the false discovery rate across many tests. A raw p-value is not a discovery.',
  },
  c6: {
    authors: 'Hicks et al.',
    year: 2018,
    venue: 'Biostatistics',
    note: 'A technical variable that is separable from the effect belongs in the model. Leaving it out biases the estimate.',
  },
  c7: {
    authors: 'Luecken & Theis',
    year: 2019,
    venue: 'Molecular Systems Biology',
    note: 'Choose clustering resolution by a stability or quality criterion, not by eye.',
  },
  c8: {
    authors: 'Soneson & Robinson',
    year: 2018,
    venue: 'Nature Methods',
    note: 'Match the test to the count distribution. A t-test on raw counts violates its own assumptions.',
  },
};

// A URL is attached only when it points to the cited paper itself (honest
// sourcing). The others have no matching link in the reference list, so they
// carry no url rather than a mismatch.
const CIT_URL: Partial<Record<CitKey, string>> = {
  c1: 'https://www.researchgate.net/publication/350039694_Confronting_false_discoveries_in_single-cell_differential_expression',
  c5: 'https://doi.org/10.1111/j.2517-6161.1995.tb02031.x',
  c8: 'https://doi.org/10.1038/nmeth.4612',
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

/**
 * Slice the correction half (corrected code, recommendations, preview) out of a
 * full finding. A clean finding carries none of these, so this returns an empty
 * object there and the EngineResult simply has no correction keys.
 */
export function toCorrection(full: FullCheck): Correction {
  const out: Correction = {};
  if (full.correctedCode !== undefined) out.correctedCode = full.correctedCode;
  if (full.recommendations !== undefined) out.recommendations = full.recommendations;
  if (full.preview !== undefined) out.preview = full.preview;
  return out;
}

// ── Correction builders (shared by both scenarios) ───────────────────────────
// Everything Redline recommends or corrects is shown, reproducible, and cited.
// These helpers keep the corrected code, the recommendations, and the preview
// from ever drifting from the numbers, and keep the two scenarios building the
// same shapes from different field names (the Case B generality test).

/** A parameter record injected into a code template. All values are contract-safe. */
export type ScriptParams = Record<string, string | number | boolean | string[] | null>;

/** A runnable CorrectedCode from a template and its injected params. */
export function mkCode(
  filename: string,
  inline: string,
  params: ScriptParams,
): CorrectedCode {
  return {
    language: 'python',
    filename,
    inline,
    entrypoint: `python ${filename} --h5ad ${String(params.h5ad ?? 'data.h5ad')}`,
    params,
  };
}

/** One recommendation. Feasibility is fixed here, never talked up by prose. */
export function rec(
  action: string,
  rationale: string,
  changes: string,
  feasibility: Feasibility,
  citation?: Citation,
): Recommendation {
  return citation
    ? { action, rationale, changes, feasibility, citation }
    : { action, rationale, changes, feasibility };
}

/** A volcano artifact (the corrected downstream figure for a DE finding). */
export function volcano(
  label: string,
  alpha: number,
  fcThreshold: number,
  points: VolcanoPoint[],
): VolcanoChart {
  return {
    kind: 'volcano',
    points,
    alpha,
    fcThreshold,
    nSig: points.filter((p) => p.sig).length,
    label,
  };
}

/** One gene across a before/after correction: its p on each side. */
export interface VolcanoSpec {
  gene: string;
  fc: number;
  before: number; // negLog10P before the correction
  after: number; // negLog10P after the correction
  sigBefore: boolean;
  sigAfter: boolean;
  claimed?: boolean;
}

/**
 * Build the claimed and corrected volcanoes from one terse table, so a DE
 * finding's before/after figures are one edit and cannot drift apart.
 */
export function volcanoPair(
  labelBefore: string,
  labelAfter: string,
  alpha: number,
  fcThreshold: number,
  specs: VolcanoSpec[],
): { before: VolcanoChart; after: VolcanoChart } {
  const before = specs.map((s): VolcanoPoint => {
    const p: VolcanoPoint = { gene: s.gene, log2fc: s.fc, negLog10P: s.before, sig: s.sigBefore };
    if (s.claimed) p.claimed = true;
    return p;
  });
  const after = specs.map((s): VolcanoPoint => {
    const p: VolcanoPoint = { gene: s.gene, log2fc: s.fc, negLog10P: s.after, sig: s.sigAfter };
    if (s.claimed) p.claimed = true;
    return p;
  });
  return {
    before: volcano(labelBefore, alpha, fcThreshold, before),
    after: volcano(labelAfter, alpha, fcThreshold, after),
  };
}

/** An FDR artifact (raw hits vs how many survive an adjustment). */
export function fdr(
  tests: number,
  alpha: number,
  rawHits: number,
  adjustedHits: number,
  method: 'bh' | 'by',
  top: FdrGene[],
): FdrChart {
  return { kind: 'fdr', tests, alpha, rawHits, adjustedHits, method, top };
}

/**
 * A resolution sweep for Check 7: the same steps as Check 3, plus a silhouette
 * score that peaks inside the supported window and falls off outside it, so the
 * chosen setting can be read against the criterion.
 */
export function buildResolutionSteps(
  min: number,
  max: number,
  step: number,
  supported: [number, number],
): FragilityStep[] {
  const center = (supported[0] + supported[1]) / 2;
  const steps: FragilityStep[] = [];
  for (let r = min; r <= max + 1e-9; r += step) {
    const v = Math.round(r * 100) / 100;
    const inside = v >= supported[0] - 1e-9 && v <= supported[1] + 1e-9;
    const sil = Math.max(0.1, Math.round((0.55 - 0.6 * Math.min(0.6, Math.abs(v - center))) * 1000) / 1000);
    steps.push({
      r: v,
      present: inside,
      clusters: Math.max(4, Math.round(4 + v * 5)),
      silhouette: sil,
    });
  }
  return steps;
}

// ── The eight code templates ─────────────────────────────────────────────────
// Each emitted script takes --h5ad PATH (default from params), runs the honest
// re-analysis, and prints as its LAST line:
//     REDLINE_RESULT {"original": ..., "corrected": ...}
// whose keys are exactly that check's reported numbers. On an unsalvageable
// finding the script prints the non-separability verdict and "corrected": null
// plus "unsalvageable": true, and never a fabricated number.

const py = {
  head(title: string, why: string): string {
    return `"""${title}\n\n${why}\n"""\nimport argparse, json\n`;
  },
  arr(xs: string[]): string {
    return '[' + xs.map((x) => JSON.stringify(x)).join(', ') + ']';
  },
};

export function script1(p: {
  h5ad: string;
  unit: string;
  grouping: string;
  ref: string;
  alt: string;
  gene: string;
  covariates: string[];
  alpha: number;
}): string {
  return (
    py.head(
      'Pseudoreplication re-test: aggregate to the independent unit, then test.',
      `Redline flagged a per-cell p-value. This reproduces the honest result:\ncollapse cells to one value per ${p.unit}, then test ${p.alt} against ${p.ref}\nat the unit level. Cells inside a unit are correlated, so a per-cell test\ncounts them as independent replicates and inflates significance.`,
    ) +
    `\nH5AD = ${JSON.stringify(p.h5ad)}\nUNIT = ${JSON.stringify(p.unit)}\nGROUPING = ${JSON.stringify(p.grouping)}\nREF, ALT = ${JSON.stringify(p.ref)}, ${JSON.stringify(p.alt)}\nGENE = ${JSON.stringify(p.gene)}\nALPHA = ${p.alpha}\n\n` +
    `def main(h5ad):\n` +
    `    import anndata as ad, numpy as np\n` +
    `    from scipy import stats\n` +
    `    a = ad.read_h5ad(h5ad)\n` +
    `    x = a[:, GENE].X\n` +
    `    expr = np.asarray(x.todense()).ravel() if hasattr(x, "todense") else np.asarray(x).ravel()\n` +
    `    obs = a.obs[[UNIT, GROUPING]].copy()\n` +
    `    obs["expr"] = expr\n` +
    `    cells_alt = obs[obs[GROUPING] == ALT]["expr"].to_numpy()\n` +
    `    cells_ref = obs[obs[GROUPING] == REF]["expr"].to_numpy()\n` +
    `    naive_p = float(stats.ttest_ind(cells_alt, cells_ref, equal_var=False).pvalue)\n` +
    `    per_unit = obs.groupby([UNIT, GROUPING], observed=True)["expr"].mean().reset_index()\n` +
    `    u_alt = per_unit[per_unit[GROUPING] == ALT]["expr"].to_numpy()\n` +
    `    u_ref = per_unit[per_unit[GROUPING] == REF]["expr"].to_numpy()\n` +
    `    honest_p = float(stats.ttest_ind(u_alt, u_ref, equal_var=False).pvalue)\n` +
    `    print(f"naive per-cell p = {naive_p:.2e} over {len(obs)} cells")\n` +
    `    print(f"honest {UNIT}-level p = {honest_p:.3g} over {len(per_unit)} units")\n` +
    `    print("REDLINE_RESULT " + json.dumps({"original": naive_p, "corrected": honest_p}))\n\n` +
    `if __name__ == "__main__":\n` +
    `    ap = argparse.ArgumentParser()\n` +
    `    ap.add_argument("--h5ad", default=H5AD)\n` +
    `    main(ap.parse_args().h5ad)\n`
  );
}

export function script2(p: {
  h5ad: string;
  grouping: string;
  target_group: string;
  markers: string[];
  split: number;
  seed: number;
}): string {
  return (
    py.head(
      'Double-dipping re-test: validate markers on held-out cells.',
      `Redline flagged a group whose markers were chosen and tested on the same\ncells. This splits the cells, fits the ${p.markers.length} markers on the discovery\nhalf, and scores their separation (AUC) on held-out cells they never saw.`,
    ) +
    `\nH5AD = ${JSON.stringify(p.h5ad)}\nGROUPING = ${JSON.stringify(p.grouping)}\nTARGET = ${JSON.stringify(p.target_group)}\nMARKERS = ${py.arr(p.markers)}\nSPLIT = ${p.split}\nSEED = ${p.seed}\n\n` +
    `def main(h5ad):\n` +
    `    import anndata as ad, numpy as np\n` +
    `    from sklearn.metrics import roc_auc_score\n` +
    `    rng = np.random.default_rng(SEED)\n` +
    `    a = ad.read_h5ad(h5ad)\n` +
    `    y = (a.obs[GROUPING].astype(str) == TARGET).to_numpy().astype(int)\n` +
    `    X = a[:, MARKERS].X\n` +
    `    X = np.asarray(X.todense()) if hasattr(X, "todense") else np.asarray(X)\n` +
    `    idx = rng.permutation(len(y))\n` +
    `    cut = int(len(y) * (1 - SPLIT))\n` +
    `    tr, te = idx[:cut], idx[cut:]\n` +
    `    w = X[tr][y[tr] == 1].mean(0) - X[tr][y[tr] == 0].mean(0)\n` +
    `    disc = float(roc_auc_score(y[tr], X[tr] @ w))\n` +
    `    hold = float(roc_auc_score(y[te], X[te] @ w))\n` +
    `    print(f"discovery AUC = {disc:.2f}, held-out AUC = {hold:.2f}")\n` +
    `    print("REDLINE_RESULT " + json.dumps({"original": round(disc, 4), "corrected": round(hold, 4)}))\n\n` +
    `if __name__ == "__main__":\n` +
    `    ap = argparse.ArgumentParser()\n` +
    `    ap.add_argument("--h5ad", default=H5AD)\n` +
    `    main(ap.parse_args().h5ad)\n`
  );
}

export function script3(p: {
  h5ad: string;
  track: string;
  track_column: string;
  min: number;
  max: number;
  step: number;
  seed: number;
}): string {
  return (
    py.head(
      'Fragility sweep: does the tracked group survive a range of resolutions.',
      `Redline flagged a cluster that appears at one setting and vanishes at the\nnext. This re-clusters across resolutions and reports the fraction of settings\nwhere ${p.track} is a discrete cluster. A stable population is present everywhere.`,
    ) +
    `\nH5AD = ${JSON.stringify(p.h5ad)}\nTRACK = ${JSON.stringify(p.track)}\nTRACK_COLUMN = ${JSON.stringify(p.track_column)}\nGRID = (${p.min}, ${p.max}, ${p.step})\nSEED = ${p.seed}\n\n` +
    `def main(h5ad):\n` +
    `    import anndata as ad, numpy as np, scanpy as sc\n` +
    `    a = ad.read_h5ad(h5ad)\n` +
    `    if "neighbors" not in a.uns:\n` +
    `        sc.pp.neighbors(a, random_state=SEED)\n` +
    `    lo, hi, st = GRID\n` +
    `    settings = np.round(np.arange(lo, hi + 1e-9, st), 2)\n` +
    `    present = 0\n` +
    `    for r in settings:\n` +
    `        sc.tl.leiden(a, resolution=float(r), key_added="_rl", random_state=SEED)\n` +
    `        overlap = a.obs.groupby("_rl", observed=True).apply(lambda g: (g[TRACK_COLUMN].astype(str) == TRACK).mean())\n` +
    `        present += int((overlap > 0.5).any())\n` +
    `    stability = present / len(settings)\n` +
    `    print(f"{TRACK} present in {present} of {len(settings)} settings ({stability:.0%})")\n` +
    `    print("REDLINE_RESULT " + json.dumps({"original": int(present > 0), "corrected": round(float(stability), 4)}))\n\n` +
    `if __name__ == "__main__":\n` +
    `    ap = argparse.ArgumentParser()\n` +
    `    ap.add_argument("--h5ad", default=H5AD)\n` +
    `    main(ap.parse_args().h5ad)\n`
  );
}

export function script4(p: {
  h5ad: string;
  interest: string;
  technical: string;
  separable: boolean;
}): string {
  return (
    py.head(
      'Separability check: is the comparison confounded with a technical variable.',
      `Redline flagged that ${p.interest} lines up with ${p.technical}. This measures\ntheir association (Cramer's V). At V = 1.00 the two are the same split and no\nmodel can separate them, so there is no valid corrected effect to report. The\nscript proves the dead end rather than inventing a fix.`,
    ) +
    `\nH5AD = ${JSON.stringify(p.h5ad)}\nINTEREST = ${JSON.stringify(p.interest)}\nTECHNICAL = ${JSON.stringify(p.technical)}\n\n` +
    `def cramers_v(tab):\n` +
    `    import numpy as np\n` +
    `    from scipy.stats import chi2_contingency\n` +
    `    chi2 = chi2_contingency(tab)[0]\n` +
    `    n = tab.sum()\n` +
    `    r, k = tab.shape\n` +
    `    return float(np.sqrt((chi2 / n) / (min(r, k) - 1)))\n\n` +
    `def main(h5ad):\n` +
    `    import anndata as ad, pandas as pd\n` +
    `    a = ad.read_h5ad(h5ad)\n` +
    `    tab = pd.crosstab(a.obs[INTEREST], a.obs[TECHNICAL]).to_numpy()\n` +
    `    v = cramers_v(tab)\n` +
    `    separable = v < 0.999\n` +
    `    if not separable:\n` +
    `        print(f"{INTEREST} and {TECHNICAL} are perfectly confounded (Cramer's V = {v:.2f}).")\n` +
    `        print("No effect can be separated from this data. This is unsalvageable.")\n` +
    `        print("REDLINE_RESULT " + json.dumps({"original": round(v, 4), "corrected": None, "unsalvageable": True}))\n` +
    `        return\n` +
    `    print(f"Cramer's V = {v:.2f}. The variables are separable and can be co-modeled.")\n` +
    `    print("REDLINE_RESULT " + json.dumps({"original": round(v, 4), "corrected": round(v, 4), "unsalvageable": False}))\n\n` +
    `if __name__ == "__main__":\n` +
    `    ap = argparse.ArgumentParser()\n` +
    `    ap.add_argument("--h5ad", default=H5AD)\n` +
    `    main(ap.parse_args().h5ad)\n`
  );
}

export function script5(p: {
  h5ad: string;
  unit: string;
  grouping: string;
  ref: string;
  alt: string;
  alpha: number;
  method: string;
  tests: number;
}): string {
  return (
    py.head(
      'Multiple-testing correction: how many raw hits survive FDR control.',
      `Redline flagged significance claimed on raw p-values across many genes. This\nre-tests every gene at the ${p.unit} level (${p.alt} vs ${p.ref}), then applies\nBenjamini-Hochberg at q < ${p.alpha}. A raw p-value is not a discovery.`,
    ) +
    `\nH5AD = ${JSON.stringify(p.h5ad)}\nUNIT = ${JSON.stringify(p.unit)}\nGROUPING = ${JSON.stringify(p.grouping)}\nREF, ALT = ${JSON.stringify(p.ref)}, ${JSON.stringify(p.alt)}\nALPHA = ${p.alpha}\nMETHOD = ${JSON.stringify(p.method)}\n\n` +
    `def main(h5ad):\n` +
    `    import anndata as ad, numpy as np\n` +
    `    from scipy import stats\n` +
    `    from statsmodels.stats.multitest import multipletests\n` +
    `    a = ad.read_h5ad(h5ad)\n` +
    `    X = a.X\n` +
    `    X = np.asarray(X.todense()) if hasattr(X, "todense") else np.asarray(X)\n` +
    `    units = a.obs[UNIT].astype(str).to_numpy()\n` +
    `    grp = a.obs[GROUPING].astype(str).to_numpy()\n` +
    `    import pandas as pd\n` +
    `    df = pd.DataFrame(X, columns=[str(g) for g in a.var_names])\n` +
    `    df["_u"], df["_g"] = units, grp\n` +
    `    means = df.groupby(["_u", "_g"], observed=True).mean()\n` +
    `    a_rows = means.xs(ALT, level="_g").to_numpy()\n` +
    `    r_rows = means.xs(REF, level="_g").to_numpy()\n` +
    `    p = np.array([stats.ttest_ind(a_rows[:, j], r_rows[:, j], equal_var=False).pvalue for j in range(a_rows.shape[1])])\n` +
    `    p = np.nan_to_num(p, nan=1.0)\n` +
    `    raw = int((p < ALPHA).sum())\n` +
    `    q = multipletests(p, alpha=ALPHA, method=("fdr_by" if METHOD == "by" else "fdr_bh"))[1]\n` +
    `    adj = int((q < ALPHA).sum())\n` +
    `    print(f"{raw} genes significant on raw p, {adj} survive {METHOD.upper()} at q < {ALPHA}")\n` +
    `    print("REDLINE_RESULT " + json.dumps({"original": raw, "corrected": adj}))\n\n` +
    `if __name__ == "__main__":\n` +
    `    ap = argparse.ArgumentParser()\n` +
    `    ap.add_argument("--h5ad", default=H5AD)\n` +
    `    main(ap.parse_args().h5ad)\n`
  );
}

export function script6(p: {
  h5ad: string;
  interest: string;
  covariate: string;
  ref: string;
  alt: string;
  unit: string;
  alpha: number;
}): string {
  return (
    py.head(
      'Unmodeled covariate: add the known batch structure and re-test.',
      `Redline flagged a separable covariate (${p.covariate}) left out of the model.\nThis fits the ${p.unit}-level effect of ${p.interest} without and then with\n${p.covariate} as a covariate, and reports how the p-value moves once it is\nmodeled. A separable covariate belongs in the model.`,
    ) +
    `\nH5AD = ${JSON.stringify(p.h5ad)}\nINTEREST = ${JSON.stringify(p.interest)}\nCOVARIATE = ${JSON.stringify(p.covariate)}\nREF, ALT = ${JSON.stringify(p.ref)}, ${JSON.stringify(p.alt)}\nUNIT = ${JSON.stringify(p.unit)}\nALPHA = ${p.alpha}\n\n` +
    `def main(h5ad):\n` +
    `    import anndata as ad, numpy as np, pandas as pd\n` +
    `    import statsmodels.formula.api as smf\n` +
    `    a = ad.read_h5ad(h5ad)\n` +
    `    score = np.asarray(a.obs.get("_de_score", a.X[:, 0])).ravel()\n` +
    `    d = a.obs[[UNIT, INTEREST, COVARIATE]].copy()\n` +
    `    d["y"] = score\n` +
    `    agg = d.groupby([UNIT, INTEREST, COVARIATE], observed=True)["y"].mean().reset_index()\n` +
    `    naive = smf.ols("y ~ C(%s)" % INTEREST, data=agg).fit()\n` +
    `    full = smf.ols("y ~ C(%s) + C(%s)" % (INTEREST, COVARIATE), data=agg).fit()\n` +
    `    key = [c for c in naive.pvalues.index if INTEREST in c][0]\n` +
    `    naive_p = float(naive.pvalues[key])\n` +
    `    full_p = float(full.pvalues[[c for c in full.pvalues.index if INTEREST in c][0]])\n` +
    `    print(f"effect p without {COVARIATE} = {naive_p:.3g}, with {COVARIATE} = {full_p:.3g}")\n` +
    `    print("REDLINE_RESULT " + json.dumps({"original": naive_p, "corrected": full_p}))\n\n` +
    `if __name__ == "__main__":\n` +
    `    ap = argparse.ArgumentParser()\n` +
    `    ap.add_argument("--h5ad", default=H5AD)\n` +
    `    main(ap.parse_args().h5ad)\n`
  );
}

export function script7(p: {
  h5ad: string;
  min: number;
  max: number;
  step: number;
  criterion: string;
  chosen: number;
  seed: number;
}): string {
  return (
    py.head(
      'Resolution choice: score the sweep and pick by a criterion.',
      `Redline flagged a cluster count chosen without a stability criterion. This\nre-clusters across resolutions, scores each by ${p.criterion}, and reports the\nchosen setting beside the one the criterion supports.`,
    ) +
    `\nH5AD = ${JSON.stringify(p.h5ad)}\nGRID = (${p.min}, ${p.max}, ${p.step})\nCRITERION = ${JSON.stringify(p.criterion)}\nCHOSEN = ${p.chosen}\nSEED = ${p.seed}\n\n` +
    `def main(h5ad):\n` +
    `    import anndata as ad, numpy as np, scanpy as sc\n` +
    `    from sklearn.metrics import silhouette_score\n` +
    `    a = ad.read_h5ad(h5ad)\n` +
    `    if "X_pca" not in a.obsm:\n` +
    `        sc.pp.pca(a, random_state=SEED)\n` +
    `    if "neighbors" not in a.uns:\n` +
    `        sc.pp.neighbors(a, random_state=SEED)\n` +
    `    lo, hi, st = GRID\n` +
    `    best_r, best_s = None, -1.0\n` +
    `    chosen_s = None\n` +
    `    for r in np.round(np.arange(lo, hi + 1e-9, st), 2):\n` +
    `        sc.tl.leiden(a, resolution=float(r), key_added="_rl", random_state=SEED)\n` +
    `        labels = a.obs["_rl"].to_numpy()\n` +
    `        s = float(silhouette_score(a.obsm["X_pca"], labels)) if len(set(labels)) > 1 else -1.0\n` +
    `        if abs(float(r) - CHOSEN) < 1e-9:\n` +
    `            chosen_s = s\n` +
    `        if s > best_s:\n` +
    `            best_r, best_s = float(r), s\n` +
    `    print(f"chosen resolution {CHOSEN} scores {chosen_s:.3f}; best by {CRITERION} is {best_r} at {best_s:.3f}")\n` +
    `    print("REDLINE_RESULT " + json.dumps({"original": round(float(chosen_s), 4), "corrected": round(float(best_s), 4)}))\n\n` +
    `if __name__ == "__main__":\n` +
    `    ap = argparse.ArgumentParser()\n` +
    `    ap.add_argument("--h5ad", default=H5AD)\n` +
    `    main(ap.parse_args().h5ad)\n`
  );
}

export function script8(p: {
  h5ad: string;
  grouping: string;
  ref: string;
  alt: string;
  unit: string;
  claimed_test: string;
  alpha: number;
}): string {
  return (
    py.head(
      'Test assumptions: replace a t-test on raw counts with a count-aware test.',
      `Redline flagged a ${p.claimed_test} run on raw counts, which are overdispersed\nand not normal. This re-tests ${p.alt} vs ${p.ref} at the ${p.unit} level with a\nWilcoxon rank-sum test and reports both p-values.`,
    ) +
    `\nH5AD = ${JSON.stringify(p.h5ad)}\nGROUPING = ${JSON.stringify(p.grouping)}\nREF, ALT = ${JSON.stringify(p.ref)}, ${JSON.stringify(p.alt)}\nUNIT = ${JSON.stringify(p.unit)}\nCLAIMED = ${JSON.stringify(p.claimed_test)}\nALPHA = ${p.alpha}\n\n` +
    `def main(h5ad):\n` +
    `    import anndata as ad, numpy as np\n` +
    `    from scipy import stats\n` +
    `    a = ad.read_h5ad(h5ad)\n` +
    `    score = np.asarray(a.obs.get("_de_score", a.X[:, 0])).ravel()\n` +
    `    obs = a.obs[[UNIT, GROUPING]].copy()\n` +
    `    obs["y"] = score\n` +
    `    per = obs.groupby([UNIT, GROUPING], observed=True)["y"].mean().reset_index()\n` +
    `    ua = per[per[GROUPING] == ALT]["y"].to_numpy()\n` +
    `    ur = per[per[GROUPING] == REF]["y"].to_numpy()\n` +
    `    ttest_p = float(stats.ttest_ind(ua, ur, equal_var=False).pvalue)\n` +
    `    wilcox_p = float(stats.mannwhitneyu(ua, ur, alternative="two-sided").pvalue)\n` +
    `    disp = float(np.var(score) / max(np.mean(score), 1e-9))\n` +
    `    print(f"overdispersion (var/mean) = {disp:.1f}")\n` +
    `    print(f"claimed {CLAIMED} p = {ttest_p:.3g}, Wilcoxon p = {wilcox_p:.3g}")\n` +
    `    print("REDLINE_RESULT " + json.dumps({"original": ttest_p, "corrected": wilcox_p}))\n\n` +
    `if __name__ == "__main__":\n` +
    `    ap = argparse.ArgumentParser()\n` +
    `    ap.add_argument("--h5ad", default=H5AD)\n` +
    `    main(ap.parse_args().h5ad)\n`
  );
}
