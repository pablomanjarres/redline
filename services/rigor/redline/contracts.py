"""Python mirrors of ``@redline/contracts`` (the TS/Zod source of truth).

Every object here has a ``to_json()`` that emits the EXACT camelCase keys the
TypeScript side parses: ``checkId``, ``log10p``, ``badUnit``, ``cramersV``,
``discAUC``, ``holdAUC``, ``perGroup`` and so on. Optional fields (``bad``,
``good``, ``discAUC``, ``holdAUC``, ``sample``, ``edited``) are omitted when
absent; ``cramersV`` is nullable and always emitted (``None`` -> ``null``).

This module is stdlib-only on purpose: the MCP contract tests import it without
numpy, scanpy, pydeseq2 or decoupler installed.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Optional, Sequence

# ── Enum value sets (mirror packages/contracts/src/primitives.ts) ─────────────
DTYPES = ("categorical", "numeric", "identifier")
ROLES = ("unit", "grouping", "observation", "nuisance", "covariate", "derived", "ignore")
CONFIDENCES = ("high", "medium", "low")
CHECK_STATES = ("flagged", "clean", "flag_only", "hard_stop")
CHECK_IDS = (1, 2, 3, 4)

# Convenience constants for the four states.
FLAGGED = "flagged"
CLEAN = "clean"
FLAG_ONLY = "flag_only"
HARD_STOP = "hard_stop"

Json = dict[str, Any]


def jsonify(obj: Any) -> Any:
    """Recursively convert dataclasses (with ``to_json``) to plain JSON."""
    if hasattr(obj, "to_json"):
        return obj.to_json()
    if isinstance(obj, (list, tuple)):
        return [jsonify(x) for x in obj]
    if isinstance(obj, dict):
        return {k: jsonify(v) for k, v in obj.items()}
    return obj


# ── Numeric formatting helpers (shared by every pillar) ───────────────────────
_TINY = 1e-300


def log10p(p: float) -> float:
    """``-log10(p)`` (a positive "number of nines"), floored so it stays finite."""
    return float(-math.log10(max(float(p), _TINY)))


def fmt_p(p: float) -> str:
    """A compact, human p-value string with no em dashes or AI-tell vocab."""
    p = float(p)
    if p <= _TINY:
        return "<1e-300"
    if p < 1e-4:
        return f"{p:.1e}"
    if p < 0.001:
        return f"{p:.2e}"
    return f"{p:.3g}"


def fmt_pct(x: float) -> str:
    return f"{round(float(x) * 100)}%"


def interval_json(
    median: float,
    lo: float,
    hi: float,
    level: float,
    n: int,
    samples: Optional[Sequence[float]] = None,
) -> Json:
    """The camelCase ``Interval`` JSON (mirrors packages/contracts/src/charts.ts).

    A stochastic statistic reported as a distribution over ``n`` repeated runs:
    the median, the ``level`` percentile bounds, and the per-run ``samples`` a
    strip or density draws. The numeric aggregation (median, percentiles) lives
    in ``redline.pillars`` where numpy is available; this builder is stdlib-only
    so the contract tests import it without numpy. Emitted only when a check
    actually repeated its stochastic step, never fabricated around a point.
    """
    d: Json = {
        "median": round(float(median), 4),
        "lo": round(float(lo), 4),
        "hi": round(float(hi), 4),
        "level": round(float(level), 4),
        "n": int(n),
    }
    if samples is not None:
        d["samples"] = [round(float(s), 4) for s in samples]
    return d


# ── StatReadout ───────────────────────────────────────────────────────────────
@dataclass
class StatReadout:
    label: str
    value: str
    bad: Optional[bool] = None
    good: Optional[bool] = None
    interval: Optional[Json] = None  # a median+CI distribution (from interval_json)

    def to_json(self) -> Json:
        d: Json = {"label": self.label, "value": str(self.value)}
        if self.bad is not None:
            d["bad"] = bool(self.bad)
        if self.good is not None:
            d["good"] = bool(self.good)
        if self.interval is not None:
            d["interval"] = self.interval
        return d


def stat(
    label: str,
    value: Any,
    bad: Optional[bool] = None,
    good: Optional[bool] = None,
    interval: Optional[Json] = None,
) -> StatReadout:
    return StatReadout(label=label, value=str(value), bad=bad, good=good, interval=interval)


# ── Chart piece dataclasses ───────────────────────────────────────────────────
@dataclass
class UnitProfile:
    id: str
    group: str
    n: int
    value: float

    def to_json(self) -> Json:
        return {"id": str(self.id), "group": str(self.group), "n": int(self.n), "value": float(self.value)}


@dataclass
class SignificanceLevel:
    n: int
    p: float
    sig: bool

    def to_json(self) -> Json:
        return {"n": int(self.n), "p": float(self.p), "log10p": log10p(self.p), "sig": bool(self.sig)}


@dataclass
class Marker:
    gene: str
    disc: float
    hold: float

    def to_json(self) -> Json:
        return {"gene": str(self.gene), "disc": round(float(self.disc), 4), "hold": round(float(self.hold), 4)}


@dataclass
class FragilityStep:
    r: float
    present: bool
    clusters: int
    presence: Optional[float] = None  # fraction of repeated runs present here, 0..1

    def to_json(self) -> Json:
        d: Json = {"r": round(float(self.r), 4), "present": bool(self.present), "clusters": int(self.clusters)}
        if self.presence is not None:
            d["presence"] = round(float(self.presence), 4)
        return d


@dataclass
class ConfoundGrid:
    rows: Sequence[str]
    cols: Sequence[str]
    cells: Sequence[Sequence[float]]

    def to_json(self) -> Json:
        return {
            "rows": [str(x) for x in self.rows],
            "cols": [str(x) for x in self.cols],
            "cells": [[float(v) for v in row] for row in self.cells],
        }


# ── Chart builders (each returns the exact discriminated-union JSON) ──────────
def significance_chart(
    naive: SignificanceLevel,
    honest: SignificanceLevel,
    alpha: float,
    units: Sequence[UnitProfile],
    bad_unit: bool,
) -> Json:
    return {
        "kind": "significance",
        "naive": naive.to_json(),
        "honest": honest.to_json(),
        "alpha": float(alpha),
        "units": [u.to_json() for u in units],
        "badUnit": bool(bad_unit),
    }


def hardstop_chart(units: int, per_group: int, profiles: Sequence[UnitProfile]) -> Json:
    return {
        "kind": "hardstop",
        "units": int(units),
        "perGroup": int(per_group),
        "profiles": [p.to_json() for p in profiles],
    }


def groups_chart(
    markers: Sequence[Marker],
    split: float,
    verified: bool,
    disc_auc: Optional[float] = None,
    hold_auc: Optional[float] = None,
    hold_auc_dist: Optional[Json] = None,
    disc_auc_dist: Optional[Json] = None,
    markers_holding_dist: Optional[Json] = None,
) -> Json:
    d: Json = {
        "kind": "groups",
        "markers": [m.to_json() for m in markers],
        "split": float(split),
        "verified": bool(verified),
    }
    if disc_auc is not None:
        d["discAUC"] = round(float(disc_auc), 4)
    if hold_auc is not None:
        d["holdAUC"] = round(float(hold_auc), 4)
    if hold_auc_dist is not None:
        d["holdAUCDist"] = hold_auc_dist
    if disc_auc_dist is not None:
        d["discAUCDist"] = disc_auc_dist
    if markers_holding_dist is not None:
        d["markersHoldingDist"] = markers_holding_dist
    return d


def fragility_chart(
    steps: Sequence[FragilityStep],
    present: tuple[float, float],
    track: str,
    stability: float,
    stability_dist: Optional[Json] = None,
) -> Json:
    d: Json = {
        "kind": "fragility",
        "steps": [s.to_json() for s in steps],
        "present": [round(float(present[0]), 4), round(float(present[1]), 4)],
        "track": str(track),
        "stability": round(float(stability), 4),
    }
    if stability_dist is not None:
        d["stabilityDist"] = stability_dist
    return d


def confound_chart(grid: ConfoundGrid, cramers_v: Optional[float], verified: bool) -> Json:
    return {
        "kind": "confound",
        "grid": grid.to_json(),
        "cramersV": (None if cramers_v is None else round(float(cramers_v), 4)),
        "verified": bool(verified),
    }


# ── ComputeResult (the statistics half of a finding) ──────────────────────────
@dataclass
class ComputeResult:
    check_id: int
    state: str
    headline: str
    stats: Sequence[StatReadout]
    chart: Json

    def __post_init__(self) -> None:
        if int(self.check_id) not in CHECK_IDS:
            raise ValueError(f"checkId must be one of {CHECK_IDS}, got {self.check_id!r}")
        if self.state not in CHECK_STATES:
            raise ValueError(f"state must be one of {CHECK_STATES}, got {self.state!r}")

    def to_json(self) -> Json:
        return {
            "checkId": int(self.check_id),
            "state": self.state,
            "headline": self.headline,
            "stats": [jsonify(s) for s in self.stats],
            "chart": jsonify(self.chart),
        }

    @classmethod
    def build(
        cls,
        check_id: int,
        state: str,
        headline: str,
        stats: Sequence[StatReadout],
        chart: Json,
    ) -> "ComputeResult":
        return cls(check_id=check_id, state=state, headline=headline, stats=list(stats), chart=chart)


def compute_result(
    check_id: int,
    state: str,
    headline: str,
    stats: Sequence[StatReadout],
    chart: Json,
) -> ComputeResult:
    """The ComputeResult builder the pillars and the MCP/job layers use."""
    return ComputeResult.build(check_id, state, headline, list(stats), chart)


# ── FieldSpec (foundation output) ─────────────────────────────────────────────
@dataclass
class FieldSpec:
    id: str
    dtype: str
    levels: Optional[int]
    missing: int
    role: str
    confidence: str
    reason: str
    sample: Optional[str] = None
    edited: Optional[bool] = None

    def __post_init__(self) -> None:
        if self.dtype not in DTYPES:
            raise ValueError(f"dtype must be one of {DTYPES}, got {self.dtype!r}")
        if self.role not in ROLES:
            raise ValueError(f"role must be one of {ROLES}, got {self.role!r}")
        if self.confidence not in CONFIDENCES:
            raise ValueError(f"confidence must be one of {CONFIDENCES}, got {self.confidence!r}")

    def to_json(self) -> Json:
        d: Json = {
            "id": str(self.id),
            "dtype": self.dtype,
            "levels": (None if self.levels is None else int(self.levels)),
            "missing": int(self.missing),
            "role": self.role,
            "confidence": self.confidence,
            "reason": self.reason,
        }
        if self.sample is not None:
            d["sample"] = str(self.sample)
        if self.edited is not None:
            d["edited"] = bool(self.edited)
        return d


def field_spec(
    id: str,
    dtype: str,
    levels: Optional[int],
    missing: int,
    role: str,
    confidence: str,
    reason: str,
    sample: Optional[str] = None,
    edited: Optional[bool] = None,
) -> FieldSpec:
    return FieldSpec(
        id=id,
        dtype=dtype,
        levels=levels,
        missing=missing,
        role=role,
        confidence=confidence,
        reason=reason,
        sample=sample,
        edited=edited,
    )
