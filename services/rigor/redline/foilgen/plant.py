"""Flaw planting: turn a neutral dataset into the naive analysis a scientist ran.

Given a plan, this reshapes a COPY of the count matrix and the obs so the real
Redline engine returns the intended verdict for each pillar. Nothing here asserts
a verdict; it induces the structure and lets the engine decide. The generator
then runs the engine to confirm, so a foil is only ever kept when its planted
flaw is genuinely caught (never cry wolf, even at the fixture level).

Each mechanism is the textbook error, induced strongly so the verdict holds under
either clustering backend (scanpy Leiden or the numpy KMeans fallback):

- pseudoreplication: the focus gene gets a wide between-unit baseline and a small
  arm tilt. Cell-level significance is real (tens of thousands of correlated
  cells); it collapses under pseudobulk to a handful of replicates.
- double dipping: a spurious cell state is a plurality of cells whose named
  markers are background noise, so the markers separate at discovery and collapse
  on a held-out count split.
- fragility: that same spurious state has no coherent program, so it is a discrete
  cluster only inside a narrow resolution window.
- confounding: the technical column is made collinear with the grouping.

A clean variant induces the honest version of each: a donor-consistent effect
that survives pseudobulk, cell states with reproducible markers, a stable cluster,
and a technical column independent of the grouping.
"""

from __future__ import annotations

from typing import Any, Optional

import numpy as np


def _gene_index(var_names: list[str], genes: list[str]) -> list[int]:
    lut = {g: i for i, g in enumerate(var_names)}
    return [lut[g] for g in genes if g in lut]


def _extra_filler(var_names: list[str], used: set[str], n: int, seed: int) -> list[int]:
    """Deterministically borrow ``n`` unused genes to thicken a marker block, so a
    real cluster is tight even when the plan named only a few markers."""
    rng = np.random.default_rng(seed)
    pool = [i for i, g in enumerate(var_names) if g not in used]
    if not pool:
        return []
    rng.shuffle(pool)
    return pool[:n]


def _set_block(X: np.ndarray, cell_mask: np.ndarray, cols: list[int], hi: float, lo: float, rng) -> None:
    """Strong bimodal block: a tight, reproducible, well-separated marker set."""
    if not cols or cell_mask.sum() == 0:
        return
    ncells_in = int(cell_mask.sum())
    ncells_out = int((~cell_mask).sum())
    idx = np.ix_(cell_mask, cols)
    X[idx] = rng.poisson(hi, size=(ncells_in, len(cols)))
    out_idx = np.ix_(~cell_mask, cols)
    X[out_idx] = rng.poisson(lo, size=(ncells_out, len(cols)))


def _arm_masks(obs, grouping: str, control: str, treated: str) -> tuple[np.ndarray, np.ndarray]:
    g = np.asarray([str(x) for x in obs[grouping].to_numpy()])
    return g == control, g == treated


# ── Pillar 1: the focus gene ──────────────────────────────────────────────────
def _plant_pseudoreplication(
    X: np.ndarray, obs, plan, gi: int, seed: int
) -> dict:
    """Overwrite the focus gene so cell-level DE is significant but pseudobulk is
    not: a wide between-unit baseline plus a small arm tilt."""
    rng = np.random.default_rng(seed + 101)
    unit = plan.unit
    grouping = plan.grouping
    units = np.asarray([str(x) for x in obs[unit].to_numpy()]) if unit else np.array(["u0"] * X.shape[0])
    arms = np.asarray([str(x) for x in obs[grouping].to_numpy()])

    # Assign each unit a deterministic baseline spread wide across the arm, plus a
    # consistent arm offset. The wide within-arm spread means the replicates per
    # arm carry too much variance for a pseudobulk test to call it significant, but
    # the consistent offset lifts every treated cell a little, so a cell-level test
    # over hundreds of cells per arm is "significant". That gap is pseudoreplication.
    def _arm_of(u: str) -> bool:
        return bool(np.mean(arms[units == u] == plan.treated_level) >= 0.5)

    control_units = sorted({u for u in np.unique(units) if not _arm_of(u)})
    treated_units = sorted({u for u in np.unique(units) if _arm_of(u)})
    spread = np.linspace(2.5, 8.0, max(len(control_units), len(treated_units), 1))
    # The offset must SHRINK as the replicate count grows, or a fixed offset becomes
    # a genuine, replicate-level effect that pseudobulk correctly detects (the flaw
    # would stop being pseudoreplication and the engine would return clean). Scaling
    # by 1/sqrt(k) holds the pseudobulk effect size roughly constant across datasets
    # with few or many donors, so the cell-level inflation is always the artifact.
    k = max(min(len(control_units), len(treated_units)), 1)
    offset = 2.0 * (3.0 / k) ** 0.5
    baseline: dict[str, float] = {}
    for i, u in enumerate(control_units):
        baseline[u] = float(spread[i % len(spread)])
    for i, u in enumerate(treated_units):
        baseline[u] = float(spread[i % len(spread)]) + offset
    lam = np.array([baseline.get(u, 5.0) for u in units], dtype=float)
    X[:, gi] = rng.poisson(lam)
    return {
        "mechanism": "wide deterministic between-unit baseline with a consistent arm offset on the focus gene",
        "focus_gene": plan.focus_gene,
        "unit": unit,
        "grouping": grouping,
    }


