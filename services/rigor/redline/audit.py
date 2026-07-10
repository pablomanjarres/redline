"""Audit orchestration: the foundation step plus the registry of rigor checks.

Dispatch is registry-driven. There is no hardcoded 1..4 anywhere here: every
entry point drives ``redline.modules.REGISTRY``, so adding a check is adding a
module and nothing in this file changes.

Two entry points:

- ``run_check(check_id, adata, config, fields)`` runs one check and returns the
  flat ``EngineResult`` JSON (``{**computeResult, **correction}``): ``checkId``,
  ``state``, ``headline``, ``stats``, ``chart``, and, when the check produced
  them, ``correctedCode``, ``recommendations``, ``preview``. It is defensive by
  default: a check that hits unusable data degrades to ``flag_only`` with a
  message rather than crashing the surface, and never fabricates a number.
- ``audit(data, analysis=None, fields=None)`` resolves the design, offers the
  claim to every registered check via ``applies_to``, runs the applicable ones,
  and returns the per-check results plus an assembled summary. Checks that do not
  apply are simply absent from ``results``; the rail lists whatever ran.

Heavy dependencies (scanpy, decoupler, pydeseq2) are imported lazily inside the
modules, so importing this module needs only the base install.
"""

from __future__ import annotations

from typing import Any, Optional

from . import foundation, modules
from .contracts import (
    FLAG_ONLY,
    ComputeResult,
    ConfoundGrid,
    FragilityStep,
    SignificanceLevel,
    compute_result,
    confound_chart,
    fdr_chart,
    fragility_chart,
    groups_chart,
    hardstop_chart,
    jsonify,
    significance_chart,
    stat,
    volcano_chart,
)
from .modules import Claim, Design
from .pillars import (
    confounding,
    double_dipping,
    fragility,
    pseudoreplication,
    resolve_role_column,
)

# Deprecated back-compat alias: 1..4 -> the founding pillars' ``run`` functions.
# Dispatch now goes through the registry (``redline.modules``); this table stays
# only so any caller that imported ``RUNNERS`` directly keeps working.
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


def _as_config_dict(config: Any) -> dict:
    """Normalize a knob config to a plain dict. Modules read knobs off
    ``Design.knob`` (a dict lookup), so a dataclass or other object is coerced
    rather than silently dropped."""
    if config is None:
        return {}
    if isinstance(config, dict):
        return config
    if hasattr(config, "to_json"):
        out = config.to_json()
        if isinstance(out, dict):
            return out
    return dict(getattr(config, "__dict__", {}) or {})


def _nuisance_columns(fields: list[dict]) -> list[str]:
    out: list[str] = []
    for f in fields:
        role = f.get("role") if isinstance(f, dict) else getattr(f, "role", None)
        fid = f.get("id") if isinstance(f, dict) else getattr(f, "id", None)
        if role == "nuisance" and fid:
            out.append(str(fid))
    return out


# ── Claim construction ────────────────────────────────────────────────────────
def claim_from_analysis(analysis: Optional[dict], check_id: int) -> Claim:
    """Build the claim a given check speaks to, from the analysis (or a config).

    The claim's ``kind`` is taken from the analysis when it names one, otherwise
    from the target module's declared ``claim_kinds`` so routing lines up with
    the check being asked for. Gene, marker, and group hints are read from the
    common keys the app and the tests use (``gene`` / ``genes`` / ``markers`` and
    ``group`` / ``target_group`` / ``track``), so ``run_check`` can build the
    claim straight from the per-check config too.
    """
    src = dict(analysis or {})
    try:
        kinds = tuple(getattr(modules.module(int(check_id)), "claim_kinds", ()) or ())
    except Exception:
        kinds = ()
    kind = str(src.get("kind") or (kinds[0] if kinds else "unknown"))

    genes: tuple[str, ...] = ()
    raw_genes = src.get("genes") or src.get("markers")
    if raw_genes:
        genes = tuple(str(g) for g in raw_genes)
    elif src.get("gene"):
        genes = (str(src["gene"]),)

    group = src.get("group")
    if group is None:
        group = src.get("target_group")
    if group is None:
        group = src.get("track")
    group = str(group) if group not in (None, "") else None

    return Claim(
        id=str(src.get("claimId") or src.get("id") or "claim"),
        text=str(src.get("claim") or src.get("text") or ""),
        kind=kind,
        genes=genes,
        group=group,
    )


