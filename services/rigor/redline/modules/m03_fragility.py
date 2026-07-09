"""Check 3 - Fragility, on the CheckModule interface.

A conclusion that rides on an arbitrary clustering resolution the scientist never
justified. The honest re-analysis sweeps the resolution across a range, clusters
at each setting, measures agreement between adjacent settings (adjusted Rand
index), and tracks whether a named group survives the sweep or only exists inside
a narrow window.

The split, made real:

- ``detect`` resolves the tracked group and confirms the sweep is meaningful.
  Both are cheap.
- ``prove`` runs the resolution sweep, the presence check per setting, and the
  adjacent-ARI stability, by composing ``pillars.fragility.run``.

A group that is stable across the sweep returns a confident clean verdict. When a
group only appears in a narrow window the correction pins the resolution by a
stability criterion. When no stable version of the claimed population exists, the
honest corrected view is the sweep showing its absence, never a fabricated stable
cluster.
"""

from __future__ import annotations

from typing import Any, Optional

from ..contracts import (
    CLEAN,
    FIXABLE_NOW,
    FLAGGED,
    CorrectedCode,
    FragilityStep,
    Knob,
    MethodRef,
    Recommendation,
    fmt_pct,
    fragility_chart,
    stat,
)
from ..correction import kernels
from ..pillars import cfg_get
from ..pillars import fragility as P
from .base import Candidate, CheckModule, Claim, Design, Evidence

_STABLE_FRACTION = 0.8  # present in at least this share of settings => a stable population

_CITATION = MethodRef(
    authors="Luecken & Theis",
    year=2019,
    venue="Molecular Systems Biology",
    note="Report cluster stability across resolutions; unstable clusters are not discrete populations.",
)


