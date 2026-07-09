"""Pillar 3 - Fragile conclusions (clustering instability).

A conclusion that rides on an arbitrary clustering resolution the scientist never
justified. Proof: sweep the resolution across a range, cluster at each setting,
measure agreement between adjacent settings (adjusted Rand index), and track
whether a named group survives the sweep or only exists inside a narrow window.

Two modes: a mechanical stability report (always available) and a claim-specific
mode that follows one named cluster/state when the scientist names one. A group
that is stable across the sweep returns a confident clean verdict; Redline never
manufactures a flag.
"""

from __future__ import annotations

from typing import Any, Optional

import numpy as np

from ..contracts import (
    CLEAN,
    FLAGGED,
    ComputeResult,
    FragilityStep,
    compute_result,
    fmt_pct,
    fragility_chart,
    stat,
)
from . import cfg_get, obs_series

_PRESENT_COVERAGE = 0.5  # a cluster must hold this share of the tracked group's cells
_PRESENT_PURITY = 0.5  # ... and be at least this pure, to count as "the group is present"
_STABLE_FRACTION = 0.8  # present in at least this share of settings => stable


def _embedding(adata: Any) -> np.ndarray:
    obsm = getattr(adata, "obsm", None)
    if obsm is not None:
        try:
            if "X_pca" in obsm:
                return np.asarray(obsm["X_pca"])
        except Exception:
            pass
    from .. import gating

    C, _ = gating.counts_array(adata)
    if C is None:
        X = getattr(adata, "X", None)
        C = gating._to_dense(X) if X is not None else np.zeros((int(getattr(adata, "n_obs", 1)), 1))
    log = np.log1p(np.clip(C, 0, None))
    try:
        from sklearn.decomposition import PCA

        n_comp = int(min(30, max(2, min(log.shape) - 1)))
        return PCA(n_components=n_comp, random_state=0).fit_transform(log - log.mean(axis=0))
    except Exception:
        return log


def _resolutions(lo: float, hi: float, step: float) -> list[float]:
    if step <= 0:
        step = 0.2
    out = []
    r = lo
    while r <= hi + 1e-9:
        out.append(round(r, 4))
        r += step
    return out or [lo]


def _cluster_sweep(emb: np.ndarray, resolutions: list[float], seed: int) -> tuple[list[np.ndarray], str]:
    """Labels at each resolution, and the engine that produced them. scanpy leiden
    when leidenalg is installed, else KMeans with a resolution-to-k schedule that
    mimics finer clustering at higher resolution.

    The engine name is returned, never dropped: a Leiden -> KMeans downgrade
    changes what a fragility flag means, so it has to reach the user.
    """
    try:
        import anndata as ad
        import scanpy as sc

        a = ad.AnnData(X=np.asarray(emb, dtype=float))
        sc.pp.neighbors(a, use_rep="X", n_neighbors=15)
        labels = []
        for r in resolutions:
            key = f"_rl_leiden_{r}"
            sc.tl.leiden(a, resolution=float(r), key_added=key, random_state=seed)
            labels.append(np.asarray(a.obs[key].astype(str).to_numpy()))
        return labels, "Leiden (scanpy)"
    except ImportError as exc:
        reason = f"missing {exc.name or 'scanpy'}"
    except Exception as exc:
        reason = type(exc).__name__

    from sklearn.cluster import KMeans

    labels = []
    for r in resolutions:
        k = int(max(2, round(3 + float(r) * 4)))
        k = min(k, max(2, emb.shape[0] - 1))
        labels.append(KMeans(n_clusters=k, n_init=10, random_state=seed).fit_predict(emb).astype(str))
    return labels, f"KMeans fallback ({reason})"


def _adjacent_ari(labels: list[np.ndarray]) -> float:
    if len(labels) < 2:
        return 1.0
    try:
        from sklearn.metrics import adjusted_rand_score

        scores = [adjusted_rand_score(labels[i], labels[i + 1]) for i in range(len(labels) - 1)]
        return float(np.mean(scores))
    except Exception:
        return float("nan")


def _present(label_vec: np.ndarray, tracked: np.ndarray) -> bool:
    """Is the tracked group a discrete cluster at this setting?

    True when a single cluster both holds most of the group's cells (coverage)
    and is mostly made of them (purity). A group that only forms a pure cluster
    inside a narrow resolution window is exactly the fragility signal.
    """
    total = float(tracked.sum())
    if total == 0:
        return False
    for lbl in np.unique(label_vec):
        c = label_vec == lbl
        inter = float(np.logical_and(c, tracked).sum())
        coverage = inter / total
        purity = inter / float(c.sum()) if c.sum() else 0.0
        if coverage >= _PRESENT_COVERAGE and purity >= _PRESENT_PURITY:
            return True
    return False