def _plant_clean_effect(X: np.ndarray, obs, plan, gi: int, seed: int) -> dict:
    """A genuine, donor-consistent arm effect that survives pseudobulk: every
    treated unit high, every control unit low, tight within each unit."""
    rng = np.random.default_rng(seed + 202)
    grouping = plan.grouping
    arms = np.asarray([str(x) for x in obs[grouping].to_numpy()])
    treated_mask = arms == plan.treated_level
    control_mask = arms == plan.control_level
    lam = np.ones(X.shape[0], dtype=float) * 2.0
    lam[treated_mask] = 12.0
    lam[control_mask] = 2.0
    X[:, gi] = rng.poisson(lam)
    return {
        "mechanism": "donor-consistent arm effect that survives pseudobulk",
        "focus_gene": plan.focus_gene,
        "unit": plan.unit,
        "grouping": grouping,
    }


# ── Pillars 2 and 3: the cell-state column ────────────────────────────────────
def state_layout(plan) -> list[tuple[str, float, str]]:
    """(name, proportion, kind) per cell state, chosen from the planted flaws.

    kind: 'noise' (no coherent program), 'real_tight' (small strong cluster),
    'real_bulk' (large reproducible cluster), 'filler' (unstructured background).
    The spurious state is audited by name (target_group), so it does not need to
    be the plurality; real clustering fragility is a minority subpopulation, so the
    spurious state is a minority here. Every non-clean layout still carries a
    genuine stable state, which Pillar 3 tracks as its clean reference.
    """
    planted = set(plan.planted_flaws)
    if plan.clean or not (2 in planted or 3 in planted):
        # All real: a reproducible bulk plurality and a small, strongly separated
        # stable cluster. The stable state is kept small so a strong block stays one
        # discrete cluster across the sweep without over-splitting at high resolution.
        return [("Bulk", 0.86, "real_bulk"), (plan.stable_state, 0.14, "real_tight")]
    # A realistic over-cluster: the spurious state is a MINORITY with no coherent
    # program. A reproducible bulk plurality holds up (so the default double-dipping
    # check stays clean on it when Pillar 2 is not planted), a small genuine stable
    # cluster is the clean fragility track, and a larger background filler pool
    # keeps the spurious state from ever dominating a noise cluster (so it never
    # reads as a discrete population and fragility flags it reliably).
    return [("Bulk", 0.46, "real_bulk"), (plan.spurious_state, 0.14, "noise"),
            (plan.stable_state, 0.14, "real_tight"), ("Bystander", 0.26, "filler")]


# Marker-block magnitudes, tuned against the real engine so the intended verdict
# holds under either clustering backend. The stable block is strong enough to stay
# a discrete cluster across the resolution sweep, but not so strong it dominates
# the principal components and flattens the spurious noise (which would let the
# stable inverse markers rescue the double-dipping split).
TUNING = {
    # The stable block is strong so it stays one discrete cluster across the whole
    # resolution sweep even when a high-variance focus gene (many donors) competes
    # for the embedding. Pillar 2 is audited by name (target_group), so a strong
    # stable block no longer risks dominating the double-dipping re-clustering.
    "stable_hi": 30.0,
    "stable_lo": 0.2,
    "stable_extra_genes": 10,
    "bulk_hi": 14.0,
    "bulk_lo": 0.3,
    "bulk_genes": 12,
}


