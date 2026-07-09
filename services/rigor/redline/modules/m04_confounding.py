"""Check 4 - Confounding, on the CheckModule interface.

The biological comparison of interest is inseparable from a technical variable
(a condition run entirely on one lane, one day, one machine). The honest
re-analysis cross-tabulates the grouping against the technical column, measures
alignment with Cramer's V, tests the design matrix for rank, and, when the two
can be separated, refits the effect adjusting for the technical variable.

The split, made real:

- ``detect`` builds the crosstab and Cramer's V. Both are cheap. When the
  grouping does not line up with any technical variable there is nothing to
  separate, and the verdict is a confident clean.
- ``prove`` tests the design-matrix rank and, when the two are separable, refits
  the condition effect adjusting for the technical variable.

The two outcomes carry the honesty rule directly. Separable means the covariate
can be added, so the correction is the adjusted effect and the feasibility is
fixable now. Fully collinear (Cramer's V at or near 1, or a rank-deficient
design) means the comparison cannot be rescued from this dataset. Redline says so
plainly and shows no corrected result: it needs a design where the two vary
independently.
"""

from __future__ import annotations

from typing import Any, Optional

from ..contracts import (
    FIXABLE_NOW,
    FLAG_ONLY,
    NEEDS_NEW_DATA,
    UNSALVAGEABLE,
    ConfoundGrid,
    CorrectedCode,
    Knob,
    MethodRef,
    Recommendation,
    SignificanceLevel,
    confound_chart,
    fmt_p,
    significance_chart,
    stat,
)
from ..correction import kernels
from ..pillars import cfg_get, obs_series, two_groups
from ..pillars import confounding as P
from .base import Candidate, CheckModule, Claim, Design, Evidence

# Below this Cramer's V the grouping and the technical variable are not aligned
# enough to confound; at or above the nested threshold they cannot be separated.
_ALIGN_MIN = 0.5
_NESTED = P.NESTED_THRESHOLD

_CITATION = MethodRef(
    authors="Hicks et al.",
    year=2018,
    venue="Biostatistics",
    note="An effect perfectly aligned with a technical variable is not identifiable; balance the design.",
)


def _resolve_roles(design: Design):
    interest = cfg_get(design.config, "interest", None) or cfg_get(design.config, "grouping", None) or design.grouping
    nuisance_names = list(cfg_get(design.config, "nuisance", []) or [])
    if not nuisance_names:
        nuisance_names = design.nuisance
    return interest, [str(n) for n in nuisance_names]


