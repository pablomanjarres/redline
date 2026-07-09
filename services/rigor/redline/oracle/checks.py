"""Independent recomputation of the four rigor checks: the answer key.

Each check here is a clean-room reimplementation of the statistic the app engine
runs, so agreement between this oracle and ``redline.pillars`` is a real cross
check rather than the same code graded against itself. This module imports only
numpy, scipy, scikit-learn, anndata, and scanpy, plus the sibling ``dataio`` and
``descriptor`` helpers. It never imports ``redline.pillars``, ``redline.audit``,
or ``redline.job_runner``.

The four emit shapes:

- Check 1 (pseudoreplication): ``{naiveP, honestP, n, icc, verdict}``. Naive is a
  Welch t across all cells by group on the focus gene; honest is a Welch t across
  the per-unit means; ICC is between-unit variance over total variance. Verdict
  is ``hard_stop`` when a group has fewer than two units, ``flag_only`` when there
  are no raw integer counts to run the honest re-test, ``flagged`` when the naive
  test is significant and the honest one is not, else ``clean``.
- Check 2 (double dipping): ``{discAUC, holdAUC, markersHolding, nMarkers,
  verdict}``. Poisson count-split the counts, fit a difference-of-means marker
  score on the discovery half, and read its AUC on the discovery cells and on the
  held-out half. ``markersHolding`` counts the given markers that still separate
  the group out of sample. Verdict is ``flagged`` when the held-out AUC drops
  below 0.62, ``flag_only`` when the split cannot run (no raw counts, held-out
  half too small, no markers), else ``clean``.
- Check 3 (fragility): per tracked group ``{group, stability, settings,
  totalSettings, presentRange, verdict}``. Sweep the clustering resolution and
  mark a setting present when a single cluster covers at least half the group and
  is at least half pure. Verdict is ``flagged`` when the group is present in
  fewer than 80 percent of settings.
- Check 4 (confounding): ``{cramersV, rankDeficient, separable, verdict}``.
  Cramer's V between the grouping and the nuisance column, plus a design-matrix
  rank-deficiency test. Verdict is ``flagged`` when V is at least 0.995 or the
  design is rank deficient.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Optional

import numpy as np

from .dataio import gene_index, get_counts, get_X, load_adata, obs_column
from .descriptor import Descriptor

# Verdict boundaries. Reached independently; they match the app engine so the two
# grade the same foil the same way.
ALPHA_DEFAULT = 0.05
SPLIT_DEFAULT = 0.5
RES_MIN_DEFAULT = 0.2
RES_MAX_DEFAULT = 2.0
RES_STEP_DEFAULT = 0.2
MARKERS_K_DEFAULT = 4
SEED_DEFAULT = 0
CLUSTER_METHOD_DEFAULT = "leiden"
MIN_COVERAGE_DEFAULT = 0.5
MIN_PURITY_DEFAULT = 0.5
STABLE_FRACTION_DEFAULT = 0.8

SURVIVE_AUC = 0.60  # a single marker still separates the group out of sample
CLEAN_HOLD_AUC = 0.62  # the group as a whole is real if held-out AUC stays here
NESTED_V = 0.995  # at/above this Cramer's V the split is inseparable
MIN_HELDOUT_CELLS = 20  # below this the held-out half is too small to trust


@dataclass
class Settings:
    """The resolved knobs for one case: a descriptor override, else the default."""

    alpha: float
    split: float
    res_min: float
    res_max: float
    res_step: float
    markers_k: int
    seed: int
    cluster_method: str
    min_coverage: float
    min_purity: float
    stable_fraction: float


def _override(value: Any, default: Any) -> Any:
    return default if value is None else value


def settings_for(d: Descriptor) -> Settings:
    """Resolve tuning knobs for a case from its descriptor overrides + defaults."""
    return Settings(
        alpha=float(_override(d.alpha, ALPHA_DEFAULT)),
        split=float(_override(d.split, SPLIT_DEFAULT)),
        res_min=float(_override(d.res_min, RES_MIN_DEFAULT)),
        res_max=float(_override(d.res_max, RES_MAX_DEFAULT)),
        res_step=float(_override(d.res_step, RES_STEP_DEFAULT)),
        markers_k=int(_override(d.markers_k, MARKERS_K_DEFAULT)),
        seed=int(_override(d.seed, SEED_DEFAULT)),
        cluster_method=str(_override(d.cluster_method, CLUSTER_METHOD_DEFAULT)),
        min_coverage=float(_override(d.min_coverage, MIN_COVERAGE_DEFAULT)),
        min_purity=float(_override(d.min_purity, MIN_PURITY_DEFAULT)),
        stable_fraction=float(_override(d.stable_fraction, STABLE_FRACTION_DEFAULT)),
    )


# ── small numeric helpers ────────────────────────────────────────────────────


def _clean_float(x: Any) -> Optional[float]:
    """A JSON-safe float, or ``None`` for missing / non-finite values."""
    if x is None:
        return None
    try:
        xf = float(x)
    except (TypeError, ValueError):
        return None
    return xf if math.isfinite(xf) else None


def _welch(a: np.ndarray, b: np.ndarray) -> tuple[float, float]:
    """Welch's two-sample t-test (unequal variance). Returns ``(t, p)``."""
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    if a.size < 2 or b.size < 2:
        return 0.0, 1.0
    from scipy.stats import ttest_ind

    res = ttest_ind(a, b, equal_var=False)
    t = float(res.statistic)
    p = float(res.pvalue)
    if not math.isfinite(p):
        return (t if math.isfinite(t) else 0.0), 1.0
    return t, p


