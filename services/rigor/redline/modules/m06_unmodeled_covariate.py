"""Check 6 - Unmodeled batch / covariate.

Distinct from check 4. Check 4 catches the inseparable confound, where the
biological comparison and a technical variable are the same split and nothing
can be done. Check 6 catches the separable one that was simply left out of the
model, which means it is fixable: include the covariate in the design and refit.

Detect confirms the covariate is separable from the grouping (Cramer's V below
the nested threshold and a full-rank design), that it was omitted from the stored
model, and that it associates with the grouping. Prove refits ~ interest +
covariate (PyDESeq2 when raw counts are present, otherwise a per-unit two-way
linear model) and reports whether the effect and the hit list change.
"""

from __future__ import annotations

from typing import Any, Optional

from ..contracts import (
    FIXABLE_NOW,
    FLAG_ONLY,
    FLAGGED,
    NEEDS_NEW_DATA,
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
from ..pillars.confounding import NESTED_THRESHOLD, _design_rank_deficient, cramers_v
from .base import Candidate, CheckModule, Claim, Clean, Design, DetectResult, Evidence
from .m05_multiple_testing import h5ad_hint, render_or_fallback

_ASSOC_FLOOR = 0.1  # below this Cramer's V the covariate does not materially associate

_CITATION = MethodRef(
    authors="Hicks et al.",
    year=2018,
    venue="Biostatistics",
    note="Model the known technical variable; a separable batch effect is removed by including it in the design.",
)


def _empty_sig_chart(alpha: float) -> dict:
    zero = SignificanceLevel(n=0, p=1.0, sig=False)
    return significance_chart(zero, zero, alpha, [], bad_unit=False)


class _Setup:
    """Resolve the interest, the covariate, and the separability signals."""

    def __init__(self, adata: Any, design: Design) -> None:
        self.ok = False
        self.reason = ""
        self.alpha = float(design.knob("alpha", 0.05) or 0.05)
        self.interest = design.knob("interest") or design.grouping
        cands = ([design.knob("covariate")] if design.knob("covariate") else []) + design.roles("covariate") + design.nuisance
        self.covariate = next((c for c in cands if c and obs_series(adata, c) is not None), None)

        self.interest_vec = obs_series(adata, self.interest) if self.interest else None
        self.cov_vec = obs_series(adata, self.covariate) if self.covariate else None
        if self.interest_vec is None:
            self.reason = "No grouping/interest column is resolved."
            return
        if self.cov_vec is None:
            self.reason = "No technical covariate is resolved to test for omission."
            return
        picked = two_groups(self.interest_vec, design.config)
        if picked is None:
            self.reason = f"'{self.interest}' has fewer than two levels to compare."
            return
        self.ref, self.alt, _, _ = picked

        self.v = cramers_v(self.interest_vec, self.cov_vec)
        self.rank_deficient = _design_rank_deficient([list(self.interest_vec), list(self.cov_vec)])
        self.separable = (self.v < NESTED_THRESHOLD) and not self.rank_deficient

        model = design.knob("covariates") or design.knob("model") or []
        if isinstance(model, str):
            self.in_model = str(self.covariate) in model
        else:
            self.in_model = str(self.covariate) in {str(x) for x in (model or [])}

        self.unit = design.unit
        self.ok = True


class Check6UnmodeledCovariate(CheckModule):
    id = 6
    name = "Unmodeled covariate"
    one_line = "A separable technical variable was left out of the model."
    error_class = "Unmodeled covariate"
    citation = _CITATION
    claim_kinds = ("de",)
    knobs = (
        Knob(key="interest", label="Effect of interest", kind="text"),
        Knob(key="covariate", label="Covariate to add", kind="text"),
        Knob(key="alpha", label="Significance level", kind="number", min=0.0, max=0.25, step=0.005),
    )

    def applies_to(self, claim: Claim, design: Design) -> bool:
        if claim.kind not in self.claim_kinds:
            return False
        if not (design.grouping or design.knob("interest")):
            return False
        return bool(design.knob("covariate") or design.roles("covariate") or design.nuisance)

    def detect(self, claim: Claim, adata: Any, design: Design) -> DetectResult:
        s = _Setup(adata, design)
        if not s.ok:
            return Candidate(
                state=FLAG_ONLY,
                headline="The covariate check needs an interest and a technical covariate to run.",
                stats=[stat("Status", "needs input")],
                chart=_empty_sig_chart(s.alpha),
                message=s.reason,
            )
        if not s.separable:
            head = f"'{s.interest}' and '{s.covariate}' are not separable here; check 4 owns the inseparable confound."
            return Clean(
                headline=head,
                stats=[stat("Cramer's V", f"{s.v:.2f}"), stat("Separable", "no")],
                chart=_empty_sig_chart(s.alpha),
            )
        if s.in_model:
            head = f"'{s.covariate}' is already in the model, so the separable covariate is handled."
            return Clean(
                headline=head,
                stats=[stat("Cramer's V", f"{s.v:.2f}", good=True), stat("In model", "yes", good=True)],
                chart=_empty_sig_chart(s.alpha),
            )
        if s.v < _ASSOC_FLOOR:
            head = f"'{s.covariate}' barely associates with '{s.interest}' (Cramer's V {s.v:.2f}); leaving it out did not bias the effect."
            return Clean(
                headline=head,
                stats=[stat("Cramer's V", f"{s.v:.2f}", good=True), stat("Separable", "yes", good=True)],
                chart=_empty_sig_chart(s.alpha),
            )
        head = (
            f"'{s.covariate}' is separable from '{s.interest}' (Cramer's V {s.v:.2f}) and was left out "
            "of the model; the effect should be re-checked with it included."
        )
        return Candidate(
            state=FLAGGED,
            headline=head,
            numbers={"cramersV": s.v},
            chart=_empty_sig_chart(s.alpha),
            stats=[
                stat("Cramer's V", f"{s.v:.2f}", bad=True),
                stat("Separable", "yes"),
                stat("In model", "no", bad=True),
            ],
        )

    def prove(self, candidate: Candidate, adata: Any, design: Design) -> Evidence:
        s = _Setup(adata, design)
        if not s.ok:
            return Evidence(
                state=FLAG_ONLY,
                headline="The covariate refit could not run on this data.",
                stats=[stat("Status", "needs input")],
                chart=_empty_sig_chart(0.05),
                numbers={"cramersV": None},
                method=self.citation,
                feasibility=NEEDS_NEW_DATA,
                params=self._params(s, design),
                message=candidate.message or "A biological-unit role and expressed genes are needed to refit.",
            )

        # Both fits run at the replicate level in one kernel, so the naive and the
        # covariate-adjusted p Redline reports are the same numbers the script prints.
        nums = kernels.check6_unmodeled_covariate(
            adata,
            interest=str(s.interest),
            covariate=str(s.covariate),
            ref=str(s.ref),
            alt=str(s.alt),
            unit=s.unit,
            gene=None,
            alpha=s.alpha,
        )
        naive_p = nums["original"]
        honest_p = nums["corrected"]
        if naive_p is None or honest_p is None:
            return Evidence(
                state=FLAG_ONLY,
                headline="The covariate refit could not run on this data.",
                stats=[stat("Status", "needs input")],
                chart=_empty_sig_chart(s.alpha),
                numbers=nums,
                method=self.citation,
                feasibility=NEEDS_NEW_DATA,
                params=self._params(s, design),
                message="A biological-unit role and expressed genes are needed to refit.",
            )
        n_units = self._n_units(adata, s)
        naive = SignificanceLevel(n=n_units, p=float(naive_p), sig=float(naive_p) < s.alpha)
        honest = SignificanceLevel(n=n_units, p=float(honest_p), sig=float(honest_p) < s.alpha)
        chart = significance_chart(naive, honest, s.alpha, [], bad_unit=False)
        changed = naive.sig != honest.sig
        head = (
            f"Adding '{s.covariate}' moves the effect of '{s.interest}' from p={fmt_p(naive_p)} to "
            f"p={fmt_p(honest_p)}"
            + (" and flips the call." if changed else ", so the omission did not change the call here.")
        )
        return Evidence(
            state=FLAGGED,
            headline=head,
            stats=[
                stat("Naive p", fmt_p(naive_p), bad=True),
                stat("Adjusted p", fmt_p(honest_p), good=(not honest.sig)),
                stat("Cramer's V", f"{s.v:.2f}"),
            ],
            chart=chart,
            numbers=nums,
            method=self.citation,
            feasibility=FIXABLE_NOW,
            params=self._params(s, design),
            corrected_artifact=chart,
            caveat=f"The adjustment is at the replicate level ({nums['method']}).",
        )

    def _n_units(self, adata: Any, s: "_Setup") -> int:
        import numpy as np

        interest_vec = np.asarray([str(x) for x in s.interest_vec])
        keep = (interest_vec == str(s.ref)) | (interest_vec == str(s.alt))
        units = obs_series(adata, s.unit) if s.unit else None
        if units is None:
            return int(keep.sum())
        return int(np.unique(np.asarray([str(x) for x in units])[keep]).size)

    def _params(self, s: _Setup, design: Design) -> dict:
        return {
            "h5ad": h5ad_hint(design),
            "interest": s.interest if s.ok else (design.grouping or design.knob("interest")),
            "covariate": s.covariate if s.ok else design.knob("covariate"),
            "ref": getattr(s, "ref", None),
            "alt": getattr(s, "alt", None),
            "unit": (s.unit if s.ok else design.unit),
            "gene": None,
            "alpha": float(getattr(s, "alpha", 0.05)),
        }

    def correct(self, evidence: Evidence, adata: Any, design: Design) -> CorrectedCode:
        return render_or_fallback(self.id, evidence.params)

    def recommend(self, evidence: Evidence, design: Design) -> list[Recommendation]:
        n = evidence.numbers
        interest = evidence.params.get("interest")
        cov = evidence.params.get("covariate")
        naive_p = n.get("original")
        honest_p = n.get("corrected")
        v = n.get("cramersV")
        moved = "the call changes" if (naive_p is not None and honest_p is not None and (float(naive_p) < 0.05) != (float(honest_p) < 0.05)) else "the estimate shifts"
        return [
            Recommendation(
                action=f"include `{cov}` as a covariate: ~ {interest} + {cov}",
                rationale=(
                    f"`{cov}` and `{interest}` are separable (Cramer's V {float(v):.2f}) but `{cov}` was left out; "
                    "a separable technical variable belongs in the design."
                    if v is not None
                    else f"`{cov}` is separable from `{interest}` but was left out of the design."
                ),
                changes=(
                    f"the {interest} effect moves from p={fmt_p(float(naive_p))} to p={fmt_p(float(honest_p))}, so {moved}."
                    if naive_p is not None and honest_p is not None
                    else "the effect is re-estimated with the covariate held constant."
                ),
                feasibility=FIXABLE_NOW,
                citation=self.citation,
            )
        ]


MODULE: CheckModule = Check6UnmodeledCovariate()
