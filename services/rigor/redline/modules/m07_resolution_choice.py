"""Check 7 - Cluster-count / resolution justification.

Broader than check 3. Check 3 tracks one claimed group across a resolution
sweep. Check 7 asks whether the overall number of clusters is supported by any
criterion at all. It sweeps the resolution, scores each setting by a
cluster-quality criterion (silhouette on the embedding, or adjacent-pair ARI
stability), finds the contiguous window the criterion supports, and shows where
the chosen setting sits.

If the chosen value is inside the supported window, the check returns a confident
clean verdict. Redline never manufactures a flag.
"""

from __future__ import annotations

from typing import Any, Optional

from ..contracts import (
    FIXABLE_NOW,
    FLAG_ONLY,
    FLAGGED,
    CorrectedCode,
    FragilityStep,
    Knob,
    MethodRef,
    Recommendation,
    fragility_chart,
    stat,
)
from ..correction import kernels
from ..pillars import cfg_get
from .base import Candidate, CheckModule, Claim, Clean, Design, DetectResult, Evidence
from .m05_multiple_testing import h5ad_hint, render_or_fallback

_CITATION = MethodRef(
    authors="Luecken & Theis",
    year=2019,
    venue="Molecular Systems Biology",
    note="Select the clustering resolution by a stability or quality criterion, and report it with the claim.",
)


def _sweep(adata: Any, design: Design) -> dict:
    """The kernel resolution sweep, plus the design knobs the chart and params need.
    Serializable, so detect can stash it for prove without re-clustering."""
    lo = float(design.knob("min", 0.2) or 0.2)
    hi = float(design.knob("max", 2.0) or 2.0)
    step = float(design.knob("step", 0.2) or 0.2)
    seed = int(design.knob("seed", 0) or 0)
    criterion = str(design.knob("criterion", "silhouette") or "silhouette").lower()
    if criterion not in ("silhouette", "ari"):
        criterion = "silhouette"
    chosen = design.knob("chosen", None)
    chosen = float(chosen) if chosen is not None else round((lo + hi) / 2.0, 4)

    nums = kernels.check7_resolution_choice(adata, lo, hi, step, criterion, chosen, seed)
    scores = [s["score"] for s in nums["steps"]]
    out = dict(nums)
    out["lo"] = lo
    out["hi"] = hi
    out["step"] = step
    out["seed"] = seed
    out["usable"] = any(s is not None for s in scores)
    finite = [s for s in scores if s is not None]
    out["stability"] = float(sum(finite) / len(finite)) if finite else 0.0
    idx = _nearest_idx([s["r"] for s in nums["steps"]], chosen)
    out["chosen_clusters"] = int(nums["steps"][idx]["clusters"]) if nums["steps"] else 0
    best_idx = _nearest_idx([s["r"] for s in nums["steps"]], nums["best"])
    out["best_clusters"] = int(nums["steps"][best_idx]["clusters"]) if nums["steps"] else 0
    return out


def _nearest_idx(resolutions: list, value: float) -> int:
    return min(range(len(resolutions)), key=lambda i: abs(float(resolutions[i]) - float(value))) if resolutions else 0


def _steps(sw: dict) -> list[FragilityStep]:
    return [
        FragilityStep(r=float(s["r"]), present=bool(s["present"]), clusters=int(s["clusters"]), silhouette=s["score"])
        for s in sw["steps"]
    ]


def _chart(sw: dict, chosen: float) -> dict:
    """A fragility chart carrying the supported window, so the harness reads the
    corrected resolution from supported[0] (== the kernel's supportedLo)."""
    s_lo, s_hi = float(sw["supportedLo"]), float(sw["supportedHi"])
    return fragility_chart(
        _steps(sw), (s_lo, s_hi), str(sw["criterion"]), float(sw["stability"]), chosen=chosen, supported=(s_lo, s_hi)
    )