class Confounding(CheckModule):
    id = 4
    name = "Confounding"
    one_line = "Two variables that cannot be separated"
    error_class = "confounding"
    citation = _CITATION
    claim_kinds = ("de",)
    knobs = (
        Knob(key="interest", label="Effect of interest", kind="text"),
        Knob(key="nuisance", label="Technical variables", kind="multiselect"),
    )

    def applies_to(self, claim: Claim, design: Design) -> bool:
        if claim.kind and claim.kind != "unknown" and claim.kind not in self.claim_kinds:
            return False
        interest, _ = _resolve_roles(design)
        return bool(interest)

    def detect(self, claim: Claim, adata: Any, design: Design):
        interest, nuisance_names = _resolve_roles(design)
        interest_vec = obs_series(adata, interest) if interest else None
        if interest_vec is None:
            return Candidate(
                state=FLAG_ONLY,
                headline="No grouping column is resolved, so confounding cannot be assessed.",
                numbers={"interest": "", "technical": "", "separable": True},
                stats=[stat("Grouping", "not set", bad=True)],
            )

        present = [(n, obs_series(adata, n)) for n in nuisance_names]
        present = [(n, v) for n, v in present if v is not None]
        if not present:
            aligned = P._aligned_from_fields(adata, design.fields, interest_vec)
            head = "No technical variable was selected, so confounding could not be assessed."
            if aligned:
                head = (
                    f"No technical variable was selected. '{aligned[0]}' shows alignment with "
                    f"'{interest}'; add it to test separability."
                )
            stats = [stat("Nuisance vars", "0", bad=True), stat("Assessed", "no")]
            return Candidate(
                state=FLAG_ONLY,
                headline=head,
                numbers={"interest": str(interest), "technical": str(aligned[0]) if aligned else "", "separable": True},
                stats=stats,
            )

        name, nuis_vec, v = P._pick_nuisance_col(adata, nuisance_names, interest_vec)
        rank_deficient = P._design_rank_deficient([list(interest_vec)] + [list(v2) for _, v2 in present])

        if v < _ALIGN_MIN and not rank_deficient:
            grid = P._grid(interest_vec, nuis_vec)
            return _clean(interest, name, v, grid)

        base = {
            "interest": str(interest),
            "technical": str(name),
            "nuisance": nuisance_names,
            "cramers_v": float(v),
            "rank_deficient": bool(rank_deficient),
        }
        head = f"'{interest}' lines up with '{name}'; whether the effect can be separated has to be tested."
        return Candidate(
            state="flagged",
            headline=head,
            numbers=base,
            stats=[stat("Cramer's V", f"{v:.2f}", bad=True), stat("Aligns with", str(name))],
        )

    def prove(self, candidate: Candidate, adata: Any, design: Design) -> Evidence:
        base = candidate.numbers or {}
        interest = base.get("interest") or ""
        name = base.get("technical") or ""
        unit = design.unit
        alpha = float(cfg_get(design.config, "alpha", 0.05))

        interest_vec = obs_series(adata, interest)
        params = {
            "h5ad": _h5ad_hint(design),
            "interest": str(interest),
            "technical": str(name),
            "gene": None,
            "unit": str(unit) if unit else None,
            "alpha": alpha,
        }

        if base.get("nuisance") is None or interest_vec is None or not name:
            # The no-technical-variable path: nothing was assessed, so nothing is proven.
            grid = ConfoundGrid(
                rows=[str(x) for x in dict.fromkeys([str(x) for x in interest_vec])] if interest_vec is not None else [],
                cols=[],
                cells=[],
            )
            return Evidence(
                state=FLAG_ONLY,
                headline=candidate.headline,
                stats=list(candidate.stats),
                chart=confound_chart(grid, None, verified=False),
                numbers={"original": None, "corrected": None},
                method=self.citation,
                feasibility=NEEDS_NEW_DATA,
                params=params,
                corrected_artifact=None,
                caveat="No technical variable was available to test separability.",
            )

        nuis_vec = obs_series(adata, name)
        grid = P._grid(interest_vec, nuis_vec)

        # The kernel owns the separability decision and both p-values, so what
        # Redline reports, previews, and emits are the same computation.
        nums = kernels.check4_confounding(
            adata, interest=str(interest), technical=str(name), gene=None, unit=params["unit"], alpha=alpha
        )
        v = float(nums["cramers_v"])
        chart = confound_chart(grid, v, verified=True)
        n_units = self._n_units(adata, interest_vec, unit)

        if nums["unsalvageable"] or nums["corrected"] is None:
            head = (
                f"'{interest}' and '{name}' are the same split here; the effect cannot be separated "
                "from the technical variable, and this dataset cannot be rescued for this comparison."
            )
            stats = [
                stat("Cramer's V", f"{v:.2f}", bad=True),
                stat("Separable", "no", bad=True),
                stat("Design", "fully nested"),
            ]
            return Evidence(
                state="flagged",
                headline=head,
                stats=stats,
                chart=chart,
                numbers=nums,
                method=self.citation,
                feasibility=UNSALVAGEABLE,
                params=params,
                corrected_artifact=None,
                caveat="The condition and the technical variable are the same split; no adjustment can separate them.",
            )

        # Separable: the corrected effect is the replicate-level ~ interest + technical
        # refit, rendered as the preview's significance after-chart.
        p_naive = nums["original"]
        p_adjusted = nums["corrected"]
        naive_level = SignificanceLevel(n=n_units, p=p_naive or 1.0, sig=(p_naive is not None and p_naive < alpha))
        adj_level = SignificanceLevel(n=n_units, p=p_adjusted or 1.0, sig=(p_adjusted is not None and p_adjusted < alpha))
        after = significance_chart(naive_level, adj_level, alpha, [], bad_unit=False)
        head = f"'{interest}' and '{name}' overlap but can be separated; add '{name}' to the model to get the adjusted effect."
        stats = [
            stat("Cramer's V", f"{v:.2f}", bad=True),
            stat("Separable", "yes", good=True),
            stat("Effect after +technical", fmt_p(p_adjusted) if p_adjusted is not None else "n/a"),
        ]
        return Evidence(
            state="flagged",
            headline=head,
            stats=stats,
            chart=chart,
            numbers=nums,
            method=self.citation,
            feasibility=FIXABLE_NOW,
            params=params,
            corrected_artifact=after,
            caveat=f"The adjusted effect is identifiable because the two variables are not perfectly aligned ({nums['method']}).",
        )

    def _n_units(self, adata: Any, interest_vec: Any, unit: Optional[str]) -> int:
        """Replicate count in the two compared arms, for the chart's n labels."""
        import numpy as np

        picked = two_groups(interest_vec, {})
        if picked is None:
            return 0
        ref, alt, ref_mask, alt_mask = picked
        keep = ref_mask | alt_mask
        units = obs_series(adata, unit) if unit else None
        if units is None:
            return int(keep.sum())
        u = np.asarray([str(x) for x in units])[keep]
        return int(np.unique(u).size)

    def recommend(self, evidence: Evidence, design: Design) -> list[Recommendation]:
        p = evidence.params
        interest = p.get("interest") or "the grouping"
        name = p.get("technical") or "the technical variable"

        if evidence.state == FLAG_ONLY:
            if name:
                return [
                    Recommendation(
                        action=f"Add '{name}' to the nuisance set and re-run so separability can be tested.",
                        rationale=f"'{name}' shows alignment with '{interest}' but was not selected, so confounding was not assessed.",
                        changes="The check can then report whether the effect is identifiable once the technical variable is modeled.",
                        feasibility=FIXABLE_NOW,
                        citation=self.citation,
                    )
                ]
            return [
                Recommendation(
                    action="Record the technical variables (lane, day, batch) and re-run so confounding can be tested.",
                    rationale="No technical variable was available, so alignment with the biology could not be measured.",
                    changes="With the technical metadata present the comparison can be checked for confounding.",
                    feasibility=NEEDS_NEW_DATA,
                    citation=self.citation,
                )
            ]

        if evidence.feasibility == UNSALVAGEABLE:
            return [
                Recommendation(
                    action=f"Do not report '{interest}' from this dataset; collect a design where '{interest}' and '{name}' vary independently.",
                    rationale=f"'{interest}' and '{name}' are the same split, so no model can attribute the effect to the biology rather than the technical variable.",
                    changes=f"A balanced design (each '{interest}' level spread across '{name}') makes the comparison identifiable.",
                    feasibility=UNSALVAGEABLE,
                    citation=self.citation,
                )
            ]

        n = evidence.numbers
        return [
            Recommendation(
                action=f"Add '{name}' to the differential-expression model and report the adjusted effect of '{interest}'.",
                rationale=f"The naive effect ({fmt_p(n.get('original'))}) ignores '{name}'; adjusting for it gives {fmt_p(n.get('corrected'))}.",
                changes="The reported effect is the one that controls for the technical variable, not the raw comparison.",
                feasibility=FIXABLE_NOW,
                citation=self.citation,
            )
        ]

    def correct(self, evidence: Evidence, adata: Any, design: Design) -> CorrectedCode:
        from .m05_multiple_testing import render_or_fallback

        return render_or_fallback(self.id, evidence.params)


def _clean(interest: str, name: Optional[str], v: float, grid) -> "object":
    from .base import Clean

    return Clean(
        headline=f"'{interest}' does not line up with '{name}'; there is no confound to separate.",
        stats=[stat("Cramer's V", f"{v:.2f}", good=True), stat("Separable", "yes", good=True)],
        chart=confound_chart(grid, v, verified=True),
    )


def _h5ad_hint(design: Design) -> str:
    return str(cfg_get(design.config, "h5ad", None) or "data.h5ad")


MODULE: CheckModule = Confounding()

__all__ = ["MODULE", "Confounding"]
