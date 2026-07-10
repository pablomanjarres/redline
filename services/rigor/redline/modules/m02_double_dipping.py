"""Check 2 - Double dipping, on the CheckModule interface.

A cluster (a cell type, or a cell state) is defined and then tested for its own
marker genes on the same cells. That reuse manufactures false-positive markers.
The honest re-analysis splits the counts into two independent halves by Poisson
thinning, re-clusters on the discovery half to define the group without touching
the held-out half, then re-scores the claimed markers on the held-out half.

The split, made real:

- ``detect`` runs the counts gate and reads the claimed marker set. Both are
  cheap, and neither runs the thinning.
- ``prove`` runs the thinning, the re-clustering on the discovery half, and the
  held-out AUC per marker, by composing ``pillars.double_dipping.run``.

Honesty constraint, carried in the caveat: count splitting is evidence, not a
certified FDR correction, and data thinning has documented limits. ClusterDE
(Song, Wang & Li 2023) is the stronger method, and the caveat names it. The
output is framed as "this many markers survive a valid held-out test".
"""

from __future__ import annotations

from typing import Any, Optional

from ..contracts import (
    CLEAN,
    FIXABLE_NOW,
    FLAG_ONLY,
    FLAGGED,
    NEEDS_NEW_DATA,
    CorrectedCode,
    Knob,
    Marker,
    MethodRef,
    Recommendation,
    groups_chart,
    stat,
)
from ..correction import kernels
from ..pillars import cfg_get
from .base import Candidate, CheckModule, Claim, Design, Evidence

_SURVIVE_AUC = 0.60  # a marker "survives" if it still separates the group out of sample
_CLEAN_MEAN_AUC = 0.62  # the group as a whole is real if held-out separation stays here
_CLUSTERDE = "ClusterDE (Song, Wang & Li 2023) is the stronger method for full FDR control."

_CITATION = MethodRef(
    authors="Gao, Bien & Witten",
    year=2022,
    venue="J. Amer. Stat. Assoc.",
    note="Features chosen to define a cluster must be validated on data held out from that choice.",
)


def _markers_from_config(design: Design) -> list[str]:
    for key in ("markers", "marker_genes", "genes"):
        v = cfg_get(design.config, key, None)
        if v:
            return [str(m) for m in v]
    return []


