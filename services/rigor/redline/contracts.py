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
# 1..4 are the founding pillars, 5..8 the rigor checks on the same interface.
CHECK_IDS = (1, 2, 3, 4, 5, 6, 7, 8)
FEASIBILITIES = ("fixable_now", "needs_new_data", "unsalvageable")

# Convenience constants for the four states.
FLAGGED = "flagged"
CLEAN = "clean"
FLAG_ONLY = "flag_only"
HARD_STOP = "hard_stop"

# Convenience constants for the three feasibility verdicts.
FIXABLE_NOW = "fixable_now"
NEEDS_NEW_DATA = "needs_new_data"
UNSALVAGEABLE = "unsalvageable"

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


# ── StatReadout ───────────────────────────────────────────────────────────────
@dataclass
class StatReadout:
    label: str
    value: str
    bad: Optional[bool] = None
    good: Optional[bool] = None

    def to_json(self) -> Json:
        d: Json = {"label": self.label, "value": str(self.value)}
        if self.bad is not None:
            d["bad"] = bool(self.bad)
        if self.good is not None:
            d["good"] = bool(self.good)
        return d


def stat(label: str, value: Any, bad: Optional[bool] = None, good: Optional[bool] = None) -> StatReadout:
    return StatReadout(label=label, value=str(value), bad=bad, good=good)


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
    silhouette: Optional[float] = None

    def to_json(self) -> Json:
        d: Json = {"r": round(float(self.r), 4), "present": bool(self.present), "clusters": int(self.clusters)}
        if self.silhouette is not None:
            d["silhouette"] = round(float(self.silhouette), 4)
        return d


@dataclass
class VolcanoPoint:
    gene: str
    log2fc: float
    neg_log10_p: float
    sig: bool
    claimed: Optional[bool] = None

    def to_json(self) -> Json:
        d: Json = {
            "gene": str(self.gene),
            "log2fc": round(float(self.log2fc), 4),
            "negLog10P": round(float(self.neg_log10_p), 4),
            "sig": bool(self.sig),
        }
        if self.claimed is not None:
            d["claimed"] = bool(self.claimed)
        return d


@dataclass
class FdrGene:
    gene: str
    p: float
    q: float
    survives: bool

    def to_json(self) -> Json:
        return {
            "gene": str(self.gene),
            "p": float(self.p),
            "q": float(self.q),
            "survives": bool(self.survives),
        }


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
    return d


def fragility_chart(
    steps: Sequence[FragilityStep],
    present: tuple[float, float],
    track: str,
    stability: float,
    chosen: Optional[float] = None,
    supported: Optional[tuple[float, float]] = None,
) -> Json:
    d: Json = {
        "kind": "fragility",
        "steps": [s.to_json() for s in steps],
        "present": [round(float(present[0]), 4), round(float(present[1]), 4)],
        "track": str(track),
        "stability": round(float(stability), 4),
    }
    if chosen is not None:
        d["chosen"] = round(float(chosen), 4)
    if supported is not None:
        d["supported"] = [round(float(supported[0]), 4), round(float(supported[1]), 4)]
    return d


def confound_chart(grid: ConfoundGrid, cramers_v: Optional[float], verified: bool) -> Json:
    return {
        "kind": "confound",
        "grid": grid.to_json(),
        "cramersV": (None if cramers_v is None else round(float(cramers_v), 4)),
        "verified": bool(verified),
    }


def volcano_chart(
    points: Sequence[VolcanoPoint],
    alpha: float,
    fc_threshold: float,
    n_sig: int,
    label: str,
) -> Json:
    """The corrected downstream artifact for a differential-expression finding."""
    return {
        "kind": "volcano",
        "points": [p.to_json() for p in points],
        "alpha": float(alpha),
        "fcThreshold": float(fc_threshold),
        "nSig": int(n_sig),
        "label": str(label),
    }


