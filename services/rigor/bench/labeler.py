"""Ground-truth labeler for the detection benchmark.

This module recomputes, from scratch, whether each of the four statistical
errors is present in a case. It is a SEPARATE IMPLEMENTATION from the engine (it
never imports ``redline.pillars`` / ``redline.audit`` / ``redline.foundation``),
but it is NOT method-independent: it applies the same core statistics the engine
runs (Welch t for pseudoreplication, Poisson-thinning held-out marker AUC for
double dipping, a PCA/KMeans resolution sweep for fragility, chi-squared Cramer's
V for confounding). So agreement between this labeler and the engine is a
consistency check, not evidence of correctness, and it is strongest exactly where
the two share the most (pillars 1 and 4). Read this honestly:

- For pseudoreplication and confounding the truth is DEFINITIONAL by construction
  (the generator plants a donor outlier with too few replicates, or makes the
  technical variable collinear with the condition), so the labeler is really a
  build-time sanity check on those, not an independent oracle.
- For double dipping and fragility the labeler retains a little more distance (it
  scores the given state mask on a held-out split and sweeps KMeans over an
  explicit k-grid, with a seed distinct from the engine's, see ``redline_arm``),
  but note that in a leiden-less environment the engine also falls back to KMeans,
  so the two share the clustering primitive and differ only in grid and seed.

The generator tunes cases against THIS labeler, never against the engine, and
filters to a clear decision margin, which is disclosed as a limitation in the
benchmark README. The load-bearing, fair comparison in the benchmark is the
false-positive gap between the arms that see the re-run and the one that does
not, not the Redline arm's near-definitional detection rate.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from scipy import stats
from sklearn.decomposition import PCA
from sklearn.cluster import KMeans
from sklearn.metrics import roc_auc_score

from . import spec


# ── shared numeric helpers (our own, not the engine's) ───────────────────────
def lognorm(counts: np.ndarray) -> np.ndarray:
    """log1p of counts-per-10k. The standard marker-test reference space."""
    counts = np.asarray(counts, dtype=np.float64)
    lib = counts.sum(axis=1, keepdims=True)
    cpm = counts / np.clip(lib, 1.0, None) * 1e4
    return np.log1p(cpm)


def _welch_p(a: np.ndarray, b: np.ndarray) -> float:
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    if a.size < 2 or b.size < 2 or (np.var(a) == 0 and np.var(b) == 0):
        return 1.0
    t, p = stats.ttest_ind(a, b, equal_var=False)
    return float(p) if np.isfinite(p) else 1.0


def _auc(scores: np.ndarray, mask: np.ndarray) -> float:
    y = mask.astype(int)
    if y.sum() == 0 or y.sum() == y.size:
        return 0.5
    try:
        return float(roc_auc_score(y, np.asarray(scores, dtype=np.float64)))
    except ValueError:
        return 0.5


def _poisson_thin(counts: np.ndarray, eps: float, rng: np.random.Generator):
    c = np.rint(np.asarray(counts)).astype(np.int64)
    train = rng.binomial(c, eps)
    test = c - train
    return train.astype(np.float64), test.astype(np.float64)


def _cramers_v(a: np.ndarray, b: np.ndarray) -> float:
    a = np.asarray(a)
    b = np.asarray(b)
    ca = {v: i for i, v in enumerate(np.unique(a))}
    cb = {v: i for i, v in enumerate(np.unique(b))}
    table = np.zeros((len(ca), len(cb)), dtype=np.float64)
    for x, y in zip(a, b):
        table[ca[x], cb[y]] += 1.0
    if table.shape[0] < 2 or table.shape[1] < 2:
        return 0.0
    chi2 = stats.chi2_contingency(table, correction=False)[0]
    n = table.sum()
    phi2 = chi2 / n
    r, k = table.shape
    denom = min(r - 1, k - 1)
    return float(np.sqrt(phi2 / denom)) if denom > 0 else 0.0


# ── per-pillar labelers ──────────────────────────────────────────────────────
def label_pseudoreplication(counts, var_names, focus_gene, cond, unit) -> dict[str, Any]:
    """Cell-level test vs per-unit (pseudobulk) test on the focus gene."""
    gi = list(var_names).index(focus_gene)
    ln = lognorm(counts)[:, gi]
    cond = np.asarray(cond)
    unit = np.asarray(unit)
    groups = np.unique(cond)
    a_cells, b_cells = ln[cond == groups[0]], ln[cond == groups[1]]
    cell_p = _welch_p(a_cells, b_cells)

    # per-unit means, then a test across the real replicate units
    units = np.unique(unit)
    unit_group, unit_mean = [], []
    for u in units:
        m = unit == u
        unit_group.append(cond[m][0])
        unit_mean.append(float(ln[m].mean()))
    unit_group = np.asarray(unit_group)
    unit_mean = np.asarray(unit_mean)
    ua = unit_mean[unit_group == groups[0]]
    ub = unit_mean[unit_group == groups[1]]
    per_group = min(len(ua), len(ub))
    unit_p = _welch_p(ua, ub) if per_group >= 2 else 1.0

    present = (cell_p < spec.P1_CELL_SIG) and (unit_p >= spec.P1_UNIT_NULL)
    return {
        "present": bool(present),
        "cell_p": cell_p,
        "unit_p": unit_p,
        "n_cells": int(ln.size),
        "n_units": int(units.size),
        "per_group_units": int(per_group),
        "focus_gene": focus_gene,
    }


def label_double_dipping(counts, var_names, state_labels, target_state, seed) -> dict[str, Any]:
    """Count-split: pick the state's top-k markers on the discovery half, score
    them on the held-out half. Real markers hold; double-dipped ones collapse."""
    rng = np.random.default_rng(int(seed))
    var_names = list(var_names)
    state_labels = np.asarray(state_labels)
    mask = state_labels == target_state
    if mask.sum() < 2 or (~mask).sum() < 2:
        return {"present": False, "disc_auc": 0.5, "hold_auc": 0.5,
                "markers": [], "reason": "state too small"}

    train, test = _poisson_thin(counts, spec.P2_SPLIT_EPS, rng)
    ln_tr = lognorm(train)
    ln_te = lognorm(test)
    held = int(round(counts.shape[0] * min(spec.P2_SPLIT_EPS, 1 - spec.P2_SPLIT_EPS)))
    if held < spec.P2_MIN_HELDOUT:
        return {"present": False, "disc_auc": 0.5, "hold_auc": 0.5,
                "markers": [], "reason": "held-out too small"}

    # top-k markers by discovery-half mean difference (state vs rest)
    diff = ln_tr[mask].mean(axis=0) - ln_tr[~mask].mean(axis=0)
    top = np.argsort(diff)[::-1][: spec.P2_TOP_K]
    markers = [var_names[i] for i in top]

    disc_auc = _auc(ln_tr[:, top].mean(axis=1), mask)
    hold_auc = _auc(ln_te[:, top].mean(axis=1), mask)
    # per-marker held-out survival
    surviving = int(sum(_auc(ln_te[:, i], mask) >= spec.P2_COLLAPSE_AUC for i in top))
    present = hold_auc <= spec.P2_COLLAPSE_AUC
    return {
        "present": bool(present),
        "disc_auc": round(float(disc_auc), 4),
        "hold_auc": round(float(hold_auc), 4),
        "markers": markers,
        "surviving": surviving,
        "n_markers": len(markers),
    }


def _kmeans_labels(emb: np.ndarray, k: int, seed: int) -> np.ndarray:
    k = max(2, min(k, emb.shape[0]))
    return KMeans(n_clusters=k, random_state=int(seed), n_init=10).fit_predict(emb)


def label_fragility(counts, state_labels, target_state, seed) -> dict[str, Any]:
    """Sweep k; a state is 'present' at a k if some cluster both covers and is
    pure for it. Stable across the sweep => robust; narrow window => fragile."""
    state_labels = np.asarray(state_labels)
    mask = state_labels == target_state
    if mask.sum() < 2:
        return {"present": False, "stability": 1.0, "settings": 0, "present_ks": []}

    ln = lognorm(counts)
    ln = ln - ln.mean(axis=0, keepdims=True)
    n_comp = int(min(30, ln.shape[0] - 1, ln.shape[1]))
    emb = PCA(n_components=n_comp, random_state=int(seed)).fit_transform(ln)

    present_ks = []
    for k in spec.P3_K_GRID:
        lab = _kmeans_labels(emb, k, seed)
        best_present = False
        for cl in np.unique(lab):
            cm = lab == cl
            inter = np.logical_and(cm, mask).sum()
            cover = inter / max(1, mask.sum())      # fraction of the state captured
            purity = inter / max(1, cm.sum())       # fraction of the cluster that is the state
            if cover >= spec.P3_PRESENT_COVER and purity >= spec.P3_PRESENT_PURITY:
                best_present = True
                break
        present_ks.append((int(k), bool(best_present)))

    stability = sum(p for _, p in present_ks) / len(present_ks)
    present = stability < spec.P3_FRAGILE_STAB
    return {
        "present": bool(present),
        "stability": round(float(stability), 4),
        "settings": len(present_ks),
        "present_ks": present_ks,
    }


def label_confounding(cond, nuisance) -> dict[str, Any]:
    v = _cramers_v(np.asarray(cond), np.asarray(nuisance))
    present = v >= spec.P4_CONFOUND_V
    return {"present": bool(present), "cramers_v": round(float(v), 4)}


# ── one call to label all four pillars for a case ────────────────────────────
def label_case(counts: np.ndarray, var_names, obs: dict, claim: dict) -> dict[str, Any]:
    """Return per-pillar ground truth for a case.

    ``claim`` names the columns/values each check operates on (as a real analysis
    would specify): focus_gene, condition_col, unit_col, state_col, target_state,
    nuisance_col, and a seed for the stochastic labelers.
    """
    seed = int(claim.get("label_seed", 0))
    cond = obs[claim["condition_col"]]
    unit = obs[claim["unit_col"]]
    state = obs[claim["state_col"]]
    nuis = obs[claim["nuisance_col"]]

    p1 = label_pseudoreplication(counts, var_names, claim["focus_gene"], cond, unit)
    p2 = label_double_dipping(counts, var_names, state, claim["target_state"], seed)
    p3 = label_fragility(counts, state, claim["target_state"], seed)
    p4 = label_confounding(cond, nuis)

    return {
        "pseudoreplication": p1,
        "double_dipping": p2,
        "fragility": p3,
        "confounding": p4,
        "truth": {
            "pseudoreplication": p1["present"],
            "double_dipping": p2["present"],
            "fragility": p3["present"],
            "confounding": p4["present"],
        },
    }
