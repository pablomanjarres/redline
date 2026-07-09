"""The check-module interface: the architectural spine of the rigor surface.

Every check, founding pillar or rigor add-on, implements this one interface. That
is what lets all four correction capabilities hang off a single seam:

    applies_to  ->  does this check apply to this claim and design?
    detect      ->  run the diagnostic. A Candidate finding, or Clean.
    prove       ->  run the honest re-analysis. Corrected statistics + artifact.
    correct     ->  emit runnable code that reproduces `prove`.
    preview     ->  the corrected downstream result, rendered.
    recommend   ->  concrete next actions, grounded in this finding's numbers.

`detect` and `prove` are deterministic. `correct` fills a hand-written template
from `prove`'s parameters, so the executable skeleton is never model-written.
`recommend` decides feasibility deterministically here; only the prose around it
is model-written, upstream in the reasoning layer.

Adding a rigor check means adding a module. Nothing else in the engine changes.

The honesty contract, restated where it is enforced:

- When there is no valid fix (a full confound, n=1, an unsalvageable design),
  `prove` sets `unsalvageable=True` and `corrected_artifact=None`. `preview`
  then cannot construct a corrected result: `PreviewArtifact` raises. There is
  no code path that renders a fabricated fix.
- A method's known limits travel with the corrected result in `caveat`, not
  only with the flag.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Optional, Sequence, Union

from ..contracts import (
    CLEAN,
    FLAG_ONLY,
    FLAGGED,
    HARD_STOP,
    UNSALVAGEABLE,
    Correction,
    CorrectedCode,
    Json,
    Knob,
    MethodRef,
    PreviewArtifact,
    Recommendation,
    StatReadout,
    compute_result,
)

# ── The inputs a module reads ────────────────────────────────────────────────


@dataclass(frozen=True)
class Design:
    """The resolved design: field roles from the foundation step, plus the knobs.

    A module reads *roles*, never a hardcoded column name and never "cell type".
    That is honesty rule 4, expressed as the only accessor a module gets.
    """

    fields: Sequence[Json] = field(default_factory=tuple)
    config: Json = field(default_factory=dict)

    def role(self, role: str) -> Optional[str]:
        """The first column resolved to `role`, or None."""
        for f in self.fields:
            if f.get("role") == role:
                return str(f["id"])
        return None

    def roles(self, role: str) -> list[str]:
        """Every column resolved to `role`, in order."""
        return [str(f["id"]) for f in self.fields if f.get("role") == role]

    def has_column(self, column: Optional[str]) -> bool:
        if not column:
            return False
        return any(str(f["id"]) == column for f in self.fields)

    def knob(self, key: str, default: Any = None) -> Any:
        return self.config.get(key, default)

    @property
    def unit(self) -> Optional[str]:
        return self.role("unit")

    @property
    def grouping(self) -> Optional[str]:
        return self.role("grouping")

    @property
    def derived(self) -> Optional[str]:
        return self.role("derived")

    @property
    def nuisance(self) -> list[str]:
        return self.roles("nuisance")


@dataclass(frozen=True)
class Claim:
    """A claim pulled from the analysis by Claim Extraction.

    `kind` routes claims to checks: a differential-expression claim never
    reaches the clustering-stability check. `applies_to` confirms the routing.
    """

    id: str = "claim"
    text: str = ""
    kind: str = "unknown"  # 'de' | 'marker' | 'cluster' | 'unknown'
    genes: tuple[str, ...] = ()
    group: Optional[str] = None

    @property
    def is_de(self) -> bool:
        return self.kind == "de"

    @property
    def is_marker(self) -> bool:
        return self.kind == "marker"

    @property
    def is_cluster(self) -> bool:
        return self.kind == "cluster"


# ── What detect returns ──────────────────────────────────────────────────────


@dataclass(frozen=True)
class Clean:
    """The diagnostic ran and found nothing wrong. Reported confidently, in green.

    Never cry wolf: a clean verdict is a real answer, and it carries no
    correction payload because there is nothing to correct.
    """

    headline: str
    stats: Sequence[StatReadout] = field(default_factory=tuple)
    chart: Json = field(default_factory=dict)


@dataclass(frozen=True)
class Candidate:
    """The diagnostic fired. Carries the raw numbers, before any re-analysis."""

    state: str  # flagged | flag_only | hard_stop
    headline: str
    numbers: Json = field(default_factory=dict)
    chart: Optional[Json] = None
    stats: Sequence[StatReadout] = field(default_factory=tuple)
    message: Optional[str] = None

    def __post_init__(self) -> None:
        if self.state not in (FLAGGED, FLAG_ONLY, HARD_STOP):
            raise ValueError(f"a Candidate cannot be {self.state!r}; return Clean instead")


DetectResult = Union[Candidate, Clean]


# ── What prove returns ───────────────────────────────────────────────────────


@dataclass(frozen=True)
class Evidence:
    """The honest re-analysis.

    `numbers` carries `original` and `corrected` side by side, which is what the
    three-way consistency check reads: the reported numbers, the preview, and
    the output of the downloadable code must all agree.

    `params` is exactly what gets injected into the code template. Nothing else
    reaches the template, which is why the emitted script cannot be hardcoded to
    the canonical dataset.
    """

    state: str
    headline: str
    stats: Sequence[StatReadout]
    chart: Json
    numbers: Json
    method: MethodRef
    feasibility: str
    params: Json = field(default_factory=dict)
    corrected_artifact: Optional[Json] = None
    caveat: Optional[str] = None
    message: Optional[str] = None

    @property
    def unsalvageable(self) -> bool:
        return self.feasibility == UNSALVAGEABLE

    def __post_init__(self) -> None:
        if self.unsalvageable and self.corrected_artifact is not None:
            raise ValueError(
                "An unsalvageable finding must not carry a corrected artifact. "
                "There is no valid fix, and inventing one is the error Redline exists to catch."
            )


# ── The interface ────────────────────────────────────────────────────────────


class CheckModule(ABC):
    """One rigor check. Implement the six methods, inherit the whole surface."""

    id: int
    name: str
    one_line: str
    error_class: str
    citation: MethodRef
    knobs: tuple[Knob, ...] = ()
    #: Claim kinds this check can speak to. Empty means "any claim".
    claim_kinds: tuple[str, ...] = ()

    # -- routing --------------------------------------------------------------
    @abstractmethod
    def applies_to(self, claim: Claim, design: Design) -> bool:
        """Does this check apply? Routing proposes; this confirms."""

    # -- deterministic compute ------------------------------------------------
    @abstractmethod
    def detect(self, claim: Claim, adata: Any, design: Design) -> DetectResult:
        """Run the diagnostic. Return a Candidate with the raw numbers, or Clean."""

    @abstractmethod
    def prove(self, candidate: Candidate, adata: Any, design: Design) -> Evidence:
        """Run the honest re-analysis. Corrected statistics and corrected artifact."""

    # -- the correction surface ----------------------------------------------
    @abstractmethod
    def correct(self, evidence: Evidence, adata: Any, design: Design) -> CorrectedCode:
        """Runnable code that reproduces `prove`. Template plus injected params."""

    @abstractmethod
    def recommend(self, evidence: Evidence, design: Design) -> list[Recommendation]:
        """One to three concrete next actions, grounded in this finding's numbers."""

    def preview(self, evidence: Evidence, adata: Any, design: Design) -> Optional[PreviewArtifact]:
        """The corrected downstream result, rendered beside what was claimed.

        The default reuses `prove`'s corrected artifact, which is what keeps the
        preview and the code in agreement by construction. Override only when a
        heavier render is wanted; it must still be the output of the same
        computation the emitted code performs.

        Returns None for `flag_only`, where nothing was proven and so nothing
        may be shown.
        """
        if evidence.state == FLAG_ONLY:
            return None
        return PreviewArtifact(
            method_label=self.method_label,
            unsalvageable=evidence.unsalvageable,
            before=evidence.chart,
            after=evidence.corrected_artifact,
            caveat=evidence.caveat,
        )

    @property
    def method_label(self) -> str:
        """Names the method that produced the corrected artifact."""
        return f"{self.citation.authors} {self.citation.year}"

    # -- the driver -----------------------------------------------------------
    def run(self, claim: Claim, adata: Any, design: Design) -> tuple[Json, Json]:
        """detect, then prove, then correct/recommend/preview.

        Returns `(computeResult, correction)` as JSON. A Clean verdict carries no
        correction payload, because a passing check has nothing to correct.
        """
        found = self.detect(claim, adata, design)
        if isinstance(found, Clean):
            result = compute_result(self.id, CLEAN, found.headline, found.stats, found.chart)
            return result.to_json(), {}

        evidence = self.prove(found, adata, design)
        result = compute_result(self.id, evidence.state, evidence.headline, evidence.stats, evidence.chart)
        correction = Correction(
            corrected_code=self.correct(evidence, adata, design),
            recommendations=self.recommend(evidence, design),
            preview=self.preview(evidence, adata, design),
        )
        return result.to_json(), correction.to_json()


__all__ = [
    "Candidate",
    "CheckModule",
    "Claim",
    "Clean",
    "Design",
    "DetectResult",
    "Evidence",
]