class Check7ResolutionChoice(CheckModule):
    id = 7
    name = "Resolution choice"
    one_line = "The cluster count was chosen without a stability or quality criterion."
    error_class = "Unjustified clustering resolution"
    citation = _CITATION
    claim_kinds = ("cluster",)
    knobs = (
        Knob(key="min", label="Min resolution", kind="number", min=0.0, max=5.0, step=0.1),
        Knob(key="max", label="Max resolution", kind="number", min=0.0, max=5.0, step=0.1),
        Knob(key="step", label="Step", kind="number", min=0.05, max=1.0, step=0.05),
        Knob(key="criterion", label="Criterion", kind="select", options=["silhouette", "ari"]),
        Knob(key="chosen", label="Chosen resolution", kind="number", min=0.0, max=5.0, step=0.1),
    )

    def applies_to(self, claim: Claim, design: Design) -> bool:
        return claim.kind in self.claim_kinds

    def detect(self, claim: Claim, adata: Any, design: Design) -> DetectResult:
        sw = _sweep(adata, design)
        criterion = sw["criterion"]
        if not sw["usable"]:
            return Candidate(
                state=FLAG_ONLY,
                headline="No cluster-quality criterion could be scored on this data.",
                numbers={"_sweep": sw},
                stats=[stat("Status", "needs input")],
                message="A cell embedding with at least two clusters per setting is needed to score silhouette or ARI.",
            )
        s_lo, s_hi = float(sw["supportedLo"]), float(sw["supportedHi"])
        chosen = float(sw["original"])
        justified = design.knob("resolutionJustified") or design.knob("criterionRecorded") or design.knob("justified")
        inside = s_lo <= chosen <= s_hi

        if justified or inside:
            head = (
                f"The cluster count is supported: the chosen resolution {chosen:.2f} sits inside the "
                f"{criterion}-supported window {s_lo:.2f} to {s_hi:.2f}."
            )
            return Clean(
                headline=head,
                stats=[
                    stat("Chosen", f"{chosen:.2f}", good=True),
                    stat("Supported", f"{s_lo:.2f}-{s_hi:.2f}"),
                    stat("Criterion", criterion),
                ],
                chart=_chart(sw, chosen),
            )
        head = (
            f"The chosen resolution {chosen:.2f} sits outside the {criterion}-supported window "
            f"{s_lo:.2f} to {s_hi:.2f}; the cluster count was not justified by a criterion."
        )
        return Candidate(
            state=FLAGGED,
            headline=head,
            numbers={"_sweep": sw},
            chart=_chart(sw, chosen),
            stats=[
                stat("Chosen", f"{chosen:.2f}", bad=True),
                stat("Best by " + criterion, f"{float(sw['best']):.2f}"),
                stat("Supported", f"{s_lo:.2f}-{s_hi:.2f}"),
            ],
        )

    def prove(self, candidate: Candidate, adata: Any, design: Design) -> Evidence:
        sw = (candidate.numbers or {}).get("_sweep") if candidate.numbers else None
        if sw is None:
            sw = _sweep(adata, design)
        criterion = sw["criterion"]
        if not sw["usable"]:
            return Evidence(
                state=FLAG_ONLY,
                headline=candidate.headline,
                stats=list(candidate.stats),
                chart=fragility_chart([], (sw["lo"], sw["hi"]), criterion, sw["stability"], chosen=float(sw["original"])),
                numbers={"criterion": criterion},
                method=self.citation,
                feasibility=FIXABLE_NOW,
                params=self._params(sw, design),
                message=candidate.message,
            )
        s_lo, s_hi = float(sw["supportedLo"]), float(sw["supportedHi"])
        chosen = float(sw["original"])
        # supportedLo is the corrected resolution, so both the chart's supported[0]
        # and the emitted script's "corrected" read the same kernel value.
        corrected = float(sw["corrected"])
        best = float(sw["best"])
        before = _chart(sw, chosen)
        # The corrected artifact re-centers the chosen marker on the supported peak.
        after = _chart(sw, best)
        head = (
            f"The {criterion} criterion peaks at resolution {best:.2f} ({sw['best_clusters']} clusters); "
            f"the supported window is {s_lo:.2f} to {s_hi:.2f}, and {chosen:.2f} sits outside it."
        )
        return Evidence(
            state=FLAGGED,
            headline=head,
            stats=[
                stat("Chosen", f"{chosen:.2f}", bad=True),
                stat("Supported from", f"{corrected:.2f}", good=True),
                stat("Supported", f"{s_lo:.2f}-{s_hi:.2f}"),
                stat("Best by " + criterion, f"{best:.2f}"),
            ],
            chart=before,
            numbers={
                "original": sw["original"],
                "corrected": sw["corrected"],
                "supportedLo": sw["supportedLo"],
                "supportedHi": sw["supportedHi"],
                "criterion": criterion,
                "best": sw["best"],
                "steps": sw["steps"],
            },
            method=self.citation,
            feasibility=FIXABLE_NOW,
            params=self._params(sw, design),
            corrected_artifact=after,
            caveat=f"The supported window is where the {criterion} score stays within tolerance of its peak.",
        )

    def _params(self, sw: dict, design: Design) -> dict:
        return {
            "h5ad": h5ad_hint(design),
            "min": float(sw["lo"]),
            "max": float(sw["hi"]),
            "step": float(sw["step"]),
            "criterion": sw["criterion"],
            "chosen": float(sw["original"]),
            "seed": int(sw["seed"]),
        }

    def correct(self, evidence: Evidence, adata: Any, design: Design) -> CorrectedCode:
        return render_or_fallback(self.id, evidence.params)

    def recommend(self, evidence: Evidence, design: Design) -> list[Recommendation]:
        n = evidence.numbers
        criterion = n.get("criterion", "silhouette")
        chosen = n.get("original")
        supported_lo = n.get("corrected")
        s_lo = n.get("supportedLo")
        s_hi = n.get("supportedHi")
        best = n.get("best")
        if chosen is None or supported_lo is None:
            return [
                Recommendation(
                    action=f"score the clustering resolution by {criterion} and report the value with the claim",
                    rationale="the chosen resolution was not tied to any stability or quality criterion.",
                    changes="the reported cluster count carries a justification a reader can check.",
                    feasibility=FIXABLE_NOW,
                    citation=self.citation,
                )
            ]
        return [
            Recommendation(
                action=(
                    f"set the clustering resolution to {float(supported_lo):.2f}, the coarsest setting the "
                    f"{criterion} criterion supports, instead of {float(chosen):.2f}"
                ),
                rationale=(
                    f"the {criterion}-supported window is {float(s_lo):.2f} to {float(s_hi):.2f} "
                    f"(peak {float(best):.2f}) and {float(chosen):.2f} sits outside it."
                ),
                changes="the cluster count is chosen by a criterion instead of by hand, and reported with it.",
                feasibility=FIXABLE_NOW,
                citation=self.citation,
            )
        ]


MODULE: CheckModule = Check7ResolutionChoice()
