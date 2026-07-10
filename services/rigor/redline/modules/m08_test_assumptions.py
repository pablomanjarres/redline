"""Check 8 - DE test-assumption mismatch.

A differential-expression test whose assumptions the data violate: a parametric
t-test applied to raw counts, ignoring the mean-variance relationship and library
size. The honest re-analysis re-runs with a count-aware method (a negative-binomial
GLM on pseudobulk via PyDESeq2 when raw counts are present, otherwise a linear
model on library-size-normalized, log1p per-unit means) and compares.

The overdispersion the check reports (variance over mean of the traced gene's raw
counts) is exactly why a Gaussian t-test on raw counts misstates significance:
count data is overdispersed, and the parametric test does not model that.
"""

from __future__ import annotations

from typing import Any, Optional

from ..contracts import (
    FIXABLE_NOW,
    FLAG_ONLY,
    FLAGGED,
    CorrectedCode,
    Knob,
    MethodRef,
    Recommendation,
    SignificanceLevel,
    fmt_p,
    significance_chart,
    stat,
)
from ..correction import kernels
from ..pillars import obs_series, two_groups
from .base import Candidate, CheckModule, Claim, Clean, Design, DetectResult, Evidence
from .m05_multiple_testing import h5ad_hint, raw_counts, render_or_fallback

_COUNT_AWARE = ("deseq", "deseq2", "edger", "edge_r", "negative-binomial", "negativebinomial", "nb", "glmgampoi", "glm-nb")

_CITATION = MethodRef(
    authors="Soneson & Robinson",
    year=2018,
    venue="Nature Methods",
    note="Benchmarking shows count-aware methods control the error rate where parametric tests on raw counts do not.",
    url="https://doi.org/10.1038/nmeth.4612",
)


def _empty_sig_chart(alpha: float) -> dict:
    zero = SignificanceLevel(n=0, p=1.0, sig=False)
    return significance_chart(zero, zero, alpha, [], bad_unit=False)


def _count_aware_method(design: Design) -> Optional[str]:
    for key in ("method", "deTest", "test"):
        v = design.knob(key)
        if v and str(v).lower() in _COUNT_AWARE:
            return str(v)
    return None


def _resolve(adata: Any, design: Design) -> dict:
    """Cheap resolution shared by detect and prove: the comparison, whether raw
    counts exist, the replicate counts, and the overdispersion the t-test ignores.
    No re-fit runs here; the count-aware p comes from the kernel in prove."""
    out: dict = {"ok": False, "reason": "", "has_counts": False}
    out["alpha"] = float(design.knob("alpha", 0.05) or 0.05)
    out["claimed_test"] = str(design.knob("claimedTest", "unknown") or "unknown").lower()
    out["grouping"] = design.grouping or design.knob("grouping")
    out["unit"] = design.unit

    C, _ = raw_counts(adata)
    out["has_counts"] = C is not None
    groups = obs_series(adata, out["grouping"]) if out["grouping"] else None
    if groups is None:
        out["reason"] = "No grouping column is resolved, so the DE test cannot be reproduced."
        return out
    picked = two_groups(groups, design.config)
    if picked is None:
        out["reason"] = f"'{out['grouping']}' has fewer than two levels to compare."
        return out
    ref, alt, ref_mask, alt_mask = picked
    out["ref"], out["alt"] = ref, alt
    if C is None:
        out["reason"] = "Raw integer counts were not found, so the raw-count test premise cannot be checked."
        return out

    import numpy as np

    keep = ref_mask | alt_mask
    Ck = np.asarray(C[keep], dtype=float)
    mean = Ck.mean(axis=0)
    var = Ck.var(axis=0)
    ok = mean > 0
    out["overdispersion"] = float(np.mean(var[ok] / mean[ok])) if np.any(ok) else 1.0
    out["n_cells"] = int(keep.sum())
    units = obs_series(adata, out["unit"]) if out["unit"] else None
    if units is not None:
        out["n_units"] = int(np.unique(np.asarray([str(x) for x in units])[keep]).size)
    else:
        out["n_units"] = out["n_cells"]
    out["ok"] = True
    return out


