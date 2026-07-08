"""Foundation - Design Resolution (build first, load-bearing).

Resolves the role each ``obs`` column carries (unit, grouping, observation,
nuisance, covariate, derived, ignore) from cardinality, value patterns, naming,
and relationship to the clustering. A wrong role makes every downstream flag
wrong, so this is a structural gate, not a convenience.

The model-authored proposal (Claude via Bedrock) is the reasoning layer's job.
This module is the deterministic heuristic resolver that runs with no network and
no model call, so the engine always has a defensible default to confirm or edit.
"""

from __future__ import annotations

from typing import Any, Optional

import numpy as np

from .contracts import FieldSpec, field_spec
from .pillars.confounding import cramers_v

# ── Name-hint vocabularies (matched on a normalized column name) ──────────────
_UNIT = (
    "donor", "mouse", "patient", "subject", "sample", "replicate", "animal",
    "individual", "orig_ident", "orig.ident", "biosample", "specimen",
    "participant", "rat", "pig", "hashtag", "hto",
)
_GROUPING = (
    "condition", "stim", "treat", "treatment", "perturb", "perturbation",
    "guide", "grna", "sgrna", "genotype", "drug", "group", "target", "ko",
    "kd", "knockdown", "knockout", "disease", "status", "timepoint",
    "time_point", "dose", "stimulation", "arm", "cohort", "response",
)
_NUISANCE = (
    "batch", "lane", "run", "chemistry", "date", "10x", "plate", "well",
    "flowcell", "pool", "library", "chip", "seq", "sequencing", "processing",
    "day", "machine", "site", "center", "protocol", "version", "kit", "channel",
)
_COVARIATE = (
    "n_genes", "n_counts", "total_counts", "pct", "percent", "mito", "ribo",
    "n_features", "ncount", "nfeature", "doublet", "score", "complexity",
    "log1p", "n_umi", "umi", "gene_count",
)
_DERIVED = (
    "leiden", "louvain", "kmeans", "cluster", "seurat_clusters", "celltype",
    "cell_type", "cell.type", "annotation", "subcluster", "sub_cluster",
    "phenograph", "cell_state", "celltype_annotation",
)
_CELLCYCLE = ("phase", "cell_cycle", "cellcycle", "s_score", "g2m", "cc_phase")
_DEMOGRAPHIC = ("sex", "gender", "age", "ethnicity", "race", "bmi")
_BARCODE = ("barcode", "cell_id", "cellid", "cell_barcode", "index", "obs_names")


def _norm(name: str) -> str:
    return str(name).strip().lower().replace(".", "_").replace("-", "_").replace(" ", "_")


def _hit(norm: str, vocab: tuple[str, ...]) -> bool:
    parts = set(norm.split("_"))
    return any(h in parts or h in norm for h in vocab)


def _num_kind(series: Any) -> tuple[bool, bool]:
    """Return ``(is_numeric, is_float)`` for a column, robust to missing pandas."""
    try:
        import pandas as pd

        if bool(pd.api.types.is_bool_dtype(series)):
            return False, False
        is_num = bool(pd.api.types.is_numeric_dtype(series))
        is_float = bool(pd.api.types.is_float_dtype(series))
        return is_num, is_float
    except Exception:
        return False, False


def _summ(series: Any, n_obs: int) -> dict:
    try:
        nona = series.dropna()
    except Exception:
        nona = series
    try:
        nunique = int(nona.nunique())
    except Exception:
        nunique = len(set(list(nona)))
    try:
        missing = int(series.isna().sum())
    except Exception:
        missing = 0
    is_num, is_float = _num_kind(series)
    try:
        uniques = [str(v) for v in list(dict.fromkeys(list(nona)))[:3]]
    except Exception:
        uniques = []
    return {"nunique": nunique, "missing": missing, "is_num": is_num, "is_float": is_float, "uniques": uniques}


def _dtype_of(name_norm: str, s: dict, n_obs: int) -> str:
    nunique = s["nunique"]
    # Name overrides first: cluster labels are categorical, barcodes are ids.
    if _hit(name_norm, _DERIVED):
        return "categorical"
    if _hit(name_norm, _BARCODE):
        return "identifier"
    if not s["is_num"] and nunique >= max(0.9 * n_obs, n_obs - 1) and nunique > 1:
        return "identifier"
    # A float column, or an integer column with more than a few distinct values,
    # is a continuous measurement (n_genes, pct_mito, total_counts), not a category.
    if s["is_num"] and (s["is_float"] or nunique > 12):
        return "numeric"
    return "categorical"


