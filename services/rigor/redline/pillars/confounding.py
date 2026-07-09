"""Pillar 4 - Confounded comparisons (technical-biological confounding).

Detects the biological comparison of interest being inseparable from a technical
variable (condition run entirely on one lane, one day, one machine). Proof:
cross-tabulate the resolved grouping against each technical column, measure
alignment with Cramer's V, test the design matrix for rank deficiency, and (when
raw counts and PyDESeq2 are available) refit ``~ condition + batch`` to ask
whether the effect survives adjustment.

Scope for v1 is technical-biological confounding only. Composition confounding
(differential abundance; miloR / scCODA) is deliberately out of scope.
"""

from __future__ import annotations

from typing import Any, Optional, Sequence

import numpy as np

from ..contracts import (
    FLAG_ONLY,
    FLAGGED,
    CLEAN,
    ComputeResult,
    ConfoundGrid,
    compute_result,
    confound_chart,
    stat,
)
from . import cfg_get, obs_series

# At/above this Cramer's V (or a rank-deficient design) the split is inseparable.
NESTED_THRESHOLD = 0.995


def cramers_v(a: Sequence[Any], b: Sequence[Any]) -> float:
    """Cramer's V association between two categorical vectors, in ``[0, 1]``.

    Uses a chi-squared contingency table. Returns 0 when either variable is
    constant (no association is defined). A perfectly nested design (each level
    of one maps to exactly one level of the other) returns ~1.
    """
    a = np.asarray(list(a))
    b = np.asarray(list(b))
    ra = list(dict.fromkeys(a.tolist()))
    cb = list(dict.fromkeys(b.tolist()))
    if len(ra) < 2 or len(cb) < 2:
        return 0.0
    ai = {v: i for i, v in enumerate(ra)}
    bi = {v: i for i, v in enumerate(cb)}
    table = np.zeros((len(ra), len(cb)), dtype=float)
    for x, y in zip(a.tolist(), b.tolist()):
        table[ai[x], bi[y]] += 1.0
    n = table.sum()
    if n == 0:
        return 0.0
    try:
        from scipy.stats import chi2_contingency

        chi2, _, _, _ = chi2_contingency(table, correction=False)
    except Exception:
        # Manual chi-squared if scipy is unavailable for any reason.
        row = table.sum(axis=1, keepdims=True)
        col = table.sum(axis=0, keepdims=True)
        expected = row @ col / n
        with np.errstate(divide="ignore", invalid="ignore"):
            chi2 = float(np.nansum((table - expected) ** 2 / np.where(expected == 0, np.nan, expected)))
    denom = n * (min(table.shape) - 1)
    if denom <= 0:
        return 0.0
    return float(np.sqrt(max(chi2, 0.0) / denom))


def _grid(interest: Sequence[Any], nuisance: Sequence[Any]) -> ConfoundGrid:
    rows = [str(x) for x in dict.fromkeys(list(interest))]
    cols = [str(x) for x in dict.fromkeys(list(nuisance))]
    ri = {v: i for i, v in enumerate(rows)}
    ci = {v: i for i, v in enumerate(cols)}
    cells = [[0.0 for _ in cols] for _ in rows]
    for x, y in zip(interest, nuisance):
        cells[ri[str(x)]][ci[str(y)]] += 1.0
    return ConfoundGrid(rows=rows, cols=cols, cells=cells)


def _design_rank_deficient(cols: Sequence[Sequence[Any]]) -> bool:
    """One-hot the columns (drop-first per factor) and test for rank deficiency."""
    blocks = [np.ones((len(cols[0]), 1))] if cols else []
    for c in cols:
        levels = list(dict.fromkeys([str(v) for v in c]))
        if len(levels) < 2:
            continue
        idx = {v: i for i, v in enumerate(levels)}
        onehot = np.zeros((len(c), len(levels)))
        for i, v in enumerate(c):
            onehot[i, idx[str(v)]] = 1.0
        blocks.append(onehot[:, 1:])  # drop first level
    if not blocks:
        return False
    design = np.hstack(blocks)
    rank = int(np.linalg.matrix_rank(design))
    return rank < design.shape[1]