class Check8TestAssumptions(CheckModule):
    id = 8
    name = "Test assumptions"
    one_line = "A parametric test was applied to raw counts it does not fit."
    error_class = "Test-assumption mismatch"
    citation = _CITATION
    claim_kinds = ("de",)
    knobs = (
        Knob(key="grouping", label="Grouping", kind="text"),
        Knob(key="claimedTest", label="Test used", kind="select", options=["ttest", "wilcoxon", "unknown"]),
        Knob(key="alpha", label="Significance level", kind="number", min=0.0, max=0.25, step=0.005),
    )

    def applies_to(self, claim: Claim, design: Design) -> bool:
        if claim.kind not in self.claim_kinds:
            return False
        return bool(design.grouping or design.knob("grouping"))

    def detect(self, claim: Claim, adata: Any, design: Design) -> DetectResult:
        alpha = float(design.knob("alpha", 0.05) or 0.05)
        count_aware = _count_aware_method(design)
        if count_aware is not None:
            return Clean(
                headline=f"The analysis used {count_aware}, a count-aware method; the test matches the data.",
                stats=[stat("Test", count_aware, good=True)],
                chart=_empty_sig_chart(alpha),
            )
        claimed = str(design.knob("claimedTest", "unknown") or "unknown").lower()
        if claimed == "wilcoxon":
            return Clean(
                headline="The analysis used a rank-based Wilcoxon test, which does not assume normal counts.",
                stats=[stat("Test", "wilcoxon", good=True)],
                chart=_empty_sig_chart(alpha),
            )
        if claimed == "unknown":
            return Candidate(
                state=FLAG_ONLY,
                headline="The DE test used was not recorded, so its assumptions cannot be checked.",
                stats=[stat("Test", "unknown")],
                chart=_empty_sig_chart(alpha),
                message="Record the differential-expression test used (t-test, Wilcoxon, DESeq2) so it can be checked.",
            )
        # claimed == 'ttest': verify against the data.
        r = _resolve(adata, design)
        if not r["ok"]:
            return Candidate(
                state=FLAG_ONLY,
                headline="A t-test was claimed, but the raw-count premise could not be verified on this data.",
                stats=[stat("Test", "t-test"), stat("Raw counts", "yes" if r["has_counts"] else "not found")],
                chart=_empty_sig_chart(alpha),
                message=r["reason"],
            )
        head = (
            "The claim rests on a parametric t-test on raw counts, which are overdispersed "
            f"(variance {r['overdispersion']:.1f}x the mean); the t-test does not model that."
        )
        return Candidate(
            state=FLAGGED,
            headline=head,
            numbers={"overdispersion": r["overdispersion"]},
            chart=_empty_sig_chart(alpha),
            stats=[
                stat("Test", "t-test on raw counts", bad=True),
                stat("Overdispersion", f"{r['overdispersion']:.1f}x", bad=(r["overdispersion"] > 1.5)),
            ],
        )

    def prove(self, candidate: Candidate, adata: Any, design: Design) -> Evidence:
        if candidate.state == FLAG_ONLY:
            # detect already found this unverifiable (unknown test, or no raw
            # counts). Honor that verdict; do not re-run it as a flag.
            alpha0 = float(design.knob("alpha", 0.05) or 0.05)
            return Evidence(
                state=FLAG_ONLY,
                headline=candidate.headline,
                stats=list(candidate.stats),
                chart=candidate.chart or _empty_sig_chart(alpha0),
                numbers=(candidate.numbers or {"overdispersion": None}),
                method=self.citation,
                feasibility=FIXABLE_NOW,
                params=self._params(_resolve(adata, design), design),
                message=candidate.message,
            )
        r = _resolve(adata, design)
        alpha = r["alpha"]
        if not r["ok"]:
            return Evidence(
                state=FLAG_ONLY,
                headline=candidate.headline,
                stats=list(candidate.stats),
                chart=_empty_sig_chart(alpha),
                numbers={"overdispersion": None},
                method=self.citation,
                feasibility=FIXABLE_NOW,
                params=self._params(r, design),
                message=candidate.message or r["reason"],
            )

        # The count-aware re-fit is the kernel's, so the p Redline reports, previews,
        # and emits are one number computed once.
        nums = kernels.check8_test_assumptions(
            adata,
            grouping=str(r["grouping"]),
            ref=str(r["ref"]),
            alt=str(r["alt"]),
            unit=r["unit"],
            gene=None,
            claimed_test=r["claimed_test"],
            alpha=alpha,
        )
        naive_p = nums["original"]
        honest_p = nums["corrected"]
        naive = SignificanceLevel(n=int(r["n_cells"]), p=float(naive_p), sig=float(naive_p) < alpha)
        honest = SignificanceLevel(n=int(r["n_units"]), p=float(honest_p), sig=float(honest_p) < alpha)
        chart = significance_chart(naive, honest, alpha, [], bad_unit=True)
        flipped = naive.sig and not honest.sig
        head = (
            f"The t-test on raw counts gives p={fmt_p(naive_p)}; a count-aware fit gives p={fmt_p(honest_p)}"
            + (", so the significance does not survive a test that fits the data." if flipped else ".")
        )
        caveat = (
            f"The count-aware fit is {nums['method']}. Overdispersion across the compared cells is "
            f"{nums['overdispersion']:.1f}x (variance over mean), which a Gaussian t-test on raw counts ignores."
        )
        return Evidence(
            state=FLAGGED,
            headline=head,
            stats=[
                stat("t-test p (raw counts)", fmt_p(naive_p), bad=True),
                stat("Count-aware p", fmt_p(honest_p), good=(not honest.sig)),
                stat("Overdispersion", f"{nums['overdispersion']:.1f}x"),
            ],
            chart=chart,
            numbers=nums,
            method=self.citation,
            feasibility=FIXABLE_NOW,
            params=self._params(r, design),
            corrected_artifact=chart,
            caveat=caveat,
        )

    def _params(self, r: dict, design: Design) -> dict:
        return {
            "h5ad": h5ad_hint(design),
            "grouping": r.get("grouping") if r.get("grouping") else (design.grouping or design.knob("grouping")),
            "ref": r.get("ref"),
            "alt": r.get("alt"),
            "unit": r.get("unit", design.unit),
            "claimed_test": r.get("claimed_test", str(design.knob("claimedTest", "unknown") or "unknown")),
            "gene": None,
            "alpha": float(r.get("alpha", design.knob("alpha", 0.05) or 0.05)),
        }

    def correct(self, evidence: Evidence, adata: Any, design: Design) -> CorrectedCode:
        return render_or_fallback(self.id, evidence.params)

    def recommend(self, evidence: Evidence, design: Design) -> list[Recommendation]:
        n = evidence.numbers
        naive_p = n.get("original")
        honest_p = n.get("corrected")
        ratio = n.get("overdispersion")
        grouping = evidence.params.get("grouping")
        if naive_p is None or honest_p is None:
            return [
                Recommendation(
                    action=f"re-run the {grouping} comparison with a count-aware method (DESeq2 or edgeR on pseudobulk)",
                    rationale="a parametric t-test on raw counts does not model count overdispersion or library size.",
                    changes="the significance is judged by a test whose assumptions the data meet.",
                    feasibility=FIXABLE_NOW,
                    citation=self.citation,
                )
            ]
        moved = "the call flips" if (float(naive_p) < 0.05) != (float(honest_p) < 0.05) else "the p-value shifts"
        return [
            Recommendation(
                action=f"re-run the {grouping} comparison with a count-aware method (pseudobulk + DESeq2)",
                rationale=(
                    f"the traced gene is overdispersed ({float(ratio):.1f}x variance over mean), so a Gaussian "
                    "t-test on raw counts misstates significance."
                    if ratio is not None
                    else "count data is overdispersed, which a parametric t-test on raw counts does not model."
                ),
                changes=f"the p-value moves from {fmt_p(float(naive_p))} to {fmt_p(float(honest_p))}, so {moved}.",
                feasibility=FIXABLE_NOW,
                citation=self.citation,
            )
        ]


MODULE: CheckModule = Check8TestAssumptions()