def _auc_directional(scores: np.ndarray, y: np.ndarray) -> float:
    """ROC AUC of ``scores`` for the positive class, oriented as given."""
    y = np.asarray(y, dtype=int)
    s = np.asarray(scores, dtype=float)
    if s.size == 0 or np.unique(y).size < 2:
        return 0.5
    from sklearn.metrics import roc_auc_score

    try:
        return float(roc_auc_score(y, s))
    except ValueError:
        return 0.5


def _auc_strength(scores: np.ndarray, y: np.ndarray) -> float:
    """Direction-agnostic separation strength: ``max(auc, 1 - auc)``."""
    a = _auc_directional(scores, y)
    return max(a, 1.0 - a)


def _two_group_masks(groups: np.ndarray) -> Optional[tuple[str, str, np.ndarray, np.ndarray]]:
    """Pick the two most-populated levels of a label vector to compare."""
    arr = np.asarray([str(v) for v in groups])
    levels, counts = np.unique(arr, return_counts=True)
    if levels.size < 2:
        return None
    order = np.argsort(-counts)
    a, b = str(levels[order[0]]), str(levels[order[1]])
    return a, b, arr == a, arr == b


def _resolutions(lo: float, hi: float, step: float) -> list[float]:
    if step <= 0:
        step = 0.2
    out: list[float] = []
    r = lo
    while r <= hi + 1e-9:
        out.append(round(r, 4))
        r += step
    return out or [round(lo, 4)]


# ── Check 1: pseudoreplication ───────────────────────────────────────────────


def _focus_expression(
    counts: Optional[np.ndarray], var_names: list[str], adata: Any, gene: str
) -> Optional[np.ndarray]:
    """Per-cell focus-gene value: ``log1p`` of counts, else the raw ``.X`` column."""
    gi = gene_index(var_names, gene)
    if counts is not None and gi is not None:
        return np.log1p(np.clip(counts[:, gi], 0, None)).astype(float)
    X, x_vars = get_X(adata)
    gj = gene_index(x_vars, gene) if X is not None else None
    if X is not None and gj is not None:
        return np.asarray(X[:, gj], dtype=float).ravel()
    return None


