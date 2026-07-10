"""The Redline arm: run the real engine's four checks on a case.

This calls the actual ``redline`` engine (the same code the product ships), not
a reimplementation, so the benchmark measures the shipped detector. Each check
is pointed at the case's claim (the focus gene, the claimed state, the technical
variable) exactly as a real analysis would specify. The per-check verdict and
its evidence are returned; the LLM critic (``bench.critic``) then reviews each
flag before the final detected set is assembled.
"""

from __future__ import annotations

from typing import Any

import anndata as ad

from redline import resolve_field_dicts
from redline.audit import run_check, default_config

from . import spec


def engine_backend() -> dict[str, str]:
    """Which code path the engine will actually take, recorded in the results so
    a cross-environment replay can detect drift (leiden vs KMeans, PyDESeq2 vs
    Welch change the evidence floats)."""
    import importlib.util as u
    clustering = "leiden" if (u.find_spec("leidenalg") or u.find_spec("igraph")) else "kmeans"
    differential = "pydeseq2" if u.find_spec("pydeseq2") else "welch"
    return {"clustering": clustering, "differential": differential}


def _configs(fields: list[dict], claim: dict) -> dict[int, dict]:
    """Per-check config, seeded from the role-driven defaults, then pointed at
    the claim (the gene / state / technical column under audit).

    The engine's stochastic seed is deliberately OFFSET from the labeler's
    ``label_seed`` so the engine's Poisson-thinning partition and clustering are
    not the identical draws the labeler used. That keeps sampling noise as a real
    source of possible disagreement between the grader and the tool under test."""
    seed = int(claim.get("label_seed", 0)) + 104729   # distinct prime offset from the labeler
    c1 = dict(default_config(1, fields))
    c1.update({"unit": claim["unit_col"], "grouping": claim["condition_col"],
               "gene": claim["focus_gene"], "alpha": spec.ALPHA})
    c2 = dict(default_config(2, fields))
    c2.update({"grouping": claim["state_col"], "target_group": claim["target_state"],
               "split": spec.P2_SPLIT_EPS, "seed": seed})
    c3 = dict(default_config(3, fields))
    c3.update({"track": claim["target_state"], "seed": seed})
    c4 = dict(default_config(4, fields))
    c4.update({"interest": claim["condition_col"], "nuisance": [claim["nuisance_col"]]})
    return {1: c1, 2: c2, 3: c3, 4: c4}


def _evidence(check_id: int, result: dict) -> dict[str, Any]:
    """Pull the load-bearing numbers out of a ComputeResult for the critic."""
    chart = result.get("chart", {}) or {}
    ev: dict[str, Any] = {"state": result.get("state"), "headline": result.get("headline")}
    if check_id == 1:
        ev.update({"naive_p": chart.get("naive", {}).get("p"),
                   "naive_sig": chart.get("naive", {}).get("sig"),
                   "honest_p": chart.get("honest", {}).get("p"),
                   "honest_sig": chart.get("honest", {}).get("sig"),
                   "n_cells": chart.get("naive", {}).get("n"),
                   "n_units": chart.get("honest", {}).get("n"),
                   "bad_unit": chart.get("badUnit")})
    elif check_id == 2:
        ev.update({"discovery_auc": chart.get("discAUC"), "heldout_auc": chart.get("holdAUC"),
                   "split": chart.get("split"), "verified": chart.get("verified"),
                   "markers": [m.get("gene") for m in chart.get("markers", [])]})
    elif check_id == 3:
        ev.update({"stability": chart.get("stability"), "present_range": chart.get("present"),
                   "track": chart.get("track"),
                   "n_settings": len(chart.get("steps", []))})
    elif check_id == 4:
        ev.update({"cramers_v": chart.get("cramersV"), "verified": chart.get("verified")})
    return {k: v for k, v in ev.items() if v is not None}


def run_case(h5ad_path: str, claim: dict) -> dict[str, Any]:
    """Run all four checks on a case. Returns per-pillar state, evidence, and the
    raw-detected set (flags before the critic)."""
    adata = ad.read_h5ad(h5ad_path)
    fields = resolve_field_dicts(adata)
    cfgs = _configs(fields, claim)

    per_pillar: dict[str, Any] = {}
    raw_detected: dict[str, bool] = {}
    for key, (check_id, name, _desc) in spec.PILLARS.items():
        result = run_check(check_id, adata, cfgs[check_id], fields, safe=True)
        state = result.get("state")
        per_pillar[key] = {
            "check_id": check_id,
            "state": state,
            "headline": result.get("headline"),
            "evidence": _evidence(check_id, result),
        }
        raw_detected[key] = (state == "flagged")
    return {"per_pillar": per_pillar, "raw_detected": raw_detected}