def fdr_chart(
    tests: int,
    alpha: float,
    raw_hits: int,
    adjusted_hits: int,
    method: str,
    top: Sequence[FdrGene],
) -> Json:
    if method not in ("bh", "by"):
        raise ValueError(f"method must be 'bh' or 'by', got {method!r}")
    return {
        "kind": "fdr",
        "tests": int(tests),
        "alpha": float(alpha),
        "rawHits": int(raw_hits),
        "adjustedHits": int(adjusted_hits),
        "method": method,
        "top": [g.to_json() for g in top],
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


# ── The correction half of a finding ─────────────────────────────────────────
# Mirrors packages/contracts/src/correction.ts. The one guardrail: everything
# Redline asserts, recommends, or corrects is shown, reproducible, and cited.


@dataclass
class MethodRef:
    """The paper behind a correction. A fix is never asserted without one."""

    authors: str
    year: int
    venue: str
    note: str
    url: Optional[str] = None

    def to_json(self) -> Json:
        d: Json = {
            "authors": str(self.authors),
            "year": int(self.year),
            "venue": str(self.venue),
            "note": str(self.note),
        }
        if self.url:
            d["url"] = str(self.url)
        return d


@dataclass
class Recommendation:
    """One concrete next action.

    ``feasibility`` is decided here, by the deterministic engine, and never by
    the model. That is what stops an honest "unsalvageable" from being talked up
    into a fix that does not exist.
    """

    action: str
    rationale: str
    changes: str
    feasibility: str
    citation: Optional[MethodRef] = None

    def __post_init__(self) -> None:
        if self.feasibility not in FEASIBILITIES:
            raise ValueError(f"feasibility must be one of {FEASIBILITIES}, got {self.feasibility!r}")

    def to_json(self) -> Json:
        d: Json = {
            "action": str(self.action),
            "rationale": str(self.rationale),
            "changes": str(self.changes),
            "feasibility": self.feasibility,
        }
        if self.citation is not None:
            d["citation"] = self.citation.to_json()
        return d


@dataclass
class CorrectedCode:
    """A runnable script that reproduces the honest re-analysis.

    No model writes any part of it. The whole script, comments included, is a
    hand-written template, and the only thing injected is ``params``. The script
    inlines the engine's own computation kernel verbatim, so what it prints is
    what Redline reported. ``params`` records what was injected, so the harness
    can prove the script is parameterized rather than hardcoded to the canonical
    case.
    """

    filename: str
    inline: str
    entrypoint: str
    params: Json
    language: str = "python"

    def to_json(self) -> Json:
        return {
            "language": self.language,
            "filename": str(self.filename),
            "inline": str(self.inline),
            "entrypoint": str(self.entrypoint),
            "params": {str(k): v for k, v in self.params.items()},
        }


@dataclass
class PreviewArtifact:
    """The corrected downstream result, rendered beside what was claimed.

    The honesty invariant is structural, matching the Zod refinement on the TS
    side: an unsalvageable finding carries ``after=None`` and nothing else is
    constructible. A fabricated clean result on a dead-end design raises here.
    """

    method_label: str
    unsalvageable: bool
    before: Json
    after: Optional[Json] = None
    caveat: Optional[str] = None

    def __post_init__(self) -> None:
        if self.unsalvageable and self.after is not None:
            raise ValueError(
                "An unsalvageable finding must not carry a corrected artifact. "
                "Set after=None and say so plainly."
            )
        if not self.unsalvageable and self.after is None:
            raise ValueError(
                "A salvageable finding must carry the corrected artifact. "
                "Set unsalvageable=True when there is no valid fix."
            )

    def to_json(self) -> Json:
        d: Json = {
            "methodLabel": str(self.method_label),
            "unsalvageable": bool(self.unsalvageable),
            "before": jsonify(self.before),
            "after": (None if self.after is None else jsonify(self.after)),
        }
        if self.caveat:
            d["caveat"] = str(self.caveat)
        return d


@dataclass
class Knob:
    """A parameter this check exposes to the UI panel."""

    key: str
    label: str
    kind: str
    min: Optional[float] = None
    max: Optional[float] = None
    step: Optional[float] = None
    options: Optional[Sequence[str]] = None

    def to_json(self) -> Json:
        d: Json = {"key": str(self.key), "label": str(self.label), "kind": str(self.kind)}
        for name in ("min", "max", "step"):
            v = getattr(self, name)
            if v is not None:
                d[name] = float(v)
        if self.options is not None:
            d["options"] = [str(o) for o in self.options]
        return d


@dataclass
class Correction:
    """The optional correction payload attached to a ComputeResult."""

    corrected_code: Optional[CorrectedCode] = None
    recommendations: Optional[Sequence[Recommendation]] = None
    preview: Optional[PreviewArtifact] = None

    def to_json(self) -> Json:
        d: Json = {}
        if self.corrected_code is not None:
            d["correctedCode"] = self.corrected_code.to_json()
        if self.recommendations is not None:
            d["recommendations"] = [r.to_json() for r in self.recommendations]
        if self.preview is not None:
            d["preview"] = self.preview.to_json()
        return d


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