def _icc(expr: np.ndarray, unit_labels: np.ndarray) -> Optional[float]:
    """Intraclass correlation: between-unit variance over total variance."""
    units = np.unique(unit_labels)
    if units.size < 2:
        return None
    means: list[float] = []
    within: list[float] = []
    for u in units:
        vals = expr[unit_labels == u]
        if vals.size == 0:
            continue
        means.append(float(vals.mean()))
        if vals.size > 1:
            within.append(float(vals.var(ddof=1)))
    if len(means) < 2:
        return None
    between = float(np.var(means, ddof=1))
    within_var = float(np.mean(within)) if within else 0.0
    total = between + within_var
    if total <= 0:
        return None
    return between / total


def check1(
    counts: Optional[np.ndarray],
    var_names: list[str],
    adata: Any,
    groups: Optional[np.ndarray],
    units: Optional[np.ndarray],
    focus_gene: str,
    alpha: float,
) -> dict:
    out: dict[str, Any] = {"naiveP": None, "honestP": None, "n": 0, "icc": None, "verdict": "flag_only"}
    if groups is None or units is None:
        out["note"] = "grouping or unit column missing"
        return out
    pair = _two_group_masks(groups)
    if pair is None:
        out["note"] = "grouping has fewer than two levels"
        return out
    _, _, m0, m1 = pair

    expr = _focus_expression(counts, var_names, adata, focus_gene)
    if expr is None:
        out["note"] = f"focus gene {focus_gene!r} not found"
        return out

    unit_arr = np.asarray([str(v) for v in units])
    keep = m0 | m1

    # One aggregated value per replicate in each arm: the honest unit of analysis.
    ref_units = np.unique(unit_arr[m0])
    alt_units = np.unique(unit_arr[m1])
    ref_vals = [float(expr[m0 & (unit_arr == u)].mean()) for u in ref_units if (m0 & (unit_arr == u)).any()]
    alt_vals = [float(expr[m1 & (unit_arr == u)].mean()) for u in alt_units if (m1 & (unit_arr == u)).any()]
    per_group = min(len(ref_vals), len(alt_vals))
    total_units = len({str(u) for u in ref_units} | {str(u) for u in alt_units})

    out["n"] = total_units
    out["perGroup"] = per_group
    out["icc"] = _clean_float(_icc(expr[keep], unit_arr[keep]))

    _, naive_p = _welch(expr[m0], expr[m1])
    out["naiveP"] = _clean_float(naive_p)

    # Fewer than two replicates in a group means no valid replicate-level test.
    if per_group < 2:
        out["verdict"] = "hard_stop"
        return out

    # No raw integer counts: the naive cell-level test still stands (computed on
    # .X above), but the honest replicate-level re-test needs raw counts. Report
    # naive only and degrade to flag_only, the same as the app engine.
    if counts is None:
        out["verdict"] = "flag_only"
        out["note"] = "no integer counts; honest replicate-level re-test needs raw counts"
        return out

    _, honest_p = _welch(np.asarray(ref_vals), np.asarray(alt_vals))
    out["honestP"] = _clean_float(honest_p)

    naive_sig = naive_p < alpha
    honest_sig = honest_p < alpha
    out["verdict"] = "flagged" if (naive_sig and not honest_sig) else "clean"
    return out


# ── Check 2: double dipping (count splitting) ────────────────────────────────


def _thin(counts: np.ndarray, eps: float, seed: int) -> tuple[np.ndarray, np.ndarray]:
    """Poisson thinning: split each integer count into two independent halves."""
    C = np.rint(np.clip(counts, 0, None)).astype(np.int64)
    gen = np.random.default_rng(int(seed))
    train = gen.binomial(C, float(eps))
    test = C - train
    return train.astype(float), test.astype(float)