def _find_track_column(adata: Any, track: str, fields: Any) -> Optional[str]:
    obs = getattr(adata, "obs", None)
    if obs is None or not track:
        return None
    for col in obs.columns:
        try:
            vals = set(str(v) for v in obs[col].unique())
        except Exception:
            continue
        if str(track) in vals:
            return col
    return None


def run(adata: Any, config: Any, fields: Any = None) -> ComputeResult:
    lo = float(cfg_get(config, "min", 0.2))
    hi = float(cfg_get(config, "max", 2.0))
    step = float(cfg_get(config, "step", 0.2))
    track = cfg_get(config, "track", None)
    seed = int(cfg_get(config, "seed", 0))

    resolutions = _resolutions(lo, hi, step)
    emb = _embedding(adata)
    labels, cluster_engine = _cluster_sweep(emb, resolutions, seed)
    cluster_counts = [int(np.unique(l).size) for l in labels]
    mean_ari = _adjacent_ari(labels)

    def _finish(state: str, head: str, stats: list, chart: Any) -> ComputeResult:
        # Surface the clustering backend, so a Leiden -> KMeans downgrade is
        # visible rather than silent. Mirrors Pillar 1's "Honest engine" stat.
        stats.append(stat("Clustering engine", cluster_engine))
        return compute_result(3, state, head, stats, chart)

    track_col = _find_track_column(adata, track, fields) if track else None

    # Claim-specific mode: follow a named group across the sweep.
    if track and track_col is not None:
        tracked = obs_series(adata, track_col)
        tracked = np.asarray([str(x) for x in tracked]) == str(track)
        steps = [
            FragilityStep(r=r, present=_present(labels[i], tracked), clusters=cluster_counts[i])
            for i, r in enumerate(resolutions)
        ]
        present_res = [s.r for s in steps if s.present]
        stability = len(present_res) / len(steps) if steps else 0.0
        present_range = (min(present_res), max(present_res)) if present_res else (lo, lo)
        chart = fragility_chart(steps, present_range, str(track), stability)

        if stability >= _STABLE_FRACTION:
            head = f"'{track}' holds as a discrete cluster across the resolution sweep."
            stats = [
                stat("Stability", fmt_pct(stability), good=True),
                stat("Appears in", f"{len(present_res)} / {len(steps)} settings"),
                stat("Adjacent ARI", f"{mean_ari:.2f}" if np.isfinite(mean_ari) else "n/a"),
            ]
            return _finish(CLEAN, head, stats, chart)

        head = (
            f"'{track}' appears only between resolution {present_range[0]:.1f} and "
            f"{present_range[1]:.1f}; it is a boundary of the algorithm, not a discrete population."
        )
        stats = [
            stat("Stability", fmt_pct(stability), bad=True),
            stat("Appears in", f"{len(present_res)} / {len(steps)} settings"),
            stat("Present range", f"{present_range[0]:.1f}-{present_range[1]:.1f}"),
        ]
        return _finish(FLAGGED, head, stats, chart)

    # Mechanical mode: overall stability of the clustering to the resolution knob.
    stability = float(mean_ari) if np.isfinite(mean_ari) else 0.0
    steps = [
        FragilityStep(r=r, present=True, clusters=cluster_counts[i]) for i, r in enumerate(resolutions)
    ]
    label = str(track) if track else "clustering"
    chart = fragility_chart(steps, (lo, hi), label, stability)
    if stability >= _STABLE_FRACTION:
        head = "The clustering is stable across the resolution range tested."
        stats = [
            stat("Adjacent ARI", f"{stability:.2f}", good=True),
            stat("Cluster count", f"{cluster_counts[0]}-{cluster_counts[-1]}"),
        ]
        return _finish(CLEAN, head, stats, chart)

    head = "The clustering reshuffles as the resolution changes; conclusions that ride on it are fragile."
    stats = [
        stat("Adjacent ARI", f"{stability:.2f}", bad=True),
        stat("Cluster count", f"{cluster_counts[0]}-{cluster_counts[-1]}"),
    ]
    return _finish(FLAGGED, head, stats, chart)