def _classify(name_norm: str, dtype: str, levels: Optional[int]) -> tuple[str, str, str]:
    """Return (role, confidence, reason) from name + dtype + cardinality."""
    if dtype == "identifier":
        return "observation", "high", "One value per row; these are measurements, not independent samples."

    if dtype == "numeric":
        if _hit(name_norm, _COVARIATE):
            return "covariate", "high", "Per-cell quality covariate."
        return "covariate", "medium", "Continuous per-cell measure; treated as a covariate."

    # categorical
    if _hit(name_norm, _DERIVED):
        return "derived", "medium", "Cluster labels you computed. A derived grouping, not a measured field."
    if _hit(name_norm, _CELLCYCLE):
        return "nuisance", "low", "Cell-cycle phase. Confirm whether to adjust for it or ignore it."
    if _hit(name_norm, _GROUPING):
        conf = "high" if levels is not None and 2 <= levels <= 6 else "medium"
        return "grouping", conf, "This is the contrast your analysis compares."
    if _hit(name_norm, _UNIT):
        conf = "high" if levels is not None and 2 <= levels <= 64 else "medium"
        return (
            "unit",
            conf,
            "Treatment is assigned at this level and cells nest inside it, so this is the true replicate.",
        )
    if _hit(name_norm, _NUISANCE):
        return "nuisance", "medium", "Technical variable that could confound the comparison."
    if _hit(name_norm, _DEMOGRAPHIC):
        return "nuisance", "low", "Demographic variable. Confirm whether to adjust for it or ignore it."

    if levels is not None and 2 <= levels <= 3:
        return "grouping", "low", "Low-cardinality categorical; a possible comparison. Confirm the role."
    if levels is not None and 4 <= levels <= 64:
        return "unit", "low", "A handful of levels with many cells each; a possible replicate. Confirm the role."
    return "ignore", "low", "No clear role. Ignored unless you assign one."


def resolve_fields(adata: Any) -> list[FieldSpec]:
    """Deterministic role proposal for every ``obs`` column."""
    obs = getattr(adata, "obs", None)
    if obs is None:
        return []
    n_obs = int(getattr(adata, "n_obs", len(obs)))

    rows: list[dict] = []
    for name in list(obs.columns):
        s = _summ(obs[name], n_obs)
        norm = _norm(name)
        dtype = _dtype_of(norm, s, n_obs)
        levels = None if dtype == "numeric" else s["nunique"]
        role, conf, reason = _classify(norm, dtype, levels)
        sample = " · ".join(s["uniques"]) if (dtype != "numeric" and s["uniques"] and s["nunique"] <= 200) else None
        rows.append(
            {
                "name": str(name),
                "norm": norm,
                "dtype": dtype,
                "levels": levels,
                "missing": s["missing"],
                "role": role,
                "conf": conf,
                "reason": reason,
                "sample": sample,
            }
        )

    # Relationship pass: mark nuisance columns that line up with the grouping, so
    # the confounding check has a lead and the scientist sees the alignment.
    grouping_name = next((r["name"] for r in rows if r["role"] == "grouping" and r["conf"] == "high"), None)
    if grouping_name is None:
        grouping_name = next((r["name"] for r in rows if r["role"] == "grouping"), None)
    if grouping_name is not None:
        g_vals = np.asarray(obs[grouping_name].to_numpy())
        for r in rows:
            if r["role"] != "nuisance" or r["levels"] is None or r["levels"] > 25:
                continue
            try:
                v = cramers_v(g_vals, np.asarray(obs[r["name"]].to_numpy()))
            except Exception:
                continue
            if v >= 0.8:
                r["conf"] = "medium" if r["conf"] == "low" else r["conf"]
                r["reason"] = (
                    f"Technical variable. Its levels line up with '{grouping_name}' "
                    f"(Cramer's V {v:.2f}), a possible confound flagged to the confounding check."
                )

    return [
        field_spec(
            id=r["name"],
            dtype=r["dtype"],
            levels=r["levels"],
            missing=r["missing"],
            role=r["role"],
            confidence=r["conf"],
            reason=r["reason"],
            sample=r["sample"],
        )
        for r in rows
    ]


def resolve_field_dicts(adata: Any) -> list[dict]:
    """Foundation output as JSON dicts (for the MCP ``redline_resolve_fields`` tool)."""
    return [f.to_json() for f in resolve_fields(adata)]