def check2(
    counts: Optional[np.ndarray],
    var_names: list[str],
    states: Optional[np.ndarray],
    spurious: str,
    descriptor_markers: Optional[list[str]],
    s: Settings,
) -> dict:
    # Default to flag_only: every early return below is a can't-assess degradation
    # (no counts, held-out half too small, group unresolved, no markers). The
    # computed path overrides with clean or flagged.
    out: dict[str, Any] = {
        "discAUC": None,
        "holdAUC": None,
        "markersHolding": 0,
        "nMarkers": 0,
        "verdict": "flag_only",
    }
    if counts is None:
        out["note"] = "no integer counts available"
        return out
    if states is None:
        out["note"] = "cell-state column missing"
        return out

    y = (np.asarray([str(v) for v in states]) == str(spurious)).astype(int)
    if y.sum() == 0 or y.sum() == y.size:
        out["note"] = f"tracked group {spurious!r} not resolvable (one class)"
        return out

    n_cells = counts.shape[0]
    if round(n_cells * min(s.split, 1.0 - s.split)) < MIN_HELDOUT_CELLS:
        out["note"] = "held-out half too small to validate the group"
        return out

    train, test = _thin(counts, s.split, s.seed)
    log_train = np.log1p(train)
    log_test = np.log1p(test)

    # Resolve marker columns. Given markers first; else the genes that most define
    # the group on the discovery half (mirrors the app's default-marker fallback).
    pairs: list[tuple[str, int]] = []
    if descriptor_markers:
        for m in descriptor_markers:
            gi = gene_index(var_names, m)
            if gi is not None:
                pairs.append((str(m), int(gi)))
    if not pairs:
        strengths = np.array([_auc_strength(log_train[:, j], y) for j in range(log_train.shape[1])])
        top = np.argsort(-strengths)[: max(1, s.markers_k)]
        pairs = [(var_names[j], int(j)) for j in top]

    cols = [gi for _, gi in pairs]
    out["nMarkers"] = len(cols)
    if not cols:
        out["note"] = "no markers resolved in var_names"
        return out

    # Per-marker held-out survival: a marker holds if it still separates the group
    # on the independent half at AUC >= 0.60.
    out["markersHolding"] = int(sum(1 for _, gi in pairs if _auc_strength(log_test[:, gi], y) >= SURVIVE_AUC))

    # Combined marker score = difference-of-means direction fit on the discovery
    # half, standardized per gene. Read its AUC on discovery cells (in-sample,
    # optimistic) and on the held-out half (honest). A spurious group's direction
    # is overfit to the discovery counts and collapses out of sample.
    Xtr = log_train[:, cols]
    Xte = log_test[:, cols]
    mu1 = Xtr[y == 1].mean(axis=0)
    mu0 = Xtr[y == 0].mean(axis=0)
    pooled = np.sqrt(0.5 * (Xtr[y == 1].var(axis=0) + Xtr[y == 0].var(axis=0)))
    pooled = np.where(pooled < 1e-8, 1.0, pooled)
    w = (mu1 - mu0) / pooled
    score_train = Xtr @ w
    score_test = Xte @ w

    disc = _auc_directional(score_train, y)
    if disc < 0.5:  # orient the discovery direction, apply the same sign held out
        score_train, score_test, disc = -score_train, -score_test, 1.0 - disc
    hold = _auc_directional(score_test, y)

    out["discAUC"] = _clean_float(disc)
    out["holdAUC"] = _clean_float(hold)
    out["verdict"] = "flagged" if hold < CLEAN_HOLD_AUC else "clean"
    return out


# ── Check 3: fragility (clustering instability) ──────────────────────────────


def _embedding(counts: Optional[np.ndarray], adata: Any) -> np.ndarray:
    """A PCA embedding of ``log1p`` counts (or ``.X`` when counts are absent)."""
    C = counts
    if C is None:
        X, _ = get_X(adata)
        C = X
    if C is None:
        n = int(getattr(adata, "n_obs", 1) or 1)
        return np.zeros((n, 1))
    log = np.log1p(np.clip(C, 0, None))
    from sklearn.decomposition import PCA

    n_comp = int(min(30, max(2, min(log.shape) - 1)))
    return PCA(n_components=n_comp, random_state=0).fit_transform(log - log.mean(axis=0))


