"""Pillar 1 - Fake significance from tiny sample sizes (pseudoreplication).

Differential expression computed at the single-cell level while the experiment
has a handful of true biological replicates inflates significance, because tens
of thousands of correlated cells are counted as independent observations. This
pillar aggregates to one profile per replicate x grouping and re-runs the
comparison correctly, then shows the inflated significance collapse.

This is the one pillar where Redline asserts the corrected result, because
pseudobulk aggregation is the accepted-correct method (Squair et al. 2021). When
raw counts and the heavy stack are present the honest test is a PyDESeq2 refit on
``decoupler.get_pseudobulk`` output; otherwise it is a Welch t-test on the
per-replicate means, which is the same aggregation with a lighter test.
"""

from __future__ import annotations

from typing import Any, Optional

import numpy as np

from ..contracts import (
    CLEAN,
    FLAG_ONLY,
    FLAGGED,
    HARD_STOP,
    ComputeResult,
    SignificanceLevel,
    UnitProfile,
    compute_result,
    fmt_p,
    hardstop_chart,
    significance_chart,
    stat,
)
from . import cfg_get, obs_series, resolve_role_column, two_groups

_GENE_KEYS = ("gene", "target", "feature", "marker")


def _noun(col: str) -> str:
    low = str(col).lower()
    for suf in ("_id", "_label", "_name", "id"):
        if low.endswith(suf) and len(low) > len(suf):
            low = low[: -len(suf)]
            break
    return low.strip("_") or "unit"


def _welch(a: np.ndarray, b: np.ndarray) -> tuple[float, float]:
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    if a.size < 2 or b.size < 2:
        return 0.0, 1.0
    try:
        from scipy.stats import ttest_ind

        res = ttest_ind(a, b, equal_var=False)
        t = float(res.statistic)
        p = float(res.pvalue)
        if not np.isfinite(p):
            return t, 1.0
        return t, p
    except Exception:
        # Manual Welch t + normal approximation if scipy is missing.
        m = b.mean() - a.mean()
        se = np.sqrt(b.var(ddof=1) / b.size + a.var(ddof=1) / a.size)
        if se == 0:
            return 0.0, 1.0
        t = float(m / se)
        from math import erfc, sqrt

        p = float(erfc(abs(t) / sqrt(2)))
        return t, p


def _icc(expr: np.ndarray, unit_labels: np.ndarray) -> Optional[float]:
    """Intraclass correlation: between-unit variance over total variance."""
    units = np.unique(unit_labels)
    if units.size < 2:
        return None
    means = []
    within = []
    for u in units:
        vals = expr[unit_labels == u]
        if vals.size == 0:
            continue
        means.append(vals.mean())
        if vals.size > 1:
            within.append(vals.var(ddof=1))
    if not means:
        return None
    between_var = float(np.var(means, ddof=1)) if len(means) > 1 else 0.0
    within_var = float(np.mean(within)) if within else 0.0
    total = between_var + within_var
    if total <= 0:
        return None
    return between_var / total


def _resolve_gene(config: Any, C: np.ndarray, var_names: list[str], m0: np.ndarray, m1: np.ndarray) -> tuple[str, int]:
    """Pick the audited gene: an explicit config gene, else the most naively
    significant gene (the one the naive test would call most confidently)."""
    for key in _GENE_KEYS:
        g = cfg_get(config, key, None)
        if g is not None and str(g) in var_names:
            return str(g), var_names.index(str(g))
    expr = np.log1p(C)
    a = expr[m0]
    b = expr[m1]
    if a.shape[0] < 2 or b.shape[0] < 2:
        idx = int(np.argmax(expr.mean(axis=0)))
        return var_names[idx], idx
    ma, mb = a.mean(axis=0), b.mean(axis=0)
    va = a.var(axis=0, ddof=1) / max(a.shape[0], 1)
    vb = b.var(axis=0, ddof=1) / max(b.shape[0], 1)
    se = np.sqrt(va + vb)
    with np.errstate(divide="ignore", invalid="ignore"):
        t = np.where(se > 0, (mb - ma) / se, 0.0)
    idx = int(np.argmax(np.abs(np.nan_to_num(t))))
    return var_names[idx], idx