class DoubleDipping(CheckModule):
    id = 2
    name = "Double dipping"
    one_line = "Clusters that do not replicate out of sample"
    error_class = "selective_inference"
    citation = _CITATION
    claim_kinds = ("marker",)
    knobs = (
        Knob(key="split", label="Discovery fraction", kind="number", min=0.05, max=0.95, step=0.05),
        Knob(key="grouping", label="Cluster labels", kind="text"),
    )

    def applies_to(self, claim: Claim, design: Design) -> bool:
        if claim.kind and claim.kind != "unknown" and claim.kind not in self.claim_kinds:
            return False
        grouping = cfg_get(design.config, "grouping", None) or design.grouping or design.derived
        return bool(grouping)

    def detect(self, claim: Claim, adata: Any, design: Design):
        from .. import gating

        split = float(cfg_get(design.config, "split", 0.5))
        grouping = cfg_get(design.config, "grouping", None) or design.grouping or design.derived
        target_group = cfg_get(design.config, "target_group", None) or cfg_get(design.config, "group", None)
        seed = cfg_get(design.config, "seed", 0)
        markers = _markers_from_config(design) or [str(g) for g in (claim.genes or ())]

        base = {
            "split": split,
            "grouping": str(grouping) if grouping else "",
            "target_group": str(target_group) if target_group else "",
            "seed": seed,
            "markers": markers,
        }

        gate = gating.require_counts(adata)
        if not gate.ok:
            return Candidate(
                state=FLAG_ONLY,
                headline=gate.message,
                numbers=base,
                stats=[stat("Re-run", "not available", bad=True), stat("Reason", "no raw counts")],
            )

        n_markers = len(markers)
        head = (
            f"'{target_group or grouping}' was defined and its markers scored on the same cells; "
            "a held-out split has to confirm them."
        )
        return Candidate(
            state="flagged",
            headline=head,
            numbers=base,
            stats=[stat("Claimed markers", str(n_markers) if n_markers else "auto"), stat("Split", f"{split:.2f}")],
        )

    def prove(self, candidate: Candidate, adata: Any, design: Design) -> Evidence:
        base = candidate.numbers or {}
        split = float(base.get("split", cfg_get(design.config, "split", 0.5)))
        grouping = base.get("grouping") or ""
        target_group = base.get("target_group") or ""
        seed = int(base.get("seed", 0)) if str(base.get("seed", 0)).isdigit() else 0
        markers = list(base.get("markers") or [])

        params = {
            "h5ad": _h5ad_hint(design),
            "grouping": grouping,
            "target_group": target_group,
            "markers": markers,
            "split": split,
            "seed": seed,
        }

        if candidate.state == FLAG_ONLY:
            return Evidence(
                state=FLAG_ONLY,
                headline=candidate.headline,
                stats=list(candidate.stats),
                chart=groups_chart([], split, verified=False),
                numbers={"original": None, "corrected": None},
                method=self.citation,
                feasibility=NEEDS_NEW_DATA,
                params=params,
                corrected_artifact=None,
                caveat=_CLUSTERDE,
            )

        # One held-out re-test in the kernel feeds the chart, the preview, and the
        # emitted script, so the mean discovery and held-out AUC agree everywhere.
        nums = kernels.check2_double_dipping(
            adata, grouping=grouping, target_group=target_group, markers=markers, split=split, seed=seed
        )
        report = nums["markers"]
        tested = [(g, r) for g, r in report.items() if r.get("hold") is not None]
        marker_rows = [Marker(gene=g, disc=float(r["disc"]), hold=float(r["hold"])) for g, r in tested]
        surviving_rows = [Marker(gene=g, disc=float(r["disc"]), hold=float(r["hold"])) for g, r in tested if r["survives"]]
        disc_auc = nums["original"]
        hold_auc = nums["corrected"]
        surviving = int(nums["surviving"])
        total = len(tested)

        chart = groups_chart(marker_rows, split, verified=True, disc_auc=disc_auc, hold_auc=hold_auc)
        stats = [
            stat("Discovery AUC", f"{disc_auc:.2f}"),
            stat("Held-out AUC", f"{hold_auc:.2f}", bad=(hold_auc < _CLEAN_MEAN_AUC), good=(hold_auc >= _CLEAN_MEAN_AUC)),
            stat("Markers holding", f"{surviving} / {total}", bad=(surviving == 0)),
        ]
        group = target_group or grouping or "the group"

        if hold_auc >= _CLEAN_MEAN_AUC and surviving >= max(1, total // 2 + total % 2):
            head = f"'{group}' holds up: {surviving} of {total} markers still separate it on a held-out split."
            return Evidence(
                state=CLEAN,
                headline=head,
                stats=stats,
                chart=chart,
                numbers=nums,
                method=self.citation,
                feasibility=FIXABLE_NOW,
                params=params,
                corrected_artifact=None,
                caveat=_CLUSTERDE,
            )

        head = (
            f"'{group}' separates at discovery AUC {disc_auc:.2f} and collapses to {hold_auc:.2f} on a "
            f"held-out split; only {surviving} of {total} markers survive."
        )
        after = groups_chart(surviving_rows, split, verified=True, disc_auc=disc_auc, hold_auc=hold_auc)
        return Evidence(
            state=FLAGGED,
            headline=head,
            stats=stats,
            chart=chart,
            numbers=nums,
            method=self.citation,
            feasibility=FIXABLE_NOW,
            params=params,
            corrected_artifact=after,
            caveat=_CLUSTERDE,
        )

    def recommend(self, evidence: Evidence, design: Design) -> list[Recommendation]:
        p = evidence.params
        group = p.get("target_group") or p.get("grouping") or "the group"
        n = evidence.numbers

        if evidence.state == FLAG_ONLY:
            msg = evidence.headline.lower()
            if "held-out" in msg or "too small" in msg:
                return [
                    Recommendation(
                        action="Raise the discovery fraction or add cells so the held-out half can validate the group.",
                        rationale="The held-out half is too small to score the markers out of sample.",
                        changes="A larger held-out half lets the count-split test confirm or drop each marker.",
                        feasibility=NEEDS_NEW_DATA,
                        citation=self.citation,
                    )
                ]
            return [
                Recommendation(
                    action="Provide raw integer counts (a 'counts' layer or .raw), then re-run the count-split test.",
                    rationale="Poisson thinning needs raw counts; the object as given holds only normalized values.",
                    changes=f"The markers for '{group}' can then be validated on an independent half.",
                    feasibility=NEEDS_NEW_DATA,
                    citation=self.citation,
                )
            ]

        surviving = sum(1 for m in evidence.chart.get("markers", []) if float(m.get("hold", 0.0)) >= _SURVIVE_AUC)
        total = len(evidence.chart.get("markers", []))
        disc = n.get("original")
        hold = n.get("corrected")
        recs = [
            Recommendation(
                action=f"Re-run marker discovery for '{group}' with count splitting and keep only the markers that hold out of sample.",
                rationale=f"Separation drops from AUC {disc:.2f} at discovery to {hold:.2f} on independent counts; {surviving} of {total} markers survive.",
                changes=f"Report the {surviving} surviving markers; drop the {total - surviving} that only appear because they defined the group.",
                feasibility=FIXABLE_NOW,
                citation=self.citation,
            ),
            Recommendation(
                action=f"Validate the surviving markers of '{group}' on an independent cohort, or re-test them with ClusterDE.",
                rationale="Count splitting is evidence, not a certified FDR correction; an independent cohort or ClusterDE controls the error rate properly.",
                changes="A cohort or ClusterDE confirmation turns the surviving markers into a defensible claim.",
                feasibility=NEEDS_NEW_DATA,
                citation=self.citation,
            ),
        ]
        return recs

    def correct(self, evidence: Evidence, adata: Any, design: Design) -> CorrectedCode:
        from .m05_multiple_testing import render_or_fallback

        return render_or_fallback(self.id, evidence.params)


def _h5ad_hint(design: Design) -> str:
    return str(cfg_get(design.config, "h5ad", None) or "data.h5ad")


MODULE: CheckModule = DoubleDipping()

__all__ = ["MODULE", "DoubleDipping"]