def _cluster_sweep(emb: np.ndarray, resolutions: list[float], seed: int, method: str) -> list[np.ndarray]:
    """Cluster labels at each resolution. Leiden when available, else KMeans with
    a resolution-to-k schedule (more clusters at higher resolution)."""
    if method != "kmeans":
        try:
            import anndata as ad
            import scanpy as sc

            a = ad.AnnData(X=np.asarray(emb, dtype=float))
            n_neighbors = int(min(15, max(2, emb.shape[0] - 1)))
            sc.pp.neighbors(a, use_rep="X", n_neighbors=n_neighbors)
            labels: list[np.ndarray] = []
            for r in resolutions:
                key = f"_oracle_leiden_{r}"
                sc.tl.leiden(a, resolution=float(r), key_added=key, random_state=int(seed))
                labels.append(np.asarray(a.obs[key].astype(str).to_numpy()))
            return labels
        except Exception:
            pass

    from sklearn.cluster import KMeans

    labels = []
    for r in resolutions:
        k = int(max(2, round(3 + float(r) * 4)))
        k = min(k, max(2, emb.shape[0] - 1))
        labels.append(KMeans(n_clusters=k, n_init=10, random_state=0).fit_predict(emb).astype(str))
    return labels


def _present(label_vec: np.ndarray, tracked: np.ndarray, min_cov: float, min_pur: float) -> bool:
    """Is the tracked group a discrete cluster here: one cluster covers most of it
    and is mostly made of it."""
    total = float(tracked.sum())
    if total == 0:
        return False
    for lbl in np.unique(label_vec):
        c = label_vec == lbl
        inter = float(np.logical_and(c, tracked).sum())
        coverage = inter / total
        purity = inter / float(c.sum()) if c.sum() else 0.0
        if coverage >= min_cov and purity >= min_pur:
            return True
    return False


def check3(
    counts: Optional[np.ndarray],
    var_names: list[str],
    adata: Any,
    states: Optional[np.ndarray],
    spurious: str,
    stable: Optional[str],
    s: Settings,
) -> dict:
    resolutions = _resolutions(s.res_min, s.res_max, s.res_step)
    out: dict[str, Any] = {"resolutions": [_clean_float(r) for r in resolutions]}

    emb = _embedding(counts, adata)
    labels = _cluster_sweep(emb, resolutions, s.seed, s.cluster_method)
    state_arr = None if states is None else np.asarray([str(v) for v in states])

    def track(group: str) -> dict:
        # flag_only until the group is actually swept (missing state column or an
        # absent group are can't-assess, not a clean bill). The computed path sets
        # clean or flagged.
        rec: dict[str, Any] = {
            "group": group,
            "stability": None,
            "settings": 0,
            "totalSettings": len(resolutions),
            "presentRange": [None, None],
            "verdict": "flag_only",
        }
        if state_arr is None:
            rec["note"] = "cell-state column missing"
            return rec
        tracked = state_arr == str(group)
        if tracked.sum() == 0:
            rec["stability"] = 0.0
            rec["note"] = f"group {group!r} absent"
            return rec
        present = [_present(labels[i], tracked, s.min_coverage, s.min_purity) for i in range(len(resolutions))]
        present_res = [resolutions[i] for i, p in enumerate(present) if p]
        stability = len(present_res) / len(resolutions) if resolutions else 0.0
        rec["stability"] = _clean_float(stability)
        rec["settings"] = len(present_res)
        rec["presentRange"] = (
            [_clean_float(min(present_res)), _clean_float(max(present_res))] if present_res else [None, None]
        )
        rec["verdict"] = "flagged" if stability < s.stable_fraction else "clean"
        return rec

    out["spurious"] = track(spurious)
    if stable:
        out["stable"] = track(stable)
    return out