# ── Default knobs per check, derived from the resolved design ─────────────────
# Static knob values the knob spec alone cannot pin (specific numbers, method
# choices). Design-resolved roles are filled separately, from the fields.
_STATIC_DEFAULTS: dict[int, dict] = {
    1: {"alpha": 0.05},
    2: {"split": 0.5, "seed": 0},
    3: {"min": 0.2, "max": 2.0, "step": 0.2, "scrub": 0.9, "track": "", "seed": 0},
    4: {},
    5: {"alpha": 0.05, "method": "bh"},
    6: {"alpha": 0.05},
    7: {"min": 0.2, "max": 2.0, "step": 0.2, "criterion": "silhouette", "chosen": 1.0, "seed": 0},
    8: {"claimedTest": "unknown", "alpha": 0.05},
}


def _design_knobs(cid: int, unit, grouping, derived, nuisance: list[str]) -> dict:
    """The design-resolved role knobs a given check exposes. Roles come from the
    foundation step, never a hardcoded column name."""
    table = {
        1: lambda: {"unit": unit, "grouping": grouping},
        2: lambda: {"grouping": derived or grouping},
        3: lambda: {},
        4: lambda: {"interest": grouping, "nuisance": nuisance},
        5: lambda: {"unit": unit, "grouping": grouping},
        6: lambda: {"interest": grouping, "covariate": (nuisance[0] if nuisance else None)},
        7: lambda: {},
        8: lambda: {"grouping": grouping},
    }
    build = table.get(cid)
    return build() if build else {}


def _analysis_hints(cid: int, analysis: dict) -> dict:
    """Claim-shaped hints carried on the analysis, folded into the config so the
    claim can be rebuilt from the config alone."""
    out: dict = {}
    if cid == 1 and analysis.get("gene"):
        out["gene"] = analysis["gene"]
    if cid == 2:
        if analysis.get("markers"):
            out["markers"] = analysis["markers"]
        if analysis.get("target_group"):
            out["target_group"] = analysis["target_group"]
    if cid == 3 and analysis.get("track") is not None:
        out["track"] = analysis["track"]
    return out


def _knob_seed(cid: int) -> dict:
    """Best-effort defaults derived from the module's own knob declarations: the
    first option for a select, the minimum for a range. The explicit defaults and
    the resolved design override these, so a new check contributes sane defaults
    here without a code change."""
    try:
        knobs = modules.module(cid).knobs
    except Exception:
        return {}
    out: dict = {}
    for k in knobs:
        key = getattr(k, "key", None)
        if not key:
            continue
        opts = getattr(k, "options", None)
        if opts:
            out[key] = opts[0]
        elif getattr(k, "min", None) is not None:
            out[key] = getattr(k, "min")
    return out


def default_config(check_id: int, fields: list[dict], analysis: Optional[dict] = None) -> dict:
    """The default knob set for one check, resolved from the design.

    Layered so each source overrides the previous: the module's own knob
    declarations, the explicit static defaults, the design-resolved roles, the
    claim-shaped analysis hints, then the caller's per-check overrides.
    """
    analysis = analysis or {}
    cid = int(check_id)
    unit = resolve_role_column(fields, "unit")
    grouping = resolve_role_column(fields, "grouping")
    derived = resolve_role_column(fields, "derived")
    nuisance = _nuisance_columns(fields)

    cfg: dict = {}
    cfg.update(_knob_seed(cid))
    cfg.update(_STATIC_DEFAULTS.get(cid, {}))
    cfg.update(_design_knobs(cid, unit, grouping, derived, nuisance))
    cfg.update(_analysis_hints(cid, analysis))

    conf_map = analysis.get("config") or {}
    if isinstance(conf_map, dict):
        overrides = conf_map.get(cid) or conf_map.get(str(cid)) or {}
        if isinstance(overrides, dict):
            cfg.update(overrides)
    return cfg


