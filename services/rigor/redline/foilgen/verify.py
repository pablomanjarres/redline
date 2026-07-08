"""Self-verification: run the real engine and confirm the planted verdicts.

A foil is only trustworthy if the real Redline engine actually returns the verdict
the ground truth claims. This runs the four pillars (Pillar 3 once per tracked
state) with the engine's own default config and compares each state to the
intended one. It also pulls the honest, corrected result out of each check so the
ground truth can record the expected correction, not just the flag.

This is the "never cry wolf" guard at the fixture level. The generator refuses to
bless a foil whose planted flaw the engine does not catch, or a clean variant the
engine does not pass.
"""

from __future__ import annotations

from typing import Any

from .groundtruth import intended_verdicts, tracks
from .planner import FoilPlan


def _corrected(pillar: int, result: dict) -> dict:
    """The honest, corrected result the engine reports for one check."""
    chart = result.get("chart", {}) or {}
    if pillar == 1:
        honest = chart.get("honest", {}) or {}
        naive = chart.get("naive", {}) or {}
        return {
            "method": "pseudobulk aggregation to the biological unit, then DESeq2 or a Welch t on the unit means",
            "naiveP": naive.get("p"),
            "honestP": honest.get("p"),
            "honestN": honest.get("n"),
            "stillSignificant": honest.get("sig"),
            "note": "the inflated cell-level p-value is replaced by the honest replicate-level call.",
        }
    if pillar == 2:
        return {
            "method": "count splitting: re-score the claimed markers on an independent Poisson split",
            "discoveryAUC": chart.get("discAUC"),
            "heldOutAUC": chart.get("holdAUC"),
            "markers": [m.get("gene") for m in (chart.get("markers") or [])],
        }
    if pillar == 3:
        return {
            "method": "resolution sweep with cluster persistence tracking",
            "stability": chart.get("stability"),
            "presentRange": chart.get("present"),
        }
    return {
        "method": "design-matrix separability (Cramer's V and rank)",
        "cramersV": chart.get("cramersV"),
        "separable": chart.get("separable"),
    }


def verify_foil(h5ad_path: str, plan: FoilPlan) -> dict[str, Any]:
    """Run the engine on the written foil and compare to the intended verdicts."""
    from .. import job_runner
    from ..audit import default_config

    fields = job_runner.resolve_fields(h5ad_path)
    intended = intended_verdicts(plan)
    engine: dict[str, Any] = {}
    corrected: dict[str, Any] = {}
    mismatches: list[str] = []

    planted = set(plan.planted_flaws)
    for pid in (1, 2, 4):
        cfg = default_config(pid, fields)
        if pid == 2 and not plan.clean and 2 in planted:
            # Audit the scientist's claimed markers on the spurious state directly.
            # The claim is "this state is defined by these markers"; testing exactly
            # those on a held-out split is the faithful double-dipping check, and it
            # does not depend on which way the re-clustering happens to fall.
            cfg = dict(cfg)
            cfg["grouping"] = plan.state_col
            cfg["target_group"] = plan.spurious_state
            cfg["markers"] = list(plan.spurious_markers)
        r = job_runner.compute_result(pid, h5ad_path, cfg, fields)
        engine[str(pid)] = r.get("state")
        corrected[str(pid)] = _corrected(pid, r)
        if r.get("state") != intended[str(pid)]:
            mismatches.append(f"pillar {pid}: got {r.get('state')} want {intended[str(pid)]}")

    base3 = default_config(3, fields)
    engine["3"] = {}
    for name, expected in tracks(plan):
        cfg = dict(base3)
        cfg["track"] = name
        r = job_runner.compute_result(3, h5ad_path, cfg, fields)
        engine["3"][name] = r.get("state")
        if expected == "flagged" or "3" not in corrected:
            corrected["3"] = _corrected(3, r)
        if r.get("state") != expected:
            mismatches.append(f"pillar 3 [{name}]: got {r.get('state')} want {expected}")

    return {
        "ran": True,
        "engine": engine,
        "intended": intended,
        "allMatch": not mismatches,
        "mismatches": mismatches,
        "corrected": corrected,
    }
