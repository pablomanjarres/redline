"""Dataset descriptor: the compact, JSON-safe map of an .h5ad the planner reads.

The foil generator never reinvents field resolution. It calls the engine's own
``foundation.resolve_fields`` (the same deterministic resolver the product uses)
and then adds the extra facts a claim planner needs: how many biological units
sit inside each grouping arm (so it knows whether a pseudobulk contrast is even
possible), which categorical column can carry cell-state labels, which genes vary
enough to headline a claim, and which single gene the naive cell-level test would
call most significant between the two arms.

The descriptor is deliberately small and serializable. It is the thing handed to
Claude (via Bedrock) or to the deterministic heuristic so both choose a claim
from the same evidence. No column name is hardcoded here; everything is read off
the resolved roles.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

import numpy as np


@dataclass
class DatasetDescriptor:
    """Everything a claim planner needs, read off one AnnData."""

    n_cells: int
    n_genes: int
    obs_columns: list[str]
    fields: list[dict]  # FieldSpec dicts from foundation.resolve_fields
    roles: dict[str, list[str]]  # role -> column ids carrying it
    unit: Optional[str]
    grouping: Optional[str]
    nuisance: Optional[str]
    derived: Optional[str]
    observation: Optional[str]
    grouping_levels: list[str]
    grouping_counts: dict[str, int]
    units_per_group: dict[str, int]  # grouping level -> distinct unit count
    total_units: int
    has_counts: bool
    counts_source: Optional[str]
    candidate_genes: list[str]  # high-variance genes, a claim could headline any
    naive_focus_gene: Optional[str]  # the gene the naive cell-level test flags hardest
    state_candidates: list[str]  # categorical columns that could label cell states
    feasibility: dict[str, Any]  # which flaws are plantable, and why not when not

    def to_json(self) -> dict[str, Any]:
        return {
            "nCells": self.n_cells,
            "nGenes": self.n_genes,
            "obsColumns": self.obs_columns,
            "fields": self.fields,
            "roles": self.roles,
            "unit": self.unit,
            "grouping": self.grouping,
            "nuisance": self.nuisance,
            "derived": self.derived,
            "observation": self.observation,
            "groupingLevels": self.grouping_levels,
            "groupingCounts": self.grouping_counts,
            "unitsPerGroup": self.units_per_group,
            "totalUnits": self.total_units,
            "hasCounts": self.has_counts,
            "countsSource": self.counts_source,
            "candidateGenes": self.candidate_genes,
            "naiveFocusGene": self.naive_focus_gene,
            "stateCandidates": self.state_candidates,
            "feasibility": self.feasibility,
        }


def _role_map(fields: list[dict]) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for f in fields:
        role = str(f.get("role", "ignore"))
        out.setdefault(role, []).append(str(f.get("id")))
    return out


def _first(roles: dict[str, list[str]], role: str) -> Optional[str]:
    vals = roles.get(role) or []
    return vals[0] if vals else None


def _series(adata: Any, name: Optional[str]) -> Optional[np.ndarray]:
    if not name:
        return None
    obs = getattr(adata, "obs", None)
    if obs is None or name not in obs.columns:
        return None
    return np.asarray(obs[name].to_numpy())


def _high_variance_genes(counts: Optional[np.ndarray], var_names: list[str], top: int) -> list[str]:
    """Genes with the most spread, restricted to ones expressed in enough cells so
    a claim built on them is not headlining a near-silent gene."""
    if counts is None or counts.shape[1] == 0:
        return var_names[:top]
    C = np.asarray(counts, dtype=float)
    detect_rate = (C > 0).mean(axis=0)
    expressed = detect_rate >= 0.02
    log = np.log1p(np.clip(C, 0, None))
    v = log.var(axis=0)
    v = np.where(expressed, v, -1.0)
    order = np.argsort(-v)
    picks = [var_names[i] for i in order if v[i] > 0][:top]
    return picks or var_names[:top]


def _naive_focus_gene(
    counts: Optional[np.ndarray], var_names: list[str], g0: np.ndarray, g1: np.ndarray
) -> Optional[str]:
    """The gene a naive cell-level test between the two arms would call hardest.

    Mirrors the pillar-1 gene picker: the largest absolute t of per-cell log
    expression between the arms. This is the honest choice for the gene a
    less-experienced scientist would headline.
    """
    if counts is None or counts.shape[1] == 0:
        return var_names[0] if var_names else None
    if g0.sum() < 2 or g1.sum() < 2:
        return None
    log = np.log1p(np.clip(np.asarray(counts, dtype=float), 0, None))
    a, b = log[g0], log[g1]
    ma, mb = a.mean(axis=0), b.mean(axis=0)
    se = np.sqrt(a.var(axis=0, ddof=1) / a.shape[0] + b.var(axis=0, ddof=1) / b.shape[0])
    with np.errstate(divide="ignore", invalid="ignore"):
        t = np.where(se > 0, (mb - ma) / se, 0.0)
    idx = int(np.argmax(np.abs(np.nan_to_num(t))))
    return var_names[idx]


def _state_candidates(fields: list[dict], grouping: Optional[str], unit: Optional[str]) -> list[str]:
    """Categorical columns that could carry cell-state labels: a derived column
    first, then any low-cardinality categorical that is not the grouping or unit."""
    out: list[str] = []
    for f in fields:
        if f.get("role") == "derived":
            out.append(str(f["id"]))
    for f in fields:
        fid = str(f.get("id"))
        if fid in out or fid in (grouping, unit):
            continue
        if f.get("dtype") == "categorical":
            levels = f.get("levels")
            if isinstance(levels, int) and 2 <= levels <= 40:
                out.append(fid)
    return out


def describe_dataset(adata: Any) -> DatasetDescriptor:
    """Build the descriptor for one AnnData using the engine's own field resolver."""
    from .. import foundation, gating
    from ..pillars import two_groups

    fields = [f.to_json() if hasattr(f, "to_json") else dict(f) for f in foundation.resolve_fields(adata)]
    roles = _role_map(fields)
    unit = _first(roles, "unit")
    grouping = _first(roles, "grouping")
    nuisance = _first(roles, "nuisance")
    derived = _first(roles, "derived")
    observation = _first(roles, "observation")

    var_names = [str(v) for v in getattr(adata, "var_names", [])]
    counts, counts_source = gating.counts_array(adata)
    has_counts = counts is not None

    # Grouping levels and the units nested in each arm (pillar-1 feasibility).
    grouping_levels: list[str] = []
    grouping_counts: dict[str, int] = {}
    units_per_group: dict[str, int] = {}
    total_units = 0
    g0 = np.zeros(int(getattr(adata, "n_obs", 0)), dtype=bool)
    g1 = g0.copy()
    gvec = _series(adata, grouping)
    uvec = _series(adata, unit)
    if gvec is not None:
        gstr = np.asarray([str(x) for x in gvec])
        levels, counts_arr = np.unique(gstr, return_counts=True)
        grouping_levels = [str(x) for x in levels]
        grouping_counts = {str(lvl): int(c) for lvl, c in zip(levels, counts_arr)}
        if uvec is not None:
            ustr = np.asarray([str(x) for x in uvec])
            all_units: set[str] = set()
            for lvl in grouping_levels:
                units_here = set(ustr[gstr == lvl].tolist())
                units_per_group[lvl] = len(units_here)
                all_units |= units_here
            total_units = len(all_units)
        picked = two_groups(gstr)
        if picked is not None:
            _ref, _alt, g0, g1 = picked

    candidate_genes = _high_variance_genes(counts, var_names, top=25)
    naive_focus = _naive_focus_gene(counts, var_names, g0, g1)
    state_candidates = _state_candidates(fields, grouping, unit)

    min_units_per_group = min(units_per_group.values()) if units_per_group else 0
    feasibility = {
        "pseudoreplication": {
            "plantable": bool(unit and grouping and len(grouping_levels) >= 2 and min_units_per_group >= 2 and has_counts),
            "reason": _feas_reason_pillar1(unit, grouping, grouping_levels, min_units_per_group, has_counts),
        },
        "double_dipping": {
            "plantable": bool(has_counts and len(var_names) >= 20 and int(getattr(adata, "n_obs", 0)) >= 80),
            "reason": "Needs raw counts, at least 20 genes to carve marker blocks, and at least 80 cells."
            if not (has_counts and len(var_names) >= 20 and int(getattr(adata, "n_obs", 0)) >= 80)
            else "Ready: a spurious cell state can be carved from the count matrix.",
        },
        "fragility": {
            "plantable": bool(int(getattr(adata, "n_obs", 0)) >= 80 and len(var_names) >= 20),
            "reason": "Needs at least 80 cells and 20 genes to build a resolution-fragile state."
            if not (int(getattr(adata, "n_obs", 0)) >= 80 and len(var_names) >= 20)
            else "Ready: a boundary-only state can be built.",
        },
        "confounding": {
            "plantable": bool(grouping and len(grouping_levels) >= 2),
            "reason": "Needs a grouping with at least two levels to confound against a technical variable."
            if not (grouping and len(grouping_levels) >= 2)
            else "Ready: a technical variable can be made collinear with the grouping.",
        },
    }

    return DatasetDescriptor(
        n_cells=int(getattr(adata, "n_obs", 0)),
        n_genes=int(getattr(adata, "n_vars", len(var_names))),
        obs_columns=[str(c) for c in getattr(adata, "obs").columns] if getattr(adata, "obs", None) is not None else [],
        fields=fields,
        roles=roles,
        unit=unit,
        grouping=grouping,
        nuisance=nuisance,
        derived=derived,
        observation=observation,
        grouping_levels=grouping_levels,
        grouping_counts=grouping_counts,
        units_per_group=units_per_group,
        total_units=total_units,
        has_counts=has_counts,
        counts_source=counts_source,
        candidate_genes=candidate_genes,
        naive_focus_gene=naive_focus,
        state_candidates=state_candidates,
        feasibility=feasibility,
    )


def _feas_reason_pillar1(
    unit: Optional[str], grouping: Optional[str], levels: list[str], min_units: int, has_counts: bool
) -> str:
    if not grouping or len(levels) < 2:
        return "No grouping with two levels to compare."
    if not unit:
        return "No biological-unit column resolved, so there is no replicate to aggregate to."
    if min_units < 2:
        return f"Only {min_units} replicate per arm; pseudobulk needs at least two, so the flaw cannot be caught."
    if not has_counts:
        return "No raw counts, so the pseudobulk re-run cannot run."
    return "Ready: a cell-level significance claim can be planted and will collapse under pseudobulk."