def _pick_nuisance_col(adata: Any, nuisance_names: Sequence[str], interest_vec: Sequence[Any]):
    """Choose the technical column most aligned with the grouping."""
    best_name, best_vec, best_v = None, None, -1.0
    for name in nuisance_names:
        vec = obs_series(adata, name)
        if vec is None:
            continue
        v = cramers_v(interest_vec, vec)
        if v > best_v:
            best_name, best_vec, best_v = name, vec, v
    return best_name, best_vec, best_v


def _aligned_from_fields(adata: Any, fields, interest_vec) -> Optional[tuple[str, float]]:
    """Find a nuisance-role column that lines up with the grouping (for the message)."""
    best = None
    for f in fields or []:
        role = f.get("role") if isinstance(f, dict) else getattr(f, "role", None)
        fid = f.get("id") if isinstance(f, dict) else getattr(f, "id", None)
        if role != "nuisance" or not fid:
            continue
        vec = obs_series(adata, fid)
        if vec is None:
            continue
        v = cramers_v(interest_vec, vec)
        if best is None or v > best[1]:
            best = (fid, v)
    return best


def run(adata: Any, config: Any, fields: Any = None) -> ComputeResult:
    interest_name = cfg_get(config, "interest", None) or cfg_get(config, "grouping", None)
    nuisance_names = list(cfg_get(config, "nuisance", []) or [])

    interest_vec = obs_series(adata, interest_name) if interest_name else None
    if interest_vec is None:
        # Nothing to compare against. Flag for input rather than guessing.
        grid = ConfoundGrid(rows=[], cols=[], cells=[])
        return compute_result(
            4,
            FLAG_ONLY,
            "No grouping column is resolved, so confounding cannot be assessed.",
            [stat("Grouping", "not set")],
            confound_chart(grid, None, verified=False),
        )

    # No technical variable selected: cannot assess. Name the aligned one if we can.
    if not nuisance_names:
        aligned = _aligned_from_fields(adata, fields, interest_vec)
        levels = list(dict.fromkeys([str(x) for x in interest_vec]))
        grid = _grid(interest_vec, interest_vec)  # placeholder occupancy against itself
        if aligned and aligned[1] >= NESTED_THRESHOLD:
            head = (
                f"'{aligned[0]}' lines up exactly with '{interest_name}' but was left out of the "
                "nuisance set, so confounding was not tested."
            )
        elif aligned:
            head = (
                f"No technical variable was selected. '{aligned[0]}' shows some alignment with "
                f"'{interest_name}'; add it to test separability."
            )
        else:
            head = "No technical variable was selected, so confounding could not be assessed."
        stats = [stat("Nuisance vars", "0", bad=True), stat("Assessed", "no")]
        if aligned:
            stats.append(stat("Aligns with grouping", aligned[0]))
        return compute_result(
            4,
            FLAG_ONLY,
            head,
            stats,
            confound_chart(ConfoundGrid(rows=levels, cols=[], cells=[[] for _ in levels]), None, verified=False),
        )

    name, nuis_vec, _ = _pick_nuisance_col(adata, nuisance_names, interest_vec)
    if nuis_vec is None:
        grid = ConfoundGrid(rows=list(dict.fromkeys([str(x) for x in interest_vec])), cols=[], cells=[])
        return compute_result(
            4,
            FLAG_ONLY,
            f"None of the selected technical columns {nuisance_names} exist in obs.",
            [stat("Nuisance vars", str(len(nuisance_names)), bad=True), stat("Found", "0")],
            confound_chart(grid, None, verified=False),
        )

    v = cramers_v(interest_vec, nuis_vec)
    grid = _grid(interest_vec, nuis_vec)
    present_cols = [obs_series(adata, n) for n in nuisance_names]
    present_cols = [c for c in present_cols if c is not None]
    rank_deficient = _design_rank_deficient([list(interest_vec)] + [list(c) for c in present_cols])
    inseparable = v >= NESTED_THRESHOLD or rank_deficient

    if inseparable:
        head = (
            f"'{interest_name}' and '{name}' are the same split here; the effect cannot be "
            "separated from the technical variable."
        )
        stats = [
            stat("Cramer's V", f"{v:.2f}", bad=True),
            stat("Separable", "no", bad=True),
            stat("Design", "rank deficient" if rank_deficient else "fully nested"),
        ]
        return compute_result(4, FLAGGED, head, stats, confound_chart(grid, v, verified=True))

    # Separable. Optionally confirm the effect survives a multi-factor refit,
    # aggregated to the replicate unit. Never refit over cells: that is the very
    # pseudoreplication Pillar 1 exists to catch.
    survives = _refit_survives(adata, interest_name, name, interest_vec, nuis_vec, fields)
    head = f"'{interest_name}' can be separated from '{name}'; the comparison is identifiable."
    stats = [
        stat("Cramer's V", f"{v:.2f}", good=True),
        stat("Separable", "yes", good=True),
    ]
    if survives is not None:
        stats.append(
            stat("Effect after ~cond+batch", "holds" if survives else "gone", good=survives, bad=(not survives))
        )
    return compute_result(4, CLEAN, head, stats, confound_chart(grid, v, verified=True))