def _stratified_states(names: list[str], probs: np.ndarray, groups: np.ndarray, rng) -> np.ndarray:
    """Assign states so every grouping arm carries the same state proportions.

    Balanced assignment keeps the state markers free of any arm signal, so the
    focus gene stays the most naively significant gene between the arms and
    Pillar 1 tests it, not a marker block.
    """
    n = groups.size
    states = np.empty(n, dtype=object)
    for arm in np.unique(groups):
        idx = np.where(groups == arm)[0]
        rng.shuffle(idx)
        counts = np.floor(probs * len(idx)).astype(int)
        while counts.sum() < len(idx):
            deficit = probs - counts / max(len(idx), 1)
            counts[int(np.argmax(deficit))] += 1
        pos = 0
        for name, cnt in zip(names, counts):
            states[idx[pos:pos + cnt]] = name
            pos += cnt
    return states.astype(str)


def _plant_states(X: np.ndarray, obs, var_names: list[str], plan, seed: int) -> dict:
    """Assign the cell-state column and carve the marker blocks that make each
    state real or spurious."""
    rng = np.random.default_rng(seed + 303)
    n = X.shape[0]
    layout = state_layout(plan)
    names = [name for name, _p, _k in layout]
    probs = np.array([p for _n, p, _k in layout], dtype=float)
    probs = probs / probs.sum()
    groups = (
        np.asarray([str(x) for x in obs[plan.grouping].to_numpy()])
        if plan.grouping and plan.grouping in obs.columns
        else np.zeros(n, dtype=str)
    )
    states = _stratified_states(names, probs, groups, rng)

    used = {plan.focus_gene, *plan.spurious_markers, *plan.stable_markers}
    # The stable state is strongly separated so it stays one discrete cluster even
    # at the coarse low end of the resolution sweep (Pillar 3 clean). The bulk
    # state is reproducible but looser.
    stable_cols = _gene_index(var_names, plan.stable_markers)
    stable_cols += _extra_filler(var_names, used, TUNING["stable_extra_genes"], seed + 1)
    bulk_used = used | {var_names[i] for i in stable_cols}
    bulk_cols = _extra_filler(var_names, bulk_used, TUNING["bulk_genes"], seed + 2)

    facts_states: list[dict] = []
    for name, _p, kind in layout:
        mask = states == name
        if kind == "real_tight":
            _set_block(X, mask, stable_cols, hi=TUNING["stable_hi"], lo=TUNING["stable_lo"], rng=rng)
            facts_states.append({"state": name, "kind": kind, "markers": [var_names[i] for i in stable_cols]})
        elif kind == "real_bulk":
            _set_block(X, mask, bulk_cols, hi=TUNING["bulk_hi"], lo=TUNING["bulk_lo"], rng=rng)
            facts_states.append({"state": name, "kind": kind, "markers": [var_names[i] for i in bulk_cols]})
        else:
            # noise / filler: no coherent program is written. The spurious state
            # has no real markers; its apparent markers come only from double
            # dipping (see below).
            facts_states.append({"state": name, "kind": kind, "markers": []})

    # The double-dip: read the spurious state's top markers off the same cells that
    # define it. These genuinely separate it best in sample, and because the state
    # has no real program they collapse on a held-out count split. The claim and
    # the audit both use exactly these, so the ground truth is faithful.
    spurious_name = _noise_name(layout)
    doubledip: list[str] = []
    if spurious_name is not None and not plan.clean:
        exclude = {plan.focus_gene, *(var_names[i] for i in stable_cols), *(var_names[i] for i in bulk_cols)}
        doubledip = _doubledip_markers(X, states == spurious_name, var_names, exclude, k=4)
        if doubledip:
            plan.spurious_markers = doubledip

    obs[plan.state_col] = states.astype(str)
    return {
        "state_col": plan.state_col,
        "states": facts_states,
        "spurious_state": None if (plan.clean or spurious_name is None) else spurious_name,
        "stable_state": plan.stable_state,
        "plurality_state": names[int(np.argmax(probs))],
        "doubledip_markers": doubledip,
        "spurious_markers_named": plan.spurious_markers,
    }


def _doubledip_markers(X: np.ndarray, spurious_mask: np.ndarray, var_names: list[str],
                       exclude: set, k: int) -> list[str]:
    """The genes that best separate the spurious state IN SAMPLE (the double dip),
    excluding the focus gene and the real cluster markers. On a pure-noise state
    these are chance separations that do not survive a held-out split."""
    from ..pillars import safe_auc

    y = spurious_mask.astype(int)
    if y.sum() == 0 or y.sum() == y.size:
        return []
    log = np.log1p(np.clip(X, 0, None))
    scored = [(safe_auc(log[:, j], y), g) for j, g in enumerate(var_names) if g not in exclude]
    scored.sort(key=lambda t: t[0], reverse=True)
    return [g for _auc, g in scored[:k]]


