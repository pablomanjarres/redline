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
from . import cfg_get, interval, obs_series, rng, safe_auc, seed_stream

_MARKER_KEYS = ("markers", "marker_genes", "genes")
_SURVIVE_AUC = 0.60  # a marker "survives" if it still separates the group out of sample
_CLEAN_MEAN_AUC = 0.62  # the group as a whole is real if held-out separation stays here
_DEFAULT_REPEATS = 200  # independent count-splits behind the held-out AUC interval


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


def _recluster_train(train: np.ndarray, k: int, seed: Any) -> np.ndarray:
    """Cluster the discovery (train) half. scanpy leiden if present, else KMeans.

    Runs on the train half only so the group definition is independent of the
    held-out half the markers are validated on.
    """
    log = np.log1p(train)
    try:
        import anndata as ad
        import scanpy as sc

        a = ad.AnnData(X=log.copy())
        sc.pp.scale(a, max_value=10)
        sc.pp.pca(a, n_comps=int(min(30, max(2, min(a.shape) - 1))))
        sc.pp.neighbors(a, n_neighbors=15)
        sc.tl.leiden(a, resolution=1.0, random_state=int(seed) if str(seed).isdigit() else 0)
        return np.asarray(a.obs["leiden"].astype(str).to_numpy())
    except Exception:
        from sklearn.cluster import KMeans
        from sklearn.decomposition import PCA

        n_comp = int(min(30, max(2, min(log.shape) - 1)))
        emb = PCA(n_components=n_comp, random_state=0).fit_transform(log - log.mean(axis=0))
        km = KMeans(n_clusters=int(max(2, k)), n_init=10, random_state=0).fit(emb)
        return km.labels_.astype(str)


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
    base_seed = cfg_get(config, "seed", 0)
    repeats = int(cfg_get(config, "repeats", cfg_get(config, "reps", _DEFAULT_REPEATS)) or _DEFAULT_REPEATS)
    repeats = max(1, min(repeats, 400))

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

    labels = obs_series(adata, grouping) if grouping else None
    n_levels = int(np.unique([str(x) for x in labels]).size) if labels is not None else 8

    # Resolve the claim ONCE, so every split tests the SAME group and the SAME
    # markers. The stochastic part being sampled is the count-split (and the
    # discovery-half reclustering it feeds), not the claim under test.
    seeds = seed_stream(base_seed, repeats)
    train0, _ = _thin(C, eps, seeds[0])
    labels_train0 = _recluster_train(train0, k=max(2, n_levels), seed=seeds[0])
    claimed = _claimed_mask(adata, grouping, target_group, markers or [], var_names, C)
    if claimed is None or claimed.sum() == 0:
        vals, counts = np.unique(labels_train0, return_counts=True)
        claimed = labels_train0 == vals[int(np.argmax(counts))]
    if not markers:
        y0 = _best_match_cluster(labels_train0, claimed).astype(int)
        log_train0 = np.log1p(train0)
        aucs = np.array([safe_auc(log_train0[:, j], y0) for j in range(log_train0.shape[1])])
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

    total = len(idx)
    # Repeat the split across seeds, scoring the same markers on the same claim
    # each time. The spread of the held-out separation across splits is the
    # confidence interval: it answers "your one split could be luck" with a
    # distribution instead of a point.
    disc_samples: list[float] = []
    hold_samples: list[float] = []
    surviving_samples: list[float] = []
    per_marker_disc: dict[str, list[float]] = {name: [] for name, _ in idx}
    per_marker_hold: dict[str, list[float]] = {name: [] for name, _ in idx}
    for sd in seeds:
        train, test = _thin(C, eps, sd)
        labels_train = _recluster_train(train, k=max(2, n_levels), seed=sd)
        y = _best_match_cluster(labels_train, claimed).astype(int)
        log_train = np.log1p(train)
        log_test = np.log1p(test)
        discs: list[float] = []
        holds: list[float] = []
        for name, j in idx:
            d = safe_auc(log_train[:, j], y)  # discovery: dips into the definition
            h = safe_auc(log_test[:, j], y)  # held-out: independent of the definition
            discs.append(d)
            holds.append(h)
            per_marker_disc[name].append(d)
            per_marker_hold[name].append(h)
        disc_samples.append(float(np.mean(discs)))
        hold_samples.append(float(np.mean(holds)))
        surviving_samples.append(float(sum(1 for h in holds if h >= _SURVIVE_AUC)))

    hold_dist = interval(hold_samples)
    disc_dist = interval(disc_samples)
    surviving_dist = interval(surviving_samples)

    # Point estimates are the medians of their distributions, so the card value
    # and its interval never disagree.
    disc_auc = float(disc_dist["median"]) if disc_dist else float(np.median(disc_samples))
    hold_auc = float(hold_dist["median"]) if hold_dist else float(np.median(hold_samples))
    surviving = int(round(float(surviving_dist["median"]))) if surviving_dist else int(round(np.median(surviving_samples)))

    # Per-marker dots are each marker's median disc/hold across the splits.
    marker_rows = [
        Marker(gene=name, disc=float(np.median(per_marker_disc[name])), hold=float(np.median(per_marker_hold[name])))
        for name, _ in idx
    ]
    chart = groups_chart(
        marker_rows,
        eps,
        verified=True,
        disc_auc=disc_auc,
        hold_auc=hold_auc,
        hold_auc_dist=hold_dist,
        disc_auc_dist=disc_dist,
        markers_holding_dist=surviving_dist,
    )

    stats = [
        stat("Discovery AUC", f"{disc_auc:.2f}", interval=disc_dist),
        stat(
            "Held-out AUC",
            f"{hold_auc:.2f}",
            bad=(hold_auc < _CLEAN_MEAN_AUC),
            good=(hold_auc >= _CLEAN_MEAN_AUC),
            interval=hold_dist,
        ),
        stat("Markers holding", f"{surviving} / {total}", bad=(surviving == 0), interval=surviving_dist),
    ]

    ci = _ci_phrase(hold_dist, repeats)
    if hold_auc >= _CLEAN_MEAN_AUC and surviving >= max(1, total // 2 + total % 2):
        head = f"The group holds up: {surviving} of {total} markers still separate it on a held-out split{ci}."
        return compute_result(2, CLEAN, head, stats, chart)

    head = (
        f"The group separates at discovery AUC {disc_auc:.2f} and collapses to {hold_auc:.2f}{ci} "
        f"on independent counts; {surviving} of {total} markers survive."
    )
    return compute_result(2, FLAGGED, head, stats, chart)


def _ci_phrase(dist: Optional[Any], repeats: int) -> str:
    """A parenthetical CI clause for a headline, or empty when there is no interval."""
    if not dist:
        return ""
    return f" (95% interval {dist['lo']:.2f}-{dist['hi']:.2f} over {int(repeats)} splits)"
