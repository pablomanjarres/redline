"""The check registry.

The active check set is a registry the engine iterates. Each claim is offered to
every registered check via `applies_to`; the applicable ones run. Adding a rigor
check is adding a module here, and nothing else changes: the module inherits
corrected code, recommended actions, and fix-and-preview from the interface.

Scope discipline holds. Commoditized QC (ambient RNA, doublets, basic filtering)
stays out. These are rigor and inference checks, which is the wedge.
"""

from __future__ import annotations

from typing import Optional

from .base import Candidate, CheckModule, Claim, Clean, Design, DetectResult, Evidence
from .m01_pseudoreplication import MODULE as _m01
from .m02_double_dipping import MODULE as _m02
from .m03_fragility import MODULE as _m03
from .m04_confounding import MODULE as _m04
from .m05_multiple_testing import MODULE as _m05
from .m06_unmodeled_covariate import MODULE as _m06
from .m07_resolution_choice import MODULE as _m07
from .m08_test_assumptions import MODULE as _m08

#: Every registered check, in display order. The single source of truth.
REGISTRY: dict[int, CheckModule] = {
    m.id: m for m in (_m01, _m02, _m03, _m04, _m05, _m06, _m07, _m08)
}

#: The founding pillars, and the rigor checks built on the same interface.
CORE_IDS: tuple[int, ...] = (1, 2, 3, 4)
RIGOR_IDS: tuple[int, ...] = (5, 6, 7, 8)
CHECK_IDS: tuple[int, ...] = tuple(sorted(REGISTRY))


def module(check_id: int) -> CheckModule:
    cid = int(check_id)
    if cid not in REGISTRY:
        raise ValueError(f"checkId must be one of {CHECK_IDS}, got {check_id!r}")
    return REGISTRY[cid]


def applicable(claim: Claim, design: Design) -> list[CheckModule]:
    """Offer one claim to every registered check. The applicable ones run."""
    return [m for m in REGISTRY.values() if m.applies_to(claim, design)]


__all__ = [
    "CHECK_IDS",
    "CORE_IDS",
    "REGISTRY",
    "RIGOR_IDS",
    "Candidate",
    "CheckModule",
    "Claim",
    "Clean",
    "Design",
    "DetectResult",
    "Evidence",
    "applicable",
    "module",
]
