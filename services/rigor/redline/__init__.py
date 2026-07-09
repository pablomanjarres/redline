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

import sys
from importlib import import_module
from types import ModuleType
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


# Three of the public callables share a name with a submodule: ``audit`` the
# function lives in ``redline.audit`` the module. Any import of that submodule,
# including the one a lazy load triggers under the hood, runs
# ``setattr(redline, "audit", <module>)`` and buries the function. A plain
# module ``__getattr__`` cannot rescue it, because ``__getattr__`` only fires
# when normal lookup fails and the buried module makes lookup succeed.
#
# Resolving the lazy names through the module type instead keeps the callable
# winning whatever the import order was. ``__getattribute__`` runs ahead of the
# instance ``__dict__``, so ``redline.audit`` and ``from redline import audit``
# both hand back the function even after ``import redline.audit`` has stashed the
# module in the package dict. Names outside ``_LAZY`` fall through to the normal
# module machinery, so ``redline.contracts`` stays stdlib-only and the heavy
# stack loads only when a lazy name is first read.
class _EngineModule(ModuleType):
    def __getattribute__(self, name: str) -> Any:
        target = _LAZY.get(name)
        if target is not None:
            return getattr(import_module(target[0], __name__), target[1])
        return super().__getattribute__(name)


def __getattr__(name: str) -> Any:
    # Reached only for names outside _LAZY (those are served by _EngineModule).
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def __dir__() -> list[str]:
    return sorted(set(list(globals().keys()) + list(_LAZY.keys())))


# Swap the running module's type in place so the resolver above takes effect.
sys.modules[__name__].__class__ = _EngineModule


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