def run(adata: Any, config: Any, fields: Any = None) -> ComputeResult:
    from .. import gating

    alpha = float(cfg_get(config, "alpha", 0.05))
    group_col = cfg_get(config, "grouping", None) or resolve_role_column(fields, "grouping")
    config_unit = cfg_get(config, "unit", None)
    true_unit = resolve_role_column(fields, "unit") or config_unit

    groups = obs_series(adata, group_col)
    if groups is None:
        return _needs_input(1, "Set the grouping column being compared before running this check.", alpha)
    picked = two_groups(groups, config)
    if picked is None:
        return _needs_input(1, f"'{group_col}' has fewer than two levels to compare.", alpha)
    ref, alt, ref_mask_all, alt_mask_all = picked

    # Decide which column to aggregate on. If the user pointed the unit at an
    # observation-level column (one row per cell), that IS the pseudoreplication;
    # aggregate on the true biological unit instead and flag the mismatch.
    n_obs = int(getattr(adata, "n_obs", len(groups)))
    bad_unit = False
    unit_col = config_unit
    cu = obs_series(adata, config_unit)
    if cu is not None and np.unique(cu).size >= max(0.9 * n_obs, n_obs - 1):
        bad_unit = True
        unit_col = true_unit
    if obs_series(adata, unit_col) is None:
        unit_col = true_unit
    units = obs_series(adata, unit_col)
    if units is None:
        return _needs_input(1, "No biological-unit column is resolved to aggregate on.", alpha)

    gate = gating.require_counts(adata)
    C_full, _ = gating.counts_array(adata)

    keep = ref_mask_all | alt_mask_all
    groups_k = np.asarray([str(x) for x in groups])[keep]
    units_k = np.asarray([str(x) for x in units])[keep]

    # Expression basis: log1p of counts when present, else whatever X holds.
    if C_full is not None:
        C = C_full[keep]
        var_names = [str(v) for v in getattr(adata, "var_names", range(C.shape[1]))]
    else:
        X = getattr(adata, "X", None)
        C = gating._to_dense(X)[keep] if X is not None else np.zeros((int(keep.sum()), 1))
        var_names = [str(v) for v in getattr(adata, "var_names", range(C.shape[1]))]

    m0 = groups_k == ref
    m1 = groups_k == alt
    gene, gi = _resolve_gene(config, C, var_names, m0, m1)
    expr = np.log1p(np.clip(C[:, gi], 0, None)) if C_full is not None else np.asarray(C[:, gi], dtype=float)

    # Per (unit, group) profiles: one aggregated value per replicate arm.
    profiles: list[UnitProfile] = []
    ref_vals: list[float] = []
    alt_vals: list[float] = []
    ref_units: set[str] = set()
    alt_units: set[str] = set()
    for glabel, gmask, bucket, uset in ((ref, m0, ref_vals, ref_units), (alt, m1, alt_vals, alt_units)):
        u_here = units_k[gmask]
        e_here = expr[gmask]
        for u in np.unique(u_here):
            vals = e_here[u_here == u]
            if vals.size == 0:
                continue
            mean_v = float(vals.mean())
            profiles.append(UnitProfile(id=str(u), group=glabel, n=int(vals.size), value=mean_v))
            bucket.append(mean_v)
            uset.add(str(u))

    per_group = min(len(ref_units), len(alt_units))
    total_units = len(ref_units | alt_units)

    # Hard branch: fewer than 2 replicates in a group means no valid test exists.
    if per_group < 2:
        head = f"No valid test is possible: '{unit_col}' gives {per_group} replicate per group."
        stats = [
            stat("Independent units", str(total_units), bad=True),
            stat("Per group", str(per_group), bad=True),
            stat("Minimum needed", ">= 2 / group"),
        ]
        return compute_result(1, HARD_STOP, head, stats, hardstop_chart(total_units, per_group, profiles))

    n_cells = int(keep.sum())
    _, p_naive = _welch(expr[m0], expr[m1])
    naive = SignificanceLevel(n=n_cells, p=p_naive, sig=p_naive < alpha)

    # Counts gate: the structure is testable, but the honest pseudobulk re-run
    # needs raw integer counts. Degrade to flag_only rather than fabricate one.
    if not gate.ok:
        honest_mirror = SignificanceLevel(n=total_units, p=p_naive, sig=naive.sig)
        stats = [
            stat("Naive p", fmt_p(p_naive), bad=True),
            stat("Honest re-run", "not available", bad=True),
            stat("Needs", "raw integer counts"),
        ]
        return compute_result(
            1, FLAG_ONLY, gate.message, stats, significance_chart(naive, honest_mirror, alpha, profiles, bad_unit)
        )

    # Honest test: PyDESeq2 on pseudobulk when available, else Welch on the means.
    p_honest = _deseq2_honest_p(adata, unit_col, group_col, ref, alt, keep, gene)
    honest_engine = "PyDESeq2 pseudobulk"
    if p_honest is None:
        _, p_honest = _welch(np.asarray(ref_vals), np.asarray(alt_vals))
        honest_engine = "Welch t (pseudobulk means)"
    honest = SignificanceLevel(n=total_units, p=p_honest, sig=p_honest < alpha)

    icc = _icc(expr, units_k)
    chart = significance_chart(naive, honest, alpha, profiles, bad_unit)

    stats = [
        stat("Naive p", fmt_p(p_naive), bad=True),
        stat("Honest p", fmt_p(p_honest), good=(not honest.sig)),
        stat("True n", f"{total_units} {_noun(unit_col)}"),
    ]
    if icc is not None:
        stats.append(stat("Intra-unit corr.", f"ICC {icc:.2f}", bad=(icc >= 0.05)))

    if naive.sig and not honest.sig:
        if bad_unit:
            head = f"The significant result comes from counting {n_cells:,} cells, not {total_units} {_noun(unit_col)}."
        else:
            head = "The significant result does not survive an honest re-test at the replicate level."
        return compute_result(1, FLAGGED, head, stats, chart)

    if honest.sig:
        head = f"The effect on {gene} survives aggregation to {total_units} {_noun(unit_col)}."
        stats[1] = stat("Honest p", fmt_p(p_honest), good=True)
        return compute_result(1, CLEAN, head, stats, chart)

    head = f"No inflated significance: {gene} is not significant at the cell level either."
    return compute_result(1, CLEAN, head, stats, chart)