def _noise_name(layout) -> Optional[str]:
    for name, _p, kind in layout:
        if kind == "noise":
            return name
    return None


# ── Pillar 4: the technical column ────────────────────────────────────────────
def _plant_confounding(obs, plan, collinear: bool, seed: int) -> dict:
    """Set the technical column collinear with the grouping (flaw) or independent
    of it (clean)."""
    rng = np.random.default_rng(seed + 404)
    grouping = plan.grouping
    nuis = plan.nuisance or "batch"
    arms = np.asarray([str(x) for x in obs[grouping].to_numpy()])
    if collinear:
        obs[nuis] = np.where(arms == plan.treated_level, f"{nuis}-A", f"{nuis}-B")
        mechanism = "technical column set collinear with the grouping"
    else:
        obs[nuis] = rng.choice([f"{nuis}-1", f"{nuis}-2"], size=len(arms))
        mechanism = "technical column drawn independently of the grouping"
    return {"nuisance": nuis, "grouping": grouping, "collinear": collinear, "mechanism": mechanism}


# ── Orchestration ─────────────────────────────────────────────────────────────
def plant_foil(adata: Any, plan, seed: int = 0) -> tuple[Any, dict]:
    """Return a copy of ``adata`` with the plan's flaws (or cleanliness) planted,
    plus a facts dict describing exactly what was induced."""
    from .. import gating

    a = adata.copy()
    obs = a.obs
    var_names = [str(v) for v in a.var_names]
    C, _src = gating.counts_array(a)
    if C is None:
        C = np.asarray(a.X, dtype=float)
    X = np.array(C, dtype=float)

    planted = set(plan.planted_flaws)
    facts: dict[str, Any] = {"plantedFlaws": sorted(planted), "clean": plan.clean}

    # Focus gene (pillar 1). Plant the flaw, else a genuine clean effect.
    if plan.focus_gene not in var_names:
        # Fall back to the first gene so planting still has a target.
        gi = 0
        plan.focus_gene = var_names[0]
    else:
        gi = var_names.index(plan.focus_gene)
    if not plan.clean and 1 in planted:
        facts["pseudoreplication"] = _plant_pseudoreplication(X, obs, plan, gi, seed)
    else:
        facts["pseudoreplication"] = _plant_clean_effect(X, obs, plan, gi, seed)

    # Cell states (pillars 2 and 3).
    facts["states"] = _plant_states(X, obs, var_names, plan, seed)

    # Technical column (pillar 4).
    collinear = (not plan.clean) and (4 in planted)
    facts["confounding"] = _plant_confounding(obs, plan, collinear, seed)

    # Write the reshaped counts back to X and the counts layer (the layer the
    # engine's gating reads first). Drop any stale .raw the input carried so no
    # downstream path can read pre-planting counts.
    Xf = np.rint(np.clip(X, 0, None)).astype(np.float32)
    a.X = Xf.copy()
    a.layers["counts"] = Xf.copy()
    if getattr(a, "raw", None) is not None:
        a.raw = None

    # Record the naive cell-level statistic the scientist would have reported.
    facts["naive_statistic"] = _naive_focus_statistic(Xf, obs, plan, gi)
    return a, facts


def _naive_focus_statistic(X: np.ndarray, obs, plan, gi: int) -> dict:
    """The flawed statistic itself: a cell-level Welch t on the focus gene, with a
    plain description of how it was computed."""
    arms = np.asarray([str(x) for x in obs[plan.grouping].to_numpy()])
    a = np.log1p(X[arms == plan.control_level, gi])
    b = np.log1p(X[arms == plan.treated_level, gi])
    n_cells = int(a.size + b.size)
    p = 1.0
    t = 0.0
    if a.size >= 2 and b.size >= 2:
        try:
            from scipy.stats import ttest_ind

            res = ttest_ind(a, b, equal_var=False)
            t = float(res.statistic)
            p = float(res.pvalue) if np.isfinite(res.pvalue) else 1.0
        except Exception:
            p = 1.0
    return {
        "gene": plan.focus_gene,
        "method": "Welch t-test on per-cell log1p counts between the two arms",
        "unit_used": "cell (each of tens of thousands of cells treated as an independent sample)",
        "n_cells": n_cells,
        "t": round(t, 3),
        "p": p,
        "computed_how": (
            f"log1p of the {plan.focus_gene} count in every cell, then a two-sample Welch t-test between "
            f"'{plan.control_level}' and '{plan.treated_level}' cells, counting all {n_cells} cells as independent."
        ),
    }