# ── Check 4: confounding (technical-biological alignment) ────────────────────


def _cramers_v(a: np.ndarray, b: np.ndarray) -> float:
    """Cramer's V between two categorical vectors via a chi-squared table."""
    a = np.asarray([str(x) for x in a])
    b = np.asarray([str(x) for x in b])
    rows = list(dict.fromkeys(a.tolist()))
    cols = list(dict.fromkeys(b.tolist()))
    if len(rows) < 2 or len(cols) < 2:
        return 0.0
    ri = {v: i for i, v in enumerate(rows)}
    ci = {v: i for i, v in enumerate(cols)}
    table = np.zeros((len(rows), len(cols)), dtype=float)
    for x, y in zip(a.tolist(), b.tolist()):
        table[ri[x], ci[y]] += 1.0
    n = table.sum()
    if n == 0:
        return 0.0
    from scipy.stats import chi2_contingency

    chi2, _, _, _ = chi2_contingency(table, correction=False)
    denom = n * (min(table.shape) - 1)
    if denom <= 0:
        return 0.0
    return float(np.sqrt(max(float(chi2), 0.0) / denom))


def _rank_deficient(cols: list[np.ndarray]) -> bool:
    """One-hot the factors (intercept + drop-first per factor) and test the design
    matrix for rank deficiency."""
    non_empty = [c for c in cols if c is not None and len(c) > 0]
    if not non_empty:
        return False
    n = len(non_empty[0])
    blocks = [np.ones((n, 1))]
    for c in non_empty:
        levels = list(dict.fromkeys([str(v) for v in c]))
        if len(levels) < 2:
            continue
        idx = {v: i for i, v in enumerate(levels)}
        onehot = np.zeros((len(c), len(levels)))
        for i, v in enumerate(c):
            onehot[i, idx[str(v)]] = 1.0
        blocks.append(onehot[:, 1:])  # drop first level
    design = np.hstack(blocks)
    rank = int(np.linalg.matrix_rank(design))
    return rank < design.shape[1]


def check4(groups: Optional[np.ndarray], nuisance: Optional[np.ndarray]) -> dict:
    # flag_only for a missing column (can't assess separability); the computed
    # path overrides with clean or flagged.
    out: dict[str, Any] = {"cramersV": None, "rankDeficient": False, "separable": True, "verdict": "flag_only"}
    if groups is None:
        out["note"] = "grouping column missing"
        return out
    if nuisance is None:
        out["note"] = "nuisance column missing"
        return out

    v = _cramers_v(groups, nuisance)
    rank_deficient = _rank_deficient([groups, nuisance])
    inseparable = (v >= NESTED_V) or rank_deficient

    out["cramersV"] = _clean_float(v)
    out["rankDeficient"] = bool(rank_deficient)
    out["separable"] = bool(not inseparable)
    out["verdict"] = "flagged" if inseparable else "clean"
    return out


# ── driver ───────────────────────────────────────────────────────────────────


def run_case(d: Descriptor) -> dict:
    """Load a foil and recompute all four checks into the answer-key shape.

    Returns ``{caseId, checks: {"1":.., "2":.., "3":.., "4":..}}``.
    """
    s = settings_for(d)
    adata = load_adata(d.foil)
    counts, var_names = get_counts(adata)
    groups = obs_column(adata, d.grouping)
    units = obs_column(adata, d.unit)
    nuisance = obs_column(adata, d.nuisance)
    states = obs_column(adata, d.state_col)

    checks = {
        "1": check1(counts, var_names, adata, groups, units, d.focus_gene, s.alpha),
        "2": check2(counts, var_names, states, d.spurious, d.markers, s),
        "3": check3(counts, var_names, adata, states, d.spurious, d.stable, s),
        "4": check4(groups, nuisance),
    }
    return {"caseId": d.case_id, "checks": checks}