def _unit_column(fields: Any) -> Optional[str]:
    """The obs column the foundation step resolved as the replicate unit."""
    for f in fields or []:
        role = f.get("role") if isinstance(f, dict) else getattr(f, "role", None)
        if str(role) == "unit":
            fid = f.get("id") if isinstance(f, dict) else getattr(f, "id", None)
            return str(fid) if fid else None
    return None


def _refit_survives(
    adata: Any, interest_name: str, nuis_name: str, interest_vec, nuis_vec, fields: Any = None
) -> Optional[bool]:
    """Best-effort multi-factor PyDESeq2 refit ``~ interest + nuisance``, on
    pseudobulk over the replicate unit.

    Returns True/False when a refit could run, or None when PyDESeq2, the counts,
    or the replicate unit are unavailable. Import is lazy so the base install and
    the contract tests do not need the heavy statistical stack.

    The refit **must** aggregate to the unit first. Fitting over cells treats each
    cell as an independent replicate, which is the pseudoreplication Pillar 1
    exists to catch, and a rigor tool does not get to commit the error it audits.
    It was also intractable: 1140 cells took 213s, over the engine's own timeout,
    where the pseudobulk fit takes about a second.
    """
    from .. import gating

    counts, _ = gating.counts_array(adata)
    if counts is None:
        return None
    unit_col = _unit_column(fields)
    if not unit_col:
        # No resolved replicate unit: report nothing rather than pseudoreplicate.
        return None
    try:
        import pandas as pd
        from pydeseq2.dds import DeseqDataSet
        from pydeseq2.ds import DeseqStats

        units = np.asarray([str(x) for x in obs_series(adata, unit_col)])
        interest = np.asarray([str(x) for x in interest_vec])
        nuis = np.asarray([str(x) for x in nuis_vec])

        var_names = [str(v) for v in getattr(adata, "var_names", range(counts.shape[1]))]
        cells = pd.DataFrame(np.rint(np.clip(counts, 0, None)).astype(int), columns=var_names)
        key = pd.Series([f"{u}|{i}|{n}" for u, i, n in zip(units, interest, nuis)], name="sample")

        # Sum counts within each (unit, interest, nuisance) sample. This is what
        # decoupler's get_pseudobulk(mode="sum") computes, without the dependency.
        counts_df = cells.groupby(key, sort=True).sum()
        meta = pd.DataFrame(
            {
                interest_name: [s.split("|")[1] for s in counts_df.index],
                nuis_name: [s.split("|")[2] for s in counts_df.index],
            },
            index=counts_df.index,
        )
        counts_df = counts_df.loc[:, counts_df.sum(axis=0) > 0]

        # A design needs at least two levels of each factor and more samples than
        # coefficients, otherwise the fit is meaningless rather than merely noisy.
        if counts_df.shape[0] < 4 or meta[interest_name].nunique() < 2 or meta[nuis_name].nunique() < 2:
            return None

        dds = DeseqDataSet(counts=counts_df, metadata=meta, design_factors=[interest_name, nuis_name])
        dds.deseq2()
        levels = list(dict.fromkeys(interest.tolist()))
        st = DeseqStats(dds, contrast=[interest_name, levels[-1], levels[0]])
        st.summary()
        res = st.results_df
        # "Survives" = at least one gene stays significant after adjustment.
        return bool((res["padj"] < 0.05).sum() > 0)
    except Exception:
        return None
