"""Audit orchestration: the foundation step plus the four independent pillars.

Two entry points:

- ``run_check(check_id, adata, config, fields)`` returns one ``ComputeResult``
  (JSON). This is what the MCP server's per-pillar tools and the Cloud Run job
  runner call. It is defensive by default: a pillar that hits unusable data
  degrades to ``flag_only`` with a message rather than crashing the surface.
- ``audit(data, analysis=None, fields=None)`` resolves the design, runs all four
  checks with sensible default knobs (overridable via ``analysis``), and returns
  the per-check results plus an assembled summary.

Heavy dependencies (scanpy, decoupler, pydeseq2) are imported lazily inside the
pillars, so importing this module needs only the base install.
"""

from __future__ import annotations

from typing import Any, Optional

from . import foundation
from .contracts import (
    FLAG_ONLY,
    ComputeResult,
    ConfoundGrid,
    FragilityStep,
    SignificanceLevel,
    compute_result,
    confound_chart,
    fragility_chart,
    groups_chart,
    jsonify,
    significance_chart,
    stat,
)
from .pillars import confounding, double_dipping, fragility, pseudoreplication, resolve_role_column

RUNNERS = {
    1: pseudoreplication.run,
    2: double_dipping.run,
    3: fragility.run,
    4: confounding.run,
}


# ── Field normalization ───────────────────────────────────────────────────────
def _as_field_dicts(fields: Any, adata: Any) -> list[dict]:
    if fields is None:
        return foundation.resolve_field_dicts(adata)
    out: list[dict] = []
    for f in fields:
        out.append(f if isinstance(f, dict) else jsonify(f))
    return out


# ── Default knobs per check, derived from the resolved design ─────────────────
def default_config(check_id: int, fields: list[dict], analysis: Optional[dict] = None) -> dict:
    analysis = analysis or {}
    unit = resolve_role_column(fields, "unit")
    grouping = resolve_role_column(fields, "grouping")
    derived = resolve_role_column(fields, "derived")
    nuisance = [f["id"] for f in fields if f.get("role") == "nuisance"]
    overrides = (analysis.get("config") or {}).get(check_id, {}) if isinstance(analysis.get("config"), dict) else {}

    if check_id == 1:
        cfg = {"unit": unit, "grouping": grouping, "alpha": 0.05}
        if analysis.get("gene"):
            cfg["gene"] = analysis["gene"]
    elif check_id == 2:
        cfg = {"split": 0.5, "grouping": derived or grouping}
        if analysis.get("markers"):
            cfg["markers"] = analysis["markers"]
        if analysis.get("target_group"):
            cfg["target_group"] = analysis["target_group"]
    elif check_id == 3:
        cfg = {"min": 0.2, "max": 2.0, "step": 0.2, "track": analysis.get("track", ""), "scrub": 0.9}
    else:
        cfg = {"interest": grouping, "nuisance": nuisance}
    cfg.update(overrides)
    return cfg


# ── Single check ──────────────────────────────────────────────────────────────
def run_check(check_id: int, adata: Any, config: Any = None, fields: Any = None, safe: bool = True) -> dict:
    """Run one pillar and return its ``ComputeResult`` as JSON."""
    cid = int(check_id)
    if cid not in RUNNERS:
        raise ValueError(f"checkId must be 1..4, got {check_id!r}")
    field_dicts = _as_field_dicts(fields, adata)
    if config is None:
        config = default_config(cid, field_dicts, None)
    if not safe:
        return RUNNERS[cid](adata, config, field_dicts).to_json()
    try:
        return RUNNERS[cid](adata, config, field_dicts).to_json()
    except Exception as exc:  # keep the surface alive; never fabricate numbers
        return _error_result(cid, f"This check could not run on the data as given: {exc}").to_json()


# ── Full audit ────────────────────────────────────────────────────────────────
def audit(data: Any, analysis: Optional[dict] = None, fields: Any = None) -> dict:
    """Resolve the design, run all four checks, and assemble a summary."""
    field_dicts = _as_field_dicts(fields, data)
    results: list[dict] = []
    for cid in (1, 2, 3, 4):
        cfg = default_config(cid, field_dicts, analysis)
        results.append(run_check(cid, data, cfg, field_dicts, safe=True))
    report = _assemble_report(results)
    return {"fields": field_dicts, "results": results, "report": report}


def _assemble_report(results: list[dict]) -> dict:
    states = [r["state"] for r in results]
    flagged = sum(1 for s in states if s in ("flagged", "hard_stop"))
    clean = sum(1 for s in states if s == "clean")
    need_input = sum(1 for s in states if s == "flag_only")
    if flagged == 0 and need_input == 0:
        verdict = "All four checks clean; the load-bearing claims hold."
    elif flagged == 0:
        verdict = f"{clean} of 4 clean; {need_input} need a variable selected before they can run."
    else:
        verdict = f"{flagged} of 4 checks flagged a problem in the analysis."
    return {
        "flagged": flagged,
        "clean": clean,
        "needInput": need_input,
        "verdict": verdict,
        "results": results,
    }


# ── Contract-valid placeholders for the defensive error path ──────────────────
def _error_result(check_id: int, message: str) -> ComputeResult:
    stats = [stat("Status", "could not run", bad=True)]
    if check_id == 1:
        zero = SignificanceLevel(n=0, p=1.0, sig=False)
        chart = significance_chart(zero, zero, 0.05, [], bad_unit=False)
    elif check_id == 2:
        chart = groups_chart([], 0.5, verified=False)
    elif check_id == 3:
        chart = fragility_chart([FragilityStep(0.0, False, 0)], (0.0, 0.0), "", 0.0)
    else:
        chart = confound_chart(ConfoundGrid(rows=[], cols=[], cells=[]), None, verified=False)
    return compute_result(check_id, FLAG_ONLY, message, stats, chart)
