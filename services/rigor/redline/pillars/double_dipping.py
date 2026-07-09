"""Pillar 2 - Fake clusters and identities (double dipping).

A cluster (a cell type, or a cell state) is defined and then tested for its own
marker genes on the same cells. That reuse manufactures false-positive markers.
Proof by count splitting: draw two statistically independent halves from the
counts by Poisson thinning (``train = Binomial(count, eps)``, ``test = count -
train``), re-cluster on the train half to define the group without touching the
test half, then re-score the claimed markers on the test half.

Honesty constraint: count splitting is evidence, not a certified FDR correction,
and data thinning has documented limits. The output is framed as "this many
markers survive a valid held-out test". ClusterDE is the stronger method on the
roadmap; the reasoning layer names it in the finding.
"""

from __future__ import annotations

from typing import Any, Optional

import numpy as np

from ..contracts import (
    CLEAN,
    FLAG_ONLY,
    FLAGGED,
    ComputeResult,
    Marker,
    compute_result,
    groups_chart,
    stat,
)
from . import cfg_get, obs_series, rng, safe_auc

_MARKER_KEYS = ("markers", "marker_genes", "genes")
_SURVIVE_AUC = 0.60  # a marker "survives" if it still separates the group out of sample
_CLEAN_MEAN_AUC = 0.62  # the group as a whole is real if held-out separation stays here


def _dense_counts(adata: Any) -> tuple[Optional[np.ndarray], list[str]]:
    from .. import gating

    C, _ = gating.counts_array(adata)
    var_names = [str(v) for v in getattr(adata, "var_names", range(0 if C is None else C.shape[1]))]
    return C, var_names


def _thin(counts: np.ndarray, eps: float, seed: Any) -> tuple[np.ndarray, np.ndarray]:
    """Poisson thinning: split each count into two independent halves."""
    C = np.rint(np.clip(counts, 0, None)).astype(np.int64)
    train = rng(seed).binomial(C, eps)
    test = C - train
    return train.astype(float), test.astype(float)


_RES_LO, _RES_HI, _RES_STEPS = 0.02, 2.0, 8


def _seed_int(seed: Any) -> int:
    try:
        return int(seed)
    except (TypeError, ValueError):
        return 0


def _leiden_at_k(sc: Any, a: Any, k: int, seed: int) -> np.ndarray:
    """Leiden takes a resolution, not a k. Bisect the resolution until the cluster
    count matches the granularity the claimed grouping implies.

    Without this, leiden at a fixed resolution over-partitions and
    `_best_match_cluster` locks onto a fragment of the group the scientist named.
    Its real markers then score near chance against that fragment and a clean
    analysis gets flagged. KMeans was always handed k, so the two backends
    disagreed and the verdict depended on which one happened to be installed.
    """
    lo, hi = _RES_LO, _RES_HI
    best_lab, best_gap = None, None
    for _ in range(_RES_STEPS):
        mid = (lo + hi) / 2.0
        sc.tl.leiden(a, resolution=mid, key_added="_rl_k", random_state=seed)
        lab = np.asarray(a.obs["_rl_k"].astype(str).to_numpy())
        n = int(np.unique(lab).size)
        gap = abs(n - k)
        if best_gap is None or gap < best_gap:
            best_lab, best_gap = lab, gap
        if n == k:
            return lab
        if n > k:
            hi = mid
        else:
            lo = mid
    return best_lab if best_lab is not None else np.zeros(a.n_obs, dtype=str)


def _recluster_train(train: np.ndarray, k: int, seed: Any) -> tuple[np.ndarray, str]:
    """Cluster the discovery (train) half, and name the engine that did it.

    Runs on the train half only so the group definition is independent of the
    held-out half the markers are validated on. Both backends target `k` groups,
    so the verdict does not depend on which one is installed.
    """
    log = np.log1p(train)
    k = int(max(2, k))
    rs = _seed_int(seed)
    try:
        import anndata as ad
        import scanpy as sc

        a = ad.AnnData(X=log.copy())
        sc.pp.scale(a, max_value=10)
        sc.pp.pca(a, n_comps=int(min(30, max(2, min(a.shape) - 1))))
        sc.pp.neighbors(a, n_neighbors=15)
        return _leiden_at_k(sc, a, k, rs), "Leiden (scanpy)"
    except ImportError as exc:
        reason = f"missing {exc.name or 'scanpy'}"
    except Exception as exc:
        reason = type(exc).__name__

    from sklearn.cluster import KMeans
    from sklearn.decomposition import PCA

    n_comp = int(min(30, max(2, min(log.shape) - 1)))
    emb = PCA(n_components=n_comp, random_state=0).fit_transform(log - log.mean(axis=0))
    km = KMeans(n_clusters=k, n_init=10, random_state=rs).fit(emb)
    return km.labels_.astype(str), f"KMeans fallback ({reason})"


def _claimed_mask(adata: Any, grouping: Optional[str], target_group: Optional[str],
                  markers: list[str], var_names: list[str], full_counts: np.ndarray) -> Optional[np.ndarray]:
    labels = obs_series(adata, grouping) if grouping else None
    if labels is not None:
        labels = np.asarray([str(x) for x in labels])
        levels = list(dict.fromkeys(labels.tolist()))
        if target_group and str(target_group) in levels:
            return labels == str(target_group)
        if markers:
            # The claimed state is the level those markers separate best on full data.
            log = np.log1p(full_counts)
            idx = [var_names.index(m) for m in markers if m in var_names]
            best_lvl, best_sep = None, -1.0
            for lvl in levels:
                y = (labels == lvl).astype(int)
                sep = float(np.mean([safe_auc(log[:, j], y) for j in idx])) if idx else 0.0
                if sep > best_sep:
                    best_lvl, best_sep = lvl, sep
            if best_lvl is not None:
                return labels == best_lvl
        # Fall back to the most populated level.
        vals, counts = np.unique(labels, return_counts=True)
        return labels == vals[int(np.argmax(counts))]
    return None