class Fragility(CheckModule):
    id = 3
    name = "Fragility"
    one_line = "A result that hinges on an arbitrary parameter"
    error_class = "clustering_artifact"
    citation = _CITATION
    claim_kinds = ("cluster",)
    knobs = (
        Knob(key="min", label="Min resolution", kind="number", min=0.0, max=3.0, step=0.1),
        Knob(key="max", label="Max resolution", kind="number", min=0.0, max=3.0, step=0.1),
        Knob(key="step", label="Sweep step", kind="number", min=0.05, max=1.0, step=0.05),
        Knob(key="track", label="Tracked group", kind="text"),
        Knob(key="scrub", label="Scrub fraction", kind="number", min=0.0, max=1.0, step=0.05),
    )

    def applies_to(self, claim: Claim, design: Design) -> bool:
        if claim.kind and claim.kind != "unknown" and claim.kind not in self.claim_kinds:
            return False
        return True

    def detect(self, claim: Claim, adata: Any, design: Design):
        lo = float(cfg_get(design.config, "min", 0.2))
        hi = float(cfg_get(design.config, "max", 2.0))
        step = float(cfg_get(design.config, "step", 0.2))
        track = cfg_get(design.config, "track", None) or claim.group or ""
        seed = int(cfg_get(design.config, "seed", 0))

        track_col = P._find_track_column(adata, track, design.fields) if track else None
        base = {
            "min": lo,
            "max": hi,
            "step": max(step, 0.05),
            "track": str(track),
            "track_column": str(track_col) if track_col else "",
            "seed": seed,
        }
        if track and track_col is not None:
            head = f"The conclusion rides on '{track}' being a discrete cluster; the resolution sweep has to confirm it."
            label = f"'{track}'"
        else:
            head = "The conclusion rides on the clustering resolution; the sweep has to show it is stable."
            label = "the clustering"
        return Candidate(
            state="flagged",
            headline=head,
            numbers=base,
            stats=[stat("Sweep", f"{lo:.1f} to {hi:.1f}"), stat("Tracking", label)],
        )

    def prove(self, candidate: Candidate, adata: Any, design: Design) -> Evidence:
        base = candidate.numbers or {}
        lo = float(base.get("min", cfg_get(design.config, "min", 0.2)))
        hi = float(base.get("max", cfg_get(design.config, "max", 2.0)))
        step = float(base.get("step", cfg_get(design.config, "step", 0.2)))
        track = str(base.get("track", "") or "")
        track_column = str(base.get("track_column", "") or "")
        seed = int(base.get("seed", 0)) if str(base.get("seed", 0)).isdigit() else 0

        params = {
            "h5ad": _h5ad_hint(design),
            "track": track,
            "track_column": track_column,
            "min": lo,
            "max": hi,
            "step": step,
            "seed": seed,
        }

        # One sweep in the kernel: the stability fraction it returns is the corrected
        # statistic, and it is the same number the emitted script prints.
        nums = kernels.check3_fragility(
            adata, track=track, track_column=track_column or None, min_res=lo, max_res=hi, step=step, seed=seed
        )
        stability = float(nums["corrected"])
        present = (float(nums["present_lo"]), float(nums["present_hi"]))
        steps = [
            FragilityStep(r=float(s["r"]), present=bool(s["present"]), clusters=int(s["clusters"]))
            for s in nums["steps"]
        ]
        # No supported window: this chart's corrected statistic is the stability
        # fraction, so the harness reads chart.stability rather than supported[0].
        chart = fragility_chart(steps, present, track, stability)
        label = f"'{track}'" if track else "the clustering"
        present_res = [s.r for s in steps if s.present]

        if stability >= _STABLE_FRACTION:
            span = f"{min(present_res):.1f} to {max(present_res):.1f}" if present_res else "the range tested"
            head = f"{label} is stable across the resolution sweep, present in {fmt_pct(stability)} of settings ({span})."
            return Evidence(
                state=CLEAN,
                headline=head,
                stats=[stat("Stability", fmt_pct(stability), good=True), stat("Present range", span)],
                chart=chart,
                numbers=nums,
                method=self.citation,
                feasibility=FIXABLE_NOW,
                params=params,
                corrected_artifact=None,
                caveat=None,
            )

        head = (
            f"{label} appears in only {fmt_pct(stability)} of the resolutions swept; it is a boundary of the "
            "algorithm, not a discrete population that holds across settings."
        )
        return Evidence(
            state=FLAGGED,
            headline=head,
            stats=[
                stat("Stability", fmt_pct(stability), bad=True),
                stat("Appears in", f"{len(present_res)} / {len(steps)} settings"),
            ],
            chart=chart,
            numbers=nums,
            method=self.citation,
            feasibility=FIXABLE_NOW,
            params=params,
            corrected_artifact=fragility_chart(steps, present, track, stability),
            caveat=None,
        )

    def recommend(self, evidence: Evidence, design: Design) -> list[Recommendation]:
        chart = evidence.chart
        track = evidence.params.get("track") or ""
        label = f"'{track}'" if track else "the clustering"
        stability = float(chart.get("stability", 0.0))
        present_res = [float(s["r"]) for s in chart.get("steps", []) if s.get("present")]

        if evidence.state == "clean":
            span = f"{min(present_res):.1f} to {max(present_res):.1f}" if present_res else "the range tested"
            return [
                Recommendation(
                    action=f"Report {label} as stable, and state the resolution range it holds across ({span}).",
                    rationale=f"{label} is present in {fmt_pct(stability)} of the resolutions swept, so the conclusion does not hinge on one setting.",
                    changes="The claim gains a stability statement; no re-clustering is needed.",
                    feasibility=FIXABLE_NOW,
                    citation=self.citation,
                )
            ]

        if present_res:
            window = f"{min(present_res):.1f} to {max(present_res):.1f}"
            return [
                Recommendation(
                    action=f"Pin the clustering resolution by a stability criterion and report the window where {label} is present ({window}).",
                    rationale=f"{label} is a discrete cluster in only {fmt_pct(stability)} of the resolutions swept, so a single arbitrary setting is not defensible.",
                    changes=f"The conclusion is restated as holding within {window}, not as a resolution-free fact.",
                    feasibility=FIXABLE_NOW,
                    citation=self.citation,
                )
            ]
        return [
            Recommendation(
                action=f"Drop the claim that {label} is a discrete population, or re-derive it with a stability-selected resolution.",
                rationale=f"{label} does not form a stable cluster at any resolution in the sweep; it is a boundary of the algorithm.",
                changes="The population is removed from the conclusions, or replaced by one that survives the sweep.",
                feasibility=FIXABLE_NOW,
                citation=self.citation,
            )
        ]

    def correct(self, evidence: Evidence, adata: Any, design: Design) -> CorrectedCode:
        from .m05_multiple_testing import render_or_fallback

        return render_or_fallback(self.id, evidence.params)


def _h5ad_hint(design: Design) -> str:
    return str(cfg_get(design.config, "h5ad", None) or "data.h5ad")


MODULE: CheckModule = Fragility()

__all__ = ["MODULE", "Fragility"]
