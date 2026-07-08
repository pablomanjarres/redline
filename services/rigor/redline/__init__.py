"""Redline rigor engine.

The foundation step plus the four statistical checks on single-cell RNA-seq,
importable as ``redline``::

    from redline import audit, run_check, resolve_fields

The shape layer (``redline.contracts``) is stdlib-only and always importable. The
engine (``audit``, ``run_check``, ``resolve_fields``) is loaded lazily so the
contract layer needs no scientific stack, and scanpy / decoupler / pydeseq2 are
imported only inside the pillars that use them.
"""

from __future__ import annotations

from importlib import import_module
from typing import Any

# Eager, dependency-free: the contract shapes and builders.
from .contracts import (  # noqa: F401
    CHECK_STATES,
    CLEAN,
    CONFIDENCES,
    DTYPES,
    FLAG_ONLY,
    FLAGGED,
    HARD_STOP,
    ROLES,
    ComputeResult,
    ConfoundGrid,
    FieldSpec,
    FragilityStep,
    Marker,
    SignificanceLevel,
    StatReadout,
    UnitProfile,
    compute_result,
    confound_chart,
    field_spec,
    fmt_p,
    fragility_chart,
    groups_chart,
    hardstop_chart,
    jsonify,
    log10p,
    significance_chart,
    stat,
)

__version__ = "0.1.0"

# name -> (module, attribute). Loaded on first access so importing the package
# (and the contract tests) does not pull numpy / scipy / the heavy stack.
_LAZY = {
    "audit": (".audit", "audit"),
    "run_check": (".audit", "run_check"),
    "default_config": (".audit", "default_config"),
    "resolve_fields": (".foundation", "resolve_fields"),
    "resolve_field_dicts": (".foundation", "resolve_field_dicts"),
    "require_counts": (".gating", "require_counts"),
    "find_counts": (".gating", "find_counts"),
    "has_raw_counts": (".gating", "has_raw_counts"),
}


def __getattr__(name: str) -> Any:
    target = _LAZY.get(name)
    if target is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    module = import_module(target[0], __name__)
    return getattr(module, target[1])


def __dir__() -> list[str]:
    return sorted(set(list(globals().keys()) + list(_LAZY.keys())))


__all__ = [
    "audit",
    "run_check",
    "default_config",
    "resolve_fields",
    "resolve_field_dicts",
    "require_counts",
    "find_counts",
    "has_raw_counts",
    "ComputeResult",
    "FieldSpec",
    "StatReadout",
    "compute_result",
    "field_spec",
    "stat",
    "jsonify",
    "significance_chart",
    "hardstop_chart",
    "groups_chart",
    "fragility_chart",
    "confound_chart",
    "SignificanceLevel",
    "UnitProfile",
    "Marker",
    "FragilityStep",
    "ConfoundGrid",
    "FLAGGED",
    "CLEAN",
    "FLAG_ONLY",
    "HARD_STOP",
    "__version__",
]