# ── Single check ──────────────────────────────────────────────────────────────
def run_check(check_id: int, adata: Any, config: Any = None, fields: Any = None, safe: bool = True) -> dict:
    """Run one check and return its flat ``EngineResult`` as JSON.

    Drives ``redline.modules.module(cid).run(claim, adata, design)`` and flattens
    its ``(computeResult, correction)`` pair into one dict. With ``safe=True``
    (the default) any exception degrades to a contract-valid ``flag_only``
    placeholder rather than crashing the surface or fabricating a number.
    """
    cid = int(check_id)
    if cid not in modules.REGISTRY:
        raise ValueError(f"checkId must be one of {tuple(sorted(modules.REGISTRY))}, got {check_id!r}")
    field_dicts = _as_field_dicts(fields, adata)
    config = default_config(cid, field_dicts, None) if config is None else _as_config_dict(config)

    def _run() -> dict:
        claim = claim_from_analysis(config, cid)
        design = Design(fields=tuple(field_dicts), config=config)
        compute_json, correction_json = modules.module(cid).run(claim, adata, design)
        return {**compute_json, **correction_json}

    if not safe:
        return _run()
    try:
        return _run()
    except Exception as exc:  # keep the surface alive; never fabricate numbers
        return _error_result(cid, f"This check could not run on the data as given: {exc}").to_json()


# ── Full audit ────────────────────────────────────────────────────────────────
def audit(data: Any, analysis: Optional[dict] = None, fields: Any = None) -> dict:
    """Resolve the design, run every applicable check, and assemble a summary."""
    analysis = analysis or {}
    field_dicts = _as_field_dicts(fields, data)
    results: list[dict] = []
    for cid, mod in modules.REGISTRY.items():
        cfg = default_config(cid, field_dicts, analysis)
        claim = claim_from_analysis(cfg, cid)
        design = Design(fields=tuple(field_dicts), config=cfg)
        try:
            applies = mod.applies_to(claim, design)
        except Exception:
            applies = False
        if not applies:
            continue
        results.append(run_check(cid, data, cfg, field_dicts, safe=True))
    report = _assemble_report(results)
    return {"fields": field_dicts, "results": results, "report": report}


def _assemble_report(results: list[dict]) -> dict:
    states = [r["state"] for r in results]
    n = len(states)
    flagged = sum(1 for s in states if s in ("flagged", "hard_stop"))
    clean = sum(1 for s in states if s == "clean")
    need_input = sum(1 for s in states if s == "flag_only")
    if n == 0:
        verdict = "No checks applied to this analysis."
    elif flagged == 0 and need_input == 0:
        verdict = f"All {n} checks clean; the load-bearing claims hold."
    elif flagged == 0:
        verdict = f"{clean} of {n} clean; {need_input} need a variable selected before they can run."
    else:
        verdict = f"{flagged} of {n} checks flagged a problem in the analysis."
    return {
        "flagged": flagged,
        "clean": clean,
        "needInput": need_input,
        "verdict": verdict,
        "results": results,
    }


# ── Contract-valid placeholders for the defensive error path ──────────────────
# Keyed by the chart kind a module draws, so a new check's error placeholder is
# picked by its declared chart kind, not another if/elif ladder.
_DEFAULT_CHART_KIND: dict[int, str] = {
    1: "significance",
    2: "groups",
    3: "fragility",
    4: "confound",
    5: "fdr",
    6: "significance",
    7: "fragility",
    8: "significance",
}


def _chart_placeholder(kind: str) -> dict:
    zero = SignificanceLevel(n=0, p=1.0, sig=False)
    table = {
        "significance": lambda: significance_chart(zero, zero, 0.05, [], bad_unit=False),
        "hardstop": lambda: hardstop_chart(0, 0, []),
        "groups": lambda: groups_chart([], 0.5, verified=False),
        "fragility": lambda: fragility_chart([FragilityStep(0.0, False, 0)], (0.0, 0.0), "", 0.0),
        "confound": lambda: confound_chart(ConfoundGrid(rows=[], cols=[], cells=[]), None, verified=False),
        "volcano": lambda: volcano_chart([], 0.05, 1.0, 0, ""),
        "fdr": lambda: fdr_chart(0, 0.05, 0, 0, "bh", []),
    }
    build = table.get(kind) or table["significance"]
    return build()


def _error_result(check_id: int, message: str) -> ComputeResult:
    cid = int(check_id)
    try:
        kind = getattr(modules.module(cid), "chart_kind", None) or _DEFAULT_CHART_KIND.get(cid, "significance")
    except Exception:
        kind = _DEFAULT_CHART_KIND.get(cid, "significance")
    stats = [stat("Status", "could not run", bad=True)]
    return compute_result(cid, FLAG_ONLY, message, stats, _chart_placeholder(str(kind)))