def _needs_input(check_id: int, message: str, alpha: float) -> ComputeResult:
    zero = SignificanceLevel(n=0, p=1.0, sig=False)
    chart = significance_chart(zero, zero, alpha, [], bad_unit=False)
    return compute_result(check_id, FLAG_ONLY, message, [stat("Status", "needs input")], chart)


def _deseq2_honest_p(
    adata: Any, unit_col: str, group_col: str, ref: str, alt: str, cell_mask: np.ndarray, target_gene: str
) -> Optional[float]:
    """Honest p from ``decoupler.get_pseudobulk`` + PyDESeq2, or ``None`` on any
    missing dependency / failure (the caller then uses the Welch fallback)."""
    from .. import gating

    counts, _ = gating.counts_array(adata)
    if counts is None:
        return None
    try:
        import anndata as ad
        import numpy as _np
        import pandas as pd

        var_names = [str(v) for v in getattr(adata, "var_names", range(counts.shape[1]))]
        obs = getattr(adata, "obs")
        sub_counts = counts[cell_mask]
        sub_obs = obs.loc[cell_mask].copy()
        sub = ad.AnnData(X=_np.asarray(sub_counts), obs=sub_obs)
        sub.var_names = var_names
        sub.layers["counts"] = _np.asarray(sub_counts)

        # decoupler.get_pseudobulk: sum counts per (unit x group) sample.
        import decoupler as dc

        sample_col = "_rl_sample"
        sub.obs[sample_col] = (
            sub.obs[unit_col].astype(str) + "|" + sub.obs[group_col].astype(str)
        )
        pdata = dc.get_pseudobulk(
            sub, sample_col=sample_col, groups_col=group_col, layer="counts", mode="sum", min_cells=1, min_counts=0
        )
        counts_df = pd.DataFrame(
            _np.asarray(pdata.X), index=[str(i) for i in pdata.obs_names], columns=[str(v) for v in pdata.var_names]
        )
        meta = pd.DataFrame({group_col: pdata.obs[group_col].astype(str).values}, index=counts_df.index)

        from pydeseq2.dds import DeseqDataSet
        from pydeseq2.ds import DeseqStats

        counts_df = counts_df.round().astype(int)
        counts_df = counts_df.loc[:, counts_df.sum(axis=0) > 0]
        dds = DeseqDataSet(counts=counts_df, metadata=meta, design_factors=group_col)
        dds.deseq2()
        st = DeseqStats(dds, contrast=[group_col, alt, ref])
        st.summary()
        res = st.results_df
        if target_gene in res.index:
            p = float(res.loc[target_gene, "pvalue"])
            return p if _np.isfinite(p) else None
        return None
    except Exception:
        return None