def _best_match_cluster(labels_train: np.ndarray, claimed: np.ndarray) -> np.ndarray:
    """Train-derived group membership: the train cluster most overlapping the claim."""
    best_lbl, best_j = None, -1.0
    for lbl in np.unique(labels_train):
        c = labels_train == lbl
        inter = float(np.logical_and(c, claimed).sum())
        union = float(np.logical_or(c, claimed).sum())
        j = inter / union if union > 0 else 0.0
        if j > best_j:
            best_lbl, best_j = lbl, j
    return labels_train == best_lbl


def run(adata: Any, config: Any, fields: Any = None) -> ComputeResult:
    from .. import gating

    eps = float(cfg_get(config, "split", 0.5))
    eps = min(max(eps, 0.05), 0.95)
    grouping = cfg_get(config, "grouping", None)
    target_group = cfg_get(config, "target_group", None) or cfg_get(config, "group", None)
    seed = cfg_get(config, "seed", 0)

    markers = None
    for key in _MARKER_KEYS:
        v = cfg_get(config, key, None)
        if v:
            markers = [str(m) for m in v]
            break

    gate = gating.require_counts(adata)
    C, var_names = _dense_counts(adata)
    if not gate.ok or C is None:
        placeholder = [Marker(gene=m, disc=0.0, hold=0.0) for m in (markers or [])]
        return compute_result(
            2,
            FLAG_ONLY,
            gate.message,
            [stat("Re-run", "not available", bad=True), stat("Reason", "no raw counts")],
            groups_chart(placeholder, eps, verified=False),
        )

    n_cells = C.shape[0]
    if round(n_cells * min(eps, 1 - eps)) < 20:
        return compute_result(
            2,
            FLAG_ONLY,
            "The held-out half is too small to validate the group. Raise the split or add cells.",
            [stat("Held-out cells", str(round(n_cells * (1 - eps))), bad=True), stat("Minimum", ">= 20")],
            groups_chart([Marker(m, 0.0, 0.0) for m in (markers or [])], eps, verified=False),
        )

    train, test = _thin(C, eps, seed)

    labels = obs_series(adata, grouping) if grouping else None
    n_levels = int(np.unique([str(x) for x in labels]).size) if labels is not None else 8
    labels_train, cluster_engine = _recluster_train(train, k=max(2, n_levels), seed=seed)

    claimed = _claimed_mask(adata, grouping, target_group, markers or [], var_names, C)
    if claimed is None or claimed.sum() == 0:
        # No claimed group resolved: take the largest train cluster as the group.
        vals, counts = np.unique(labels_train, return_counts=True)
        claimed = labels_train == vals[int(np.argmax(counts))]
    y = _best_match_cluster(labels_train, claimed).astype(int)

    if not markers:
        # Default markers: the genes that most define the group on the train half.
        log_train = np.log1p(train)
        aucs = np.array([safe_auc(log_train[:, j], y) for j in range(log_train.shape[1])])
        markers = [var_names[j] for j in np.argsort(-aucs)[:4]]

    idx = [(m, var_names.index(m)) for m in markers if m in var_names]
    if not idx:
        return compute_result(
            2,
            FLAG_ONLY,
            "None of the claimed markers were found in var_names.",
            [stat("Markers found", "0", bad=True)],
            groups_chart([], eps, verified=False),
        )

    log_train = np.log1p(train)
    log_test = np.log1p(test)
    marker_rows: list[Marker] = []
    for name, j in idx:
        disc = safe_auc(log_train[:, j], y)  # discovery: dips into the definition
        hold = safe_auc(log_test[:, j], y)  # held-out: independent of the definition
        marker_rows.append(Marker(gene=name, disc=disc, hold=hold))

    disc_auc = float(np.mean([m.disc for m in marker_rows]))
    hold_auc = float(np.mean([m.hold for m in marker_rows]))
    surviving = int(sum(1 for m in marker_rows if m.hold >= _SURVIVE_AUC))
    total = len(marker_rows)
    chart = groups_chart(marker_rows, eps, verified=True, disc_auc=disc_auc, hold_auc=hold_auc)

    stats = [
        stat("Discovery AUC", f"{disc_auc:.2f}"),
        stat("Held-out AUC", f"{hold_auc:.2f}", bad=(hold_auc < _CLEAN_MEAN_AUC), good=(hold_auc >= _CLEAN_MEAN_AUC)),
        stat("Markers holding", f"{surviving} / {total}", bad=(surviving == 0)),
        # The group definition comes from this clustering, so a backend swap can
        # move the verdict. Name it, the way Pillars 1 and 3 name theirs.
        stat("Discovery clustering", cluster_engine),
    ]

    if hold_auc >= _CLEAN_MEAN_AUC and surviving >= max(1, total // 2 + total % 2):
        head = f"The group holds up: {surviving} of {total} markers still separate it on a held-out split."
        return compute_result(2, CLEAN, head, stats, chart)

    head = (
        f"The group separates at discovery AUC {disc_auc:.2f} and collapses to {hold_auc:.2f} "
        f"on independent counts; {surviving} of {total} markers survive."
    )
    return compute_result(2, FLAGGED, head, stats, chart)
